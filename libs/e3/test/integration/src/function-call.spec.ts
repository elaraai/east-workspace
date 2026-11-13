/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Integration tests for `e3 call` against a LOCAL repository — the path
 * that runs the function via LocalTaskRunner.runDetached directly, with no
 * server in between, and lays a call's drafts in the same process. (The
 * remote-URL CLI path is covered by the shared cli suite in e3-api-tests.)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  IntegerType, PatchType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, variant,
  type PatchTypeOf, type ValueTypeOf,
} from '@elaraai/east';
import { repoInit, packageImport, recordHistory, LocalStorage } from '@elaraai/e3-core';
import { createDraftsPackageZip, createFunctionPackageZip, DraftJobsType } from '@elaraai/e3-api-tests';
import { createTestDir, removeTestDir, runE3Command } from './helpers.js';

/** What one touched key of a jobs patch carries, derived from the patch type. */
type DraftJobOp = Extract<ValueTypeOf<PatchTypeOf<typeof DraftJobsType>>, { type: 'patch' }>['value'] extends Map<string, infer Op>
  ? Op : never;

describe('e3 call (local repository)', { timeout: 120_000, concurrency: false }, () => {
  let testDir: string;
  let repoPath: string;

  before(async () => {
    testDir = createTestDir();
    repoPath = join(testDir, 'repo');
    repoInit(repoPath);
    const zipPath = await createFunctionPackageZip(testDir, 'local-fn-pkg', '1.0.0');
    await packageImport(new LocalStorage(), repoPath, zipPath);
  });

  after(() => {
    removeTestDir(testDir);
  });

  it('calls a function with literal args and prints the decoded result', async () => {
    const result = await runE3Command(['call', repoPath, 'local-fn-pkg.add', '2', '3'], process.cwd());
    assert.equal(result.exitCode, 0, `Failed: ${result.stderr}`);
    assert.match(result.stdout, /\b5\b/);
  });

  it('writes the raw result with -o and accepts .beast2 file args', async () => {
    const outPath = join(testDir, 'sum.beast2');
    const first = await runE3Command(
      ['call', repoPath, 'local-fn-pkg.add', '20', '22', '-o', outPath],
      process.cwd()
    );
    assert.equal(first.exitCode, 0, `Failed: ${first.stderr}`);
    assert.equal(decodeBeast2For(IntegerType)(readFileSync(outPath)), 42n);

    // Feed the previous result back in as a .beast2 file argument
    const second = await runE3Command(
      ['call', repoPath, 'local-fn-pkg.add', outPath, '8'],
      process.cwd()
    );
    assert.equal(second.exitCode, 0, `Failed: ${second.stderr}`);
    assert.match(second.stdout, /\b50\b/);
  });

  it('reports the function repertoire on an unknown function', async () => {
    const result = await runE3Command(['call', repoPath, 'local-fn-pkg.nope', '1'], process.cwd());
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /not found/);
    assert.match(result.stderr, /add/);
  });

  it('sets a non-zero exit code on arity mismatch', async () => {
    const result = await runE3Command(['call', repoPath, 'local-fn-pkg.add', '1'], process.cwd());
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /argument/i);
  });

  it('rejects an unparseable literal argument', async () => {
    const result = await runE3Command(['call', repoPath, 'local-fn-pkg.add', 'one', '2'], process.cwd());
    assert.notEqual(result.exitCode, 0);
  });

  describe('a dataset argument, written @<keypath>', { concurrency: false }, () => {
    before(async () => {
      for (const command of [['workspace', 'create', repoPath, 'ws'], ['workspace', 'deploy', repoPath, 'ws', 'local-fn-pkg@1.0.0']]) {
        const result = await runE3Command(command, process.cwd());
        assert.equal(result.exitCode, 0, `${command.join(' ')}: ${result.stderr}`);
      }
    });

    it('is the dataset of the workspace the call runs in', async () => {
      // `value` holds 10
      const result = await runE3Command(['call', repoPath, '-w', 'ws', 'add', '@.inputs.value', '5'], process.cwd());
      assert.equal(result.exitCode, 0, `Failed: ${result.stderr}`);
      assert.match(result.stdout, /\b15\b/);
    });

    it('is refused without -w, before the repository is read', async () => {
      const result = await runE3Command(['call', join(testDir, 'no-such-repo'), 'local-fn-pkg.add', '5', '@.inputs.value'], process.cwd());
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /Argument 2 \(@\.inputs\.value\) is a dataset, which a call reads from the workspace it runs in: pass -w <ws>/);
    });

    it('names an unassigned dataset', async () => {
      const result = await runE3Command(['call', repoPath, '-w', 'ws', 'add', '5', '@.inputs.apply'], process.cwd());
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /Dataset argument 1 is not assigned \(ref type: unassigned\)/);
    });

    it('is passed beside a function\'s inputs, which the call reads itself and the arity does not count', async () => {
      // `quote` reads `value` (10) and `prices` (b 2); `-w` passes `"b"` alone
      const result = await runE3Command(['call', repoPath, '-w', 'ws', 'quote', '"b"'], process.cwd());
      assert.equal(result.exitCode, 0, `Failed: ${result.stderr}`);
      assert.match(result.stdout, /\b12\b/);

      const counted = await runE3Command(['call', repoPath, '-w', 'ws', 'quote', '10', '"b"'], process.cwd());
      assert.notEqual(counted.exitCode, 0);
      assert.match(counted.stderr, /Function 'quote' expects 1 argument\(s\), got 2/);
    });

    it('refuses a function with inputs without -w, naming them', async () => {
      const result = await runE3Command(['call', repoPath, 'local-fn-pkg.quote', '"b"'], process.cwd());
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /Function 'quote' reads \.inputs\.value, \.inputs\.prices from the workspace it is called through: pass -w <ws>/);
    });

    it('names an unassigned input', async () => {
      // `scaled` reads `compute`'s output, which no run has produced
      const result = await runE3Command(['call', repoPath, '-w', 'ws', 'scaled', '3'], process.cwd());
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /The function's input \.tasks\.compute\.output is not assigned \(ref type: unassigned\)/);
    });

    it('names an @ that is not a dataset\'s keypath', async () => {
      for (const [raw, message] of [
        ['@inputs.value', /Argument 1 \(@inputs\.value\) is not a dataset's keypath, as @\.inputs\.sales is: parseKeypath: unexpected character at position 0: 'i'/],
        ['@', /Argument 1 \(@\) names the workspace's root, which is a tree/],
      ] as const) {
        const result = await runE3Command(['call', repoPath, '-w', 'ws', 'add', raw, '5'], process.cwd());
        assert.notEqual(result.exitCode, 0, raw);
        assert.match(result.stderr, message, raw);
      }
    });
  });

  describe('drafts, written --draft', { concurrency: false }, () => {
    const ws = 'drafted';
    const call = (...words: string[]): ReturnType<typeof runE3Command> => runE3Command(['call', repoPath, '-w', ws, ...words], process.cwd());
    /** A patch of the jobs, in a file a draft's argument names. */
    const patchFile = (name: string, ops: Array<[string, DraftJobOp]>): string => {
      const path = join(testDir, name);
      writeFileSync(path, encodeBeast2For(PatchType(DraftJobsType))(variant('patch', new SortedMap<string, DraftJobOp>(ops, compareFor(StringType)))));
      return path;
    };

    before(async () => {
      // `jobs` holds j1 on P1 for 2 hours, j2 on P2 for 3 and j3 on P1 for 4; `tally` holds 0
      const zipPath = await createDraftsPackageZip(testDir, 'local-drafts-pkg', '1.0.0');
      await packageImport(new LocalStorage(), repoPath, zipPath);
      for (const command of [['workspace', 'create', repoPath, ws], ['workspace', 'deploy', repoPath, ws, 'local-drafts-pkg@1.0.0']]) {
        const result = await runE3Command(command, process.cwd());
        assert.equal(result.exitCode, 0, `${command.join(' ')}: ${result.stderr}`);
      }
    });

    it('lays an unsaved edit over the record the function reads, and saves nothing', async () => {
      const storage = new LocalStorage();
      const commits = (await recordHistory(storage, repoPath, ws, 'jobs')).length;
      const saved = await call('jobs_on', '"P1"');
      assert.equal(saved.exitCode, 0, `Failed: ${saved.stderr}`);
      assert.match(saved.stdout, /\b2\b/);

      const drafted = await call('jobs_on', '"P1"', '--draft', 'jobs.move', '"j2"', '"P1"');
      assert.equal(drafted.exitCode, 0, `Failed: ${drafted.stderr}`);
      assert.match(drafted.stdout, /\b3\b/, 'the function reads j2 on P1');

      const after = await call('jobs_on', '"P1"');
      assert.match(after.stdout, /\b2\b/, 'the record reads as it was saved');
      assert.equal((await recordHistory(storage, repoPath, ws, 'jobs')).length, commits, 'and no commit joined its history');
    });

    it('lays several drafts in the order written, of two records, a patch from a file among them', async () => {
      const saved = await call('hours');
      assert.equal(saved.exitCode, 0, `Failed: ${saved.stderr}`);
      assert.match(saved.stdout, /\b9\b/);

      const gone = patchFile('gone.beast2', [['j1', variant('delete', { press: 'P1', hours: 2n })]]);
      // j2 as the move before it leaves it: on P1
      const moved = patchFile('moved.beast2', [['j2', variant('delete', { press: 'P1', hours: 3n })]]);
      // A word that starts with a dash is written --draft=<word>
      const drafted = await call('hours',
        '--draft', 'tally.add', '5', '--draft', 'jobs.patch', gone, '--draft', 'jobs.move', '"j2"', '"P1"',
        '--draft', 'jobs.patch', moved, '--draft', 'tally.add', '--draft=-1');
      assert.equal(drafted.exitCode, 0, `Failed: ${drafted.stderr}`);
      assert.match(drafted.stdout, /\b8\b/, 'j3\'s 4 hours, and a tally of 5 less 1');

      // Written the other way round, the delete does not fit the record it is laid over
      const unfit = await call('hours', '--draft', 'jobs.patch', moved, '--draft', 'jobs.move', '"j2"', '"P1"');
      assert.notEqual(unfit.exitCode, 0);
      assert.match(unfit.stderr, /Draft jobs\.patch conflicted: .*j2.* — the edit no longer matches the record; re-read it and call again/);
      assert.equal(unfit.stdout.trim(), '', 'the function did not run');
    });

    it('takes the call\'s own arguments before the first --draft, or after a --', async () => {
      const after = await call('jobs_on', '--draft', 'jobs.move', '"j2"', '"P1"', '--', '"P1"');
      assert.equal(after.exitCode, 0, `Failed: ${after.stderr}`);
      assert.match(after.stdout, /\b3\b/);

      const swallowed = await call('jobs_on', '--draft', 'jobs.move', '"j2"', '"P1"', '"P1"');
      assert.notEqual(swallowed.exitCode, 0);
      assert.match(swallowed.stderr, /Function 'jobs_on' expects 1 argument\(s\), got 0 — a call's own arguments are written before the first --draft/);
    });

    it('refuses a draft without -w before the repository is read, and one the function or the workspace does not take', async () => {
      const unscoped = await runE3Command(
        ['call', join(testDir, 'no-such-repo'), 'local-drafts-pkg.jobs_on', '"P1"', '--draft', 'jobs.move', '"j2"', '"P1"'], process.cwd());
      assert.notEqual(unscoped.exitCode, 0);
      assert.match(unscoped.stderr, /A draft \(--draft jobs\.move\) is laid over a record of the workspace the call runs in: pass -w <ws>/);

      const unlisted = await call('job_count', '--draft', 'jobs.move', '"j2"', '"P1"');
      assert.notEqual(unlisted.exitCode, 0);
      assert.match(unlisted.stderr, /draft jobs\.move \(1 of 1\): the function lists no record a call may draft/);

      const unknown = await call('jobs_on', '"P1"', '--draft', 'jobs.nope');
      assert.notEqual(unknown.exitCode, 0);
      assert.match(unknown.stderr, /Draft 1 \(jobs\.nope\): mutation 'nope' not found on record 'jobs'\. Available: /);

      const ghost = await call('jobs_on', '"P1"', '--draft', 'ghost.add', '1');
      assert.notEqual(ghost.exitCode, 0);
      assert.match(ghost.stderr, /Draft 1 \(ghost\.add\): record 'ghost' not found in workspace 'drafted'/);
    });

    it('reports a draft whose mutation fails as that draft\'s failure, its stderr shown and the function not run', async () => {
      const result = await call('jobs_on', '"P1"', '--draft', 'jobs.move', '"j2"', '"P1"', '--draft', 'jobs.refuse', '"not today"');
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /^draft jobs\.refuse \(2 of 2\) failed$/m, 'the first line of the call\'s stderr names the draft');
      assert.match(result.stderr, /refused: not today/, 'and the mutation\'s own stderr follows');
      assert.match(result.stderr, /Draft jobs\.refuse \(2 of 2\) failed with exit code: 1; the function did not run/);
      assert.equal(result.stdout.trim(), '');
    });
  });
});
