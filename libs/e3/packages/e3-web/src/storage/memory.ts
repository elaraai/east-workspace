/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The adapters in memory: records, blobs, locks and files a process keeps
 * while it runs.
 *
 * e3's Node test pass runs every store contract suite over them, and a page
 * opened with `persist: false` keeps its repositories in them, starting fresh
 * on every load. Each answers as its browser counterpart does — the records'
 * transactions end as IndexedDB's do, the locks queue as Web Locks do — so
 * what passes over them in Node passes over IndexedDB, OPFS and Web Locks in
 * a browser.
 *
 * Nothing here reaches Node: a browser bundle may import this module.
 *
 * @packageDocumentation
 */

import {
  AdapterClosedError,
  FileNotFoundError,
  RecordsTransactionError,
  attempt,
  checkBlobKey,
  checkLockRequest,
  checkBlobPrefix,
  checkRange,
  checkRecordKey,
  checkScan,
  chunksOf,
  compareKeys,
  copyBytes,
  isUnder,
  type BlobInfo,
  type BlobKey,
  type BlobStat,
  type BlobSweepResult,
  type BlobsAdapter,
  type ByteSource,
  type FileStat,
  type FilesAdapter,
  type LockHold,
  type LockMode,
  type LockRequest,
  type LocksAdapter,
  type RecordEntry,
  type RecordKey,
  type RecordScan,
  type RecordsAdapter,
  type RecordsTransaction,
} from './adapters.js';

// =============================================================================
// Records
// =============================================================================

/** A record as the store keeps it: its key, and its bytes. */
interface HeldRecord {
  key: readonly string[];
  value: Uint8Array;
}

/**
 * Records in memory, in key order, which any number of adapters open — as
 * tabs open one IndexedDB database.
 *
 * @remarks
 * Every read and transaction takes its turn, one after another, so a
 * transaction applies whole before anything reads past it, as IndexedDB runs
 * a transaction before a read made after it.
 */
export class MemoryRecordStore {
  /** The records, in key order */
  private readonly records: HeldRecord[] = [];
  /** Settles when the last turn taken has run */
  private tail: Promise<void> = Promise.resolve();

