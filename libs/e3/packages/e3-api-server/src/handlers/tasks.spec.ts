/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Task route tests: a task's execution history is served a page at a time, the
 * latest run first, read from the task's index of runs and never its whole
 * history; it leaves out the units a split task runs under its hash, which are
 * not runs of it; and it says why each run that was cancelled or interrupted
 * stopped.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { ArrayType, OptionType, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant } from '@elaraai/east';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { PackageObjectType, StopReasonType, WorkspaceRecordType, type ExecutionStatus, type StopReason } from '@elaraai/e3-types';
import { createTaskRoutes } from '../routes/tasks.js';
import {
  ExecutionListItemType, ResponseType, TASK_EXECUTIONS_PAGE_DEFAULT, TASK_EXECUTIONS_PAGE_MAX, type ExecutionListItem,
} from '../types.js';

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

  /** Each execution the task's history lists, as the route serves it. */
  async function items(query = ''): Promise<ExecutionListItem[]> {
    const response = await app.request(`/api/repos/r/workspaces/${WS}/tasks/count/executions${query}`);
    const answer = decodeHistory(new Uint8Array(await response.arrayBuffer()));
    if (answer.type !== 'success') assert.fail(`the history was refused: ${answer.value.type}`);
    return answer.value;
  }

  /** The inputs hash and execution id of each run the task's history lists. */
  async function history(query = ''): Promise<[string, string][]> {
    return (await items(query)).map((item) => [item.inputsHash, item.executionId]);
  }

  it('serves why each run that was cancelled or interrupted stopped, and no reason for one that ended otherwise', async () => {
    const at = { inputHashes: [], startedAt: new Date(0), completedAt: new Date(1_000), unit: false };
    const aborted: StopReason = { kind: variant('aborted', null), message: 'cancelled: e3 stopped the runner because the run was aborted' };
    const host: StopReason = { kind: variant('host', 'OutOfMemoryError'), message: 'its container ran out of memory' };
    const runs: [string, ExecutionStatus, StopReason | null][] = [
      ['1'.repeat(64), variant('cancelled', { ...at, executionId: '01900000-0000-7000-8000-000000000011', reason: aborted }), aborted],
      ['2'.repeat(64), variant('interrupted', { ...at, executionId: '01900000-0000-7000-8000-000000000012', pid: 0n, reason: host }), host],
      ['3'.repeat(64), variant('error', { ...at, executionId: '01900000-0000-7000-8000-000000000013', message: 'Failed to read output' }), null],
    ];
    for (const [inputs, status] of runs) await storage.refs.executionWrite(REPO, TASK, inputs, status.value.executionId, status);

    const served = new Map((await items()).map((item) => [item.inputsHash, item]));
    const equal = equalFor(OptionType(StopReasonType));
    for (const [inputs, status, reason] of runs) {
      const item = served.get(inputs);
      assert.ok(item !== undefined, `the ${status.type} run is listed`);
      assert.ok(equal(item.reason, reason === null ? none : some(reason)), `the ${status.type} run's reason is served`);
    }
  });

  it('lists a page of a split task\'s runs, the latest first, and none of the units it ran under its hash', async () => {
    // Two runs of the task over the same inputs, and a piece and a merge of
    // the second, each under inputs of its own.
    const own = 'b'.repeat(64);
    const executions: [string, boolean][] = [[own, false], [own, false], ['c'.repeat(64), true], ['d'.repeat(64), true]];
    const ids = executions.map((_, i) => `01900000-0000-7000-8000-00000000000${i + 1}`);
    for (const [i, [inputs, unit]] of executions.entries()) {
      const executionId = ids[i]!;
      await storage.refs.executionWrite(REPO, TASK, inputs, executionId, variant('success', {
        executionId, inputHashes: [], outputHash: 'f'.repeat(64),
        startedAt: new Date(0), completedAt: new Date(1_000), peakBytes: none, plan: none, unit,
      }));
    }

    assert.deepEqual(await history(), [[own, ids[1]], [own, ids[0]]], 'each run, the latest first, and no unit');
    assert.deepEqual(await history('?limit=1'), [[own, ids[1]]], 'a page holds at most its limit');
    assert.deepEqual(await history(`?limit=1&before=${ids[1]}`), [[own, ids[0]]], 'the next page begins before the last run of the one before');
    assert.deepEqual(await history(`?before=${ids[0]}`), [], 'and the last ends the listing');
  });

  it('reads the page from the task\'s index of runs, never its history, and at most TASK_EXECUTIONS_PAGE_MAX at a time', async () => {
    const refs = storage.refs;
    const pages: { before?: string; limit: number }[] = [];
    const listRuns = refs.executionListRuns.bind(refs);
    refs.executionListRuns = (repo, task, page) => {
      pages.push(page);
      return listRuns(repo, task, page);
    };
    const reads: string[] = [];
    for (const name of ['executionList', 'executionListForTask', 'executionListLatest', 'executionListIds', 'executionListAttempts'] as const) {
      const read = refs[name].bind(refs) as (...args: unknown[]) => Promise<unknown>;
      Object.assign(refs, { [name]: (...args: unknown[]) => { reads.push(name); return read(...args); } });
    }
    const before = '01900000-0000-7000-8000-000000000009';

    await items();
    await items(`?limit=${TASK_EXECUTIONS_PAGE_MAX + 1}`);
    await items(`?limit=3&before=${before}`);
    assert.deepEqual(pages, [{ limit: TASK_EXECUTIONS_PAGE_DEFAULT }, { limit: TASK_EXECUTIONS_PAGE_MAX }, { limit: 3, before }]);
    assert.deepEqual(reads, [], 'no listing of the task\'s history');
  });
});
