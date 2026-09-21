/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Partitioned task execution — fan-out/fan-in over canonical beast2
 * segments, tested end to end against a real repository with bash-command
 * bodies (`cp` of a staged input is a byte-identity body, so carve → run →
 * splice reconstruction can be asserted byte-for-byte and the execution
 * cache observed directly).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import {
  variant, some, none,
  StringType, IntegerType, NullType, StructType, DictType, ArrayType, SetType,
  East, SortedMap, compareFor, equalFor,
  encodeBeast2For, decodeBeast2For, encodeBeast2PagedFor, encodeBeast2SegmentsFor, encodeEastIR, readBeast2Extents,
  IRType, EastIR,
} from '@elaraai/east';
import { input, partitionTask, runnerToVariant, type Runner, type TaskDef } from '@elaraai/e3';
import {
  TaskObjectType,
  PackageObjectType,
  WorkspaceStateType,
  DatasetRefType,
  TASK_KIND_MERGE,
  TASK_KIND_PARTITION,
  decodePartitionPlan,
  decodeTaskObject,
  encodePartitionTaskMetadata,
  type ExecutionStatus,
  type PackageObject,
  type TaskObject,
  type TreePath,
} from '@elaraai/e3-types';
import type { PartitionProgress } from '@elaraai/e3-types';
import { collectNodeModulesBins, taskExecute, taskExecuteBody, type ExecuteOptions } from './LocalTaskRunner.js';
import { JobSlots } from './jobs.js';
import { carvePartitionSlices, partitionTaskExecute, spliceBlobs, type PartitionUnitExecutor } from './partitionExec.js';
import { MERGE_TREE_FANIN, partitionAssemblyStats } from './steps.js';
import { PartitionBlob, bufferPart, decodedSegmentPeak, prefetchedRangePeak, resetDecodedSegmentPeak, resetPrefetchedRangePeak, spliceChunks } from './partitionIo.js';
import { getBootId, getPidStartTime } from './processHelpers.js';
import { inputsHash } from '../executions.js';
import { uuidv7 } from '../uuid.js';
import { objectWrite } from '../storage/local/LocalObjectStore.js';
import { repoGc } from '../storage/local/gc.js';
import { createTestRepo, removeTestRepo } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = DictType(IntegerType, RowType);

function makeTable(n: number, offset = 0): SortedMap<bigint, { id: bigint; name: string }> {
  const entries: [bigint, { id: bigint; name: string }][] = [];
  for (let i = 0; i < n; i++) {
    const id = BigInt(i + offset);
    entries.push([id, { id, name: `row-${i + offset}` }]);
  }
  return new SortedMap(entries, compareFor(IntegerType));
}

