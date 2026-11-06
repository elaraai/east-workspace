/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's entries index — `index.entries(field)` (#1521): the declaration,
 * the program built from it, and the lean rows kept beside it.
 *
 * An entries index files a row's Dict field entry by entry, each under its own
 * key and then the row's, carrying its own value, so a key's entries across
 * the record are one contiguous range. Its build is asserted by calling it,
 * and its maintenance by applying each write form's delta to what the build
 * gave before and holding the result, byte for byte, to what the build gives
 * after — the record's other indexes too, which carry the row with every field
 * an entries index files emptied, and the in-page maintenance a binding
 * previews a Save with. Every refusal is a definition-time error, in words.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DateTimeType, DictType, East, IntegerType, NullType, OptionType, PatchType, RecursiveType, SetType, SortedMap, SortedSet, StringType,
  StructType, compareFor, encodeBeast2For, equalFor, none, parseFor, printFor, printType, some, variant, type EastType, type ValueTypeOf,
} from '@elaraai/east';
import { DELTA_CONFLICT, editTypeOf, entriesRowsName, patchOpsType } from '@elaraai/e3-types';
import { record } from './record.js';
import type { IndexBuilder, IndexDraft } from './record-builders.js';
import { builtIndex, buildMutationProgram, indexBuildProgram, indexEntryKeyType, indexMaintenance } from './record-programs.js';
import { package_ } from './package.js';
import type { RecordDef, RecordIndexDef } from './types.js';

/** One service's parcels at a station: how many came through, and how many still wait. */
const ServiceType = StructType({ parcels: IntegerType, waiting: IntegerType });
/** A shift, by its day and its name: a Struct key. */
const ShiftType = StructType({ day: IntegerType, shift: StringType });
/** A station of a parcel depot: its site, its parcels, and each service's and each shift's own. */
const StationType = StructType({
  site: StringType,
  parcels: IntegerType,
  byService: DictType(StringType, ServiceType),
  byShift: DictType(ShiftType, IntegerType),
  flags: SetType(StringType),
});
const StationsType = DictType(StringType, StationType);
type Station = ValueTypeOf<typeof StationType>;
type Stations = ValueTypeOf<typeof StationsType>;

const byName = compareFor(StringType);
const byShiftKey = compareFor(ShiftType);
const stationEqual = equalFor(StationType);

/** A value written as East prints one, read by East's parser. */
function parsed<T extends EastType>(type: T, text: string): ValueTypeOf<T> {
  const read = parseFor(type)(text);
  if (!read.success) throw new Error(`not a ${printType(type)}: ${read.error}`);
  return read.value;
}

/** Asserts an East value equals the one expected, by its type, printing both as East does when it does not. */
function assertEast<T extends EastType>(type: T, actual: unknown, expected: ValueTypeOf<T>, what: string): void {
  if (equalFor(type)(actual as ValueTypeOf<T>, expected)) return;
  const print = printFor(type);
  assert.fail(`${what}:\n  got      ${print(actual as ValueTypeOf<T>)}\n  expected ${print(expected)}`);
}

/** A station's services: each name's parcels and waiting. */
function services(entries: readonly (readonly [string, bigint, bigint])[]): Station['byService'] {
  return new SortedMap(entries.map(([name, parcels, waiting]) => [name, { parcels, waiting }]), byName);
}

/** A station's shifts: each day and shift's parcels. */
function shifts(entries: readonly (readonly [bigint, string, bigint])[]): Station['byShift'] {
  return new SortedMap(entries.map(([day, shift, parcels]) => [{ day, shift }, parcels]), byShiftKey);
}

/** A station. */
function station(site: string, parcels: bigint, byService: Station['byService'], byShift: Station['byShift'], flags: readonly string[]): Station {
  return { site, parcels, byService, byShift, flags: new SortedSet(flags, byName) };
}

/** The stations every test starts from: two filing services and shifts, and one filing none. */
const stations: Stations = new SortedMap<string, Station>([
  ['DSP', station('South', 0n, services([]), shifts([]), [])],
  ['RCV', station('North', 12n, services([['Priority', 4n, 0n], ['Standard', 8n, 1n]]), shifts([[1n, 'early', 7n], [1n, 'late', 5n]]), ['late'])],
  ['SRT', station('North', 20n, services([['Economy', 5n, 2n], ['Priority', 6n, 1n], ['Standard', 9n, 3n]]), shifts([[1n, 'early', 20n]]), [])],
], byName);

