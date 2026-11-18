/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Unit tests for dataflow step functions.
 *
 * Tests the individual step functions used by the orchestrator,
 * using inline graph and state construction.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { some, none, variant, StringType, encodeBeast2For } from '@elaraai/east';
import { E3_RELEASE, dataflowForce, type DataflowForce, type TreePath, type Structure } from '@elaraai/e3-types';
import {
  checkDataflowStart,
  stepTasksDue,
  stepTaskDueAgain,
  stepResumedTasksDue,
  stepTaskCommits,
  deferralPath,
  stepGetReady,
  stepDetectInputChanges,
  stepYield,
  stepTaskSplit,
  stepTaskMergeStarted,
  stepTaskMergeCompleted,
  stepTaskCompleted,
  stepTaskFailed,
  stepTaskForced,
  stepTasksSkipped,
  stepTasksWaiting,
  stepIsComplete,
  stepFinalize,
  waitingTasks,
} from './steps.js';
import { DataflowError, TaskNotFoundError } from '../errors.js';
import * as root from '../index.js';
import * as portable from '../portable.js';
import type { DataflowExecutionState, TaskState, Mutable } from './types.js';
import { dataflowRootsHeld, dataflowSnapshotTaken, recordCommitOrder, type DataflowGraph } from '../dataflow.js';
import { createTestRepo, removeTestRepo, writableStrings } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import { workspaceDeploy } from '../workspaces.js';
import { workspaceSetDataset } from '../trees.js';
import { objectWrite } from '../storage/local/LocalObjectStore.js';
import {
  PackageObjectType,
  RecordCommitType,
  RecordObjectType,
  TASK_OBJECT_KIND,
  TaskObjectType,
  WorkspaceRecordType,
} from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/interfaces.js';
import { East, ArrayType, IRType } from '@elaraai/east';

/**
 * Create a minimal DataflowExecutionState with the given graph and tasks.
 */
function makeState(
  graph: DataflowGraph,
  tasks: Map<string, TaskState>,
  overrides?: Partial<{
    repo: string;
    workspace: string;
    taskOutputPaths: string[];
    executed: bigint;
    cached: bigint;
    force: DataflowForce;
    filter: string;
  }>,
): DataflowExecutionState {
  return {
    release: E3_RELEASE,
    id: 'test-1',
    repo: overrides?.repo ?? '/tmp/test-repo',
    workspace: overrides?.workspace ?? 'test-ws',
    startedAt: new Date(),
    force: overrides?.force ?? dataflowForce(false),
    filter: overrides?.filter === undefined ? none : some(overrides.filter),
    graph: some(graph),
    graphHash: none,
    tasks,
    executed: overrides?.executed ?? 0n,
    cached: overrides?.cached ?? 0n,
    failed: 0n,
    skipped: 0n,
    status: 'running',
    completedAt: none,
    error: none,
    versionVectors: new Map(),
    inputSnapshot: new Map(),
    taskOutputPaths: overrides?.taskOutputPaths ?? [],
    reexecuted: 0n,
    events: [],
    eventSeq: 0n,
  } as DataflowExecutionState;
}

/**
 * Create a minimal TaskState with the given status.
 */
function makeTaskState(name: string, status: TaskState['status']): TaskState {
  return {
    name,
    status,
    cached: none,
    outputHash: none,
    error: none,
    exitCode: none,
    startedAt: none,
    completedAt: none,
    duration: none,
    plan: none,
    execution: none,
  } as TaskState;
}

/** A task that completed with a result, counted as executed or cached. */
function makeCompleted(name: string, output: string, cached = false): TaskState {
  return {
    ...makeTaskState(name, 'completed'),
    cached: some(cached),
    outputHash: some(output),
    execution: some({ inputsHash: `inputs-${name}`, executionId: `execution-${name}` }),
  } as TaskState;
}

/** A storage no step of these tests reads: the steps they call decide from
 *  the run's state alone. */
const unread = new LocalStorage();

describe('stepYield', () => {
  const graph: DataflowGraph = {
    tasks: [
      { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.out_a', dependsOn: [] },
      { name: 'task-b', hash: 'hash-b', inputs: ['.out_a'], output: '.out_b', dependsOn: ['task-a'] },
      { name: 'task-c', hash: 'hash-c', inputs: ['.out_b'], output: '.out_c', dependsOn: ['task-b'] },
    ],
  };

  it('resets in_progress and deferred tasks to pending', () => {
    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'in_progress'));
    tasks.set('task-b', makeTaskState('task-b', 'deferred'));
    tasks.set('task-c', makeTaskState('task-c', 'pending'));

    const state = makeState(graph, tasks);
    const { reset } = stepYield(state);

    assert.deepStrictEqual(reset.sort(), ['task-a', 'task-b']);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'pending');
    assert.strictEqual(state.tasks.get('task-b')!.status, 'pending');
    assert.strictEqual(state.tasks.get('task-c')!.status, 'pending');
    // Yield is a pause, not a terminal state
    assert.strictEqual(state.status, 'running');
  });

  it('resets waiting tasks to pending too: a resumed run decides each again', () => {
    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'waiting'));
    tasks.set('task-b', makeTaskState('task-b', 'waiting'));
    tasks.set('task-c', makeTaskState('task-c', 'completed'));

    const state = makeState(graph, tasks);
    const { reset } = stepYield(state);

    assert.deepStrictEqual(reset.sort(), ['task-a', 'task-b']);
    assert.deepStrictEqual(waitingTasks(state), []);
    assert.strictEqual(state.tasks.get('task-c')!.status, 'completed');
  });

  it('leaves terminal and pending tasks untouched', () => {
    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'completed'));
    tasks.set('task-b', makeTaskState('task-b', 'failed'));
    tasks.set('task-c', makeTaskState('task-c', 'skipped'));

    const state = makeState(graph, tasks);
    const { reset } = stepYield(state);

    assert.deepStrictEqual(reset, []);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'completed');
    assert.strictEqual(state.tasks.get('task-b')!.status, 'failed');
    assert.strictEqual(state.tasks.get('task-c')!.status, 'skipped');
  });

  it('is idempotent', () => {
    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'in_progress'));

    const state = makeState(graph, tasks);
    stepYield(state);
    const { reset } = stepYield(state);

    assert.deepStrictEqual(reset, []);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'pending');
  });
});

