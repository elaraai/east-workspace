/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Unit tests for FileStateStore atomic-write rename resilience.
 *
 * On Windows, `fs.rename(tmp, dest)` fails (EPERM/EACCES/EBUSY/EEXIST) whenever
 * another handle has `dest` open — e.g. a concurrent reader. The execution-state
 * file is read on every API/CLI poll while the orchestrator rewrites it on each
 * task transition, so a poll-time read could intermittently fail the rewrite.
 * That rejection is caught in the orchestrator's task-completion handler and
 * misread as a *task failure*, silently turning a successful run into a failed
 * one (Windows-only, load-dependent). The store must therefore retry transient
 * rename failures rather than surface them.
 *
 * These tests simulate the Windows semantics on any OS by injecting the errno
 * codes into `fs.rename`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as nodeFs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { none } from '@elaraai/east';
import type { DataflowExecutionState } from '../types.js';
import { FileStateStore } from './FileStateStore.js';

function makeState(repo: string, workspace: string): DataflowExecutionState {
  return {
    id: 'test-1',
    repo,
    workspace,
    startedAt: new Date(),
    concurrency: 4n,
    force: false,
    filter: none,
    graph: none,
    graphHash: none,
    tasks: new Map(),
    executed: 0n,
    cached: 0n,
    failed: 0n,
    skipped: 0n,
    status: 'running',
    completedAt: none,
    error: none,
    versionVectors: new Map(),
    inputSnapshot: new Map(),
    taskOutputPaths: [],
    reexecuted: 0n,
    events: [],
    eventSeq: 0n,
  } as DataflowExecutionState;
}

type ErrnoError = Error & { code: string };
function errno(code: string): ErrnoError {
  const e = new Error(code) as ErrnoError;
  e.code = code;
  return e;
}

const realRename = nodeFs.promises.rename;
function withRenameStub(stub: typeof nodeFs.promises.rename, fn: () => Promise<void>): Promise<void> {
  (nodeFs.promises as { rename: typeof nodeFs.promises.rename }).rename = stub;
  return fn().finally(() => {
    (nodeFs.promises as { rename: typeof nodeFs.promises.rename }).rename = realRename;
  });
}

describe('FileStateStore atomic-write rename resilience', () => {
  it('retries transient rename failures (EPERM/EACCES/EBUSY/EEXIST) and still persists', async () => {
    for (const code of ['EPERM', 'EACCES', 'EBUSY', 'EEXIST']) {
      const dir = mkdtempSync(join(tmpdir(), 'e3-fss-'));
      try {
        const store = new FileStateStore(dir);
        const repo = '/tmp/test-repo';
        const state = makeState(repo, 'ws');
        await store.create(state);

        // A concurrent reader holds execution.beast2 open: the first two renames
        // onto it are denied, then it closes and the third succeeds.
        let failuresLeft = 2;
        const updated = { ...state, status: 'completed', executed: 3n } as DataflowExecutionState;
        await withRenameStub(async (from, to) => {
          if (typeof to === 'string' && to.endsWith('execution.beast2') && failuresLeft > 0) {
            failuresLeft--;
            throw errno(code);
          }
          return realRename(from, to);
        }, () => store.update(updated));

        assert.strictEqual(failuresLeft, 0, `${code}: both injected failures should have been hit`);
        const read = await store.read(repo, 'ws', state.id);
        assert.strictEqual(read?.status, 'completed', `${code}: status persisted`);
        assert.strictEqual(read?.executed, 3n, `${code}: events/counters persisted`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('propagates a non-transient rename error instead of retrying forever', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e3-fss-'));
    try {
      const store = new FileStateStore(dir);
      const repo = '/tmp/test-repo';
      const state = makeState(repo, 'ws2');
      await store.create(state);

      const updated = { ...state, status: 'completed' } as DataflowExecutionState;
      await withRenameStub(async () => {
        throw errno('ENOSPC');
      }, async () => {
        await assert.rejects(store.update(updated), /ENOSPC/);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
