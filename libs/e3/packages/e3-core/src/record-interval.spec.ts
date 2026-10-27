/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The interval index on the real runners (#1432).
 *
 * Its keys are East the SDK generates, `{ on: { …on }, node, at }`, so every
 * runtime must file every event under the same keys, byte for byte, and a
 * maintained index must be the one a reindex rebuilds. This deploys the same
 * record to a workspace per runtime — its patch door and its interval indexes
 * on that runtime — writes the same events through the door, then moves,
 * re-keys, retags, unschedules and deletes some, and compares the states hash
 * for hash: across the runtimes, and against a rebuild in each.
 *
 * The parity compares every runtime installed and skips with fewer than two,
 * as the area index's does; the rest runs on each runtime installed.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';
import { join, dirname } from 'node:path';
import {
  DateTimeType, DictType, OptionType, PatchType, SetType, SortedMap, SortedSet, StringType, StructType,
  compareFor, diffFor, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, type ValueTypeOf,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import { readDatasetWhole } from './dataset-open.js';
import { recordMutate, recordReindex, readRecordState } from './records.js';
import { packageImport } from './package-files.js';
import { workspaceCreate } from './workspaces.js';
import { workspaceDeploy } from './workspace-files.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import type { StorageBackend, TaskRunner } from './index.js';

/** Whether a runtime's CLI answers on PATH. */
function onPath(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore', shell: process.platform === 'win32' });
    return true;
  } catch {
    return false;
  }
}

/** An event: the resources it is on, its state, and its start and end — either of which may be missing. */
const EventRow = StructType({
  resources: SetType(StringType), state: StringType,
  start: OptionType(DateTimeType), end: OptionType(DateTimeType),
});
const EventsType = DictType(StringType, EventRow);
type Event = ValueTypeOf<typeof EventRow>;
type Events = ValueTypeOf<typeof EventsType>;
const keyOrder = compareFor(StringType);
const sameAt = equalFor(OptionType(DateTimeType));

/** A runner selection, as the SDK's constructors take one. */
type RunnerConfig = Parameters<typeof e3.mutation.reduce>[3];

/**
 * The record, its patch door and its interval indexes, on a runner: led by no
 * field, by its state, and by its resources, a Set fanning out.
 */
function declared(runner?: RunnerConfig) {
  const events = e3.record('events', EventsType, new Map());
  return {
    events,
    patch: e3.mutation.patch(events, 'patch', runner),
    indexes: [
      e3.recordIndex.interval('events_by_time', events, { from: 'start', to: 'end' }, runner),
      e3.recordIndex.interval('events_by_state_time', events, { on: ['state'], from: 'start', to: 'end' }, runner),
      e3.recordIndex.interval('events_by_resource_time', events, { on: ['resources'], from: 'start', to: 'end' }, runner),
    ] as const,
  };
}

/** The index names, in declaration order. */
const INDEXES = declared().indexes.map((index) => index.name);

/** A seeded stream of numbers in [0, 1) (mulberry32): the same rows on every run. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MINUTE = 60_000;
const DAY = 86_400_000;
/** The latest and earliest instants a DateTime holds. */
const LATEST = 8_640_000_000_000_000;

/**
 * The events the test writes first: of every length from an instant to years,
 * across the epoch and at the DateTime's extremes; some with no start (the
 * backlog), no end (an instant), or an end at or before their start.
 */
function seeded(): Events {
  const next = stream(1432);
  const rows = new SortedMap<string, Event>(undefined, keyOrder);
  const at = (ms: number) => some(new Date(ms));
  const put = (key: string, start: number | undefined, end: number | undefined, n: number) => {
    rows.set(key, {
      resources: new SortedSet(n % 7 === 0 ? [] : [`m${n % 3}`, `m${(n + 1) % 4}`], keyOrder),
      state: ['confirmed', 'proposed', 'actual'][n % 3]!,
      start: start === undefined ? none : at(start),
      end: end === undefined ? none : at(end),
    });
  };
  const lengths = [0, 1, MINUTE, 7 * DAY, 400 * DAY, 30 * 365 * DAY];
  for (let i = 0; i < 300; i++) {
    const start = Math.round((next() - 0.3) * 60 * 365 * DAY);
    const length = lengths[i % lengths.length]!;
    const end = i % 11 === 0 ? undefined : start + Math.round(next() * length);
    put(`e-${String(i).padStart(4, '0')}`, i % 17 === 0 ? undefined : start, end, i);
  }
  // At the DateTime's extremes, across the epoch, and ending before they start.
  put('x-earliest', -LATEST, -LATEST + DAY, 1);
  put('x-latest', LATEST - DAY, LATEST, 2);
  put('x-whole', -LATEST, LATEST, 4);
  put('x-epoch', -1, 1, 5);
  put('x-backwards', 10 * DAY, 2 * DAY, 8);
  return rows;
}

/**
 * The same events after another session's edits: some deleted, unscheduled,
 * moved a minute or years, stretched, re-stated or moved to other resources;
 * and some new ones, scheduled and not.
 */
function edited(rows: Events): Events {
  const next = new SortedMap<string, Event>([...rows], keyOrder);
  let n = 0;
  const shift = (value: Event['start'], by: number) => value.type === 'some' ? some(new Date(value.value.getTime() + by)) : some(new Date(by));
  for (const [key, row] of rows) {
    n++;
    switch (n % 9) {
      case 1: next.delete(key); break;
      case 2: next.set(key, { ...row, start: none }); break;
      case 3: next.set(key, { ...row, start: shift(row.start, MINUTE), end: shift(row.end, MINUTE) }); break;
      case 4: next.set(key, { ...row, start: shift(row.start, -5 * 365 * DAY), end: shift(row.end, -5 * 365 * DAY) }); break;
      case 5: next.set(key, { ...row, end: shift(row.end, 90 * DAY) }); break;
      case 6: next.set(key, { ...row, state: 'cancelled' }); break;
      case 7: next.set(key, { ...row, resources: new SortedSet([`m${n % 5}`], keyOrder) }); break;
      case 8: next.set(key, { ...row, end: none }); break;
      default: break;
    }
  }
  for (let i = 0; i < 20; i++) {
    next.set(`s-${i}`, {
      resources: new SortedSet(['m9'], keyOrder), state: 'proposed',
      start: i % 4 === 0 ? none : some(new Date(i * DAY)), end: i % 4 === 0 ? none : some(new Date(i * DAY + i * MINUTE)),
    });
  }
  return next;
}

describe('the interval index on the real runners', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let realRunner: TaskRunner;

  /** The runtimes to compare, minus any that is not installed. */
  const runtimes: Array<{ ws: string; runner: RunnerConfig }> = [
    { ws: 'node', runner: { runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] } } },
    ...(onPath('east-c', ['version']) ? [{ ws: 'c', runner: { runner: { runtime: 'east-c' as const, platforms: [] } } }] : []),
    ...(onPath('east-py', ['version']) ? [{ ws: 'py', runner: { runner: { runtime: 'east-py' as const, platforms: [] } } }] : []),
  ];
  const missing = runtimes.length < 2
    ? `needs east-c or east-py on PATH beside east-node; have ${runtimes.map((r) => r.ws).join(', ')}`
    : false;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    realRunner = new LocalTaskRunner(repo);
    for (const { ws, runner } of runtimes) {
      const { events, patch, indexes } = declared(runner);
      const pkg = e3.package(`interval-${ws}`, '1.0.0', events, patch, ...indexes);
      const zip = join(tempDir, `interval-${ws}.zip`);
      await e3.export(pkg, zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, ws);
      await workspaceDeploy(storage, repo, ws, `interval-${ws}`, '1.0.0', { runner: realRunner });
    }
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** The record's state in a workspace: its primary, and each index's manifest. */
  async function state(ws: string): Promise<{ primary: string; indexes: Record<string, string> }> {
    const ref = await storage.datasets.read(repo, ws, 'records/events');
    assert.ok(ref && ref.type === 'value');
    const held = await readRecordState(storage, repo, ref.value.hash);
    return { primary: held.primary, indexes: Object.fromEntries(INDEXES.map((name) => [name, held.indexes.get(name)!.manifest])) };
  }

  /** Writes `next` through a workspace's patch door, from `before`. */
  async function write(ws: string, before: Events, next: Events): Promise<void> {
    const patch = diffFor(EventsType)(before, next);
    const outcome = await recordMutate(storage, realRunner, repo, ws, 'events', 'patch',
      [encodeBeast2For(PatchType(EventsType))(patch)], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed', `${ws}: ${JSON.stringify(outcome)}`);
  }

  /** Every entry of each index in a workspace, decoded by its declared types. */
  async function entries(ws: string) {
    const held = await state(ws);
    return Promise.all(declared().indexes.map(async (index) => {
      const collection = DictType(StructType({ ik: index.keyType, k: StringType }), index.valueType);
      return { index, entries: decodeBeast2For(collection)(await readDatasetWhole(storage, repo, held.indexes[index.name]!)) };
    }));
  }

  it('files each event under its leading values, at most three entries each, its start the one at node 0 — the backlog\'s with no instant — on each runtime', async () => {
    const rows = seeded();
    for (const { ws } of runtimes) {
      await write(ws, new SortedMap<string, Event>(undefined, keyOrder), rows);
      for (const { index, entries: held } of await entries(ws)) {
        // Each event's entries, by its leading values as East prints them.
        const printOn = printFor(index.keyType.fields.on);
        const filed = new SortedMap<string, { starts: number; total: number }>(undefined, keyOrder);
        // An interval index carries no projection: an entry is its key, naming its event.
        for (const [entry] of held) {
          const written = rows.get(entry.k);
          assert.ok(written !== undefined, `${ws}/${index.name}: ${entry.k} is an event written`);
          const at = `${entry.k} under ${printOn(entry.ik.on)}`;
          const seen = filed.get(at) ?? { starts: 0, total: 0 };
          seen.total++;
          if (entry.ik.node === 0n) {
            seen.starts++;
            assert.ok(sameAt(entry.ik.at, written.start), `${ws}/${index.name}: ${at} is ordered at node 0 by its start`);
          }
          filed.set(at, seen);
        }
        for (const [at, seen] of filed) {
          assert.strictEqual(seen.starts, 1, `${ws}/${index.name}: ${at} is filed once by its start`);
          assert.ok(seen.total <= 3, `${ws}/${index.name}: ${at} is filed at most three times`);
        }
        const leading = index.name === 'events_by_resource_time'
          ? [...rows.values()].reduce((total, row) => total + row.resources.size, 0)
          : rows.size;
        assert.strictEqual(filed.size, leading, `${ws}/${index.name}: every event under each of its leading values`);
      }
    }
  });

  it('maintains each interval index as a reindex rebuilds it, hash for hash, on each runtime', async () => {
    const first = seeded();
    const second = edited(first);
    for (const { ws } of runtimes) {
      await write(ws, new SortedMap<string, Event>(undefined, keyOrder), first);
      await write(ws, first, second);
      const maintained = await state(ws);
      const rebuilt = await recordReindex(storage, realRunner, repo, ws, 'events', { actor: 'cli:test' });
      assert.strictEqual(rebuilt.kind, 'committed', `${ws}: ${JSON.stringify(rebuilt)}`);
      assert.deepStrictEqual(await state(ws), maintained, `${ws}: maintained ≡ rebuilt`);
    }
  });

  it('files every event under the same keys on every runtime, hash for hash', { skip: missing }, async () => {
    const first = seeded();
    const second = edited(first);
    const written: Array<{ ws: string; seeded: Awaited<ReturnType<typeof state>>; edited: Awaited<ReturnType<typeof state>> }> = [];
    for (const { ws } of runtimes) {
      await write(ws, new SortedMap<string, Event>(undefined, keyOrder), first);
      const afterSeed = await state(ws);
      await write(ws, first, second);
      written.push({ ws, seeded: afterSeed, edited: await state(ws) });
    }
    for (const seen of written.slice(1)) {
      assert.deepStrictEqual(seen.seeded, written[0]!.seeded, `${seen.ws} disagrees with ${written[0]!.ws} once the events are written`);
      assert.deepStrictEqual(seen.edited, written[0]!.edited, `${seen.ws} disagrees with ${written[0]!.ws} once they are edited`);
    }
  });
});
