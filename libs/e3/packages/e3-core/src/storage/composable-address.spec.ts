/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Proof that the segment-aligned address composes.
 *
 * The properties asserted here are the whole justification for the scheme, so
 * they are stated as properties rather than examples:
 *
 * 1. the leaves tile the blob exactly, so the address commits to every byte;
 * 2. the address is a pure function of those bytes;
 * 3. a carve's and a splice's address follow from the sources' side-cars,
 *    with no frame bytes read — for every collection root kind, every segment
 *    range, and transitively through re-carves;
 * 4. the alternatives that look like they should work (flat SHA-256, and
 *    fixed-size chunking) demonstrably do not.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ArrayType, StructType, StringType, IntegerType, FloatType, DictType, SetType,
  encodeBeast2PagedFor, encodeBeast2For,
  readBeast2Extents, carveBeast2, spliceBeast2,
  openBeast2PagesFor,
} from '@elaraai/east';
import {
  objectLeaves,
  computeAddress,
  addressFromLeafDigests,
  digestsOf,
  digestsOfCarve,
  digestsOfSplice,
  addressOfCarve,
  addressOfSplice,
  encodeObjectDigests,
  decodeObjectDigests,
  type ObjectDigests,
} from './composable-address.js';

const sha256 = (data: Uint8Array): Buffer => createHash('sha256').update(data).digest();

const RowType = StructType({ id: IntegerType, name: StringType, score: FloatType });
const TableType = ArrayType(RowType);
const KeysType = SetType(IntegerType);
const MapType = DictType(StringType, IntegerType);

const rows = (n: number, base = 0) =>
  Array.from({ length: n }, (_, i) => ({
    id: BigInt(base + i),
    name: `row-${base + i}-${'x'.repeat((i % 17) + 1)}`,
    score: (base + i) * 1.5,
  }));

const table = encodeBeast2PagedFor(TableType, { batchSize: 50 })(rows(1000));
const keySet = encodeBeast2PagedFor(KeysType, { batchSize: 40 })(
  new Set(Array.from({ length: 400 }, (_, i) => BigInt(i * 7))));
const dict = encodeBeast2PagedFor(MapType, { batchSize: 40 })(
  new Map(Array.from({ length: 400 }, (_, i) => [`k${String(i).padStart(5, '0')}`, BigInt(i)])));
const singleSegment = encodeBeast2PagedFor(TableType, { batchSize: 10_000 })(rows(5));
const emptyTable = encodeBeast2PagedFor(TableType, { batchSize: 50 })([]);
const scalar = encodeBeast2For(RowType)({ id: 7n, name: 'lonely', score: 1 });

const COLLECTIONS: Array<[string, Uint8Array]> = [
  ['Array', table],
  ['Set', keySet],
  ['Dict', dict],
  ['Array/single segment', singleSegment],
  ['Array/empty', emptyTable],
];

const segmentCount = (blob: Uint8Array): number => readBeast2Extents(blob).offsets.length;

describe('composable address — commitment', () => {
  for (const [name, blob] of COLLECTIONS) {
    it(`leaves tile the blob exactly — ${name}`, () => {
      const leaves = objectLeaves(blob);
      assert.equal(leaves.reduce((n, l) => n + l.length, 0), blob.length);
      assert.deepEqual(Buffer.concat(leaves.map((l) => Buffer.from(l))), Buffer.from(blob));
    });
  }

  it('every leaf is load-bearing — mutating any byte changes the address', () => {
    const base = computeAddress(table);
    const ext = readBeast2Extents(table);
    const probes = [0, 8, 40, ext.prefixEnd, ext.prefixEnd + 9,
      Math.floor(table.length / 2), ext.segmentsEnd + 2, table.length - 1];
    for (const at of probes) {
      const mutated = Uint8Array.from(table);
      mutated[at] ^= 0x01;
      let addr: string;
      try {
        addr = computeAddress(mutated);
      } catch {
        continue; // a structural byte: the parse rejects it outright, which is stronger
      }
      assert.notEqual(addr, base, `flipping byte ${at} left the address unchanged`);
    }
  });

  it('leaf-count binding defeats concatenation ambiguity', () => {
    const d = digestsOf(table);
    const four = d.frameDigests.slice(0, 4);
    const merged = [Buffer.concat([Buffer.from(four[0]!), Buffer.from(four[1]!)]), four[2]!, four[3]!];
    assert.notEqual(addressFromLeafDigests(four), addressFromLeafDigests(merged));
  });
});

