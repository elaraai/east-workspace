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
import { some, none, variant, StringType, encodeBeast2For } from '@elaraai/east';
import { EXECUTION_STATE_VERSION, type TreePath, type Structure } from '@elaraai/e3-types';
import {
  stepInvalidateTasks,
  stepDetectInputChanges,
  stepCheckVersionConsistency,
  stepYield,
  stepTaskSplit,
  stepTaskMergeStarted,
  stepTaskMergeCompleted,
  stepTaskCompleted,
  stepTaskFailed,
} from './steps.js';
import type { DataflowExecutionState, TaskState, Mutable } from './types.js';
import type { DataflowGraph } from '../dataflow.js';
import { createTestRepo, removeTestRepo } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import { workspaceDeploy } from '../workspaces.js';
import { workspaceSetDataset } from '../trees.js';
import { objectWrite } from '../storage/local/LocalObjectStore.js';
import {
  PackageObjectType,
  TASK_OBJECT_KIND,
  TaskObjectType,
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
  }>,
): DataflowExecutionState {
  return {
    version: EXECUTION_STATE_VERSION,
    id: 'test-1',
    repo: overrides?.repo ?? '/tmp/test-repo',
    workspace: overrides?.workspace ?? 'test-ws',
    startedAt: new Date(),
    force: false,
    filter: none,
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
  } as TaskState;
}

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

  it('keeps the plan across a yield, and clears it when the task ends', () => {
    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'in_progress'));
    tasks.set('task-b', makeTaskState('task-b', 'in_progress'));
    const state = makeState(graph, tasks);
    stepTaskSplit(state, 'task-a', 'plan-a', 4);
    stepTaskSplit(state, 'task-b', 'plan-b', 4);

    stepYield(state);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'pending');
    assert.deepStrictEqual(state.tasks.get('task-a')!.plan, some('plan-a'));

    stepTaskCompleted(state, 'task-a', 'output-a', false, 10);
    stepTaskFailed(state, 'task-b', 'Piece 1 of 4 failed', 1, 10);
    assert.deepStrictEqual(state.tasks.get('task-a')!.plan, none);
    assert.deepStrictEqual(state.tasks.get('task-b')!.plan, none);
  });
});

