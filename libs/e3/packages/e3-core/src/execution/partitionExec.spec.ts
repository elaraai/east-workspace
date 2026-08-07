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
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  variant, some, none,
  StringType, IntegerType, StructType, DictType, ArrayType,
  East, SortedMap, compareFor, equalFor,
  encodeBeast2For, decodeBeast2For, encodeBeast2PagedFor, encodeBeast2SegmentsFor, encodeEastIR, readBeast2Extents,
  IRType,
} from '@elaraai/east';
import {
  TaskObjectType,
  PackageObjectType,
  WorkspaceStateType,
  DatasetRefType,
  TASK_KIND_PARTITION,
  encodePartitionTaskMetadata,
  type PackageObject,
  type TaskObject,
  type TreePath,
} from '@elaraai/e3-types';
import type { PartitionProgress } from '@elaraai/e3-types';
import { taskExecute } from './LocalTaskRunner.js';
import { bufferPart, spliceChunks } from './partitionIo.js';
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
    commandIrHash?: string;
  }): Promise<string> {
    const commandIrHash = options.commandIrHash ?? await createCopyCommandIr(options.copyIndex);
    const metadata = encodePartitionTaskMetadata({
      partitions: BigInt(options.partitions),
      by: none,
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
      { phase: 'partition', index: 0, total: 1, state: 'started' },
      { phase: 'partition', index: 0, total: 1, state: 'completed', cached: false, duration: events[1]?.duration },
    ]);
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
      records: new Map(),
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