describe('composable address — purity', () => {
  it('is deterministic', () => {
    for (const [, blob] of COLLECTIONS) {
      assert.equal(computeAddress(blob), computeAddress(Uint8Array.from(blob)));
    }
  });

  it('dedups identical encodings', () => {
    const a = encodeBeast2PagedFor(TableType, { batchSize: 50 })(rows(1000));
    const b = encodeBeast2PagedFor(TableType, { batchSize: 50 })(rows(1000));
    assert.deepEqual(Buffer.from(a), Buffer.from(b), 'precondition: the encoder is deterministic');
    assert.equal(computeAddress(a), computeAddress(b));
  });

  it('separates values segmented differently, exactly as a flat hash does', () => {
    const a = encodeBeast2PagedFor(TableType, { batchSize: 50 })(rows(1000));
    const b = encodeBeast2PagedFor(TableType, { batchSize: 100 })(rows(1000));
    assert.notDeepEqual(Buffer.from(a), Buffer.from(b), 'precondition: different bytes');
    assert.notEqual(computeAddress(a), computeAddress(b));
    assert.notEqual(sha256(a).toString('hex'), sha256(b).toString('hex'));
  });

  it('addresses non-collection and un-indexed blobs as a single leaf', () => {
    assert.equal(objectLeaves(scalar).length, 1);
    assert.equal(computeAddress(scalar), addressFromLeafDigests([sha256(scalar)]));
  });
});

describe('composable address — carve composes', () => {
  for (const [name, blob] of COLLECTIONS) {
    it(`every segment range composes exactly — ${name}`, () => {
      const n = segmentCount(blob);
      const d = digestsOf(blob);
      let checked = 0;
      for (let from = 0; from <= n; from++) {
        for (let to = from; to <= n; to++) {
          assert.equal(addressOfCarve(d, from, to), computeAddress(carveBeast2(blob, from, to)),
            `carve [${from}, ${to})`);
          checked++;
        }
      }
      assert.ok(checked > 0);
    });
  }

  it('composes from a side-car that holds no frame bytes', () => {
    // Round-trip the side-car through its serialization: whatever survives is
    // all composition gets, and it provably contains no frame bytes.
    const d = decodeObjectDigests(encodeObjectDigests(digestsOf(table)));
    const n = segmentCount(table);
    for (let from = 0; from < n; from++) {
      const to = Math.min(from + 3, n);
      assert.equal(addressOfCarve(d, from, to), computeAddress(carveBeast2(table, from, to)));
    }
  });

  it('derives a carve side-car matching the carve itself', () => {
    const d = digestsOf(table);
    const n = segmentCount(table);
    for (const [from, to] of [[0, 5], [3, 9], [7, n]] as const) {
      const derived = digestsOfCarve(d, from, to);
      const actual = digestsOf(carveBeast2(table, from, to));
      assert.deepEqual(derived.offsets, actual.offsets);
      assert.deepEqual(derived.counts, actual.counts);
      assert.equal(derived.segmentsEnd, actual.segmentsEnd);
      assert.deepEqual(derived.frameDigests.map((x) => Buffer.from(x)),
        actual.frameDigests.map((x) => Buffer.from(x)));
    }
  });

  it('is transitive — a carve of a carve agrees with carving the source', () => {
    const d = digestsOf(table);
    const n = segmentCount(table);
    for (const [a, b] of [[2, 12], [0, 8], [5, n]] as const) {
      const outer = carveBeast2(table, a, b);
      const derived = digestsOfCarve(d, a, b);
      const m = segmentCount(outer);
      for (const [c, e] of [[0, 1], [1, Math.min(4, m)], [0, m]] as const) {
        if (e > m || c >= e) continue;
        const equivalent = carveBeast2(table, a + c, a + e);
        assert.deepEqual(Buffer.from(carveBeast2(outer, c, e)), Buffer.from(equivalent));
        assert.equal(addressOfCarve(derived, c, e), computeAddress(equivalent),
          `carve([${a},${b}))[${c},${e}) should equal carve[${a + c},${a + e})`);
      }
    }
  });

  it('rejects an out-of-range segment span', () => {
    const d = digestsOf(table);
    const n = segmentCount(table);
    assert.throws(() => addressOfCarve(d, 0, n + 1), /carve range/);
    assert.throws(() => addressOfCarve(d, 3, 1), /carve range/);
    assert.throws(() => addressOfCarve(d, -1, 2), /carve range/);
  });

  it('does not silently accept a corrupted frame digest', () => {
    const d = digestsOf(table);
    const poisoned: ObjectDigests = {
      ...d,
      frameDigests: d.frameDigests.map((x, i) => {
        if (i !== 3) return x;
        const c = Buffer.from(x); c[0] ^= 0xff; return c;
      }),
    };
    assert.notEqual(addressOfCarve(poisoned, 2, 6), computeAddress(carveBeast2(table, 2, 6)));
    // a range excluding the poisoned frame is unaffected
    assert.equal(addressOfCarve(poisoned, 5, 8), computeAddress(carveBeast2(table, 5, 8)));
  });
});

