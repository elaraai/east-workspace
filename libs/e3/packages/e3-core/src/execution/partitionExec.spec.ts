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
import {
  variant, some, none,
  StringType, IntegerType, StructType, DictType, ArrayType,
  East, SortedMap, compareFor, equalFor,
  encodeBeast2For, decodeBeast2For, encodeBeast2PagedFor, encodeEastIR, readBeast2Extents,
  IRType,
} from '@elaraai/east';
import {
  TaskObjectType,
  TASK_KIND_PARTITION,
  encodePartitionTaskMetadata,
  type TaskObject,
  type TreePath,
} from '@elaraai/e3-types';
import { taskExecute } from './LocalTaskRunner.js';
import { PARTITION_COPY_CHUNK_BYTES } from './partitionIo.js';
import { objectWrite } from '../storage/local/LocalObjectStore.js';
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

  /** Writes a partition-kind TaskObject copying input `copyIndex`. */
  async function createPartitionTask(options: {
    copyIndex: number;
    partitions: number;
    targetPartitionBytes: number;
    combine?: Uint8Array;
  }): Promise<string> {
    const commandIrHash = await createCopyCommandIr(options.copyIndex);
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
    const table = makeTable(1000);
    const tableHash = await storage.objects.write(repo, encodeBeast2PagedFor(TableType, { batchSize: 100 })(table));
    const fnIrHash = await createDummyFnIr();
    const taskHash = await createPartitionTask({ copyIndex: 1, partitions: 1, targetPartitionBytes: 1 });

    // Spy on the object store: the partitioned input must flow only through
    // ranged reads (extents from head + tail, boundary probes, span copies),
    // each bounded by the copy chunk — never a whole read. (Slice objects
    // themselves are still whole-read by input marshalling to the runner,
    // which is the standard path's documented, slice-bounded cost.)
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
      maxRangeLength = Math.max(maxRangeLength, length);
      return origRange(r, h, offset, length);
    };

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, tableHash]);
    assert.equal(result.state, 'success', result.error ?? '');
    // The streamed carve + splice reproduce the input byte-identically.
    assert.equal(result.outputHash, tableHash);
    assert.equal(wholeInputReads, 0, 'the partitioned input must never be whole-read');
    assert.ok(maxRangeLength <= PARTITION_COPY_CHUNK_BYTES,
      `every ranged read (max ${maxRangeLength} bytes) must respect the copy chunk (${PARTITION_COPY_CHUNK_BYTES} bytes)`);
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