describe('stepTaskForced', () => {
  const graph: DataflowGraph = {
    tasks: [
      { name: 'extract', hash: 'hash-a', inputs: ['.input'], output: '.out_a', dependsOn: [] },
      { name: 'model', hash: 'hash-b', inputs: ['.out_a'], output: '.out_b', dependsOn: ['extract'] },
      { name: 'report', hash: 'hash-c', inputs: ['.out_b'], output: '.out_c', dependsOn: ['model'] },
    ],
  };

  /** The tasks a run that forces `force`, under `filter`, forces. */
  function forced(force: boolean | string[], filter?: string): string[] {
    const tasks = new Map(graph.tasks.map((task) => [task.name, makeTaskState(task.name, 'pending')] as const));
    const state = makeState(graph, tasks, { force: dataflowForce(force), ...(filter !== undefined && { filter }) });
    return graph.tasks.map((task) => task.name).filter((name) => stepTaskForced(state, name));
  }

  it('forces no task, every task, or the tasks named, and no other', () => {
    assert.deepStrictEqual(forced(false), []);
    assert.deepStrictEqual(forced(true), ['extract', 'model', 'report']);
    assert.deepStrictEqual(forced(['model']), ['model'], 'a named task, and not the task it depends on, nor its dependent');
    assert.deepStrictEqual(forced(['report', 'extract']), ['extract', 'report']);
    assert.deepStrictEqual(forced([]), [], 'naming none forces none');
  });

  it('forces, under a filter, the filter\'s task for every task, and the tasks named in its run set', () => {
    assert.deepStrictEqual(forced(true, 'model'), ['model'], 'the filter\'s task, and not the one it depends on');
    assert.deepStrictEqual(forced(['extract'], 'model'), ['extract'], 'a task the filter\'s task depends on');
  });
});

describe('checkDataflowStart', () => {
  const graph: DataflowGraph = {
    tasks: [
      { name: 'extract', hash: 'hash-a', inputs: ['.input'], output: '.out_a', dependsOn: [] },
      { name: 'model', hash: 'hash-b', inputs: ['.out_a'], output: '.out_b', dependsOn: ['extract'] },
      { name: 'report', hash: 'hash-c', inputs: ['.out_b'], output: '.out_c', dependsOn: ['model'] },
    ],
  };

  it('refuses a start naming a task the graph lacks, or forcing one its filter leaves out, and lets any other through', () => {
    const notFound = (task: string) => (err: unknown) => err instanceof TaskNotFoundError && err.task === task;
    assert.throws(() => checkDataflowStart(graph, { filter: 'forecast' }), notFound('forecast'));
    assert.throws(() => checkDataflowStart(graph, { force: ['model', 'forecast'] }), notFound('forecast'));
    assert.throws(() => checkDataflowStart(graph, { force: ['report'], filter: 'model' }), (err: unknown) => err instanceof DataflowError
      && err.message === 'the run forces \'report\', which the filter \'model\' leaves out: a filtered run runs \'model\' and the tasks it depends on, and no other');
    for (const options of [{}, { force: true }, { force: ['report'] }, { force: ['extract'], filter: 'model' }, { filter: 'report' }]) {
      assert.doesNotThrow(() => checkDataflowStart(graph, options), JSON.stringify(options));
    }
  });

  it('is the check every entry exports, which a start makes', () => {
    assert.strictEqual(root.checkDataflowStart, checkDataflowStart);
    assert.strictEqual(portable.checkDataflowStart, checkDataflowStart);
  });
});

