/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository specs' test page: e3's storage over IndexedDB, OPFS and Web
 * Locks, through `WebStorage`'s stores and `WebStateStore` — a repository one
 * page writes, read again after a reload and by another page, and collected;
 * a workspace's lock as another page sees it, while its holder lives and once
 * its page has closed; a repository kept in memory, which a reload empties;
 * and a persisted storage refused in a page without an API it needs.
 *
 * The harness bundles it for Chromium; `storage.spec.ts` drives it.
 *
 * @packageDocumentation
 */

import { StringType, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant } from '@elaraai/east';
import {
  DatasetRefType,
  E3_RELEASE,
  ExecutionStatusType,
  LockProgressType,
  PackageObjectType,
  WorkspaceRecordType,
  type DatasetRef,
  type ExecutionStatus,
  type LockProgress,
} from '@elaraai/e3-types';
import { repoGc, repositoryOpen, uuidv7, type DataflowExecutionState, type LockHandle, type LogChunk } from '@elaraai/e3-core/portable';
import { WebStateStore } from '../storage/WebStateStore.js';
import { openWebStorage, recordKeys, type WebStorage } from '../storage/WebStorage.js';
import { sessionLockName } from '../storage/web-locks.js';
import { servePage } from './page.js';

/** The repository the cases write. */
const REPO = 'default';
/** The workspace the cases write, and lock. */
const WORKSPACE = 'main';
/** The dataset path the workspace's one ref is at. */
const GREETING = 'inputs/greeting';
const TASK = 'a'.repeat(64);
const INPUTS = 'b'.repeat(64);
const AT = new Date('2026-10-01T00:00:00.000Z');

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const encodeText = encodeBeast2For(StringType);
const decodeText = decodeBeast2For(StringType);

/** The ref of the workspace's one dataset: the greeting, at its own version. */
function greetingRef(value: string): DatasetRef {
  return variant('value', { hash: value, versions: new Map([[GREETING, value]]) });
}

/** The success recorded of the task over its inputs, which wrote `output`. */
function succeeded(executionId: string, output: string): ExecutionStatus {
  return variant('success', {
    executionId, inputHashes: [], outputHash: output, startedAt: AT, completedAt: AT, peakBytes: some(1024n), plan: none, unit: false,
  });
}

/** A run of the workspace's one task, under way. */
function runState(id: string): DataflowExecutionState {
  return {
    release: E3_RELEASE, id, repo: REPO, workspace: WORKSPACE, startedAt: AT, force: false, filter: none,
    graph: none, graphHash: none,
    tasks: new Map([['greet', {
      name: 'greet', status: 'pending', cached: none, outputHash: none, error: none, exitCode: none,
      startedAt: none, completedAt: none, duration: none, plan: none, execution: none,
    }]]),
    executed: 0n, cached: 0n, failed: 0n, skipped: 0n, status: 'running', completedAt: none, error: none,
    versionVectors: new Map(), inputSnapshot: new Map(), taskOutputPaths: [], reexecuted: 0n, events: [], eventSeq: 0n,
  };
}

/** What a deploy holding the workspace reports. */
const PROGRESS: LockProgress = variant('deployment', {
  package: { name: 'greeting', version: '1.0.0' },
  startedAt: AT,
  files: [],
  records: [],
});

/**
 * What {@link writeRepository} wrote: the objects' hashes, and the ids and
 * the revision it minted.
 */
export interface Written {
  /** The greeting, an object a package and an execution name */
  readonly value: string;
  /** The package object, which a package ref names */
  readonly pkg: string;
  /** An object nothing names */
  readonly orphan: string;
  /** The execution attempt's id */
  readonly executionId: string;
  /** The run whose state was written */
  readonly runId: string;
  /** The revision the dataset ref's write minted */
  readonly revision: string;
}

/**
 * What {@link readRepository} reads of what {@link writeRepository} wrote,
 * each East value compared, in the page, with what was written.
 */
export interface RepositoryRead {
  readonly repositories: string[];
  readonly status: string | null;
  /** Whether the repository opens naming this release */
  readonly release: boolean;
  readonly greeting: string;
  /** Bytes 3 to 9 of the object nothing names */
  readonly range: string;
  readonly size: number;
  readonly objects: string[];
  readonly packages: string[];
  readonly resolved: string | null;
  readonly workspaces: string[];
  /** Whether the dataset ref, and its revision, are the ones written */
  readonly dataset: boolean;
  /** Whether the execution attempt is the one written */
  readonly execution: boolean;
  /** A window of the attempt's log that a split character bounds */
  readonly log: LogChunk;
  readonly run: { readonly id: string; readonly status: string } | null;
}

/** What gc did, and which objects it left. */
export interface Collected {
  readonly deletedObjects: number;
  readonly retainedObjects: number;
  readonly deletedPartials: number;
  readonly exists: { readonly value: boolean; readonly pkg: boolean; readonly orphan: boolean };
}

