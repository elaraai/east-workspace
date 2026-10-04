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
import { encodeDatasetBlob, writeCollectionManifest, type CollectionSegmentRef } from './dataset-blob.js';

const TableType = DictType(StringType, IntegerType);

/** `n` rows, in canonical order: 20,000 span sixteen segments. */
function rowsOf(n: number): SortedMap<string, bigint> {
  return new SortedMap(
    Array.from({ length: n }, (_, i): [string, bigint] => [`k${String(i).padStart(6, '0')}`, BigInt(i)]),
    compareFor(StringType));
}

/** A write the test ends, as the store would: stored, or failed. */
interface HeldWrite {
  hash: string;
  end: (failure?: Error) => void;
}

/** A sink whose writes are held until the test ends each one: the writes in
 *  flight, and the hash of every object it was handed, in order. */
function heldSink(): { sink: (bytes: Uint8Array) => Promise<string>; open: HeldWrite[]; calls: string[] } {
  const open: HeldWrite[] = [];
  const calls: string[] = [];
  const sink = (bytes: Uint8Array): Promise<string> => new Promise((resolve, reject) => {
    const hash = sha256Hex(bytes);
    calls.push(hash);
    const write: HeldWrite = {
      hash,
      end: (failure) => {
        open.splice(open.indexOf(write), 1);
        if (failure === undefined) resolve(hash);
        else reject(failure);
      },
    };
    open.push(write);
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
    const manifest = await writeCollectionManifest(TableType, [{ elements: value.entries() }], async (bytes) => {
      const hash = sha256Hex(bytes);
      objects.set(hash, bytes);
      return hash;
    });

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
    const sink = async (bytes: Uint8Array): Promise<string> => {
      const hash = sha256Hex(bytes);
      objects.set(hash, bytes);
      return hash;
    };
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
    ], async (bytes) => {
      const hash = await sink(bytes);
      written.add(hash);
      return hash;
    });

    assert.deepEqual(again, whole, 'the same manifest');
    assert.deepEqual(reads, [], 'the seam is decided by the fence that followed');
    for (const entry of entries.slice(0, half)) assert.ok(!written.has(entry.hash), `segment ${entry.hash.slice(0, 8)} is carried`);
  });

  it('has the sink write the objects at once, as many as it is given, in order, and returns once every one is stored', async () => {
    const value = rowsOf(20_000);
    const expected = await writeCollectionManifest(TableType, [{ elements: value.entries() }], async (bytes) => sha256Hex(bytes));
    const entries = decodeCollectionManifest(expected).entries;
    const objects = entries.length + 1;
    const { sink, open, calls } = heldSink();
    let manifest: Uint8Array | undefined;
    const writing = writeCollectionManifest(TableType, [{ elements: value.entries() }], sink, { inFlight: 3 })
      .then((bytes) => {
        manifest = bytes;
      });

    // Each write ends only when the test ends it, the last begun first, so the
    // writes end in another order than they began. Between ends, the writer
    // has as many in flight as it may: three, or the objects left.
    while (manifest === undefined) {
      const inFlight = (): number => Math.min(3, objects - (calls.length - open.length));
      await until(() => manifest !== undefined || open.length === inFlight(), 'as many writes in flight as may be');
      await turns(20);
      if (manifest !== undefined) break;
      assert.equal(open.length, inFlight(), `${open.length} writes in flight, of ${calls.length} begun`);
      open.at(-1)!.end();
    }
    await writing;

    assert.deepEqual(manifest, expected, 'the manifest a write at a time writes, each entry in its place');
    assert.deepEqual(calls, [...entries.map((entry) => entry.hash), decodeCollectionManifest(expected).header],
      'the segments, in order, and then the header');
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

  it('starts no write after one fails, and throws its failure once the writes in flight have ended', async () => {
    const { sink, open, calls } = heldSink();
    const writing = writeCollectionManifest(TableType, [{ elements: rowsOf(20_000).entries() }], sink, { inFlight: 3 });
    const settled = failureOf(writing);
    await until(() => open.length === 3, 'three writes in flight');
    const failure = new Error('the store is gone');
    open[1]!.end(failure);
    await turns(20);
    assert.equal(calls.length, 3, 'nothing is begun after a write fails');
    assert.equal(settled(), undefined, 'the writer waits for the writes still in flight');

    for (const write of [...open]) write.end();
    await writing.catch(() => {});
    assert.equal(settled()?.failure, failure);
  });

  it('throws a failure among the last writes, which no write after it meets', async () => {
    const value = rowsOf(20_000);
    const { header } = decodeCollectionManifest(
      await writeCollectionManifest(TableType, [{ elements: value.entries() }], async (bytes) => sha256Hex(bytes)));
    const { sink, open } = heldSink();
    const writing = writeCollectionManifest(TableType, [{ elements: value.entries() }], sink, { inFlight: 3 });
    const settled = failureOf(writing);
    // Every object is stored but the header, the last begun.
    const failure = new Error('the store is gone');
    for (;;) {
      await until(() => settled() !== undefined || open.length > 0, 'a write in flight, or the writer\'s end');
      if (settled() !== undefined) break;
      const write = open[0]!;
      write.end(write.hash === header ? failure : undefined);
    }
    assert.equal(settled()?.failure, failure);
  });

  it('throws a piece\'s failure once the writes in flight have ended', async () => {
    const { sink, open } = heldSink();
    // Rows in order, then one out of it.
    let disordered = false;
    function* rows(): Generator<[string, bigint]> {
      yield* rowsOf(20_000).entries();
      disordered = true;
      yield ['a', 0n];
    }
    const writing = writeCollectionManifest(TableType, [{ elements: rows() }], sink, { inFlight: 64 });
    const settled = failureOf(writing);
    await until(() => disordered, 'the row out of order');
    await turns(20);
    assert.ok(open.length > 0, 'segments are in flight');
    assert.equal(settled(), undefined, 'the writer waits for the writes still in flight');

    for (const write of [...open]) write.end();
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
    assert.deepEqual(await encodeDatasetBlob(RowType, row, async (bytes) => {
      sunk.push(bytes);
      return sha256Hex(bytes);
    }), whole, 'a sink changes nothing for a value that is not a collection');
    assert.deepEqual(sunk, []);
  });
});
