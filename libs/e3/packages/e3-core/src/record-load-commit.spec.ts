/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A load's commit (§7.6, §4.11): the delta a load's pieces computed from its
 * source's run, applied once onto whatever head the record has moved to while
 * they ran. Saves and other sources' loads that land meanwhile are folded in
 * from their own deltas; a system commit, a load of the same source or a
 * chain it cannot walk makes the commit read the run again, and commit or
 * send the load back to its pieces.
 *
 * Each delta here is a real load's, its program run on the local runner over
 * a delivery and the source's run. Each case is titled by the requirement of
 * the design it checks.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, some, type ValueTypeOf } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { RecordLoadArgsType, decodeRecordCommit, decodeRecordLoadObject, type RecordLoadArgs } from '@elaraai/e3-types';
import { DatasetSegments } from './dataset-open.js';
import { inputsHash } from './executions.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import { packageImport } from './package-files.js';
import { recordLoadCommit, recordSourceRun, type RecordLoadCommitOptions, type RecordLoadCommitOutcome } from './record-load.js';
import { PENDING_SLOT, sourceLoadSlots } from './record-slots.js';
import { applyDelta } from './record-apply.js';
import {
  decodeMutationArgs, readRecordState, recordHistory, recordMutate, recordReindex, recordSystemCommit, resolveRecord, stateTargets, stateWritten,
  withSharedWorkspaceLock, type RecordStateRefs, type ResolvedRecord,
} from './records.js';
import { storeCollection } from './store-collection.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import {
  ErpDeliveryType, LEDGER_DEPLOYED, LEDGER_ORDERS, SourcedOrderType, createTempDir, createTestRepo, ledgerOrders, ledgerWorkspaces, overriding,
  removeTempDir, removeTestRepo, seededStream, withStores, type LedgerErpLoad, type LedgerWorkspaces,
} from './test-helpers.js';

type OrderRow = ValueTypeOf<typeof SourcedOrderType>;

const decodeLoadArgs = decodeBeast2For(RecordLoadArgsType);
const encodeString = encodeBeast2For(StringType);
const encodeOrder = encodeBeast2For(SourcedOrderType);
const byId = compareFor(StringType);
const sameArgs = equalFor(RecordLoadArgsType);

const { acme, birch, cedar } = LEDGER_ORDERS;
const DEPLOYED = LEDGER_DEPLOYED;

/**
 * A version of the package the cases deploy: the ledger's `orders`
 * ({@link ledgerOrders}), its `erp` loaded as `erp` says, and holding `own`
 * from the deploy.
 */
function ledgerPackage(version: string, erp: LedgerErpLoad, own: ReadonlyMap<string, OrderRow>): ReturnType<typeof e3.package> {
  return e3.package('ledger', version, ledgerOrders({ erp, own }));
}

/** A load commit's outcome, in words. */
function said(outcome: RecordLoadCommitOutcome | { kind: string }): string {
  return 'reason' in outcome ? `${outcome.kind}: ${outcome.reason}` : outcome.kind;
}

/** What a load's pieces computed, ready to commit. */
type Prepared = Omit<RecordLoadCommitOptions, 'actor' | 'signal' | 'asOf'>;

