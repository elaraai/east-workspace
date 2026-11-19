/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The local server's load jobs and object uploads (§7.11, ruling 28): the
 * stores' contracts over the in-memory transfer backend, its jobs run over a
 * local repository on the local runner; and what is the backend's own of a
 * load run as a job — a cancel that asks and a job that ends itself, a job
 * that lets go however it ends, and a delivery uploaded as an object and
 * loaded by its hash. Each case is titled by the requirement of the design it
 * checks.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { none, some, variant, type ValueTypeOf } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { computeHash } from '../objects.js';
import { LocalTaskRunner } from '../execution/LocalTaskRunner.js';
import type { TaskRunner } from '../execution/interfaces.js';
import { packageImport } from '../package-files.js';
import { loadQueueLock } from '../record-load.js';
import { recordHistory } from '../records.js';
import { TASKS_LOCK } from '../running-work.js';
import { LocalStorage } from '../storage/local/index.js';
import { transferStagingDir, transferStagingPath } from '../storage/local/localHelpers.js';
import type { StorageBackend } from '../storage/interfaces.js';
import {
  ErpDeliveryType, GatedTaskRunner, LEDGER_ORDERS, SourcedOrderType, createTempDir, createTestRepo, encodeInSegmentsOf, gated, ledgerOrders,
  ledgerWorkspaces, objectUploadStoreTests, overriding, recordLoadStoreTests, removeTempDir, removeTestRepo, withStores, type LedgerWorkspaces,
} from '../test-helpers.js';
import { uuidv7 } from '../uuid.js';
import { InMemoryTransferBackend } from './InMemoryTransferBackend.js';
import type { ObjectUploadJob, RecordLoadJob } from './types.js';

type OrderRow = ValueTypeOf<typeof SourcedOrderType>;

const { acme, birch } = LEDGER_ORDERS;

/** The part size the cases' uploads are planned with: small, so an upload is several parts. */
const PART_BYTES = 256;

/** Sends one part of an upload, as the local server's part route stages it: at its offset in the one staged file. */
async function stagePart(repoPath: string, id: string, part: number, bytes: Uint8Array): Promise<void> {
  await mkdir(transferStagingDir(repoPath), { recursive: true });
  const path = transferStagingPath(repoPath, id);
  await (await open(path, 'a')).close();
  const handle = await open(path, 'r+');
  try {
    await handle.write(bytes, 0, bytes.length, (part - 1) * PART_BYTES);
  } finally {
    await handle.close();
  }
}

/** A repository that holds the ledger's package, and what loads into it. */
interface LedgerRepo {
  readonly repoDir: string;
  readonly dir: string;
  readonly storage: StorageBackend;
  readonly runner: LocalTaskRunner;
  readonly ledger: LedgerWorkspaces;
}

/** The repository every case of this file loads into: made by the first that
 *  asks, and removed once all have run. */
let made: Promise<LedgerRepo> | undefined;
function ledgerRepo(): Promise<LedgerRepo> {
  made ??= (async () => {
    const repoDir = createTestRepo();
    const dir = createTempDir();
    const storage = new LocalStorage(dirname(repoDir));
    const runner = new LocalTaskRunner(repoDir);
    await e3.export(e3.package('ledger', '1.0.0', ledgerOrders()), join(dir, 'ledger.zip'));
    await packageImport(storage, repoDir, join(dir, 'ledger.zip'));
    return { repoDir, dir, storage, runner, ledger: ledgerWorkspaces(storage, repoDir, runner) };
  })();
  return made;
}

after(async () => {
  const repo = await made?.catch(() => undefined);
  if (repo === undefined) return;
  removeTestRepo(repo.repoDir);
  removeTempDir(repo.dir);
});