describe('tasks waiting on an unassigned input', () => {
  // input → a → b → c, b reading another input too; d reads that input alone
  const graph: DataflowGraph = {
    tasks: [
      { name: 'a', hash: 'hash-a', inputs: ['.input'], output: '.out_a', dependsOn: [] },
      { name: 'b', hash: 'hash-b', inputs: ['.out_a', '.other'], output: '.out_b', dependsOn: ['a'] },
      { name: 'c', hash: 'hash-c', inputs: ['.out_b'], output: '.out_c', dependsOn: ['b'] },
      { name: 'd', hash: 'hash-d', inputs: ['.other'], output: '.out_d', dependsOn: [] },
    ],
  };
  /** Every task pending, under `filter` when given. */
  const pending = (filter?: string): DataflowExecutionState => makeState(
    graph,
    new Map(graph.tasks.map((task) => [task.name, makeTaskState(task.name, 'pending')] as const)),
    filter === undefined ? undefined : { filter },
  );
  /** Each task's status, in the state's order. */
  const statuses = (state: DataflowExecutionState): [string, string][] =>
    [...state.tasks.values()].map((task) => [task.name, task.status]);

  it('leaves the task waiting, and its dependents with it, each naming what it waits on, no other task, and no event', () => {
    const state = pending();
    const { waiting } = stepTasksWaiting(state, 'a', ['.input']);
    assert.deepStrictEqual(waiting, [
      { task: 'a', inputs: ['.input'] },
      { task: 'b', inputs: ['.out_a'] },
      { task: 'c', inputs: ['.out_b'] },
    ]);
    assert.deepStrictEqual(waitingTasks(state), ['a', 'b', 'c']);
    assert.strictEqual(state.tasks.get('d')!.status, 'pending');
    assert.deepStrictEqual(state.events, []);
  });

  it('leaves no dependent outside the filter\'s run set waiting', () => {
    const state = pending('b');
    const { waiting } = stepTasksWaiting(state, 'a', ['.input']);
    assert.deepStrictEqual(waiting.map((each) => each.task), ['a', 'b']);
    assert.strictEqual(state.tasks.get('c')!.status, 'pending', 'outside the run set, as it was');
  });

  it('ends the run with them: complete once the rest has run, and finalized completed, counting them', () => {
    const state = pending();
    stepTasksWaiting(state, 'a', ['.input']);
    assert.strictEqual(stepIsComplete(state), false, 'd has yet to run');
    (state.tasks.get('d') as Mutable<TaskState>).status = 'completed';
    assert.strictEqual(stepIsComplete(state), true);
    const { result } = stepFinalize(state);
    assert.deepStrictEqual([result.success, result.waiting, result.failed, result.skipped], [true, 3, 0, 0]);
    assert.strictEqual(state.status, 'completed');
  });

  it('decides them again as an input is assigned, unless a task they read still waits', async () => {
    const state = pending();
    stepTasksWaiting(state, 'a', ['.input']);
    stepTasksWaiting(state, 'd', ['.other']);
    // `.other` assigned: d is decided again; b reads it too, but still waits
    // on a, and c on b
    const { due } = await stepTasksDue(unread, state, [{ path: '.other' }]);
    assert.deepStrictEqual(due, [], 'none had run');
    assert.deepStrictEqual(statuses(state), [['a', 'waiting'], ['b', 'waiting'], ['c', 'waiting'], ['d', 'pending']]);
    // `.input` assigned: a is decided again, which reads it; b and c wait on
    // it still, and are decided again as it completes
    await stepTasksDue(unread, state, [{ path: '.input' }]);
    assert.deepStrictEqual(statuses(state), [['a', 'pending'], ['b', 'waiting'], ['c', 'waiting'], ['d', 'pending']]);
  });

  it('decides a waiting dependent again as the task it waited on completes, unless another it reads still waits', () => {
    const state = pending();
    stepTasksWaiting(state, 'a', ['.input']);
    // `.input` assigned and a run, as the loop runs it once decided again
    (state.tasks.get('a') as Mutable<TaskState>).status = 'in_progress';
    const { result } = stepTaskCompleted(state, 'a', 'out-a', false, 10, { inputsHash: 'inputs-a', executionId: 'execution-a' }, new Map());
    assert.deepStrictEqual(result.newlyReady, ['b', 'd'], 'b, decided again, and d, which reads the other input alone');
    assert.deepStrictEqual(statuses(state), [['a', 'completed'], ['b', 'ready'], ['c', 'waiting'], ['d', 'ready']],
      'c waits on b still');
  });

  it('is the step every entry exports', () => {
    assert.strictEqual(root.stepTasksWaiting, stepTasksWaiting);
    assert.strictEqual(portable.stepTasksWaiting, stepTasksWaiting);
    assert.strictEqual(root.waitingTasks, waitingTasks);
    assert.strictEqual(portable.waitingTasks, waitingTasks);
  });
});

describe('split task stages', () => {
  const graph: DataflowGraph = {
    tasks: [
      { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.out_a', dependsOn: [] },
      { name: 'task-b', hash: 'hash-b', inputs: ['.input'], output: '.out_b', dependsOn: [] },
    ],
  };

  it('names each stage\'s plan in the task\'s state, and records the stages on the timeline', () => {
    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'in_progress'));
    const state = makeState(graph, tasks);

    stepTaskSplit(state, 'task-a', 'plan-pieces', 12);
    assert.deepStrictEqual(state.tasks.get('task-a')!.plan, some('plan-pieces'));
    stepTaskMergeStarted(state, 'task-a', 'plan-level-1', 1, 2, 3);
    assert.deepStrictEqual(state.tasks.get('task-a')!.plan, some('plan-level-1'));
    stepTaskMergeCompleted(state, 'task-a', 1, 2);

    assert.deepStrictEqual(state.events.map((event) => event.type), ['task_split', 'task_merge_started', 'task_merge_completed']);
    assert.deepStrictEqual(state.events.map((event) => event.value.seq), [1n, 2n, 3n]);
    const [split, started, completed] = state.events;
    assert.ok(split?.type === 'task_split' && started?.type === 'task_merge_started' && completed?.type === 'task_merge_completed');
    assert.strictEqual(split.value.pieces, 12n);
    assert.deepStrictEqual([started.value.level, started.value.levels, started.value.units], [1n, 2n, 3n]);
    assert.deepStrictEqual([completed.value.level, completed.value.levels], [1n, 2n]);
  });

  it('keeps the plan across a yield, and clears it when the task ends, recording the execution it completed with', () => {
    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'in_progress'));
    tasks.set('task-b', makeTaskState('task-b', 'in_progress'));
    const state = makeState(graph, tasks);
    stepTaskSplit(state, 'task-a', 'plan-a', 4);
    stepTaskSplit(state, 'task-b', 'plan-b', 4);

    stepYield(state);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'pending');
    assert.deepStrictEqual(state.tasks.get('task-a')!.plan, some('plan-a'));

    stepTaskCompleted(state, 'task-a', 'output-a', false, 10, { inputsHash: 'inputs-a', executionId: 'execution-a' }, new Map());
    stepTaskFailed(state, 'task-b', 'Piece 1 of 4 failed', 1, 10);
    assert.deepStrictEqual(state.tasks.get('task-a')!.plan, none);
    assert.deepStrictEqual(state.tasks.get('task-b')!.plan, none);
    assert.deepStrictEqual(state.tasks.get('task-a')!.execution, some({ inputsHash: 'inputs-a', executionId: 'execution-a' }));
    assert.deepStrictEqual(state.tasks.get('task-b')!.execution, none);
  });
});

