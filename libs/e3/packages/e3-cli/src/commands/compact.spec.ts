/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 compact` adapter: against a local repo it resolves the record, runs the
 * compaction, collapses the commit chain to a single `$compact` root, and
 * reports it; an unknown record or a missing --workspace exits non-zero.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { East, IntegerType, encodeBeast2For } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { LocalStorage, recordHistory, recordMutate, packageImport, workspaceCreate, workspaceDeploy } from '@elaraai/e3-core';
import type { TaskRunner } from '@elaraai/e3-core';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from '@elaraai/e3-core/test';
import { compactCommand } from './compact.js';

const encodeInt = encodeBeast2For(IntegerType);

/** A reducer runner that returns a fixed new state without spawning a process. */
const fixedState = (value: bigint): TaskRunner => ({
  runDetached: async () => ({ kind: 'success', value: encodeInt(value), stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false }),
}) as unknown as TaskRunner;

/** Run `fn` with process.exit stubbed to throw (so exitError surfaces as a
 *  rejection instead of killing the test runner) and console.error silenced. */
async function withExitStub(fn: () => Promise<void>): Promise<void> {
  const origExit = process.exit;
  const origErr = console.error;
  process.exit = ((code?: number) => { throw new Error(`exit ${code ?? 0}`); }) as never;
  console.error = () => {};
  try {
    await fn();
  } finally {
    process.exit = origExit;
    console.error = origErr;
  }
}

describe('compactCommand', () => {
  let repo: string;
  let tempDir: string;
  let storage: LocalStorage;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));

    const counter = e3.record('counter', IntegerType, 0n);
    const increment = e3.mutation(
      'increment', counter,
      East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by)),
    );
    const pkg = e3.package('counters', '1.0.0', counter, increment);
    const zip = join(tempDir, 'counters.zip');
    await e3.export(pkg, zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'main');
    await workspaceDeploy(storage, repo, 'main', 'counters', '1.0.0');
    await recordMutate(storage, fixedState(7n), repo, 'main', 'counter', 'increment', [encodeInt(7n)], { actor: 'test' });
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  it('compacts a local record, collapsing the chain to a $compact root', async () => {
    assert.equal((await recordHistory(storage, repo, 'main', 'counter')).length, 2); // $init + increment

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    try {
      await compactCommand(repo, 'counter', { workspace: 'main' });
    } finally {
      console.log = origLog;
    }

    assert.match(lines.join('\n'), /Compacted 'counter'/);
    const history = await recordHistory(storage, repo, 'main', 'counter');
    assert.equal(history.length, 1);
    assert.equal(history[0]!.commit.mutation, '$compact');
  });

  it('exits non-zero for an unknown record', async () => {
    await assert.rejects(withExitStub(() => compactCommand(repo, 'ghost', { workspace: 'main' })));
    // The real record is untouched by the failed compaction.
    assert.equal((await recordHistory(storage, repo, 'main', 'counter')).length, 2);
  });

  it('exits non-zero when --workspace is omitted', async () => {
    await assert.rejects(withExitStub(() => compactCommand(repo, 'counter', {})));
  });
});
