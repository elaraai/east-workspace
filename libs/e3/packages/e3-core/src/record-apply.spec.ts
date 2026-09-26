/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Applying a mutation delta segment by segment.
 *
 * One property carries this whole module, and every test here is a way of
 * asking it: **the manifest an apply writes equals the manifest the encoder
 * door writes for the same value, hash for hash**. If it ever does not, two
 * equal records hold different objects, a rebuilt index stops matching a
 * maintained one, and the store's deduplication silently stops working — none
 * of which fails loudly anywhere else.
 *
 * The second property is the one the layout exists for: an edit rewrites the
 * segments it touched and re-announces the rest, so the object count a commit
 * adds is bounded by what changed and not by the record's size.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import {
  DictType, IntegerType, SEGMENT_RULE_KEYED, SetType, SortedMap, SortedSet, StringType, StructType,
  compareFor, decodeBeast2For, toEastTypeValue, variant, type EastType, type ValueTypeOf,
} from '@elaraai/east';
import { encodeDatasetBlob, mutationDeltaType, type DeltaTarget } from '@elaraai/e3-types';
import { DatasetSegments } from './dataset-open.js';
import { datasetWrite } from './trees.js';
import { DeltaConflictError, applyDelta } from './record-apply.js';
import { createTestRepo, encodeInSegmentsOf, removeTestRepo, storeSegmentsOf } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './index.js';

const RowType = StructType({ due: IntegerType, title: StringType });
const PlansType = DictType(StringType, RowType);
const FlagsType = SetType(StringType);

type Row = ValueTypeOf<typeof RowType>;

/** `p-000123` — fixed width so the string order is the numeric one. */
const id = (i: number): string => `p-${String(i).padStart(6, '0')}`;
const row = (i: number): Row => ({ due: BigInt(i), title: `Plan ${i}` });

/** A Dict of `n` rows, in canonical order. */
function plansOf(n: number): SortedMap<string, Row> {
  return new SortedMap<string, Row>(
    Array.from({ length: n }, (_, i) => [id(i), row(i)] as [string, Row]),
    compareFor(StringType));
}

/** A storage backend that counts what an apply actually reads and writes.
 *  The manifest a write produces is content-addressed, so re-announcing an
 *  untouched segment is a write of bytes already stored — counted here as the
 *  store sees it, which is the number that has to stay flat. */
