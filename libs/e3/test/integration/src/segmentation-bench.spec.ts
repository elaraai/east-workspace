/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The segmentation benchmarks — the cut rule's parameters, measured.
 *
 * The rule's six parameters trade a page read (one segment decoded) against
 * what a segment costs to exist (its object, its header, its manifest entry)
 * and what an edit rewrites (the segments it lands in, and the manifest).
 * This measures those on narrow rows (as a Dict and as an Array), rows of
 * about a kilobyte, and wide rows, for the current rule and for the same
 * shape scaled down and up, with and without its normalization, and prints
 * one table per benchmark — the measurement that fixed the rule.
 *
 * Settings other than the current one are simulated: the harness cuts the
 * encoded elements itself with the rule's test at other parameters, and
 * frames and decodes the segments with the real writer and reader. The
 * simulation is held to the real writer under the current rule, so what it
 * measures there is what the writer writes.
 *
 * Small scale runs in CI and checks only the simulation against the writer.
 * `E3_SEGMENTATION_BENCH=1` runs full scale — 1,000,000 narrow rows, 100,000
 * rows of about a kilobyte, 300 rows of 1 MiB — and prints the tables:
 *
 *     E3_SEGMENTATION_BENCH=1 node --test dist/segmentation-bench.spec.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ArrayType,
  BlobType,
  BooleanType,
  DateTimeType,
  DictType,
  FloatType,
  IntegerType,
  StringType,
  StructType,
  Beast2Writer,
  COLLECTION_MANIFEST_KIND,
  SEGMENT_MAX_BYTES,
  SEGMENT_MAX_COUNT,
  SEGMENT_MIN_BYTES,
  SEGMENT_MIN_COUNT,
  SEGMENT_TARGET_BYTES,
  SEGMENT_TARGET_COUNT,
  decodeBeast2For,
  encodeBeast2FenceFor,
  encodeBeast2PagedFor,
  encodeCollectionManifest,
  readBeast2Extents,
  segmentBoundaryHash,
  segmentKeyTypeOf,
  segmentRuleFor,
  toEastTypeValue,
  type EastType,
  type ValueTypeOf,
} from '@elaraai/east';

const full = process.env.E3_SEGMENTATION_BENCH === '1';

/** One setting of the rule's six parameters, and whether the test is
 *  normalized: a quarter of the threshold before the open segment reaches its
 *  target, four times it after, which draws segment sizes in toward the
 *  target instead of spreading them geometrically. */
interface Params {
  label: string;
  minCount: number;
  targetCount: number;
  maxCount: number;
  minBytes: number;
  targetBytes: number;
  maxBytes: number;
  normalized: boolean;
}

/** The current parameters scaled by `factor`, shape kept. */
function scaled(factor: number, normalized = false): Params {
  return {
    label: `×${factor}${normalized ? ' normalized' : ''}`,
    minCount: Math.round(SEGMENT_MIN_COUNT * factor),
    targetCount: Math.round(SEGMENT_TARGET_COUNT * factor),
    maxCount: Math.round(SEGMENT_MAX_COUNT * factor),
    minBytes: Math.round(SEGMENT_MIN_BYTES * factor),
    targetBytes: Math.round(SEGMENT_TARGET_BYTES * factor),
    maxBytes: Math.round(SEGMENT_MAX_BYTES * factor),
    normalized,
  };
}

/** The rule every writer cuts by. */
const CURRENT = scaled(1, true);

const SETTINGS: Params[] = [scaled(0.25), scaled(0.5), scaled(1), scaled(2), scaled(0.5, true), CURRENT];

/** A collection's elements in their canonical bytes, each with the hash the
 *  rule tests and, for a Set or Dict, its key's fence bytes. */
interface Encoded {
  bytes: Uint8Array[];
  hashes: number[];
  fences: Uint8Array[];
}

/** The rule's test, at `p`: whether an element with boundary hash `hash`
 *  starts a segment after an open one of `count` elements and `bytes`. */