/** A station's parcels: a projection of its own. */
const parcelsOf = East.function([StringType, StationType], IntegerType, ($, _k, v) => v.parcels);

/** The stations record declaring the indexes given, each built by `e3.record` under its key and typed as declared. */
const declared = <I extends Readonly<Record<string, IndexDraft>>>(indexes: (index: IndexBuilder<typeof StationsType>) => I) =>
  record('stations', StationsType, { initial: new Map(), indexes });

/** The record every maintenance test writes: both its Dict fields filed, and indexes carrying nothing, the row and their own. */
const written = record('stations', StationsType, {
  initial: new Map(),
  indexes: (index) => ({
    by_service: index.entries('byService'),
    by_shift: index.entries('byShift'),
    by_site: index.on(['site']),
    by_site_parcels: index.on(['site'], { value: parcelsOf }),
    by_flag: index.on(['flags']),
  }),
  mutations: (mutation) => ({
    patch: mutation.patch(),
    // A service's parcels set at a station, its waiting none: the service's entry made or changed.
    set_service: mutation.edit(East.function([StationsType, StringType, StringType, IntegerType, editTypeOf(StationsType)], NullType,
      ($, state, key, service, parcels, edit) => {
        const row = $.let(state.get(key));
        const byService = $.let(row.byService.copy());
        $(byService.insertOrUpdate(service, { parcels, waiting: 0n }));
        $(edit.set(key, { site: row.site, parcels: row.parcels, byService, byShift: row.byShift, flags: row.flags }));
      })),
    // A station's services cleared, and its shifts with them: its entries all gone, its other fields kept.
    clear: mutation.reduce(East.function([StationsType, StringType], StationsType, ($, state, key) => {
      const next = $.let(state.copy());
      const row = $.let(next.get(key));
      $(next.insertOrUpdate(key, { site: row.site, parcels: row.parcels, byService: new Map(), byShift: new Map(), flags: row.flags }));
      return next;
    })),
  }),
});

/** The `[entry, value]` pairs an index's build program emits for `rows`, as it emits them. */
function emitted(rec: RecordDef, index: RecordIndexDef, rows: Stations): [unknown, unknown][] {
  const out: [unknown, unknown][] = [];
  const build = indexBuildProgram(rec.type, index).compile([]) as (piece: unknown, emit: (entry: unknown, value: unknown) => null) => unknown;
  build(rows, (entry, value) => {
    out.push([entry, value]);
    return null;
  });
  return out;
}

/** An index as it is built beside the record's others, the key of its entries, and the collection it is held in. */
function builtWith(rec: RecordDef, index: RecordIndexDef) {
  const built = builtIndex(rec, index);
  const entryKey = indexEntryKeyType(StringType, built.keyType);
  return { index: built, entryKey, collection: DictType(entryKey, built.valueType) };
}

/** The collection an index's build gives for `rows`: its entries, sorted by `{ik, k}` as the index holds them. */
function collectionOf(rec: RecordDef, index: RecordIndexDef, rows: Stations) {
  const { index: built, entryKey } = builtWith(rec, index);
  return new SortedMap(emitted(rec, built, rows) as never, compareFor(entryKey));
}

/** The delta a write's program emits for `state` and its arguments, by target: each index's ops by entry. */
function deltaOf(rec: RecordDef, mutation: string, state: Stations, args: readonly unknown[]): Map<string, [unknown, unknown][]> {
  const write = buildMutationProgram(rec, rec.mutations[mutation]!).compile([]);
  const byTarget = new Map<string, [unknown, unknown][]>();
  write(state, ...args, (key: { type: string; value: unknown }, op: { type: string; value: unknown }) => {
    assert.notEqual(key.type, DELTA_CONFLICT, 'the write does not conflict');
    byTarget.set(key.type, [...(byTarget.get(key.type) ?? []), [key.value, op.value]]);
    return null;
  });
  return byTarget;
}