describe('a load\'s commit', () => {
  let repoDir: string;
  let dir: string;
  let storage: StorageBackend;
  let runner: LocalTaskRunner;
  let record: ResolvedRecord;
  let ledger: LedgerWorkspaces;

  before(async () => {
    repoDir = createTestRepo();
    dir = createTempDir();
    storage = new LocalStorage(dirname(repoDir));
    runner = new LocalTaskRunner(repoDir);
    ledger = ledgerWorkspaces(storage, repoDir, runner);
    const zips: Array<[string, ReturnType<typeof e3.package>]> = [
      ['ledger.zip', ledgerPackage('1.0.0', 'book', new Map([['P-1', birch]]))],
      // A load whose patch strays outside its delivery and its entries
      ['stray.zip', ledgerPackage('1.1.0', 'stray', new Map([['P-1', birch]]))],
      // The solution's own orders, many, so the record is cut into many segments
      ['bulk.zip', ledgerPackage('1.2.0', 'book', new Map(Array.from({ length: 6000 }, (_, i): [string, OrderRow] =>
        [`P-${String(i).padStart(5, '0')}`, { customer: `C-${i % 97}`, qty: BigInt(i) }])))],
    ];
    for (const [name, pkg] of zips) {
      await e3.export(pkg, join(dir, name));
      await packageImport(storage, repoDir, join(dir, name));
    }
  });

  after(() => {
    removeTestRepo(repoDir);
    removeTempDir(dir);
  });

  /** A workspace of its own for a case, a version of the ledger deployed to it, and the record as it resolves there. */
  const fresh = async (version = '1.0.0'): Promise<string> => {
    const ws = await ledger.fresh(version);
    record = (await resolveRecord(storage, repoDir, ws, 'orders'))!;
    return ws;
  };
  const ref = (ws: string) => ledger.ref(ws);
  const chain = (ws: string) => ledger.chain(ws);
  const holds = (ws: string, rows: Parameters<LedgerWorkspaces['holds']>[1]) => ledger.holds(ws, rows);
  /** The record's head commit. */
  const head = async (ws: string): Promise<string> => (await ref(ws)).versions.get('.records.orders')!;
  /** A delivery of some orders, stored as a collection. */
  const delivery = (rows: Array<[string, OrderRow]>): Promise<string> =>
    storeCollection(storage, repoDir, ErpDeliveryType, [{ elements: [...rows].sort(([a], [b]) => byId(a, b)) }]);
  /** What a load of a delivery into a source computes, over the record as it stands. */
  const prepared = async (ws: string, source: string, delivered: string): Promise<Prepared> => {
    const resolved = (await resolveRecord(storage, repoDir, ws, 'orders'))!;
    const declared = resolved.sources.get(source);
    if (declared?.type !== 'load') assert.fail(`source ${source} has no load`);
    const task = decodeRecordLoadObject(await storage.objects.read(repoDir, declared.value)).task;
    const now = await ref(ws);
    const run = await recordSourceRun(storage, repoDir, now.hash, source);
    const ran = await runner.execute(storage, task, [delivered, run], { anyRuntime: true });
    if (ran.state !== 'success' || ran.outputHash === undefined) assert.fail(`the load's pieces failed: ${ran.error}`);
    return {
      delta: ran.outputHash, run, base: now.versions.get('.records.orders')!, delivery: delivered, load: declared.value,
      execution: { inputsHash: inputsHash([delivered, run]), executionId: ran.executionId },
    };
  };
  /** A load's commit, over the workspace held shared as a load holds it. */
  const commit = (ws: string, source: string, ready: Prepared, extra: Partial<RecordLoadCommitOptions> = {}, over: StorageBackend = storage) =>
    withSharedWorkspaceLock(over, repoDir, ws, undefined, () =>
      recordLoadCommit(over, repoDir, ws, record, source, { ...ready, actor: 'system:load', ...extra }));
  /** A delivery loaded into a source, committed at once. */
  const loaded = async (ws: string, source: string, rows: Array<[string, OrderRow]>, extra: Partial<RecordLoadCommitOptions> = {}) => {
    const outcome = await commit(ws, source, await prepared(ws, source, await delivery(rows)), extra);
    if (outcome.kind !== 'committed') assert.fail(`the load did not commit: ${said(outcome)}`);
    return outcome;
  };
  /** A save of one of the solution's own orders. */
  const save = async (ws: string, id: string, order: OrderRow, over: StorageBackend = storage): Promise<string> => {
    const outcome = await recordMutate(over, runner, repoDir, ws, 'orders', 'plan', [encodeString(id), encodeOrder(order)], { actor: 'ada@example.com' });
    if (outcome.kind !== 'committed') assert.fail(`the save did not commit: ${said(outcome)}`);
    return outcome.commitHash;
  };
  /** The arguments a load's commit recorded. */
  const argsOf = async (commitHash: string): Promise<RecordLoadArgs> => {
    const stored = decodeRecordCommit(await storage.objects.read(repoDir, commitHash));
    if (stored.args.type !== 'some') assert.fail('the commit recorded no arguments');
    const [only, ...rest] = decodeMutationArgs(await storage.objects.read(repoDir, stored.args.value));
    assert.equal(rest.length, 0, 'a load\'s arguments are a tuple of one value');
    return decodeLoadArgs(only!);
  };
  /**
   * The datasets a commit writes through, their first write of a ref
   * preceded by `first`: a write that lands while the commit brings its
   * result to the head, so its write is refused and it tries again.
   */
  const racing = (first: () => Promise<unknown>): StorageBackend['datasets'] => {
    let pending = true;
    return overriding(storage.datasets, {
      writeIf: async (...args: Parameters<StorageBackend['datasets']['writeIf']>) => {
        if (pending) {
          pending = false;
          await first();
        }
        return storage.datasets.writeIf(...args);
      },
    });
  };
  /** The storage a commit runs over, its first write of the record's ref preceded by `first`. */
  const raced = (first: () => Promise<unknown>): StorageBackend => withStores(storage, { datasets: racing(first) });

  /** The objects a commit reads, counting its reads of the objects named. */
  const counting = (named: ReadonlySet<string>): { objects: StorageBackend['objects']; reads: () => number } => {
    let reads = 0;
    const objects = overriding(storage.objects, {
      read: (repo: string, hash: string) => {
        if (named.has(hash)) reads++;
        return storage.objects.read(repo, hash);
      },
    });
    return { objects, reads: () => reads };
  };

  /** The segment objects a collection is stored as. */
  const segmentsOf = async (hash: string): Promise<Set<string>> =>
    new Set((await DatasetSegments.open(storage, repoDir, hash)).manifest.entries.map(({ hash: segment }) => segment));

  it('R29 — a load commits once as $load:<source>, with its delta and its arguments, and the slots name its delivery, its load, its commit and its execution, and its as-of', async () => {
    const ws = await fresh();
    const asOf = new Date('2026-11-02T03:00:00Z');
    const ready = await prepared(ws, 'erp', await delivery([['SO-1001', acme], ['SO-1002', birch]]));
    const outcome = await commit(ws, 'erp', ready, { asOf });
    assert.equal(outcome.kind, 'committed', said(outcome));
    if (outcome.kind !== 'committed') return;

    assert.deepEqual(await chain(ws), ['$load:erp', ...DEPLOYED]);
    const stored = decodeRecordCommit(await storage.objects.read(repoDir, outcome.commit));
    assert.equal(stored.actor, 'system:load');
    assert.equal(stored.delta.type === 'some' && stored.delta.value, ready.delta, 'the commit names the delta it applied');
    const args = await argsOf(outcome.commit);
    assert.ok(sameArgs(args, {
      delivery: ready.delivery, load: ready.load, asOf: some(asOf), first: true, execution: ready.execution, set: 2n, deleted: 0n, unchanged: 0n,
    }), 'its arguments say what it loaded, and that it was the source\'s first delivery');
    assert.ok(sameArgs(args, outcome.args), 'and the outcome says what it recorded');

    const versions = (await ref(ws)).versions;
    const slots = sourceLoadSlots('erp');
    assert.deepEqual(
      [versions.get(slots.delivery), versions.get(slots.load), versions.get(slots.commit), versions.get(slots.execution), versions.get(slots.asOf)],
      [ready.delivery, ready.load, outcome.commit, `${ready.execution.inputsHash}/${ready.execution.executionId}`, '2026-11-02T03:00:00.000']);
    await holds(ws, [['erp', 'SO-1001', acme], ['erp', 'SO-1002', birch], ['own', 'P-1', birch]]);
  });

  it('R28 — a source\'s first delivery takes it out of the sources the record waits on, and once none waits the slot goes', async () => {
    const ws = await fresh();
    assert.equal((await ref(ws)).versions.get(PENDING_SLOT), 'erp,wms', 'the deploy has the record wait on both');
    const erp = await loaded(ws, 'erp', [['SO-1001', acme]]);
    assert.equal((await ref(ws)).versions.get(PENDING_SLOT), 'wms');
    assert.equal(erp.args.first, true);
    const wms = await loaded(ws, 'wms', [['W-1', cedar]]);
    assert.equal((await ref(ws)).versions.has(PENDING_SLOT), false, 'none waits, and the slot goes');
    assert.equal(wms.args.first, true);
    const again = await loaded(ws, 'erp', [['SO-1001', birch]]);
    assert.equal(again.args.first, false, 'a later delivery is no first');
  });

  it('R12 — the source\'s as-of is the later of the two, and a delivery that says none leaves it', async () => {
    const ws = await fresh();
    const asOfSlot = sourceLoadSlots('erp').asOf;
    await loaded(ws, 'erp', [['SO-1001', acme]], { asOf: new Date('2026-11-02T03:00:00Z') });
    await loaded(ws, 'erp', [['SO-1001', birch]], { asOf: new Date('2026-11-01T03:00:00Z') });
    assert.equal((await ref(ws)).versions.get(asOfSlot), '2026-11-02T03:00:00.000', 'an older as-of leaves the later');
    await loaded(ws, 'erp', [['SO-1001', cedar]]);
    assert.equal((await ref(ws)).versions.get(asOfSlot), '2026-11-02T03:00:00.000', 'no as-of leaves the slot');
    await loaded(ws, 'erp', [['SO-1001', acme]], { asOf: new Date('2026-11-03T03:00:00Z') });
    assert.equal((await ref(ws)).versions.get(asOfSlot), '2026-11-03T03:00:00.000', 'a later as-of moves it');
  });

  it('R9 — a delivery that changes nothing commits once, 0 set and 0 deleted, so the history and the slots record it', async () => {
    const ws = await fresh();
    await loaded(ws, 'erp', [['SO-1001', acme], ['SO-1002', birch]]);
    const same = await loaded(ws, 'erp', [['SO-1002', birch], ['SO-1001', acme]]);
    assert.deepEqual([same.args.set, same.args.deleted, same.args.unchanged], [0n, 0n, 2n]);
    assert.deepEqual(await chain(ws), ['$load:erp', '$load:erp', ...DEPLOYED]);
    assert.equal((await ref(ws)).versions.get(sourceLoadSlots('erp').commit), same.commit);
  });

  it('R16 — saves that land while a load runs commit as they do, and the load\'s commit folds each in from its delta, its own applied once (§4.11)', async () => {
    const ws = await fresh();
    const ready = await prepared(ws, 'erp', await delivery([['SO-1001', acme], ['SO-1002', birch]]));
    // While its pieces ran, m1 and m2 landed
    const m1 = await save(ws, 'P-2', acme);
    const m2 = await save(ws, 'P-3', cedar);
    // And m3 lands as attempt 1 writes, so attempt 2 folds m3 in
    let m3 = '';
    const counted = counting(await segmentsOf(ready.delta));
    const both = withStores(storage, { datasets: racing(async () => { m3 = await save(ws, 'P-4', birch); }), objects: counted.objects });
    const outcome = await commit(ws, 'erp', ready, {}, both);
    assert.equal(outcome.kind, 'committed', said(outcome));
    if (outcome.kind !== 'committed') return;

    const history = await recordHistory(storage, repoDir, ws, 'orders');
    assert.deepEqual(history.map(({ commit: c }) => c.mutation), ['$load:erp', 'plan', 'plan', 'plan', ...DEPLOYED]);
    assert.deepEqual(history.slice(1, 4).map(({ hash }) => hash), [m3, m2, m1], 'each save committed as it does');
    assert.equal(history[0]!.commit.parent.type === 'some' && history[0]!.commit.parent.value, m3, 'the load\'s commit sits on the last of them');
    await holds(ws, [
      ['erp', 'SO-1001', acme], ['erp', 'SO-1002', birch], ['own', 'P-1', birch], ['own', 'P-2', acme], ['own', 'P-3', cedar], ['own', 'P-4', birch],
    ]);
    // Read once, to apply it and to count what it did as it is applied: never again for an attempt
    assert.equal(counted.reads(), 1, 'the load\'s delta was read once, over every attempt');
  });

  it('R16 — another source\'s load that lands while a load runs is folded in the same way', async () => {
    const ws = await fresh();
    const erp = await prepared(ws, 'erp', await delivery([['SO-1001', acme]]));
    const wms = await loaded(ws, 'wms', [['W-1', cedar], ['W-2', birch]]);
    const outcome = await commit(ws, 'erp', erp);
    assert.equal(outcome.kind, 'committed', said(outcome));
    assert.deepEqual(await chain(ws), ['$load:erp', '$load:wms', ...DEPLOYED]);
    const stored = decodeRecordCommit(await storage.objects.read(repoDir, outcome.kind === 'committed' ? outcome.commit : ''));
    assert.equal(stored.parent.type === 'some' && stored.parent.value, wms.commit);
    await holds(ws, [['erp', 'SO-1001', acme], ['own', 'P-1', birch], ['wms', 'W-1', cedar], ['wms', 'W-2', birch]]);
  });

  it('R17 — a reindex that lands while a load runs leaves the source\'s entries: the commit reads the run again, finds it the same, and commits over it', async () => {
    const ws = await fresh();
    const ready = await prepared(ws, 'erp', await delivery([['SO-1001', acme]]));
    const reindexed = await recordReindex(storage, runner, repoDir, ws, 'orders', { actor: 'ada@example.com' });
    assert.equal(reindexed.kind, 'committed', JSON.stringify(reindexed));
    const outcome = await commit(ws, 'erp', ready);
    assert.equal(outcome.kind, 'committed', said(outcome));
    assert.deepEqual(await chain(ws), ['$load:erp', '$reindex', ...DEPLOYED]);
    await holds(ws, [['erp', 'SO-1001', acme], ['own', 'P-1', birch]]);
  });

  it('R17 — a rollback past the source\'s last load changes its entries: the commit sends the load back to its pieces, and writes nothing', async () => {
    const ws = await fresh();
    const minted = await head(ws);
    await loaded(ws, 'erp', [['SO-1001', acme]]);
    const ready = await prepared(ws, 'erp', await delivery([['SO-1001', birch]]));
    const rolled = await recordSystemCommit(storage, runner, repoDir, ws, 'orders', { name: '$rollback', target: { commit: minted }, actor: 'ada@example.com' });
    assert.equal(rolled.kind, 'committed', JSON.stringify(rolled));
    const before = await ref(ws);
    assert.deepEqual(await commit(ws, 'erp', ready), { kind: 'restart', reason: 'the entries of source \'erp\' changed under its load' });
    assert.deepEqual(await ref(ws), before, 'the record stands where the rollback left it');
  });

  it('R17 — a load of the same source that lands while a load runs makes the commit read the run again: changed, the load restarts', async () => {
    const ws = await fresh();
    const ready = await prepared(ws, 'erp', await delivery([['SO-1001', acme]]));
    await loaded(ws, 'erp', [['SO-1001', birch]]);
    assert.deepEqual(await commit(ws, 'erp', ready), { kind: 'restart', reason: 'the entries of source \'erp\' changed under its load' });
  });

  it('R17 — a load of the same source that left its entries as they were is no change: the run check finds them, and the commit goes on', async () => {
    const ws = await fresh();
    await loaded(ws, 'erp', [['SO-1001', acme]]);
    const ready = await prepared(ws, 'erp', await delivery([['SO-1001', birch]]));
    // The same entries again: a load of them commits, and changes none
    await loaded(ws, 'erp', [['SO-1001', acme]]);
    const outcome = await commit(ws, 'erp', ready);
    assert.equal(outcome.kind, 'committed', said(outcome));
    await holds(ws, [['erp', 'SO-1001', birch], ['own', 'P-1', birch]]);
  });

  it('R18 — only a ref conflict is tried again: a store that fails the write fails the commit, and nothing is retried', async () => {
    const ws = await fresh();
    const ready = await prepared(ws, 'erp', await delivery([['SO-1001', acme]]));
    let writes = 0;
    const failing = raced(() => { writes++; throw new Error('the store is down'); });
    await assert.rejects(commit(ws, 'erp', ready, {}, failing), /the store is down/);
    assert.equal(writes, 1, 'no second attempt');
    assert.deepEqual(await chain(ws), DEPLOYED, 'and nothing committed');
  });

  it('R7 — a load whose patch names a key of neither its delivery nor its entries fails at its commit, naming the key, and nothing commits', async () => {
    const ws = await fresh('1.1.0');
    const ready = await prepared(ws, 'erp', await delivery([['SO-1001', acme]]));
    await assert.rejects(commit(ws, 'erp', ready), /ZZ-9/);
    assert.deepEqual(await chain(ws), DEPLOYED, 'nothing committed');
  });

  it('a load whose signal fires before its write writes nothing, at its first attempt or a later one', async () => {
    const ws = await fresh();
    const ready = await prepared(ws, 'erp', await delivery([['SO-1001', acme]]));
    const early = new AbortController();
    early.abort();
    assert.deepEqual(await commit(ws, 'erp', ready, { signal: early.signal }), { kind: 'stopped' });
    const late = new AbortController();
    const over = raced(async () => {
      await save(ws, 'P-2', acme);
      late.abort();
    });
    assert.deepEqual(await commit(ws, 'erp', ready, { signal: late.signal }, over), { kind: 'stopped' });
    assert.deepEqual(await chain(ws), ['plan', ...DEPLOYED], 'the save stands, and the load wrote nothing');
  });

  it('R62 — a commit asked to stop while it applies its delta stops within a few of the delta\'s segments, and writes nothing: a load lets its workspace go for a deploy without applying a delivery of any size to its end', async () => {
    const ws = await fresh();
    // A delivery of many orders, whose delta is many segments
    const ready = await prepared(ws, 'erp', await delivery(Array.from({ length: 40_000 }, (_, i): [string, OrderRow] =>
      [`SO-${String(i).padStart(6, '0')}`, { customer: `C-${i % 97}`, qty: BigInt(i) }])));
    const segments = await segmentsOf(ready.delta);
    assert.ok(segments.size >= 12, `the delta is cut into many segments: ${segments.size}`);

    // The stop comes as the first of the delta's segments is read: the apply reads no more than those read ahead of it
    const stop = new AbortController();
    const counted = counting(segments);
    const stopping = overriding(counted.objects, {
      read: (repo: string, hash: string) => {
        if (segments.has(hash)) stop.abort();
        return counted.objects.read(repo, hash);
      },
    });
    assert.deepEqual(await commit(ws, 'erp', ready, { signal: stop.signal }, withStores(storage, { objects: stopping })), { kind: 'stopped' });
    assert.ok(counted.reads() <= 6, `the commit read ${counted.reads()} of the delta's ${segments.size} segments`);
    assert.deepEqual(await chain(ws), DEPLOYED, 'nothing committed');
  });

  it('R92 — the commit\'s apply reads only the segments its delta\'s keys fall in, carrying every other over as stored', async () => {
    const ws = await fresh('1.2.0');
    const primary = (await readRecordState(storage, repoDir, (await ref(ws)).hash)).primary;
    const segments = await segmentsOf(primary);
    assert.ok(segments.size >= 4, `the record is cut into several segments: ${segments.size}`);

    const ready = await prepared(ws, 'erp', await delivery([['SO-1001', acme], ['SO-1002', birch]]));
    const counted = counting(segments);
    const outcome = await commit(ws, 'erp', ready, {}, withStores(storage, { objects: counted.objects }));
    assert.equal(outcome.kind, 'committed', said(outcome));
    assert.ok(counted.reads() <= 2, `the apply read ${counted.reads()} of the record's ${segments.size} segments`);
  });

  it('over seeded interleavings of saves and another source\'s loads, the commit comes to what a straight apply of every commit in order does, target by target', async () => {
    for (const seed of [11, 29, 47]) {
      const next = seededStream(seed);
      const pick = <T>(choices: readonly T[]): T => choices[Math.floor(next() * choices.length)]!;
      const customers = ['Acme', 'Birch', 'Cedar', 'Dune'];
      const row = (): OrderRow => ({ customer: pick(customers), qty: BigInt(Math.floor(next() * 20)) });
      const ws = await fresh();
      await loaded(ws, 'erp', [['SO-1', row()], ['SO-2', row()], ['SO-3', row()]]);
      const base = await ref(ws);
      const ready = await prepared(ws, 'erp', await delivery([['SO-1', row()], ['SO-3', row()], ['SO-4', row()]]));
      // What lands while the load's pieces run
      const landed: string[] = [];
      for (let step = 0, steps = 2 + Math.floor(next() * 4); step < steps; step++) {
        if (next() < 0.6) landed.push(await save(ws, pick(['P-1', 'P-2', 'P-3']), row()));
        else landed.push((await loaded(ws, 'wms', [[`W-${Math.floor(next() * 3)}`, row()]])).commit);
      }
      const outcome = next() < 0.5
        ? await commit(ws, 'erp', ready)
        : await commit(ws, 'erp', ready, {}, raced(async () => { landed.push(await save(ws, 'P-9', row())); }));
      assert.equal(outcome.kind, 'committed', `seed ${seed}: ${said(outcome)}`);
      if (outcome.kind !== 'committed') return;

      // A straight apply: every commit that landed, in order, then the load
      let straight: RecordStateRefs = await readRecordState(storage, repoDir, base.hash);
      const apply = async (delta: string, cases?: ReadonlySet<string>) => {
        straight = stateWritten(straight, await applyDelta(storage, repoDir, stateTargets(straight), delta, cases === undefined ? {} : { cases }));
      };
      for (const hash of landed) {
        const stored = decodeRecordCommit(await storage.objects.read(repoDir, hash));
        if (stored.delta.type === 'some') await apply(stored.delta.value);
      }
      await apply(ready.delta, new Set(['erp']));
      const got = await readRecordState(storage, repoDir, outcome.state);
      assert.equal(got.primary, straight.primary, `seed ${seed}: the record's own collection`);
      for (const [name, entry] of straight.indexes) assert.equal(got.indexes.get(name)?.manifest, entry.manifest, `seed ${seed}: index ${name}`);
    }
  });
});
