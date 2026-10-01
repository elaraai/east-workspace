/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `WebTransferBackend` in Node, over the memory adapters: its jobs and
 * commits as the routes start them, as tabs over one origin share them — an
 * export written a round at a time and holding its workspace across its
 * rounds, and refused, naming the holder, while another holds the workspace;
 * what a closed tab left, recorded failed and never run again, and
 * what a live one runs, left to it; a job or a commit asked for twice at once,
 * run once; what a transfer staged, swept by gc and forgotten past its
 * retention; and gc as a job. Every store and its byte endpoints run under the
 * shared API suites too, in `libs/e3/test/integration`'s
 * `web-compliance.spec.ts` and in Chromium.
 */

import { afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StringType, encodeBeast2For, equalFor, none, some, variant } from '@elaraai/east';
import { LockStateType } from '@elaraai/e3-types';
import {
  WorkspaceLockError,
  computeHash,
  lockStateToHolderInfo,
  repoGc,
  workspaceCreate,
  workspaceDeploy,
  workspaceGetDataset,
  workspaceSetDataset,
  type DatasetUpload,
} from '@elaraai/e3-core/portable';
import { AdapterClosedError, type BlobKey, type BlobsAdapter, type ByteSource, type RecordKey } from '../storage/adapters.js';
import { MemoryBlobs, MemoryFiles, MemoryLockSpace, MemoryRecordStore, openMemoryRecords, type MemoryLocks } from '../storage/memory.js';
import { WebStorage } from '../storage/WebStorage.js';
import { UnitPool } from '../execution/pool.js';
import { inProcessUnits } from '../execution/in-process.js';
import { WebTaskRunner } from '../execution/WebTaskRunner.js';
import { FIXTURE_VERSION, HELD_PACKAGE, PLATFORM_PACKAGE, buildE3Fixtures } from '../testing/e3-fixtures.js';
import { WebTransferBackend, type WebTransferBackendOptions } from './WebTransferBackend.js';

const REPO = 'default';
const WORKSPACE = 'main';
const REPO_PATH = [variant('field', 'inputs'), variant('field', 'repo')];

/** Whether two states of a lock are one: one holder's, taken at one time for
 *  one operation. */
const sameLockState = equalFor(LockStateType);

/** What the tabs of one origin share: its records, blobs, files and locks. */
interface Origin {
  readonly records: MemoryRecordStore;
  readonly blobs: MemoryBlobs;
  readonly files: MemoryFiles;
  readonly locks: MemoryLockSpace;
}

/** A tab: its session, its storage over the origin's adapters, and its
 *  transfer backend. */
interface Tab {
  readonly session: MemoryLocks;
  readonly storage: WebStorage;
  readonly transfer: WebTransferBackend;
  /** Closes the tab, as a browser closes one: its session ends, and it
   *  reads and writes nothing more. */
  close(): Promise<void>;
}

/** The tabs a test opened, closed once it has run. */
const opened: Tab[] = [];

function newOrigin(): Origin {
  return { records: new MemoryRecordStore(), blobs: new MemoryBlobs(), files: new MemoryFiles(), locks: new MemoryLockSpace() };
}

/** A tab's blobs: the origin's, refused once the tab has closed, as a closed
 *  tab's code runs no more. */