describe('stepInvalidateTasks', () => {
  it('does not invalidate failed tasks', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'failed'));

    const state = makeState(graph, tasks);

    const { invalidated } = stepInvalidateTasks(state, [{ path: '.input' }]);

    assert.deepStrictEqual(invalidated, []);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'failed');
  });

  it('resets completed tasks to pending', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    const completedTask = makeTaskState('task-a', 'completed');
    // Mark as executed (not cached) so the counter decrement path is exercised
    (completedTask as Mutable<TaskState>).cached = some(false);
    (completedTask as Mutable<TaskState>).outputHash = some('old-output');
    tasks.set('task-a', completedTask);

    const state = makeState(graph, tasks, { executed: 1n });

    const { invalidated } = stepInvalidateTasks(state, [{ path: '.input' }]);

    assert.deepStrictEqual(invalidated, ['task-a']);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'pending');
    assert.strictEqual(state.executed, 0n);
  });

  it('resets deferred tasks to pending without counting as invalidated', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'deferred'));

    const state = makeState(graph, tasks);

    const { invalidated } = stepInvalidateTasks(state, [{ path: '.input' }]);

    assert.deepStrictEqual(invalidated, []);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'pending');
  });

  it('does not invalidate skipped tasks', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'skipped'));

    const state = makeState(graph, tasks);

    const { invalidated } = stepInvalidateTasks(state, [{ path: '.input' }]);

    assert.deepStrictEqual(invalidated, []);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'skipped');
  });

  it('does not invalidate pending tasks', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'pending'));

    const state = makeState(graph, tasks);

    const { invalidated } = stepInvalidateTasks(state, [{ path: '.input' }]);

    assert.deepStrictEqual(invalidated, []);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'pending');
  });

  it('does not invalidate in-progress tasks', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'in_progress'));

    const state = makeState(graph, tasks);

    const { invalidated } = stepInvalidateTasks(state, [{ path: '.input' }]);

    assert.deepStrictEqual(invalidated, []);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'in_progress');
  });

  it('decrements cached counter when invalidating cached task', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.input'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    const completedTask = makeTaskState('task-a', 'completed');
    (completedTask as Mutable<TaskState>).cached = some(true);
    (completedTask as Mutable<TaskState>).outputHash = some('old-output');
    tasks.set('task-a', completedTask);

    const state = makeState(graph, tasks, { cached: 1n, executed: 1n });

    const { invalidated } = stepInvalidateTasks(state, [{ path: '.input' }]);

    assert.deepStrictEqual(invalidated, ['task-a']);
    assert.strictEqual(state.tasks.get('task-a')!.status, 'pending');
    assert.strictEqual(state.cached, 0n);
    // executed counter should not be decremented for cached tasks
    assert.strictEqual(state.executed, 1n);
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
        inputs: t.inputs.map((path) => ({ path, partition: none })),
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
    const structure: Structure = {
      type: 'struct',
      value: new Map([
        ['input', { type: 'value', value: { type: StringType, writable: true } }],
        ['output', { type: 'value', value: { type: StringType, writable: true } }],
      ]),
    } as unknown as Structure;

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

describe('stepCheckVersionConsistency', () => {
  it('returns consistent for non-conflicting version vectors', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.x', '.y'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'pending'));

    const state = makeState(graph, tasks);
    // Both inputs agree on the shared key '.root'
    state.versionVectors.set('.x', new Map([
      ['.root', 'hash-1'],
    ]));
    state.versionVectors.set('.y', new Map([
      ['.root', 'hash-1'],
      ['.other', 'hash-2'],
    ]));

    const result = stepCheckVersionConsistency(state, 'task-a');

    assert.strictEqual(result.consistent, true);
    assert.ok('mergedVV' in result);
    assert.strictEqual(result.mergedVV.get('.root'), 'hash-1');
    assert.strictEqual(result.mergedVV.get('.other'), 'hash-2');
  });

  it('returns inconsistent for conflicting version vectors', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.x', '.y'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'pending'));

    const state = makeState(graph, tasks);
    // Inputs disagree on '.root' — different hashes
    state.versionVectors.set('.x', new Map([
      ['.root', 'hash-1'],
    ]));
    state.versionVectors.set('.y', new Map([
      ['.root', 'hash-DIFFERENT'],
    ]));

    const result = stepCheckVersionConsistency(state, 'task-a');

    assert.strictEqual(result.consistent, false);
    assert.ok('conflictPath' in result);
    assert.strictEqual(result.conflictPath, '.root');
  });

  it('treats missing version vectors as consistent', () => {
    const graph: DataflowGraph = {
      tasks: [
        { name: 'task-a', hash: 'hash-a', inputs: ['.x', '.y'], output: '.output', dependsOn: [] },
      ],
    };

    const tasks = new Map<string, TaskState>();
    tasks.set('task-a', makeTaskState('task-a', 'pending'));

    const state = makeState(graph, tasks);
    // Only set VV for one input — the other defaults to empty map
    state.versionVectors.set('.x', new Map([
      ['.root', 'hash-1'],
    ]));

    const result = stepCheckVersionConsistency(state, 'task-a');

    assert.strictEqual(result.consistent, true);
    assert.ok('mergedVV' in result);
    assert.strictEqual(result.mergedVV.get('.root'), 'hash-1');
  });

  it('throws for task not found in graph', () => {
    const graph: DataflowGraph = {
      tasks: [],
    };

    const tasks = new Map<string, TaskState>();
    const state = makeState(graph, tasks);

    assert.throws(
      () => stepCheckVersionConsistency(state, 'nonexistent'),
      { message: /nonexistent.*not found/ },
    );
  });
});