describe('stepTasksDue', () => {
  // input → a → b: b reads a's output alone
  const graph: DataflowGraph = {
    tasks: [
      { name: 'a', hash: 'hash-a', inputs: ['.input'], output: '.a_out', dependsOn: [] },
      { name: 'b', hash: 'hash-b', inputs: ['.a_out'], output: '.b_out', dependsOn: ['a'] },
    ],
  };

  /** A run whose input stands at `input`: a holds a result made from `aFrom`,
   *  in the status given, and b one made from a's. */
  function run(input: string, aFrom: string, aStatus: TaskState['status'] = 'completed', aCached = false): DataflowExecutionState {
    const state = makeState(graph, new Map([
      ['a', { ...makeCompleted('a', 'a-out', aCached), status: aStatus } as TaskState],
      ['b', makeCompleted('b', 'b-out')],
    ]), { executed: aCached ? 1n : 2n, cached: aCached ? 1n : 0n });
    state.inputSnapshot.set('.input', input);
    state.versionVectors.set('.input', new Map([['.input', input]]));
    state.versionVectors.set('.a_out', new Map([['.input', aFrom]]));
    state.versionVectors.set('.b_out', new Map([['.input', aFrom]]));
    return state;
  }

  it('puts a completed task that reads the changed input back to pending, keeping its result and its count, and counts it a re-execution', async () => {
    const state = run('v2', 'v1');
    const { due, events } = await stepTasksDue(unread, state, [{ path: '.input' }]);

    assert.deepStrictEqual(due, ['a']);
    const a = state.tasks.get('a')!;
    assert.strictEqual(a.status, 'pending');
    assert.deepStrictEqual(a.outputHash, some('a-out'), 'its result stays, for its dependents to read');
    assert.deepStrictEqual(a.execution, some({ inputsHash: 'inputs-a', executionId: 'execution-a' }));
    assert.deepStrictEqual(state.versionVectors.get('.a_out'), new Map([['.input', 'v1']]), "and so do its output's versions");
    assert.deepStrictEqual([state.executed, state.reexecuted], [2n, 1n], 'it is counted by the result it holds');
    assert.strictEqual(events.length, 1);
    assert.ok(events[0]!.type === 'task_invalidated');
    assert.deepStrictEqual([events[0].value.task, events[0].value.reason], ['a', 'input changed: .input']);
  });

  it('leaves its dependents as they are: a change travels a step at a time, and they are asked once its next result lands', async () => {
    const state = run('v2', 'v1');
    await stepTasksDue(unread, state, [{ path: '.input' }]);
    assert.strictEqual(state.tasks.get('b')!.status, 'completed', 'b reads a, not the input');
    assert.deepStrictEqual(stepGetReady(state), ['a'], 'a is ready; b is not due');

    // a's next result lands, made from v2: b would now read another result
    (state.tasks.get('a') as Mutable<TaskState>).status = 'in_progress';
    stepTaskCompleted(state, 'a', 'a-out-2', false, 10, { inputsHash: 'inputs-a2', executionId: 'execution-a2' }, new Map([['.input', 'v2']]));
    const { due } = await stepTasksDue(unread, state, [{ path: '.a_out' }]);
    assert.deepStrictEqual(due, ['b']);
    assert.deepStrictEqual(state.tasks.get('b')!.outputHash, some('b-out'));
  });

  it('leaves a completed task whose inputs stand where its result was made', async () => {
    const state = run('v1', 'v1');
    const { due, events } = await stepTasksDue(unread, state, [{ path: '.input' }, { path: '.a_out' }]);
    assert.deepStrictEqual([due, events], [[], []]);
    assert.deepStrictEqual([state.tasks.get('a')!.status, state.tasks.get('b')!.status], ['completed', 'completed']);
  });

  it('keeps a task due again counted by the result it holds, until what settles it next counts it: its next result, its failure or its skip', async () => {
    // a's result came from the cache, and b's ran
    const state = run('v2', 'v1', 'completed', true);
    await stepTasksDue(unread, state, [{ path: '.input' }]);
    assert.deepStrictEqual([state.cached, state.executed], [1n, 1n], 'due again, a is still counted as it landed');

    // a's next result runs: its count moves from cached to executed
    (state.tasks.get('a') as Mutable<TaskState>).status = 'in_progress';
    stepTaskCompleted(state, 'a', 'a-out-2', false, 10, { inputsHash: 'inputs-a2', executionId: 'execution-a2' }, new Map([['.input', 'v2']]));
    assert.deepStrictEqual([state.cached, state.executed], [0n, 2n]);

    // b is due again, and fails: it is counted as failed, and no longer by the result it held
    (state.tasks.get('b') as Mutable<TaskState>).status = 'in_progress';
    stepTaskFailed(state, 'b', 'the model did not converge', 1, 10);
    assert.deepStrictEqual([state.executed, state.failed], [1n, 1n]);

    // a is due again, and skipped: counted as skipped alone
    (state.tasks.get('a') as Mutable<TaskState>).status = 'pending';
    stepTasksSkipped(state, ['a'], 'b');
    assert.deepStrictEqual([state.cached, state.executed, state.skipped], [0n, 0n, 1n]);
  });

  it('leaves a task in flight, which is asked as it lands, and one failed, skipped or pending', async () => {
    for (const status of ['in_progress', 'failed', 'skipped', 'pending', 'ready'] as const) {
      const state = run('v2', 'v1', status);
      const { due, events } = await stepTasksDue(unread, state, [{ path: '.input' }]);
      assert.deepStrictEqual([due, events], [[], []], status);
      assert.strictEqual(state.tasks.get('a')!.status, status);
    }
  });

  it('decides a deferred task again, without counting it a re-execution', async () => {
    const state = run('v2', 'v1', 'deferred');
    const { due } = await stepTasksDue(unread, state, [{ path: '.input' }]);
    assert.deepStrictEqual(due, []);
    assert.strictEqual(state.tasks.get('a')!.status, 'pending');
    assert.strictEqual(state.reexecuted, 0n);
  });

  it('is the step every entry exports', () => {
    assert.strictEqual(root.stepTasksDue, stepTasksDue);
    assert.strictEqual(portable.stepTasksDue, stepTasksDue);
  });

  it('asks every completed task as a run resumes, whichever input moved: one that would read others is due, and no other is touched', async () => {
    // The snapshot moved to v2 before the run yielded, and a was never asked
    const state = run('v2', 'v1');
    const { due, events } = await stepResumedTasksDue(unread, state);
    assert.deepStrictEqual(due, ['a'], 'b reads a, whose result stands: it is asked once a lands');
    assert.ok(events[0]?.type === 'task_invalidated');
    assert.deepStrictEqual([events.length, events[0].value.task, events[0].value.reason], [1, 'a', 'its inputs moved before the run resumed']);
    assert.deepStrictEqual([state.tasks.get('a')!.status, state.tasks.get('a')!.outputHash], ['pending', some('a-out')], 'a keeps its result');
    assert.deepStrictEqual([state.executed, state.reexecuted], [2n, 1n]);

    // A run whose results stand where they were made finds none due, and a task that is not completed is left
    assert.deepStrictEqual(await stepResumedTasksDue(unread, run('v1', 'v1')), { due: [], events: [] });
    for (const status of ['in_progress', 'failed', 'skipped', 'pending', 'ready', 'waiting'] as const) {
      const other = run('v2', 'v1', status);
      assert.deepStrictEqual((await stepResumedTasksDue(unread, other)).due, [], status);
      assert.strictEqual(other.tasks.get('a')!.status, status);
    }
    assert.strictEqual(root.stepResumedTasksDue, stepResumedTasksDue);
    assert.strictEqual(portable.stepResumedTasksDue, stepResumedTasksDue);
  });
});

