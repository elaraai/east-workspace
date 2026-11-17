/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The reserved slots of a composite record's external sources: what each
 * deploy writes of them, what a compaction leaves, and the one read they rest
 * on — whether a state holds any entry of a source, found among the fences its
 * manifest holds.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DictType, IntegerType, SortedMap, StringType, StructType, VariantType, compareFor, encodeBeast2For, variant, type ValueTypeOf,
} from '@elaraai/east';
import { DatasetSegments } from './dataset-open.js';
import {
  EXTERNAL_SLOT, PENDING_SLOT, compactedSourceSlots, deploySourceSlots, genesisSourceSlots, pendingSources, slotNames, sourceHoldsEntries,
  sourceLoadSlots, sourcesSlot,
} from './record-slots.js';
import { storeDatasetBytes } from './store-collection.js';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import { encodeInSegmentsOf, storeSegmentsOf } from './test-helpers.js';

const REPO = 'r';

const Order = StructType({ customer: StringType, qty: IntegerType });
const OrderKey = VariantType({ erp: StringType, own: StringType, wms: StringType });
const Orders = DictType(OrderKey, Order);
type Key = ValueTypeOf<typeof OrderKey>;
type Row = ValueTypeOf<typeof Order>;

const row = (i: number): Row => ({ customer: `Customer ${i}`, qty: BigInt(i) });
/** `count` entries of a source, keyed `<source>-0` on. */
const entries = (source: Key['type'], count: number): Array<[Key, Row]> =>
  Array.from({ length: count }, (_, i): [Key, Row] => [variant(source, `${source}-${i}`), row(i)]);

