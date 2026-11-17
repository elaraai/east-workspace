/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A load of a delivery into an external source of a composite record (§7.5,
 * §4.3, §4.13): the job `e3 load` runs in process and a server runs as a job.
 * It takes its turn among its source's loads, answers a repeat and an older
 * copy without running, takes the delivery in, runs its pieces, and commits
 * once; it lets the workspace go for a deploy or an export and goes on after
 * it, and fails for what a deploy took from it.
 *
 * Each load here runs on the local runner, its pieces held by a gated runner
 * where a case needs "while it runs" exact. Each case is titled by the
 * requirement of the design it checks.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import {
  StringType, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, toEastTypeValue, variant, type ValueTypeOf,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  RecordLoadObjectType, RecordLoadResultType, decodeRecordCommit, decodeRecordLoadObject, type LockOperation, type RecordLoadProgress,
  type RecordLoadResult,
} from '@elaraai/e3-types';
import { deliveryAdoptStored } from './dataset-adopt.js';
import { readDatasetWhole } from './dataset-open.js';
import { acquireWorkspaceExclusive, workspaceIntentLock } from './deploy-lock.js';
import { RecordLoadRefusedError, RecordLoadStoppedError, RepositoryBusyError } from './errors.js';
import { Budget, type BudgetRequest, type Grant } from './execution/budget.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import type { TaskRunner } from './execution/interfaces.js';
import { repoGc } from './gc.js';
import { packageImport } from './package-files.js';
import { loadQueueLock, recordLoad, type RecordLoadOptions } from './record-load.js';
import { sourceLoadSlots } from './record-slots.js';
import { readRecordState, recordHistory, recordMutate, recordSystemCommit, resolveRecord } from './records.js';
import { LocalStorage } from './storage/local/index.js';
import type { LockHandle, StorageBackend } from './storage/interfaces.js';
import {
  ErpDeliveryType, GatedTaskRunner, LedgerOrdersType, SourcedOrderType, createTempDir, createTestRepo, encodeInSegmentsOf, inProjectWithoutEastC,
  ledgerOrders, ledgerRows, overriding, removeTempDir, removeTestRepo, withEnv, withStores, type LedgerErpLoad,
} from './test-helpers.js';
import { workspaceCreate, workspaceDeploy } from './workspaces.js';

type OrderRow = ValueTypeOf<typeof SourcedOrderType>;

const decodeOrders = decodeBeast2For(LedgerOrdersType);
const encodeString = encodeBeast2For(StringType);
const encodeOrder = encodeBeast2For(SourcedOrderType);
const encodeLoadObject = encodeBeast2For(RecordLoadObjectType);
const sameOrders = equalFor(LedgerOrdersType);
const sameResult = equalFor(RecordLoadResultType);
const printOrders = printFor(LedgerOrdersType);
const printResult = printFor(RecordLoadResultType);

const acme: OrderRow = { customer: 'Acme', qty: 5n };
const birch: OrderRow = { customer: 'Birch', qty: 2n };
const cedar: OrderRow = { customer: 'Cedar', qty: 7n };

const ERP_RESTARTED = 'the entries of source \'erp\' changed under its load';

/** The kinds of a load's progress, in order, each once where it repeats. */
function story(steps: readonly RecordLoadProgress[]): string[] {
  return steps.map((step) => step.type).filter((kind, i, all) => i === 0 || kind !== all[i - 1]);
}

/** The words of each time a load said it was stopped. */
function stops(steps: readonly RecordLoadProgress[]): string[] {
  return steps.flatMap((step) => step.type === 'stopped' ? [step.value] : []);
}

/** The pieces a load last said were done, and of those the cache answered. */
function lastPieces(steps: readonly RecordLoadProgress[]): { done: bigint; total: bigint; cached: bigint } | undefined {
  return steps.flatMap((step) => step.type === 'pieces' ? [step.value] : []).at(-1);
}

/** A package of the ledger's `orders`, its `erp` loaded as `erp` says. */
function ledgerPackage(version: string, erp: LedgerErpLoad): ReturnType<typeof e3.package> {
  return e3.package('ledger', version, ledgerOrders({ erp }));
}

