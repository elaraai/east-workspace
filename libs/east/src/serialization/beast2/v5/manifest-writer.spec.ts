/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The manifest writer: its directory is the Writer's blob taken apart — the
 * header and each segment, named by SHA-256 — with a manifest naming them; the
 * directory reads back as the value; an empty collection is a header and a
 * manifest of no entries; the directories of three parity values are east-c's
 * and east-py's to the byte; and a merge writes one too.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ArrayType, DictType, IntegerType, RecursiveType, SetType, StringType, StructType, VariantType } from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import { isTypeValueEqual, toEastTypeValue } from "../../../type_of_type.js";
import { SortedMap, SortedSet, variant } from "../../../index.js";
import {
  Beast2ManifestWriter,
  type Beast2ManifestSink,
  COLLECTION_MANIFEST_KIND,
  carveBeast2,
  decodeCollectionManifest,
  encodeBeast2FenceFor,
  encodeBeast2PagedFor,
  mergeBeast2For,
  openBeast2LazyFor,
  openBeast2PagesFor,
  readBeast2Extents,
  readBeast2Manifest,
  segmentKeyTypeOf,
  segmentRuleFor,
  spliceBeast2,
  spliceBeast2Segments,
} from "../index.js";

/** Every chunk a splice streams, as one array. */
async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A manifest directory held in memory, and the order its sink was called in. */
function directory(): { sink: Beast2ManifestSink; objects: Map<string, Uint8Array>; calls: string[]; manifest: () => Uint8Array } {
  const objects = new Map<string, Uint8Array>();
  const calls: string[] = [];
  let manifest: Uint8Array | null = null;
  return {
    objects,
    calls,
    sink: {
      object(hash, bytes) {
        calls.push(hash);
        objects.set(hash, bytes);
      },
      manifest(bytes) {
        calls.push("manifest");
        manifest = bytes;
      },
    },
    manifest: () => {
      assert.ok(manifest !== null, "the manifest was written");
      return manifest;
    },
  };
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const key = (prefix: string, i: number): string => `${prefix}${String(i).padStart(7, "0")}`;

const DictSI = DictType(StringType, IntegerType);
const SetS = SetType(StringType);
const ArrayS = ArrayType(StringType);

const dict = new SortedMap(Array.from({ length: 50_000 }, (_, i) => [key("k", i), BigInt(i)] as [string, bigint]), compareFor(StringType));
const set = new SortedSet(Array.from({ length: 50_000 }, (_, i) => key("e", i)), compareFor(StringType));
const array = Array.from({ length: 50_000 }, (_, i) => key("a", i));

const cases = [
  { name: "a Dict", type: DictSI, value: dict, elements: () => dict.entries() },
  { name: "a Set", type: SetS, value: set, elements: () => set.keys() },
  { name: "an Array", type: ArrayS, value: array, elements: () => array.values() },
] as const;

describe("beast2 v5 manifest writer", () => {
  for (const { name, type, value, elements } of cases) {
    test(`writes ${name} as the Writer's blob taken apart, each object under its SHA-256`, async () => {
      const dir = directory();
      const writer = new Beast2ManifestWriter(type, dir.sink);
      for (const element of elements()) writer.add(element as never);
      writer.finish();

      const blob = encodeBeast2PagedFor(type)(value as never);
      const extents = readBeast2Extents(blob);
      const manifest = decodeCollectionManifest(dir.manifest());
      assert.equal(manifest.kind, COLLECTION_MANIFEST_KIND);
      assert.equal(manifest.level, 0n);
      assert.equal(manifest.rule, segmentRuleFor(type));
      assert.deepEqual(manifest.type, extents.typeValue);

      const header = blob.subarray(0, extents.prefixEnd);
      assert.equal(manifest.header, sha256(header));
      assert.deepEqual(dir.objects.get(manifest.header), header);

      assert.ok(manifest.entries.length > 1, "the value is cut into several segments");
      assert.equal(manifest.entries.length, extents.offsets.length);
      const keyType = segmentKeyTypeOf(type);
      const pages = openBeast2PagesFor(type)(blob);
      manifest.entries.forEach((entry, i) => {
        const carved = carveBeast2(blob, i, i + 1, extents);
        assert.deepEqual(dir.objects.get(entry.hash), carved, `segment ${i}`);
        assert.equal(entry.hash, sha256(carved));
        assert.equal(entry.count, BigInt(extents.counts[i]!));
        assert.equal(entry.bytes, BigInt(carved.length));
        assert.deepEqual(new Uint8Array(entry.fence), keyType === null ? new Uint8Array(0) : encodeBeast2FenceFor(keyType)(pages.fence(i)));
      });
      assert.deepEqual(spliceBeast2(manifest.entries.map((entry) => dir.objects.get(entry.hash)!)), blob);
      // Streamed under the header the manifest names, as a download splices.
      assert.deepEqual(await collect(spliceBeast2Segments(header, manifest.entries.map((entry) => dir.objects.get(entry.hash)!))), blob);
    });

    test(`writes ${name} as a directory that reads back as the value`, () => {
      const dir = directory();
      const writer = new Beast2ManifestWriter(type, dir.sink);
      for (const element of elements()) writer.add(element as never);
      writer.finish();

      const manifest = readBeast2Manifest(dir.manifest());
      assert.ok(manifest !== null);
      const lazy = openBeast2LazyFor(type, { frozen: true })({
        manifest,
        segment: (i) => dir.objects.get(manifest.entries[i]!.hash)!,
      }) as Iterable<unknown> & { entries?: () => Iterable<unknown> };
      assert.deepEqual(
        [...(type === DictSI ? (lazy as SortedMap<string, bigint>).entries() : lazy)],
        [...elements()],
      );
    });
  }

  test("splices no segment written under another header", async () => {
    const segmentsOf = (type: typeof DictSI | typeof SetS, elements: Iterable<unknown>) => {
      const dir = directory();
      const writer = new Beast2ManifestWriter(type, dir.sink);
      for (const element of elements) writer.add(element as never);
      writer.finish();
      const manifest = decodeCollectionManifest(dir.manifest());
      return { header: dir.objects.get(manifest.header)!, segments: manifest.entries.map((entry) => dir.objects.get(entry.hash)!) };
    };
    const dicts = segmentsOf(DictSI, dict.entries());
    const sets = segmentsOf(SetS, set.keys());
    await assert.rejects(collect(spliceBeast2Segments(dicts.header, [dicts.segments[0]!, sets.segments[1]!])), {
      message: "beast2 v5: segment 1 was written under another header — the segments of one collection share theirs",
    });
    // An empty collection is its header and the tail.
    const empty = encodeBeast2PagedFor(DictSI)(new SortedMap<string, bigint>(undefined, compareFor(StringType)));
    assert.deepEqual(await collect(spliceBeast2Segments(dicts.header, [])), empty);
  });

  test("hands the header over first and the manifest last", () => {
    const dir = directory();
    const writer = new Beast2ManifestWriter(DictSI, dir.sink);
    for (const entry of dict.entries()) writer.add(entry);
    writer.finish();
    writer.finish();
    const manifest = decodeCollectionManifest(dir.manifest());
    assert.deepEqual(dir.calls, [manifest.header, ...manifest.entries.map((entry) => entry.hash), "manifest"]);
    assert.equal(writer.segments, manifest.entries.length);
  });

  test("writes an empty collection as its header and a manifest of no entries", () => {
    const dir = directory();
    new Beast2ManifestWriter(DictSI, dir.sink).finish();
    const manifest = decodeCollectionManifest(dir.manifest());
    const blob = encodeBeast2PagedFor(DictSI)(new SortedMap<string, bigint>(undefined, compareFor(StringType)));
    const header = blob.subarray(0, readBeast2Extents(blob).prefixEnd);
    assert.deepEqual(manifest.entries, []);
    assert.equal(manifest.header, sha256(header));
    assert.deepEqual([...dir.objects.keys()], [manifest.header]);
  });

  test("writes the directories east-c and east-py write", () => {
    // The same values and digests are pinned in east-c's
    // `tests/test_beast2_manifest.c` and east-py's `test_beast2_manifest.py`.
    // A manifest names each object by its SHA-256, so its own digest pins
    // every segment's bytes too.
    const manifestOf = (type: typeof DictSI | typeof SetS | typeof ArrayS, elements: Iterable<unknown>): string => {
      const dir = directory();
      const writer = new Beast2ManifestWriter(type, dir.sink);
      for (const element of elements) writer.add(element as never);
      writer.finish();
      return sha256(dir.manifest());
    };
    assert.equal(manifestOf(DictSI, dict.entries()), "5564111725b1962b7ae8c82cf91d24c4e1fb8d2c9613245693757fe4ff4187b0");
    assert.equal(manifestOf(SetS, set.keys()), "7b2c57db1da82f98ef88018589dc7a4f96bac120472b35e9826dbd60c395789c");
    assert.equal(manifestOf(ArrayS, array), "127030afceae0c9590ad26ed26521cff170b8024229f28ccd54d647fc218df4c");
    assert.equal(manifestOf(DictSI, []), "356518ed344e3e210d0a2acb26eef7eff25cd76ba08b1aedd0640af5256cefb0");
  });

  test("records a recursive collection type under canonical ids, not this process's", () => {
    // The ids a runtime gives recursive types are its own; the manifest's
    // hash names the collection, so the type is recorded renamed — the
    // wrapper numbered 0 — and east-c records the same (the corpus pins it).
    const TreeType = RecursiveType((tree) => VariantType({ leaf: IntegerType, node: StructType({ left: tree, right: tree }) }));
    const type = ArrayType(TreeType);
    const dir = directory();
    const writer = new Beast2ManifestWriter(type, dir.sink);
    writer.add(variant("node", { left: variant("leaf", 1n), right: variant("leaf", 2n) }));
    writer.finish();
    const recorded = decodeCollectionManifest(dir.manifest()).type;
    assert.ok(isTypeValueEqual(recorded, toEastTypeValue(type)));
    const wrapper = (recorded.value as { value: { value: { id: bigint } } }).value.value;
    assert.equal(wrapper.id, 0n);
  });

  test("writes what a merge writes as a manifest directory", () => {
    // Two interleaved halves of the Dict, merged, are the Dict.
    const half = (parity: number): Uint8Array => encodeBeast2PagedFor(DictSI)(
      new SortedMap([...dict.entries()].filter((_, i) => i % 2 === parity), compareFor(StringType)));
    const merged = directory();
    const stats = mergeBeast2For(DictSI)([half(0), half(1)], merged.sink);
    assert.equal(stats.entries, dict.size);

    const whole = directory();
    const writer = new Beast2ManifestWriter(DictSI, whole.sink);
    for (const entry of dict.entries()) writer.add(entry);
    writer.finish();
    assert.deepEqual(merged.manifest(), whole.manifest());
    assert.deepEqual(merged.objects, whole.objects);
  });
});
