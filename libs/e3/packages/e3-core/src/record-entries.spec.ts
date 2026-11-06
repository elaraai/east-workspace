/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The entries index (#1521) on the real runners.
 *
 * An entries index files a row's Dict field entry by entry, and keeps the rows
 * beside it with the field emptied; the record's other indexes carry the rows
 * the same way. All of it is East the SDK generates, and each of east-node,
 * east-c and east-py gives every row the same entries, byte for byte, its
 * maintained index the one a reindex rebuilds. This deploys the same two
 * records to a workspace for each of them — a parcel depot's stations, filing
 * their services (a String key), their shifts (a Struct key) and their
 * carriers (an Option key), beside an index of their sites; and parts nested
 * to any depth, filing each part's own counts — each with its patch door. It
 * writes the same rows through the doors, then patches that make, change and
 * take entries, move a station and change the parts beneath a part, an edit
 * and a reduce, and compares the states hash for hash after each: across the
 * three, and against a rebuild in each.
 *
 * The parity compares every one installed and is skipped with fewer than two;
 * the rest is checked on each one installed.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { accessSync, constants } from 'node:fs';
import assert from 'node:assert';
import { delimiter, join, dirname } from 'node:path';
import {
  DictType, East, IntegerType, NullType, OptionType, PatchType, RecursiveType, SetType, SortedMap, StringType, StructType,
  compareFor, diffFor, encodeBeast2For, equalFor, none, parseFor, printType, some, type EastType, type ValueTypeOf,
} from '@elaraai/east';
import e3, { type PartRunner } from '@elaraai/e3';
import { recordMutate, recordReindex, readRecordState } from './records.js';
import { packageImport } from './package-files.js';
import { workspaceCreate } from './workspaces.js';
import { workspaceDeploy } from './workspace-files.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import type { StorageBackend, TaskRunner } from './index.js';

/** Whether a command is on PATH: an executable of its name in one of PATH's directories. */
function onPath(command: string): boolean {
  const names = process.platform === 'win32' ? [`${command}.cmd`, `${command}.exe`] : [command];
  return (process.env.PATH ?? '').split(delimiter).filter((dir) => dir !== '').some((dir) => names.some((name) => {
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }));
}

// ── The records ──────────────────────────────────────────────────────────────

/** One service's parcels at a station: how many came through, how many still wait, and what they are flagged with. */
const Service = StructType({ parcels: IntegerType, waiting: IntegerType, flags: SetType(StringType) });
/** A shift, by its day and its name. */
const Shift = StructType({ day: IntegerType, shift: StringType });
/** A station: its site, its parcels, and each service's, each shift's and each carrier's own — none for parcels no carrier has taken. */
const Station = StructType({
  site: StringType, parcels: IntegerType,
  byService: DictType(StringType, Service), byShift: DictType(Shift, IntegerType), byCarrier: DictType(OptionType(StringType), IntegerType),
});
const Stations = DictType(StringType, Station);
/** A part: its own counts, and more parts beneath it, to any depth. */
const Part = RecursiveType((self) => StructType({ name: StringType, counts: DictType(StringType, IntegerType), parts: DictType(StringType, self) }));
const Parts = DictType(StringType, Part);

/** The two records, each with its patch door and its indexes, on a runner; the stations with an edit and a reduce. */
function declared(runner?: PartRunner) {
  const stations = e3.record('stations', Stations, {
    initial: new Map(),
    indexes: (index) => ({
      by_service: index.entries('byService', runner),
      by_shift: index.entries('byShift', runner),
      by_carrier: index.entries('byCarrier', runner),
      by_site: index.on(['site'], runner),
    }),
    mutations: (mutation) => ({
      patch: mutation.patch(runner),
      // A service's parcels set at a station, nothing waiting and no flag: the service's entry made or changed.
      set_service: mutation.edit(East.function([Stations, StringType, StringType, IntegerType, e3.mutation.editType(Stations)], NullType,
        ($, state, key, service, parcels, edit) => {
          const row = $.let(state.get(key));
          const held = $.let(row.byService.copy());
          $(held.insertOrUpdate(service, { parcels, waiting: 0n, flags: new Set() }));
          $(edit.set(key, { site: row.site, parcels: row.parcels, byService: held, byShift: row.byShift, byCarrier: row.byCarrier }));
        }), runner),
      // Every station's services and carriers cleared, its shifts kept: a write the program compares row by row.
      clear: mutation.reduce(East.function([Stations], Stations, (_$, state) => state.map(($, s) => {
        const services = $.let(new Map(), DictType(StringType, Service));
        const carriers = $.let(new Map(), DictType(OptionType(StringType), IntegerType));
        return { site: s.site, parcels: s.parcels, byService: services, byShift: s.byShift, byCarrier: carriers };
      })), runner),
    }),
  });
  const parts = e3.record('parts', Parts, {
    initial: new Map(),
    indexes: (index) => ({ by_count: index.entries('counts', runner) }),
    mutations: (mutation) => ({ patch: mutation.patch(runner) }),
  });
  return [stations, parts] as const;
}

/** Each record's name and state type. */
const RECORDS: ReadonlyArray<{ name: string; type: EastType }> = [{ name: 'stations', type: Stations }, { name: 'parts', type: Parts }];

/** Each index's record and name: those declared, and the lean rows kept beside each entries index. */
const INDEXES = declared().flatMap((rec) => Object.values(rec.indexes).map((index) => ({ record: rec.name, name: index.name })));

// ── The rows, written as East prints them ────────────────────────────────────

/** A value written as East prints one, read by East's parser. */
function parsed<T extends EastType>(type: T, text: string): ValueTypeOf<T> {
  const read = parseFor(type)(text);
  if (!read.success) throw new Error(`not a ${printType(type)}: ${read.error}`);
  return read.value;
}

/** A Dict as East prints one, from its entries. */
function dict(entries: readonly string[]): string {
  return entries.length === 0 ? '{:}' : `{${entries.join(', ')}}`;
}

const SERVICES = ['Economy', 'International', 'Priority', 'Standard'] as const;
/** The carriers a station's parcels go with: none for those no carrier has taken yet. */
const CARRIERS = [none, some('Fastway'), some('Northline')] as const;
const Carrier = OptionType(StringType);
const carrierOrder = compareFor(Carrier);
const carrierEqual = equalFor(Carrier);
type StationRow = ValueTypeOf<typeof Station>;
/** A station's carrier, and the parcels gone with it. */
type CarrierParcels = [ValueTypeOf<typeof Carrier>, bigint];

/**
 * A station, its services and shifts written as East prints them, and its
 * carriers built as East values: East's text reader takes no Option key.
 */
function stationOf(text: string, carriers: CarrierParcels[]): StationRow {
  return { ...parsed(Station, text), byCarrier: new SortedMap(carriers, carrierOrder) };
}

/** Station `s`: each service but one in five, a shift or three, and its carriers — none at all every seventh station. */
function station(s: number, site = s % 2 === 0 ? 'North' : 'South'): StationRow {
  const empty = s % 7 === 6;
  const services = empty ? [] : SERVICES.flatMap((service, place) => ((s + place) % 5 === 0 ? [] : [
    `"${service}":(parcels=${s + place}, waiting=${s % 3}, flags=${(s + place) % 4 === 0 ? '{"late"}' : '{}'})`,
  ]));
  const shifts = empty ? [] : Array.from({ length: 1 + (s % 3) }, (_, d) => `(day=${d + 1}, shift="${(s + d) % 2 === 0 ? 'early' : 'late'}"):${s + d}`);
  const carriers = empty ? [] : CARRIERS.flatMap((carrier, place): CarrierParcels[] => ((s + place) % 3 === 0 ? [] : [[carrier, BigInt(s * 2 + place)]]));
  return stationOf(`(site="${site}", parcels=${s}, byService=${dict(services)}, byShift=${dict(shifts)}, byCarrier={:})`, carriers);
}

/** A part as East prints one. */
function part(name: string, counts: readonly string[], parts: readonly string[] = []): string {
  return `(name="${name}", counts=${dict(counts)}, parts=${dict(parts)})`;
}

/** Assembly `a`'s parts three deep, each part counting its own. */
function assembly(a: number, extra = 0): string {
  const leaf = part(`leaf ${a}`, [`"bolts":${a + extra}`, `"nuts":${a * 2}`]);
  const middle = part(`middle ${a}`, a % 2 === 0 ? [] : [`"bolts":${a}`], [`"l${a}":${leaf}`]);
  return part(`assembly ${a}`, [`"bolts":${a + 10}`, `"washers":${a}`], [`"m${a}":${middle}`]);
}

/** The rows the doors first write. */
function seeded() {
  return {
    stations: new SortedMap<string, StationRow>(Array.from({ length: 24 }, (_, s): [string, StationRow] => [`S-${String(s).padStart(2, '0')}`, station(s)]),
      compareFor(StringType)),
    parts: parsed(Parts, dict(Array.from({ length: 6 }, (_, a) => `"A-${a}":${assembly(a)}`))),
  };
}

type Rows = ReturnType<typeof seeded>;

/** A record's rows, copied to change. */
function copied<V>(rows: ReadonlyMap<string, V>): SortedMap<string, V> {
  return new SortedMap<string, V>([...rows], compareFor(StringType));
}

/** The patches, one after another, each from the rows the last left. */
function writes(): Array<{ what: string; record: keyof Rows; next: (rows: Rows) => Rows[keyof Rows] }> {
  return [
    {
      what: 'services made, recounted and taken; a shift moved; the unassigned carrier gone; a station moved; one deleted and one inserted',
      record: 'stations',
      next: (rows) => {
        const next = copied(rows.stations);
        next.set('S-00', stationOf(`(site="North", parcels=40, byService=${dict([
          '"Economy":(parcels=9, waiting=0, flags={})', '"International":(parcels=4, waiting=4, flags={"held","late"})',
        ])}, byShift=${dict(['(day=1, shift="early"):40'])}, byCarrier={:})`, [[some('Fastway'), 40n]]));
        next.set('S-01', stationOf(`(site="South", parcels=1, byService=${dict(['"Standard":(parcels=1, waiting=1, flags={})'])}, ` +
          `byShift=${dict(['(day=2, shift="late"):1', '(day=3, shift="early"):0'])}, byCarrier={:})`, [[none, 1n]]));
        const second = station(2);
        assert.ok([...second.byCarrier.keys()].some((carrier) => carrierEqual(carrier, none)), 'S-02 has parcels no carrier has taken');
        next.set('S-02', { ...second, byCarrier: new SortedMap([...second.byCarrier].flatMap(([carrier, parcels]): CarrierParcels[] =>
          (carrierEqual(carrier, none) ? [] : [[carrier, parcels]])), carrierOrder) });
        next.set('S-03', station(3, 'East'));
        next.delete('S-04');
        next.set('S-99', station(99));
        return next;
      },
    },
    {
      what: 'a part\'s own counts changed, and a part\'s beneath it', record: 'parts',
      next: (rows) => {
        const next = copied(rows.parts);
        next.set('A-0', parsed(Part, part('assembly 0', ['"bolts":11', '"rivets":3'], [`"m0":${part('middle 0', [], [`"l0":${part('leaf 0', ['"bolts":0'])}`])}`])));
        next.set('A-1', parsed(Part, assembly(1, 5)));
        return next;
      },
    },
  ];
}

describe('the entries index on the real runners', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let realRunner: TaskRunner;

  /** The East implementations to compare: east-node, and east-c and east-py where installed. */
  const implementations: Array<{ ws: string; runner: PartRunner }> = [
    { ws: 'node', runner: { runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] } } },
    ...(onPath('east-c') ? [{ ws: 'c', runner: { runner: { runtime: 'east-c' as const, platforms: [] } } }] : []),
    ...(onPath('east-py') ? [{ ws: 'py', runner: { runner: { runtime: 'east-py' as const, platforms: [] } } }] : []),
  ];
  const missing = implementations.length < 2
    ? `needs east-c or east-py on PATH beside east-node; have ${implementations.map((r) => r.ws).join(', ')}`
    : false;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    realRunner = new LocalTaskRunner(repo);
    for (const { ws, runner } of implementations) {
      const pkg = e3.package(`entries-${ws}`, '1.0.0', ...declared(runner));
      const zip = join(tempDir, `entries-${ws}.zip`);
      await e3.export(pkg, zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, ws);
      await workspaceDeploy(storage, repo, ws, `entries-${ws}`, '1.0.0', { runner: realRunner });
    }
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** Every record's state in a workspace: its primary, and each index's manifest. */
  async function state(ws: string): Promise<Record<string, string>> {
    const held: Record<string, string> = {};
    for (const { name } of RECORDS) {
      const ref = await storage.datasets.read(repo, ws, `records/${name}`);
      assert.ok(ref && ref.type === 'value', `${ws}: records/${name} holds a value`);
      const record = await readRecordState(storage, repo, ref.value.hash);
      held[`${name} primary`] = record.primary;
      for (const index of INDEXES.filter((i) => i.record === name)) {
        const built = record.indexes.get(index.name);
        assert.ok(built !== undefined, `${ws}: ${name} holds ${index.name}`);
        held[index.name] = built.manifest;
      }
    }
    return held;
  }

  /** Writes a record through a workspace's door, by name, with the arguments given. */
  async function mutate(ws: string, record: string, mutation: string, args: Uint8Array[]): Promise<void> {
    const outcome = await recordMutate(storage, realRunner, repo, ws, record, mutation, args, { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed', `${ws}: ${record}.${mutation}: ${outcome.kind === 'failed' ? outcome.stderr : outcome.kind}`);
  }

  /** Writes a record's rows through a workspace's patch door, from `before` to `next`. */
  async function write(ws: string, record: keyof Rows, before: unknown, next: unknown): Promise<void> {
    const type = RECORDS.find((r) => r.name === record)!.type;
    await mutate(ws, record, 'patch', [encodeBeast2For(PatchType(type))(diffFor(type)(before as never, next as never) as never)]);
  }

  /**
   * Writes the seeded rows, then each patch, the edit and the reduce, into
   * each workspace in turn, calling `after` with the states after each.
   */
  async function writeAll(after: (what: string, ws: string, held: Record<string, string>) => Promise<void>): Promise<void> {
    for (const { ws } of implementations) {
      let rows = seeded();
      for (const { name } of RECORDS) await write(ws, name as keyof Rows, new SortedMap([], compareFor(StringType)), rows[name as keyof Rows]);
      await after('the seeded rows', ws, await state(ws));
      for (const step of writes()) {
        const next = step.next(rows);
        await write(ws, step.record, rows[step.record], next);
        rows = { ...rows, [step.record]: next };
        await after(step.what, ws, await state(ws));
      }
      // S-06 holds no service: the edit gives it one.
      await mutate(ws, 'stations', 'set_service',
        [encodeBeast2For(StringType)('S-06'), encodeBeast2For(StringType)('International'), encodeBeast2For(IntegerType)(9n)]);
      await after('an edit giving a station its first service', ws, await state(ws));
      await mutate(ws, 'stations', 'clear', []);
      await after('a reduce clearing every station\'s services and carriers', ws, await state(ws));
    }
  }

  it('maintains each entries index, its lean rows and the index beside them as a reindex rebuilds them, after each write, hash for hash, on each implementation', async () => {
    await writeAll(async (what, ws, maintained) => {
      for (const { name } of RECORDS) {
        const rebuilt = await recordReindex(storage, realRunner, repo, ws, name, { actor: 'cli:test' });
        assert.strictEqual(rebuilt.kind, 'committed', `${ws}: ${name}: ${rebuilt.kind === 'failed' ? rebuilt.stderr : rebuilt.kind}`);
      }
      assert.deepStrictEqual(await state(ws), maintained, `${ws}, after ${what}: maintained ≡ rebuilt`);
    });
  });

  it('gives every row the same entries on every implementation installed, after each write, hash for hash', { skip: missing }, async () => {
    const seen = new Map<string, Map<string, Record<string, string>>>();
    await writeAll(async (what, ws, held) => {
      const each = seen.get(what) ?? new Map<string, Record<string, string>>();
      each.set(ws, held);
      seen.set(what, each);
    });
    for (const [what, each] of seen) {
      const [first, ...rest] = [...each];
      assert.ok(rest.length > 0, `${what}: more than one implementation wrote it`);
      for (const [ws, held] of rest) assert.deepStrictEqual(held, first![1], `${ws} disagrees with ${first![0]} after ${what}`);
    }
  });
});
