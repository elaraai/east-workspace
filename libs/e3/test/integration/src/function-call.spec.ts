/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Integration tests for `e3 call` against a LOCAL repository — the path
 * that runs the function via LocalTaskRunner.runDetached directly, with no
 * server in between. (The remote-URL CLI path is covered by the shared
 * cli suite in e3-api-tests.)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IntegerType, decodeBeast2For } from '@elaraai/east';
import { repoInit, packageImport, LocalStorage } from '@elaraai/e3-core';
import { createFunctionPackageZip } from '@elaraai/e3-api-tests';
import { createTestDir, removeTestDir, runE3Command } from './helpers.js';

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
});