describe('composable address — splice composes', () => {
  it('matches the byte-level splice for several partitionings', () => {
    const n = segmentCount(table);
    for (const cuts of [
      [[0, 3], [3, n]],
      [[0, 1], [1, 2], [2, n]],
      [[0, 4], [4, 6], [6, 7], [7, n]],
      [[0, n]],
    ] as const) {
      const parts = cuts.map(([f, t]) => carveBeast2(table, f, t));
      assert.equal(addressOfSplice(parts.map(digestsOf)), computeAddress(spliceBeast2(parts)),
        `partitioning ${JSON.stringify(cuts)}`);
    }
  });

  it('composes from side-cars derived without reading the parts', () => {
    const d = digestsOf(table);
    const n = segmentCount(table);
    const cuts = [[0, 4], [4, 9], [9, n]] as const;
    const derived = cuts.map(([f, t]) => digestsOfCarve(d, f, t));
    const parts = cuts.map(([f, t]) => carveBeast2(table, f, t));
    assert.equal(addressOfSplice(derived), computeAddress(spliceBeast2(parts)));
    const spliced = digestsOfSplice(derived);
    assert.equal(addressFromLeafDigests([
      spliced.headDigest, ...spliced.frameDigests.map((x) => Buffer.from(x)),
      sha256(spliceBeast2(parts).subarray(readBeast2Extents(spliceBeast2(parts)).segmentsEnd)),
    ]), computeAddress(spliceBeast2(parts)));
  });

  it('round-trips: splicing a full carve partition restores the source address', () => {
    const n = segmentCount(table);
    const parts = ([[0, 2], [2, 5], [5, n]] as const).map(([f, t]) => carveBeast2(table, f, t));
    const rejoined = spliceBeast2(parts);
    assert.deepEqual(Buffer.from(rejoined), Buffer.from(table));
    assert.equal(computeAddress(rejoined), computeAddress(table));
    assert.equal(addressOfSplice(parts.map(digestsOf)), computeAddress(table));
  });

  it('refuses parts with differing header sections, as spliceBeast2 does', () => {
    const OtherType = ArrayType(StructType({ id: IntegerType, label: StringType }));
    const other = encodeBeast2PagedFor(OtherType, { batchSize: 50 })(
      Array.from({ length: 100 }, (_, i) => ({ id: BigInt(i), label: `l${i}` })));
    assert.throws(() => spliceBeast2([carveBeast2(table, 0, 2), carveBeast2(other, 0, 2)]),
      /differing header sections/);
    assert.throws(() => addressOfSplice([digestsOf(carveBeast2(table, 0, 2)), digestsOf(carveBeast2(other, 0, 2))]),
      /differing header sections/);
  });

  it('refuses an empty part list', () => {
    assert.throws(() => addressOfSplice([]), /at least one part/);
  });
});

