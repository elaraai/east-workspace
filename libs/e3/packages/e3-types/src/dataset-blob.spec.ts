/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The encoder door: a collection is written as the manifest the Writer's own
 * manifest writer writes for its value — which the conformance corpus pins in
 * every runtime — whichever pieces it arrives in.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Beast2ManifestWriter,
  DictType,
  IntegerType,
  SortedMap,
  StringType,
  StructType,
  compareFor,
  decodeBeast2FenceFor,
  decodeCollectionManifest,
  encodeBeast2For,
  encodeBeast2PagedFor,
  sha256Hex,
} from '@elaraai/east';
import { encodeDatasetBlob, writeCollectionManifest, type CollectionSegmentRef, type SegmentSink } from './dataset-blob.js';

const TableType = DictType(StringType, IntegerType);

/** `n` rows, in canonical order: 20,000 span sixteen segments. */
function rowsOf(n: number): SortedMap<string, bigint> {
  return new SortedMap(
    Array.from({ length: n }, (_, i): [string, bigint] => [`k${String(i).padStart(6, '0')}`, BigInt(i)]),
    compareFor(StringType));
}

/** A sink that stores nothing, and answers each object's hash. */
const hashing: SegmentSink = (batch) => Promise.resolve(batch.map((bytes) => sha256Hex(bytes)));

/** A batch the test ends, as the store would: stored, or failed. */
interface HeldBatch {
  hashes: string[];
  end: (failure?: Error) => void;
}

/** A sink whose batches are held until the test ends each one: the batches in
 *  flight, and the hashes of every batch it was handed, in order. */
function heldSink(): { sink: SegmentSink; open: HeldBatch[]; calls: string[][] } {
  const open: HeldBatch[] = [];
  const calls: string[][] = [];
  const sink: SegmentSink = (batch) => new Promise((resolve, reject) => {
    const hashes = batch.map((bytes) => sha256Hex(bytes));
    calls.push(hashes);
    const held: HeldBatch = {
      hashes,
      end: (failure) => {
        open.splice(open.indexOf(held), 1);
        if (failure === undefined) resolve(hashes);
        else reject(failure);
      },
    };
    open.push(held);
  });
  return { sink, open, calls };
}

/** Lets `turns` rounds of the event loop pass. */
async function turns(turns: number): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** Lets the event loop run until `done` holds. */
async function until(done: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 10_000; i++) {
    if (done()) return;
    await turns(1);
  }
  assert.fail(`never: ${what}`);
}