recordLoadStoreTests('the in-memory transfer backend', async () => {
  const { repoDir, storage, runner, ledger } = await ledgerRepo();
  const held = new GatedTaskRunner(runner);
  // The holds of the running work taken through the storage the store's jobs run over
  let working = 0;
  const locks = overriding(storage.locks, {
    acquire: async (...args: Parameters<StorageBackend['locks']['acquire']>) => {
      const handle = await storage.locks.acquire(...args);
      if (handle === null || args[1] !== TASKS_LOCK) return handle;
      working++;
      return overriding(handle, {
        release: async () => {
          working--;
          await handle.release();
        },
      });
    },
  });
  const counted = withStores(storage, { locks });
  const backend = new InMemoryTransferBackend({ storage: counted, getRepoPath: (name) => name, getRunner: () => held, partBytes: PART_BYTES });
  const workspace = await ledger.fresh();
  let delivered = 0;
  return {
    store: backend.recordLoad,
    loads: {
      storage: counted, repo: repoDir, workspace, record: 'orders', source: 'erp', runner: held,
      // An order no delivery before it holds
      deliver: () => storage.objects.write(repoDir, encodeInSegmentsOf(ErpDeliveryType, 2)(new Map([[`SO-${workspace}-${++delivered}`, acme]]))),
      working: () => Promise.resolve(working),
    },
  };
});

objectUploadStoreTests('the in-memory transfer backend', async () => {
  const repo = createTestRepo();
  const storage = new LocalStorage(dirname(repo));
  const backend = new InMemoryTransferBackend({ storage, getRepoPath: (name) => name, partBytes: PART_BYTES });
  return {
    store: backend.objectUpload,
    storage,
    repo,
    sendPart: (id, record, part, bytes) => stagePart(record.repo, id, part, bytes),
    teardown: async () => removeTestRepo(repo),
  };
});