describe('stepTaskDueAgain', () => {
  const graph: DataflowGraph = {
    tasks: [{ name: 'a', hash: 'hash-a', inputs: ['.input'], output: '.a_out', dependsOn: [] }],
  };

  /** a's result has just landed, made from `launched`, the input now at `input`. */
  function landed(input: string, launched: string): DataflowExecutionState {
    const state = makeState(graph, new Map([['a', makeTaskState('a', 'in_progress')]]));
    state.versionVectors.set('.input', new Map([['.input', input]]));
    stepTaskCompleted(state, 'a', 'a-out', false, 10, { inputsHash: 'inputs-a', executionId: 'execution-a' }, new Map([['.input', launched]]));
    return state;
  }

  it('lands the result, and puts its task back to pending when its inputs moved while it ran', async () => {
    const state = landed('v2', 'v1');
    assert.deepStrictEqual(state.versionVectors.get('.a_out'), new Map([['.input', 'v1']]), 'the result is of the versions it was launched with');

    const event = await stepTaskDueAgain(unread, state, 'a');
    assert.ok(event?.type === 'task_invalidated');
    assert.strictEqual(event.value.reason, 'its inputs moved while it ran');
    const a = state.tasks.get('a')!;
    assert.strictEqual(a.status, 'pending');
    assert.deepStrictEqual(a.outputHash, some('a-out'), 'the result that landed stays');
    assert.deepStrictEqual([state.executed, state.reexecuted], [1n, 1n], 'and counts, until the next lands');
  });

  it('leaves a task whose inputs stand where it was launched, and one that is not completed', async () => {
    const state = landed('v1', 'v1');
    assert.strictEqual(await stepTaskDueAgain(unread, state, 'a'), null);
    assert.strictEqual(state.tasks.get('a')!.status, 'completed');

    const failed = landed('v2', 'v1');
    (failed.tasks.get('a') as Mutable<TaskState>).status = 'failed';
    assert.strictEqual(await stepTaskDueAgain(unread, failed, 'a'), null);
  });
});

describe('stepGetReady', () => {
  // a → b → c
  const graph: DataflowGraph = {
    tasks: [
      { name: 'a', hash: 'hash-a', inputs: ['.input'], output: '.a_out', dependsOn: [] },
      { name: 'b', hash: 'hash-b', inputs: ['.a_out'], output: '.b_out', dependsOn: ['a'] },
      { name: 'c', hash: 'hash-c', inputs: ['.b_out'], output: '.c_out', dependsOn: ['b'] },
    ],
  };

  it('readies a task once every task it reads holds a result, whatever that task\'s status, save one that waits, failed or was skipped', () => {
    const ready = (a: TaskState): string[] => stepGetReady(makeState(graph, new Map([
      ['a', a], ['b', makeTaskState('b', 'pending')], ['c', makeTaskState('c', 'pending')],
    ])));
    assert.deepStrictEqual(ready(makeTaskState('a', 'in_progress')), [], 'no result yet in the run');
    assert.deepStrictEqual(ready(makeCompleted('a', 'a-out')), ['b']);
    assert.deepStrictEqual(ready({ ...makeCompleted('a', 'a-out'), status: 'in_progress' } as TaskState), ['b'], 'running again: b runs on the result it holds');
    assert.deepStrictEqual(ready({ ...makeCompleted('a', 'a-out'), status: 'pending' } as TaskState), ['a', 'b'], 'due again');
    for (const status of ['waiting', 'failed', 'skipped'] as const) {
      assert.deepStrictEqual(ready({ ...makeCompleted('a', 'a-out'), status } as TaskState).filter((name) => name !== 'a'), [], status);
    }
  });
});