/** A workspace's lock as a page sees it. */
export interface LockSeen {
  /** Its holder, by the session the state names, while one holds it */
  readonly holder: { readonly operation: string; readonly session: string | null; readonly alive: boolean } | null;
  /** Whether what the holder reported is the deploy's progress */
  readonly progress: boolean | null;
  /** Whether a state of the lock is recorded, whoever's it was */
  readonly recorded: boolean;
}

/** The storage, and the hold, of a page holding the workspace's lock until
 *  it closes. */
let holding: { storage: WebStorage; handle: LockHandle } | undefined;

/** The storage this page opened with `persist: false`, while it lives. */
let memory: WebStorage | undefined;

/** Runs `use` over the storage of a name, closed once it has run. */
async function withStorage<T>(name: string, use: (storage: WebStorage) => Promise<T>): Promise<T> {
  const storage = await openWebStorage({ name });
  try {
    return await use(storage);
  } finally {
    await storage.close();
  }
}

/** Whether the origin's OPFS root holds a directory of a name. */
async function opfsHas(name: string): Promise<boolean> {
  try {
    await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') return false;
    throw err;
  }
}

/** What a storage refused at its opening left of itself. */
export interface Refused {
  /** The refusal's message, or `null` when the storage opened */
  readonly refusal: string | null;
  /** Whether the storage's IndexedDB database is there */
  readonly database: boolean;
  /** Whether the storage's OPFS directory is there */
  readonly directory: boolean;
}