describe('a load of a delivery', () => {
  let repoDir: string;
  let dir: string;
  let storage: StorageBackend;
  let runner: LocalTaskRunner;
  let workspaces = 0;

  before(async () => {
    repoDir = createTestRepo();
    dir = createTempDir();
    storage = new LocalStorage(dirname(repoDir));
    runner = new LocalTaskRunner(repoDir);
    const packages: Array<[string, ReturnType<typeof e3.package>]> = [
      ['ledger.zip', ledgerPackage('1.0.0', 'book')],
      // The ERP's load function changed: each order's quantity doubled
      ['doubled.zip', ledgerPackage('1.1.0', 'doubled')],
      // The ERP's delivery type changed: a note on each order
      ['noted.zip', ledgerPackage('1.2.0', 'noted')],
      // A package with no record at all
      ['other.zip', e3.package('ledger', '2.0.0', e3.input('note', StringType, variant('value', '')))],
    ];
    for (const [name, pkg] of packages) {
      await e3.export(pkg, join(dir, name));
      await packageImport(storage, repoDir, join(dir, name));
    }
  });

  after(() => {
    removeTestRepo(repoDir);
    removeTempDir(dir);
  });

  /** A workspace of its own for a case, the ledger deployed to it. */
  const fresh = async (): Promise<string> => {
    const ws = `ws${++workspaces}`;
    await workspaceCreate(storage, repoDir, ws);
    await workspaceDeploy(storage, repoDir, ws, 'ledger', '1.0.0', { runner });
    return ws;
  };
  /** The record's ref in a workspace. */
  const ref = async (ws: string) => {
    const held = await storage.datasets.read(repoDir, ws, 'records/orders');
    if (held === null || held.type !== 'value') assert.fail('the record holds no state');
    return held.value;
  };
  /** The record's commits, newest first, by name. */
  const chain = async (ws: string): Promise<string[]> => (await recordHistory(storage, repoDir, ws, 'orders')).map(({ commit }) => commit.mutation);
  /** The commits a deploy of the ledger writes: its `$init`, and the `$reindex` that builds its index. */
  const DEPLOYED = ['$reindex', '$init'];
  /** Asserts the record holds these orders, and no other. */
  const holds = async (ws: string, rows: Parameters<typeof ledgerRows>[0]): Promise<void> => {
    const got = decodeOrders(await readDatasetWhole(storage, repoDir, (await readRecordState(storage, repoDir, (await ref(ws)).hash)).primary));
    assert.ok(sameOrders(got, ledgerRows(rows)), `the record holds ${printOrders(got)}`);
  };
  /** A delivery of some orders, written as the object a file or an upload stores, its segments `per` orders each. */
  const deliver = (rows: Array<[string, OrderRow]>, per = 2): Promise<string> =>
    storage.objects.write(repoDir, encodeInSegmentsOf(ErpDeliveryType, per)(new Map(rows)));
  /** A load of a delivery into a source of `orders`, and every step it reported. */
  const load = async (ws: string, source: string, delivery: string, options: Partial<RecordLoadOptions> = {}, over: StorageBackend = storage, by: TaskRunner = runner) => {
    const steps: RecordLoadProgress[] = [];
    const result = await recordLoad(over, by, repoDir, ws, 'orders', source, delivery, {
      actor: 'cli:ada', ...options, onProgress: (step) => {
        steps.push(step);
        options.onProgress?.(step);
      },
    });
    return { result, steps };
  };
  /** A save of one of the solution's own orders. */
  const save = async (ws: string, id: string, order: OrderRow): Promise<string> => {
    const outcome = await recordMutate(storage, runner, repoDir, ws, 'orders', 'plan', [encodeString(id), encodeOrder(order)], { actor: 'ada@example.com' });
    if (outcome.kind !== 'committed') assert.fail(`the save did not commit: ${outcome.kind}`);
    return outcome.commitHash;
  };
  /** Asserts a load's answer. */
  const answered = (result: RecordLoadResult, expected: RecordLoadResult): void =>
    assert.ok(sameResult(result, expected), `the load answered ${printResult(result)}`);

  it('R6 — a delivery is taken in, run in pieces, and committed once as $load:erp, with its counts and its as-of', async () => {
    const ws = await fresh();
    const delivery = await deliver([['SO-1001', acme], ['SO-1002', birch]]);
    const { result, steps } = await load(ws, 'erp', delivery, { asOf: new Date('2026-11-02T03:00:00Z') });

    const held = await ref(ws);
    const slots = sourceLoadSlots('erp');
    const commit = held.versions.get(slots.commit)!;
    answered(result, {
      commit: some(commit), state: some(held.hash), delivery, set: 2n, deleted: 0n, unchanged: 0n, outcome: variant('loaded', null),
    });
    assert.deepEqual(story(steps), ['intake', 'pieces', 'commit'], 'taken in, its pieces run, then committed');
    assert.deepEqual(await chain(ws), ['$load:erp', ...DEPLOYED]);
    const stored = decodeRecordCommit(await storage.objects.read(repoDir, commit));
    assert.equal(stored.actor, 'cli:ada', 'the commit names who loaded');
    assert.deepEqual([held.versions.get(slots.delivery), held.versions.get(slots.asOf)], [delivery, '2026-11-02T03:00:00.000'],
      'the source names the delivery as it was asked for, and its as-of');
    await holds(ws, [['erp', 'SO-1001', acme], ['erp', 'SO-1002', birch], ['own', 'P-1', birch]]);
  });

  it('R9 — a new delivery that changes nothing commits once, 0 set and 0 deleted', async () => {
    const ws = await fresh();
    const rows: Array<[string, OrderRow]> = [['SO-1001', acme], ['SO-1002', birch]];
    await load(ws, 'erp', await deliver(rows, 2));
    // The same orders, written another way: another delivery
    const again = await deliver(rows, 1);
    const { result } = await load(ws, 'erp', again);
    assert.equal(result.outcome.type, 'loaded');
    assert.deepEqual([result.set, result.deleted, result.unchanged], [0n, 0n, 2n]);
    assert.deepEqual(await chain(ws), ['$load:erp', '$load:erp', ...DEPLOYED]);
    assert.equal((await ref(ws)).versions.get(sourceLoadSlots('erp').delivery), again);
  });

  it('R10 — the same delivery again is answered by the commit that applied it, whatever committed since, and nothing runs', async () => {
    const ws = await fresh();
    const delivery = await deliver([['SO-1001', acme]]);
    const first = (await load(ws, 'erp', delivery)).result;
    await save(ws, 'P-2', cedar);
    const commits = await chain(ws);

    const { result, steps } = await load(ws, 'erp', delivery);
    answered(result, {
      commit: first.commit, state: first.state, delivery, set: 0n, deleted: 0n, unchanged: 0n, outcome: variant('again', null),
    });
    assert.deepEqual(steps, [], 'nothing was taken in, run or committed');
    assert.deepEqual(await chain(ws), commits);
  });

  it('R11, R12 — a delivery older than the source\'s as-of is superseded and nothing runs; one with none loads, and leaves the as-of', async () => {
    const ws = await fresh();
    const later = new Date('2026-11-02T03:00:00Z');
    await load(ws, 'erp', await deliver([['SO-1001', acme]]), { asOf: later });
    const commits = await chain(ws);

    const older = await deliver([['SO-1001', birch]]);
    const { result, steps } = await load(ws, 'erp', older, { asOf: new Date('2026-11-01T03:00:00Z') });
    answered(result, { commit: none, state: none, delivery: older, set: 0n, deleted: 0n, unchanged: 0n, outcome: variant('superseded', later) });
    assert.deepEqual(steps, []);
    assert.deepEqual(await chain(ws), commits, 'nothing committed');
    await holds(ws, [['erp', 'SO-1001', acme], ['own', 'P-1', birch]]);

    const undated = await load(ws, 'erp', older);
    assert.equal(undated.result.outcome.type, 'loaded', 'a delivery without an as-of is never superseded');
    assert.equal((await ref(ws)).versions.get(sourceLoadSlots('erp').asOf), '2026-11-02T03:00:00.000', 'and leaves the source\'s');
  });

  it('R13 — the same delivery after the load\'s function changed applies again, under the new function', async () => {
    const ws = await fresh();
    const delivery = await deliver([['SO-1001', acme]]);
    await load(ws, 'erp', delivery);
    await workspaceDeploy(storage, repoDir, ws, 'ledger', '1.1.0', { runner });
    const { result } = await load(ws, 'erp', delivery);
    assert.equal(result.outcome.type, 'loaded', 'not answered again: the load is another');
    await holds(ws, [['erp', 'SO-1001', { customer: 'Acme', qty: 10n }], ['own', 'P-1', birch]]);
    const resolved = await resolveRecord(storage, repoDir, ws, 'orders');
    const declared = resolved?.sources.get('erp');
    assert.equal((await ref(ws)).versions.get(sourceLoadSlots('erp').load), declared?.type === 'load' ? declared.value : undefined,
      'the source names the load it ran under');
  });

  it('R14 — two loads of one source run one at a time, in the order asked: the second says it waits, and commits after the first', async () => {
    const ws = await fresh();
    const gated = new GatedTaskRunner(runner, ['orders.erp']);
    const first = load(ws, 'erp', await deliver([['SO-1001', acme]]), {}, storage, gated);
    await gated.launched('orders.erp');
    let queued!: () => void;
    const waits = new Promise<void>((resolve) => { queued = resolve; });
    const second = load(ws, 'erp', await deliver([['SO-1401', birch], ['SO-1402', cedar]]), {
      onProgress: (step) => { if (step.type === 'queued') queued(); },
    }, storage, gated);
    await waits;
    assert.equal(gated.holding('orders.erp'), 1, 'the second has not reached its pieces');

    gated.pass('orders.erp');
    gated.release('orders.erp');
    const [one, two] = await Promise.all([first, second]);
    assert.deepEqual(story(two.steps).slice(0, 2), ['queued', 'intake'], 'it waited its turn, then took its delivery in');
    const history = await recordHistory(storage, repoDir, ws, 'orders');
    assert.deepEqual(history.map(({ commit }) => commit.mutation), ['$load:erp', '$load:erp', ...DEPLOYED]);
    assert.ok(one.result.commit.type === 'some' && history[1]!.hash === one.result.commit.value, 'the first committed first');
    await holds(ws, [['erp', 'SO-1401', birch], ['erp', 'SO-1402', cedar], ['own', 'P-1', birch]]);
  });

  it('R15 — loads of two sources run side by side, each committing its own entries', async () => {
    const ws = await fresh();
    const gated = new GatedTaskRunner(runner, ['orders.erp', 'orders.wms']);
    const erp = load(ws, 'erp', await deliver([['SO-1001', acme]]), {}, storage, gated);
    const wms = load(ws, 'wms', await deliver([['W-1', cedar]]), {}, storage, gated);
    // Both hold the workspace, their pieces running, at once
    await Promise.all([gated.launched('orders.erp'), gated.launched('orders.wms')]);
    gated.release('orders.wms');
    gated.release('orders.erp');
    await Promise.all([erp, wms]);
    assert.deepEqual((await chain(ws)).slice(0, 2).sort(), ['$load:erp', '$load:wms']);
    await holds(ws, [['erp', 'SO-1001', acme], ['own', 'P-1', birch], ['wms', 'W-1', cedar]]);
  });

  it('R17 — a rollback that lands while a load runs changes its entries: it loads again, saying why, and commits', async () => {
    const ws = await fresh();
    const deployed = (await ref(ws)).versions.get('.records.orders')!;
    await load(ws, 'erp', await deliver([['SO-1001', acme]]));
    const gated = new GatedTaskRunner(runner, ['orders.erp']);
    const running = load(ws, 'erp', await deliver([['SO-1701', birch], ['SO-1702', cedar]]), {}, storage, gated);
    await gated.launched('orders.erp');
    const rolled = await recordSystemCommit(storage, runner, repoDir, ws, 'orders', { name: '$rollback', target: { commit: deployed }, actor: 'ada@example.com' });
    assert.equal(rolled.kind, 'committed');
    gated.pass('orders.erp');
    gated.release('orders.erp');

    const { result, steps } = await running;
    assert.equal(result.outcome.type, 'loaded');
    assert.deepEqual(steps.flatMap((step) => step.type === 'restarted' ? [step.value] : []), [ERP_RESTARTED]);
    assert.deepEqual(story(steps).slice(-4), ['commit', 'restarted', 'pieces', 'commit'], 'its pieces ran again over the new run');
    await holds(ws, [['erp', 'SO-1701', birch], ['erp', 'SO-1702', cedar], ['own', 'P-1', birch]]);
  });

  it('R19 — a load stopped part way, asked again, takes its finished pieces from the cache', async () => {
    await withEnv({ E3_TEST_PIECE_BYTES: '64' }, async () => {
      const ws = await fresh();
      const rows = Array.from({ length: 8000 }, (_, i): [string, OrderRow] => [`SO-${String(i).padStart(5, '0')}`, { customer: `C-${i % 13}`, qty: BigInt(i) }]);
      const delivery = await deliver(rows, 1000);
      const stop = new AbortController();
      await assert.rejects(load(ws, 'erp', delivery, {
        signal: stop.signal,
        onProgress: (step) => { if (step.type === 'pieces' && step.value.done >= 1n) stop.abort(); },
      }), RecordLoadStoppedError);
      assert.deepEqual(await chain(ws), DEPLOYED, 'nothing committed');

      const { result, steps } = await load(ws, 'erp', delivery);
      assert.equal(result.set, 8000n);
      const pieces = lastPieces(steps);
      assert.ok(pieces !== undefined && pieces.total > 1n, 'the load ran in several pieces');
      assert.ok(pieces.cached >= 1n, `the cache answered the pieces that finished: ${pieces.cached} of ${pieces.total}`);
    });
  });

  it('R20 — a load is refused before anything runs for a record or source it cannot load, and for a source the dataflow loads', async () => {
    const ws = await fresh();
    const delivery = await deliver([['SO-1001', acme]]);
    const refused = (record: string, source: string, words: string, over: StorageBackend = storage) =>
      assert.rejects(recordLoad(over, runner, repoDir, ws, record, source, delivery, { actor: 'cli:ada' }),
        (err: unknown) => err instanceof RecordLoadRefusedError && err.message === words);
    await refused('nope', 'erp', 'record \'nope\' not found');
    await refused('orders', 'ftp', 'record \'orders\' has no source \'ftp\'');
    await refused('orders', 'own', 'source \'own\' of record \'orders\' is the solution\'s: its mutations write it, and no delivery is loaded into it');

    // A source fed by a task's output, as a package of the fourth pull request declares one
    const resolved = await resolveRecord(storage, repoDir, ws, 'orders');
    const declared = resolved?.sources.get('erp');
    if (declared?.type !== 'load') assert.fail('erp is loaded');
    const fed = encodeLoadObject({
      ...decodeRecordLoadObject(await storage.objects.read(repoDir, declared.value)),
      feed: some([variant('field', 'tasks'), variant('field', 'combine_erp'), variant('field', 'output')]),
    });
    const feeding = withStores(storage, {
      objects: overriding(storage.objects, {
        read: (repo: string, hash: string) => hash === declared.value ? Promise.resolve(fed) : storage.objects.read(repo, hash),
      }),
    });
    await refused('orders', 'erp', 'orders.erp is fed by .tasks.combine_erp.output, and the dataflow loads it', feeding);
    assert.deepEqual(await chain(ws), DEPLOYED, 'nothing committed');
  });

  it('R22 — a delivery the store does not hold fails the load, naming it', async () => {
    const ws = await fresh();
    const gone = 'f'.repeat(64);
    await assert.rejects(load(ws, 'erp', gone), { message: `delivery ${gone} is not in the repository: upload it again` });
  });

  it('R23 — a load waits its turn, and a deploy\'s end, past any number of turns, re-referencing its delivery at each', async () => {
    const ws = await fresh();
    const delivery = await deliver([['SO-1001', acme]]);
    const queue = loadQueueLock(ws, 'orders', 'erp');
    const intent = workspaceIntentLock(ws);
    // An earlier load holds the source's turn, and a deploy has announced itself
    let earlier: LockHandle | null = await storage.locks.acquire(repoDir, queue, variant('dataset_write', null));
    let deploying: LockHandle | null = await storage.locks.acquire(repoDir, intent, variant('deployment', null));
    assert.ok(earlier !== null && deploying !== null);
    // Each turn of a wait ends as one that waited its whole length: three, before the lock is let go
    let touches = 0;
    const turns: Record<string, number[]> = { [queue]: [], [intent]: [] };
    const waiting = withStores(storage, {
      objects: overriding(storage.objects, {
        touch: (repo: string, hashes: readonly string[]) => {
          if (hashes.includes(delivery)) touches++;
          return storage.objects.touch(repo, hashes);
        },
      }),
      locks: overriding(storage.locks, {
        acquire: async (repo, resource, operation, options) => {
          const seen = turns[resource];
          if (seen !== undefined && options?.wait === true) {
            seen.push(touches);
            if (seen.length <= 3) return null;
            if (resource === queue) await earlier?.release();
            if (resource === intent) await deploying?.release();
            if (resource === queue) earlier = null;
            if (resource === intent) deploying = null;
          }
          return storage.locks.acquire(repo, resource, operation, options);
        },
      }),
    });
    const { result, steps } = await load(ws, 'erp', delivery, {}, waiting);
    assert.equal(result.outcome.type, 'loaded');
    assert.deepEqual(story(steps).slice(0, 2), ['queued', 'stopped'], 'it said once that it waited its turn, and once that it waited out the deploy');
    assert.deepEqual(stops(steps), [`a deploy of ${ws} started. The load goes on once the deploy is done…`]);
    assert.deepEqual(turns[queue], [1, 2, 3, 4], 'each turn of its wait for its turn re-referenced the delivery');
    assert.deepEqual(turns[intent], [4, 5, 6, 7], 'and each turn of its wait for the deploy');
  });

  it('R62 — a deploy that starts while a load runs stops it within about a second; the load says so, and goes on once the deploy is done', async () => {
    const ws = await fresh();
    const gated = new GatedTaskRunner(runner, ['orders.erp']);
    // A delivery no other case loads, so neither the intake's memo nor the cache answers it
    const running = load(ws, 'erp', await deliver([['SO-6201', acme], ['SO-6202', cedar]]), {}, storage, gated);
    await gated.launched('orders.erp');
    // Its pieces are held; the next run of them goes straight through
    gated.pass('orders.erp');
    // The deploy announces itself, and waits for the load to let the workspace go
    await workspaceDeploy(storage, repoDir, ws, 'ledger', '1.0.0', { runner });

    const { result, steps } = await running;
    assert.equal(result.outcome.type, 'loaded');
    assert.deepEqual(stops(steps), [`a deploy of ${ws} started. The load goes on once the deploy is done…`]);
    assert.deepEqual(story(steps), ['intake', 'stopped', 'pieces', 'commit'], 'stopped while its pieces ran, then ran them and committed');
    await holds(ws, [['erp', 'SO-6201', acme], ['erp', 'SO-6202', cedar], ['own', 'P-1', birch]]);
  });

  it('R63 — a load a deploy stopped fails, naming the change, when the deploy changed the source\'s delivery type, or removed the record', async () => {
    for (const [version, words] of [
      ['1.2.0', 'the deploy changed the delivery type of source \'erp\' of record \'orders\''],
      ['2.0.0', 'the deploy removed record \'orders\''],
    ] as const) {
      const ws = await fresh();
      const gated = new GatedTaskRunner(runner, ['orders.erp']);
      const running = load(ws, 'erp', await deliver([['SO-1001', acme]]), {}, storage, gated);
      await gated.launched('orders.erp');
      gated.pass('orders.erp');
      await workspaceDeploy(storage, repoDir, ws, 'ledger', version, { runner, allowDropRecords: true });
      await assert.rejects(running, { message: words });
    }
  });

  it('R85 — a load stopped before its commit writes commits nothing, and its pieces stay cached; one stopped after its commit wrote has loaded', async () => {
    const ws = await fresh();
    const delivery = await deliver([['SO-1001', acme]]);
    const before = new AbortController();
    await assert.rejects(load(ws, 'erp', delivery, {
      signal: before.signal, onProgress: (step) => { if (step.type === 'commit') before.abort(); },
    }), RecordLoadStoppedError);
    assert.deepEqual(await chain(ws), DEPLOYED, 'nothing committed');

    // Asked again, the cache answers its pieces whole, and it commits; stopped once its ref is written, it has loaded
    const after = new AbortController();
    const writing = withStores(storage, {
      datasets: overriding(storage.datasets, {
        writeIf: async (...args: Parameters<StorageBackend['datasets']['writeIf']>) => {
          const written = await storage.datasets.writeIf(...args);
          after.abort();
          return written;
        },
      }),
    });
    const { result, steps } = await load(ws, 'erp', delivery, { signal: after.signal }, writing);
    assert.equal(result.outcome.type, 'loaded');
    assert.deepEqual(story(steps), ['commit'], 'no piece ran: the cache answered the load\'s task');
    assert.deepEqual(await chain(ws), ['$load:erp', ...DEPLOYED]);
  });

  it('R87 — a load whose runner cannot run its east-c runs its pieces on east-node', {
    skip: process.platform === 'win32' ? 'the runners here are POSIX shell scripts' : false,
  }, async () => {
    const ws = await fresh();
    const delivery = await deliver([['SO-1001', acme]]);
    await inProjectWithoutEastC(dir, async () => {
      const { result } = await load(ws, 'erp', delivery, {}, storage, new LocalTaskRunner(repoDir));
      assert.equal(result.outcome.type, 'loaded');
    });
    await holds(ws, [['erp', 'SO-1001', acme], ['own', 'P-1', birch]]);
  });

  /**
   * A load whose pieces are held when `operation` takes its workspace whole,
   * as an export, a copy onto it or its removal does: what the load did, and
   * every step it reported, once the operation has had the workspace and let
   * it go.
   */
  const loadMeeting = async (operation: LockOperation, rows: Array<[string, OrderRow]>) => {
    const ws = await fresh();
    const gated = new GatedTaskRunner(runner, ['orders.erp']);
    const steps: RecordLoadProgress[] = [];
    const running = recordLoad(storage, gated, repoDir, ws, 'orders', 'erp', await deliver(rows), {
      actor: 'cli:ada', onProgress: (step) => steps.push(step),
    }).then((result) => ({ result }), (error: unknown) => ({ error }));
    await gated.launched('orders.erp');
    gated.pass('orders.erp');
    // It announces itself, and has the workspace once the load lets it go
    const whole = await acquireWorkspaceExclusive(storage, repoDir, ws, operation);
    await whole.release();
    return { ws, steps, ...await running };
  };

  it('ruling 26 — an export that starts while a load runs stops it, and the load goes on once the export is done', async () => {
    const { ws, steps, ...ended } = await loadMeeting(variant('export', null), [['SO-2601', acme]]);
    assert.ok('result' in ended && ended.result.outcome.type === 'loaded', 'it loaded');
    assert.deepEqual(stops(steps), [`an export of ${ws} started. The load goes on once it is done…`]);
    await holds(ws, [['erp', 'SO-2601', acme], ['own', 'P-1', birch]]);
  });

  it('ruling 26 — a copy onto the workspace, or its removal, fails a load that runs, naming it, and nothing is loaded', async () => {
    for (const [operation, words] of [
      [variant('workspace_copy', null), (ws: string) => `a copy onto ${ws} replaced the workspace: nothing loaded`],
      [variant('removal', null), (ws: string) => `a removal of ${ws} removed the workspace: nothing loaded`],
    ] as const) {
      const { ws, steps, ...ended } = await loadMeeting(operation, [['SO-2602', cedar]]);
      assert.ok('error' in ended && ended.error instanceof Error, 'it failed');
      assert.equal(ended.error.message, words(ws));
      assert.deepEqual(stops(steps), [], 'and said nothing of going on');
      assert.deepEqual(await chain(ws), DEPLOYED, 'nothing was committed');
    }
  });

  it('R69 — gc while a load waits its turn, or waits out a deploy, is refused, and the load\'s delivery is kept', async () => {
    const ws = await fresh();
    const delivery = await deliver([['SO-6901', birch]]);
    // An earlier load holds the source's turn, and a deploy has announced itself
    const earlier = await storage.locks.acquire(repoDir, loadQueueLock(ws, 'orders', 'erp'), variant('dataset_write', null));
    const deploying = await storage.locks.acquire(repoDir, workspaceIntentLock(ws), variant('deployment', null));
    assert.ok(earlier !== null && deploying !== null);
    const seen = new Set<string>();
    const waiters = new Map<string, () => void>();
    const reached = (kind: string): Promise<void> => seen.has(kind) ? Promise.resolve() : new Promise((resolve) => {
      waiters.set(kind, resolve);
    });
    const running = load(ws, 'erp', delivery, {
      onProgress: (step) => {
        seen.add(step.type);
        waiters.get(step.type)?.();
      },
    });
    for (const [waiting, holder] of [['queued', earlier], ['stopped', deploying]] as const) {
      await reached(waiting);
      await assert.rejects(repoGc(storage, repoDir, { minAge: 0 }), RepositoryBusyError, `gc is refused while the load is ${waiting}`);
      assert.ok((await storage.objects.read(repoDir, delivery)).byteLength > 0, 'its delivery is kept');
      await holder.release();
    }
    const { result } = await running;
    assert.equal(result.outcome.type, 'loaded');
  });

  it('R91 — a save made while a load\'s pieces hold every core of the process takes the next core freed', async () => {
    await withEnv({ E3_TEST_PIECE_BYTES: '64' }, async () => {
      const ws = await fresh();
      const rows = Array.from({ length: 8000 }, (_, i): [string, OrderRow] => [`SO-9${String(i).padStart(5, '0')}`, { customer: `C-${i % 11}`, qty: BigInt(i) }]);
      const delivery = await deliver(rows, 1000);
      // Taken in first, so the only units the budget sees are the load's
      await deliveryAdoptStored(storage, repoDir, ws, { address: 'orders.erp', type: toEastTypeValue(ErpDeliveryType) }, delivery, { runner });

      // Two cores. What each grant ran, in the order granted; and the cores of
      // the second and third pieces to finish held, with those pieces, until
      // the case lets them go
      const budget = new Budget({ cores: 2, memory: 8 * 1024 ** 3 }, { sampler: null });
      const granted: string[] = [];
      let unitsLetGo = 0;
      const heldCores = new Map<number, () => void>();
      let saveAsked!: () => void;
      const asked = new Promise<void>((resolve) => { saveAsked = resolve; });
      const traced = overriding(budget, {
        acquire: async (request: BudgetRequest = {}): Promise<Grant> => {
          const kind = request.kind ?? 'task';
          if (kind === 'task') saveAsked();
          const grant = await budget.acquire(request);
          granted.push(kind);
          if (kind !== 'unit') return grant;
          return overriding(grant, {
            release: () => {
              const n = ++unitsLetGo;
              if (n === 2 || n === 3) heldCores.set(n, () => grant.release());
              else grant.release();
            },
          });
        },
      });
      const piecesHeld = new Map<number, () => void>();
      let bothHeld!: () => void;
      const held = new Promise<void>((resolve) => { bothHeld = resolve; });
      let unitsEnded = 0;
      const budgeted = new LocalTaskRunner(repoDir, traced, {
        body: async (request, local) => {
          const result = await local();
          if (request.role === 'unit') {
            const n = ++unitsEnded;
            if (n === 2 || n === 3) {
              await new Promise<void>((resolve) => {
                piecesHeld.set(n, resolve);
                if (piecesHeld.size === 2) bothHeld();
              });
            }
          }
          return result;
        },
      });
      /** Lets the `n`th piece to finish go: its core first, then the piece. */
      const letGo = (n: number): void => {
        heldCores.get(n)?.();
        piecesHeld.get(n)?.();
      };

      const loading = load(ws, 'erp', delivery, {}, storage, budgeted);
      await held;
      assert.deepEqual(granted, ['unit', 'unit', 'unit'], 'the pieces hold both cores: the first alone, then two together');
      const saving = recordMutate(storage, budgeted, repoDir, ws, 'orders', 'plan', [encodeString('P-9'), encodeOrder(cedar)], { actor: 'ada@example.com' });
      await asked;
      letGo(2);
      const saved = await saving;
      assert.equal(saved.kind, 'committed');
      letGo(3);
      const { result } = await loading;
      assert.equal(result.set, 8000n);
      assert.deepEqual(granted.slice(0, 4), ['unit', 'unit', 'unit', 'task'], `the save's program took the first core freed: ${granted.join(', ')}`);
    });
  });
});