describe('a composite record\'s source slots', () => {
  let storage: InMemoryStorage;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    await storage.repos.create(REPO);
  });

  /** A state holding `rows`, cut into segments of `size` entries: a geometry of the test's own. */
  const stateOf = (rows: Array<[Key, Row]>, size: number): Promise<string> =>
    storeSegmentsOf(storage, REPO, encodeInSegmentsOf(Orders, size)(new SortedMap<Key, Row>(rows, compareFor(OrderKey))));
  const holds = (state: string, source: string): Promise<boolean> => sourceHoldsEntries(storage, REPO, state, source);

  describe('whether a state holds an entry of a source', () => {
    it('says yes where a segment starts inside the source\'s run, reading no segment', async () => {
      // Segments of three: erp-0…2 | erp-3, erp-4, own-0 | own-1…3 | own-4
      const state = await stateOf([...entries('erp', 5), ...entries('own', 5)], 3);
      assert.equal((await DatasetSegments.open(storage, REPO, state)).segmentCount, 4);
      const objects = storage.objects;
      const read = objects.read.bind(objects);
      let segmentsRead = 0;
      const manifest = (await DatasetSegments.open(storage, REPO, state)).manifest;
      const segmentHashes = new Set(manifest.entries.map((entry) => entry.hash));
      objects.read = async (repo: string, hash: string) => {
        if (segmentHashes.has(hash)) segmentsRead++;
        return read(repo, hash);
      };
      assert.equal(await holds(state, 'erp'), true);
      assert.equal(await holds(state, 'own'), true);
      objects.read = read;
      assert.equal(segmentsRead, 0, 'the fences said so');
    });

    it('finds a run that lies inside one segment, and says no where that segment holds none', async () => {
      // Segments of four: erp-0, erp-1, own-0, wms-0 | wms-1, wms-2
      const within = await stateOf([...entries('erp', 2), ...entries('own', 1), ...entries('wms', 3)], 4);
      assert.equal(await holds(within, 'own'), true, 'between two fences of other sources');
      // erp-0, erp-1, wms-0, wms-1 | wms-2
      const without = await stateOf([...entries('erp', 2), ...entries('wms', 3)], 4);
      assert.equal(await holds(without, 'own'), false);
      assert.equal(await holds(without, 'erp'), true);
      assert.equal(await holds(without, 'wms'), true);
    });

    it('says no for a source that sorts before every entry, after every entry, and for a state of no entry', async () => {
      const state = await stateOf(entries('own', 5), 2);
      assert.equal(await holds(state, 'erp'), false, 'before the first fence');
      assert.equal(await holds(state, 'wms'), false, 'after the last entry');
      const empty = await storeDatasetBytes(storage, REPO, encodeBeast2For(Orders)(new SortedMap<Key, Row>([], compareFor(OrderKey))));
      for (const source of ['erp', 'own', 'wms']) assert.equal(await holds(empty, source), false, source);
    });

    it('refuses a state whose keys are not a variant\'s: the record has no sources', async () => {
      const Plain = DictType(StringType, Order);
      const state = await storeDatasetBytes(storage, REPO, encodeBeast2For(Plain)(new SortedMap([['a', row(1)]], compareFor(StringType))));
      await assert.rejects(holds(state, 'erp'), { message: 'a record with sources is keyed by a variant of them, and this state\'s keys are none' });
    });
  });

  describe('the slots\' text', () => {
    it('names each slot of a source\'s last delivery', () => {
      assert.deepEqual(sourceLoadSlots('erp'), {
        delivery: '$load.erp', load: '$load.erp.load', commit: '$load.erp.commit', execution: '$load.erp.execution', feed: '$load.erp.feed',
        asOf: '$load.erp.asOf',
      });
    });

    it('lists sources sorted and separated by commas, and reads them back; no source is no slot', () => {
      assert.equal(sourcesSlot(['wms', 'erp']), 'erp,wms');
      assert.equal(sourcesSlot([]), undefined);
      const versions = new Map([[PENDING_SLOT, 'erp,wms'], [EXTERNAL_SLOT, '']]);
      assert.deepEqual(pendingSources(versions), ['erp', 'wms']);
      assert.deepEqual(slotNames(versions, EXTERNAL_SLOT), [], 'a slot held empty names none');
      assert.deepEqual(pendingSources(new Map()), []);
    });
  });

  describe('what a deploy writes', () => {
    /** The slots a load's commit leaves for a source, as of `asOf`. */
    const delivered = (source: string, asOf: string): Array<[string, string]> => {
      const slots = sourceLoadSlots(source);
      return [[slots.delivery, 'd'.repeat(64)], [slots.load, 'l'.repeat(64)], [slots.commit, 'c'.repeat(64)], [slots.execution, 'i/e'], [slots.asOf, asOf]];
    };

    it('at a mint and a reset: every external source waits, and every delivery the ref remembered is dropped', () => {
      assert.deepEqual(genesisSourceSlots(undefined, ['erp', 'wms']), { [PENDING_SLOT]: 'erp,wms', [EXTERNAL_SLOT]: 'erp,wms' });
      assert.deepEqual(genesisSourceSlots(undefined, []), { [PENDING_SLOT]: undefined, [EXTERNAL_SLOT]: undefined }, 'a record with no external source');
      const prior = new Map([['.records.orders', 'h'.repeat(64)], ['$schema', 'a'], [EXTERNAL_SLOT, 'erp'], ...delivered('erp', '2026-11-02T03:00:00.000')]);
      const reset = genesisSourceSlots(prior, ['erp']);
      for (const slot of Object.values(sourceLoadSlots('erp'))) {
        if (prior.has(slot)) assert.ok(slot in reset && reset[slot] === undefined, `${slot} is named, to be dropped`);
      }
      assert.deepEqual([reset[PENDING_SLOT], reset[EXTERNAL_SLOT]], ['erp', 'erp']);
      assert.ok(!('$schema' in reset), 'it names no slot of another writer');
    });

    it('at a keep and a migrate: a source new to the external set waits unless the state holds its rows, and one that waited still waits', async () => {
      const state = await stateOf([...entries('erp', 2), ...entries('own', 1)], 2);
      // erp holds rows and is new to the set; wms holds none and is new too
      assert.deepEqual(await deploySourceSlots(storage, REPO, new Map(), ['erp', 'wms'], state, false), { [PENDING_SLOT]: 'wms', [EXTERNAL_SLOT]: 'erp,wms' });
      // A source that waited and is external still waits, whatever the state holds of it
      const waited = new Map([[PENDING_SLOT, 'erp'], [EXTERNAL_SLOT, 'erp']]);
      assert.deepEqual(await deploySourceSlots(storage, REPO, waited, ['erp'], state, false), { [PENDING_SLOT]: 'erp', [EXTERNAL_SLOT]: 'erp' });
      // One that had delivered, and holds no row now, does not wait again: its delivery was of no entry
      const emptied = await stateOf(entries('own', 1), 2);
      assert.deepEqual(await deploySourceSlots(storage, REPO, new Map([[EXTERNAL_SLOT, 'erp']]), ['erp'], emptied, false),
        { [PENDING_SLOT]: undefined, [EXTERNAL_SLOT]: 'erp' });
    });

    it('at a keep and a migrate: a source no longer external has its delivery forgotten, and waits for nothing', async () => {
      const state = await stateOf(entries('own', 1), 2);
      const prior = new Map([[PENDING_SLOT, 'wms'], [EXTERNAL_SLOT, 'erp,wms'], ...delivered('erp', '2026-11-02T03:00:00.000')]);
      const slots = await deploySourceSlots(storage, REPO, prior, [], state, false);
      assert.deepEqual([slots[PENDING_SLOT], slots[EXTERNAL_SLOT]], [undefined, undefined], 'a record left with no external source keeps neither slot');
      for (const source of ['erp', 'wms']) {
        for (const slot of Object.values(sourceLoadSlots(source))) assert.ok(slot in slots && slots[slot] === undefined, `${slot} is named, to be dropped`);
      }
    });

    it('at a migrate: each external source\'s delivery is forgotten but its as-of, which a keep leaves whole', async () => {
      const state = await stateOf(entries('erp', 2), 2);
      const prior = new Map([[EXTERNAL_SLOT, 'erp'], ...delivered('erp', '2026-11-02T03:00:00.000')]);
      const { delivery, load, commit, execution, feed, asOf } = sourceLoadSlots('erp');
      const migrated = await deploySourceSlots(storage, REPO, prior, ['erp'], state, true);
      for (const slot of [delivery, load, commit, execution, feed]) assert.ok(slot in migrated && migrated[slot] === undefined, `${slot} is named, to be dropped`);
      assert.ok(!(asOf in migrated), 'its as-of is carried: it still dates what the source sent');
      assert.deepEqual([migrated[PENDING_SLOT], migrated[EXTERNAL_SLOT]], [undefined, 'erp'], 'and it does not wait again');
      assert.deepEqual(await deploySourceSlots(storage, REPO, prior, ['erp'], state, false), { [PENDING_SLOT]: undefined, [EXTERNAL_SLOT]: 'erp' },
        'a keep names no delivery slot');
    });
  });

  describe('what a compaction leaves', () => {
    it('empties the commit of each source\'s last delivery, and nothing else', () => {
      const { commit } = sourceLoadSlots('erp');
      const versions = new Map([[EXTERNAL_SLOT, 'erp,wms'], [PENDING_SLOT, 'wms'], ['$load.erp', 'd'.repeat(64)], [commit, 'c'.repeat(64)]]);
      assert.deepEqual(compactedSourceSlots(versions), { [commit]: '' }, 'a source that holds no delivery has no commit to empty');
      assert.deepEqual(compactedSourceSlots(new Map()), {});
    });
  });
});