/** The state after a write, from its delta's own ops. */
function primaryAfter(state: Stations, delta: Map<string, [unknown, unknown][]>): Stations {
  const apply = East.compile(East.function([StationsType, PatchType(StationsType)], StationsType, (_$, value, patch) => East.applyPatch(value, patch)), []);
  return apply(state, variant('patch', new SortedMap((delta.get('primary') ?? []) as never, byName) as never));
}

/**
 * Holds a write to what a rebuild gives, every index of the record: its delta
 * applied to what each index's build gave before is, byte for byte, what its
 * build gives after — and the in-page maintenance gives, row by row, the ops
 * the delta carries.
 */
function assertMaintained(rec: RecordDef, mutation: string, before: Stations, args: readonly unknown[]): Stations {
  const delta = deltaOf(rec, mutation, before, args);
  const after = primaryAfter(before, delta);
  for (const declaredIndex of Object.values(rec.indexes)) {
    const { index, entryKey, collection } = builtWith(rec, declaredIndex);
    const ops = new SortedMap((delta.get(index.name) ?? []) as never, compareFor(entryKey));
    const apply = East.compile(East.function([collection, PatchType(collection)], collection, (_$, value, patch) => East.applyPatch(value, patch)), []);
    const maintained = apply(collectionOf(rec, index, before) as never, variant('patch', ops) as never);
    const encode = encodeBeast2For(collection);
    assert.deepEqual(encode(maintained), encode(collectionOf(rec, index, after) as never), `${index.name} after '${mutation}' is its rebuild, byte for byte`);
    // The in-page maintenance, a row at a time, gives the ops the write's delta carries.
    const opsType = DictType(entryKey, patchOpsType(collection));
    const maintain = East.compile(indexMaintenance(rec, index), []) as (key: string, held: unknown, next: unknown, patch: unknown) => SortedMap<unknown, unknown>;
    const previewed = new SortedMap(undefined, compareFor(entryKey));
    for (const key of new SortedSet([...before.keys(), ...after.keys()], byName)) {
      const held = before.get(key);
      const next = after.get(key);
      const same = held !== undefined && next !== undefined && stationEqual(held, next);
      if (same) continue;
      for (const [entry, op] of maintain(key, held === undefined ? none : some(held), next === undefined ? none : some(next), none)) previewed.set(entry as never, op);
    }
    assert.ok(equalFor(opsType)(previewed as never, ops as never), `${index.name}: the in-page maintenance gives the delta's ops`);
  }
  return after;
}

