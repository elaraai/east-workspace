/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The storage specs' test page: it runs the adapters' contract over
 * IndexedDB, OPFS and Web Locks — and over the adapters in memory, which a
 * page opened with `persist: false` keeps its repositories in — and serves
 * what the specs across pages drive: a tab's session and its locks, and what
 * one page writes for the next to read.
 *
 * The harness bundles it for Chromium; `storage.spec.ts` drives it.
 *
 * @packageDocumentation
 */

import type { LockMode, LockRequest, LockHold } from '../storage/adapters.js';
import { deleteIndexedDbRecords, openIndexedDbRecords } from '../storage/indexeddb.js';
import { MemoryBlobs, MemoryFiles, MemoryLockSpace, MemoryRecordStore, openMemoryRecords } from '../storage/memory.js';
import { OpfsBlobs, OpfsFiles, opfsDirectory } from '../storage/opfs.js';
import { openWebLocks, sessionLockName, type WebLocks } from '../storage/web-locks.js';
import {
  blobsContract,
  caseNamed,
  filesContract,
  locksContract,
  recordsContract,
  runAdapterCase,
  type AdapterSetup,
  type BlobsSetup,
  type FilesSetup,
  type LocksSetup,
  type RecordsSetup,
} from '../testing/adapter-contract.js';
import { servePage } from './page.js';

/** A name no other case's IndexedDB database, OPFS directory or locks
 *  have. */
function unique(): string {
  return `e3-web-test-${crypto.randomUUID()}`;
}

/** The OPFS root. */
function opfsRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

/** A fresh OPFS directory of the page's, removed once the case has run. */
async function scratchDirectory(cleanup: (undo: () => Promise<void>) => void): Promise<FileSystemDirectoryHandle> {
  const root = await opfsRoot();
  const name = unique();
  cleanup(() => root.removeEntry(name, { recursive: true }));
  return root.getDirectoryHandle(name, { create: true });
}

const recordsSetups: Record<string, AdapterSetup<RecordsSetup>> = {
  indexeddb: (cleanup) => {
    const name = unique();
    // Registered first, so it runs last: once every adapter over it has
    // closed.
    cleanup(() => deleteIndexedDbRecords(name));
    return Promise.resolve({
      open: async () => {
        const records = await openIndexedDbRecords(name);
        cleanup(() => records.close());
        return records;
      },
    });
  },
  memory: (cleanup) => {
    const store = new MemoryRecordStore();
    return Promise.resolve({
      open: () => {
        const records = openMemoryRecords(store);
        cleanup(() => records.close());
        return Promise.resolve(records);
      },
    });
  },
};

const blobsSetups: Record<string, AdapterSetup<BlobsSetup>> = {
  opfs: async (cleanup) => ({ blobs: new OpfsBlobs(await scratchDirectory(cleanup)) }),
  memory: () => Promise.resolve({ blobs: new MemoryBlobs() }),
};

const locksSetups: Record<string, AdapterSetup<LocksSetup>> = {
  'web-locks': (cleanup) => {
    const prefix = `${unique()}:`;
    return Promise.resolve({
      open: async () => {
        const locks = await openWebLocks({ prefix });
        cleanup(() => locks.close());
        return locks;
      },
    });
  },
  memory: (cleanup) => {
    const space = new MemoryLockSpace();
    return Promise.resolve({
      open: async () => {
        const locks = await space.open();
        cleanup(() => locks.close());
        return locks;
      },
    });
  },
};

/** Paths of OPFS and memory files join with `/`. */
const joinPath = (dir: string, name: string): string => `${dir}/${name}`;

const filesSetups: Record<string, AdapterSetup<FilesSetup>> = {
  opfs: async (cleanup) => {
    const files = new OpfsFiles(await scratchDirectory(cleanup));
    await files.mkdir('/scratch');
    return { files, dir: '/scratch', join: joinPath };
  },
  memory: async () => {
    const files = new MemoryFiles();
    await files.mkdir('/scratch');
    return { files, dir: '/scratch', join: joinPath };
  },
};

/** A setup of a group's, by the implementation's name. */
function setupOf<S>(setups: Record<string, AdapterSetup<S>>, implementation: string): AdapterSetup<S> {
  const setup = setups[implementation];
  if (setup === undefined) throw new Error(`no setup for '${implementation}'`);
  return setup;
}

/** The tab sessions this page opened, by id. */
const sessions = new Map<string, WebLocks>();
/** The locks this page holds, by the id it gave each. */
const holds = new Map<string, LockHold>();