function untilClosed(blobs: BlobsAdapter, closed: () => boolean): BlobsAdapter {
  return new Proxy(blobs, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]): unknown => {
        if (closed()) return Promise.reject(new AdapterClosedError('blobs'));
        return (value as (...each: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

/**
 * Opens a tab over an origin's adapters.
 *
 * @param origin - The origin
 * @param options - The backend's part and round sizes and its retention
 * @param blobs - The blobs the tab reads and writes through: the origin's
 *   unless given
 */
async function openTab(origin: Origin, options: Partial<WebTransferBackendOptions> = {}, blobs: BlobsAdapter = origin.blobs): Promise<Tab> {
  const session = await origin.locks.open();
  const records = openMemoryRecords(origin.records);
  let closed = false;
  const storage = new WebStorage({ records, blobs: untilClosed(blobs, () => closed), locks: session, files: origin.files });
  const pool = new UnitPool({ units: inProcessUnits(), width: 2 });
  const runner = new WebTaskRunner({ repo: REPO, pool, locks: session });
  const transfer = new WebTransferBackend({ storage, getRunner: () => runner, ...options });
  const tab: Tab = {
    session,
    storage,
    transfer,
    close: async () => {
      if (closed) return;
      closed = true;
      await transfer.close();
      pool.close();
      await session.close();
      await records.close();
    },
  };
  opened.push(tab);
  return tab;
}

/** What a tab's blobs do as they are read and written: told first, and held
 *  there for as long as the hook's answer takes. */
interface BlobHooks {
  read?(key: BlobKey): Promise<void> | void;
  readRange?(key: BlobKey): Promise<void> | void;
  write?(key: BlobKey): Promise<void> | void;
}

/** The origin's blobs, each read and write told to a hook first. */
function watched(blobs: BlobsAdapter, hooks: BlobHooks): BlobsAdapter {
  return new Proxy(blobs, {
    get(target, property) {
      if (property === 'write' && hooks.write !== undefined) {
        const hook = hooks.write;
        return async (key: BlobKey, data: ByteSource): Promise<number> => {
          await hook(key);
          return target.write(key, data);
        };
      }
      if (property === 'read' && hooks.read !== undefined) {
        const hook = hooks.read;
        return async (key: BlobKey): Promise<Uint8Array | null> => {
          await hook(key);
          return target.read(key);
        };
      }
      if (property === 'readRange' && hooks.readRange !== undefined) {
        const hook = hooks.readRange;
        return async (key: BlobKey, offset: number, length: number): Promise<Uint8Array | null> => {
          await hook(key);
          return target.readRange(key, offset, length);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** A promise that never settles: a tab that closes while it waits on it. */
function never(): Promise<void> {
  return new Promise<void>(() => undefined);
}

/** Whether a blob key is one of an export's rounds, and which. */
function exportRound(key: BlobKey): number | null {
  const match = /^export-(\d+)$/.exec(key[key.length - 1] ?? '');
  return match === null ? null : Number(match[1]);
}

/** Whether a blob key is a staged upload's part. */
function isPart(key: BlobKey): boolean {
  return /^part-\d+$/.test(key[key.length - 1] ?? '');
}

/** Waits for a condition, failing with what it waits for after `ms`. */
async function until<T>(read: () => Promise<T | null>, what: string, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = await read();
    if (found !== null) return found;
    if (Date.now() > deadline) assert.fail(`waited ${ms / 1000} s for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** What a transfer staged in the origin's blobs. */
function stagedBy(origin: Origin, id: string): Promise<BlobKey[]> {
  return origin.blobs.list([REPO, 'transfer', id]).then((blobs) => blobs.map(({ key }) => key));
}

/** Stages an import's zip and starts the import, as the routes do. */
async function startImport(tab: Tab, zip: Uint8Array): Promise<string> {
  const id = crypto.randomUUID();
  await tab.transfer.packageImport.create(id, { repo: REPO, size: BigInt(zip.byteLength), status: variant('created', null), createdAt: new Date() });
  await tab.transfer.packageImport.stageZip(id, REPO, zip);
  await tab.transfer.packageImport.execute(id, REPO);
  return id;
}

/** Waits for an import to end, and answers how it ended. */
async function importEnded(tab: Tab, id: string): Promise<string> {
  const job = await until(async () => {
    const found = await tab.transfer.packageImport.get(id);
    return found === null || found.status.type === 'completed' || found.status.type === 'failed' ? found : null;
  }, 'the import to end');
  return job === null ? 'gone' : job.status.type;
}

/** Imports a package's zip through a tab's import job. */
async function importPackage(tab: Tab, zip: Uint8Array): Promise<void> {
  assert.equal(await importEnded(tab, await startImport(tab, zip)), 'completed', 'the package imported');
}

/** Starts an export of a package, or of a workspace as a package, as the
 *  routes do. */
async function startExport(tab: Tab, workspace?: string): Promise<string> {
  const id = crypto.randomUUID();
  await tab.transfer.packageExport.create(id, {
    repo: REPO,
    name: workspace === undefined ? HELD_PACKAGE : 'exported-workspace',
    version: FIXTURE_VERSION,
    workspace: workspace === undefined ? none : some(workspace),
    status: variant('processing', variant('pending', null)),
    createdAt: new Date(),
  });
  await tab.transfer.packageExport.execute(id, REPO);
  return id;
}

/** Waits for an export to end, and answers how it ended. */
async function exportEnded(tab: Tab, id: string): Promise<{ readonly status: string; readonly message: string }> {
  const job = await until(async () => {
    const found = await tab.transfer.packageExport.get(id);
    return found === null || found.status.type !== 'processing' ? found : null;
  }, 'the export to end');
  if (job === null) return { status: 'gone', message: '' };
  return { status: job.status.type, message: job.status.type === 'failed' ? job.status.value.message : '' };
}

/** Waits for an export to end, and answers its zip. */
async function exportedZip(tab: Tab, id: string): Promise<Uint8Array> {
  const ended = await exportEnded(tab, id);
  assert.equal(ended.status, 'completed', `the export completed: ${ended.message}`);
  const zip = await tab.transfer.packageExport.zipOf(id);
  assert.ok(zip !== null, 'a completed export has its zip');
  return zip;
}

/** A repository with the platform package deployed to its workspace, whose
 *  input `repo` an upload sets. */
async function deployed(tab: Tab, zip: Uint8Array): Promise<void> {
  await tab.storage.repos.create(REPO);
  await importPackage(tab, zip);
  await workspaceCreate(tab.storage, REPO, WORKSPACE);
  await workspaceDeploy(tab.storage, REPO, WORKSPACE, PLATFORM_PACKAGE, FIXTURE_VERSION);
}

/** An upload of a string to the workspace's input `repo`, planned and staged
 *  in one part. */
async function stagedUpload(tab: Tab, text: string): Promise<{ readonly id: string; readonly upload: DatasetUpload }> {
  const bytes = encodeBeast2For(StringType)(text);
  const id = crypto.randomUUID();
  const upload: DatasetUpload = { repo: REPO, workspace: WORKSPACE, path: 'inputs/repo', hash: computeHash(bytes), size: BigInt(bytes.byteLength) };
  await tab.transfer.datasetUpload.create(id, upload);
  await tab.transfer.datasetUpload.createParts(id, upload);
  await tab.transfer.datasetUpload.stagePart(id, REPO, 1, bytes);
  return { id, upload };
}

/** A commit's status, as a poll reads it. */
async function commitStatus(tab: Tab, id: string): Promise<{ readonly status: string; readonly message: string }> {
  const status = await tab.transfer.datasetUpload.getCommitStatus(id);
  if (status === null) return { status: 'none', message: '' };
  return { status: status.type, message: status.type === 'failed' ? status.value.message : '' };
}

describe('WebTransferBackend', () => {
  let fixtures: Awaited<ReturnType<typeof buildE3Fixtures>>;

  before(async () => {
    fixtures = await buildE3Fixtures();
  });

  afterEach(async () => {
    for (const tab of opened.splice(0)) await tab.close();
  });

  it('writes an export a round at a time, each resuming from the last one\'s checkpoint, into the zip one round writes', async () => {
    const origin = newOrigin();
    const whole = await openTab(origin);
    await whole.storage.repos.create(REPO);
    await importPackage(whole, fixtures.held);
    const once = await exportedZip(whole, await startExport(whole));

    const rounds = await openTab(origin, { exportRoundBytes: 512 });
    const id = await startExport(rounds);
    const zip = await exportedZip(rounds, id);
    const progress = await rounds.transfer.packageExport.progressOf(id);
    assert.ok(progress !== null && progress.rounds > 2, `the export took several rounds: ${progress?.rounds}`);
    assert.ok(Buffer.from(zip).equals(Buffer.from(once)), 'its zip is the one an export in one round writes');
  });

  describe('what a closed tab left, and what a live one runs', () => {
    it('records a commit a closed tab left failed, and never adopts it over a newer write', async () => {
      const origin = newOrigin();
      const setup = await openTab(origin);
      await deployed(setup, fixtures.platform);

      // The first tab commits v1, and closes as it reads the parts it staged.
      let hold = false;
      const first = await openTab(origin, {}, watched(origin.blobs, { read: (key) => (hold && isPart(key) ? never() : undefined) }));
      const { id, upload } = await stagedUpload(first, 'v1');
      hold = true;
      void first.transfer.datasetUpload.commit(id, upload);
      await until(async () => ((await commitStatus(first, id)).status === 'processing' ? true : null), 'the first tab\'s commit to be under way');
      await first.close();

      // Another tab writes v2 meanwhile.
      const second = await openTab(origin);
      await workspaceSetDataset(second.storage, REPO, WORKSPACE, REPO_PATH, 'v2', StringType);

      // The next tab to boot records the commit failed, naming why, and
      // removes what it staged: v2 stands.
      const next = await openTab(origin);
      await next.transfer.start();
      const ended = await commitStatus(next, id);
      assert.equal(ended.status, 'failed', 'the commit the closed tab left is recorded failed');
      assert.match(ended.message, /its tab closed before it finished/);
      assert.equal(await workspaceGetDataset(next.storage, REPO, WORKSPACE, REPO_PATH), 'v2', 'the newer write stands');
      assert.deepEqual(await stagedBy(origin, id), [], 'what it staged is gone');

      // A client asking for the commit again is answered so, and nothing runs.
      const asked = await next.transfer.datasetUpload.commit(id, upload);
      assert.equal(asked.type, 'failed');
      assert.equal(await workspaceGetDataset(next.storage, REPO, WORKSPACE, REPO_PATH), 'v2');
    });

    it('leaves the commit and the job a live tab runs to it, when another tab boots', async () => {
      const origin = newOrigin();
      const setup = await openTab(origin);
      await deployed(setup, fixtures.platform);
      await importPackage(setup, fixtures.held);

      // A tab that lives commits, and exports, each held part way.
      const held = watched(origin.blobs, {
        read: (key) => (isPart(key) ? never() : undefined),
        write: (key) => (exportRound(key) === 1 ? never() : undefined),
      });
      const live = await openTab(origin, { exportRoundBytes: 512 }, held);
      const { id, upload } = await stagedUpload(live, 'v1');
      void live.transfer.datasetUpload.commit(id, upload);
      await until(async () => ((await commitStatus(live, id)).status === 'processing' ? true : null), 'the live tab\'s commit to be under way');
      const exportId = await startExport(live);
      await until(async () => ((await live.transfer.packageExport.progressOf(exportId))?.rounds === 1 ? true : null), 'the live tab\'s export to keep its first round');

      // Another tab boots, and runs neither: its reads and writes are watched.
      let partsRead = 0;
      let roundsWritten = 0;
      const other = await openTab(origin, { exportRoundBytes: 512 }, watched(origin.blobs, {
        read: (key) => {
          if (isPart(key)) partsRead++;
        },
        write: (key) => {
          if (exportRound(key) !== null) roundsWritten++;
        },
      }));
      await other.transfer.start();
      await other.transfer.datasetUpload.commit(id, upload);
      await other.transfer.packageExport.execute(exportId, REPO);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(partsRead, 0, 'the other tab verifies no part of the live tab\'s commit');
      assert.equal(roundsWritten, 0, 'the other tab writes no round of the live tab\'s export');
      assert.equal((await commitStatus(other, id)).status, 'processing', 'the commit is the live tab\'s still');
      const job = await other.transfer.packageExport.get(exportId);
      assert.equal(job?.status.type, 'processing', 'the export is the live tab\'s still');
    });

    it('records the export and the import a closed tab left failed, and removes what they staged', async () => {
      const origin = newOrigin();
      const setup = await openTab(origin);
      await setup.storage.repos.create(REPO);
      await importPackage(setup, fixtures.held);

      // The tab exports, and imports, each held part way, and closes.
      const closing = await openTab(origin, { exportRoundBytes: 512 }, watched(origin.blobs, {
        write: (key) => (exportRound(key) === 1 ? never() : undefined),
        readRange: (key) => (key[key.length - 1] === 'zip' ? never() : undefined),
      }));
      const exportId = await startExport(closing);
      await until(async () => ((await closing.transfer.packageExport.progressOf(exportId))?.rounds === 1 ? true : null), 'the export to keep its first round');
      const importId = await startImport(closing, fixtures.platform);
      await until(async () => ((await closing.transfer.packageImport.get(importId))?.status.type === 'uploaded' ? true : null), 'the import to be staged');
      assert.notDeepEqual(await stagedBy(origin, exportId), [], 'the export staged its first round');
      assert.notDeepEqual(await stagedBy(origin, importId), [], 'the import staged its zip');
      await closing.close();

      const next = await openTab(origin);
      await next.transfer.start();
      const exported = await exportEnded(next, exportId);
      assert.equal(exported.status, 'failed', 'the export the closed tab left is recorded failed');
      assert.match(exported.message, /its tab closed before it finished/);
      assert.equal(await importEnded(next, importId), 'failed', 'the import the closed tab left is recorded failed');
      assert.deepEqual(await stagedBy(origin, exportId), [], 'the export\'s rounds are gone');
      assert.deepEqual(await stagedBy(origin, importId), [], 'the import\'s zip is gone');
    });
  });

  it('holds the workspace across a workspace export\'s rounds: a dataset write between them is refused, and the export completes', async () => {
    const origin = newOrigin();
    const setup = await openTab(origin);
    await deployed(setup, fixtures.platform);
    await workspaceSetDataset(setup.storage, REPO, WORKSPACE, REPO_PATH, 'before', StringType);

    let between: Promise<unknown> | null = null;
    const exporting = await openTab(origin, { exportRoundBytes: 1 }, watched(origin.blobs, {
      write: (key) => {
        // Between the first round and the second, a write to the workspace.
        if (exportRound(key) === 0 && between === null) {
          between = workspaceSetDataset(setup.storage, REPO, WORKSPACE, REPO_PATH, 'between', StringType).then(() => 'written', (err: unknown) => err);
          return between.then(() => undefined);
        }
        return undefined;
      },
    }));
    const id = await startExport(exporting, WORKSPACE);
    const zip = await exportedZip(exporting, id);
    assert.ok(zip.byteLength > 0, 'the export completes');
    assert.ok(between !== null, 'a write was tried between rounds');
    const outcome = await (between as Promise<unknown>);
    assert.ok(outcome instanceof WorkspaceLockError, `the write between rounds is refused, the workspace locked: ${String(outcome)}`);
    assert.equal(await workspaceGetDataset(setup.storage, REPO, WORKSPACE, REPO_PATH), 'before', 'the workspace exported is the one the export began with');
    await workspaceSetDataset(setup.storage, REPO, WORKSPACE, REPO_PATH, 'after', StringType);
    assert.equal(await workspaceGetDataset(setup.storage, REPO, WORKSPACE, REPO_PATH), 'after', 'the workspace is free once the export has ended');
  });

  it('refuses a workspace export while another holds the workspace, naming the holder: the lock stays the holder\'s, and an export once it is released completes', async () => {
    const origin = newOrigin();
    const setup = await openTab(origin);
    await deployed(setup, fixtures.platform);

    // Another tab deploys, holding the workspace, as the export starts.
    const deploy = await setup.storage.locks.acquire(REPO, WORKSPACE, variant('deployment', null), { mode: 'exclusive' });
    assert.ok(deploy !== null, 'the deploy holds the workspace');
    const held = await setup.storage.locks.getState(REPO, WORKSPACE);
    assert.ok(held !== null, 'the workspace\'s lock records its holder');
    const holder = lockStateToHolderInfo(held);
    assert.equal(holder.operation, 'deployment', 'the holder is the deploy');

    const exporting = await openTab(origin);
    const refused = await exportEnded(exporting, await startExport(exporting, WORKSPACE));
    assert.equal(refused.status, 'failed', 'the export is refused');
    assert.equal(refused.message, new WorkspaceLockError(WORKSPACE, holder).message, 'its failure names the holder, as lockStateToHolderInfo gives it');
    assert.ok(refused.message.includes(holder.acquiredAt), `it names when the holder took the workspace: ${refused.message}`);
    const after = await exporting.storage.locks.getState(REPO, WORKSPACE);
    assert.ok(after !== null && sameLockState(after, held), 'the lock is still the deploy\'s');

    await deploy.release();
    const zip = await exportedZip(exporting, await startExport(exporting, WORKSPACE));
    assert.ok(zip.byteLength > 0, 'an export once the deploy has let the workspace go completes');
  });

  describe('a job or a commit asked for twice at once', () => {
    it('runs a job asked to run twice at once once', async () => {
      const tab = await openTab(newOrigin());
      await tab.storage.repos.create(REPO);
      const id = crypto.randomUUID();
      const zip = fixtures.held;
      await tab.transfer.packageImport.create(id, { repo: REPO, size: BigInt(zip.byteLength), status: variant('created', null), createdAt: new Date() });
      await tab.transfer.packageImport.stageZip(id, REPO, zip);
      const statuses: string[] = [];
      const update = tab.transfer.packageImport.updateStatus.bind(tab.transfer.packageImport);
      tab.transfer.packageImport.updateStatus = (jobId, status) => {
        statuses.push(status.type);
        return update(jobId, status);
      };
      await Promise.all([tab.transfer.packageImport.execute(id, REPO), tab.transfer.packageImport.execute(id, REPO)]);
      assert.equal(await importEnded(tab, id), 'completed');
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(statuses.filter((status) => status === 'completed').length, 1, `the import ran once: ${statuses.join(' → ')}`);
    });

    it('verifies an upload whose commit is asked for twice at once once', async () => {
      const origin = newOrigin();
      const setup = await openTab(origin);
      await deployed(setup, fixtures.platform);
      let partsRead = 0;
      const tab = await openTab(origin, {}, watched(origin.blobs, {
        read: (key) => {
          if (isPart(key)) partsRead++;
        },
      }));
      const { id, upload } = await stagedUpload(tab, 'once');
      const [first, second] = await Promise.all([tab.transfer.datasetUpload.commit(id, upload), tab.transfer.datasetUpload.commit(id, upload)]);
      assert.equal(first.type, 'completed');
      assert.equal(second.type, 'completed');
      assert.equal(partsRead, 1, 'the staged part was read for one verification');
    });

    it('answers a poll right after a commit is asked for: under way', async () => {
      const origin = newOrigin();
      const setup = await openTab(origin);
      await deployed(setup, fixtures.platform);
      const tab = await openTab(origin);
      const { id, upload } = await stagedUpload(tab, 'polled');
      const committing = tab.transfer.datasetUpload.commit(id, upload);
      assert.equal((await commitStatus(tab, id)).status, 'processing', 'a poll right after the commit is asked hears it under way');
      assert.equal((await committing).type, 'completed');
    });
  });

  describe('what a transfer staged, and its retention', () => {
    it('sweeps in gc what a transfer staged once its record is gone', async () => {
      const origin = newOrigin();
      const tab = await openTab(origin);
      await tab.storage.repos.create(REPO);
      const id = crypto.randomUUID();
      await origin.blobs.write([REPO, 'transfer', id, 'part-000001'], new Uint8Array([1, 2, 3]));
      assert.notDeepEqual(await stagedBy(origin, id), [], 'a staged part no record names');
      const result = await repoGc(tab.storage, REPO, { minAge: 0 });
      assert.deepEqual(await stagedBy(origin, id), [], 'gc swept it');
      assert.ok(result.deletedPartials >= 1, `gc counted it: ${result.deletedPartials}`);
    });

    it('leaves in gc what a transfer whose record stands staged, younger than its retention', async () => {
      const origin = newOrigin();
      const setup = await openTab(origin);
      await deployed(setup, fixtures.platform);
      const { id } = await stagedUpload(setup, 'kept');
      await repoGc(setup.storage, REPO, { minAge: 0 });
      assert.notDeepEqual(await stagedBy(origin, id), [], 'the upload\'s part stays for its commit');
    });

    it('forgets, in a tab that lives, a transfer kept past its retention, with what it staged', async () => {
      const origin = newOrigin();
      const setup = await openTab(origin);
      await deployed(setup, fixtures.platform);
      const tab = await openTab(origin, { retention: { recordMs: 50, intervalMs: 20 } });
      await tab.transfer.start();
      const { id } = await stagedUpload(tab, 'forgotten');
      await until(async () => ((await tab.transfer.datasetUpload.get(id)) === null ? true : null), 'the upload no one committed to be forgotten', 5_000);
      assert.deepEqual(await stagedBy(origin, id), [], 'what it staged went with it');
    });

    it('deletes a record that does not decode, with what its transfer staged', async () => {
      const origin = newOrigin();
      const tab = await openTab(origin);
      await tab.storage.repos.create(REPO);
      const id = crypto.randomUUID();
      const key: RecordKey = ['transfer', 'upload', id];
      await openMemoryRecords(origin.records).transact((tx) => {
        tx.put(key, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
        return Promise.resolve();
      });
      await origin.blobs.write([REPO, 'transfer', id, 'part-000001'], new Uint8Array([1, 2, 3]));
      await tab.transfer.start();
      assert.equal(await openMemoryRecords(origin.records).get(key), null, 'the record is gone');
      assert.deepEqual(await stagedBy(origin, id), [], 'and what its transfer staged');
    });

    it('removes the rounds of an export that failed', async () => {
      const origin = newOrigin();
      const setup = await openTab(origin);
      await setup.storage.repos.create(REPO);
      await importPackage(setup, fixtures.held);
      const tab = await openTab(origin, { exportRoundBytes: 512 }, watched(origin.blobs, {
        write: (key) => {
          if (exportRound(key) === 1) throw new Error('the disk is full');
        },
      }));
      const id = await startExport(tab);
      const ended = await exportEnded(tab, id);
      assert.equal(ended.status, 'failed');
      assert.match(ended.message, /the disk is full/);
      assert.deepEqual(await stagedBy(origin, id), [], 'the rounds it wrote are gone');
    });
  });

  describe('what a commit and an export hold', () => {
    it('stores a commit\'s bytes under the hash it checked them against, hashing them once', async () => {
      const origin = newOrigin();
      const setup = await openTab(origin);
      await deployed(setup, fixtures.platform);
      const tab = await openTab(origin);
      let rehashed = 0;
      const objects = tab.storage.objects;
      const write = objects.write.bind(objects);
      objects.write = (repo, data) => {
        rehashed++;
        return write(repo, data);
      };
      const { id, upload } = await stagedUpload(tab, 'hashed once');
      assert.equal((await tab.transfer.datasetUpload.commit(id, upload)).type, 'completed');
      assert.equal(rehashed, 0, 'the commit stores what it verified without hashing it again');
      assert.equal(await workspaceGetDataset(tab.storage, REPO, WORKSPACE, REPO_PATH), 'hashed once');
    });

    it('keeps no checkpoint in an export\'s record, which each progress report writes', async () => {
      const origin = newOrigin();
      const tab = await openTab(origin, { exportRoundBytes: 512 });
      await tab.storage.repos.create(REPO);
      await importPackage(tab, fixtures.held);
      const id = await startExport(tab);
      await exportedZip(tab, id);
      const record = await openMemoryRecords(origin.records).get(['transfer', 'export', id]);
      assert.ok(record !== null && record.byteLength < 400, `the export's record is its job and its rounds alone: ${record?.byteLength} bytes`);
    });
  });

  it('runs a gc job through the shared handler: an object nothing reaches is deleted, and the job ends with what gc did', async () => {
    const tab = await openTab(newOrigin());
    await tab.storage.repos.create(REPO);
    const unreached = await tab.storage.objects.write(REPO, new TextEncoder().encode('nothing reaches this'));
    const id = crypto.randomUUID();
    await tab.transfer.repoGc.create(id, {
      repo: REPO,
      request: { dryRun: false, minAge: some(0n), keepRuns: none, keepDays: none },
      status: { status: variant('running', null), stats: none, error: none },
      createdAt: new Date(),
    });
    await tab.transfer.repoGc.execute(id, REPO);
    const job = await until(async () => {
      const found = await tab.transfer.repoGc.get(id);
      return found === null || found.status.status.type !== 'running' ? found : null;
    }, 'the gc job to end', 5_000);
    assert.equal(job?.status.status.type, 'succeeded', `gc succeeded: ${job?.status.error.type === 'some' ? job.status.error.value : ''}`);
    assert.ok(job?.status.stats.type === 'some' && job.status.stats.value.deletedObjects >= 1n, 'it deleted the object nothing reaches');
    assert.equal(await tab.storage.objects.exists(REPO, unreached), false, 'the object is gone');
  });
});