describe('writeCollectionManifest', () => {
  it("writes the manifest writer's manifest for the value, byte for byte", async () => {
    const value = new SortedMap(
      Array.from({ length: 20_000 }, (_, i): [string, bigint] => [`k${String(i).padStart(6, '0')}`, BigInt(i)]),
      compareFor(StringType));
    const objects = new Map<string, Uint8Array>();
    const manifest = await writeCollectionManifest(TableType, [{ elements: value.entries() }], async (batch) => batch.map((bytes) => {
      const hash = sha256Hex(bytes);
      objects.set(hash, bytes);
      return hash;
    }));

    const expectedObjects = new Map<string, Uint8Array>();
    let expected: Uint8Array | undefined;
    const writer = new Beast2ManifestWriter(TableType, {
      object: (hash, bytes) => { expectedObjects.set(hash, bytes); },
      manifest: (bytes) => { expected = bytes; },
    });
    for (const element of value) writer.add(element);
    writer.finish();

    assert.deepEqual(manifest, expected);
    assert.deepEqual([...objects.keys()].sort(), [...expectedObjects.keys()].sort(), 'the same objects, header included');
    assert.ok(decodeCollectionManifest(manifest).entries.length > 1, 'the value spans segments');
  });

  it('names the segments a piece carries with their entries again, neither reading nor writing them', async () => {
    const value = new SortedMap(
      Array.from({ length: 20_000 }, (_, i): [string, bigint] => [`k${String(i).padStart(6, '0')}`, BigInt(i)]),
      compareFor(StringType));
    const objects = new Map<string, Uint8Array>();
    const sink: SegmentSink = async (batch) => batch.map((bytes) => {
      const hash = sha256Hex(bytes);
      objects.set(hash, bytes);
      return hash;
    });
    const whole = await writeCollectionManifest(TableType, [{ elements: value.entries() }], sink);
    const entries = decodeCollectionManifest(whole).entries;
    const half = entries.length >> 1;

    // The first half as the segments they are, each with the fence that
    // followed it; the rest as elements, from the first key of the second half.
    const reads: string[] = [];
    const carried: CollectionSegmentRef[] = entries.slice(0, half).map((entry, i) => ({
      count: Number(entry.count),
      fence: entry.fence,
      nextFence: entries[i + 1]!.fence,
      read: () => {
        reads.push(entry.hash);
        return objects.get(entry.hash)!;
      },
      entry,
    }));
    const written = new Set<string>();
    const again = await writeCollectionManifest(TableType, [
      { segments: carried },
      { elements: value.entries(decodeBeast2FenceFor(StringType)(entries[half]!.fence) as string) },
    ], async (batch) => {
      const hashes = await sink(batch);
      for (const hash of hashes) written.add(hash);
      return hashes;
    });

    assert.deepEqual(again, whole, 'the same manifest');
    assert.deepEqual(reads, [], 'the seam is decided by the fence that followed');
    for (const entry of entries.slice(0, half)) assert.ok(!written.has(entry.hash), `segment ${entry.hash.slice(0, 8)} is carried`);
  });

  it('hands the sink the objects in order, in full batches, one in flight while the next is gathered, and returns once every one is stored', async () => {
    const value = rowsOf(20_000);
    const expected = await writeCollectionManifest(TableType, [{ elements: value.entries() }], hashing);
    const { entries, header } = decodeCollectionManifest(expected);
    const { sink, open, calls } = heldSink();
    let manifest: Uint8Array | undefined;
    const writing = writeCollectionManifest(TableType, [{ elements: value.entries() }], sink, { batch: 3 })
      .then((bytes) => {
        manifest = bytes;
      });

    // Each batch is stored only when the test ends it. Between ends, one batch
    // is in flight, and the writer sends the next only once it is stored.
    while (manifest === undefined) {
      await until(() => manifest !== undefined || open.length > 0, 'a batch in flight');
      await turns(20);
      if (manifest !== undefined) break;
      assert.equal(open.length, 1, `${open.length} batches in flight, of ${calls.length} sent`);
      open[0]!.end();
    }
    await writing;

    assert.deepEqual(manifest, expected, 'the manifest a write of each object writes, each entry in its place');
    assert.deepEqual(calls.flat(), [...entries.map((entry) => entry.hash), header], 'the segments, in order, and then the header');
    assert.ok(calls.slice(0, -1).every((batch) => batch.length === 3), 'every batch but the last is full');
    assert.ok(calls.at(-1)!.length <= 3, 'and the last holds what is left');
  });

  it('hands a collection of a few segments to the sink in one batch', async () => {
    const value = rowsOf(4_000);
    const { entries, header } = decodeCollectionManifest(await writeCollectionManifest(TableType, [{ elements: value.entries() }], hashing));
    assert.ok(entries.length > 1, 'the value spans segments');
    const calls: string[][] = [];
    await writeCollectionManifest(TableType, [{ elements: value.entries() }], async (batch) => {
      const hashes = await hashing(batch);
      calls.push(hashes);
      return hashes;
    });
    assert.deepEqual(calls, [[...entries.map((entry) => entry.hash), header]]);
  });

  /** A writer's failure, once it has failed: read through a function, which
   *  no assertion narrows. */
  function failureOf(writing: Promise<unknown>): () => { failure: unknown } | undefined {
    let settled: { failure: unknown } | undefined;
    writing.then(() => {
      settled = { failure: new Error('the writer did not fail') };
    }, (failure: unknown) => {
      settled = { failure };
    });
    return () => settled;
  }

  it('sends no batch after one fails, and throws its failure', async () => {
    const { sink, open, calls } = heldSink();
    const writing = writeCollectionManifest(TableType, [{ elements: rowsOf(20_000).entries() }], sink, { batch: 3 });
    const settled = failureOf(writing);
    await until(() => open.length === 1, 'a batch in flight');
    // The next batch gathered, waiting for this one
    await turns(20);
    const failure = new Error('the store is gone');
    open[0]!.end(failure);
    await until(() => settled() !== undefined, "the writer's end");
    assert.equal(calls.length, 1, 'nothing is sent after a batch fails');
    assert.equal(settled()?.failure, failure);
  });

  it("throws a failure of the last batch, the header's", async () => {
    const value = rowsOf(20_000);
    const { header } = decodeCollectionManifest(await writeCollectionManifest(TableType, [{ elements: value.entries() }], hashing));
    const { sink, open } = heldSink();
    const writing = writeCollectionManifest(TableType, [{ elements: value.entries() }], sink, { batch: 3 });
    const settled = failureOf(writing);
    // Every batch is stored but the one holding the header, the last sent.
    const failure = new Error('the store is gone');
    for (;;) {
      await until(() => settled() !== undefined || open.length > 0, 'a batch in flight, or the writer\'s end');
      if (settled() !== undefined) break;
      const batch = open[0]!;
      batch.end(batch.hashes.includes(header) ? failure : undefined);
    }
    assert.equal(settled()?.failure, failure);
  });

  it('throws a piece\'s failure once the batch in flight has ended', async () => {
    // A batch larger than half the segments the rows before the one out of
    // order are cut into, and no larger than they: one batch is sent, and the
    // next is never full, so the row out of order is read with a batch in flight.
    const segments = decodeCollectionManifest(await writeCollectionManifest(TableType, [{ elements: rowsOf(20_000).entries() }], hashing))
      .entries.length;
    const { sink, open, calls } = heldSink();
    let disordered = false;
    function* rows(): Generator<[string, bigint]> {
      yield* rowsOf(20_000).entries();
      disordered = true;
      yield ['a', 0n];
    }
    const writing = writeCollectionManifest(TableType, [{ elements: rows() }], sink, { batch: (segments >> 1) + 1 });
    const settled = failureOf(writing);
    await until(() => disordered, 'the row out of order');
    await turns(20);
    assert.equal(calls.length, 1, 'one batch is sent');
    assert.equal(open.length, 1, 'and in flight');
    assert.equal(settled(), undefined, 'the writer waits for the batch in flight');

    open[0]!.end();
    await writing.catch(() => {});
    const failure = settled()?.failure;
    assert.ok(failure instanceof Error, 'the piece\'s failure');
    assert.match(failure.message, /ascend|order/);
  });
});

describe('encodeDatasetBlob', () => {
  it('encodes a collection without a sink as its paged blob, and any other value whole', async () => {
    const value = new Map([['a', 1n], ['b', 2n]]);
    assert.deepEqual(encodeDatasetBlob(TableType, value), encodeBeast2PagedFor(TableType)(value));

    const RowType = StructType({ id: IntegerType, name: StringType });
    const row = { id: 1n, name: 'one' };
    const whole = encodeBeast2For(RowType)(row);
    assert.deepEqual(encodeDatasetBlob(RowType, row), whole);
    const sunk: Uint8Array[] = [];
    assert.deepEqual(await encodeDatasetBlob(RowType, row, async (batch) => {
      sunk.push(...batch);
      return hashing(batch);
    }), whole, 'a sink changes nothing for a value that is not a collection');
    assert.deepEqual(sunk, []);
  });
});
