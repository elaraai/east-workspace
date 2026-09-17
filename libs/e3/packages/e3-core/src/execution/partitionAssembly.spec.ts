/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The merge-tree fan-in of a partitioned task (issue #770): how partials
 * group into components by key range, the shape of the tree, the synthesized
 * unit objects, and the tree run level by level — with an in-process stand-in
 * for the unit runner, so the tree's shape is observable without spawning
 * one. The runner-backed merge is exercised end to end in
 * `partitionExec.spec.ts`.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DictType,
  East,
  IntegerType,
  SetType,
  SortedMap,
  compareFor,
  decodeBeast2For,
  decodeEastIR,
  encodeBeast2PagedFor,
  encodeEastIR,
  equalFor,
  none,
  some,
  toEastTypeValue,
  variant,
} from '@elaraai/east';
import {
  TASK_KIND_PARTITION,
  TASK_KIND_STREAM,
  TaskObjectType,
  decodePartitionTaskMetadata,
  decodeStreamTaskMetadata,
  decodeTaskObject,
  encodePartitionTaskMetadata,
  type TaskObject,
} from '@elaraai/e3-types';
import {
  MERGE_TREE_FANIN,
  assembleMergeTree,
  mergeComponents,
  mergeTreeGroups,
  mergeTreeLevels,
  synthesizeMergeTask,
  type MergeUnitPosition,
} from './partitionAssembly.js';
import type { ExecutionResult } from './LocalTaskRunner.js';
import { createTestRepo, removeTestRepo } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';

const OutType = DictType(IntegerType, IntegerType);
type Out = SortedMap<bigint, bigint>;
const intCmp = compareFor(IntegerType) as (a: unknown, b: unknown) => number;

/** A Dict partial holding `keys`, each valued `value`. */
function partial(keys: readonly number[], value = 1n): Out {
  return new SortedMap(keys.map((k) => [BigInt(k), value] as [bigint, bigint]), intCmp);
}

/** `[from, to)` as an array of numbers. */
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);