function countingStore(inner: StorageBackend): StorageBackend & { cost: { reads: number; writes: number; bytes: number } } {
  const cost = { reads: 0, writes: 0, bytes: 0 };
  // A Proxy, not a spread: the store is a class instance and its methods live
  // on the prototype, where a spread does not reach them.
  const objects = new Proxy(inner.objects, {
    get(target, property, receiver) {
      if (property === 'read') {
        return (repo: string, hash: string) => {
          cost.reads++;
          return target.read(repo, hash);
        };
      }
      if (property === 'write') {
        return async (repo: string, bytes: Uint8Array) => {
          const hash = await target.write(repo, bytes);
          cost.writes++;
          cost.bytes += bytes.byteLength;
          return hash;
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return new Proxy(inner, {
    get(target, property, receiver) {
      if (property === 'objects') return objects;
      if (property === 'cost') return cost;
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as StorageBackend & { cost: typeof cost };
}

describe('applying a mutation delta', () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage(dirname(repo));
  });
  afterEach(() => removeTestRepo(repo));

  /** Store a value through the door's value path, and answer with its manifest. */
  async function store(type: EastType, value: unknown): Promise<string> {
    return datasetWrite(storage, repo, value, type);
  }

  /** Store a delta over one target and answer with its object hash. */
  async function delta(
    target: string, keyType: EastType, collectionType: EastType, ops: Array<[unknown, unknown]>,
  ): Promise<string> {
    const targets: DeltaTarget[] = [{ name: target, keyType, collectionType }];
    const type = mutationDeltaType(targets);
    const keyOf = (type as unknown as { key: EastType }).key;
    const entries = new SortedMap<unknown, unknown>(
      ops.map(([key, op]) => [variant(target, key), variant(target, op)] as [unknown, unknown]),
      compareFor(toEastTypeValue(keyOf)) as (a: unknown, b: unknown) => -1 | 0 | 1);
    return storage.objects.write(repo,
      await encodeDatasetBlob(type, entries, (bytes) => storage.objects.write(repo, bytes)));
  }

  /** Apply `ops` to a stored Dict and answer with the new manifest hash. */
  async function applyPlans(hash: string, ops: Array<[unknown, unknown]>): Promise<string> {
    const written = await applyDelta(storage, repo,
      new Map([['primary', hash]]),
      await delta('primary', StringType, PlansType, ops));
    return written.get('primary')!;
  }

  it('writes what the encoder door writes, for an edit in the middle of a big record', async () => {
    const before = plansOf(5_000);
    const hash = await store(PlansType, before);
    const segments = await DatasetSegments.open(storage, repo, hash);
    assert.ok(segments.segmentCount > 2, `a 5,000-row record should span segments, not ${segments.segmentCount}`);

    const after = new SortedMap(before, compareFor(StringType));
    after.set(id(2_500), { due: 2_500n, title: 'RETITLED' });
    const applied = await applyPlans(hash, [[id(2_500), variant('update', variant('patch', {
      due: variant('unchanged', null),
      title: variant('replace', { before: 'Plan 2500', after: 'RETITLED' }),
    }))]]);

    assert.equal(applied, await store(PlansType, after), 'the applied manifest IS the rebuilt manifest');
  });

  it('rewrites one segment and re-announces every other', async () => {
    const before = plansOf(5_000);
    const hash = await store(PlansType, before);
    const was = await DatasetSegments.open(storage, repo, hash);

    const applied = await applyPlans(hash, [[id(2_500), variant('update', variant('patch', {
      due: variant('unchanged', null),
      title: variant('replace', { before: 'Plan 2500', after: 'RETITLED' }),
    }))]]);
    const now = await DatasetSegments.open(storage, repo, applied);

    assert.equal(now.segmentCount, was.segmentCount, 'a one-row edit moves no boundary');
    const moved = now.manifest!.entries.filter((e, i) => e.hash !== was.manifest!.entries[i]!.hash);
    assert.equal(moved.length, 1, 'exactly one segment object is new');
  });

  it('agrees with the door after inserts, deletes and a re-cut of the boundaries', async () => {
    // Enough contiguous inserts to split a segment, and enough contiguous
    // deletes to merge two — both cases where the run must extend past the
    // segment the keys bisected into.
    const before = plansOf(4_000);
    const hash = await store(PlansType, before);
    const after = new SortedMap(before, compareFor(StringType));
    const ops: Array<[unknown, unknown]> = [];
    for (let i = 0; i < 1_500; i++) {
      const key = `${id(1_000)}-ins-${String(i).padStart(4, '0')}`;
      after.set(key, row(100_000 + i));
      ops.push([key, variant('insert', row(100_000 + i))]);
    }
    for (let i = 2_000; i < 3_200; i++) {
      after.delete(id(i));
      ops.push([id(i), variant('delete', row(i))]);
    }
    ops.sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1));

    assert.equal(await applyPlans(hash, ops), await store(PlansType, after));
  });

  it("agrees with the door when a delete removes a segment's first key", async () => {
    // A segment starts at its first key because the segment before it ended
    // there. Deleting that key hands the boundary back to the cut rule, with
    // the segment before still in the cutter's count — so the re-cut must look
    // back across the edit rather than start afresh at it.
    const before = plansOf(5_000);
    const hash = await store(PlansType, before);
    const segments = await DatasetSegments.open(storage, repo, hash);
    assert.ok(segments.segmentCount >= 3,
      `a fence needs a left neighbour, and this has ${segments.segmentCount} segments`);

    const all = new SortedMap(before, compareFor(StringType));
    const ops: Array<[unknown, unknown]> = [];
    for (let i = 1; i < segments.segmentCount; i++) {
      const fence = await segments.fence(i) as string;
      const after = new SortedMap(before, compareFor(StringType));
      after.delete(fence);
      assert.equal(
        await applyPlans(hash, [[fence, variant('delete', before.get(fence)!)]]),
        await store(PlansType, after),
        `deleting the first key of segment ${i}`);
      all.delete(fence);
      ops.push([fence, variant('delete', before.get(fence)!)]);
    }
    assert.equal(await applyPlans(hash, ops), await store(PlansType, all), 'every fence in one delta');
  });

  it('agrees with the door when a whole inner segment is deleted', async () => {
    const before = plansOf(5_000);
    const hash = await store(PlansType, before);
    const segments = await DatasetSegments.open(storage, repo, hash);
    const held = decodeBeast2For(PlansType)(await segments.segment(1)) as Map<string, Row>;
    const after = new SortedMap(before, compareFor(StringType));
    const ops: Array<[unknown, unknown]> = [];
    for (const [key, value] of held) {
      after.delete(key);
      ops.push([key, variant('delete', value)]);
    }
    assert.equal(await applyPlans(hash, ops), await store(PlansType, after));
  });

  it('agrees with the door over randomised edits drawn at the boundaries', async () => {
    // A fence is one key in a thousand, so uniformly drawn deletes land on one
    // about once a run and the shapes that turn on a moved boundary — a run
    // beginning at a deleted fence, two of them adjacent, a chain of them —
    // are never reached at all. Drawing at the fences reaches every one.
    const before = plansOf(5_000);
    const hash = await store(PlansType, before);
    const segments = await DatasetSegments.open(storage, repo, hash);
    const fences: string[] = [];
    for (let i = 0; i < segments.segmentCount; i++) fences.push(await segments.fence(i) as string);

    let seed = 0x9e3779b9;
    const next = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let round = 0; round < 12; round++) {
      const edits = new SortedMap<string, unknown>(undefined, compareFor(StringType));
      for (const fence of fences) {
        if (next() < 0.5) edits.set(fence, variant('delete', before.get(fence)!));
      }
      for (let i = 0; i < 60; i++) {
        const key = id(Math.floor(next() * 5_000));
        if (!edits.has(key)) edits.set(key, variant('delete', before.get(key)!));
      }
      for (let i = 0; i < 30; i++) {
        const key = `${id(Math.floor(next() * 5_000))}-ins`;
        if (!edits.has(key)) edits.set(key, variant('insert', row(900_000 + i)));
      }

      const after = new SortedMap(before, compareFor(StringType));
      const ops: Array<[unknown, unknown]> = [];
      for (const [key, op] of edits) {
        if ((op as { type: string }).type === 'delete') after.delete(key);
        else after.set(key, (op as { value: Row }).value);
        ops.push([key, op]);
      }
      assert.equal(await applyPlans(hash, ops), await store(PlansType, after), `round ${round}`);
    }
  });

  it('agrees with the door when the record empties, and when it starts empty', async () => {
    const before = plansOf(700);
    const hash = await store(PlansType, before);
    const emptied = await applyPlans(hash,
      [...before].map(([key, value]) => [key, variant('delete', value)] as [unknown, unknown]));
    assert.equal(emptied, await store(PlansType, new SortedMap<string, Row>(undefined, compareFor(StringType))));

    const filled = await applyPlans(emptied,
      [...before].map(([key, value]) => [key, variant('insert', value)] as [unknown, unknown]));
    assert.equal(filled, hash, 'filling an empty record back up reproduces its manifest');
  });

  it('refuses a record an older e3 wrote — cut under another rule, or held as one blob — naming the fix', async () => {
    const blob = encodeInSegmentsOf(PlansType, 700)(plansOf(3_000));
    const cut = await storeSegmentsOf(storage, repo, blob);
    await assert.rejects(applyPlans(cut, [[id(1_234), variant('delete', row(1_234))]]), {
      message: `store: manifest ${cut.slice(0, 8)} was cut under test/as-encoded, not the current ${SEGMENT_RULE_KEYED}: ` +
        'an older e3 wrote this repository — re-create it: deploy again and import its data again',
    });
    const whole = await storage.objects.write(repo, blob);
    await assert.rejects(applyPlans(whole, [[id(1_234), variant('delete', row(1_234))]]), {
      message: `the collection ${whole} is stored as one blob: ` +
        'an older e3 wrote this repository — re-create it: deploy again and import its data again',
    });
  });

  it('agrees with the door for a Set target', async () => {
    const before = new SortedSet<string>(
      Array.from({ length: 3_000 }, (_, i) => id(i)), compareFor(StringType));
    const hash = await store(FlagsType, before);
    const after = new SortedSet(before, compareFor(StringType));
    after.delete(id(1_500));
    after.add('zzz');

    const written = await applyDelta(storage, repo, new Map([['primary', hash]]),
      await delta('primary', StringType, FlagsType, [
        [id(1_500), variant('delete', null)],
        ['zzz', variant('insert', null)],
      ]));
    assert.equal(written.get('primary'), await store(FlagsType, after));
  });

  it('moves every arm of a delta, and leaves a target it does not name alone', async () => {
    const EntryKeyType = StructType({ ik: IntegerType, k: StringType });
    const IndexType = DictType(EntryKeyType, StringType);
    const primary = await store(PlansType, plansOf(600));
    const index = await store(IndexType, new SortedMap<{ ik: bigint; k: string }, string>(
      Array.from({ length: 600 }, (_, i) => [{ ik: BigInt(i), k: id(i) }, `Plan ${i}`] as [{ ik: bigint; k: string }, string]),
      compareFor(toEastTypeValue(EntryKeyType))));

    const targets: DeltaTarget[] = [
      { name: 'primary', keyType: StringType, collectionType: PlansType },
      { name: 'by_due', keyType: EntryKeyType, collectionType: IndexType },
      { name: 'untouched', keyType: StringType, collectionType: PlansType },
    ];
    const type = mutationDeltaType(targets);
    const entries = new SortedMap<unknown, unknown>(undefined,
      compareFor(toEastTypeValue((type as unknown as { key: EastType }).key)) as (a: unknown, b: unknown) => -1 | 0 | 1);
    entries.set(variant('primary', id(7)), variant('primary', variant('delete', row(7))));
    entries.set(variant('by_due', { ik: 7n, k: id(7) }), variant('by_due', variant('delete', 'Plan 7')));
    const deltaHash = await storage.objects.write(repo,
      await encodeDatasetBlob(type, entries, (bytes) => storage.objects.write(repo, bytes)));

    const written = await applyDelta(storage, repo,
      new Map([['primary', primary], ['by_due', index], ['untouched', primary]]), deltaHash);
    assert.deepEqual([...written.keys()].sort(), ['by_due', 'primary']);

    const expected = plansOf(600);
    expected.delete(id(7));
    assert.equal(written.get('primary'), await store(PlansType, expected));
  });

  it('costs the same at 100,000 rows as at 10,000 — the whole point of the layout', async () => {
    // Counted, never timed: a write that is secretly O(state) shows up as a
    // segment count that tracks the record's size, and nothing else here
    // would catch it.
    const cost = async (rows: number): Promise<{ reads: number; writes: number; bytes: number }> => {
      const hash = await store(PlansType, plansOf(rows));
      const counted = countingStore(storage);
      const written = await applyDelta(counted, repo, new Map([['primary', hash]]),
        await delta('primary', StringType, PlansType, [[id(rows >> 1), variant('update', variant('patch', {
          due: variant('unchanged', null),
          title: variant('replace', { before: `Plan ${rows >> 1}`, after: 'RETITLED' }),
        }))]]));
      assert.ok(written.has('primary'));
      return counted.cost;
    };

    const small = await cost(10_000);
    const large = await cost(100_000);
    // Two segment reads and two segment writes is the ceiling: the segment the
    // key falls in, plus a neighbour when a boundary moves. The manifest, its
    // header and the delta account for the rest.
    assert.ok(large.reads <= small.reads + 2, `reads grew from ${small.reads} to ${large.reads}`);
    assert.ok(large.writes <= small.writes + 2, `writes grew from ${small.writes} to ${large.writes}`);
    assert.ok(large.bytes <= small.bytes * 2,
      `bytes written grew from ${small.bytes} to ${large.bytes} for the same one-row edit`);
  });

  it('refuses a delta that disagrees with the state, naming the key', async () => {
    const hash = await store(PlansType, plansOf(600));
    await assert.rejects(
      applyPlans(hash, [['p-999999', variant('delete', row(9))]]),
      (err: unknown) => err instanceof DeltaConflictError && /p-999999/.test(err.message));
    await assert.rejects(
      applyPlans(hash, [[id(3), variant('delete', row(4))]]),
      (err: unknown) => err instanceof DeltaConflictError && /expected value/.test(err.message),
      'a delete whose payload is not the held value is a stale write');
  });

  it('refuses a delta naming a target the record does not hold', async () => {
    const hash = await store(PlansType, plansOf(10));
    await assert.rejects(
      applyDelta(storage, repo, new Map([['primary', hash]]),
        await delta('by_nothing', StringType, PlansType, [[id(0), variant('delete', row(0))]])),
      /does not hold/);
  });
});