function cutsAt(p: Params, count: number, bytes: number, hash: number): boolean {
  if (count >= p.maxCount || bytes >= p.maxBytes) return true;
  if (count < p.minCount && bytes < p.minBytes) return false;
  const threshold = Math.max(2 ** 32 / p.targetCount, Math.floor((bytes * (2 ** 32 / p.targetBytes)) / count));
  if (!p.normalized) return hash < threshold;
  const pastTarget = count >= p.targetCount || bytes >= p.targetBytes;
  return hash < (pastTarget ? Math.min(2 ** 32, threshold * 4) : Math.floor(threshold / 4));
}

/** Where each segment starts, cut at `p`. */
function cut(p: Params, sizes: readonly number[], hashes: readonly number[]): number[] {
  const starts = sizes.length === 0 ? [] : [0];
  let count = 0;
  let bytes = 0;
  for (let i = 0; i < sizes.length; i++) {
    if (count !== 0 && cutsAt(p, count, bytes, hashes[i]!)) {
      starts.push(i);
      count = 0;
      bytes = 0;
    }
    count++;
    bytes += sizes[i]!;
  }
  return starts;
}

/** Each element's canonical bytes, encoded one at a time — as the element
 *  writer encodes them, with aliasing scoped to the element. */
function encode(type: EastType, elements: readonly unknown[]): Encoded {
  const typeValue = toEastTypeValue(type) as { type: string; value: any };
  const keyType = segmentKeyTypeOf(typeValue as never);
  const out: Encoded = { bytes: [], hashes: [], fences: [] };
  if (typeValue.type === 'Dict') {
    const key = encodeBeast2FenceFor(typeValue.value.key);
    const value = encodeBeast2FenceFor(typeValue.value.value);
    for (const element of elements) {
      const [k, v] = element as [unknown, unknown];
      const fence = key(k);
      const valueBytes = value(v);
      const bytes = new Uint8Array(fence.length + valueBytes.length);
      bytes.set(fence);
      bytes.set(valueBytes, fence.length);
      out.bytes.push(bytes);
      out.hashes.push(segmentBoundaryHash(fence));
      out.fences.push(fence);
    }
    return out;
  }
  const elem = encodeBeast2FenceFor(typeValue.value);
  for (const element of elements) {
    const bytes = elem(element);
    out.bytes.push(bytes);
    out.hashes.push(segmentBoundaryHash(bytes));
    out.fences.push(keyType === null ? new Uint8Array(0) : bytes);
  }
  return out;
}

/** Elements `[from, to)` framed as a standalone segment blob by the real
 *  writer, as a manifest stores it. */
function segmentBlob(type: EastType, bytes: readonly Uint8Array[], from: number, to: number): Uint8Array {
  let total = 0;
  for (let i = from; i < to; i++) total += bytes[i]!.length;
  const elements = new Uint8Array(total);
  let at = 0;
  for (let i = from; i < to; i++) {
    elements.set(bytes[i]!, at);
    at += bytes[i]!.length;
  }
  const chunks: Uint8Array[] = [];
  const writer = new Beast2Writer(type, (chunk) => { chunks.push(chunk.slice()); });
  writer.writeEncodedSegment(to - from, elements);
  writer.finish();
  return new Uint8Array(Buffer.concat(chunks));
}

/** The manifest naming `starts`' segments, sized with stand-in hashes. */
function manifestBytes(type: EastType, encoded: Encoded, starts: readonly number[], sizes: readonly number[]): number {
  const hash = '0'.repeat(64);
  return encodeCollectionManifest({
    kind: COLLECTION_MANIFEST_KIND,
    level: 0n,
    type: toEastTypeValue(type),
    rule: segmentRuleFor(type),
    header: hash,
    entries: starts.map((start, s) => ({
      hash,
      fence: encoded.fences[start]!,
      count: BigInt((s + 1 < starts.length ? starts[s + 1]! : encoded.bytes.length) - start),
      bytes: BigInt(sizes[s]!),
    })),
  }).length;
}

/** The value at the middle quantile of `values`. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]!;
}

/** The value `q` of the way up `values`. */
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
}

/** A benchmark: a collection type, its elements, and an edit and an insert in
 *  its middle. */
interface Bench {
  name: string;
  type: EastType;
  elements: unknown[];
  /** The middle element, edited. */
  edited: (element: unknown) => unknown;
  /** A new element that sorts just after the middle one. */
  inserted: (element: unknown) => unknown;
}