describe('stepDetectInputChanges', () => {
  let testRepo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    testRepo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(testRepo);
  });

  async function createCommandIr(repoPath: string, parts: string[]): Promise<string> {
    const commandFn = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      ($, inputs, output) => {
        const result: (string | ReturnType<typeof inputs.get>)[] = [];
        for (const part of parts) {
          if (part === '{input}' || part === '{input0}') {
            result.push(inputs.get(0n));
          } else if (part === '{output}') {
            result.push(output);
          } else {
            result.push(part);
          }
        }
        return result;
      }
    );
    const ir = commandFn.toIR().ir;
    const encoder = encodeBeast2For(IRType);
    return objectWrite(repoPath, encoder(ir));
  }

  async function createPackageWithTasks(
    repoPath: string,
    tasks: Array<{
      name: string;
      command: string[];
      inputs: TreePath[];
      output: TreePath;
    }>,
    structure: Structure,
  ): Promise<Map<string, string>> {
    const taskEncoder = encodeBeast2For(TaskObjectType);
    const tasksMap = new Map<string, string>();

    for (const t of tasks) {
      const commandIrHash = await createCommandIr(repoPath, t.command);
      const taskObj = {
        kind: TASK_OBJECT_KIND,
        body: variant('command', { commandIr: commandIrHash }),
        runner: variant('custom', { command: [] }),
        inputs: t.inputs.map((path) => ({ path, index: none, partition: none })),
        output: { path: t.output, kind: variant('value', null) },
        role: variant('data', null),
        environment: none,
      };
      const taskHash = await objectWrite(repoPath, taskEncoder(taskObj));
      tasksMap.set(t.name, taskHash);
    }

    const pkgEncoder = encodeBeast2For(PackageObjectType);
    const pkgObj = {
      data: {
        structure,
        refs: new Map(),
      },
      tasks: tasksMap,
      functions: new Map(),
      records: new Map(), sources: new Map(),
    };
    const pkgHash = await objectWrite(repoPath, pkgEncoder(pkgObj));
    await storage.refs.packageWrite(repoPath, 'test', '1.0.0', pkgHash);

    return tasksMap;
  }

  it('uses cached structure when provided', async () => {
    const structure = writableStrings(['input', 'output']);

    const inputPath: TreePath = [variant('field', 'input')];
    const outputPath: TreePath = [variant('field', 'output')];

    await createPackageWithTasks(
      testRepo,
      [{ name: 'task-a', command: ['echo'], inputs: [inputPath], output: outputPath }],
      structure,
    );
    await workspaceDeploy(storage, testRepo, 'test-ws', 'test', '1.0.0');
    await workspaceSetDataset(storage, testRepo, 'test-ws', inputPath, 'test', StringType);

    // Build a minimal state that mirrors what stepInitialize would produce
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };
    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'pending'));

    const state = makeState(graph, tasks, {
      repo: testRepo,
      workspace: 'test-ws',
      taskOutputPaths: ['.output'],
    });
    state.inputSnapshot.set('.input', 'initial-hash');

    // Call without cached structure (reads from storage)
    const result1 = await stepDetectInputChanges(storage, state);

    // Reset snapshot to same value
    state.inputSnapshot.set('.input', 'initial-hash');

    // Call with cached structure (should produce the same results)
    const result2 = await stepDetectInputChanges(storage, state, structure);

    assert.ok(result1.changes.length > 0, 'Expected at least one change detected');
    assert.strictEqual(result1.changes.length, result2.changes.length);
    assert.strictEqual(result1.changes[0]!.path, result2.changes[0]!.path);
    assert.strictEqual(result1.changes[0]!.newHash, result2.changes[0]!.newHash);
  });
});

