/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleCollectComputeResult } from './collect-compute-result.js';
import { InMemoryComputeResultStore } from '../testing/step-helpers.js';

const REPO = 'test-repo';
const WS = 'test-ws';

describe('collect-compute-result', () => {
  let store: InstanceType<typeof InMemoryComputeResultStore>;

  beforeEach(() => {
    store = new InMemoryComputeResultStore();
  });

  it('returns result and deletes from store', async () => {
    const expected = { taskName: 'my-task', status: 'success' as const, outputHash: 'abc123', duration: 5000 };
    await store.write(REPO, WS, 'exec-1', JSON.stringify(expected));

    const result = await handleCollectComputeResult(store, {
      repo: REPO, workspace: WS, taskExecutionId: 'exec-1', taskName: 'my-task',
    });

    assert.equal(result.status, 'success');
    assert.equal(result.outputHash, 'abc123');
    assert.equal(result.duration, 5000);

    // Should be deleted after read
    const after = await store.read(REPO, WS, 'exec-1');
    assert.equal(after, null);
  });

  it('returns failed when no result found (container crash)', async () => {
    const result = await handleCollectComputeResult(store, {
      repo: REPO, workspace: WS, taskExecutionId: 'missing', taskName: 'crashed-task',
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.taskName, 'crashed-task');
    assert.ok(result.error?.includes('crash'));
  });
});