servePage({
  /** Writes a repository through the stores: objects, refs, a dataset ref, an
   *  execution with its log, and a run's state. */
  writeRepository(name: string): Promise<Written> {
    return withStorage(name, async (storage) => {
      await storage.repos.create(REPO);
      const value = await storage.objects.write(REPO, encodeText('hello from a page'));
      const pkg = await storage.objects.write(REPO, encodeBeast2For(PackageObjectType)({
        tasks: new Map(),
        data: { structure: variant('struct', new Map()), refs: new Map([[GREETING, variant('value', { hash: value, versions: new Map() })]]) },
        functions: new Map(), records: new Map(), sources: new Map(),
      }));
      await storage.refs.packageWrite(REPO, 'greeting', '1.0.0', pkg);
      const orphan = await storage.objects.write(REPO, encoder.encode('an object nothing names'));
      await storage.refs.workspaceWrite(REPO, WORKSPACE, encodeBeast2For(WorkspaceRecordType)(none));
      const { revision } = await storage.datasets.writeIf(REPO, WORKSPACE, GREETING, greetingRef(value), null);
      const executionId = uuidv7();
      await storage.refs.executionWrite(REPO, TASK, INPUTS, executionId, succeeded(executionId, value));
      // 'a' is one byte in UTF-8, 'é' two, '€' three and 'b' one.
      await storage.logs.append(REPO, TASK, INPUTS, executionId, 'stdout', 'aé');
      await storage.logs.append(REPO, TASK, INPUTS, executionId, 'stdout', '€b');
      const runId = uuidv7();
      await new WebStateStore(storage.adapters.records).create(runState(runId));
      return { value, pkg, orphan, executionId, runId, revision };
    });
  },

  /** Reads through the stores what {@link writeRepository} wrote. */
  readRepository(name: string, written: Written): Promise<RepositoryRead> {
    return withStorage(name, async (storage) => {
      const record = await repositoryOpen(storage, REPO);
      const versioned = await storage.datasets.readVersioned(REPO, WORKSPACE, GREETING);
      const execution = await storage.refs.executionGet(REPO, TASK, INPUTS, written.executionId);
      const state = await new WebStateStore(storage.adapters.records).readLatest(REPO, WORKSPACE);
      return {
        repositories: await storage.repos.list(),
        status: (await storage.repos.getMetadata(REPO))?.status.type ?? null,
        release: record.release === E3_RELEASE,
        greeting: decodeText(await storage.objects.read(REPO, written.value)),
        range: decoder.decode(await storage.objects.readRange(REPO, written.orphan, 3, 6)),
        size: (await storage.objects.stat(REPO, written.orphan)).size,
        objects: (await storage.objects.list(REPO)).sort(),
        packages: (await storage.refs.packageList(REPO)).map(({ name: pkg, version }) => `${pkg}@${version}`),
        resolved: await storage.refs.packageResolve(REPO, 'greeting', '1.0.0'),
        workspaces: await storage.refs.workspaceList(REPO),
        dataset: versioned !== null && versioned.revision === written.revision && equalFor(DatasetRefType)(versioned.ref, greetingRef(written.value)),
        execution: execution !== null && equalFor(ExecutionStatusType)(execution, succeeded(written.executionId, written.value)),
        log: await storage.logs.read(REPO, TASK, INPUTS, written.executionId, 'stdout', { offset: 1, limit: 5 }),
        run: state === null ? null : { id: state.id, status: state.status },
      };
    });
  },

  /** The objects the repository holds, in order. */
  listObjects(name: string): Promise<string[]> {
    return withStorage(name, async (storage) => (await storage.objects.list(REPO)).sort());
  },

  /** Collects the repository's garbage, holding it still, and answers what
   *  gc did and which objects it left. */
  collectRepository(name: string, written: Written): Promise<Collected> {
    return withStorage(name, async (storage) => {
      const result = await repoGc(storage, REPO, { minAge: 0 });
      return {
        deletedObjects: result.deletedObjects,
        retainedObjects: result.retainedObjects,
        deletedPartials: result.deletedPartials,
        exists: {
          value: await storage.objects.exists(REPO, written.value),
          pkg: await storage.objects.exists(REPO, written.pkg),
          orphan: await storage.objects.exists(REPO, written.orphan),
        },
      };
    });
  },

  /** Takes the workspace's exclusive lock for a deploy, and holds it, having
   *  reported its progress, until the page closes; answers the session. */
  async holdWorkspace(name: string): Promise<string> {
    if (holding !== undefined) throw new Error('this page holds the workspace already');
    const storage = await openWebStorage({ name });
    const handle = await storage.locks.acquire(REPO, WORKSPACE, variant('deployment', null));
    if (handle === null) {
      await storage.close();
      throw new Error('another page holds the workspace');
    }
    await handle.report(PROGRESS);
    holding = { storage, handle };
    return storage.adapters.locks.session;
  },

  /** How the workspace's lock is held, as this page sees it. */
  readLock(name: string): Promise<LockSeen> {
    return withStorage(name, async (storage) => {
      const state = await storage.locks.getState(REPO, WORKSPACE);
      const progress = await storage.locks.getProgress(REPO, WORKSPACE);
      return {
        holder: state === null ? null : {
          operation: state.operation.type,
          session: state.holder.type === 'process' ? state.holder.value.bootId : null,
          alive: await storage.locks.isHolderAlive(state.holder),
        },
        progress: progress === null ? null : equalFor(LockProgressType)(progress, PROGRESS),
        recorded: (await storage.adapters.records.get(recordKeys.lock(REPO, WORKSPACE))) !== null,
      };
    });
  },

  /** Takes the workspace's exclusive lock, waiting for it when asked, and
   *  lets it go; answers whether it took it, whether the lock's state then
   *  named this page's session, and whether the release took the state
   *  away. */
  tryWorkspace(name: string, wait: boolean): Promise<{ taken: boolean; own: boolean; cleared: boolean }> {
    return withStorage(name, async (storage) => {
      const handle = await storage.locks.acquire(REPO, WORKSPACE, variant('deployment', null), wait ? { wait: true, timeout: 10_000 } : {});
      if (handle === null) return { taken: false, own: false, cleared: false };
      let own: boolean;
      try {
        const state = await storage.locks.getState(REPO, WORKSPACE);
        own = state !== null && state.holder.type === 'process' && state.holder.value.bootId === storage.adapters.locks.session;
      } finally {
        await handle.release();
      }
      return { taken: true, own, cleared: (await storage.adapters.records.get(recordKeys.lock(REPO, WORKSPACE))) === null };
    });
  },

  /** Waits until a session of the storage of a name has ended: its Web Lock
   *  is free, and taken and let go at once. */
  async awaitSessionEnded(name: string, session: string): Promise<void> {
    await navigator.locks.request(sessionLockName(`${name}:`, session), { mode: 'exclusive' }, () => undefined);
  },

  /** Writes a repository into the storage this page keeps in memory, and
   *  answers its repositories. */
  async writeInMemory(): Promise<string[]> {
    memory ??= await openWebStorage({ persist: false });
    await memory.repos.create(REPO);
    await memory.objects.write(REPO, encoder.encode('kept while the page lives'));
    return memory.repos.list();
  },

  /** What the storage this page keeps in memory holds, and whether anything
   *  of e3's default storage was persisted. */
  async readInMemory(): Promise<{ repositories: string[]; objects: number; persisted: boolean }> {
    memory ??= await openWebStorage({ persist: false });
    const repositories = await memory.repos.list();
    const databases = (await indexedDB.databases()).map((database) => database.name);
    return {
      repositories,
      objects: repositories.includes(REPO) ? await memory.objects.count(REPO) : 0,
      persisted: databases.includes('e3') || await opfsHas('e3'),
    };
  },

  /** Opens the storage of a name with a file handle's `move` taken away, as
   *  in a browser whose OPFS cannot move a file, and answers its refusal and
   *  what it left of itself; `move` is put back after. */
  async openWithoutMove(name: string): Promise<Refused> {
    // The prototype that defines it: FileSystemFileHandle's in Chromium
    let owner: object | null = FileSystemFileHandle.prototype;
    while (owner !== null && !Object.prototype.hasOwnProperty.call(owner, 'move')) owner = Object.getPrototypeOf(owner) as object | null;
    const move = owner === null ? undefined : Object.getOwnPropertyDescriptor(owner, 'move');
    if (owner === null || move === undefined) throw new Error('this browser\'s file handles have no move to take away');
    Reflect.deleteProperty(owner, 'move');
    let refusal: string | null = null;
    try {
      await (await openWebStorage({ name })).close();
    } catch (err) {
      refusal = err instanceof Error ? err.message : `${err as string}`;
    } finally {
      Object.defineProperty(owner, 'move', move);
    }
    return {
      refusal,
      database: (await indexedDB.databases()).some((database) => database.name === name),
      directory: await opfsHas(name),
    };
  },
});
