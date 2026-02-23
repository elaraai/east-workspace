/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleApplyTreeUpdates } from './apply-tree-updates.js';
import { createMockStorage } from '../testing/step-helpers.js';

const REPO = 'test-repo';
const WS = 'test-ws';

describe('apply-tree-updates', () => {
  let mock: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mock = createMockStorage();
  });

  it('returns 0 updates when no tree updates provided', async () => {
    const result = await handleApplyTreeUpdates(mock.base, {
      repo: REPO, workspace: WS, treeUpdates: [],
    });

    assert.equal(result.updatesApplied, 0);
  });

  it('skips updates where needsTreeUpdate is false', async () => {
    const result = await handleApplyTreeUpdates(mock.base, {
      repo: REPO, workspace: WS,
      treeUpdates: [
        { outputPath: '/data/a', outputHash: 'hash-a', needsTreeUpdate: false },
      ],
    });

    assert.equal(result.updatesApplied, 0);
  });

  it('skips updates with empty outputPath or outputHash', async () => {
    const result = await handleApplyTreeUpdates(mock.base, {
      repo: REPO, workspace: WS,
      treeUpdates: [
        { outputPath: '', outputHash: '', needsTreeUpdate: true },
      ],
    });

    assert.equal(result.updatesApplied, 0);
  });
});
