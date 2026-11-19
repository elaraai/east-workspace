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
import { captured, withExitStub } from '../cli-test-helpers.js';
import { compactCommand } from './compact.js';

const encodeInt = encodeBeast2For(IntegerType);

describe('compactCommand', () => {
  let repo: string;
  let tempDir: string;
  let storage: LocalStorage;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));

    const counter = e3.record('counter', IntegerType, {
      initial: 0n,
      mutations: (mutation) => ({
        increment: mutation.reduce(East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by))),
      }),
    });
    const pkg = e3.package('counters', '1.0.0', counter);
    const zip = join(tempDir, 'counters.zip');
    await e3.export(pkg, zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'main');
    await workspaceDeploy(storage, repo, 'main', 'counters', '1.0.0');
    // The reducer's unit succeeds with the new state as its output, and no
    // process starts.
    const reducer = {
      execute: async () => ({ state: 'success', cached: false, outputHash: await storage.objects.write(repo, encodeInt(7n)) }),
    } as unknown as TaskRunner;
    await recordMutate(storage, reducer, repo, 'main', 'counter', 'increment', [encodeInt(7n)], { actor: 'test' });
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  it('compacts a local record, collapsing the chain to a $compact root', async () => {
    assert.equal((await recordHistory(storage, repo, 'main', 'counter')).length, 2); // $init + increment

    const output = await captured(() => compactCommand(repo, 'counter', { workspace: 'main' }));

    assert.match(output, /Compacted 'counter'/);
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