describe('index.entries — the declaration (#1521)', () => {
  // The typed bindings below are half of each test: they compile only when the
  // declaration carries the field's own key and value types, and its field as
  // written — which type a range read through it, and what a binding reads.

  it('files a Dict field, keyed by its key and carrying its value, a row filing many entries, led by no field', () => {
    const rec = declared((index) => ({ by_service: index.entries('byService'), by_shift: index.entries('byShift') }));
    const byService = rec.indexes.by_service;
    const keyType: typeof StringType = byService.keyType;
    const valueType: typeof ServiceType = byService.valueType;
    const field: 'byService' = byService.entries.field;
    assert.equal(byService.kind, 'recordIndex');
    assert.equal(byService.name, 'by_service');
    assert.equal(field, 'byService');
    assert.equal(byService.multi, true, 'a row files an entry for each key its field holds');
    assert.equal(byService.on, undefined, 'its key is the field\'s, not row fields\'');
    assert.equal(printType(keyType), printType(StringType));
    assert.equal(printType(valueType), printType(ServiceType));
    // A Struct key, as any type a Dict is keyed by.
    const shiftKey: typeof ShiftType = rec.indexes.by_shift.keyType;
    const shiftValue: typeof IntegerType = rec.indexes.by_shift.valueType;
    assert.equal(printType(shiftKey), printType(ShiftType));
    assert.equal(printType(shiftValue), printType(IntegerType));
  });

  it('keeps its lean rows beside it, under entriesRowsName: the record\'s rows by key, each with the field emptied', () => {
    const rec = declared((index) => ({ by_service: index.entries('byService') }));
    const indexes: Readonly<Record<string, RecordIndexDef>> = rec.indexes;
    const rows = indexes[entriesRowsName('by_service')];
    assert.ok(rows !== undefined, 'the record holds its lean rows under by_service_rows');
    assert.equal(rows, rec.indexes.by_service.entries.rows, 'the very index its definition names');
    assert.equal(printType(rows.keyType), printType(StringType), 'keyed by the row\'s own key');
    assert.equal(printType(rows.valueType), printType(StationType), 'carrying the row, its type the record\'s');
    assert.equal(rows.multi, false, 'a row under its one key');
    const out = emitted(rec, rows, stations);
    assert.deepEqual(out.map(([entry]) => entry), [{ ik: 'DSP', k: 'DSP' }, { ik: 'RCV', k: 'RCV' }, { ik: 'SRT', k: 'SRT' }]);
    for (const [entry, value] of out) {
      const key = (entry as { k: string }).k;
      assert.ok(stationEqual(value as Station, { ...stations.get(key)!, byService: services([]) }), `${key} is carried with its services emptied, the rest whole`);
    }
    assert.deepEqual(Object.keys(package_('depot', '1.0.0', rec).records.stations!.indexes).sort(), ['by_service', 'by_service_rows'],
      'a package carries the record with the entries index and its lean rows');
  });

  it('beside it, the record\'s indexes carrying nothing or the row carry the row with every field an entries index files emptied; those with a value keep theirs', () => {
    const lean = { ...stations.get('RCV')!, byService: services([]), byShift: shifts([]) };
    for (const name of ['by_site', 'by_flag']) {
      const index = builtIndex(written, written.indexes[name as keyof typeof written.indexes]);
      assert.equal(printType(index.valueType), printType(StationType), `${name} carries the row`);
      const rcv = emitted(written, index, stations).find(([entry]) => (entry as { k: string }).k === 'RCV');
      assert.ok(rcv !== undefined && stationEqual(rcv[1] as Station, lean), `${name} carries RCV with its services and its shifts emptied`);
    }
    const parcels = builtIndex(written, written.indexes.by_site_parcels);
    assert.equal(printType(parcels.valueType), printType(IntegerType), 'an index with a value of its own keeps it');
    // Each entries index's own lean rows empty its own field alone.
    const indexes: Readonly<Record<string, RecordIndexDef>> = written.indexes;
    for (const [name, kept] of [['by_service', 'byShift'], ['by_shift', 'byService']] as const) {
      const rows = builtIndex(written, indexes[entriesRowsName(name)]!);
      const rcv = emitted(written, rows, stations).find(([entry]) => (entry as { k: string }).k === 'RCV');
      const emptied = name === 'by_service' ? { byService: services([]) } : { byShift: shifts([]) };
      assert.ok(rcv !== undefined && stationEqual(rcv[1] as Station, { ...stations.get('RCV')!, ...emptied }), `${entriesRowsName(name)} keeps ${kept}`);
      assert.equal(builtIndex(written, indexes[name]!), indexes[name], `${name} is built as declared`);
    }
  });

  it('files a recursive row\'s own Dict field, its lean row keeping the rows beneath it whole', () => {
    const PartType = RecursiveType((self) => StructType({ name: StringType, counts: DictType(StringType, IntegerType), parts: DictType(StringType, self) }));
    const PartsType = DictType(StringType, PartType);
    const rec = record('parts', PartsType, { initial: new Map(), indexes: (index) => ({ by_count: index.entries('counts') }) });
    const parts = parsed(PartsType, '{"A":(name="A", counts={"x":1, "y":2}, parts={"A1":(name="A1", counts={"z":3}, parts={:})})}');
    const build = (index: RecordIndexDef) => {
      const out: [unknown, unknown][] = [];
      const program = indexBuildProgram(rec.type, index).compile([]) as (piece: unknown, emit: (entry: unknown, value: unknown) => null) => unknown;
      program(parts, (entry, value) => {
        out.push([entry, value]);
        return null;
      });
      return out;
    };
    assert.deepEqual(build(rec.indexes.by_count), [[{ ik: 'x', k: 'A' }, 1n], [{ ik: 'y', k: 'A' }, 2n]], 'the row\'s own counts, never a part\'s beneath it');
    const indexes: Readonly<Record<string, RecordIndexDef>> = rec.indexes;
    const leanRows = build(indexes[entriesRowsName('by_count')]!);
    assert.equal(leanRows.length, 1, 'one lean row, A\'s');
    assertEast(PartType, leanRows[0]![1], parsed(PartType, '(name="A", counts={:}, parts={"A1":(name="A1", counts={"z":3}, parts={:})})'),
      'A is carried with its own counts emptied, A1 beneath it whole');
  });
});

