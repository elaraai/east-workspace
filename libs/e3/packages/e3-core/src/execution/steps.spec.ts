/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The step interpreter of a partitioned task (issue #770): how partials
 * group into components by key range, the shape of the reduce tree, the
 * templates each assembly mode selects, the merge unit task the package's
 * merge command becomes, and the templates run over an in-process stand-in
 * for the unit executor — so the units, their levels, failure attribution,
 * cancellation and the partial plan are observable without spawning a
 * runner. The runner-backed merge is exercised end to end in
 * `partitionExec.spec.ts`.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DictType,
  East,
  IntegerType,
  OptionType,
  SetType,
  SortedMap,
  StructType,
  compareFor,
  decodeBeast2For,
  encodeBeast2For,
  encodeEastIR,
  equalFor,
  none,
  some,
  variant,
} from '@elaraai/east';
import {
  TASK_KIND_MERGE,
  TASK_KIND_PARTITION,
  TaskObjectType,
  decodePartitionPlan,
  decodeTaskObject,
  encodePartitionTaskMetadata,
  mergeCommandIr,
  type PartitionTaskMetadata,
  type TaskObject,
} from '@elaraai/e3-types';
import {
  MERGE_TREE_FANIN,
  executeTemplate,
  mergeComponents,
  mergeTreeGroups,
  mergeTreeLevels,
  templateFor,
  type Step,
} from './steps.js';
import type { ExecutionResult } from './LocalTaskRunner.js';
import { inputsHash } from '../executions.js';
import { uuidv7 } from '../uuid.js';
import { readDatasetWhole } from '../dataset-open.js';
import { createTestRepo, removeTestRepo, encodeInSegmentsOf } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';

const OutType = DictType(IntegerType, IntegerType);
type Out = SortedMap<bigint, bigint>;
const intCmp = compareFor(IntegerType) as (a: unknown, b: unknown) => number;

/** A Dict holding `keys`, each valued `value`. */
function dict(keys: readonly number[], value = 1n): Out {
  return new SortedMap(keys.map((k) => [BigInt(k), value] as [bigint, bigint]), intCmp);
}

/** `[from, to)` as an array of numbers. */
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);

/** The key range a merge unit takes as its input, over Integer keys. */
const RangeType = StructType({ from: OptionType(IntegerType), to: OptionType(IntegerType) });
type KeyRange = { from: { type: 'none' } | { type: 'some'; value: bigint }; to: { type: 'none' } | { type: 'some'; value: bigint } };
const decodeRange = decodeBeast2For(RangeType) as (data: Uint8Array) => KeyRange;

/** Whether `key` lies in the range. */
function inRange(key: bigint, bounds: KeyRange): boolean {
  return (bounds.from.type === 'none' || key >= bounds.from.value) && (bounds.to.type === 'none' || key < bounds.to.value);
}

