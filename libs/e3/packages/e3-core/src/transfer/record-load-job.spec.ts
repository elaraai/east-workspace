/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The local server's load jobs and object uploads (§7.11, ruling 28): the
 * stores' contracts over the in-memory transfer backend, and a load run as a
 * job — one source's jobs in the order made, a cancel that asks and a job
 * that ends itself, and a delivery uploaded as an object and loaded by its
 * hash. Each case is titled by the requirement of the design it checks.
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

recordLoadStoreTests('the in-memory transfer backend', async () => ({ store: new InMemoryTransferBackend({}).recordLoad }));

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
  let dir: string;
  let storage: StorageBackend;
  let runner: LocalTaskRunner;
  let ledger: LedgerWorkspaces;

  before(async () => {
    repoDir = createTestRepo();
    dir = createTempDir();
    storage = new LocalStorage(dirname(repoDir));
    runner = new LocalTaskRunner(repoDir);
    ledger = ledgerWorkspaces(storage, repoDir, runner);
    await e3.export(e3.package('ledger', '1.0.0', ledgerOrders()), join(dir, 'ledger.zip'));
    await packageImport(storage, repoDir, join(dir, 'ledger.zip'));
  });

  after(() => {
    removeTestRepo(repoDir);
    removeTempDir(dir);
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

  it('R14 — two jobs of one source run in the order they were made: the second says it waits, and commits after the first', async () => {
    const ws = await fresh();
    const gated = new GatedTaskRunner(runner, ['orders.erp']);
    const backend = backendOn(gated);
    const first = await launch(backend, ws, await storage.objects.write(repoDir, delivery([['SO-1401', acme]])));
    await gated.launched('orders.erp');
    const second = await launch(backend, ws, await storage.objects.write(repoDir, delivery([['SO-1402', birch]])));
    const waiting = await backend.recordLoad.get(second);
    assert.ok(waiting?.status.type === 'processing' && waiting.status.value.type === 'some' && waiting.status.value.value.type === 'queued',
      'the second says it waits for an earlier load of its source');

    gated.pass('orders.erp');
    gated.release('orders.erp');
    const [one, two] = [await ended(backend, first), await ended(backend, second)];
    assert.deepEqual([one.status.type, two.status.type], ['completed', 'completed']);
    const commits = await history(ws);
    assert.deepEqual(commits.slice(0, 2).map(([name]) => name), ['$load:erp', '$load:erp']);
    assert.ok(one.status.type === 'completed' && one.status.value.commit.type === 'some' && commits[1]![1] === one.status.value.commit.value,
      'the first committed first');
  });

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

  it('a job dispatched while a garbage collection holds the repository fails, naming it: a job holds the repository\'s running work from its dispatch', async () => {
    const ws = await fresh();
    const backend = backendOn(runner);
    const gc = await storage.locks.acquire(repoDir, TASKS_LOCK, variant('dataflow', null));
    assert.ok(gc !== null);
    try {
      const job = await ended(backend, await launch(backend, ws, await storage.objects.write(repoDir, delivery([['SO-6902', acme]]))));
      assert.ok(job.status.type === 'failed' && job.status.value.message.includes('a garbage collection or an upgrade holds this repository'),
        `it failed, naming gc: ${job.status.type}`);
    } finally {
      await gc.release();
    }
  });
});