describe('index.entries — the build program', () => {
  it('emits each key the field holds under that key and the row\'s, carrying its value, and nothing for an empty field', () => {
    const rec = declared((index) => ({ by_service: index.entries('byService') }));
    assert.deepEqual(emitted(rec, rec.indexes.by_service, stations), [
      [{ ik: 'Priority', k: 'RCV' }, { parcels: 4n, waiting: 0n }],
      [{ ik: 'Standard', k: 'RCV' }, { parcels: 8n, waiting: 1n }],
      [{ ik: 'Economy', k: 'SRT' }, { parcels: 5n, waiting: 2n }],
      [{ ik: 'Priority', k: 'SRT' }, { parcels: 6n, waiting: 1n }],
      [{ ik: 'Standard', k: 'SRT' }, { parcels: 9n, waiting: 3n }],
    ], 'DSP\'s services are empty, and it files nothing');
  });

  it('holds a key\'s entries across the record as one contiguous range, in the rows\' key order', () => {
    const rec = declared((index) => ({ by_service: index.entries('byService') }));
    const held = [...collectionOf(rec, rec.indexes.by_service, stations).keys()] as { ik: string; k: string }[];
    assert.deepEqual(held.map(({ ik, k }) => `${ik} ${k}`), ['Economy SRT', 'Priority RCV', 'Priority SRT', 'Standard RCV', 'Standard SRT']);
  });

  it('emits nothing for an empty record', () => {
    const rec = declared((index) => ({ by_service: index.entries('byService') }));
    assert.deepEqual(emitted(rec, rec.indexes.by_service, new SortedMap(undefined, byName)), []);
  });
});

describe('index.entries — maintained through every write form as a rebuild gives it', () => {
  it('a patch: a row inserted and one deleted, entries changed, gone and come, and a row whose other fields alone changed', () => {
    const after = new SortedMap(stations, byName);
    after.delete('DSP');
    after.set('RCV', station('North', 11n, services([['Economy', 2n, 0n], ['Standard', 9n, 1n]]), shifts([[1n, 'early', 7n], [2n, 'early', 4n]]), ['late']));
    after.set('SRT', { ...stations.get('SRT')!, site: 'East' });
    after.set('HLD', station('South', 3n, services([['International', 3n, 3n]]), shifts([]), ['held']));
    const diff = East.compile(East.function([StationsType, StationsType], PatchType(StationsType), (_$, before, next) => East.diff(before, next)), []);
    const written_ = assertMaintained(written, 'patch', stations, [diff(stations, after)]);
    assert.ok(equalFor(StationsType)(written_, after), 'the record holds the rows patched');
  });

  it('an edit: a service\'s entry made at one station and changed at another', () => {
    const made = assertMaintained(written, 'set_service', stations, ['RCV', 'International', 2n]);
    assert.ok(equalFor(ServiceType)(made.get('RCV')!.byService.get('International')!, { parcels: 2n, waiting: 0n }), 'RCV holds International');
    const changed = assertMaintained(written, 'set_service', made, ['SRT', 'Priority', 1n]);
    assert.ok(equalFor(ServiceType)(changed.get('SRT')!.byService.get('Priority')!, { parcels: 1n, waiting: 0n }), 'SRT\'s Priority changed');
  });

  it('a reduce: a station\'s entries all gone, its other fields kept', () => {
    const cleared = assertMaintained(written, 'clear', stations, ['SRT']);
    assert.equal(cleared.get('SRT')!.byService.size, 0, 'SRT files no service');
    assert.equal(cleared.get('SRT')!.parcels, 20n, 'its parcels kept');
  });
});

