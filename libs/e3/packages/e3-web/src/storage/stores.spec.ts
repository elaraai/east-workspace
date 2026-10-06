/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3-web's stores held to every contract suite a backend runs, in Node over
 * the adapters in memory — which answer as IndexedDB, OPFS and Web Locks do,
 * and which a page opened with `persist: false` keeps its repositories in —
 * and the machine's files, which the suites name.
 *
 * Over `WebStorage`: the object, ref, dataset-ref, lock and log stores, the
 * repository store, the repository record, gc, the execution cache, the
 * workspace status, a deploy's inputs and a workspace's copy. Over
 * `WebStateStore`: the execution state store. Over
 * both: the dataflow loop. Then what is `WebStorage`'s own, which no contract
 * suite reaches: what its sweep takes of writes and deletes that never
 * finished, its catalogue's scan, a lock's state that a closed tab left, a
 * log read from the chunks its window covers, and a persisted storage refused
 * where the browser APIs it needs are missing. The browser's own adapters are
 * held to the adapters' contract in Chromium, where a repository written
 * through these stores is read again after a reload
 * (`../browser/storage.spec.ts`).
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { equalFor, variant } from '@elaraai/east';
import { LockProgressType, type LockProgress } from '@elaraai/e3-types';
import { computeHash, uuidv7 } from '@elaraai/e3-core/portable';
import {
  dataflowTests,
  datasetRefStoreTests,
  executionCacheTests,
  executionStateStoreTests,
  gcTests,
  lockServiceTests,
  logStoreTests,
  objectStoreTests,
  refStoreTests,
  repoStoreTests,
  repositoryRecordTests,
  workspaceCopyTests,
  workspaceDeployTests,
  workspaceStatusTests,
  type BackendSetup,
  type RepositoriesSetup,
} from '@elaraai/e3-core/test';
import type {
  BlobKey,
  BlobsAdapter,
  ByteSource,
  RecordEntry,
  RecordKey,
  RecordScan,
  RecordsAdapter,
  RecordsTransaction,
} from './adapters.js';
import { MemoryBlobs, MemoryLockSpace, MemoryRecordStore, openMemoryRecords } from './memory.js';
import { NodeFiles } from './node-files.js';
import { WebStateStore } from './WebStateStore.js';
import { WebStorage, openWebStorage, recordKeys } from './WebStorage.js';

/** The repository each case's backend is created with. */
const REPO = 'default';
const TASK = 'a'.repeat(64);
const INPUTS = 'b'.repeat(64);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Opens storages over one origin's adapters in memory — one records store,
 * one blob store and one lock space — each a tab of its own, with a session
 * of its own, and closed once the test ends.
 */
function origin(t: TestContext, blobs: BlobsAdapter = new MemoryBlobs()): () => Promise<WebStorage> {
  const store = new MemoryRecordStore();
  const space = new MemoryLockSpace();
  return async () => {
    const storage = new WebStorage({ records: openMemoryRecords(store), blobs, locks: await space.open(), files: new NodeFiles() });
    t.after(() => storage.close());
    return storage;
  };
}

/** A backend with a repository in it, its runs' state kept beside it, and its
 *  execution records left, when a case asks, in bytes of its choosing: bytes
 *  that do not decode, or a record in an earlier release's form. */
const backend: BackendSetup = async (t) => {
  const storage = await origin(t)();
  await storage.repos.create(REPO);
  const { records } = storage.adapters;
  return {
    storage,
    repo: REPO,
    stateStore: new WebStateStore(records),
    damage: {
      execution: (taskHash, inputsHash, executionId, bytes) => records.transact((tx) => {
        tx.put(recordKeys.execution(REPO, taskHash, inputsHash, executionId), bytes ?? encoder.encode('not a record'));
        return Promise.resolve();
      }),
    },
  };
};

/** A backend with no repository yet, whose stores name a repository as its
 *  lifecycle does. */
const repositories: RepositoriesSetup = async (t) => ({ storage: await origin(t)(), repoOf: (name) => name });

