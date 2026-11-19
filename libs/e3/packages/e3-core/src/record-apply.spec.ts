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
  DictType, IntegerType, NullType, SEGMENT_RULE_KEYED, SetType, SortedMap, SortedSet, StringType, StructType, VariantType,
  compareFor, decodeBeast2For, toEastTypeValue, variant, type EastType, type ValueTypeOf,
} from '@elaraai/east';
import { DELTA_CONFLICT, RecordSummaryTotalsType, encodeDatasetBlob, mutationDeltaType, type DeltaTarget } from '@elaraai/e3-types';
import { DatasetSegments } from './dataset-open.js';
import { datasetWrite } from './trees.js';
import {
  DELTA_OPS_APPLIED_IN_PLACE, DeltaConflictError, DeltaStoppedError, ExternalEntryError, SummaryIntegrityError, applyDelta, applyDeltaEntries,
  applyDeltaSummarized, applyDeltaWhere, type DeltaApply,
} from './record-apply.js';
import { applyDeltaOnThread } from './execution/delta-thread.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import { Budget } from './execution/budget.js';
import { createTestRepo, encodeInSegmentsOf, removeTestRepo, seededStream, storeSegmentsOf } from './test-helpers.js';
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

/** A summary index's entry (#1039): its leading fields under `on` — none here — then a week and a press (#1432), standing for every row of its key. */
const WeekPressType = StructType({ on: StructType({}), tile: IntegerType, key: StringType });
const SummaryEntryType = StructType({ ik: WeekPressType, k: NullType });
const SummaryType = DictType(SummaryEntryType, RecordSummaryTotalsType);
type SummaryEntry = ValueTypeOf<typeof SummaryEntryType>;
type Totals = ValueTypeOf<typeof RecordSummaryTotalsType>;
const entryOrder = compareFor(SummaryEntryType);
const HOUR = 3_600_000n;

/** The entry of a press in a week. */
const weekOf = (week: number, press: string): SummaryEntry => ({ ik: { on: {}, tile: BigInt(week), key: press }, k: null });
const pressOf = (p: number): string => `P-${1000 + p}`;

/** Every press's totals, a week at a time: between one and five rows, an hour each. */
function totalsOf(presses: number, weeks: number): SortedMap<SummaryEntry, Totals> {
  const totals = new SortedMap<SummaryEntry, Totals>(undefined, entryOrder);
  for (let week = 0; week < weeks; week++) {
    for (let p = 0; p < presses; p++) totals.set(weekOf(week, pressOf(p)), { count: BigInt(p % 5 + 1), ms: BigInt(p % 5 + 1) * HOUR });
  }
  return totals;
}