describe('stepTaskCommits', () => {
  let testRepo: string;
  let storage: StorageBackend;

  // The task reads two results, x and y, and the record itself
  const graph: DataflowGraph = {
    tasks: [
      { name: 'x', hash: 'hash-x', inputs: ['.records.orders', '.rates'], output: '.x_out', dependsOn: [] },
      { name: 'y', hash: 'hash-y', inputs: ['.records.orders', '.rates'], output: '.y_out', dependsOn: [] },
      { name: 'plan', hash: 'hash-plan', inputs: ['.x_out', '.y_out'], output: '.plan_out', dependsOn: ['x', 'y'] },
      { name: 'direct', hash: 'hash-direct', inputs: ['.rates', '.x_out'], output: '.direct_out', dependsOn: ['x'] },
    ],
  };

  beforeEach(async () => {
    testRepo = createTestRepo();
    storage = new LocalStorage();
    // A workspace whose package declares one record, `orders`
    const record = await objectWrite(testRepo, encodeBeast2For(RecordObjectType)({
      path: 'records/orders', mutations: new Map(), indexes: new Map(), migrations: [],
    }));
    const pkg = await objectWrite(testRepo, encodeBeast2For(PackageObjectType)({
      data: { structure: writableStrings(['rates']), refs: new Map() },
      tasks: new Map(),
      functions: new Map(),
      records: new Map([['orders', record]]),
      sources: new Map(),
    }));
    await storage.refs.workspaceWrite(testRepo, 'test-ws', encodeBeast2For(WorkspaceRecordType)(some({
      packageName: 'test', packageVersion: '1.0.0', packageHash: pkg, deployedAt: new Date(), currentRunId: none,
    })));
  });

  afterEach(() => {
    removeTestRepo(testRepo);
  });

  /** A run in which x's result was made from `x` and y's from `y`: each the
   *  versions of the record and of the plain input. */
  function run(x: { orders: string; rates: string }, y: { orders: string; rates: string }): DataflowExecutionState {
    const state = makeState(graph, new Map(graph.tasks.map((task) => [task.name, makeTaskState(task.name, 'pending')] as const)), {
      repo: testRepo, workspace: 'test-ws',
    });
    state.versionVectors.set('.rates', new Map([['.rates', y.rates]]));
    state.versionVectors.set('.x_out', new Map([['.records.orders', x.orders], ['.rates', x.rates]]));
    state.versionVectors.set('.y_out', new Map([['.records.orders', y.orders], ['.rates', y.rates]]));
    return state;
  }

  /** Stores a commit of the record whose parent is `parent`, and answers its hash. */
  const commit = (parent: string | null, mutation: string): Promise<string> => objectWrite(testRepo, encodeBeast2For(RecordCommitType)({
    parent: parent === null ? none : some(parent), state: 'state', mutation, args: none, actor: 'test', at: new Date(), delta: none,
  }));

  it('reads each root at the version its inputs agree on, leaving out a vector\'s reserved slots', async () => {
    const state = run({ orders: 'c1', rates: 'r1' }, { orders: 'c1', rates: 'r1' });
    state.versionVectors.get('.x_out')!.set('$load.erp', 'a-delivery');
    state.versionVectors.get('.y_out')!.set('$load.erp', 'another');
    assert.deepStrictEqual(await stepTaskCommits(storage, state, 'plan'), {
      kind: 'commits', versions: new Map([['.records.orders', 'c1'], ['.rates', 'r1']]),
    });
  });

  it('reads a record its inputs name at different commits as of the older, by the order the run took its snapshots', async () => {
    const c1 = await commit(null, '$init');
    const c2 = await commit(c1, 'edit');
    const state = run({ orders: c1, rates: 'r1' }, { orders: c2, rates: 'r1' });
    state.inputSnapshot.set('.records.orders', c1);
    dataflowSnapshotTaken(state, '.records.orders', c2);
    assert.deepStrictEqual(await stepTaskCommits(storage, state, 'plan'), {
      kind: 'commits', versions: new Map([['.records.orders', c1], ['.rates', 'r1']]),
    });
    // Whichever input names the older
    const other = run({ orders: c2, rates: 'r1' }, { orders: c1, rates: 'r1' });
    other.inputSnapshot.set('.records.orders', c1);
    dataflowSnapshotTaken(other, '.records.orders', c2);
    const at = await stepTaskCommits(storage, other, 'plan');
    assert.ok(at.kind === 'commits');
    assert.strictEqual(at.versions.get('.records.orders'), c1);
  });

  it('takes a commit the run never took a snapshot of for older than those it took, and orders two such by the record\'s history', async () => {
    const before = await commit(null, '$init');
    const between = await commit(before, 'edit');
    const first = await commit(between, 'edit');
    const cut = await commit(null, 'a commit a compaction cut');
    const state = run({ orders: before, rates: 'r1' }, { orders: first, rates: 'r1' });
    // A resumed run: its first snapshot is the one its state holds
    state.inputSnapshot.set('.records.orders', first);

    assert.strictEqual(await recordCommitOrder(storage, state, '.records.orders', before, first), before, 'never taken: the older');
    assert.strictEqual(await recordCommitOrder(storage, state, '.records.orders', first, between), between);
    assert.strictEqual(await recordCommitOrder(storage, state, '.records.orders', before, between), before, 'the first met walking back is the newer');
    assert.strictEqual(await recordCommitOrder(storage, state, '.records.orders', between, before), before, 'whichever is asked first');
    assert.strictEqual(await recordCommitOrder(storage, state, '.records.orders', cut, between), cut, 'one never met is the older');
    assert.strictEqual(await recordCommitOrder(storage, state, '.records.orders', first, first), first);

    const at = await stepTaskCommits(storage, state, 'plan');
    assert.ok(at.kind === 'commits');
    assert.strictEqual(at.versions.get('.records.orders'), before);
  });

  it('lets go of the versions older than every one the run names as it takes a newer snapshot, and orders one let go as the older still', async () => {
    // A record edited c1 to c21, a commit at a time, and two commits outside its history
    const commits: string[] = [];
    for (let i = 1; i <= 21; i++) commits.push(await commit(commits.at(-1) ?? null, 'edit'));
    const c = (n: number): string => commits[n - 1]!;
    const [apart, elsewhere] = [await commit(null, 'apart'), await commit(null, 'elsewhere')];
    const state = run({ orders: c(1), rates: 'r1' }, { orders: c(1), rates: 'r1' });
    state.inputSnapshot.set('.records.orders', c(1));
    state.inputSnapshot.set('.rates', 'r1');
    /** The run takes a snapshot of the record, as a look for changed inputs does */
    const take = (version: string): void => {
      dataflowSnapshotTaken(state, '.records.orders', version);
      state.inputSnapshot.set('.records.orders', version);
      state.versionVectors.set('.records.orders', new Map([['.records.orders', version]]));
    };

    // The run takes c2 to c20 while both results stay made at c1: it holds each, and the order of a pair it never took
    for (let n = 2; n <= 20; n++) take(c(n));
    assert.strictEqual(await recordCommitOrder(storage, state, '.records.orders', apart, elsewhere), [apart, elsewhere].sort()[0]);
    assert.deepStrictEqual(dataflowRootsHeld(state), { versions: 21, pairs: 1 }, 'c1 to c20, and r1');

    // Both results land on c19: the next snapshot lets go of every version before it, and of the pair
    state.versionVectors.set('.x_out', new Map([['.records.orders', c(19)], ['.rates', 'r1']]));
    state.versionVectors.set('.y_out', new Map([['.records.orders', c(19)], ['.rates', 'r1']]));
    take(c(21));
    assert.deepStrictEqual(dataflowRootsHeld(state), { versions: 4, pairs: 0 }, 'c19 to c21, and r1');

    // A result made at a version let go — a task's in flight, launched at c5 — is the older; two let go are ordered
    // by the record's history
    assert.strictEqual(await recordCommitOrder(storage, state, '.records.orders', c(5), c(21)), c(5));
    assert.strictEqual(await recordCommitOrder(storage, state, '.records.orders', c(20), c(19)), c(19));
    assert.strictEqual(await recordCommitOrder(storage, state, '.records.orders', c(7), c(4)), c(4));
  });

  it('reads a record as of the oldest commit its inputs name that the store still holds, or as the run\'s snapshot holds it where none is', async () => {
    const first = await commit(null, '$init');
    // Two commits a compaction cut and gc swept: the store holds neither
    const swept = (what: string): string => createHash('sha256').update(what).digest('hex');
    const [goneA, goneB] = [swept('a commit gc swept'), swept('another')];

    // x's result was made at a commit swept, y's at one the store holds: the task passes over the first
    const state = run({ orders: goneA, rates: 'r1' }, { orders: first, rates: 'r1' });
    state.inputSnapshot.set('.records.orders', first);
    assert.deepStrictEqual(await stepTaskCommits(storage, state, 'plan'), {
      kind: 'commits', versions: new Map([['.records.orders', first], ['.rates', 'r1']]),
    });

    // Both were made at commits swept: the task reads the record as the run's snapshot holds it
    const both = run({ orders: goneA, rates: 'r1' }, { orders: goneB, rates: 'r1' });
    both.inputSnapshot.set('.records.orders', first);
    assert.deepStrictEqual(await stepTaskCommits(storage, both, 'plan'), {
      kind: 'commits', versions: new Map([['.records.orders', first], ['.rates', 'r1']]),
    });
  });

  it('takes no order from a read of the history that failed: it is raised, and the history is read again by the next to ask', async () => {
    const before = await commit(null, '$init');
    const between = await commit(before, 'edit');
    const first = await commit(between, 'edit');
    const state = run({ orders: before, rates: 'r1' }, { orders: first, rates: 'r1' });
    state.inputSnapshot.set('.records.orders', first);

    // The store fails one read of the history: no commit is missing from it
    const read = storage.objects.read.bind(storage.objects);
    let failed = false;
    storage.objects.read = async (repo, hash) => {
      if (!failed && hash === first) {
        failed = true;
        throw new Error('the store went away');
      }
      return read(repo, hash);
    };
    try {
      await assert.rejects(recordCommitOrder(storage, state, '.records.orders', before, between), { message: 'the store went away' });
      assert.strictEqual(failed, true);
      assert.strictEqual(await recordCommitOrder(storage, state, '.records.orders', before, between), before, 'asked again, it reads the history');
    } finally {
      storage.objects.read = read;
    }
  });

  it('defers a task whose inputs read a plain input at two values, naming the input and the inputs that read it, a direct read first', async () => {
    const state = run({ orders: 'c1', rates: 'r1' }, { orders: 'c1', rates: 'r2' });
    assert.deepStrictEqual(await stepTaskCommits(storage, state, 'plan'), {
      kind: 'deferred', reason: { kind: 'plain', input: '.rates', through: ['x', 'y'] },
    });
    // `direct` reads the input itself, at r2, and x's result, made from r1
    assert.deepStrictEqual(await stepTaskCommits(storage, state, 'direct'), {
      kind: 'deferred', reason: { kind: 'plain', input: '.rates', through: ['.rates', 'x'] },
    });
  });

  it('names the input a deferral is for, which its event records', () => {
    assert.strictEqual(deferralPath({ kind: 'plain', input: '.rates', through: ['x', 'y'] }), '.rates');
  });

  it('throws for a task the graph lacks, and is the step every entry exports', async () => {
    const state = run({ orders: 'c1', rates: 'r1' }, { orders: 'c1', rates: 'r1' });
    await assert.rejects(stepTaskCommits(storage, state, 'nonexistent'), { message: /nonexistent.*not found/ });
    assert.strictEqual(root.stepTaskCommits, stepTaskCommits);
    assert.strictEqual(portable.stepTaskCommits, stepTaskCommits);
    assert.strictEqual(root.recordCommitOrder, recordCommitOrder);
    assert.strictEqual(portable.recordCommitOrder, recordCommitOrder);
  });
});

