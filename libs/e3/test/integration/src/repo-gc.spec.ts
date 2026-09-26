/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 repo gc` on a local repository (issue #770, gate (e)).
 *
 * The local form used to fail before marking anything (`RepoStore operations
 * require reposDir to be configured`). It collects a repository, keeping what
 * its workspace references, and refuses while a dataflow run holds a
 * workspace's dataflow lock or an ad-hoc `e3 run` holds the repository's task
 * lock — a run and gc never overlap, so the inputs, slices and unit outputs a
 * run writes before rooting them need no rooting. An `e3 run` takes that lock
 * before it writes or announces anything, so a gc refuses it cleanly.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import e3 from '@elaraai/e3';
import { East, StringType, encodeBeast2For, variant } from '@elaraai/east';
import { LocalStorage, TASKS_LOCK, computeHash } from '@elaraai/e3-core';
import { createTestDir, removeTestDir, runE3Command, spawnE3Command, waitFor } from './helpers.js';

describe('e3 repo gc', () => {
  let dir: string;
  let repo: string;
  let hold: string;
  const storage = new LocalStorage();

  beforeEach(async () => {
    dir = createTestDir();
    mkdirSync(dir, { recursive: true });
    repo = join(dir, 'repo');
    hold = join(dir, 'hold');

    // A task that copies its input once no hold file is left. The hold path is
    // spliced into a bash script, so it is given with forward slashes, as e3
    // gives a custom task its own paths: bash takes a Windows backslash for an
    // escape.
    const holdForBash = hold.split(sep).join('/');
    const text = e3.input('text', StringType, variant('value', 'kept'));
    const copy = e3.customTask('copy', [text], StringType, ($, inputs, output) => {
      const holdPath = $.const(holdForBash);
      return East.str`while [ -e '${holdPath}' ]; do sleep 0.1; done; cp ${inputs.get(0n)} ${output}`;
    });
    const zip = join(dir, 'gc.zip');
    await e3.export(e3.package('gc', '1.0.0', copy), zip);
    for (const args of [
      ['repo', 'create', repo],
      ['package', 'import', repo, zip],
      ['workspace', 'create', repo, 'ws'],
      ['workspace', 'deploy', repo, 'ws', 'gc@1.0.0'],
    ]) {
      const result = await runE3Command(args, dir);
      assert.equal(result.exitCode, 0, `e3 ${args.join(' ')}:\n${result.stderr}\n${result.stdout}`);
    }
  });

  afterEach(() => {
    removeTestDir(dir);
  });

  it('collects a local repository, keeping what its workspace references', async () => {
    const run = await runE3Command(['dataflow', 'run', repo, 'ws'], dir);
    assert.equal(run.exitCode, 0, `${run.stderr}\n${run.stdout}`);
    const orphan = await storage.objects.write(repo, new Uint8Array([1, 2, 3, 4]));

    const gc = await runE3Command(['repo', 'gc', repo, '--min-age', '0'], dir);
    assert.equal(gc.exitCode, 0, `${gc.stderr}\n${gc.stdout}`);
    assert.match(gc.stdout, /Garbage collection complete:/);
    assert.equal(await storage.objects.exists(repo, orphan), false, 'the unreferenced object is deleted');

    const output = await runE3Command(['dataset', 'get', repo, 'ws.copy'], dir);
    assert.equal(output.exitCode, 0, output.stderr);
    assert.match(output.stdout, /kept/, 'the task output survives');
  });

  it('refuses while a dataflow run holds the workspace\'s lock, and collects once the run finishes', async () => {
    writeFileSync(hold, '');
    const run = spawnE3Command(['dataflow', 'run', repo, 'ws'], dir);
    await waitFor(() => run.getStdout().includes('[START] copy'), 30_000);

    const refused = await runE3Command(['repo', 'gc', repo, '--min-age', '0'], dir);
    assert.notEqual(refused.exitCode, 0, refused.stdout);
    assert.match(refused.stderr, /gc: a dataflow is running in workspace 'ws' — retry when it finishes/);

    rmSync(hold);
    const finished = await run.result;
    assert.equal(finished.exitCode, 0, `${finished.stderr}\n${finished.stdout}`);
    const gc = await runE3Command(['repo', 'gc', repo, '--min-age', '0'], dir);
    assert.equal(gc.exitCode, 0, `${gc.stderr}\n${gc.stdout}`);
  });

  it('refuses while an ad-hoc `e3 run` holds the repository\'s task lock, and collects once it finishes', async () => {
    const inputFile = join(dir, 'text.beast2');
    writeFileSync(inputFile, encodeBeast2For(StringType)('kept'));
    writeFileSync(hold, '');
    const run = spawnE3Command(['run', repo, 'gc@1.0.0.copy', inputFile, '-o', join(dir, 'out.beast2')], dir);
    const diagnose = (err: unknown): never => {
      throw new Error(`${err instanceof Error ? err.message : String(err)}\nstdout:\n${run.getStdout()}\nstderr:\n${run.getStderr()}`);
    };
    // `e3 run` announces itself only once it holds the task lock, so the line
    // IS the readiness signal. No lock probe: an exclusive probe is exactly
    // what a gc looks like to the run, and a probe landing while the run takes
    // its lock refused the run instead of observing it (#827's Windows CI).
    await waitFor(() => run.getStdout().includes('Running gc@1.0.0/copy'), 30_000).catch(diagnose);

    const refused = await runE3Command(['repo', 'gc', repo, '--min-age', '0'], dir);
    assert.notEqual(refused.exitCode, 0, refused.stdout);
    assert.match(refused.stderr, /gc: a task is running — retry when it finishes/);

    rmSync(hold);
    const finished = await run.result;
    assert.equal(finished.exitCode, 0, `${finished.stderr}\n${finished.stdout}`);
    const gc = await runE3Command(['repo', 'gc', repo, '--min-age', '0'], dir);
    assert.equal(gc.exitCode, 0, `${gc.stderr}\n${gc.stdout}`);
  });

  it('an `e3 run` refused by a running gc announces nothing and writes nothing', async () => {
    const inputFile = join(dir, 'text.beast2');
    const input = encodeBeast2For(StringType)('refused');
    writeFileSync(inputFile, input);
    // Hold the task lock the way gc does — exclusively — for the whole run.
    const gcLock = await storage.locks.acquire(repo, TASKS_LOCK, variant('dataflow', null));
    assert.ok(gcLock !== null, 'an idle repository leaves the task lock free');
    try {
      const refused = await runE3Command(['run', repo, 'gc@1.0.0.copy', inputFile, '-o', join(dir, 'out.beast2')], dir);
      assert.notEqual(refused.exitCode, 0, refused.stdout);
      assert.match(refused.stderr, /run: a garbage collection is running in this repository — retry when it finishes/);
      // The run takes the lock before it announces itself or writes an input
      // object: a gc sweeping at `--min-age 0` would delete an input written
      // outside the lock, and a watcher would read "Running" as held.
      assert.doesNotMatch(refused.stdout, /Running gc@1\.0\.0\/copy/);
      assert.equal(await storage.objects.exists(repo, computeHash(input)), false, 'no input object was written');
    } finally {
      await gcLock.release();
    }
  });
});