describe('WebStorage over the adapters in memory', () => {
  objectStoreTests(backend);
  refStoreTests(backend);
  datasetRefStoreTests(backend);
  lockServiceTests(backend);
  logStoreTests(backend);
  repoStoreTests(repositories);
  repositoryRecordTests(backend);
  gcTests(backend);
  executionCacheTests(backend);
  workspaceStatusTests(backend);
  workspaceDeployTests(backend);
  workspaceCopyTests(backend);
  dataflowTests(backend);
});

describe('WebStateStore over records in memory', () => {
  executionStateStoreTests(() => Promise.resolve({ store: new WebStateStore(openMemoryRecords()), repo: REPO }));
});

/**
 * Blobs in memory whose writes wait at a gate until it opens: what holds a
 * write of an object in flight, between its record in flight and its blob.
 */
class GatedBlobs extends MemoryBlobs {
  private letThrough!: () => void;
  private readonly opened = new Promise<void>((resolve) => {
    this.letThrough = resolve;
  });
  /** How many writes have reached the gate */
  private arrived = 0;
  /** What settles once as many writes have reached the gate, by how many */
  private readonly arrivals = new Map<number, () => void>();

  /** Settles once `count` writes have reached the gate. */
  reached(count: number): Promise<void> {
    if (this.arrived >= count) return Promise.resolve();
    return new Promise((resolve) => this.arrivals.set(count, resolve));
  }

  /** Lets every write at the gate through, and every one after it. */
  open(): void {
    this.letThrough();
  }

  override async write(key: BlobKey, data: ByteSource): Promise<number> {
    this.arrived++;
    this.arrivals.get(this.arrived)?.();
    await this.opened;
    return super.write(key, data);
  }
}

/**
 * Records that count the records their reads return, in a transaction or
 * outside one: how much of the store an operation touches.
 */
class CountingRecords implements RecordsAdapter {
  /** The records the reads have returned */
  returned = 0;

  /**
   * @param inner - The records counted
   */
  constructor(private readonly inner: RecordsAdapter) {}

  /** Counts what a read returned, and returns it. */
  private counted<T>(found: T, count: number): T {
    this.returned += count;
    return found;
  }

  async get(key: RecordKey): Promise<Uint8Array | null> {
    const value = await this.inner.get(key);
    return this.counted(value, value === null ? 0 : 1);
  }

  async scan(prefix: RecordKey, options?: RecordScan): Promise<RecordEntry[]> {
    const found = await this.inner.scan(prefix, options);
    return this.counted(found, found.length);
  }

  async keys(prefix: RecordKey, options?: RecordScan): Promise<RecordKey[]> {
    const found = await this.inner.keys(prefix, options);
    return this.counted(found, found.length);
  }