describe('a load run as a job on the in-memory transfer backend', () => {
  let repoDir: string;
  let storage: StorageBackend;
  let runner: LocalTaskRunner;
  let ledger: LedgerWorkspaces;

  before(async () => {
    ({ repoDir, storage, runner, ledger } = await ledgerRepo());
  });

  const fresh = (): Promise<string> => ledger.fresh();
  /** A backend over the repository, whose jobs run on `by`. */
  const backendOn = (by: TaskRunner, over: StorageBackend = storage): InMemoryTransferBackend =>
    new InMemoryTransferBackend({ storage: over, getRepoPath: (name) => name, getRunner: () => by, partBytes: PART_BYTES });
  /** A delivery of some orders, as the object an upload stores. */
  const delivery = (rows: Array<[string, OrderRow]>): Uint8Array => encodeInSegmentsOf(ErpDeliveryType, 2)(new Map(rows));
  /** Files and dispatches a load job of `erp`. */
  const launch = async (backend: InMemoryTransferBackend, ws: string, hash: string, id = uuidv7()): Promise<string> => {
    const job: RecordLoadJob = {
      repo: repoDir, workspace: ws, record: 'orders', source: 'erp', delivery: hash, actor: 'ada@example.com', asOf: none, cancel: none,
      status: variant('processing', none), createdAt: new Date(),
    };
    await backend.recordLoad.create(id, job);
    await backend.recordLoad.execute(id, repoDir);
    return id;
  };
  /** A job once it has ended. */
  const ended = async (backend: InMemoryTransferBackend, id: string): Promise<RecordLoadJob> => {
    for (;;) {
      const job = await backend.recordLoad.get(id);
      if (job === null) assert.fail(`job ${id} is gone`);
      if (job.status.type !== 'processing') return job;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  /** The record's commits, newest first, by name and hash. */
  const history = async (ws: string) => (await recordHistory(storage, repoDir, ws, 'orders')).map(({ hash, commit }) => [commit.mutation, hash] as const);
  const asked = { by: some('ada@example.com'), at: new Date('2026-11-17T12:00:00Z') };

  it('ruling 37 — jobs of one source asked to run together run in the order they were filed, however long each takes to start', async () => {
    const ws = await fresh();
    // The first job asked takes longer to start than the second: its hold of the running work comes once the second has its own
    const secondHolds = gated<void>();
    let asks = 0;
    const locks = overriding(storage.locks, {
      acquire: async (...args: Parameters<StorageBackend['locks']['acquire']>) => {
        const ask = args[1] === TASKS_LOCK ? asks++ : -1;
        if (ask === 0) await secondHolds.opened;
        const handle = await storage.locks.acquire(...args);
        if (ask === 1) secondHolds.open();
        return handle;
      },
    });
    const backend = backendOn(runner, withStores(storage, { locks }));
    const file = async (rows: Array<[string, OrderRow]>): Promise<string> => {
      const id = uuidv7();
      await backend.recordLoad.create(id, {
        repo: repoDir, workspace: ws, record: 'orders', source: 'erp', delivery: await storage.objects.write(repoDir, delivery(rows)),
        actor: 'ada@example.com', asOf: none, cancel: none, status: variant('processing', none), createdAt: new Date(),
      });
      return id;
    };
    const [first, second] = [await file([['SO-3701', acme]]), await file([['SO-3702', birch]])];
    await Promise.all([backend.recordLoad.execute(first, repoDir), backend.recordLoad.execute(second, repoDir)]);

    const [one, two] = [await ended(backend, first), await ended(backend, second)];
    assert.deepEqual([one.status.type, two.status.type], ['completed', 'completed']);
    const commits = await history(ws);
    assert.ok(one.status.type === 'completed' && one.status.value.commit.type === 'some' && commits[1]![1] === one.status.value.commit.value,
      'the job filed first committed first');
    assert.ok(two.status.type === 'completed' && two.status.value.commit.type === 'some' && commits[0]![1] === two.status.value.commit.value);
  });

  it('ruling 37 — over a lock service that keeps no queue of its waiters the store\'s own order is the jobs\' order: a job says it waits, and asks for no turn, until the one filed before it has ended, and a request to cancel it reaches it there', async () => {
    const ws = await fresh();
    // The source's turn, asked of a lock service that says it keeps no queue
    let turnsAsked = 0;
    const locks = overriding(storage.locks, {
      queuesWaiters: false,
      acquire: (...args: Parameters<StorageBackend['locks']['acquire']>) => {
        if (args[1] === loadQueueLock(ws, 'orders', 'erp')) turnsAsked++;
        return storage.locks.acquire(...args);
      },
    });
    const held = new GatedTaskRunner(runner, ['orders.erp']);
    const backend = backendOn(held, withStores(storage, { locks }));
    const says = async (id: string): Promise<string | undefined> => {
      const status = (await backend.recordLoad.get(id))?.status;
      return status?.type === 'processing' && status.value.type === 'some' ? status.value.value.type : status?.type;
    };
    const first = await launch(backend, ws, await storage.objects.write(repoDir, delivery([['SO-3711', acme]])));
    await held.launched('orders.erp');
    const second = await launch(backend, ws, await storage.objects.write(repoDir, delivery([['SO-3712', birch]])));
    const third = await launch(backend, ws, await storage.objects.write(repoDir, delivery([['SO-3713', acme]])));
    assert.deepEqual([await says(second), await says(third)], ['queued', 'queued'], 'each said it waits as it was dispatched');
    assert.equal(turnsAsked, 1, 'only the job that runs has asked for its source\'s turn');

    await backend.recordLoad.cancel(second, asked);
    assert.equal((await ended(backend, second)).status.type, 'cancelled');
    assert.deepEqual([(await backend.recordLoad.get(first))?.status.type, await says(third), turnsAsked], ['processing', 'queued', 1],
      'the first still runs, and the third still waits for it');

    held.pass('orders.erp');
    held.release('orders.erp');
    const [one, three] = [await ended(backend, first), await ended(backend, third)];
    assert.ok(one.status.type === 'completed' && one.status.value.commit.type === 'some', `the first loaded: ${one.status.type}`);
    assert.ok(three.status.type === 'completed' && three.status.value.commit.type === 'some', `the third loaded: ${three.status.type}`);
    assert.deepEqual((await history(ws)).filter(([name]) => name === '$load:erp').map(([, hash]) => hash),
      [three.status.value.commit.value, one.status.value.commit.value], 'the third applied after the first, and the cancelled job loaded nothing');
  });

  it('R85 — a cancel asked while a job runs is recorded, and the job ends itself cancelled before its commit writes: nothing commits', async () => {
    const ws = await fresh();
    const gated = new GatedTaskRunner(runner, ['orders.erp']);
    const backend = backendOn(gated);
    const id = await launch(backend, ws, await storage.objects.write(repoDir, delivery([['SO-8501', acme]])));
    await gated.launched('orders.erp');
    const commits = await history(ws);
    const recorded = await backend.recordLoad.cancel(id, asked);
    assert.ok(recorded?.status.type === 'processing' && recorded.cancel.type === 'some', 'the request is recorded, and the job still runs');

    const job = await ended(backend, id);
    assert.equal(job.status.type, 'cancelled');
    assert.deepEqual(await history(ws), commits, 'nothing committed');
  });

  it('R85 — a cancel asked while the job\'s commit writes comes too late: the job ends completed, the request beside its end', async () => {
    const ws = await fresh();
    let id = '';
    let backend!: InMemoryTransferBackend;
    // The cancel is asked once the commit has written the record's ref, before the job hears of it
    const late = withStores(storage, {
      datasets: overriding(storage.datasets, {
        writeIf: async (...args: Parameters<StorageBackend['datasets']['writeIf']>) => {
          const written = await storage.datasets.writeIf(...args);
          if (args[2] === 'records/orders') await backend.recordLoad.cancel(id, asked);
          return written;
        },
      }),
    });
    backend = backendOn(runner, late);
    id = uuidv7();
    await launch(backend, ws, await storage.objects.write(repoDir, delivery([['SO-8502', birch]])), id);

    const job = await ended(backend, id);
    assert.equal(job.status.type, 'completed', 'its commit has landed');
    assert.equal(job.cancel.type, 'some', 'the request was recorded, too late');
    assert.equal((await history(ws))[0]![0], '$load:erp');
  });

  it('R85 — a job asked to cancel before it starts ends cancelled, though its delivery was never uploaded: it reads nothing', async () => {
    const ws = await fresh();
    const backend = backendOn(runner);
    const id = uuidv7();
    const job: RecordLoadJob = {
      repo: repoDir, workspace: ws, record: 'orders', source: 'erp', delivery: 'd'.repeat(64), actor: 'ada@example.com', asOf: none,
      cancel: some(asked), status: variant('processing', none), createdAt: new Date(),
    };
    await backend.recordLoad.create(id, job);
    await backend.recordLoad.execute(id, repoDir);
    assert.equal((await ended(backend, id)).status.type, 'cancelled', 'not failed for a delivery it never looked for');
  });

  it('a job whose commit has written ends completed though its store fails the write of its end: the end is written again, and the job never ends failed', async () => {
    const ws = await fresh();
    const backend = backendOn(runner);
    const update = backend.recordLoad.updateStatus.bind(backend.recordLoad);
    const written: string[] = [];
    let ends = 0;
    backend.recordLoad.updateStatus = async (id, status) => {
      if (status.type === 'completed' && ends++ === 0) throw new Error('the store is throttling');
      written.push(status.type);
      return update(id, status);
    };

    const job = await ended(backend, await launch(backend, ws, await storage.objects.write(repoDir, delivery([['SO-0801', acme]]))));
    assert.equal(job.status.type, 'completed');
    assert.deepEqual([ends, written.includes('failed')], [2, false], 'its end was written again, and it was never written failed');
    assert.equal((await history(ws))[0]![0], '$load:erp', 'the record holds the delivery');
  });

  it('a job whose hold of the running work fails to let go still leaves its source\'s turn, and one whose store fails the write that says it waits still waits its turn: each loads, gc is not refused after them, and no rejection goes unhandled', async () => {
    const ws = await fresh();
    const unhandled: unknown[] = [];
    const note = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', note);
    try {
      // The first job's own hold of the running work lets go, and then says it failed to, as a lock service over a network can
      let asks = 0;
      const locks = overriding(storage.locks, {
        acquire: async (...args: Parameters<StorageBackend['locks']['acquire']>) => {
          const handle = await storage.locks.acquire(...args);
          if (handle === null || args[1] !== TASKS_LOCK || asks++ !== 0) return handle;
          return overriding(handle, {
            release: async () => {
              await handle.release();
              throw new Error('the lock service did not answer');
            },
          });
        },
      });
      const held = new GatedTaskRunner(runner, ['orders.erp']);
      const backend = backendOn(held, withStores(storage, { locks }));
      const first = await launch(backend, ws, await storage.objects.write(repoDir, delivery([['SO-1101', acme]])));
      await held.launched('orders.erp');

      // A second job of the source is dispatched while the first runs, and its store fails the write that says it waits
      const update = backend.recordLoad.updateStatus.bind(backend.recordLoad);
      backend.recordLoad.updateStatus = async (id, status) => {
        if (status.type === 'processing' && status.value.type === 'some' && status.value.value.type === 'queued') throw new Error('the store is throttling');
        return update(id, status);
      };
      const second = await launch(backend, ws, await storage.objects.write(repoDir, delivery([['SO-1102', birch]])));

      held.pass('orders.erp');
      held.release('orders.erp');
      assert.equal((await ended(backend, first)).status.type, 'completed');
      // The first left its source's turn, and the second waited for it all the same: it loads
      const waited = await Promise.race([ended(backend, second), new Promise<null>((resolve) => { setTimeout(() => resolve(null), 10_000).unref(); })]);
      assert.equal(waited?.status.type, 'completed', 'the second ran once the first had left its turn');
      backend.recordLoad.updateStatus = update;

      // Both jobs have let the running work go: a garbage collection takes the repository
      const gc = await storage.locks.acquire(repoDir, TASKS_LOCK, variant('dataflow', null), { wait: true, timeout: 5_000 });
      assert.ok(gc !== null, 'no job holds the running work');
      await gc.release();
      await new Promise((resolve) => { setImmediate(resolve); });
      assert.deepEqual(unhandled, [], 'the failed release was handled');
    } finally {
      process.off('unhandledRejection', note);
    }
  });

  it('R21 — a file uploaded as an object, writing no ref, is loaded by its hash', async () => {
    const ws = await fresh();
    const backend = backendOn(runner);
    const bytes = delivery([['SO-2101', acme], ['SO-2102', birch]]);
    const upload: ObjectUploadJob = { repo: repoDir, workspace: ws, hash: computeHash(bytes), size: BigInt(bytes.length) };
    const uploadId = uuidv7();
    await backend.objectUpload.create(uploadId, upload);
    const partBytes = Number(await backend.objectUpload.createParts(uploadId, upload));
    for (let part = 1; (part - 1) * partBytes < bytes.length; part++) {
      await stagePart(repoDir, uploadId, part, bytes.subarray((part - 1) * partBytes, part * partBytes));
    }
    assert.equal((await backend.objectUpload.commit(uploadId, upload)).type, 'completed');

    const job = await ended(backend, await launch(backend, ws, upload.hash));
    assert.ok(job.status.type === 'completed' && job.status.value.outcome.type === 'loaded' && job.status.value.set === 2n,
      `the load of the uploaded delivery: ${job.status.type}`);
  });
});