/** The session of an id this page opened. */
function sessionOf(id: string): WebLocks {
  const session = sessions.get(id);
  if (session === undefined) throw new Error(`this page opened no session ${id}`);
  return session;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** What the page after a reload finds of what {@link writeState} wrote. */
interface StoredState {
  records: Array<[readonly string[], string]>;
  blobs: Array<[readonly string[], string]>;
  file: string | null;
}

servePage({
  /** Runs a case of the adapters' contract over a group's implementation. */
  async runCase(group: string, implementation: string, name: string): Promise<void> {
    switch (group) {
      case 'records':
        return runAdapterCase(caseNamed(recordsContract, name), setupOf(recordsSetups, implementation));
      case 'blobs':
        return runAdapterCase(caseNamed(blobsContract, name), setupOf(blobsSetups, implementation));
      case 'locks':
        return runAdapterCase(caseNamed(locksContract, name), setupOf(locksSetups, implementation));
      case 'files':
        return runAdapterCase(caseNamed(filesContract, name), setupOf(filesSetups, implementation));
      default:
        throw new Error(`no contract for '${group}'`);
    }
  },

  /** Opens a tab session over Web Locks, and answers its id. */
  async openSession(prefix: string): Promise<string> {
    const session = await openWebLocks({ prefix });
    sessions.set(session.session, session);
    return session.session;
  },

  /** Takes a lock in a session, and answers an id for the hold, or `null`. */
  async acquire(session: string, name: string, mode: LockMode, options?: LockRequest): Promise<string | null> {
    const hold = await sessionOf(session).acquire(name, mode, options);
    if (hold === null) return null;
    const id = crypto.randomUUID();
    holds.set(id, hold);
    return id;
  },

  /** Releases a hold this page took. */
  async release(hold: string): Promise<void> {
    await holds.get(hold)?.release();
    holds.delete(hold);
  },

  /** How a lock is held, as a session sees it. */
  held(session: string, name: string): Promise<LockMode[]> {
    return sessionOf(session).held(name);
  },

  /** Whether a session is alive, as a session sees it. */
  isAlive(session: string, other: string): Promise<boolean> {
    return sessionOf(session).isAlive(other);
  },

  /** Waits until a session has ended: its Web Lock is free, and taken and
   *  let go at once. */
  async awaitEnded(prefix: string, session: string): Promise<void> {
    await navigator.locks.request(sessionLockName(prefix, session), { mode: 'exclusive' }, () => undefined);
  },

  /** Writes records, blobs and a file under a name, for another page to
   *  read. */
  async writeState(name: string): Promise<void> {
    const records = await openIndexedDbRecords(name);
    try {
      await records.transact(async (tx) => {
        tx.put(['refs', 'main'], encoder.encode('a ref'));
        tx.put(['refs', 'dev'], encoder.encode('another ref'));
      });
    } finally {
      await records.close();
    }
    const blobs = new OpfsBlobs(await opfsDirectory(`/${name}/blobs`));
    await blobs.write(['objects', 'ab12'], encoder.encode('an object'));
    const files = new OpfsFiles(await opfsDirectory(`/${name}/files`));
    await files.mkdir('/uploads');
    await files.write('/uploads/delivery', encoder.encode('a delivery'));
  },

  /** Reads what {@link writeState} wrote under a name. */
  async readState(name: string): Promise<StoredState> {
    const records = await openIndexedDbRecords(name);
    let stored: StoredState['records'];
    try {
      stored = (await records.scan([])).map(({ key, value }) => [key, decoder.decode(value)]);
    } finally {
      await records.close();
    }
    const blobs = new OpfsBlobs(await opfsDirectory(`/${name}/blobs`));
    const found: StoredState['blobs'] = [];
    for (const { key } of await blobs.list([])) found.push([key, decoder.decode((await blobs.read(key))!)]);
    const files = new OpfsFiles(await opfsDirectory(`/${name}/files`));
    let file: string | null = null;
    if ((await files.stat('/uploads/delivery')) !== null) {
      const parts: Uint8Array[] = [];
      for await (const chunk of files.read('/uploads/delivery')) parts.push(chunk);
      file = parts.map((part) => decoder.decode(part, { stream: true })).join('') + decoder.decode();
    }
    return { records: stored, blobs: found, file };
  },

  /** Removes what {@link writeState} wrote under a name. */
  async clearState(name: string): Promise<void> {
    await deleteIndexedDbRecords(name);
    await (await opfsRoot()).removeEntry(name, { recursive: true }).catch((err: unknown) => {
      if (!(err instanceof DOMException && err.name === 'NotFoundError')) throw err;
    });
  },

  /**
   * Sweeps the leftovers of a write in flight and of one abandoned, in an
   * OPFS blob store's staging directory, and answers what each sweep found.
   */
  async sweepStaging(): Promise<Record<string, unknown>> {
    const root = await opfsRoot();
    const name = unique();
    const dir = await root.getDirectoryHandle(name, { create: true });
    try {
      const blobs = new OpfsBlobs(dir);
      let open!: () => void;
      const opened = new Promise<void>((resolve) => {
        open = resolve;
      });
      let reached!: () => void;
      const waiting = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const writing = blobs.write(['inflight'], (async function* () {
        yield encoder.encode('in ');
        reached();
        await opened;
        yield encoder.encode('flight');
      })());
      await waiting;
      const staging = await dir.getDirectoryHandle('.staging');
      const staged: string[] = [];
      for await (const entry of staging.keys()) staged.push(entry);
      const dryInFlight = await blobs.sweep({ minAge: 0, dryRun: true });
      const gatedInFlight = await blobs.sweep({ minAge: 60_000, dryRun: false });
      open();
      const written = await writing;
      const inflight = decoder.decode((await blobs.read(['inflight']))!);
      // What a tab closed mid-write leaves: a staged file no write finishes.
      const abandoned = await staging.getFileHandle(crypto.randomUUID(), { create: true });
      const writable = await abandoned.createWritable();
      await writable.write(encoder.encode('abandoned'));
      await writable.close();
      const gatedAbandoned = await blobs.sweep({ minAge: 60_000, dryRun: false });
      const dryAbandoned = await blobs.sweep({ minAge: 0, dryRun: true });
      const sweptAbandoned = await blobs.sweep({ minAge: 0, dryRun: false });
      const left: string[] = [];
      for await (const entry of staging.keys()) left.push(entry);
      return { staged, dryInFlight, gatedInFlight, written, inflight, gatedAbandoned, dryAbandoned, sweptAbandoned, left };
    } finally {
      await root.removeEntry(name, { recursive: true });
    }
  },
});