  /**
   * Runs `fn` once every turn taken before it has run.
   *
   * @param fn - What runs in the turn
   * @returns What `fn` returns
   * @internal
   */
  turn<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  /** The index of the first record whose key is not below `key`. */
  private lowerBound(key: readonly string[]): number {
    let low = 0;
    let high = this.records.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (compareKeys(this.records[mid]!.key, key) < 0) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  /** The index of the first record whose key is above `key`. */
  private upperBound(key: readonly string[]): number {
    let low = 0;
    let high = this.records.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (compareKeys(this.records[mid]!.key, key) <= 0) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  /**
   * The record of a key.
   *
   * @internal
   */
  find(key: RecordKey): HeldRecord | undefined {
    const record = this.records[this.lowerBound(key)];
    return record !== undefined && compareKeys(record.key, key) === 0 ? record : undefined;
  }

  /**
   * Writes a record, or deletes it for `null`.
   *
   * @internal
   */
  set(key: RecordKey, value: Uint8Array | null): void {
    const at = this.lowerBound(key);
    const record = this.records[at];
    const found = record !== undefined && compareKeys(record.key, key) === 0;
    if (value === null) {
      if (found) this.records.splice(at, 1);
    } else if (found) {
      record.value = value;
    } else {
      this.records.splice(at, 0, { key: [...key], value });
    }
  }

  /**
   * The records under a prefix a scan asks for, in the order it asks.
   *
   * @internal
   */
  range(prefix: RecordKey, options: RecordScan): HeldRecord[] {
    let start = this.lowerBound(prefix);
    if (options.after !== undefined) start = Math.max(start, this.upperBound(options.after));
    // The keys under a prefix are contiguous in key order.
    let end = start;
    const { before } = options;
    while (end < this.records.length) {
      const key = this.records[end]!.key;
      if (!isUnder(key, prefix) || (before !== undefined && compareKeys(key, before) >= 0)) break;
      end++;
    }
    const found = this.records.slice(start, end);
    if (options.reverse === true) found.reverse();
    return options.limit === undefined ? found : found.slice(0, options.limit);
  }
}

/**
 * Records in memory: an adapter over a {@link MemoryRecordStore}.
 *
 * @remarks
 * A transaction ends as an IndexedDB transaction does: when its work goes on
 * to anything but its own operations. Its operations answer at once, so work
 * that awaits only them finishes before the task it started in ends; work
 * still running after that task has awaited something else, and is refused
 * with {@link RecordsTransactionError}, its writes undone.
 *
 * @example
 * ```ts
 * const store = new MemoryRecordStore();
 * const records = openMemoryRecords(store);
 * await records.transact(async (tx) => { tx.put(['refs', 'main'], bytes); });
 * ```
 */
export class MemoryRecords implements RecordsAdapter {
  private closed = false;

  /**
   * @param store - The records this adapter reads and writes
   */
  constructor(private readonly store: MemoryRecordStore) {}

  private assertOpen(): void {
    if (this.closed) throw new AdapterClosedError('records');
  }

  get(key: RecordKey): Promise<Uint8Array | null> {
    return this.store.turn(() => {
      this.assertOpen();
      checkRecordKey(key);
      const record = this.store.find(key);
      return record === undefined ? null : copyBytes(record.value);
    });
  }

  scan(prefix: RecordKey, options: RecordScan = {}): Promise<RecordEntry[]> {
    return this.store.turn(() => {
      this.assertOpen();
      checkRecordKey(prefix);
      checkScan(options);
      return this.store.range(prefix, options).map(({ key, value }) => ({ key: [...key], value: copyBytes(value) }));
    });
  }

  keys(prefix: RecordKey, options: RecordScan = {}): Promise<RecordKey[]> {
    return this.store.turn(() => {
      this.assertOpen();
      checkRecordKey(prefix);
      checkScan(options);
      return this.store.range(prefix, options).map(({ key }) => [...key]);
    });
  }

  transact<T>(work: (tx: RecordsTransaction) => Promise<T>): Promise<T> {
    return this.store.turn(async () => {
      this.assertOpen();
      const tx = new MemoryTransaction(this.store);
      // The task this turn runs in ends once the microtasks it queued have
      // run: work that awaits only its own operations has finished by then.
      let taskEnded = false;
      const timer = setTimeout(() => {
        taskEnded = true;
        tx.lapse();
      }, 0);
      try {
        const result = await work(tx);
        if (taskEnded) throw new RecordsTransactionError('its work finished after the transaction had ended');
        tx.finish();
        return result;
      } catch (err) {
        tx.undo();
        throw err;
      } finally {
        clearTimeout(timer);
      }
    });
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

/**
 * Opens an adapter over records in memory.
 *
 * @param store - The records to open; a new, empty store when not given
 * @returns The adapter
 */
export function openMemoryRecords(store: MemoryRecordStore = new MemoryRecordStore()): MemoryRecords {
  return new MemoryRecords(store);
}

/** A transaction over a {@link MemoryRecordStore}, which writes in place and
 *  keeps what each record held before, to undo it. */
class MemoryTransaction implements RecordsTransaction {
  /** Why the transaction takes no more operations, once it takes none */
  private ended: string | null = null;
  /** What each record the transaction wrote held before it did, by key */
  private readonly before = new Map<string, { key: readonly string[]; value: Uint8Array | null }>();

  constructor(private readonly store: MemoryRecordStore) {}

  /** Ends the transaction as IndexedDB ends one whose work has gone on to
   *  something else. */
  lapse(): void {
    this.ended ??= 'its work awaited something else, and the transaction ended';
  }

  /** Ends the transaction once its work has finished. */
  finish(): void {
    this.ended ??= 'it was used after its work had finished';
  }

  /** Restores every record the transaction wrote, and ends it. */
  undo(): void {
    this.finish();
    for (const { key, value } of this.before.values()) this.store.set(key, value);
    this.before.clear();
  }

  private guard(): void {
    if (this.ended !== null) throw new RecordsTransactionError(this.ended);
  }

  /** Keeps what a record held before the transaction first wrote it. */
  private remember(key: readonly string[]): void {
    const id = JSON.stringify(key);
    if (this.before.has(id)) return;
    this.before.set(id, { key: [...key], value: this.store.find(key)?.value ?? null });
  }

  /** Answers a read, or rejects when the transaction takes none. */
  private read<T>(answer: () => T): Promise<T> {
    return attempt(() => {
      this.guard();
      return answer();
    });
  }

  get(key: RecordKey): Promise<Uint8Array | null> {
    return this.read(() => {
      checkRecordKey(key);
      const record = this.store.find(key);
      return record === undefined ? null : copyBytes(record.value);
    });
  }

  scan(prefix: RecordKey, options: RecordScan = {}): Promise<RecordEntry[]> {
    return this.read(() => {
      checkRecordKey(prefix);
      checkScan(options);
      return this.store.range(prefix, options).map(({ key, value }) => ({ key: [...key], value: copyBytes(value) }));
    });
  }

  keys(prefix: RecordKey, options: RecordScan = {}): Promise<RecordKey[]> {
    return this.read(() => {
      checkRecordKey(prefix);
      checkScan(options);
      return this.store.range(prefix, options).map(({ key }) => [...key]);
    });
  }

  put(key: RecordKey, value: Uint8Array): void {
    this.guard();
    checkRecordKey(key);
    this.remember(key);
    this.store.set(key, copyBytes(value));
  }

  delete(key: RecordKey): void {
    this.guard();
    checkRecordKey(key);
    this.remember(key);
    this.store.set(key, null);
  }

  deletePrefix(prefix: RecordKey): void {
    this.guard();
    checkRecordKey(prefix);
    for (const { key } of this.store.range(prefix, {})) {
      this.remember(key);
      this.store.set(key, null);
    }
  }
}

// =============================================================================
// Blobs
// =============================================================================

/** A blob as memory keeps it. */
interface HeldBlob {
  key: readonly string[];
  data: Uint8Array;
  lastModified: number;
}

/**
 * Blobs in memory.
 *
 * @remarks
 * A write takes its source whole before it stores anything, so a reader never
 * sees part of one, and a write whose source fails stores nothing: no write
 * leaves anything behind for {@link sweep}.
 */
export class MemoryBlobs implements BlobsAdapter {
  /** The blobs, by their keys as JSON */
  private readonly blobs = new Map<string, HeldBlob>();

  read(key: BlobKey): Promise<Uint8Array | null> {
    return attempt(() => {
      checkBlobKey(key);
      const blob = this.blobs.get(JSON.stringify(key));
      return blob === undefined ? null : copyBytes(blob.data);
    });
  }

  readRange(key: BlobKey, offset: number, length: number): Promise<Uint8Array | null> {
    return attempt(() => {
      checkBlobKey(key);
      checkRange(offset, length);
      const blob = this.blobs.get(JSON.stringify(key));
      return blob === undefined ? null : blob.data.slice(offset, offset + length);
    });
  }

  stat(key: BlobKey): Promise<BlobStat | null> {
    return attempt(() => {
      checkBlobKey(key);
      const blob = this.blobs.get(JSON.stringify(key));
      return blob === undefined ? null : { size: blob.data.length, lastModified: blob.lastModified };
    });
  }

  async write(key: BlobKey, data: ByteSource): Promise<number> {
    checkBlobKey(key);
    const bytes = await collect(data);
    this.blobs.set(JSON.stringify(key), { key: [...key], data: bytes, lastModified: Date.now() });
    return bytes.length;
  }

  delete(key: BlobKey): Promise<boolean> {
    return attempt(() => {
      checkBlobKey(key);
      return this.blobs.delete(JSON.stringify(key));
    });
  }

  deletePrefix(prefix: BlobKey): Promise<void> {
    return attempt(() => {
      checkBlobPrefix(prefix);
      for (const [id, { key }] of [...this.blobs]) {
        if (isUnder(key, prefix)) this.blobs.delete(id);
      }
    });
  }

  list(prefix: BlobKey): Promise<BlobInfo[]> {
    return attempt(() => {
      checkBlobPrefix(prefix);
      return [...this.blobs.values()]
        .filter(({ key }) => isUnder(key, prefix))
        .map(({ key, data, lastModified }) => ({ key: [...key], size: data.length, lastModified }))
        .sort((a, b) => compareKeys(a.key, b.key));
    });
  }

  sweep(_options: { readonly minAge: number; readonly dryRun: boolean }): Promise<BlobSweepResult> {
    // A write stores nothing until it has its source whole: none leaves
    // anything behind.
    return Promise.resolve({ deleted: 0, skippedYoung: 0 });
  }
}

/** A source's bytes, whole, in memory of their own. */
async function collect(data: ByteSource): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return copyBytes(data);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of chunksOf(data)) {
    chunks.push(copyBytes(chunk));
    size += chunk.length;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

// =============================================================================
// Locks
// =============================================================================

/** A request that waits for a lock. */
interface Waiter {
  readonly mode: LockMode;
  readonly session: string;
  /** Answers the request: `true` once the space has granted it */
  answer(granted: boolean): void;
}

/**
 * The locks of one origin, in memory: what the sessions opened over it share,
 * as the tabs of an origin share its Web Locks.
 *
 * @remarks
 * It grants by Web Locks' rules. A name is held by any number of shared holds
 * or one exclusive hold. A request is granted when nothing waits for its name
 * ahead of it and nothing holding the name conflicts with it; one that cannot
 * be granted waits, or is refused when it may not wait. Requests that wait are
 * granted in the order they were made.
 *
 * @example
 * ```ts
 * const space = new MemoryLockSpace();
 * const first = await space.open();   // a tab
 * const second = await space.open();  // another tab
 * const hold = await first.acquire('main', 'exclusive');
 * await second.acquire('main', 'exclusive'); // null: the first tab holds it
 * ```
 */
export class MemoryLockSpace {
  /** The mode of each hold of a name, by name */
  private readonly holds = new Map<string, LockMode[]>();
  /** The requests waiting for a name, first first, by name */
  private readonly queues = new Map<string, Waiter[]>();

  /**
   * Opens a session over the space: a tab's.
   *
   * @returns The session's adapter
   */
  open(): Promise<MemoryLocks> {
    const session = crypto.randomUUID();
    if (!this.take(sessionLock(session), 'exclusive')) {
      return Promise.reject(new Error(`the session ${session} is open already`));
    }
    return Promise.resolve(new MemoryLocks(this, session));
  }

  /**
   * The mode of each hold of a name.
   *
   * @internal
   */
  modes(name: string): LockMode[] {
    return [...(this.holds.get(name) ?? [])].sort();
  }

  /** Whether nothing holding a name conflicts with a hold in `mode`. */
  private free(name: string, mode: LockMode): boolean {
    const held = this.holds.get(name) ?? [];
    return mode === 'exclusive' ? held.length === 0 : !held.includes('exclusive');
  }

  /**
   * Takes a lock if nothing waits for it and nothing holding it conflicts.
   *
   * @returns Whether it was taken
   * @internal
   */
  take(name: string, mode: LockMode): boolean {
    if (this.queues.has(name) || !this.free(name, mode)) return false;
    this.hold(name, mode);
    return true;
  }

  private hold(name: string, mode: LockMode): void {
    const held = this.holds.get(name);
    if (held === undefined) this.holds.set(name, [mode]);
    else held.push(mode);
  }

  /**
   * Queues a request behind every one made before it.
   *
   * @internal
   */
  enqueue(name: string, waiter: Waiter): void {
    const queue = this.queues.get(name);
    if (queue === undefined) this.queues.set(name, [waiter]);
    else queue.push(waiter);
  }

  /**
   * Takes a request off its queue, if it is still on it, and grants what its
   * going lets through.
   *
   * @returns Whether it was still waiting
   * @internal
   */
  dequeue(name: string, waiter: Waiter): boolean {
    const queue = this.queues.get(name);
    const at = queue?.indexOf(waiter) ?? -1;
    if (queue === undefined || at < 0) return false;
    queue.splice(at, 1);
    if (queue.length === 0) this.queues.delete(name);
    this.process(name);
    return true;
  }

  /**
   * Releases a hold of a name, and grants what its going lets through.
   *
   * @internal
   */
  release(name: string, mode: LockMode): void {
    const held = this.holds.get(name) ?? [];
    const at = held.indexOf(mode);
    if (at >= 0) held.splice(at, 1);
    if (held.length === 0) this.holds.delete(name);
    this.process(name);
  }

  /** Grants the requests at the head of a name's queue while they can be. */
  private process(name: string): void {
    const queue = this.queues.get(name);
    while (queue !== undefined && queue.length > 0 && this.free(name, queue[0]!.mode)) {
      const next = queue.shift()!;
      if (queue.length === 0) this.queues.delete(name);
      this.hold(name, next.mode);
      next.answer(true);
    }
  }

  /**
   * Refuses every request of a session still waiting.
   *
   * @internal
   */
  refuseWaiting(session: string): void {
    for (const [name, queue] of [...this.queues]) {
      for (const waiter of queue.filter((each) => each.session === session)) {
        if (this.dequeue(name, waiter)) waiter.answer(false);
      }
    }
  }
}

/** The lock a session holds for as long as it lives. */
function sessionLock(session: string): string {
  return `session:${session}`;
}

/** The lock a name given to a session's {@link MemoryLocks.acquire} is. */
function namedLock(name: string): string {
  return `lock:${name}`;
}

/**
 * A session over a {@link MemoryLockSpace}: the locks one tab takes.
 */
export class MemoryLocks implements LocksAdapter {
  private closed = false;
  /** The holds this session has not released */
  private readonly holds = new Set<LockHold>();

  /**
   * @param space - The locks the session takes
   * @param session - The session's id, whose lock the space holds for it
   * @internal
   */
  constructor(private readonly space: MemoryLockSpace, readonly session: string) {}

  private assertOpen(): void {
    if (this.closed) throw new AdapterClosedError('locks');
  }

  async acquire(name: string, mode: LockMode, options: LockRequest = {}): Promise<LockHold | null> {
    this.assertOpen();
    checkLockRequest(mode, options);
    const lock = namedLock(name);
    if (this.space.take(lock, mode)) return this.hold(lock, mode);
    if (options.wait !== true) return null;
    const granted = await new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter: Waiter = {
        mode,
        session: this.session,
        answer: (answer) => {
          clearTimeout(timer);
          resolve(answer);
        },
      };
      this.space.enqueue(lock, waiter);
      if (options.timeout !== undefined) {
        timer = setTimeout(() => {
          if (this.space.dequeue(lock, waiter)) resolve(false);
        }, options.timeout);
      }
    });
    return granted ? this.hold(lock, mode) : null;
  }

  /** A hold of a lock the space has granted this session. */
  private hold(lock: string, mode: LockMode): LockHold {
    let released = false;
    const hold: LockHold = {
      release: () => {
        if (released) return Promise.resolve();
        released = true;
        this.holds.delete(hold);
        this.space.release(lock, mode);
        return Promise.resolve();
      },
    };
    this.holds.add(hold);
    return hold;
  }

  held(name: string): Promise<LockMode[]> {
    return attempt(() => {
      this.assertOpen();
      return this.space.modes(namedLock(name));
    });
  }

  isAlive(session: string): Promise<boolean> {
    return attempt(() => {
      this.assertOpen();
      return this.space.modes(sessionLock(session)).length > 0;
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.space.refuseWaiting(this.session);
    for (const hold of [...this.holds]) await hold.release();
    this.space.release(sessionLock(this.session), 'exclusive');
  }
}

// =============================================================================
// Files
// =============================================================================

/** A file as memory keeps it. */
interface HeldFile {
  data: Uint8Array;
  lastModified: number;
}

/** How many bytes a read yields at a time. */
const READ_CHUNK = 64 * 1024;

/**
 * The names of a path of memory or OPFS files: an absolute path of
 * `/`-separated names, none of them empty, `.` or `..`; `/` alone is the root.
 *
 * @param path - The path
 * @returns Its names, in order: none for the root
 * @throws {TypeError} When the path is not of that form
 */
export function pathNames(path: string): string[] {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new TypeError(`a path is absolute, beginning with '/', not ${JSON.stringify(path)}`);
  }
  if (path === '/') return [];
  const names = path.slice(1).split('/');
  if (names.some((name) => name === '' || name === '.' || name === '..')) {
    throw new TypeError(`a path's names are neither empty, '.' nor '..': ${JSON.stringify(path)}`);
  }
  return names;
}

/**
 * Files in memory, named by absolute `/`-separated paths.
 *
 * @remarks
 * The root directory, `/`, is there from the start; every other directory is
 * made by {@link mkdir}. What a page opened with `persist: false` names by
 * path lives here.
 */
export class MemoryFiles implements FilesAdapter {
  /** The directories, by path: the root among them */
  private readonly dirs = new Set<string>(['/']);
  /** The files, by path */
  private readonly files = new Map<string, HeldFile>();

  stat(path: string): Promise<FileStat | null> {
    return attempt(() => {
      pathNames(path);
      const file = this.files.get(path);
      return file === undefined ? null : { size: file.data.length, lastModified: file.lastModified };
    });
  }

  // The chunks are in memory already: there is nothing to await, and a
  // reader iterates them as it iterates any file's.
  // eslint-disable-next-line @typescript-eslint/require-await
  async *read(path: string): AsyncIterable<Uint8Array> {
    pathNames(path);
    const file = this.files.get(path);
    if (file === undefined) throw new FileNotFoundError(path);
    for (let offset = 0; offset < file.data.length; offset += READ_CHUNK) {
      yield file.data.slice(offset, offset + READ_CHUNK);
    }
  }

  async write(path: string, data: ByteSource): Promise<number> {
    const names = pathNames(path);
    if (names.length === 0 || this.dirs.has(path)) throw new TypeError(`${path} is a directory, not a file`);
    const dir = parentPath(names);
    if (!this.dirs.has(dir)) throw new FileNotFoundError(dir);
    const bytes = await collect(data);
    this.files.set(path, { data: bytes, lastModified: Date.now() });
    return bytes.length;
  }

  remove(path: string): Promise<boolean> {
    return attempt(() => {
      pathNames(path);
      return this.files.delete(path);
    });
  }

  mkdir(path: string): Promise<void> {
    return attempt(() => {
      const names = pathNames(path);
      for (let depth = 1; depth <= names.length; depth++) {
        const dir = `/${names.slice(0, depth).join('/')}`;
        if (this.files.has(dir)) throw new TypeError(`${dir} is a file, not a directory`);
        this.dirs.add(dir);
      }
    });
  }
}

/** The path of the directory the file a path's names name is in. */
function parentPath(names: readonly string[]): string {
  return names.length <= 1 ? '/' : `/${names.slice(0, -1).join('/')}`;
}
