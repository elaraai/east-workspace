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