/** What one setting costs on one benchmark. */
interface Row {
  label: string;
  segments: number;
  medianElements: number;
  medianLogicalKiB: number;
  p95LogicalKiB: number;
  maxLogicalKiB: number;
  storedMiB: number;
  manifestKiB: number;
  decodeMs: number;
  p95DecodeMs: number;
  editSegments: number;
  editKiB: number;
  insertSegments: number;
  insertKiB: number;
}

/** The segments `after` holds that `before` does not, where `mapped(j)` names
 *  element `j` of `after` by its index in `before` (-1 for a new one), and the
 *  bytes they cost as blobs. */
function rewritten(
  type: EastType,
  bytes: readonly Uint8Array[],
  before: readonly number[],
  beforeLength: number,
  after: readonly number[],
  mapped: (j: number) => number,
  changed: (j: number) => boolean,
): { segments: number; bytes: number } {
  const old = new Set<string>();
  for (let s = 0; s < before.length; s++) {
    old.add(`${before[s]}:${s + 1 < before.length ? before[s + 1] : beforeLength}`);
  }
  let segments = 0;
  let total = 0;
  for (let s = 0; s < after.length; s++) {
    const from = after[s]!;
    const to = s + 1 < after.length ? after[s + 1]! : bytes.length;
    let same = mapped(from) >= 0 && mapped(to - 1) === mapped(from) + (to - 1 - from) && old.has(`${mapped(from)}:${mapped(to - 1) + 1}`);
    for (let j = from; same && j < to; j++) if (changed(j) || mapped(j) < 0) same = false;
    if (!same) {
      segments++;
      total += segmentBlob(type, bytes, from, to).length;
    }
  }
  return { segments, bytes: total };
}

/** Measures one setting on one benchmark. */
function measure(bench: Bench, encoded: Encoded, p: Params): Row {
  const sizes = encoded.bytes.map((b) => b.length);
  const starts = cut(p, sizes, encoded.hashes);
  const n = encoded.bytes.length;
  const ends = starts.map((start, s) => (s + 1 < starts.length ? starts[s + 1]! : n));

  const counts = starts.map((start, s) => ends[s]! - start);
  const logical = starts.map((start, s) => {
    let total = 0;
    for (let i = start; i < ends[s]!; i++) total += sizes[i]!;
    return total;
  });
  const blobs = starts.map((start, s) => segmentBlob(bench.type, encoded.bytes, start, ends[s]!));
  const stored = blobs.map((blob) => blob.length);

  // A page read decodes one segment: timed on segments spread over the whole.
  const decode = decodeBeast2For(bench.type);
  const sample = Array.from({ length: Math.min(40, blobs.length) }, (_, i) => Math.floor((i * blobs.length) / Math.min(40, blobs.length)));
  for (const s of sample.slice(0, 5)) decode(blobs[s]!);
  const times = sample.map((s) => {
    const t0 = performance.now();
    decode(blobs[s]!);
    return performance.now() - t0;
  });

  const manifest = manifestBytes(bench.type, encoded, starts, stored);
  const middle = Math.floor(n / 2);

  // An edit of the middle element: its bytes change, a Set's or Dict's key
  // does not.
  const edit = encode(bench.type, [bench.edited(bench.elements[middle])]);
  const editedBytes = encoded.bytes.slice();
  editedBytes[middle] = edit.bytes[0]!;
  const editedHashes = encoded.hashes.slice();
  editedHashes[middle] = edit.hashes[0]!;
  const editedStarts = cut(p, editedBytes.map((b) => b.length), editedHashes);
  const editCost = rewritten(bench.type, editedBytes, starts, n, editedStarts, (j) => j, (j) => j === middle);

  // An insert just after the middle element.
  const insert = encode(bench.type, [bench.inserted(bench.elements[middle])]);
  const insertedBytes = [...encoded.bytes.slice(0, middle + 1), insert.bytes[0]!, ...encoded.bytes.slice(middle + 1)];
  const insertedHashes = [...encoded.hashes.slice(0, middle + 1), insert.hashes[0]!, ...encoded.hashes.slice(middle + 1)];
  const insertedStarts = cut(p, insertedBytes.map((b) => b.length), insertedHashes);
  const insertCost = rewritten(bench.type, insertedBytes, starts, n, insertedStarts,
    (j) => (j <= middle ? j : j === middle + 1 ? -1 : j - 1), () => false);

  return {
    label: p.label,
    segments: starts.length,
    medianElements: median(counts),
    medianLogicalKiB: median(logical) / 1024,
    p95LogicalKiB: quantile(logical, 0.95) / 1024,
    maxLogicalKiB: Math.max(...logical) / 1024,
    storedMiB: stored.reduce((a, b) => a + b, 0) / (1024 * 1024),
    manifestKiB: manifest / 1024,
    decodeMs: median(times),
    p95DecodeMs: quantile(times, 0.95),
    editSegments: editCost.segments,
    editKiB: (editCost.bytes + manifest) / 1024,
    insertSegments: insertCost.segments,
    insertKiB: (insertCost.bytes + manifest) / 1024,
  };
}

