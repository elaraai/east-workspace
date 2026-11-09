/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The storage calls a record write makes (east-workspace#1573).
 *
 * A patch of ~1k entries to a Dict record of ~50k with an interval index runs
 * the program that maintains the index, and stores the new segments, the
 * manifests and the commit. Every call to the store is a round trip on a host
 * whose store is remote, so the write is held to a budget of calls, counted
 * through a backend that wraps the local one, and of rounds: the calls made
 * one after another, each waiting on the last, which the wrapper counts by
 * delaying every call. Before #1573 this write made 94 calls in 56 rounds.
 *
 * `E3_MEASURE=1` prints the calls the write made, by store and method, and by
 * round.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { dirname, join } from 'node:path';
import {
  DateTimeType, DictType, OptionType, PatchType, SortedMap, StringType, StructType, compareFor, diffFor, encodeBeast2For, some,
  type ValueTypeOf,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import { recordMutate } from './records.js';
import { packageImport } from './package-files.js';
import { workspaceCreate } from './workspaces.js';
import { workspaceDeploy } from './workspace-files.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import type { StorageBackend } from './index.js';

const Entry = StructType({ owner: StringType, code: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
const EntriesType = DictType(StringType, Entry);
type Entries = ValueTypeOf<typeof EntriesType>;
type EntryRow = ValueTypeOf<typeof Entry>;
const keyOrder = compareFor(StringType);

/** The rows a deploy writes: ~50k entries, each an hour after the last. */
const ROWS = 50_000;
/** The rows a write inserts: a group of ~1k, whose keys sort together. */
const PATCHED = 1_000;
const HOUR = 3_600_000;

/** How long the wrapper holds each call, in ms: a remote store's round trip,
 *  and long beside the work between two calls — milliseconds here, and tens
 *  of them on the slowest machine a test runs on — so that work never parts
 *  one round into two, and the rounds are the calls the write waits on one
 *  after another, whatever the machine. At 25 ms the same write's rounds
 *  varied with how fast the machine ran. */
const ROUND_TRIP_MS = 100;

/** The most calls the write may make: 94 before #1573, and 61 since. */
const CALL_BUDGET = 64;

/** The most rounds the write may take: 56 before #1573, and 23 since. */
const ROUND_BUDGET = 26;

/** An entry, its key's `i`th in its group: eight hours long, an hour after the one before. */
function entry(i: number, group: string): [string, EntryRow] {
  const start = Date.UTC(2026, 0, 1) + i * HOUR;
  return [`${group}/${String(i).padStart(6, '0')}`, {
    owner: `o-${i % 120}`, code: ['a', 'b', 'c'][i % 3]!,
    start: some(new Date(start)), end: some(new Date(start + 8 * HOUR)),
  }];
}

/** The record: its interval index, and its patch door, which runs the program
 *  that maintains the index. */
const entries = e3.record('entries', EntriesType, {
  initial: () => new Map(Array.from({ length: ROWS }, (_, i) => entry(i, `g-${String(Math.floor(i / 1_000)).padStart(2, '0')}`))),
  indexes: (index) => ({ entries_by_time: index.interval({ from: 'start', to: 'end' }) }),
  mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** One call to the store: which, when it started and when it settled, in ms. */
interface Call { readonly name: string; readonly at: number; settled: number }

/**
 * A backend that is `inner` as a remote store is: each call to its stores held
 * `delayMs` before it is made, as a round trip holds it, and kept in `calls`;
 * and its objects placed by a download, so a runner fetches the segments it
 * reads rather than having every segment linked in.
 */
function counted(inner: StorageBackend, calls: Call[], delayMs: number): StorageBackend {
  const wrap = <T extends object>(store: T, name: string): T => new Proxy(store, {
    get(target, property, receiver) {
      if (name === 'objects' && property === 'placement') return 'download';
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const call: Call = { name: `${name}.${String(property)}`, at: performance.now(), settled: 0 };
        calls.push(call);
        const made = new Promise((resolve) => setTimeout(resolve, delayMs)).then(() => (value as (...a: unknown[]) => unknown).apply(target, args));
        return made.finally(() => { call.settled = performance.now(); });
      };
    },
  });
  return {
    upgrades: inner.upgrades,
    objects: wrap(inner.objects, 'objects'),
    refs: wrap(inner.refs, 'refs'),
    locks: wrap(inner.locks, 'locks'),
    logs: wrap(inner.logs, 'logs'),
    repos: wrap(inner.repos, 'repos'),
    datasets: wrap(inner.datasets, 'datasets'),
    calls: wrap(inner.calls, 'calls'),
    runStates: (repo) => wrap(inner.runStates(repo), 'runStates'),
    validateRepository: (repo) => inner.validateRepository(repo),
  };
}

/** The calls by round: a call starts a round when it started after every
 *  call of the round before had settled. */
function byRound(calls: readonly Call[]): Call[][] {
  const grouped: Call[][] = [];
  let open = -Infinity;
  for (const call of [...calls].sort((a, b) => a.at - b.at)) {
    if (call.at >= open) grouped.push([]);
    grouped[grouped.length - 1]!.push(call);
    open = Math.max(open, call.settled);
  }
  return grouped;
}

/** How many rounds the calls took ({@link byRound}). */
function rounds(calls: readonly Call[]): number {
  return byRound(calls).length;
}

describe('the storage calls a record write makes', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let runner: LocalTaskRunner;

  before(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    runner = new LocalTaskRunner(repo);
    const zip = join(tempDir, 'entries.zip');
    await e3.export(e3.package('entries', '1.0.0', entries), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'main');
    await workspaceDeploy(storage, repo, 'main', 'entries', '1.0.0', { runner });
  });

  after(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** Inserts the entries of group `group` through the patch door, through `on`. */
  async function insertGroup(on: StorageBackend, group: string, from: number): Promise<void> {
    const before: Entries = new SortedMap(undefined, keyOrder);
    const after: Entries = new SortedMap(Array.from({ length: PATCHED }, (_, i) => entry(from + i, group)), keyOrder);
    const outcome = await recordMutate(on, runner, repo, 'main', 'entries', 'patch',
      [encodeBeast2For(PatchType(EntriesType))(diffFor(EntriesType)(before, after))], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed', JSON.stringify(outcome));
  }

  it('inserts ~1k entries into a record of ~50k with an interval index, in a budget of calls and rounds', async () => {
    // A first write, so what the store holds and the runner knows are a running deployment's
    await insertGroup(storage, 'x-00', ROWS);
    const calls: Call[] = [];
    const started = performance.now();
    await insertGroup(counted(storage, calls, ROUND_TRIP_MS), 'x-01', ROWS + PATCHED);
    const took = performance.now() - started;
    if (process.env.E3_MEASURE === '1') {
      const byName = new Map<string, number>();
      for (const call of calls) byName.set(call.name, (byName.get(call.name) ?? 0) + 1);
      console.log(`${calls.length} calls in ${rounds(calls)} rounds, ${Math.round(took)} ms at ${ROUND_TRIP_MS} ms a call`);
      for (const [name, count] of [...byName].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(4)} ${name}`);
      for (const [i, round] of byRound(calls).entries()) {
        const names = new Map<string, number>();
        for (const call of round) names.set(call.name, (names.get(call.name) ?? 0) + 1);
        console.log(`  round ${String(i + 1).padStart(3)}: ${[...names].map(([name, n]) => (n > 1 ? `${name}×${n}` : name)).join(', ')}`);
      }
    }
    assert.ok(calls.length <= CALL_BUDGET, `the write made ${calls.length} calls, over its budget of ${CALL_BUDGET}`);
    assert.ok(rounds(calls) <= ROUND_BUDGET, `the write took ${rounds(calls)} rounds, over its budget of ${ROUND_BUDGET}`);
  });
});