  transact<T>(work: (tx: RecordsTransaction) => Promise<T>): Promise<T> {
    return this.inner.transact((tx) => work({
      get: async (key) => {
        const value = await tx.get(key);
        return this.counted(value, value === null ? 0 : 1);
      },
      scan: async (prefix, options) => {
        const found = await tx.scan(prefix, options);
        return this.counted(found, found.length);
      },
      keys: async (prefix, options) => {
        const found = await tx.keys(prefix, options);
        return this.counted(found, found.length);
      },
      put: (key, value) => tx.put(key, value),
      delete: (key) => tx.delete(key),
      deletePrefix: (prefix) => tx.deletePrefix(prefix),
    }));
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

/** What a deploy holding a lock reports. */
const PROGRESS: LockProgress = variant('deployment', {
  package: { name: 'pkg', version: '1.0.0' },
  startedAt: new Date('2026-10-01T00:00:00.000Z'),
  files: [],
  records: [],
});

describe('what WebStorage keeps beside its objects and records', () => {
  /** Sweeps the repository as gc does last, beside running work. */
  const sweep = (storage: WebStorage, minAge: number, dryRun: boolean) =>
    storage.repos.gcSweepBackend(REPO, new Set(), { minAge, dryRun, held: false });

  it('takes a write in flight past the age gate for abandoned, failing the write, and leaves one younger', async (t) => {
    const blobs = new GatedBlobs();
    const storage = await origin(t, blobs)();
    await storage.repos.create(REPO);
    const bytes = encoder.encode('a write in flight');
    const writing = storage.objects.write(REPO, bytes);
    await blobs.reached(1);
    const inFlight = () => storage.adapters.records.keys(recordKeys.kind(REPO, 'pending'));

    assert.deepEqual(await sweep(storage, 60_000, false), { deletedPartials: 0, skippedYoung: 1 }, 'younger than the age gate: left');
    assert.deepEqual(await sweep(storage, 0, true), { deletedPartials: 1, skippedYoung: 0 }, 'a dry run counts it');
    assert.equal((await inFlight()).length, 1, 'and takes nothing');
    assert.deepEqual(await sweep(storage, 0, false), { deletedPartials: 1, skippedYoung: 0 });
    assert.deepEqual(await inFlight(), []);

    blobs.open();
    await assert.rejects(writing, /taken for abandoned by gc's sweep/);
    assert.equal(await storage.objects.exists(REPO, computeHash(bytes)), false, 'the write stored nothing');
    // The blob it wrote after the sweep had taken it names nothing.
    assert.deepEqual(await sweep(storage, 0, false), { deletedPartials: 1, skippedYoung: 0 });
    assert.deepEqual(await blobs.list([REPO]), []);
    assert.deepEqual(await sweep(storage, 0, false), { deletedPartials: 0, skippedYoung: 0 }, 'nothing is left to take');
  });

  it('takes a blob nothing names, as a delete cut short between an entry and its blob leaves one, whatever its age', async (t) => {
    const blobs = new MemoryBlobs();
    const storage = await origin(t, blobs)();
    await storage.repos.create(REPO);
    const kept = await storage.objects.write(REPO, encoder.encode('kept'));
    const cut = await storage.objects.write(REPO, encoder.encode('cut short'));
    // A delete that took the entry, and never reached the blob
    await storage.adapters.records.transact((tx) => {
      tx.delete(recordKeys.object(REPO, cut));
      return Promise.resolve();
    });
    assert.equal((await blobs.list([REPO])).length, 2);

    assert.deepEqual(await sweep(storage, 60_000, true), { deletedPartials: 1, skippedYoung: 0 }, 'a dry run counts it');
    assert.equal((await blobs.list([REPO])).length, 2, 'and takes nothing');
    assert.deepEqual(await sweep(storage, 60_000, false), { deletedPartials: 1, skippedYoung: 0 });
    assert.equal((await blobs.list([REPO])).length, 1);
    assert.equal(decoder.decode(await storage.objects.read(REPO, kept)), 'kept', 'a blob an entry names stays');
  });

  it('scans its catalogue for gc a thousand objects at a time, listing each object once', async (t) => {
    const storage = await origin(t)();
    await storage.repos.create(REPO);
    const written = new Set<string>();
    for (let i = 0; i < 1001; i++) written.add(await storage.objects.write(REPO, encoder.encode(`object ${i}`)));

    const first = await storage.repos.gcScanObjects(REPO);
    assert.equal(first.objects.length, 1000);
    assert.ok(first.cursor !== undefined, 'a page that is not the last names the next');
    const second = await storage.repos.gcScanObjects(REPO, first.cursor);
    assert.equal(second.objects.length, 1);
    assert.equal(second.cursor, undefined, 'the last page names none');
    assert.deepEqual(new Set([...first.objects, ...second.objects].map(({ hash }) => hash)), written);
  });

  it('answers none for the record of an upgrade under way that does not decode, so the step under way starts again', async (t) => {
    const storage = await origin(t)();
    await storage.repos.create(REPO);
    await storage.refs.repositoryUpgradeWrite(REPO, { step: 'a-step', release: '1.0.0', cursor: 'here' });
    await storage.adapters.records.transact((tx) => {
      tx.put(recordKeys.upgrade(REPO), encoder.encode('not a record'));
      return Promise.resolve();
    });

    assert.equal(await storage.refs.repositoryUpgradeRead(REPO), null);
  });

  it('keeps one blob of the bytes two writes store at once', async (t) => {
    const blobs = new GatedBlobs();
    const storage = await origin(t, blobs)();
    await storage.repos.create(REPO);
    const bytes = encoder.encode('written twice at once');
    const writes = [storage.objects.write(REPO, bytes), storage.objects.write(REPO, bytes)];
    await blobs.reached(2);
    blobs.open();

    assert.deepEqual(await Promise.all(writes), [computeHash(bytes), computeHash(bytes)]);
    assert.equal((await blobs.list([REPO])).length, 1, 'the write the other beat to the catalogue let its blob go');
    assert.equal(decoder.decode(await storage.objects.read(REPO, computeHash(bytes))), 'written twice at once');
    assert.deepEqual(await sweep(storage, 0, false), { deletedPartials: 0, skippedYoung: 0 });
  });

  it('takes the state a tab left that closed holding a lock for no one\'s, and lets another tab hold the lock', async (t) => {
    const open = origin(t);
    const [first, second] = [await open(), await open()];
    await first.repos.create(REPO);
    const held = await first.locks.acquire(REPO, 'main', variant('deployment', null));
    assert.ok(held !== null);
    await held.report(PROGRESS);
    const state = await second.locks.getState(REPO, 'main');
    assert.ok(state?.holder.type === 'process' && state.holder.value.bootId === first.adapters.locks.session, 'the other tab sees the holder');
    const progress = await second.locks.getProgress(REPO, 'main');
    assert.ok(progress !== null && equalFor(LockProgressType)(progress, PROGRESS), 'and what it reported');

    // The first tab closes holding the lock: its session ends, and its state
    // is left.
    await first.adapters.locks.close();
    assert.equal(await second.locks.isHolderAlive(state.holder), false);
    assert.equal(await second.locks.getState(REPO, 'main'), null);
    assert.equal(await second.locks.getProgress(REPO, 'main'), null);
    assert.notEqual(await second.adapters.records.get(recordKeys.lock(REPO, 'main')), null, 'its state is left');

    const taken = await second.locks.acquire(REPO, 'main', variant('deployment', null));
    assert.ok(taken !== null, 'the other tab takes the lock');
    const own = await second.locks.getState(REPO, 'main');
    assert.ok(own?.holder.type === 'process' && own.holder.value.bootId === second.adapters.locks.session, 'its state names the other tab');
    assert.equal(await second.locks.getProgress(REPO, 'main'), null, 'which has reported nothing');
    await taken.release();
    assert.equal(await second.adapters.records.get(recordKeys.lock(REPO, 'main')), null, 'a release takes its own state away');
  });

  it('reads a window of a long log from the few chunks that hold it, not from every chunk of the log', async (t) => {
    const records = new CountingRecords(openMemoryRecords());
    const storage = new WebStorage({ records, blobs: new MemoryBlobs(), locks: await new MemoryLockSpace().open(), files: new NodeFiles() });
    t.after(() => storage.close());
    await storage.repos.create(REPO);
    const id = uuidv7();
    // A chatty unit: a thousand appends of ten bytes each
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${String(i).padStart(4, '0')}\n`);
    for (const line of lines) await storage.logs.append(REPO, TASK, INPUTS, id, 'stdout', line);

    records.returned = 0;
    const tail = await storage.logs.read(REPO, TASK, INPUTS, id, 'stdout', { offset: 9_985, limit: 10 });
    assert.deepEqual(tail, { data: '0998\nline ', offset: 9_985, size: 10, totalSize: 10_000, complete: false });
    assert.ok(records.returned <= 3, `a window near the end was cut from ${records.returned} records: the last, and the two it spans`);

    records.returned = 0;
    assert.equal((await storage.logs.read(REPO, TASK, INPUTS, id, 'stdout', { offset: 0, limit: 0 })).totalSize, 10_000);
    assert.ok(records.returned <= 1, `the log's size was read from ${records.returned} records: its last`);

    const whole = await storage.logs.read(REPO, TASK, INPUTS, id, 'stdout');
    assert.deepEqual(whole, { data: lines.join(''), offset: 0, size: 10_000, totalSize: 10_000, complete: true }, 'a window of every chunk');
  });
});

describe('openWebStorage', () => {
  it('refuses to persist repositories where IndexedDB is missing, as in Node, naming it, and keeps them in memory with persist: false', async () => {
    await assert.rejects(openWebStorage({ name: 'refused' }), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /it has no IndexedDB /);
      assert.match(err.message, /persist: false to keep repositories in memory/);
      return true;
    });

    const storage = await openWebStorage({ persist: false });
    try {
      await storage.repos.create(REPO);
      assert.deepEqual(await storage.repos.list(), [REPO]);
    } finally {
      await storage.close();
    }
  });
});