/** One benchmark's table, as markdown. */
function table(bench: Bench, logicalMiB: number, rows: Row[]): string {
  const f = (x: number, digits = 1): string => x.toFixed(digits);
  return [
    `### ${bench.name} — ${bench.elements.length} elements, ${f(logicalMiB)} MiB logical`,
    '',
    '| setting | segments | elements/seg (median) | seg KiB median / p95 / max | stored MiB | manifest KiB | decode one seg ms median / p95 | edit: segs / KiB written | insert: segs / KiB written |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.label} | ${r.segments} | ${r.medianElements} | ${f(r.medianLogicalKiB)} / ${f(r.p95LogicalKiB)} / ${f(r.maxLogicalKiB)} | ${f(r.storedMiB, 2)} | ${f(r.manifestKiB)} | ${f(r.decodeMs, 3)} / ${f(r.p95DecodeMs, 3)} | ${r.editSegments} / ${f(r.editKiB)} | ${r.insertSegments} / ${f(r.insertKiB)} |`),
    '',
  ].join('\n');
}

// =============================================================================
// The benchmarks
// =============================================================================

const NarrowType = StructType({ id: IntegerType, name: StringType, amount: FloatType, active: BooleanType });
type Narrow = ValueTypeOf<typeof NarrowType>;

const ItemType = StructType({ sku: StringType, qty: IntegerType, price: FloatType, ok: BooleanType, when: DateTimeType });
/** The #765 harness row: 16 fields and six nested arrays of 11 structs, about
 *  1.2 KB on the wire. */
const WideRowType = StructType({
  id: IntegerType, site: StringType, region: StringType,
  f1: FloatType, f2: FloatType, f3: FloatType,
  n1: IntegerType, n2: IntegerType, flag: BooleanType, ts: DateTimeType,
  a0: ArrayType(ItemType), a1: ArrayType(ItemType), a2: ArrayType(ItemType),
  a3: ArrayType(ItemType), a4: ArrayType(ItemType), a5: ArrayType(ItemType),
});
type WideRow = ValueTypeOf<typeof WideRowType>;

const key = (i: number): string => `k${String(i).padStart(8, '0')}`;

function narrow(i: number): Narrow {
  return { id: BigInt(i), name: `name-${i % 997}`, amount: ((i * 7919) % 10_000) / 100, active: i % 3 !== 0 };
}

/** Row `i` of the #765 harness table: noise seeded by `i`, so every run
 *  builds the same rows. */
function wideRow(i: number): WideRow {
  let seed = ((i * 2654435761) ^ 0x9e3779b9) >>> 0 || 7;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const items = (): ValueTypeOf<typeof ItemType>[] => Array.from({ length: 11 }, () => ({
    sku: `SKU-${Math.floor(rnd() * 5000)}`,
    qty: BigInt(Math.floor(rnd() * 100)),
    price: rnd() * 100,
    ok: rnd() > 0.5,
    when: new Date(1700000000000 + Math.floor(rnd() * 1e9)),
  }));
  return {
    id: BigInt(i), site: `site-${i % 40}`, region: `R${i % 7}`,
    f1: rnd(), f2: rnd(), f3: rnd(),
    n1: BigInt(i % 1000), n2: BigInt(Math.floor(rnd() * 1e6)), flag: rnd() > 0.3,
    ts: new Date(1700000000000 + i * 1000),
    a0: items(), a1: items(), a2: items(), a3: items(), a4: items(), a5: items(),
  };
}