describe('composable address — the alternatives do not compose', () => {
  it('a carve is not a byte prefix of its source, so a flat hash cannot resume', () => {
    for (const [from, to] of [[1, 4], [2, 5], [3, segmentCount(table)]] as const) {
      const carved = carveBeast2(table, from, to);
      const valueBytes = Buffer.from(carved.subarray(0, readBeast2Extents(carved).segmentsEnd));
      assert.notDeepEqual(valueBytes, Buffer.from(table.subarray(0, valueBytes.length)),
        `carve [${from}, ${to}) unexpectedly equals a source prefix`);
    }
  });

  it('a PREFIX carve is a byte prefix — the one case a hash midstate could serve', () => {
    const d = digestsOf(table);
    for (const k of [1, 3, 5, segmentCount(table)]) {
      const carved = carveBeast2(table, 0, k);
      const valueBytes = Buffer.from(carved.subarray(0, readBeast2Extents(carved).segmentsEnd));
      const sourcePrefix = Buffer.from(table.subarray(0, k < d.offsets.length ? d.offsets[k]! : d.segmentsEnd));
      assert.deepEqual(valueBytes, sourcePrefix);
    }
  });

  it('fixed-size leaves misalign under carve, at every chunk size', () => {
    const d = digestsOf(table);
    for (const chunk of [4096, 64 * 1024, 1024 * 1024]) {
      let misaligned = 0;
      let checked = 0;
      for (let from = 1; from < d.offsets.length; from++) {
        checked++;
        if ((((d.prefixEnd - d.offsets[from]!) % chunk) + chunk) % chunk !== 0) misaligned++;
      }
      assert.equal(misaligned, checked,
        `${checked - misaligned}/${checked} carves were accidentally ${chunk}-byte aligned`);
    }
  });
});

describe('composable address — carved collections stay valid values', () => {
  it('Set and Dict carves decode, keep canonical order, and compose', () => {
    for (const [blob, type] of [[keySet, KeysType], [dict, MapType]] as const) {
      const ext = readBeast2Extents(blob);
      const carved = carveBeast2(blob, 2, 5);
      const pages = openBeast2PagesFor(type)(carved);
      assert.equal(pages.elementCount, ext.counts.slice(2, 5).reduce((a, b) => a + b, 0));
      pages.segment(0); // fence + strict-ascent validation runs here
      assert.equal(addressOfCarve(digestsOf(blob), 2, 5), computeAddress(carved));
    }
  });

  it('a spliced blob decodes to the original element count', () => {
    const n = segmentCount(table);
    const parts = ([[0, 4], [4, n]] as const).map(([f, t]) => carveBeast2(table, f, t));
    assert.equal(openBeast2PagesFor(TableType)(spliceBeast2(parts)).elementCount, 1000);
  });
});

describe('composable address — side-car serialization', () => {
  it('round-trips every fixture', () => {
    for (const [name, blob] of COLLECTIONS) {
      const d = digestsOf(blob);
      const back = decodeObjectDigests(encodeObjectDigests(d));
      assert.equal(back.prefixEnd, d.prefixEnd, name);
      assert.equal(back.segmentsEnd, d.segmentsEnd, name);
      assert.deepEqual(back.offsets, d.offsets, name);
      assert.deepEqual(back.counts, d.counts, name);
      assert.deepEqual(Buffer.from(back.head), Buffer.from(d.head), name);
      assert.deepEqual(Buffer.from(back.headDigest), Buffer.from(d.headDigest), name);
      assert.deepEqual(back.frameDigests.map((x) => Buffer.from(x)),
        d.frameDigests.map((x) => Buffer.from(x)), name);
    }
  });

  it('rejects truncated or inconsistent side-cars', () => {
    const bytes = encodeObjectDigests(digestsOf(table));
    assert.throws(() => decodeObjectDigests(bytes.subarray(0, 8)), /truncated/);
    assert.throws(() => decodeObjectDigests(bytes.subarray(0, bytes.length - 1)), /expected/);
  });

  it('costs 32 bytes per segment, and is not bounded by a small item limit', () => {
    const d = digestsOf(table);
    const bytes = encodeObjectDigests(d);
    const perSegment = (bytes.length - 12 - d.prefixEnd - 32) / d.frameDigests.length;
    assert.equal(perSegment, 40); // 32-byte digest + offset + count
    // A 400 KB DynamoDB item would cap out around here — the reason the
    // side-car belongs in object storage, not a catalogue attribute.
    assert.ok(400_000 / perSegment < 11_000,
      'a 400 KB item holds fewer than 11k segments — large objects overflow it');
  });
});