describe('partitionTaskExecute', () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  /** A command IR whose argv copies the staged input at `copyIndex` to the
   *  output — a byte-identity body over that input. */
  async function createCopyCommandIr(copyIndex: number): Promise<string> {
    const commandFn = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      ($, inputs, output) => ['bash', '-c', 'cp "$1" "$2"', '--', inputs.get(BigInt(copyIndex)), output],
    );
    return objectWrite(repo, encodeBeast2For(IRType)(commandFn.toIR().ir));
  }

  /** A placeholder function-IR object (the bash bodies never read it). */
  async function createDummyFnIr(): Promise<string> {
    const fn = East.function([], IntegerType, (_$) => 0n);
    return objectWrite(repo, encodeEastIR(fn.toIR()));
  }

  /** Writes a partition-kind TaskObject copying input `copyIndex` (or
   *  running an explicit command IR when `commandIrHash` is given). */
  async function createPartitionTask(options: {
    copyIndex: number;
    partitions: number;
    targetPartitionBytes: number;
    combine?: Uint8Array;
    merge?: Uint8Array;
    mergeSets?: boolean;
    by?: Uint8Array;
    commandIrHash?: string;
  }): Promise<string> {
    const commandIrHash = options.commandIrHash ?? await createCopyCommandIr(options.copyIndex);
    const metadata = encodePartitionTaskMetadata({
      merge: options.merge !== undefined ? some(options.merge) : none,
      mergeSets: options.mergeSets ?? false,
      mergeCommand: none,
      partitions: BigInt(options.partitions),
      by: options.by !== undefined ? some(options.by) : none,
      combine: options.combine !== undefined ? some(options.combine) : none,
      targetPartitionBytes: BigInt(options.targetPartitionBytes),
    });
    const fieldPath = (...names: string[]): TreePath => names.map((n) => variant('field', n));
    const task: TaskObject = {
      commandIr: commandIrHash,
      inputs: [fieldPath('tasks', 't', 'function_ir'), fieldPath('inputs', 'data')],
      output: fieldPath('tasks', 't', 'output'),
      kind: some(TASK_KIND_PARTITION),
      metadata: some(metadata),
      runner: variant('custom', { command: [] }),
      environment: none,
    };
    return objectWrite(repo, encodeBeast2For(TaskObjectType)(task));
  }

  /** Distinct `(taskHash, inputsHash)` execution identities recorded so far. */
  async function executionCount(taskHash: string): Promise<number> {
    return (await storage.refs.executionListForTask(repo, taskHash)).length;
  }

  it('carves, runs per partition, and splices an identity body back byte-identically', async () => {
    const table = makeTable(1000);
    const tableBlob = encodeBeast2PagedFor(TableType, { batchSize: 100 })(table);
    const tableHash = await storage.objects.write(repo, tableBlob);
    const fnIrHash = await createDummyFnIr();
    // targetPartitionBytes of 1 cuts at every segment: 10 partitions.
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1 });

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    assert.equal(result.state, 'success', result.error ?? '');

    // The identity body's shards are the slices themselves, and splicing
    // them reconstructs the input blob byte-for-byte — same object hash.
    assert.equal(result.outputHash, tableHash);

    // 10 partition executions + the logical record.
    assert.equal(await executionCount(taskHash), 11);
  });

  it('memoizes partitions across runs: an append re-runs only the new tail', async () => {
    const fnIrHash = await createDummyFnIr();
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1 });

    const v1 = encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(1000));
    const v1Hash = await storage.objects.write(repo, v1);
    const first = await taskExecute(storage, repo, taskHash, [fnIrHash, v1Hash]);
    assert.equal(first.state, 'success', first.error ?? '');
    assert.equal(await executionCount(taskHash), 11);

    // Append 100 rows: the first ten 100-row segments stay byte-identical,
    // so their slice executions cache-hit; only the new tail partition and
    // the new logical identity execute.
    const v2 = encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(1100));
    const v2Hash = await storage.objects.write(repo, v2);
    const second = await taskExecute(storage, repo, taskHash, [fnIrHash, v2Hash]);
    assert.equal(second.state, 'success', second.error ?? '');
    assert.equal(second.outputHash, v2Hash);
    assert.equal(await executionCount(taskHash), 13);
  });

  it('a mid-key-space insertion re-runs partitions from the insertion point on', async () => {
    const fnIrHash = await createDummyFnIr();
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1 });

    const v1Hash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(1000)));
    const first = await taskExecute(storage, repo, taskHash, [fnIrHash, v1Hash]);
    assert.equal(first.state, 'success', first.error ?? '');
    assert.equal(await executionCount(taskHash), 11);

    // Inserting one key mid-space shifts every subsequent segment's packing:
    // the five segments before the insertion stay byte-identical (cache
    // hits); the six from it on differ and re-run. Append-friendly, not
    // general — this pins that honest strength.
    const shifted = new SortedMap<bigint, { id: bigint; name: string }>(
      [...makeTable(1000)].map(([k, v]) => [k < 500n ? k : k + 1n, v] as [bigint, { id: bigint; name: string }]),
      compareFor(IntegerType),
    );
    shifted.set(500n, { id: 500n, name: 'inserted' });
    const v2Hash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(shifted));
    const second = await taskExecute(storage, repo, taskHash, [fnIrHash, v2Hash]);
    assert.equal(second.state, 'success', second.error ?? '');
    assert.equal(second.outputHash, v2Hash);
    // 1001 rows → 11 segments/partitions; the first 5 slices (keys 0..499)
    // are byte-identical and cache-hit, the remaining 6 and the new logical
    // identity execute: 11 + 6 + 1.
    assert.equal(await executionCount(taskHash), 18);
  });

  it('folds partials pairwise in a fixed tree when combine is present', async () => {
    const table = makeTable(1000);
    const tableBlob = encodeBeast2PagedFor(TableType, { batchSize: 100 })(table);
    const tableHash = await storage.objects.write(repo, tableBlob);
    const fnIrHash = await createDummyFnIr();
    // A take-left combine: each merge execution copies its first partial
    // (staged input 1; input 0 is the combine IR).
    const combineFn = East.function([TableType, TableType], TableType, ($, a, _b) => $.return(a));
    const taskHash = await createPartitionTask({
      copyIndex: 1,
      partitions: 1,
      targetPartitionBytes: 1,
      combine: encodeEastIR(combineFn.toIR()),
    });

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    assert.equal(result.state, 'success', result.error ?? '');

    // Take-left over the fixed pairwise tree of 10 shards resolves to shard
    // 0 — the first 100-row slice.
    const output = await storage.objects.read(repo, result.outputHash!);
    const decoded = decodeBeast2For(TableType)(output);
    assert.equal(decoded.size, 100);
    assert.equal(decoded.get(0n)?.name, 'row-0');
    assert.equal(decoded.get(99n)?.name, 'row-99');

    // 10 partition executions + 9 merges (5 + 2 + 1 + 1) + the logical record.
    assert.equal(await executionCount(taskHash), 20);
  });

  it('merge mode assembles disjoint shards by byte copy, with no runner-side fold', async () => {
    const table = makeTable(1000);
    const tableBlob = encodeBeast2PagedFor(TableType, { batchSize: 100 })(table);
    const tableHash = await storage.objects.write(repo, tableBlob);
    const fnIrHash = await createDummyFnIr();
    const mergeFn = East.function([IntegerType, RowType, RowType], RowType, ($, _k, a, _b) => $.return(a));
    const taskHash = await createPartitionTask({
      copyIndex: 1,
      partitions: 1,
      targetPartitionBytes: 1,
      merge: encodeEastIR(mergeFn.toIR()),
    });

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    assert.equal(result.state, 'success', result.error ?? '');

    // The identity body's shards are the input's own segments and cannot
    // collide, so the segment merge degenerates to the splice: the input
    // blob, byte for byte.
    assert.equal(result.outputHash, tableHash);
    // 10 partition executions + the logical record — and NO combine
    // executions: the fan-in ran in the orchestrator.
    assert.equal(await executionCount(taskHash), 11);
  });

  it('merge mode refuses to merge colliding shards on the custom runtime', async () => {
    const table = makeTable(1000);
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(table));
    // Every partition copies the same broadcast blob: ten shards with
    // identical key ranges, which only merge units on a stock runner merge.
    const broadcastHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(50)));
    const fnIrHash = await createDummyFnIr();
    const mergeFn = East.function([IntegerType, RowType, RowType], RowType, ($, _k, a, _b) => $.return(a));
    const taskHash = await createPartitionTask({
      copyIndex: 2,
      partitions: 1,
      targetPartitionBytes: 1,
      merge: encodeEastIR(mergeFn.toIR()),
    });

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash, broadcastHash]);
    assert.equal(result.state, 'error');
    assert.equal(result.error, 'partition merge needs a stock runtime (east-c, east-node, east-py); this task uses the custom runtime');
  });

  /** Stores an SDK-built task as `e3.export` would: its function IR, its
   *  command IR and its task object. */
  async function writeSdkTask(def: TaskDef): Promise<{ taskHash: string; fnIrHash: string }> {
    const fnIrHash = await objectWrite(repo, encodeEastIR(def.inputs[0]!.default as unknown as EastIR<never[], unknown>));
    const commandIrHash = await objectWrite(repo, encodeEastIR(def.command));
    const task: TaskObject = {
      commandIr: commandIrHash,
      inputs: def.inputs.map((i) => i.path),
      output: def.output.path,
      kind: some(def.taskKind!),
      metadata: some(def.metadata!),
      runner: runnerToVariant(def.runner!),
      environment: none,
    };
    return { taskHash: await objectWrite(repo, encodeBeast2For(TaskObjectType)(task)), fnIrHash };
  }

  /** The logical execution's log, line by line. */
  async function logLines(taskHash: string, result: { inputsHash: string; executionId: string }): Promise<string[]> {
    const log = await storage.logs.read(repo, taskHash, result.inputsHash, result.executionId, 'stdout');
    return log.data.split('\n').filter((line) => line !== '');
  }

  it('merges colliding keyed partials on the task runner through a merge tree, logging every unit', async () => {
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(1000)));
    // Every partition counts its rows onto the same seven keys: the ten
    // partials overlap everywhere, so they form one component, merged by one
    // unit of the runner's `merge` command.
    const counts = partitionTask('counts', {
      partitions: [input('table', TableType)],
      output: DictType(IntegerType, IntegerType),
      merge: ($, _key, a, b) => a.add(b),
      targetPartitionBytes: 1,
      runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] },
    }, ($, slice) => slice.toDict(($, _row, key) => key.remainder(7n), ($, _row, _key) => 1n, ($, a, b) => a.add(b)));
    const { taskHash, fnIrHash } = await writeSdkTask(counts);

    // The logical execution is recorded `running` before any unit runs: the
    // executor reads it before running the first units.
    const inputs = [fnIrHash, tableHash];
    const ids = { inHash: inputsHash(inputs), executionId: uuidv7(), startTime: Date.now() };
    let runningStatus: Promise<ExecutionStatus | null> | undefined;
    const executeUnit: PartitionUnitExecutor = async (unitTaskHash, unitTask, unitInputs, unitOptions) => {
      runningStatus ??= storage.refs.executionGet(repo, taskHash, ids.inHash, ids.executionId);
      await runningStatus;
      return taskExecuteBody(storage, repo, unitTaskHash, unitTask, unitInputs,
        { inHash: inputsHash(unitInputs), executionId: uuidv7(), startTime: Date.now() }, unitOptions);
    };
    const task = decodeTaskObject(await storage.objects.read(repo, taskHash));
    const result = await partitionTaskExecute(storage, repo, taskHash, task, inputs, ids, {}, executeUnit);
    assert.equal(result.state, 'success', result.error ?? '');

    const running = await runningStatus;
    assert.equal(running?.type, 'running');
    assert.equal(running?.type === 'running' ? running.value.pid : null, BigInt(process.pid));
    const owner = await storage.refs.executionOwnerRead!(repo, taskHash, ids.inHash, ids.executionId);
    assert.deepEqual(owner, { pid: process.pid, pidStartTime: await getPidStartTime(process.pid), bootId: await getBootId() });

    const expected = new SortedMap<bigint, bigint>([], compareFor(IntegerType));
    for (let i = 0; i < 1000; i++) {
      const key = BigInt(i % 7);
      expected.set(key, (expected.get(key) ?? 0n) + 1n);
    }
    const merged = decodeBeast2For(DictType(IntegerType, IntegerType))(await storage.objects.read(repo, result.outputHash!));
    assert.ok(equalFor(DictType(IntegerType, IntegerType))(merged, expected), 'every key counts all its rows once');

    // One line per unit, naming each unit's execution in full.
    const lines = await logLines(taskHash, result);
    const unitLine = /^(partition \d+\/10|merge level 1\/1 unit 1\/1) (completed|cached) task=([0-9a-f]{64}) inputs=([0-9a-f]{64}) execution=(\S+) duration=\d+$/;
    assert.equal(lines.length, 11, lines.join('\n'));
    for (const line of lines) {
      const match = unitLine.exec(line);
      assert.ok(match, line);
      const status = await storage.refs.executionGet(repo, match[3]!, match[4]!, match[5]!);
      assert.equal(status?.type, 'success', line);
    }
    assert.deepEqual(
      lines.filter((line) => line.startsWith('partition ')).map((line) => line.split(' ')[1]).sort(),
      Array.from({ length: 10 }, (_, p) => `${p + 1}/10`).sort(),
    );
    assert.deepEqual(
      lines.filter((line) => line.startsWith('merge ')).map((line) => line.split(' ').slice(0, 5).join(' ')),
      ['merge level 1/1 unit 1/1'],
    );
    // The unit ran the runner's `merge` command: a task of the merge kind
    // whose command IR is the package's own mergeCommand.
    const mergeLine = lines.find((line) => line.startsWith('merge '))!;
    const unitTask = decodeTaskObject(await storage.objects.read(repo, unitLine.exec(mergeLine)![3]!));
    assert.deepEqual(unitTask.kind, some(TASK_KIND_MERGE));
    assert.deepEqual(unitTask.metadata, none);
    assert.deepEqual(unitTask.runner, task.runner);
  });

  describe('orchestrator memory does not depend on output size', () => {
    /** Units the merge tree runs over `n` overlapping partials. */
    const plannedUnits = (n: number): number => {
      let units = 0;
      for (let entries = n; entries > 1; entries = Math.ceil(entries / MERGE_TREE_FANIN)) {
        units += Math.ceil(entries / MERGE_TREE_FANIN) - (entries % MERGE_TREE_FANIN === 1 ? 1 : 0);
      }
      return units;
    };

    /** Whether a runner resolves where e3 looks for one. */
    const runnerAvailable = (binary: string): boolean => spawnSync(binary, ['version'], {
      stdio: 'ignore',
      env: { ...process.env, PATH: [...collectNodeModulesBins(process.cwd()), process.env.PATH ?? ''].join(delimiter) },
    }).status === 0;

    const cases: { name: string; runner: Runner; available: boolean }[] = [
      { name: 'east-node', runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] }, available: true },
      { name: 'east-c', runner: { runtime: 'east-c', platforms: ['east-c-std'] }, available: runnerAvailable('east-c') },
    ];

    for (const { name, runner, available } of cases) {
      it(`${name}: the assembly's counters are the same at N and 8N rows and 4 and 20 partitions, and no data object is read whole`,
        { skip: available ? false : `${name} not on PATH` }, async () => {
          // Re-keys every row by a scattered id: each partial spans the whole
          // key space, so every partial overlaps every other.
          const rekeyed = partitionTask(`rekeyed_${name.replace('-', '_')}`, {
            partitions: [input('table', TableType)],
            output: TableType,
            merge: ($, _key, a, _b) => a,
            targetPartitionBytes: 1,
            runner,
          }, ($, slice) => slice.toDict(($, _row, key) => key.multiply(7919n).remainder(1_000_003n), ($, row, _key) => row));
          const { taskHash, fnIrHash } = await writeSdkTask(rekeyed);

          // Gate (a): the orchestrator never reads a data object whole — not
          // the input, a slice, a partial or a unit output. Every whole read
          // during a run is recorded and checked against them afterwards.
          const objects = storage.objects;
          const wholeReads = new Set<string>();
          const origRead = objects.read.bind(objects);
          objects.read = (r: string, h: string) => {
            wholeReads.add(h);
            return origRead(r, h);
          };

          const observed: { rows: number; partitions: number; peakDecodedSegments: number; compiledFunctions: number; units: number }[] = [];
          for (const rows of [400, 3200]) {
            for (const partitions of [4, 20]) {
              const table = makeTable(rows);
              const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: rows / partitions })(table));
              let result: Awaited<ReturnType<typeof taskExecute>> | undefined;
              wholeReads.clear();
              const stats = await partitionAssemblyStats(async () => {
                result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
              });
              assert.equal(result?.state, 'success', result?.error ?? '');

              const dataObjects = new Set<string>([tableHash, result!.outputHash!]);
              const planHash = await storage.refs.executionPlanRead!(repo, taskHash, result!.inputsHash);
              for (const slices of decodePartitionPlan(await origRead(repo, planHash!)).slices) for (const slice of slices) dataObjects.add(slice);
              const unitTasks = new Set<string>([taskHash]);
              for (const line of await logLines(taskHash, result!)) unitTasks.add(/task=([0-9a-f]{64})/.exec(line)![1]!);
              for (const unitTask of unitTasks) {
                for (const { status } of await storage.refs.executionListLatest(repo, unitTask)) {
                  if (status.type === 'success') dataObjects.add(status.value.outputHash);
                }
              }
              const readWhole = [...wholeReads].filter((h) => dataObjects.has(h));
              assert.deepEqual(readWhole, [], `data objects read whole (${rows} rows, ${partitions} partitions): ${readWhole.join(', ')}`);

              const expected = new SortedMap<bigint, { id: bigint; name: string }>([], compareFor(IntegerType));
              for (const [id, row] of table) expected.set((id * 7919n) % 1_000_003n, row);
              const output = decodeBeast2For(TableType)(await storage.objects.read(repo, result!.outputHash!));
              assert.ok(equalFor(TableType)(output, expected), `${rows} rows, ${partitions} partitions`);

              observed.push({ rows, partitions, ...stats });
            }
          }

          for (const run of observed) {
            assert.equal(run.compiledFunctions, 0, `no merge function compiled in process (${run.rows} rows, ${run.partitions} partitions)`);
            assert.equal(run.units, plannedUnits(run.partitions), `the planned tree (${run.rows} rows, ${run.partitions} partitions)`);
            assert.equal(run.peakDecodedSegments, observed[0]!.peakDecodedSegments,
              `decoded segments held at once must not grow with rows or partitions: ${JSON.stringify(observed)}`);
          }
        });
    }
  });

  it('merges Set partials by union on the task runner', async () => {
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(300)));
    const keys = partitionTask('keys', {
      partitions: [input('table', TableType)],
      output: SetType(IntegerType),
      merge: 'union',
      targetPartitionBytes: 1,
      runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] },
    }, ($, slice) => slice.toSet(($, _row, key) => key.remainder(5n)));
    const { taskHash, fnIrHash } = await writeSdkTask(keys);

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    assert.equal(result.state, 'success', result.error ?? '');
    const merged = decodeBeast2For(SetType(IntegerType))(await storage.objects.read(repo, result.outputHash!));
    assert.deepEqual([...merged], [0n, 1n, 2n, 3n, 4n]);
    // Three overlapping partials: one unit merges them.
    const mergeLines = (await logLines(taskHash, result)).filter((line) => line.startsWith('merge '));
    assert.deepEqual(mergeLines.map((line) => line.split(' ').slice(0, 6).join(' ')), ['merge level 1/1 unit 1/1 completed']);
  });

  it('merge mode stores an empty collection when every partial is empty', async () => {
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(200)));
    const nothing = partitionTask('nothing', {
      partitions: [input('table', TableType)],
      output: DictType(IntegerType, IntegerType),
      merge: ($, _key, a, _b) => a,
      targetPartitionBytes: 1,
      runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] },
    }, ($, slice) => slice
      .filter(($, _row, key) => East.less(key, 0n))
      .toDict(($, _row, key) => key, ($, _row, _key) => 1n));
    const { taskHash, fnIrHash } = await writeSdkTask(nothing);

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    assert.equal(result.state, 'success', result.error ?? '');
    const output = await storage.objects.read(repo, result.outputHash!);
    assert.equal(decodeBeast2For(DictType(IntegerType, IntegerType))(output).size, 0);
    assert.equal(readBeast2Extents(output).offsets.length, 0);
    assert.deepEqual((await logLines(taskHash, result)).filter((line) => line.startsWith('merge ')), []);
  });

  it('rejects splice-mode shards that do not ascend disjointly, naming the remedy', async () => {
    const table = makeTable(1000);
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(table));
    // Every partition's body copies the same broadcast blob, so adjacent
    // shards hold identical key ranges — a splice-contract violation.
    const broadcast = encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(50));
    const broadcastHash = await storage.objects.write(repo, broadcast);
    const fnIrHash = await createDummyFnIr();
    const taskHash = await createPartitionTask({ copyIndex: 2, partitions: 1, targetPartitionBytes: 1 });

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash, broadcastHash]);
    assert.equal(result.state, 'error');
    assert.match(result.error ?? '', /do not ascend disjointly in key order/);
    assert.match(result.error ?? '', /combine/);
  });

  it('co-partitions a secondary at the primary boundaries, re-encoding only split edges', async () => {
    const primary = makeTable(1000);
    const primaryHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(primary));
    // The secondary covers a sub-range with segment boundaries that do NOT
    // line up with the primary's fences, so most partition boundaries land
    // inside its segments and exercise the edge rebuild.
    const secondary = makeTable(500, 250);
    const secondaryBlob = encodeBeast2PagedFor(TableType, { batchSize: 100 })(secondary);
    const secondaryHash = await storage.objects.write(repo, secondaryBlob);
    const fnIrHash = await createDummyFnIr();
    // Each partition's body copies its SECONDARY slice (staged input 2).
    const taskHash = await createPartitionTask({ copyIndex: 2, partitions: 2, targetPartitionBytes: 1 });

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, primaryHash, secondaryHash]);
    assert.equal(result.state, 'success', result.error ?? '');

    // Splicing the secondary slices reassembles exactly the secondary value
    // (not byte-identical — split edges re-encode — but value-equal, with
    // every key exactly once in canonical order).
    const output = await storage.objects.read(repo, result.outputHash!);
    const eq = equalFor(TableType);
    assert.ok(eq(decodeBeast2For(TableType)(output), secondary));
    const extents = readBeast2Extents(output);
    assert.equal(extents.elementCount, 500);
  });

  it('carves and splices at bounded orchestrator memory: partitioned inputs are never whole-read', async () => {
    // Semi-random row content defeats deflate enough that the blob dwarfs
    // every legitimate single read — the read bound below is then real, not
    // vacuously satisfied by a tiny fixture.
    const entries: [bigint, { id: bigint; name: string }][] = [];
    for (let i = 0; i < 30_000; i++) {
      const id = BigInt(i);
      const salt = ((i * 2654435761) >>> 0).toString(36) + ((i * 1103515245 + 12345) >>> 0).toString(36);
      entries.push([id, { id, name: `row-${i}-${salt}` }]);
    }
    const table = new SortedMap(entries, compareFor(IntegerType));
    const tableBlob = encodeBeast2PagedFor(TableType, { batchSize: 2000 })(table);
    const tableHash = await storage.objects.write(repo, tableBlob);
    const fnIrHash = await createDummyFnIr();
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1 });

    // The largest legitimate single read on the ranged path: one segment
    // frame (boundary probes, single-segment spans) or the 64 KiB tail
    // probe. Anything approaching the whole blob is a regression.
    const extents = readBeast2Extents(tableBlob);
    const segmentBytes = extents.offsets.map((o, i) =>
      (i + 1 < extents.offsets.length ? extents.offsets[i + 1]! : extents.segmentsEnd) - o);
    const readBound = Math.max(...segmentBytes, 64 * 1024);
    assert.ok(tableBlob.length > 2 * readBound,
      `precondition: the blob (${tableBlob.length} B) must dwarf the largest legitimate read (${readBound} B), or the bound cannot fail`);

    // Spy on the object store: the partitioned input must flow only through
    // ranged reads (extents from head + tail, boundary probes, span copies)
    // — never a whole read. (Slice objects themselves are still whole-read
    // by input marshalling to the runner, which is the standard path's
    // documented, slice-bounded cost.)
    const objects = storage.objects;
    let wholeInputReads = 0;
    let maxRangeLength = 0;
    const origRead = objects.read.bind(objects);
    const origRange = objects.readRange!.bind(objects);
    objects.read = (r: string, h: string) => {
      if (h === tableHash) wholeInputReads++;
      return origRead(r, h);
    };
    objects.readRange = (r: string, h: string, offset: number, length: number) => {
      if (h === tableHash) maxRangeLength = Math.max(maxRangeLength, length);
      return origRange(r, h, offset, length);
    };

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    assert.equal(result.state, 'success', result.error ?? '');
    // The streamed carve + splice reproduce the input byte-identically.
    assert.equal(result.outputHash, tableHash);
    assert.equal(wholeInputReads, 0, 'the partitioned input must never be whole-read');
    assert.ok(maxRangeLength <= readBound,
      `every ranged read of the input (max ${maxRangeLength} B) must stay within one segment frame / tail probe (${readBound} B)`);
  });

  it('degrades to whole reads behind the same path when the backend has no ranged reads', async () => {
    const table = makeTable(1000);
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(table));
    const fnIrHash = await createDummyFnIr();
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1 });
    (storage.objects as { readRange?: unknown }).readRange = undefined;

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    assert.equal(result.state, 'success', result.error ?? '');
    assert.equal(result.outputHash, tableHash, 'the fallback still reconstructs byte-identically');
  });

  it('a single-partition plan short-circuits to one standard execution under the logical identity', async () => {
    const table = makeTable(1000);
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(table));
    const fnIrHash = await createDummyFnIr();
    // A huge byte target packs every segment into one partition.
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1 << 30 });

    // The short-circuit must not carve or splice: no streamed object writes.
    const objects = storage.objects;
    let streamWrites = 0;
    const origWriteStream = objects.writeStream.bind(objects);
    objects.writeStream = (r: string, s: AsyncIterable<Uint8Array>) => {
      streamWrites++;
      return origWriteStream(r, s);
    };

    const events: PartitionProgress[] = [];
    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash], {
      onPartitionProgress: (p) => events.push(p),
    });
    assert.equal(result.state, 'success', result.error ?? '');
    assert.equal(result.outputHash, tableHash, 'the identity body copies the whole input');
    assert.equal(streamWrites, 0, 'no slice or splice objects are written');
    // Exactly one execution identity — the logical one; a carved P=1 slice
    // would have collided with it and double-recorded.
    assert.equal(await executionCount(taskHash), 1);
    assert.deepEqual(events, [
      { phase: 'partition', index: 0, total: 1, completed: 0, state: 'started' },
      { phase: 'partition', index: 0, total: 1, completed: 1, state: 'completed', cached: false, duration: events[1]?.duration },
    ]);
  });

  /** Counts streamed object writes — slice carves and output splices. */
  function countStreamWrites(): { readonly count: number } {
    const counter = { count: 0 };
    const objects = storage.objects;
    const origWriteStream = objects.writeStream.bind(objects);
    objects.writeStream = (r: string, s: AsyncIterable<Uint8Array>) => {
      counter.count++;
      return origWriteStream(r, s);
    };
    return counter;
  }

  it('records the completed plan and reuses its slices on a forced re-run', async () => {
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(1000)));
    const fnIrHash = await createDummyFnIr();
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1 });

    const first = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    assert.equal(first.state, 'success', first.error ?? '');

    // The plan sidecar names the completed plan: a cut at each of the ten
    // segments, no secondaries, and one carved slice per partition.
    const planHash = await storage.refs.executionPlanRead!(repo, taskHash, first.inputsHash);
    assert.notEqual(planHash, null);
    const plan = decodePartitionPlan(await storage.objects.read(repo, planHash!));
    assert.deepEqual(plan.partitions, [tableHash]);
    assert.deepEqual(plan.boundaries, Array.from({ length: 10 }, (_, i) => BigInt(i)));
    assert.deepEqual(plan.splits, []);
    assert.equal(plan.slices.length, 1);
    assert.equal(plan.slices[0]!.length, 10);
    // Carving is a pure function of the plan.
    assert.deepEqual(await carvePartitionSlices(storage, repo, plan, 3), [plan.slices[0]![3]]);

    // A forced re-run executes every partition again but carves nothing: the
    // output splice is its only streamed write.
    const streamWrites = countStreamWrites();
    const second = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash], { force: true });
    assert.equal(second.state, 'success', second.error ?? '');
    assert.equal(second.outputHash, tableHash);
    assert.equal(streamWrites.count, 1, 'only the output splice is streamed');
    for (const slice of plan.slices[0]!) {
      const ids = await storage.refs.executionListIds(repo, taskHash, inputsHash([fnIrHash, slice]));
      assert.equal(ids.length, 2, 'every partition executed on both runs');
    }
  });

  it('carves again when a slice the recorded plan names no longer exists', async () => {
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(1000)));
    const fnIrHash = await createDummyFnIr();
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1 });

    const first = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    assert.equal(first.state, 'success', first.error ?? '');
    const planHash = await storage.refs.executionPlanRead!(repo, taskHash, first.inputsHash);
    const plan = decodePartitionPlan(await storage.objects.read(repo, planHash!));

    // The store reports one recorded slice missing, as after a gc sweep.
    const gone = plan.slices[0]![3]!;
    const objects = storage.objects;
    const origStat = objects.stat.bind(objects);
    let reportedGone = false;
    objects.stat = (r: string, h: string) => {
      if (h === gone && !reportedGone) {
        reportedGone = true;
        return Promise.reject(new Error(`object ${h} not found`));
      }
      return origStat(r, h);
    };
    const streamWrites = countStreamWrites();

    const second = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash], { force: true });
    assert.equal(second.state, 'success', second.error ?? '');
    assert.equal(second.outputHash, tableHash);
    assert.ok(reportedGone, 'the reuse check looked the slice up');
    assert.equal(streamWrites.count, 2, 'only the missing slice carves again, then the output splices');
  });

  it('carves a partition when a worker picks it up, and records the plan with what was carved', async () => {
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(1000)));
    const fnIrHash = await createDummyFnIr();
    const failFn = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      (_$, _inputs, _output) => ['bash', '-c', 'exit 3'],
    );
    const commandIrHash = await objectWrite(repo, encodeBeast2For(IRType)(failFn.toIR().ir));
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1, commandIrHash });
    const streamWrites = countStreamWrites();

    // One worker: the first partition fails, so the pool stops before
    // picking up another. The plan is recorded with the one carved slice and
    // '' for the rest, so a retry carves only those.
    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash], { partitionConcurrency: 1 });
    assert.equal(result.state, 'failed');
    assert.equal(streamWrites.count, 1, 'only the first partition was carved');
    const planHash = await storage.refs.executionPlanRead!(repo, taskHash, result.inputsHash);
    assert.notEqual(planHash, null);
    const plan = decodePartitionPlan(await storage.objects.read(repo, planHash!));
    assert.equal(plan.slices[0]!.length, 10);
    assert.notEqual(plan.slices[0]![0], '');
    assert.deepEqual(plan.slices[0]!.slice(1), Array.from({ length: 9 }, () => ''));
  });

  it('runs a unit through executeUnit only when the execution cache misses', async () => {
    const fnIrHash = await createDummyFnIr();
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1 });
    const v1Hash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(1000)));
    const first = await taskExecute(storage, repo, taskHash, [fnIrHash, v1Hash]);
    assert.equal(first.state, 'success', first.error ?? '');

    const task = decodeTaskObject(await storage.objects.read(repo, taskHash));
    const units: string[][] = [];
    const executeUnit: PartitionUnitExecutor = (unitTaskHash, unitTask, unitInputs, unitOptions) => {
      units.push(unitInputs);
      return taskExecuteBody(storage, repo, unitTaskHash, unitTask, unitInputs,
        { inHash: inputsHash(unitInputs), executionId: uuidv7(), startTime: Date.now() }, unitOptions);
    };
    const run = (inputs: string[], options: ExecuteOptions) => partitionTaskExecute(
      storage, repo, taskHash, task, inputs,
      { inHash: inputsHash(inputs), executionId: uuidv7(), startTime: Date.now() }, options, executeUnit);

    // An append leaves the first ten slices byte-identical: only the new
    // tail partition misses the cache.
    const v2Hash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(1100)));
    const appended = await run([fnIrHash, v2Hash], {});
    assert.equal(appended.state, 'success', appended.error ?? '');
    assert.equal(appended.outputHash, v2Hash);
    assert.equal(units.length, 1, 'only the tail partition runs');

    // `force` skips the probe: every partition runs.
    units.length = 0;
    const forced = await run([fnIrHash, v2Hash], { force: true });
    assert.equal(forced.state, 'success', forced.error ?? '');
    assert.equal(units.length, 11);
  });

  it('fails the map step when a unit reports success without an output', async () => {
    // The unit executor is a seam — a mock here, a remote kernel in a cloud
    // deployment — so a result that claims success while carrying no output
    // is reachable. The reduce step already refused one; the map step took
    // the hash on trust, which put a null into the partial list and surfaced
    // far downstream, if at all.
    const fnIrHash = await createDummyFnIr();
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1 });
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(1000)));
    const task = decodeTaskObject(await storage.objects.read(repo, taskHash));

    let unit = 0;
    const executeUnit: PartitionUnitExecutor = async (unitTaskHash, unitTask, unitInputs, unitOptions) => {
      const ids = { inHash: inputsHash(unitInputs), executionId: uuidv7(), startTime: Date.now() };
      const result = await taskExecuteBody(storage, repo, unitTaskHash, unitTask, unitInputs, ids, unitOptions);
      // The second partition succeeds, having written nothing.
      return ++unit === 2 ? { ...result, outputHash: null } : result;
    };

    const inputs = [fnIrHash, tableHash];
    const result = await partitionTaskExecute(
      storage, repo, taskHash, task, inputs,
      { inHash: inputsHash(inputs), executionId: uuidv7(), startTime: Date.now() }, { jobs: new JobSlots(1) }, executeUnit);

    assert.equal(result.state, 'error');
    assert.match(result.error ?? '', /^Partition 2 of 10 reported success without writing an output$/);
  });

  it('spliceBlobs splices stored blobs in order, and refuses keys that do not ascend', async () => {
    const encode = encodeBeast2PagedFor(TableType, { batchSize: 100 });
    const lowHash = await storage.objects.write(repo, encode(makeTable(250)));
    const highHash = await storage.objects.write(repo, encode(makeTable(250, 250)));

    const spliced = await storage.objects.read(repo, await spliceBlobs(storage, repo, [lowHash, highHash]));
    assert.ok(equalFor(TableType)(decodeBeast2For(TableType)(spliced), makeTable(500)));
    assert.equal(readBeast2Extents(spliced).offsets.length, 6, 'both blobs keep their segments');

    await assert.rejects(
      spliceBlobs(storage, repo, [highHash, lowHash]),
      /blobs 1 and 2 of 2 do not ascend disjointly in key order/,
    );
  });

  it('draws every unit of a partitioned task from the run\'s jobs budget', async () => {
    // Ten partitions whose bodies each sleep long enough to overlap, under a
    // budget of two: the pool is as wide as the budget, and the budget — not
    // the pool — bounds the runners in flight.
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(1000)));
    const fnIrHash = await createDummyFnIr();
    const sleepyCopy = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      ($, inputs, output) => ['bash', '-c', 'sleep 0.2; cp "$1" "$2"', '--', inputs.get(1n), output],
    );
    const commandIrHash = await objectWrite(repo, encodeBeast2For(IRType)(sleepyCopy.toIR().ir));
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1, commandIrHash });

    const jobs = new JobSlots(2);
    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash], { jobs });
    assert.equal(result.state, 'success', result.error ?? '');
    assert.equal(result.outputHash, tableHash);
    assert.equal(jobs.peak, 2, 'two units in flight at once, never more');
    assert.equal(jobs.inFlight, 0);
    assert.equal(await executionCount(taskHash), 11);
  });

  it('reports per-unit progress across the fan-out and every combine level', async () => {
    const table = makeTable(1000);
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(table));
    const fnIrHash = await createDummyFnIr();
    const combineFn = East.function([TableType, TableType], TableType, ($, a, _b) => $.return(a));
    const taskHash = await createPartitionTask({
      copyIndex: 1,
      partitions: 1,
      targetPartitionBytes: 1,
      combine: encodeEastIR(combineFn.toIR()),
    });

    const events: PartitionProgress[] = [];
    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash], {
      partitionConcurrency: 3,
      onPartitionProgress: (p) => events.push(p),
    });
    assert.equal(result.state, 'success', result.error ?? '');

    const completed = events.filter((e) => e.state === 'completed');
    const started = events.filter((e) => e.state === 'started');
    assert.equal(started.length, completed.length, 'every unit reports both transitions');
    const partitionUnits = completed.filter((e) => e.phase === 'partition');
    assert.equal(partitionUnits.length, 10, 'one completion per partition');
    assert.deepEqual(new Set(partitionUnits.map((e) => e.index)), new Set(Array.from({ length: 10 }, (_, i) => i)));
    assert.ok(partitionUnits.every((e) => e.total === 10));
    // Completions count up across the pool, whichever partition finishes.
    assert.deepEqual(partitionUnits.map((e) => e.completed), Array.from({ length: 10 }, (_, i) => i + 1));
    // Pairwise tree over 10 shards: 5 + 2 + 1 + 1 merges, reported per level.
    const combineUnits = completed.filter((e) => e.phase === 'combine');
    assert.equal(combineUnits.length, 9);
    assert.deepEqual(
      combineUnits.map((e) => e.total).sort((a, b) => a - b),
      [1, 1, 2, 2, 5, 5, 5, 5, 5],
    );
  });

  it('gc between runs keeps partition memoization intact', async () => {
    const fnIrHash = await createDummyFnIr();
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1 });

    const v1Hash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(1000)));
    const first = await taskExecute(storage, repo, taskHash, [fnIrHash, v1Hash]);
    assert.equal(first.state, 'success', first.error ?? '');
    assert.equal(await executionCount(taskHash), 11);

    // Root the durable objects the way a deployed workspace would — a
    // package ref reaching the task (and its command IR), and dataset refs
    // pinning the function IR + input blob. The carved slices stay
    // UNREFERENCED (they are execution inputs, never outputs or refs), so
    // gc prunes exactly them.
    const pkgHash = await storage.objects.write(repo, encodeBeast2For(PackageObjectType)({
      tasks: new Map([['t', taskHash]]),
      data: { structure: variant('struct', new Map()), refs: new Map() },
      functions: new Map(),
      records: new Map(), sources: new Map(),
    } as PackageObject));
    mkdirSync(join(repo, 'packages', 'p'), { recursive: true });
    writeFileSync(join(repo, 'packages', 'p', '1.0.0'), pkgHash + '\n');
    writeFileSync(join(repo, 'workspaces', 'w.beast2'), encodeBeast2For(WorkspaceStateType)({
      packageName: 'p',
      packageVersion: '1.0.0',
      packageHash: pkgHash,
      deployedAt: new Date(),
      currentRunId: none,
    }));
    const refEncoder = encodeBeast2For(DatasetRefType);
    mkdirSync(join(repo, 'workspaces', 'w', 'data'), { recursive: true });
    writeFileSync(join(repo, 'workspaces', 'w', 'data', 'input.ref'), refEncoder(variant('value', { hash: v1Hash, versions: new Map() })));
    writeFileSync(join(repo, 'workspaces', 'w', 'data', 'fn.ref'), refEncoder(variant('value', { hash: fnIrHash, versions: new Map() })));

    // GC collects execution roots from success outputHash only — with the
    // identity body the shard outputs coincide with the slices, so the gc
    // here is a full mark-and-sweep over live roots. The records stay, and
    // re-carving is deterministic, so identities re-match afterwards.
    await repoGc(new LocalStorage(dirname(repo)), repo, { minAge: 0 });

    const v2Hash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(1100)));
    const second = await taskExecute(storage, repo, taskHash, [fnIrHash, v2Hash]);
    assert.equal(second.state, 'success', second.error ?? '');
    assert.equal(second.outputHash, v2Hash);
    // Identical to the no-gc append test: 10 cache hits, only the new tail
    // partition + the new logical identity execute.
    assert.equal(await executionCount(taskHash), 13);
  });

  it('a failed partition names the LOWEST failing index and carries the runner error tail', async () => {
    const table = makeTable(1000);
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(table));
    const fnIrHash = await createDummyFnIr();
    // Every slice execution fails with a distinctive stderr line.
    const failFn = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      (_$, _inputs, _output) => ['bash', '-c', 'echo carve-boom >&2; exit 3'],
    );
    const commandIrHash = await objectWrite(repo, encodeBeast2For(IRType)(failFn.toIR().ir));
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1, commandIrHash });

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash], { partitionConcurrency: 4 });
    assert.equal(result.state, 'failed');
    assert.equal(result.exitCode, 3);
    // Deterministic attribution: with every partition failing, the reported
    // one is always the first — not whichever worker settled first.
    assert.match(result.error ?? '', /^Partition 1 of 10 failed \(exit code 3\)/);
    // The runner's stderr tail rides the message, so the cause is visible
    // without digging into the sub-execution's logs.
    assert.match(result.error ?? '', /carve-boom/);
  });

  it('a failed combine step records `failed` with the exit code, not an orchestrator error', async () => {
    const table = makeTable(1000);
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(table));
    const fnIrHash = await createDummyFnIr();
    // Slice executions see 2 staged inputs (fnIr + slice) and copy; combine
    // executions see 3 (combineIr + two partials) and fail with exit 7.
    const combineFailsFn = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      ($, inputs, output) => {
        $.if(East.equal(inputs.size(), 3n), ($) => {
          $.return(['bash', '-c', 'echo merge-boom >&2; exit 7']);
        });
        $.return(['bash', '-c', 'cp "$1" "$2"', '--', inputs.get(1n), output]);
      },
    );
    const commandIrHash = await objectWrite(repo, encodeBeast2For(IRType)(combineFailsFn.toIR().ir));
    const combineFn = East.function([TableType, TableType], TableType, ($, a, _b) => $.return(a));
    const taskHash = await createPartitionTask({
      copyIndex: 1,
      partitions: 1,
      targetPartitionBytes: 1,
      combine: encodeEastIR(combineFn.toIR()),
      commandIrHash,
    });

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    // The runner's own exit must survive as a `failed` state (it was
    // previously collapsed into an orchestrator `error`, dropping the code).
    assert.equal(result.state, 'failed');
    assert.equal(result.exitCode, 7);
    assert.match(result.error ?? '', /^Combine step over partials 0 and 1 failed \(exit code 7\)/);
    assert.match(result.error ?? '', /merge-boom/);
    const latest = await storage.refs.executionGetLatest(repo, taskHash, result.inputsHash);
    assert.equal(latest?.type, 'failed', 'the recorded status must be failed, not error');
  });

  it('records a partitioned run aborted mid-partition as cancelled, the unit and the logical execution alike', async () => {
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(1000)));
    const fnIrHash = await createDummyFnIr();
    // Each partition announces itself, then sleeps while the marker exists.
    const marker = join(repo, 'sleep-while-this-exists');
    writeFileSync(marker, '');
    const script = `echo started; while [ -e '${marker}' ]; do sleep 1; done; cp "$1" "$2"`;
    const sleepyFn = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      ($, inputs, output) => ['bash', '-c', script, '--', inputs.get(1n), output],
    );
    const commandIrHash = await objectWrite(repo, encodeBeast2For(IRType)(sleepyFn.toIR().ir));
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1, commandIrHash });

    const abort = new AbortController();
    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash], {
      partitionConcurrency: 1,
      signal: abort.signal,
      onStdout: () => abort.abort(),
    });

    assert.equal(result.state, 'error');
    assert.equal(result.cancelled, true);
    assert.equal(result.error, 'cancelled: e3 stopped the partitioned run because the run was aborted');
    const logical = await storage.refs.executionGet(repo, taskHash, result.inputsHash, result.executionId);
    assert.equal(logical?.type === 'error' ? logical.value.message : null, 'cancelled: e3 stopped the partitioned run because the run was aborted');

    // One partition ran before the abort; it is recorded cancelled, and the
    // logical log names it.
    const lines = await logLines(taskHash, result);
    assert.equal(lines.length, 1, lines.join('\n'));
    const match = /^partition 1\/10 cancelled task=([0-9a-f]{64}) inputs=([0-9a-f]{64}) execution=(\S+) duration=\d+$/.exec(lines[0]!);
    assert.ok(match, lines[0]);
    const unit = await storage.refs.executionGet(repo, match[1]!, match[2]!, match[3]!);
    assert.equal(unit?.type === 'error' ? unit.value.message : null, 'cancelled: e3 stopped the runner because the run was aborted');
    const unitStderr = await storage.logs.read(repo, match[1]!, match[2]!, match[3]!, 'stderr');
    assert.ok(unitStderr.data.endsWith('e3: cancelled: e3 stopped the runner because the run was aborted\n'));

    // Nothing was cached: the next run executes every partition.
    rmSync(marker);
    const rerun = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    assert.equal(rerun.state, 'success', rerun.error ?? '');
    assert.equal(rerun.outputHash, tableHash);
  });

  it('gc keeps a partitioned execution\'s plan, and the slices it recorded', async () => {
    // The plan is the only reference to the slices it carved and the key
    // ranges it planned, and it lives in a sidecar no other root scan reads.
    // Unrooted, the first `e3 repo gc` took the plan and everything it
    // records — leaving the sidecar pointing at a deleted object, so every
    // later run re-planned and re-carved from scratch.
    const fnIrHash = await createDummyFnIr();
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1 });
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(makeTable(1000)));
    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    assert.equal(result.state, 'success', result.error ?? '');

    const planHash = await storage.refs.executionPlanRead!(repo, taskHash, result.inputsHash);
    assert.ok(planHash, 'the run recorded a plan sidecar');
    const plan = decodePartitionPlan(await storage.objects.read(repo, planHash!));
    const carved = plan.slices.flat().filter((hash) => hash !== '');
    assert.ok(carved.length > 0, 'the run carved slices into the plan');

    await repoGc(new LocalStorage(dirname(repo)), repo, { minAge: 0 });

    await storage.objects.read(repo, planHash!); // throws if the sweep took it
    for (const slice of carved) await storage.objects.read(repo, slice);
  });

  it('probing every fence of a many-segment blob keeps a bounded prefix cache', async () => {
    // planPartitions walks every fence of each co-partitioned secondary. The
    // prober used to retain the frame prefix of every segment it probed and
    // scan them all on each read — O(segments) memory and O(segments²)
    // comparisons, in the module whose claim is one segment at a time.
    const segments = 200;
    // Rows wide enough that one DEFLATED segment outgrows a fence probe, so
    // each probe needs its own range — with narrow or compressible rows a
    // single probe covers dozens of segments and nothing accumulates.
    let seed = 1;
    const noise = (n: number): string => {
      let out = '';
      for (let i = 0; i < n; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        out += String.fromCharCode(33 + (seed % 90));
      }
      return out;
    };
    const wide = new SortedMap(
      Array.from({ length: segments * 5 }, (_, i) =>
        [BigInt(i), { id: BigInt(i), name: noise(4096) }] as [bigint, { id: bigint; name: string }]),
      compareFor(IntegerType));
    const hash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 5 })(wide));
    const blob = await PartitionBlob.open(storage, repo, hash);
    resetPrefetchedRangePeak();
    resetDecodedSegmentPeak();
    try {
      assert.equal(blob.extents.offsets.length, segments);
      for (let i = 0; i < segments; i++) {
        assert.equal(await blob.fence(i), BigInt(i * 5), `fence ${i} survives eviction`);
      }
      // Unbounded this peaked at 196 of the 200 segments; the head plus a
      // small FIFO of frame prefixes is all a sequential walk needs.
      assert.ok(prefetchedRangePeak() <= 9, `prefix cache stayed bounded, peaked at ${prefetchedRangePeak()}`);
      assert.equal(decodedSegmentPeak(), 0, 'no fence fell back to a whole-segment decode');
    } finally {
      blob.release();
    }
  });

  it('spliceChunks refuses non-self-contained parts', async () => {
    // A cross-segment-aliasing shard would splice into a blob whose REFs
    // resolve into the PREVIOUS shard's containers — in range, silently
    // wrong — so the streaming splice must refuse it like spliceBeast2 does.
    const blob = encodeBeast2SegmentsFor(TableType, { selfContained: false })([makeTable(10)]);
    const part = bufferPart(blob);
    assert.equal(part.selfContained, false);
    const chunks = spliceChunks(blob.subarray(0, readBeast2Extents(blob).prefixEnd), [part]);
    await assert.rejects(
      (async () => { for await (const _ of chunks) { /* drain */ } })(),
      /splice part 0 has cross-segment aliasing — splice needs self-contained segments/,
    );
  });

  it('errors when a co-partitioned secondary does not follow the boundary projection order', async () => {
    // Wire-level defense for task objects the SDK validation predates: the
    // secondary's canonical order is b-major while the (implicit) boundary
    // projection compares under the primary's a-major key — its projected
    // fences descend, which must fail loudly instead of silently
    // mis-assigning rows with a success status.
    const AB = StructType({ a: IntegerType, b: IntegerType });
    const BA = StructType({ b: IntegerType, a: IntegerType });
    const primaryEntries: [{ a: bigint; b: bigint }, string][] =
      Array.from({ length: 12 }, (_, i) => [{ a: BigInt(i), b: 0n }, `p-${i}`]);
    const primary = new SortedMap(primaryEntries, compareFor(AB));
    const primaryHash = await storage.objects.write(
      repo, encodeBeast2PagedFor(DictType(AB, StringType), { batchSize: 2 })(primary));
    // b-major canonical order with `a` values that DESCEND across fences.
    const secondaryEntries: [{ b: bigint; a: bigint }, string][] =
      Array.from({ length: 12 }, (_, i) => [{ b: BigInt(i), a: BigInt(11 - i) }, `s-${i}`]);
    const secondary = new SortedMap(secondaryEntries, compareFor(BA));
    const secondaryHash = await storage.objects.write(
      repo, encodeBeast2PagedFor(DictType(BA, StringType), { batchSize: 2 })(secondary));
    const fnIrHash = await createDummyFnIr();
    const taskHash = await createPartitionTask({ copyIndex: 2, partitions: 2, targetPartitionBytes: 1 });

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, primaryHash, secondaryHash]);
    assert.equal(result.state, 'error');
    assert.match(result.error ?? '', /projected segment fences are not monotone/);
  });

  it('errors when the primary\'s own projected partition boundaries descend', async () => {
    // The same wire-level defense, for the primary. A `by` reading a field
    // that is not the key's leading one passes the shape check (it reads a
    // field of the parameter), but its projection runs against the primary's
    // canonical order, so the boundary values descend — and the secondaries'
    // split searches below resume forward from the previous bound and cannot
    // go back, so they would land wrong with a success status.
    const BA = StructType({ b: IntegerType, a: IntegerType });
    const rows = (n: number): [{ b: bigint; a: bigint }, string][] =>
      Array.from({ length: n }, (_, i) => [{ b: BigInt(i), a: BigInt(n - 1 - i) }, `p-${i}`]);
    const write = (n: number, batchSize: number): Promise<string> => storage.objects.write(
      repo, encodeBeast2PagedFor(DictType(BA, StringType), { batchSize })(new SortedMap(rows(n), compareFor(BA))));
    const primaryHash = await write(12, 2);
    const secondaryHash = await write(12, 3);
    const fnIrHash = await createDummyFnIr();
    const byFn = East.function([BA], IntegerType, (_$, key) => key.a);
    const taskHash = await createPartitionTask({ copyIndex: 2, partitions: 2, targetPartitionBytes: 1, by: encodeEastIR(byFn.toIR()) });

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, primaryHash, secondaryHash]);
    assert.equal(result.state, 'error');
    assert.match(result.error ?? '', /projected partition boundaries are not monotone/);
  });

  it('partitions an Array input whose elements are in no order at all', async () => {
    // An Array root has no canonical order — its elements sit where the value
    // put them. The boundary-ascent check above must not be applied to one:
    // the parity suite's `wide` job partitions a deliberately scrambled array,
    // and asserting an order it does not have failed every run of it.
    const PairType = StructType({ key: IntegerType, name: StringType });
    const scrambled = Array.from({ length: 400 }, (_, i) => {
      const at = Number((BigInt(i) * 97n) % 400n);
      return { key: BigInt(at), name: `row-${at}` };
    });
    const arrayHash = await storage.objects.write(
      repo, encodeBeast2PagedFor(ArrayType(PairType), { batchSize: 40 })(scrambled));
    const fnIrHash = await createDummyFnIr();
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1 });

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, arrayHash]);
    assert.equal(result.state, 'success', result.error ?? '');
    assert.equal(result.outputHash, arrayHash, 'the identity body splices the scrambled array back');
  });

  it('aligns boundaries on a `by` field read without compiling the projection', async () => {
    const GroupKeyType = StructType({ group: IntegerType, id: IntegerType });
    // 1000 rows in 100-row segments, 150 rows per group: a group straddles
    // every fence except where one starts (rows 300, 600 and 900).
    const table = new SortedMap<{ group: bigint; id: bigint }, string>(
      Array.from({ length: 1000 }, (_, i) =>
        [{ group: BigInt(Math.floor(i / 150)), id: BigInt(i) }, `row-${i}`] as [{ group: bigint; id: bigint }, string]),
      compareFor(GroupKeyType),
    );
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(DictType(GroupKeyType, StringType), { batchSize: 100 })(table));
    const fnIrHash = await createDummyFnIr();
    // The projection reads `key.group` after calling a platform function no
    // runtime provides: compiling it would fail, so the run succeeding pins
    // that the orchestrator only reads its shape.
    const unprovided = East.platform('e3_core_test_unprovided', [], NullType);
    const byFn = East.function([GroupKeyType], IntegerType, ($, key) => {
      $(unprovided());
      return key.group;
    });
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1, by: encodeEastIR(byFn.toIR()) });

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    assert.equal(result.state, 'success', result.error ?? '');
    assert.equal(result.outputHash, tableHash, 'the aligned slices splice back byte-identically');
    // A cut at every fence, kept only where a group starts: partitions from
    // segments 0, 3, 6 and 9, plus the logical record.
    assert.equal(await executionCount(taskHash), 5);
  });

  it('refuses a `by` projection that is not a leading-prefix key read', async () => {
    const GroupKeyType = StructType({ group: IntegerType, id: IntegerType });
    const table = new SortedMap<{ group: bigint; id: bigint }, string>(
      Array.from({ length: 200 }, (_, i) => [{ group: BigInt(i >> 4), id: BigInt(i) }, `row-${i}`] as [{ group: bigint; id: bigint }, string]),
      compareFor(GroupKeyType),
    );
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(DictType(GroupKeyType, StringType), { batchSize: 50 })(table));
    const fnIrHash = await createDummyFnIr();
    const byFn = East.function([GroupKeyType], IntegerType, (_$, key) => key.group.add(1n));
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1, by: encodeEastIR(byFn.toIR()) });

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    assert.equal(result.state, 'error');
    assert.equal(result.error, 'partition by projection is not a leading-prefix key projection — re-export the package with the current SDK');
  });

  it('aligns an identity `by` over co-partitioned keys on the shared fields, not the primary key', async () => {
    const WideKeyType = StructType({ sku: StringType, period: IntegerType, line: IntegerType });
    const SharedKeyType = StructType({ sku: StringType, period: IntegerType });
    type Shared = { sku: string; period: bigint };
    // The primary holds three lines per (sku, period) in 4-row segments, so
    // groups straddle fences; the secondary holds one row per (sku, period).
    const groups: Shared[] = ['a', 'b', 'c'].flatMap((sku) => [0n, 1n, 2n, 3n].map((period) => ({ sku, period })));
    const primary = new SortedMap<Shared & { line: bigint }, bigint>(
      groups.flatMap((g) => [0n, 1n, 2n].map((line) => [{ ...g, line }, line] as [Shared & { line: bigint }, bigint])),
      compareFor(WideKeyType),
    );
    const secondary = new SortedMap<Shared, bigint>(groups.map((g) => [g, g.period] as [Shared, bigint]), compareFor(SharedKeyType));
    const primaryHash = await storage.objects.write(repo, encodeBeast2PagedFor(DictType(WideKeyType, IntegerType), { batchSize: 4 })(primary));
    const secondaryHash = await storage.objects.write(repo, encodeBeast2PagedFor(DictType(SharedKeyType, IntegerType), { batchSize: 5 })(secondary));
    const fnIrHash = await createDummyFnIr();
    // The SDK builds an identity `by` over the shared key fields.
    const byFn = East.function([SharedKeyType], SharedKeyType, (_$, key) => key);
    const taskHash = await createPartitionTask({ copyIndex: 2, partitions: 2, targetPartitionBytes: 1, by: encodeEastIR(byFn.toIR()) });

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, primaryHash, secondaryHash]);
    assert.equal(result.state, 'success', result.error ?? '');

    // Every partition's primary slice holds exactly the (sku, period) groups of
    // its secondary slice: no group is split from its counterpart.
    const decodePrimary = decodeBeast2For(DictType(WideKeyType, IntegerType));
    const decodeSecondary = decodeBeast2For(DictType(SharedKeyType, IntegerType));
    const groupsOf = (keys: Iterable<Shared>): Set<string> => new Set([...keys].map((k) => `${k.sku}/${k.period}`));
    let partitionRuns = 0;
    for (const inputsHash of await storage.refs.executionListForTask(repo, taskHash)) {
      const status = await storage.refs.executionGetLatest(repo, taskHash, inputsHash);
      if (status?.type !== 'success' || status.value.inputHashes[1] === primaryHash) continue;
      partitionRuns++;
      const [, primarySlice, secondarySlice] = status.value.inputHashes;
      assert.deepEqual(
        groupsOf(decodePrimary(await storage.objects.read(repo, primarySlice!)).keys()),
        groupsOf(decodeSecondary(await storage.objects.read(repo, secondarySlice!)).keys()),
      );
    }
    assert.ok(partitionRuns > 1, 'the primary carves into several partitions');
  });

  it('rejects a partitioned input that carries no segment index', async () => {
    const table = makeTable(50);
    // Whole-value v5 encode: no index, so the input cannot be carved.
    const tableHash = await storage.objects.write(repo, encodeBeast2For(TableType)(table));
    const fnIrHash = await createDummyFnIr();
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1 });

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    assert.equal(result.state, 'error');
    assert.match(result.error ?? '', /segment index/);
  });
});
