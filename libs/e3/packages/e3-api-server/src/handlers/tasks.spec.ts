/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Task route tests: a task's execution history lists its runs, and leaves out
 * the units a split task runs under its hash, which are not runs of it.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { ArrayType, decodeBeast2For, encodeBeast2For, none, some, variant } from '@elaraai/east';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { PackageObjectType, WorkspaceRecordType } from '@elaraai/e3-types';
import { createTaskRoutes } from '../routes/tasks.js';
import { ExecutionListItemType, ResponseType } from '../types.js';

const REPO = 'test-repo';
const WS = 'main';
const TASK = 'a'.repeat(64);
const decodeHistory = decodeBeast2For(ResponseType(ArrayType(ExecutionListItemType)));

describe('task routes', () => {
  let storage: InMemoryStorage;
  let app: Hono;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    await storage.repos.create(REPO);
    const pkg = await storage.objects.write(REPO, encodeBeast2For(PackageObjectType)({
      tasks: new Map([['count', TASK]]),
      data: { structure: variant('struct', new Map()), refs: new Map() },
      functions: new Map(),
      records: new Map(),
      sources: new Map(),
    }));
    await storage.refs.workspaceWrite(REPO, WS, encodeBeast2For(WorkspaceRecordType)(some({
      packageName: 'counts', packageVersion: '1.0.0', packageHash: pkg, deployedAt: new Date(0), currentRunId: none,
    })));
    app = new Hono();
    app.route('/api/repos/:repo/workspaces/:ws/tasks', createTaskRoutes(storage, () => REPO));
  });

  /** The inputs hash of each execution the task's history lists. */
  async function history(query = ''): Promise<string[]> {
    const response = await app.request(`/api/repos/r/workspaces/${WS}/tasks/count/executions${query}`);
    const answer = decodeHistory(new Uint8Array(await response.arrayBuffer()));
    if (answer.type !== 'success') assert.fail(`the history was refused: ${answer.value.type}`);
    return answer.value.map((item) => item.inputsHash);
  }

  it('lists a split task\'s runs, and none of the units it ran under its hash', async () => {
    // Two runs of the task over the same inputs, and a piece and a merge of
    // the second, each under inputs of its own.
    const own = 'b'.repeat(64);
    const executions: [string, boolean][] = [[own, false], [own, false], ['c'.repeat(64), true], ['d'.repeat(64), true]];
    for (const [i, [inputs, unit]] of executions.entries()) {
      const executionId = `01900000-0000-7000-8000-00000000000${i + 1}`;
      await storage.refs.executionWrite(REPO, TASK, inputs, executionId, variant('success', {
        executionId, inputHashes: [], outputHash: 'f'.repeat(64),
        startedAt: new Date(0), completedAt: new Date(1_000), peakBytes: none, plan: none, unit,
      }));
    }

    assert.deepEqual(await history(), [own]);
    assert.deepEqual(await history('?all=true'), [own, own]);
  });
});