describe('index.entries — refuses, at definition time, in words', () => {
  it('a field the rows lack, one that is not a Dict, and rows with no Dict field — naming the fields that fit', () => {
    assert.throws(() => declared((index) => ({
      // @ts-expect-error — entries names one of the rows' Dict fields
      by_nothing: index.entries('nothing'),
    })), /^Error: e3\.record 'stations': index\.entries 'by_nothing' files 'nothing', which is no field of the rows — it files a Dict field of the rows: 'byService', 'byShift'$/);
    assert.throws(() => declared((index) => ({
      // @ts-expect-error — 'site' is a String, not a Dict
      by_site: index.entries('site'),
    })), /^Error: e3\.record 'stations': index\.entries 'by_site' files 'site', of type \.String, which is not a Dict — it files a Dict field of the rows: 'byService', 'byShift'$/);
    assert.throws(() => record('sites', DictType(StringType, StructType({ site: StringType })), {
      // @ts-expect-error — the rows hold no Dict field
      indexes: (index) => ({ by_site: index.entries('site') }),
    }), /index\.entries 'by_site' files 'site', of type \.String, which is not a Dict — the rows have no Dict field to file$/);
    assert.throws(() => declared((index) => ({ by_number: index.entries(42 as never) })), /index\.entries 'by_number' takes the field it files by its name/);
  });

  it('rows that are not structs, and a record that is not a Dict', () => {
    assert.throws(() => record('counts', DictType(StringType, IntegerType), {
      indexes: (index) => ({ by_count: index.entries('count' as never) }),
    }), /index\.entries 'by_count' files a Dict field of the record's rows — 'counts' holds rows of \.Integer, which have no fields$/);
    assert.throws(() => record('flags', SetType(StringType), {
      initial: new Set<string>(),
      indexes: (index) => ({ by_flag: index.entries('flag' as never) }),
    }), /index\.entries 'by_flag' indexes a Dict record/);
  });

  it('a value: each entry carries its own', () => {
    assert.throws(() => declared((index) => ({
      // @ts-expect-error — an entries index takes no value
      by_service: index.entries('byService', { value: parcelsOf }),
    })), /^Error: e3\.record 'stations': index\.entries 'by_service' takes runner, not value — each entry carries its own value, the one its field holds under the entry's key$/);
  });

  it('a second entries index over one field', () => {
    assert.throws(() => declared((index) => ({ by_service: index.entries('byService'), services: index.entries('byService') })),
      /^Error: e3\.record 'stations': the entries indexes 'by_service' and 'services' both file 'byService' — one entries index files a field$/);
  });

  it('an entries index beside a nested series index, whichever is declared first', () => {
    const JobType = StructType({ start: DateTimeType, end: DateTimeType });
    const MachineType = StructType({ site: StringType, jobs: DictType(StringType, JobType), counts: DictType(StringType, IntegerType), at: OptionType(DateTimeType) });
    const MachinesType = DictType(StringType, MachineType);
    const words = /^Error: e3\.record 'machines': the entries index 'by_count' beside the nested series index 'in_time' — one kind of index files a record's nested fields: declare the one or the other$/;
    assert.throws(() => record('machines', MachinesType, {
      initial: new Map(),
      indexes: (index) => ({ by_count: index.entries('counts'), in_time: index.nested({ collections: { jobs: index.nested.items({ from: 'start', to: 'end' }) }, tile: 'week' }) }),
    }), words);
    assert.throws(() => record('machines', MachinesType, {
      initial: new Map(),
      indexes: (index) => ({ in_time: index.nested({ collections: { jobs: index.nested.items({ from: 'start', to: 'end' }) }, tile: 'week' }), by_count: index.entries('counts') }),
    }), words);
  });

  it('an index named as the lean rows an entries index keeps beside it', () => {
    assert.throws(() => declared((index) => ({ by_service: index.entries('byService'), by_service_rows: index.on(['site']) })),
      /^Error: e3\.record 'stations': an index named 'by_service_rows' — the name is the lean rows the entries index 'by_service' keeps beside it; name the index otherwise$/);
  });
});