describe('partitionAssembly', () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  async function store(value: Out): Promise<string> {
    return storage.objects.write(repo, encodeBeast2PagedFor(OutType, { batchSize: 4 })(value));
  }

  /** A partitioned task summing equal keys, on a stock or the custom runtime. */
  function parentTask(runtime: 'east_node' | 'custom'): TaskObject {
    const mergeFn = East.function([IntegerType, IntegerType, IntegerType], IntegerType, ($, _key, a, b) => a.add(b));
    return {
      commandIr: '0'.repeat(64),
      inputs: [],
      output: [],
      kind: some(TASK_KIND_PARTITION),
      metadata: some(encodePartitionTaskMetadata({
        partitions: 1n,
        by: none,
        combine: none,
        targetPartitionBytes: 1n,
        merge: some(encodeEastIR(mergeFn.toIR())),
        mergeSets: false,
      })),
      runner: runtime === 'custom' ? variant('custom', { command: [] }) : variant('east_node', { platforms: [] }),
      environment: none,
    };
  }

  /**
   * A stand-in unit runner: merges a unit's partials in process, summing
   * equal keys, and records every unit it ran.
   */
  function sumRunner(failWhen?: (inputs: string[]) => boolean) {
    const runs: string[][] = [];
    const runUnit = async (_taskHash: string, _task: TaskObject, inputs: string[]): Promise<ExecutionResult> => {
      runs.push(inputs);
      const base = { inputsHash: 'i'.repeat(64), executionId: `unit-${runs.length}`, cached: false, duration: 0, cancelled: false };
      if (failWhen?.(inputs)) {
        return { ...base, state: 'failed', outputHash: null, exitCode: 3, error: 'boom' };
      }
      const merged = partial([]);
      // inputs = [bodyIr, mergeIr, ...partials]
      for (const hash of inputs.slice(2)) {
        for (const [key, value] of decodeBeast2For(OutType)(await storage.objects.read(repo, hash))) {
          merged.set(key, (merged.get(key) ?? 0n) + value);
        }
      }
      return { ...base, state: 'success', outputHash: await store(merged), exitCode: 0, error: null };
    };
    return { runs, runUnit };
  }

  it('groups partials whose key ranges overlap into components, in key order', async () => {
    const partials = [
      await store(partial(range(20, 30))),   // 0: alone
      await store(partial(range(0, 10))),    // 1: overlaps 2
      await store(partial([])),              // 2: empty — in no component
      await store(partial(range(5, 15))),    // 3: overlaps 1
      await store(partial(range(14, 17))),   // 4: first key equals 3's last key — joins
      await store(partial([40])),            // 5: alone
    ];
    const { typeValue, components } = await mergeComponents(storage, repo, partials);
    assert.equal(typeValue.type, 'Dict');
    assert.deepEqual(components, [
      { first: 0n, partitions: [1, 3, 4] },
      { first: 20n, partitions: [0] },
      { first: 40n, partitions: [5] },
    ]);

    const empty = await mergeComponents(storage, repo, [partials[2]!, partials[2]!]);
    assert.deepEqual(empty.components, []);
  });

  it('groups each level into consecutive runs of eight, a run of one passing through', () => {
    assert.equal(MERGE_TREE_FANIN, 8);
    assert.deepEqual(mergeTreeGroups(range(0, 17)).map((g) => g.length), [8, 8, 1]);
    assert.deepEqual(mergeTreeGroups(range(0, 8)).map((g) => g.length), [8]);
    assert.equal(mergeTreeLevels([]), 0);
    assert.equal(mergeTreeLevels([1, 1]), 0);
    assert.equal(mergeTreeLevels([2]), 1);
    assert.equal(mergeTreeLevels([8]), 1);
    assert.equal(mergeTreeLevels([1, 9]), 2);
    assert.equal(mergeTreeLevels([64]), 2);
    assert.equal(mergeTreeLevels([65, 3]), 3);
  });

  it('synthesizes the same unit objects on every build', async () => {
    const parent = parentTask('east_node');
    const typeValue = toEastTypeValue(OutType);
    for (let m = 2; m <= MERGE_TREE_FANIN; m++) {
      const first = await synthesizeMergeTask(storage, repo, parent, typeValue, 'function', m);
      const second = await synthesizeMergeTask(storage, repo, parent, typeValue, 'function', m);
      assert.deepEqual(second, first, `m = ${m}`);
    }

    const unit = await synthesizeMergeTask(storage, repo, parent, typeValue, 'function', 3);
    // Inputs: the body over three partials and the emit capability, then the
    // parent's merge function, byte for byte.
    assert.equal(unit.inputs.length, 2);
    const body = decodeEastIR(await storage.objects.read(repo, unit.inputs[0]!));
    assert.equal(body.ir.value.parameters.length, 4);
    const parentMeta = decodePartitionTaskMetadata(parent.metadata.type === 'some' ? parent.metadata.value : new Uint8Array());
    assert.deepEqual(
      new Uint8Array(await storage.objects.read(repo, unit.inputs[1]!)),
      new Uint8Array(parentMeta.merge.type === 'some' ? parentMeta.merge.value : new Uint8Array()),
    );

    const task = decodeTaskObject(await storage.objects.read(repo, unit.taskHash));
    assert.ok(equalFor(TaskObjectType)(task, unit.task), 'the stored task object is the one returned');
    assert.deepEqual(task.kind, some(TASK_KIND_STREAM));
    assert.deepEqual(decodeStreamTaskMetadata(task.metadata.type === 'some' ? task.metadata.value : new Uint8Array()),
      { stream: true, emit: 'dict', merge: 'function' });
    assert.deepEqual(task.runner, parent.runner);
    assert.deepEqual(task.environment, parent.environment);
    assert.deepEqual(task.inputs, []);
    assert.deepEqual(task.output, []);

    // A Set in union mode takes no merge IR, and emits into a set sink.
    const union = await synthesizeMergeTask(storage, repo, parent, toEastTypeValue(SetType(IntegerType)), 'union', 2);
    assert.equal(union.inputs.length, 1);
    assert.deepEqual(decodeStreamTaskMetadata(union.task.metadata.type === 'some' ? union.task.metadata.value : new Uint8Array()),
      { stream: true, emit: 'set', merge: 'union' });

    await assert.rejects(
      synthesizeMergeTask(storage, repo, parentTask('custom'), typeValue, 'function', 2),
      /^Error: partition merge needs a stock runtime \(east-c, east-node, east-py\); this task uses the custom runtime$/,
    );
  });

  it('synthesizes unit objects whose hashes match the pinned constants', async () => {
    // A unit is cached under these hashes: when one changes, every merge unit
    // a repository has cached runs again. The body's parameter names come
    // from the TypeScript compiler (east's naming), so these are the hashes of
    // a build where it is installed — the monorepo's. The merge IR input is
    // the parent's own bytes, checked above.
    const pinned = [
      {
        mode: 'function' as const,
        typeValue: toEastTypeValue(OutType),
        taskHash: '047369f51f79fe8023ae1864d493892f7edda454e19fec396d75835da2b83a64',
        commandIr: 'd5f2aa321087cbbb770e4943989cc040dfc09020ed507f582c95841f7a9d4d54',
        bodyIr: [
          '7c559c7ee606dcd943923206abb3b81b61a92321da98800200e7e9cfe00367da',
          'efed104c1cb522907ec8014a83517df27e09fa09494620be1e2ffb4b3aad1ceb',
          'dc21e58e85cd0ba33b60bbe6aae0bad3bc29b2dca6899786a043aef291e44515',
          '3be33e040415cf50a69cfe652215b67ade192a9837ae49abdb24063f7f8e579e',
          '7e12be9f6bb2da26475fc691d0e98236d940975b7cea0d2c5bf779e6a3483d6b',
          '931246a3908e8653c6ccc07c6f0fa55912fb85ad701613bf86e3f04084c90f3c',
          'b3dbc525dda5d351a32c4d7104b33ef1968eab749dbbca3fc9e85e534e269326',
        ],
      },
      {
        mode: 'union' as const,
        typeValue: toEastTypeValue(SetType(IntegerType)),
        taskHash: 'eeb9c5f3fd71a3b59f22ce25a20920014fcce9c2dd6664b3229939f13f72bfb8',
        commandIr: '7679c7e86672ce58b2808a06c4acc6d228ae6f95038adbb3426e4624cc9b4a71',
        bodyIr: [
          '8c99186016760790ad340fa6318b630f6d8093ec5c46b34c96dbf7f515150fe9',
          'c159ec66aa0a20c032aee4a2c7f8365707c3840f4dba8f676215d4181300ffea',
          '43d6e6418e40492266fed78592482b626b3e0aa2b18bdcdd7d8cd368e8829c0f',
          'ca91637c9d07f726b9b58c9bb0306494553c125e8cf05bc1c6b7c97c3c766739',
          '2c64045f8ee96d47e00bb02fed6c22abc8dc1036f63e7a0b3b708c04334bb03d',
          'ce992a9e03bdea96cda7ad4ada6e8bebf3c2004b78011df7c15be82980800f48',
          '8ff0c4c6e499bf6d855f770c8971e06c03ea295cee9aabb7396f9cc34f2242fa',
        ],
      },
    ];
    const parent = parentTask('east_node');
    for (const { mode, typeValue, taskHash, commandIr, bodyIr } of pinned) {
      for (let m = 2; m <= MERGE_TREE_FANIN; m++) {
        const unit = await synthesizeMergeTask(storage, repo, parent, typeValue, mode, m);
        assert.equal(unit.taskHash, taskHash, `${mode} task, m = ${m}`);
        assert.equal(unit.task.commandIr, commandIr, `${mode} command IR, m = ${m}`);
        assert.equal(unit.inputs[0], bodyIr[m - 2], `${mode} body IR, m = ${m}`);
      }
    }
  });

  it('runs one unit per group of two or more, level by level, until each component is one blob', async () => {
    // Ten partials over one key space: a single component, merged by two
    // units at level 1 (eight partials, then two) and one at level 2.
    const partials = await Promise.all(range(0, 10).map((p) => store(partial(range(0, 6).map((k) => k + (p % 3))))));
    const { runs, runUnit } = sumRunner();
    const started: MergeUnitPosition[] = [];
    const completed: MergeUnitPosition[] = [];
    const outcome = await assembleMergeTree({
      storage, repo, parent: parentTask('east_node'), mode: 'function', partials, concurrency: 3, runUnit,
      onUnitStarted: (unit) => started.push(unit),
      onUnitCompleted: (unit) => completed.push(unit),
    });

    assert.equal(outcome.kind, 'merged');
    if (outcome.kind !== 'merged') return;
    assert.equal(outcome.units, 3);
    assert.equal(runs.length, 3);
    // Level 1 merges partials 0–7 and 8–9; level 2 merges their two results.
    assert.deepEqual(runs.map((inputs) => inputs.length - 2).sort((a, b) => a - b), [2, 2, 8]);
    const byPosition = (a: MergeUnitPosition, b: MergeUnitPosition): number => a.level - b.level || a.index - b.index;
    assert.deepEqual(
      [...completed].sort(byPosition).map((u) => [u.level, u.levels, u.index, u.total]),
      [[1, 2, 0, 2], [1, 2, 1, 2], [2, 2, 0, 1]],
    );
    assert.equal(started.length, 3);

    // The one component's result sums every partial's values.
    assert.equal(outcome.results.length, 1);
    const expected = partial([]);
    for (let p = 0; p < 10; p++) {
      for (const k of range(0, 6)) {
        const key = BigInt(k + (p % 3));
        expected.set(key, (expected.get(key) ?? 0n) + 1n);
      }
    }
    const merged = decodeBeast2For(OutType)(await storage.objects.read(repo, outcome.results[0]!));
    assert.ok(equalFor(OutType)(merged, expected));
  });

  it('runs no unit for disjoint partials, and returns each component in key order', async () => {
    const partials = [await store(partial(range(10, 20))), await store(partial(range(0, 10)))];
    const { runs, runUnit } = sumRunner();
    // The custom runtime is refused only when a unit would run.
    const outcome = await assembleMergeTree({
      storage, repo, parent: parentTask('custom'), mode: 'function', partials, concurrency: 2, runUnit,
    });
    assert.deepEqual(outcome, { kind: 'merged', results: [partials[1], partials[0]], units: 0 });
    assert.equal(runs.length, 0);
  });

  it('refuses the custom runtime when a unit would run', async () => {
    const partials = [await store(partial(range(0, 10))), await store(partial(range(5, 15)))];
    const { runs, runUnit } = sumRunner();
    const outcome = await assembleMergeTree({
      storage, repo, parent: parentTask('custom'), mode: 'function', partials, concurrency: 2, runUnit,
    });
    assert.deepEqual(outcome, {
      kind: 'error',
      message: 'partition merge needs a stock runtime (east-c, east-node, east-py); this task uses the custom runtime',
    });
    assert.equal(runs.length, 0);
  });

  it('reports the lowest-index unit of a level that did not succeed', async () => {
    const partials = await Promise.all(range(0, 16).map(() => store(partial(range(0, 4)))));
    // Every unit fails; with two workers both level-1 units run, and the
    // reported one is always the first.
    const { runUnit } = sumRunner(() => true);
    const outcome = await assembleMergeTree({
      storage, repo, parent: parentTask('east_node'), mode: 'function', partials, concurrency: 2, runUnit,
    });
    assert.equal(outcome.kind, 'unitFailed');
    if (outcome.kind !== 'unitFailed') return;
    assert.deepEqual([outcome.unit.level, outcome.unit.levels, outcome.unit.index, outcome.unit.total], [1, 2, 0, 2]);
    assert.equal(outcome.result.exitCode, 3);
  });
});