/** A 1 MiB blob of noise seeded by `i` — a payload deflate cannot shrink. */
function payload(i: number): Uint8Array {
  const out = new Uint8Array(1024 * 1024);
  let s = (i * 0x9e3779b9) >>> 0 || 1;
  for (let at = 0; at < out.length; at += 4) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    out[at] = s & 0xff; out[at + 1] = (s >>> 8) & 0xff; out[at + 2] = (s >>> 16) & 0xff; out[at + 3] = s >>> 24;
  }
  return out;
}

const scale = full
  ? { narrow: 1_000_000, wide: 100_000, blobs: 300 }
  : { narrow: 20_000, wide: 2_000, blobs: 24 };

const benches: Bench[] = [
  {
    name: 'Narrow rows, Dict<String, {id, name, amount, active}>',
    type: DictType(StringType, NarrowType),
    elements: Array.from({ length: scale.narrow }, (_, i) => [key(i), narrow(i)]),
    edited: (e) => [(e as [string, Narrow])[0], { ...(e as [string, Narrow])[1], name: 'edited' }],
    inserted: (e) => [`${(e as [string, Narrow])[0]}-inserted`, narrow(-1)],
  },
  {
    name: 'Narrow rows, Array<{id, name, amount, active}>',
    type: ArrayType(NarrowType),
    elements: Array.from({ length: scale.narrow }, (_, i) => narrow(i)),
    edited: (e) => ({ ...(e as Narrow), name: 'edited' }),
    inserted: () => narrow(-1),
  },
  {
    name: 'Rows of about a kilobyte, Dict<String, the #765 harness row>',
    type: DictType(StringType, WideRowType),
    elements: Array.from({ length: scale.wide }, (_, i) => [key(i), wideRow(i)]),
    edited: (e) => [(e as [string, WideRow])[0], { ...(e as [string, WideRow])[1], site: 'edited' }],
    inserted: (e) => [`${(e as [string, WideRow])[0]}-inserted`, wideRow(-1)],
  },
  {
    name: 'Wide rows, Dict<String, Blob> of 1 MiB each',
    type: DictType(StringType, BlobType),
    elements: Array.from({ length: scale.blobs }, (_, i) => [key(i), payload(i)]),
    edited: (e) => {
      const blob = (e as [string, Uint8Array])[1].slice();
      blob[0] ^= 0xff;
      return [(e as [string, Uint8Array])[0], blob];
    },
    inserted: (e) => [`${(e as [string, Uint8Array])[0]}-inserted`, payload(-1)],
  },
];

describe('segmentation benchmarks', () => {
  for (const bench of benches) {
    it(`simulates the writer's cut exactly: ${bench.name}`, () => {
      const encoded = encode(bench.type, bench.elements);
      const sizes = encoded.bytes.map((b) => b.length);
      const starts = cut(CURRENT, sizes, encoded.hashes);
      const counts = starts.map((start, s) => (s + 1 < starts.length ? starts[s + 1]! : sizes.length) - start);
      const value = toEastTypeValue(bench.type).type === 'Array' ? bench.elements : new Map(bench.elements as [unknown, unknown][]);
      const blob = encodeBeast2PagedFor(bench.type, { codec: 'none' })(value as never);
      assert.deepEqual(counts, [...readBeast2Extents(blob).counts]);
    });
  }

  it('measures each setting', { skip: !full ? 'full scale is opt-in: set E3_SEGMENTATION_BENCH=1' : false }, () => {
    const report: string[] = [];
    for (const bench of benches) {
      const encoded = encode(bench.type, bench.elements);
      const logicalMiB = encoded.bytes.reduce((total, b) => total + b.length, 0) / (1024 * 1024);
      report.push(table(bench, logicalMiB, SETTINGS.map((p) => measure(bench, encoded, p))));
    }
    console.log(`\n${report.join('\n')}`);
  });
});