describe('steps', () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  async function store(value: Out, batchSize = 4): Promise<string> {
    return storage.objects.write(repo, encodeInSegmentsOf(OutType, batchSize)(value));
  }

  const mergeFn = East.function([IntegerType, IntegerType, IntegerType], IntegerType, ($, _key, a, b) => a.add(b));
  const mergeIr = encodeEastIR(mergeFn.toIR());

  /** The metadata of a partitioned task in one assembly mode. */
  function metadata(mode: 'splice' | 'combine' | 'merge' | 'union' | 'merge-without-command', runtime: 'east_node' | 'custom' = 'east_node', targetPartitionBytes = 1n): PartitionTaskMetadata {
    const runner = runtime === 'custom' ? variant('custom', { command: [] }) : variant('east_node', { platforms: [] });
    const command = (m: 'function' | 'union') => runtime === 'custom' ? none : some(encodeEastIR(mergeCommandIr(runner, m)));
    const base = { partitions: 1n, by: none, combine: none, targetPartitionBytes, merge: none, mergeSets: false, mergeCommand: none };
    switch (mode) {
      case 'splice': return base;
      case 'combine': return { ...base, combine: some(encodeEastIR(East.function([OutType, OutType], OutType, ($, a, _b) => $.return(a)).toIR())) };
      case 'merge': return { ...base, merge: some(mergeIr), mergeCommand: command('function') };
      case 'union': return { ...base, mergeSets: true, mergeCommand: command('union') };
      case 'merge-without-command': return { ...base, merge: some(mergeIr) };
    }
  }

  /** A partitioned task in one assembly mode, on a stock or the custom runtime. */
  function parentTask(mode: Parameters<typeof metadata>[0], runtime: 'east_node' | 'custom' = 'east_node', targetPartitionBytes = 1n): TaskObject {
    return {
      commandIr: '0'.repeat(64),
      inputs: [],
      output: [],
      kind: some(TASK_KIND_PARTITION),
      metadata: some(encodePartitionTaskMetadata(metadata(mode, runtime, targetPartitionBytes))),
      runner: runtime === 'custom' ? variant('custom', { command: [] }) : variant('east_node', { platforms: [] }),
      environment: none,
    };
  }

  async function writeTask(task: TaskObject): Promise<string> {
    return storage.objects.write(repo, encodeBeast2For(TaskObjectType)(task));
  }

  /**
   * A stand-in unit executor: a partition unit re-keys its slice's keys by
   * `modulus` counting rows (so partials overlap everywhere), and a merge unit
   * sums equal keys across its partials within its key range, as the
   * runners' `merge --range` does — in process, recording every unit.
   */
  function standIn(options: { modulus?: bigint; failWhen?: (task: TaskObject, inputs: string[]) => boolean; onUnit?: () => void; batchSize?: number } = {}) {
    const runs: { kind: string; inputs: string[] }[] = [];
    const executeUnit = async (_taskHash: string, task: TaskObject, inputs: string[]): Promise<ExecutionResult> => {
      const kind = task.kind.type === 'some' ? task.kind.value : 'data';
      runs.push({ kind, inputs });
      options.onUnit?.();
      const base = { inputsHash: inputsHash(inputs), executionId: uuidv7(), cached: false, duration: 0, cancelled: false };
      if (options.failWhen?.(task, inputs)) {
        return { ...base, state: 'failed', outputHash: null, exitCode: 3, error: 'boom' };
      }
      const merged = dict([]);
      if (kind === TASK_KIND_MERGE) {
        // inputs = [mergeIr, range, ...partials]
        const bounds = decodeRange(await storage.objects.read(repo, inputs[1]!));
        for (const hash of inputs.slice(2)) {
          for (const [key, value] of decodeBeast2For(OutType)(await storage.objects.read(repo, hash))) {
            if (inRange(key, bounds)) merged.set(key, (merged.get(key) ?? 0n) + value);
          }
        }
      } else {
        // inputs = [fnIr, slice]
        for (const [key] of decodeBeast2For(OutType)(await storage.objects.read(repo, inputs[1]!))) {
          const out = options.modulus === undefined ? key : key % options.modulus;
          merged.set(out, (merged.get(out) ?? 0n) + 1n);
        }
      }
      return { ...base, state: 'success', outputHash: await store(merged, options.batchSize), exitCode: 0, error: null };
    };
    return { runs, executeUnit };
  }

  it('groups partials whose key ranges overlap into components, in key order', async () => {
    const partials = [
      await store(dict(range(20, 30))),   // 0: alone
      await store(dict(range(0, 10))),    // 1: overlaps 2
      await store(dict([])),              // 2: empty — in no component
      await store(dict(range(5, 15))),    // 3: overlaps 1
      await store(dict(range(14, 17))),   // 4: first key equals 3's last key — joins
      await store(dict([40])),            // 5: alone
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

  it('groups each level into consecutive runs of the fan-in, a run of one passing through', () => {
    assert.equal(MERGE_TREE_FANIN, 32);
    assert.deepEqual(mergeTreeGroups(range(0, 65)).map((g) => g.length), [32, 32, 1]);
    assert.deepEqual(mergeTreeGroups(range(0, 32)).map((g) => g.length), [32]);
    assert.deepEqual(mergeTreeGroups(range(0, 5), 2).map((g) => g.length), [2, 2, 1]);
    assert.equal(mergeTreeLevels([]), 0);
    assert.equal(mergeTreeLevels([1, 1]), 0);
    assert.equal(mergeTreeLevels([2]), 1);
    assert.equal(mergeTreeLevels([32]), 1);
    assert.equal(mergeTreeLevels([1, 33]), 2);
    assert.equal(mergeTreeLevels([1024]), 2);
    assert.equal(mergeTreeLevels([1025, 3]), 3);
    assert.equal(mergeTreeLevels([10], 2), 4);
  });

  describe('templateFor', () => {
    const kinds = (steps: Step[]) => steps.map((s) => s.kind);

    it('selects the splice, combine and merge templates from the metadata', async () => {
      const splice = await templateFor(storage, repo, 't'.repeat(64), parentTask('splice'), metadata('splice'), 3);
      assert.deepEqual(kinds(splice), ['plan', 'map', 'splice']);
      assert.deepEqual(splice[0], { kind: 'plan', primary: 1, secondaries: [], by: null, targetBytes: 1 });
      assert.deepEqual((splice[1] as Extract<Step, { kind: 'map' }>).inputs, [{ input: 0 }, { slice: 0 }, { input: 2 }]);
      assert.deepEqual(splice[2], { kind: 'splice', over: 1, fallback: null, subject: 'shards' });

      const combineMeta = metadata('combine');
      const combine = await templateFor(storage, repo, 't'.repeat(64), parentTask('combine'), combineMeta, 2);
      assert.deepEqual(kinds(combine), ['plan', 'map', 'reduce']);
      const reduce = combine[2] as Extract<Step, { kind: 'reduce' }>;
      assert.equal(reduce.taskHash, 't'.repeat(64));
      assert.deepEqual([reduce.fanIn, reduce.group, reduce.label, reduce.over, reduce.unavailable], [2, 'all', 'combine', 1, null]);
      assert.equal(reduce.leading.length, 1);
      const combineIr = (reduce.leading[0] as { object: string }).object;
      assert.deepEqual(new Uint8Array(await storage.objects.read(repo, combineIr)), combineMeta.combine.type === 'some' ? combineMeta.combine.value : new Uint8Array());

      const merge = await templateFor(storage, repo, 't'.repeat(64), parentTask('merge'), metadata('merge'), 2);
      assert.deepEqual(kinds(merge), ['plan', 'map', 'reduce', 'splice']);
      const tree = merge[2] as Extract<Step, { kind: 'reduce' }>;
      assert.deepEqual([tree.fanIn, tree.group, tree.rangeBytes, tree.label, tree.over, tree.unavailable], [MERGE_TREE_FANIN, 'ranges', 1, 'merge', 1, null]);
      assert.deepEqual(merge[3], { kind: 'splice', over: 2, fallback: 1, subject: 'components' });
    });

    it('writes the merge unit task from the package\'s merge command, its identity the command plus the partials', async () => {
      const parent = parentTask('merge');
      const meta = metadata('merge');
      const steps = await templateFor(storage, repo, 't'.repeat(64), parent, meta, 2);
      const reduce = steps[2] as Extract<Step, { kind: 'reduce' }>;
      // The merge IR is the unit's leading input, byte for byte.
      assert.equal(reduce.leading.length, 1);
      assert.deepEqual(new Uint8Array(await storage.objects.read(repo, (reduce.leading[0] as { object: string }).object)), mergeIr);
      // The unit task: the merge kind, the package's mergeCommand as its
      // command IR, no metadata, the parent's runner and environment.
      const commandIr = await storage.objects.write(repo, meta.mergeCommand.type === 'some' ? meta.mergeCommand.value : new Uint8Array());
      const expected: TaskObject = { commandIr, inputs: [], output: [], kind: some(TASK_KIND_MERGE), metadata: none, runner: parent.runner, environment: parent.environment };
      assert.ok(equalFor(TaskObjectType)(reduce.task!, expected));
      assert.equal(reduce.taskHash, await writeTask(expected), 'the unit task is a pure function of the package objects');
      assert.ok(equalFor(TaskObjectType)(decodeTaskObject(await storage.objects.read(repo, reduce.taskHash!)), expected));
      // Built again, the same objects.
      const again = await templateFor(storage, repo, 't'.repeat(64), parent, meta, 2);
      assert.equal((again[2] as Extract<Step, { kind: 'reduce' }>).taskHash, reduce.taskHash);

      // A Set in union mode has no leading input.
      const union = await templateFor(storage, repo, 't'.repeat(64), parentTask('union'), metadata('union'), 2);
      assert.deepEqual((union[2] as Extract<Step, { kind: 'reduce' }>).leading, []);
    });

    it('marks the tree unavailable on the custom runtime and for a package without a merge command', async () => {
      const custom = await templateFor(storage, repo, 't'.repeat(64), parentTask('merge', 'custom'), metadata('merge', 'custom'), 2);
      assert.equal((custom[2] as Extract<Step, { kind: 'reduce' }>).unavailable,
        'partition merge needs a stock runtime (east-c, east-node, east-py); this task uses the custom runtime');
      const old = await templateFor(storage, repo, 't'.repeat(64), parentTask('merge-without-command'), metadata('merge-without-command'), 2);
      assert.equal((old[2] as Extract<Step, { kind: 'reduce' }>).unavailable,
        'partition merge: the package was exported before merge commands existed — re-export it with the current SDK');
      assert.equal((old[2] as Extract<Step, { kind: 'reduce' }>).taskHash, null);
    });
  });

  describe('executeTemplate', () => {
    /** Runs a template over the stand-in executor. */
    async function run(task: TaskObject, inputs: string[], executeUnit: ReturnType<typeof standIn>['executeUnit'], options: Parameters<typeof executeTemplate>[6] = {}) {
      const taskHash = await writeTask(task);
      const ids = { inHash: inputsHash(inputs), executionId: uuidv7(), startTime: Date.now() };
      const result = await executeTemplate(storage, repo, taskHash, task, inputs, ids, options, { executeUnit });
      return { taskHash, ids, result };
    }

    /** The logical execution's log, line by line. */
    async function logLines(taskHash: string, ids: { inHash: string; executionId: string }): Promise<string[]> {
      const log = await storage.logs.read(repo, taskHash, ids.inHash, ids.executionId, 'stdout');
      return log.data.split('\n').filter((line) => line !== '');
    }

    it('runs one merge unit per run of two or more, level by level, until each component is one blob', async () => {
      // 160 rows in 4-row segments: 40 partitions, each re-keyed onto keys
      // 0..2, so every partial overlaps every other — one component, merged
      // by two units at level 1 (32 partials, then 8) and one at level 2.
      const table = await store(dict(range(0, 160)));
      const { runs, executeUnit } = standIn({ modulus: 3n });
      const { taskHash, ids, result } = await run(parentTask('merge'), ['f'.repeat(64), table], executeUnit, { partitionConcurrency: 3 });
      assert.equal(result.state, 'success', result.error ?? '');

      assert.equal(runs.filter((r) => r.kind === TASK_KIND_PARTITION).length, 40);
      const merges = runs.filter((r) => r.kind === TASK_KIND_MERGE);
      // Every unit's inputs: the merge IR, the key range, then its entries.
      assert.deepEqual(merges.map((r) => r.inputs.length - 2).sort((a, b) => a - b), [2, 8, 32]);
      assert.ok(merges.every((r) => r.inputs[1] === merges[0]!.inputs[1]), 'one component of one range: every unit takes the same open range');
      const lines = await logLines(taskHash, ids);
      // A level's units complete in any order under the pool; the levels
      // run in sequence.
      assert.deepEqual(
        lines.filter((line) => line.startsWith('merge ')).map((line) => line.split(' ').slice(0, 5).join(' ')).sort(),
        ['merge level 1/2 unit 1/2', 'merge level 1/2 unit 2/2', 'merge level 2/2 unit 1/1'],
      );
      assert.ok(lines.findIndex((line) => line.startsWith('merge level 2/2')) > lines.findIndex((line) => line.startsWith('merge level 1/2')));
      assert.equal(lines.filter((line) => line.startsWith('partition ')).length, 40);

      // The one component's result counts every row on its key.
      const merged = decodeBeast2For(OutType)(await readDatasetWhole(storage, repo, result.outputHash!));
      const expected = dict([]);
      for (const k of range(0, 160)) expected.set(BigInt(k % 3), (expected.get(BigInt(k % 3)) ?? 0n) + 1n);
      assert.ok(equalFor(OutType)(merged, expected));
    });

    it('runs a map step\'s units and a reduce level\'s units concurrently, partitionConcurrency at a time', { timeout: 60_000 }, async () => {
      // 40 partitions re-keyed onto one component: two level-1 merge units.
      // The first four partition units and both level-1 merge units wait at
      // a gate that opens only once that many are in flight — a pool that
      // ran fewer at a time would never get past it — and the most units in
      // flight is pinned to the pool's width. One worker never overlaps.
      function gate(width: number) {
        let inFlight = 0;
        let peak = 0;
        let admitted = 0;
        const waiting: (() => void)[] = [];
        return {
          peak: () => peak,
          async enter(): Promise<void> {
            inFlight++;
            peak = Math.max(peak, inFlight);
            if (admitted++ < width) {
              await new Promise<void>((resolve) => {
                waiting.push(resolve);
                if (waiting.length === width) for (const open of waiting.splice(0)) open();
              });
            }
          },
          leave(): void {
            inFlight--;
          },
        };
      }
      const gated = (executeUnit: ReturnType<typeof standIn>['executeUnit'], gateFor: (task: TaskObject) => ReturnType<typeof gate>) =>
        async (taskHash: string, task: TaskObject, inputs: string[]): Promise<ExecutionResult> => {
          const g = gateFor(task);
          await g.enter();
          try {
            return await executeUnit(taskHash, task, inputs);
          } finally {
            g.leave();
          }
        };
      const isMerge = (task: TaskObject) => task.kind.type === 'some' && task.kind.value === TASK_KIND_MERGE;

      const table = await store(dict(range(0, 160)));
      const partitions = gate(4);
      const merges = gate(2);
      const pooled = await run(parentTask('merge'), ['f'.repeat(64), table], gated(standIn({ modulus: 3n }).executeUnit, (task) => isMerge(task) ? merges : partitions), { partitionConcurrency: 4 });
      assert.equal(pooled.result.state, 'success', pooled.result.error ?? '');
      assert.equal(partitions.peak(), 4, 'four partition units in flight at once');
      assert.equal(merges.peak(), 2, 'both level-1 merge units in flight at once');

      // A fresh input (so nothing cache-hits) under one worker.
      const other = await store(dict(range(0, 160)), 8);
      const serial = gate(1);
      const single = await run(parentTask('merge'), ['f'.repeat(64), other], gated(standIn({ modulus: 3n }).executeUnit, () => serial), { partitionConcurrency: 1 });
      assert.equal(single.result.state, 'success', single.result.error ?? '');
      assert.equal(serial.peak(), 1, 'one worker never overlaps units');
      assert.ok(equalFor(OutType)(
        decodeBeast2For(OutType)(await readDatasetWhole(storage, repo, pooled.result.outputHash!)),
        decodeBeast2For(OutType)(await readDatasetWhole(storage, repo, single.result.outputHash!)),
      ), 'the pool width never changes the result');
    });

    it('cuts a component whose partials span several segments into key ranges, merging each in its own unit over the whole partials', async () => {
      // 400 rows in 40-row partitions: ten partitions, each re-keyed onto
      // forty of the keys 0..99, so every key lands in four partials — one
      // component. Each partial is stored in 4-row segments (ten per
      // partial), and a byte target of 1 cuts the component into as many
      // ranges as its largest partial has segments: ten ranges, each merged
      // by one unit that takes the range and the ten whole partials.
      const table = await store(dict(range(0, 400)), 40);
      const { runs, executeUnit } = standIn({ modulus: 100n, batchSize: 4 });
      const { taskHash, ids, result } = await run(parentTask('merge'), ['f'.repeat(64), table], executeUnit, { partitionConcurrency: 3 });
      assert.equal(result.state, 'success', result.error ?? '');
      const merges = runs.filter((r) => r.kind === TASK_KIND_MERGE);
      assert.equal(merges.length, 10, 'one merge unit per range');
      assert.equal(runs.filter((r) => r.kind === TASK_KIND_PARTITION).length, 10);
      assert.ok(merges.every((r) => r.inputs.length === 2 + 10), 'every unit takes the merge IR, its range and every partial, whole');
      const expected = dict(range(0, 100), 4n);
      assert.ok(equalFor(OutType)(decodeBeast2For(OutType)(await readDatasetWhole(storage, repo, result.outputHash!)), expected));
      const lines = await logLines(taskHash, ids);
      assert.equal(lines.filter((line) => line.startsWith('merge level 1/1 unit ')).length, 10);

      // The plan records the component's ranges: ten range blobs whose
      // bounds tile the key space — open below, open above, each upper
      // bound the next lower bound, ascending.
      const planHash = await storage.refs.executionPlanRead!(repo, taskHash, ids.inHash);
      const plan = decodePartitionPlan(await storage.objects.read(repo, planHash!));
      assert.equal(plan.merges.length, 1);
      assert.equal(plan.merges[0]!.partials.length, 10);
      assert.equal(plan.merges[0]!.ranges.length, 10, 'ten ranges');
      const bounds: KeyRange[] = [];
      for (const hash of plan.merges[0]!.ranges) bounds.push(decodeRange(await storage.objects.read(repo, hash)));
      assert.equal(bounds[0]!.from.type, 'none');
      assert.equal(bounds[9]!.to.type, 'none');
      for (let r = 0; r + 1 < bounds.length; r++) {
        const to = bounds[r]!.to;
        const from = bounds[r + 1]!.from;
        assert.ok(to.type === 'some' && from.type === 'some' && to.value === from.value, `range ${r} ends where range ${r + 1} starts`);
        const lower = bounds[r]!.from;
        if (lower.type === 'some') assert.ok(lower.value < (to as { value: bigint }).value, 'the bounds ascend');
      }
      assert.deepEqual(merges.map((r) => r.inputs[1]).sort(), [...plan.merges[0]!.ranges].sort(), 'each unit took one of the recorded ranges');

      // A forced re-run under one worker writes the same bytes, reuses the
      // recorded slices and ranges — it streams nothing, the assembly going
      // through the store's door — and runs the same units again.
      const objects = storage.objects;
      let streamWrites = 0;
      const origWriteStream = objects.writeStream.bind(objects);
      objects.writeStream = (r: string, s: AsyncIterable<Uint8Array>) => {
        streamWrites++;
        return origWriteStream(r, s);
      };
      const again = standIn({ modulus: 100n, batchSize: 4 });
      const forced = await run(parentTask('merge'), ['f'.repeat(64), table], again.executeUnit, { partitionConcurrency: 1, force: true });
      assert.equal(forced.result.state, 'success', forced.result.error ?? '');
      assert.equal(forced.result.outputHash, result.outputHash, 'the same inputs write the same hash, whatever the pool width');
      assert.equal(streamWrites, 0, 'the partition slices are reused and nothing is carved for a range');
      assert.deepEqual(again.runs.filter((r) => r.kind === TASK_KIND_MERGE).map((r) => r.inputs[1]).sort(), [...plan.merges[0]!.ranges].sort(), 'the recorded ranges are reused');
    });

    it('merges a component whose partials are single segments whole, in one unit over the open range', async () => {
      // The same ten partitions folded onto three keys: each partial is one
      // segment, so the largest partial caps the ranges at one whatever the
      // byte target, and the component merges whole over the open range.
      const table = await store(dict(range(0, 400)), 40);
      const { runs, executeUnit } = standIn({ modulus: 3n, batchSize: 4 });
      const { taskHash, ids, result } = await run(parentTask('merge'), ['f'.repeat(64), table], executeUnit, { partitionConcurrency: 3 });
      assert.equal(result.state, 'success', result.error ?? '');
      const merges = runs.filter((r) => r.kind === TASK_KIND_MERGE);
      assert.equal(merges.length, 1);
      assert.equal(merges[0]!.inputs.length, 2 + 10);
      const expected = dict([]);
      for (const k of range(0, 400)) expected.set(BigInt(k % 3), (expected.get(BigInt(k % 3)) ?? 0n) + 1n);
      assert.ok(equalFor(OutType)(decodeBeast2For(OutType)(await readDatasetWhole(storage, repo, result.outputHash!)), expected));
      const plan = decodePartitionPlan(await storage.objects.read(repo, (await storage.refs.executionPlanRead!(repo, taskHash, ids.inHash))!));
      assert.equal(plan.merges.length, 1);
      assert.deepEqual(plan.merges[0]!.ranges, [merges[0]!.inputs[1]!]);
      assert.deepEqual(decodeRange(await storage.objects.read(repo, merges[0]!.inputs[1]!)), { from: none, to: none });
    });

    it('runs no merge unit for disjoint partials, splicing them in key order', async () => {
      // The identity stand-in: partials are the slices, disjoint by
      // construction. The custom runtime is refused only when a unit would run.
      const table = await store(dict(range(0, 40)));
      const { runs, executeUnit } = standIn();
      const { result } = await run(parentTask('merge', 'custom'), ['f'.repeat(64), table], executeUnit);
      assert.equal(result.state, 'success', result.error ?? '');
      assert.equal(runs.filter((r) => r.kind === TASK_KIND_MERGE).length, 0);
      assert.ok(equalFor(OutType)(decodeBeast2For(OutType)(await readDatasetWhole(storage, repo, result.outputHash!)), dict(range(0, 40))));
    });

    it('passes a component of one partial through whole, however many segments it spans', async () => {
      // Ten disjoint partials of ten segments each, far above the byte
      // target: a component of one partial is never cut into ranges — no
      // unit runs over a group of one, so a range per segment would only
      // splice the same partial ten times over.
      const table = await store(dict(range(0, 400)), 40);
      const { runs, executeUnit } = standIn({ batchSize: 4 });
      const { taskHash, ids, result } = await run(parentTask('merge'), ['f'.repeat(64), table], executeUnit);
      assert.equal(result.state, 'success', result.error ?? '');
      assert.equal(runs.filter((r) => r.kind === TASK_KIND_MERGE).length, 0);
      assert.ok(equalFor(OutType)(decodeBeast2For(OutType)(await readDatasetWhole(storage, repo, result.outputHash!)), dict(range(0, 400))));
      const plan = decodePartitionPlan(await storage.objects.read(repo, (await storage.refs.executionPlanRead!(repo, taskHash, ids.inHash))!));
      assert.deepEqual(plan.merges, [], 'nothing to reuse: no ranges were planned');
    });

    it('refuses the custom runtime, and a package without a merge command, only when a unit would run', async () => {
      const table = await store(dict(range(0, 16)));
      const custom = await run(parentTask('merge', 'custom'), ['f'.repeat(64), table], standIn({ modulus: 3n }).executeUnit);
      assert.equal(custom.result.state, 'error');
      assert.equal(custom.result.error, 'partition merge needs a stock runtime (east-c, east-node, east-py); this task uses the custom runtime');
      const old = await run(parentTask('merge-without-command'), ['f'.repeat(64), table], standIn({ modulus: 3n }).executeUnit);
      assert.equal(old.result.state, 'error');
      assert.equal(old.result.error, 'partition merge: the package was exported before merge commands existed — re-export it with the current SDK');
    });

    it('reports the lowest-index unit of a level that did not succeed', async () => {
      // 64 partitions over one key space: two level-1 units; every merge unit
      // fails, and with two workers both run — the reported one is always the
      // first.
      const table = await store(dict(range(0, 256)));
      const { executeUnit } = standIn({ modulus: 3n, failWhen: (task) => task.kind.type === 'some' && task.kind.value === TASK_KIND_MERGE });
      const { result } = await run(parentTask('merge'), ['f'.repeat(64), table], executeUnit, { partitionConcurrency: 2 });
      assert.equal(result.state, 'failed');
      assert.equal(result.exitCode, 3);
      assert.match(result.error ?? '', /^Merge unit 1 of 2 at level 1 of 2 failed \(exit code 3\): boom$/);
    });

    /**
     * An executor over `executeUnit` whose first unit matching `matches`
     * throws — its executor failing, not the unit's own failure — once the
     * second has started, the second held until the test releases it.
     */
    function throwingPool(executeUnit: ReturnType<typeof standIn>['executeUnit'], matches: (task: TaskObject) => boolean) {
      const started: number[] = [];
      let secondStarted!: () => void;
      const second = new Promise<void>((resolve) => { secondStarted = resolve; });
      let release!: () => void;
      const released = new Promise<void>((resolve) => { release = resolve; });
      const pooled = async (taskHash: string, task: TaskObject, inputs: string[]): Promise<ExecutionResult> => {
        if (!matches(task)) return executeUnit(taskHash, task, inputs);
        const unit = started.push(started.length + 1);
        if (unit === 1) {
          await second;
          throw new Error('the executor failed');
        }
        if (unit === 2) {
          secondStarted();
          await released;
        }
        return executeUnit(taskHash, task, inputs);
      };
      return { pooled, started, second, release };
    }

    /** Runs `task` over the throwing pool, two units at a time: the execution
     *  must wait for the held unit, then record the logical execution
     *  `error` as `record` describes it and reject with the thrown error, no
     *  unit having started after the throw. The partials overlap, so a merge
     *  task reaches its tree. Returns the logical execution's identity. */
    async function assertDrainsThenRethrows(task: TaskObject, table: string, matches: (task: TaskObject) => boolean, record: RegExp) {
      const pool = throwingPool(standIn({ modulus: 3n }).executeUnit, matches);
      const taskHash = await writeTask(task);
      const inputs = ['f'.repeat(64), table];
      const ids = { inHash: inputsHash(inputs), executionId: uuidv7(), startTime: Date.now() };
      const execution = executeTemplate(storage, repo, taskHash, task, inputs, ids, { partitionConcurrency: 2 }, { executeUnit: pool.pooled });
      let settled = false;
      execution.then(() => { settled = true; }, () => { settled = true; });
      await pool.second;
      // The first unit throws now; let its error travel as far as it will.
      for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false, 'the pool waits for the unit still in flight');
      pool.release();
      await assert.rejects(execution, { message: 'the executor failed' });
      assert.deepEqual(pool.started, [1, 2], 'no unit starts once one has thrown');
      // The logical execution is not left `running`: it names the unit.
      const logical = await storage.refs.executionGet(repo, taskHash, ids.inHash, ids.executionId);
      assert.equal(logical?.type, 'error');
      assert.match(logical?.type === 'error' ? logical.value.message : '', record);
      return { taskHash, ids };
    }

    it('drains a map step whose unit throws before rethrowing its error, starting no further partition', async () => {
      // Which of the two partitions in flight throws depends on which reached
      // its executor first.
      const isPartition = (task: TaskObject) => task.kind.type === 'some' && task.kind.value === TASK_KIND_PARTITION;
      const { taskHash, ids } = await assertDrainsThenRethrows(parentTask('splice'), await store(dict(range(0, 40))), isPartition,
        /^Partition [12] of 10 could not run: the executor failed$/);
      // The plan is recorded with what was carved, for a retry to reuse.
      assert.notEqual(await storage.refs.executionPlanRead!(repo, taskHash, ids.inHash), null);
    });

    it('drains a reduce level whose unit throws before rethrowing its error, starting no further unit', async () => {
      // 64 partitions over one key space: two level-1 merge units.
      const isMerge = (task: TaskObject) => task.kind.type === 'some' && task.kind.value === TASK_KIND_MERGE;
      await assertDrainsThenRethrows(parentTask('merge'), await store(dict(range(0, 256))), isMerge,
        /^Merge unit [12] of 2 at level 1 of 2 could not run: the executor failed$/);
    });

    it('folds partials pairwise under combine, naming the failed step by its partials', async () => {
      const table = await store(dict(range(0, 40)));
      const { runs, executeUnit } = standIn();
      // One worker, so the units of a level log in index order.
      const { taskHash, ids, result } = await run(parentTask('combine'), ['f'.repeat(64), table], executeUnit, { partitionConcurrency: 1 });
      assert.equal(result.state, 'success', result.error ?? '');
      // 10 partitions: 5 + 2 + 1 + 1 combine steps over 4 levels.
      const combines = runs.filter((r) => r.kind === TASK_KIND_PARTITION && r.inputs.length === 3);
      assert.equal(combines.length, 9);
      const lines = (await logLines(taskHash, ids)).filter((line) => line.startsWith('combine '));
      assert.deepEqual(lines.map((line) => line.split(' ').slice(0, 5).join(' ')), [
        'combine level 1/4 unit 1/5', 'combine level 1/4 unit 2/5', 'combine level 1/4 unit 3/5', 'combine level 1/4 unit 4/5', 'combine level 1/4 unit 5/5',
        'combine level 2/4 unit 1/2', 'combine level 2/4 unit 2/2', 'combine level 3/4 unit 1/1', 'combine level 4/4 unit 1/1',
      ]);

      const failing = standIn({ failWhen: (_task, inputs) => inputs.length === 3 });
      const failed = await run(parentTask('combine'), ['f'.repeat(64), table], failing.executeUnit, { partitionConcurrency: 1 });
      assert.equal(failed.result.state, 'failed');
      assert.match(failed.result.error ?? '', /^Combine step over partials 0 and 1 failed \(exit code 3\): boom$/);
    });

    it('stops at the level an abort lands in and records the run cancelled', async () => {
      const table = await store(dict(range(0, 160)));
      const abort = new AbortController();
      let units = 0;
      const { runs, executeUnit } = standIn({ modulus: 3n, onUnit: () => { if (++units === 41) abort.abort(); } });
      const { result } = await run(parentTask('merge'), ['f'.repeat(64), table], executeUnit, { partitionConcurrency: 1, signal: abort.signal });
      assert.equal(result.state, 'error');
      assert.equal(result.cancelled, true);
      assert.equal(result.error, 'cancelled: e3 stopped the partitioned run because the run was aborted');
      // The first level-1 unit ran; the abort stopped the level before its second.
      assert.equal(runs.filter((r) => r.kind === TASK_KIND_MERGE).length, 1);
    });

    it('records the plan with the slices it carved after a failure, and a retry carves only the rest', async () => {
      const table = await store(dict(range(0, 40)));
      let partitionUnits = 0;
      const failing = standIn({ failWhen: (task) => task.kind.type === 'some' && task.kind.value === TASK_KIND_PARTITION && ++partitionUnits === 3 });
      const first = await run(parentTask('splice'), ['f'.repeat(64), table], failing.executeUnit, { partitionConcurrency: 1 });
      assert.equal(first.result.state, 'failed');
      const planHash = await storage.refs.executionPlanRead!(repo, first.taskHash, first.ids.inHash);
      const plan = decodePartitionPlan(await storage.objects.read(repo, planHash!));
      assert.deepEqual(plan.slices[0]!.map((slice) => slice === '' ? '' : 'carved'), ['carved', 'carved', 'carved', '', '', '', '', '', '', '']);

      // The retry carves the seven uncarved partitions only, one streamed
      // write each.
      const objects = storage.objects;
      let streamWrites = 0;
      const origWriteStream = objects.writeStream.bind(objects);
      objects.writeStream = (r: string, s: AsyncIterable<Uint8Array>) => {
        streamWrites++;
        return origWriteStream(r, s);
      };
      const second = await run(parentTask('splice'), ['f'.repeat(64), table], standIn().executeUnit);
      assert.equal(second.result.state, 'success', second.result.error ?? '');
      assert.equal(streamWrites, 7);
      const completed = decodePartitionPlan(await storage.objects.read(repo, (await storage.refs.executionPlanRead!(repo, second.taskHash, second.ids.inHash))!));
      assert.ok(completed.slices[0]!.every((slice) => slice !== ''));
      assert.deepEqual(completed.slices[0]!.slice(0, 3), plan.slices[0]!.slice(0, 3), 'the carved slices are reused');
    });

    it('runs a single-partition plan as one unit through the executor under the logical inputs', async () => {
      const table = await store(dict(range(0, 8)), 100);
      const { runs, executeUnit } = standIn();
      const inputs = ['f'.repeat(64), table];
      const { result } = await run(parentTask('splice'), inputs, executeUnit);
      assert.equal(result.state, 'success', result.error ?? '');
      assert.deepEqual(runs, [{ kind: TASK_KIND_PARTITION, inputs }]);
    });

    it('stores the empty collection when every partial is empty', async () => {
      const table = await store(dict(range(0, 40)));
      // A stand-in whose partition units all yield empty partials.
      const { executeUnit } = standIn({ modulus: 3n });
      const empty = async (taskHash: string, task: TaskObject, inputs: string[]): Promise<ExecutionResult> => {
        const result = await executeUnit(taskHash, task, inputs);
        return task.kind.type === 'some' && task.kind.value === TASK_KIND_PARTITION
          ? { ...result, outputHash: await store(dict([])) }
          : result;
      };
      const { result } = await run(parentTask('merge'), ['f'.repeat(64), table], empty);
      assert.equal(result.state, 'success', result.error ?? '');
      assert.equal(decodeBeast2For(OutType)(await readDatasetWhole(storage, repo, result.outputHash!)).size, 0);
    });
  });

  it('a Set output merges by union with no leading input', async () => {
    const SetOut = SetType(IntegerType);
    const table = await store(dict(range(0, 40)));
    const runs: string[][] = [];
    const executeUnit = async (_taskHash: string, task: TaskObject, inputs: string[]): Promise<ExecutionResult> => {
      const base = { inputsHash: inputsHash(inputs), executionId: uuidv7(), cached: false, duration: 0, cancelled: false };
      const kind = task.kind.type === 'some' ? task.kind.value : '';
      const elements = new Set<bigint>();
      if (kind === TASK_KIND_MERGE) {
        runs.push(inputs);
        // inputs = [range, ...partials]
        const bounds = decodeRange(await storage.objects.read(repo, inputs[0]!));
        for (const hash of inputs.slice(1)) for (const e of decodeBeast2For(SetOut)(await storage.objects.read(repo, hash))) if (inRange(e, bounds)) elements.add(e);
      } else {
        for (const [key] of decodeBeast2For(OutType)(await storage.objects.read(repo, inputs[1]!))) elements.add(key % 5n);
      }
      const sorted = [...elements].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const outputHash = await storage.objects.write(repo, encodeInSegmentsOf(SetOut, 4)(new Set(sorted)));
      return { ...base, state: 'success', outputHash, exitCode: 0, error: null };
    };
    const task = parentTask('union');
    const taskHash = await writeTask(task);
    const inputs = ['f'.repeat(64), table];
    const result = await executeTemplate(storage, repo, taskHash, task, inputs, { inHash: inputsHash(inputs), executionId: uuidv7(), startTime: Date.now() }, {}, { executeUnit });
    assert.equal(result.state, 'success', result.error ?? '');
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.length, 11, 'the range, then every partial, with no merge IR ahead of them');
    assert.deepEqual([...decodeBeast2For(SetOut)(await readDatasetWhole(storage, repo, result.outputHash!))], [0n, 1n, 2n, 3n, 4n]);
  });
});