/** A storage backend that counts what an apply actually reads and writes.
 *  The manifest a write produces is content-addressed, so re-announcing an
 *  untouched segment is a write of bytes already stored — counted here as the
 *  store sees it, which is the number that has to stay flat. Each object of a
 *  batch is counted as a write. */
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
      if (property === 'writeMany') {
        return async (repo: string, batch: readonly Uint8Array[]) => {
          const hashes = await target.writeMany(repo, batch);
          cost.writes += batch.length;
          for (const bytes of batch) cost.bytes += bytes.byteLength;
          return hashes;
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
      await encodeDatasetBlob(type, entries, (objects) => storage.objects.writeMany(repo, objects)));
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

    const next = seededStream(0x9e3779b9);

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
      await encodeDatasetBlob(type, entries, (objects) => storage.objects.writeMany(repo, objects)));

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

  const SourceKeyType = VariantType({ erp: StringType, own: StringType });
  const OrdersType = DictType(SourceKeyType, RowType);
  type SourceKey = ValueTypeOf<typeof SourceKeyType>;
  const ordersOrder = compareFor(SourceKeyType);
  /** A composite record of two sources: an entry of each. */
  const orders = (): SortedMap<SourceKey, Row> => new SortedMap<SourceKey, Row>(
    [[variant('erp', 'SO-1001'), row(1)], [variant('own', 'P-1'), row(2)]], ordersOrder);
  const OWN = { cases: new Set(['own']) };
  /** The refusal of an op on the ERP's entry: the key, its source, and the words. */
  const refused = (key: string) => (err: unknown) => err instanceof ExternalEntryError && err.source === 'erp' && err.printed === `.erp "${key}"`
    && ordersOrder(err.key as SourceKey, variant('erp', key)) === 0
    && err.message === `.erp "${key}" is an entry of source 'erp', which this write may not write`;

  describe('a write held to some cases of a composite record\'s key', () => {
    it('takes every op on a key of its cases, and writes what the door writes', async () => {
      const hash = await store(OrdersType, orders());
      const after = orders();
      after.delete(variant('own', 'P-1'));
      after.set(variant('own', 'P-2'), row(3));
      const written = await applyDelta(storage, repo, new Map([['primary', hash]]), await delta('primary', SourceKeyType, OrdersType, [
        [variant('own', 'P-1'), variant('delete', row(2))],
        [variant('own', 'P-2'), variant('insert', row(3))],
      ]), OWN);
      assert.equal(written.get('primary'), await store(OrdersType, after));
    });

    it('refuses an op on a key of any other case as it is taken, naming the key and its source, whatever the state holds', async () => {
      const hash = await store(OrdersType, orders());
      const apply = async (ops: Array<[unknown, unknown]>, options?: { cases: Set<string> }) =>
        applyDelta(storage, repo, new Map([['primary', hash]]), await delta('primary', SourceKeyType, OrdersType, ops), options);

      await assert.rejects(apply([[variant('erp', 'SO-1001'), variant('delete', row(1))]], OWN), refused('SO-1001'), 'an entry the state holds');
      await assert.rejects(apply([[variant('erp', 'SO-9'), variant('insert', row(9))]], OWN), refused('SO-9'), 'and one it does not');
      // The case is read before the state is: a delete that would not fit is refused for its case, not as a stale write
      await assert.rejects(apply([[variant('erp', 'SO-9'), variant('delete', row(9))]], OWN), refused('SO-9'));
      await assert.rejects(apply([[variant('erp', 'SO-9'), variant('insert', row(9))], [variant('own', 'P-2'), variant('insert', row(3))]], OWN),
        refused('SO-9'), 'with an op of its own cases beside it, the write is refused whole');

      // Held to no case — the source's own load, or a replay of commits each checked as it committed — the same delta applies
      const after = orders();
      after.set(variant('erp', 'SO-9'), row(9));
      assert.equal((await apply([[variant('erp', 'SO-9'), variant('insert', row(9))]])).get('primary'), await store(OrdersType, after));
    });

    it('R4 — refuses a stale write that names an entry of another case for the entry, not as a conflict: its ops are read before its conflict is answered', async () => {
      const EntryType = StructType({ ik: StringType, k: SourceKeyType });
      const primary = await store(OrdersType, orders());
      const index = await store(DictType(EntryType, NullType), new SortedMap<ValueTypeOf<typeof EntryType>, null>(
        [[{ ik: 'Plan 1', k: variant('erp', 'SO-1001') }, null], [{ ik: 'Plan 2', k: variant('own', 'P-1') }, null]], compareFor(EntryType)));
      const targets = new Map([['primary', primary], ['by_title', index]]);
      // What a write's program emits when the state moved under it: the conflict, which sorts first, and its ops all the same
      const stale = { target: DELTA_CONFLICT, key: 'update of .erp "SO-1001", whose row no longer matches the patch', op: null };
      const retitled = variant('update', variant('patch', { due: variant('unchanged', null), title: variant('replace', { before: 'Plan 0', after: 'RETITLED' }) }));
      const ofTheErp = { target: 'primary', key: variant('erp', 'SO-1001'), op: retitled };
      const ofItsOwn = { target: 'primary', key: variant('own', 'P-1'), op: retitled };
      const indexed = { target: 'by_title', key: { ik: 'Plan 1', k: variant('erp', 'SO-1001') }, op: variant('delete', null) };
      const conflict = (err: unknown) => err instanceof DeltaConflictError && err.message === stale.key;

      await assert.rejects(applyDeltaEntries(storage, repo, targets, [stale, ofTheErp], OWN), refused('SO-1001'));
      await assert.rejects(applyDeltaEntries(storage, repo, targets, [stale, indexed, ofTheErp, ofItsOwn], OWN), refused('SO-1001'),
        'past an index\'s arm, whose entries are held to no case');
      // A stale write of its own cases alone is the conflict it was, and so is any write held to no case
      await assert.rejects(applyDeltaEntries(storage, repo, targets, [stale, indexed, ofItsOwn], OWN), conflict);
      await assert.rejects(applyDeltaEntries(storage, repo, targets, [stale], OWN), conflict, 'one that names no key');
      await assert.rejects(applyDeltaEntries(storage, repo, targets, [stale, ofTheErp]), conflict);
    });

    it('holds the record\'s own collection alone: an index\'s entries follow its rows', async () => {
      const EntryType = StructType({ ik: StringType, k: SourceKeyType });
      const IndexType = DictType(EntryType, NullType);
      const primary = await store(OrdersType, orders());
      const index = await store(IndexType, new SortedMap<ValueTypeOf<typeof EntryType>, null>(
        [[{ ik: 'Plan 1', k: variant('erp', 'SO-1001') }, null], [{ ik: 'Plan 2', k: variant('own', 'P-1') }, null]], compareFor(EntryType)));
      const targets = new Map([['primary', primary], ['by_title', index]]);

      const written = await applyDeltaEntries(storage, repo, targets, [
        { target: 'by_title', key: { ik: 'Plan 2', k: variant('own', 'P-1') }, op: variant('delete', null) },
        { target: 'primary', key: variant('own', 'P-1'), op: variant('delete', row(2)) },
      ], OWN);
      assert.deepEqual([...written.keys()].sort(), ['by_title', 'primary'], 'the index\'s arm is applied, its struct keys unheld');
    });

    it('refuses a record whose key is no variant: a package that mixes two builds', async () => {
      const hash = await store(PlansType, plansOf(10));
      await assert.rejects(applyPlansHeld(hash), { message: 'a write held to the sources own names a key of \'primary\' that is no source\'s' });
    });

    /** A write of a record keyed by a String, held to a source as no export holds one. */
    async function applyPlansHeld(hash: string): Promise<Map<string, string>> {
      return applyDelta(storage, repo, new Map([['primary', hash]]),
        await delta('primary', StringType, PlansType, [[id(3), variant('delete', row(3))]]), OWN);
    }
  });

  describe("a summary index's arm (#1039)", () => {
    /** Add each change to a stored summary's totals, through a delta typed as a
     *  write's program types it, and answer with the summary's new manifest. */
    async function applySummary(hash: string, changes: Array<[SummaryEntry, Totals]>): Promise<string> {
      const targets: DeltaTarget[] = [{ name: 'by_week', keyType: SummaryEntryType, collectionType: SummaryType, summary: true }];
      const type = mutationDeltaType(targets);
      const entries = new SortedMap<unknown, unknown>(
        changes.map(([key, change]) => [variant('by_week', key), variant('by_week', variant('add', change))] as [unknown, unknown]),
        compareFor(toEastTypeValue((type as unknown as { key: EastType }).key)) as (a: unknown, b: unknown) => -1 | 0 | 1);
      const deltaHash = await storage.objects.write(repo,
        await encodeDatasetBlob(type, entries, (objects) => storage.objects.writeMany(repo, objects)));
      return (await applyDelta(storage, repo, new Map([['by_week', hash]]), deltaHash)).get('by_week')!;
    }

    it('adds each change to the total held: a key held gains, one new is inserted, one whose count reaches zero goes — as the door stores the sums', async () => {
      const before = totalsOf(60, 100);
      const hash = await store(SummaryType, before);
      const segments = await DatasetSegments.open(storage, repo, hash);
      assert.ok(segments.segmentCount > 2, `6,000 totals should span segments, not ${segments.segmentCount}`);

      const after = new SortedMap(before, entryOrder);
      const changes: Array<[SummaryEntry, Totals]> = [];
      const change = (key: SummaryEntry, count: bigint, ms: bigint) => {
        changes.push([key, { count, ms }]);
        const held = after.get(key) ?? { count: 0n, ms: 0n };
        if (held.count + count === 0n) after.delete(key);
        else after.set(key, { count: held.count + count, ms: held.ms + ms });
      };
      // A week's first press loses every row, the next gains one, and a press
      // between two the summary holds gets its first.
      for (let week = 0; week < 100; week += 7) {
        change(weekOf(week, pressOf(0)), -1n, -HOUR);
        change(weekOf(week, pressOf(1)), 1n, HOUR / 2n);
        change(weekOf(week, `${pressOf(1)}a`), 2n, 3n * HOUR);
      }
      // A week the summary has never held, after every other.
      change(weekOf(150, pressOf(7)), 1n, 0n);
      changes.sort(([a], [b]) => entryOrder(a, b));

      assert.equal(await applySummary(hash, changes), await store(SummaryType, after), 'the totals applied ARE the totals the door stores');
    });

    it('refuses a change that leaves a total no rebuild sums, naming the summary, the key and why', async () => {
      const hash = await store(SummaryType, totalsOf(60, 10));
      // The press P-1007 holds three rows covering three hours each week.
      const held = weekOf(5, pressOf(7));
      const refusal = (count: string, ms: string, why: string) => (err: unknown) => err instanceof SummaryIntegrityError && err.message ===
        `by_week: the total under (ik=(on=(), tile=5, key="P-1007"), k=null) would be ${count} rows covering ${ms} ms — ${why}: ` +
        'the summary disagrees with its record; rebuild it (e3 reindex)';
      await assert.rejects(applySummary(hash, [[held, { count: -4n, ms: -3n * HOUR }]]), refusal('-1', '0', 'fewer than no rows'));
      await assert.rejects(applySummary(hash, [[held, { count: -1n, ms: -4n * HOUR }]]), refusal('2', '-3600000', 'less than no time'));
      await assert.rejects(applySummary(hash, [[held, { count: -3n, ms: -2n * HOUR }]]), refusal('0', '3600000', 'time with no row'));
      // A total past the largest Integer agrees with its record, and a rebuild sums it too: the remedy is a finer tile.
      await assert.rejects(applySummary(hash, [[held, { count: (1n << 63n) - 1n, ms: 0n }]]), (err: unknown) => err instanceof SummaryIntegrityError
        && err.message === `by_week: the total under (ik=(on=(), tile=5, key="P-1007"), k=null) would be ${(1n << 63n) + 2n} rows covering 10800000 ms — `
          + 'past the largest Integer, which no total holds and a rebuild sums too: declare a finer tile, whose totals are smaller');
      await assert.rejects(applySummary(hash, [[weekOf(5, `${pressOf(7)}a`), { count: -1n, ms: 0n }]]),
        (err: unknown) => err instanceof SummaryIntegrityError && /under \(ik=\(on=\(\), tile=5, key="P-1007a"\), k=null\) would be -1 rows/.test(err.message),
        'taking from a key the summary does not hold');
    });

    it('refuses an arm that mixes another op among its adds: no program writes one', async () => {
      const hash = await store(SummaryType, totalsOf(4, 10));
      await assert.rejects(applyDeltaEntries(storage, repo, new Map([['by_week', hash]]), [
        { target: 'by_week', key: weekOf(5, pressOf(1)), op: variant('add', { count: 1n, ms: 0n }) },
        { target: 'by_week', key: weekOf(5, pressOf(2)), op: variant('delete', { count: 3n, ms: 3n * HOUR }) },
      ]), (err: unknown) => err instanceof SummaryIntegrityError
        && /^by_week: a summary's arm carries 'delete' under \(ik=\(on=\(\), tile=5, key="P-1002"\), k=null\), where every op adds to a total$/.test(err.message));
    });
  });

  describe('a delta applied elsewhere than where it is asked', () => {
    /** A delta of `count` retitles of a stored record's first rows, and the record they leave. */
    async function retitles(before: SortedMap<string, Row>, count: number): Promise<{ deltaHash: string; after: SortedMap<string, Row> }> {
      const after = new SortedMap(before, compareFor(StringType));
      const ops: Array<[unknown, unknown]> = [];
      for (let i = 0; i < count; i++) {
        after.set(id(i), { due: BigInt(i), title: `Retitled ${i}` });
        ops.push([id(i), variant('update', variant('patch', {
          due: variant('unchanged', null), title: variant('replace', { before: `Plan ${i}`, after: `Retitled ${i}` }),
        }))]);
      }
      return { deltaHash: await delta('primary', StringType, PlansType, ops), after };
    }

    it('ruling 56 — a delta of more ops than are applied in place goes where the runner applies deltas, and a smaller one, or one of a runner that names no place, is applied where it is asked', async () => {
      const before = plansOf(DELTA_OPS_APPLIED_IN_PLACE + 500);
      const hash = await store(PlansType, before);
      const targets = new Map([['primary', hash]]);
      const sent: string[] = [];
      const elsewhere: DeltaApply = (...asked) => {
        sent.push(asked[3]);
        return applyDeltaSummarized(...asked);
      };
      const small = await retitles(before, DELTA_OPS_APPLIED_IN_PLACE);
      const large = await retitles(before, DELTA_OPS_APPLIED_IN_PLACE + 1);

      assert.equal((await applyDeltaWhere(elsewhere, storage, repo, targets, small.deltaHash)).written.get('primary'), await store(PlansType, small.after));
      assert.deepEqual(sent, [], 'a delta of as many ops as are applied in place is applied where it is asked');
      const applied = await applyDeltaWhere(elsewhere, storage, repo, targets, large.deltaHash);
      assert.deepEqual(sent, [large.deltaHash], 'one op more, and it is sent where the runner applies deltas');
      assert.equal(applied.written.get('primary'), await store(PlansType, large.after));
      assert.deepEqual(applied.summary, [{ target: 'primary', insert: 0, update: DELTA_OPS_APPLIED_IN_PLACE + 1, delete: 0, add: 0 }]);
      assert.equal((await applyDeltaWhere(undefined, storage, repo, targets, large.deltaHash)).written.get('primary'), applied.written.get('primary'),
        'a runner that names no place has every delta applied where it is asked');
    });

    it('ruling 56 — on a thread of its own a delta applies as it does in place: the same manifests, which are the door\'s, and the same count of what it did', async () => {
      const before = plansOf(6_000);
      const hash = await store(PlansType, before);
      const { deltaHash, after } = await retitles(before, 5_000);
      const targets = new Map([['primary', hash]]);
      const inPlace = await applyDeltaSummarized(storage, repo, targets, deltaHash);
      const onThread = await applyDeltaOnThread(storage, repo, targets, deltaHash);
      assert.deepEqual([...onThread.written], [...inPlace.written]);
      assert.deepEqual(onThread.summary, inPlace.summary);
      assert.equal(onThread.written.get('primary'), await store(PlansType, after), 'the manifest the thread wrote IS the rebuilt manifest');
    });

    it('ruling 56 — a thread refuses as the apply refuses, by the same classes and in the same words: a stale write, an entry of another source, a delta the record holds no target of', async () => {
      const hash = await store(PlansType, plansOf(600));
      const targets = new Map([['primary', hash]]);
      await assert.rejects(
        applyDeltaOnThread(storage, repo, targets, await delta('primary', StringType, PlansType, [['p-999999', variant('delete', row(9))]])),
        (err: unknown) => err instanceof DeltaConflictError && /p-999999/.test(err.message));
      await assert.rejects(
        applyDeltaOnThread(storage, repo, targets, await delta('by_nothing', StringType, PlansType, [[id(0), variant('delete', row(0))]])),
        (err: unknown) => err instanceof Error && !(err instanceof DeltaConflictError)
          && err.message === "the mutation delta names target 'by_nothing', which this record does not hold — it has primary");

      const orders0 = await store(OrdersType, orders());
      await assert.rejects(
        applyDeltaOnThread(storage, repo, new Map([['primary', orders0]]),
          await delta('primary', SourceKeyType, OrdersType, [[variant('erp', 'SO-9'), variant('insert', row(9))]]), OWN),
        refused('SO-9'), 'the entry\'s key crosses with its source and its words');
    });

    it('ruling 56 — a signal that fires stops the apply on its thread: before the apply is asked, while it waits its turn among as many as the budget has cores, and while it runs', async () => {
      const before = plansOf(6_000);
      const hash = await store(PlansType, before);
      const { deltaHash } = await retitles(before, 5_000);
      const targets = new Map([['primary', hash]]);
      const stopped = (err: unknown) => err instanceof DeltaStoppedError;

      const asked = new AbortController();
      asked.abort();
      await assert.rejects(applyDeltaOnThread(storage, repo, targets, deltaHash, { signal: asked.signal }), stopped);

      // A budget of one core: one apply has its thread, and the next waits its turn, where a stop reaches it
      const budget = new Budget({ cores: 1, memory: 1024 ** 3 });
      const first = applyDeltaOnThread(storage, repo, targets, deltaHash, {}, budget);
      const waiting = new AbortController();
      const second = applyDeltaOnThread(storage, repo, targets, deltaHash, { signal: waiting.signal }, budget);
      const third = applyDeltaOnThread(storage, repo, targets, deltaHash, {}, budget);
      waiting.abort();
      await assert.rejects(second, stopped);
      // The turn it gave up goes to the one behind it, once the first has ended
      assert.deepEqual([...(await third).written], [...(await first).written]);

      // Stopped once its thread has been started, long before a thread has loaded and applied five thousand ops
      const running = new AbortController();
      const applying = applyDeltaOnThread(storage, repo, targets, deltaHash, { signal: running.signal }, budget);
      setImmediate(() => running.abort());
      await assert.rejects(applying, stopped);
      // Its turn is let go, and nothing it wrote is named: the record applies the delta afresh
      assert.ok((await applyDeltaOnThread(storage, repo, targets, deltaHash, {}, budget)).written.has('primary'));
    });

    it('ruling 56 — the local runner names a place for a large delta only when it is asked to apply them on threads: a server asks, and a command, which keeps no request waiting, does not', async () => {
      assert.equal(new LocalTaskRunner(repo).applyDelta, undefined);
      const runner = new LocalTaskRunner(repo, undefined, { deltaThreads: true });
      const before = plansOf(6_000);
      const hash = await store(PlansType, before);
      const { deltaHash, after } = await retitles(before, 5_000);
      const applied = await applyDeltaWhere(runner.applyDelta, storage, repo, new Map([['primary', hash]]), deltaHash);
      assert.equal(applied.written.get('primary'), await store(PlansType, after));
    });
  });
});