describe('stepTaskCompleted', () => {
  // b, c → k; d reads the input alone
  const graph: DataflowGraph = {
    tasks: [
      { name: 'b', hash: 'hash-b', inputs: ['.input'], output: '.b_out', dependsOn: [] },
      { name: 'c', hash: 'hash-c', inputs: ['.input'], output: '.c_out', dependsOn: [] },
      { name: 'k', hash: 'hash-k', inputs: ['.b_out', '.c_out'], output: '.k_out', dependsOn: ['b', 'c'] },
      { name: 'd', hash: 'hash-d', inputs: ['.input'], output: '.d_out', dependsOn: [] },
    ],
  };
  const execution = { inputsHash: 'inputs-c', executionId: 'execution-c' };

  it('decides its deferred dependents again: pending, and ready once their inputs are all complete', () => {
    const state = makeState(graph, new Map([
      ['b', makeCompleted('b', 'b-out')],
      ['c', makeTaskState('c', 'in_progress')],
      ['k', makeTaskState('k', 'deferred')],
      ['d', makeTaskState('d', 'deferred')],
    ]));
    const { result } = stepTaskCompleted(state, 'c', 'c-v2', false, 10, execution, new Map());
    assert.deepStrictEqual(result.newlyReady, ['k']);
    assert.strictEqual(state.tasks.get('k')!.status, 'ready');
    assert.strictEqual(state.tasks.get('d')!.status, 'deferred', 'a task that does not read the output stays deferred');
  });

  it('leaves a deferred dependent pending while another of its inputs is still to complete', () => {
    const state = makeState(graph, new Map([
      ['b', makeTaskState('b', 'in_progress')],
      ['c', makeTaskState('c', 'in_progress')],
      ['k', makeTaskState('k', 'deferred')],
      ['d', makeTaskState('d', 'completed')],
    ]));
    const { result } = stepTaskCompleted(state, 'c', 'c-v2', false, 10, execution, new Map());
    assert.deepStrictEqual(result.newlyReady, []);
    assert.strictEqual(state.tasks.get('k')!.status, 'pending');
  });
});
