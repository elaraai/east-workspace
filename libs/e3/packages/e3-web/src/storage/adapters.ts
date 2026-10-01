/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The four adapters e3-web keeps a repository over.
 *
 * A browser keeps e3's records in IndexedDB, its objects as files in the
 * origin private file system (OPFS), and its locks with Web Locks, and names
 * files by OPFS paths. Node, and a page that keeps nothing past a reload, keep
 * the same in memory and name the machine's files. Each is an adapter with two
 * or more implementations that answer alike, so e3-web's stores are written
 * once, over these interfaces, and every contract suite runs in Node as it runs
 * in Chromium.
 *
 * - {@link RecordsAdapter}: records, keyed and ordered, written in
 *   transactions — the refs, dataset refs, execution records, lock states and
 *   gc notes a store keeps, and the compare-and-swap `writeIf` needs;
 * - {@link BlobsAdapter}: blobs, read whole or by range — the objects;
 * - {@link LocksAdapter}: named locks, exclusive and shared, taken by a
 *   session that lives as long as its tab, whose liveness another tab asks;
 * - {@link FilesAdapter}: the files `ObjectStore.adoptFile` and
 *   `ObjectStore.materialize` name by path.
 *
 * @packageDocumentation
 */

// =============================================================================
// Records
// =============================================================================

/**
 * A record's key: its parts, in order.
 *
 * @remarks
 * Keys order part by part, a part by its UTF-16 code units, and a key before
 * every key it is a prefix of, as IndexedDB orders a key that is an array of
 * strings: `['a'] < ['a', ''] < ['a', 'b'] < ['a', 'b', 'c'] < ['ab'] < ['b']`.
 * A key's parts are strings, the empty string among them; a key may have no
 * parts at all.
 */
export type RecordKey = readonly string[];

/**
 * A record: its key and its bytes.
 */
export interface RecordEntry {
  /** The record's key */
  readonly key: RecordKey;
  /** The record's bytes: the store's own copy, which the caller may change */
  readonly value: Uint8Array;
}

/**
 * Which records under a prefix a scan returns, and in what order.
 */
export interface RecordScan {
  /** Only the records whose keys sort after this one */
  readonly after?: RecordKey;
  /** Only the records whose keys sort before this one */
  readonly before?: RecordKey;
  /** At most this many: a whole number greater than zero */
  readonly limit?: number;
  /** The last key first, rather than the first */
  readonly reverse?: boolean;
}

/**
 * What reads records: an adapter, outside a transaction, or a transaction.
 */
export interface RecordsRead {
  /**
   * Reads a record.
   *
   * @param key - The record's key
   * @returns Its bytes, or `null` when there is no record of this key
   * @throws {TypeError} When the key is not a list of strings
   */
  get(key: RecordKey): Promise<Uint8Array | null>;

  /**
   * Reads the records under a prefix, in key order: every record whose key
   * begins with the prefix's parts, the prefix's own among them.
   *
   * @param prefix - The parts every key returned begins with; `[]` for every
   *   record
   * @param options - Where the scan starts and ends, how many it returns, and
   *   from which end
   * @returns The records, in the order the options ask
   * @throws {TypeError} When a key is not a list of strings
   * @throws {RangeError} When the limit is not a whole number greater than zero
   */
  scan(prefix: RecordKey, options?: RecordScan): Promise<RecordEntry[]>;

  /**
   * Reads the keys under a prefix, as {@link scan} reads their records.
   *
   * @param prefix - The parts every key returned begins with
   * @param options - Where the scan starts and ends, how many it returns, and
   *   from which end
   * @returns The keys, in the order the options ask
   * @throws {TypeError} When a key is not a list of strings
   * @throws {RangeError} When the limit is not a whole number greater than zero
   */
  keys(prefix: RecordKey, options?: RecordScan): Promise<RecordKey[]>;
}

/**
 * A transaction's view of the records: what its reads return and its writes
 * change, all applied together or none of them.
 *
 * @remarks
 * A transaction's reads see its own writes. A write returns at once and
 * applies with the transaction, so a failed write fails the transaction.
 *
 * A transaction lives only as long as its work keeps it busy. Its work awaits
 * its own operations and nothing else — no timer, no fetch, no digest, no
 * other store — because IndexedDB commits a transaction the moment it has
 * nothing to do, and every adapter holds its transactions to that. An
 * operation on a transaction whose work has gone on to anything else, or has
 * finished, fails with {@link RecordsTransactionError}: a read rejects with
 * it, and a write throws it.
 */
export interface RecordsTransaction extends RecordsRead {
  /**
   * Writes a record, replacing any of its key.
   *
   * @param key - The record's key
   * @param value - Its bytes, which the store copies
   * @throws {TypeError} When the key is not a list of strings
   * @throws {RecordsTransactionError} When the transaction has ended
   */
  put(key: RecordKey, value: Uint8Array): void;

  /**
   * Deletes a record, if there is one.
   *
   * @param key - The record's key
   * @throws {TypeError} When the key is not a list of strings
   * @throws {RecordsTransactionError} When the transaction has ended
   */
  delete(key: RecordKey): void;

  /**
   * Deletes every record under a prefix, the prefix's own among them.
   *
   * @param prefix - The parts every key deleted begins with
   * @throws {TypeError} When the prefix is not a list of strings
   * @throws {RecordsTransactionError} When the transaction has ended
   */
  deletePrefix(prefix: RecordKey): void;
}

/**
 * Records, keyed and ordered, written in transactions.
 *
 * @remarks
 * Transactions over one store — in one tab or several, through one adapter or
 * several — run one after another wherever they touch the same records, so a
 * transaction that reads a record and writes it back loses no other's write:
 * the compare-and-swap a dataset ref's `writeIf` and a repository's status
 * need. A read outside a transaction sees each transaction whole or not at
 * all.
 *
 * @example
 * ```ts
 * // Compare-and-swap: write the record only if it holds what was read
 * const swapped = await records.transact(async (tx) => {
 *   const current = await tx.get(['refs', 'main']);
 *   if (!equalBytes(current, expected)) return false;
 *   tx.put(['refs', 'main'], next);
 *   return true;
 * });
 * ```
 */
export interface RecordsAdapter extends RecordsRead {
  /**
   * Runs `work` as one transaction: its writes apply together once it
   * resolves, and none of them when it throws.
   *
   * @param work - The transaction's work, which awaits only the
   *   transaction's own operations
   * @returns What `work` resolves to
   * @throws What `work` throws, having applied none of its writes
   * @throws {RecordsTransactionError} When `work` awaited anything but the
   *   transaction's own operations: a write after that never applies, and
   *   one before it may have, as IndexedDB commits what the transaction had
   *   written when it found it with nothing to do
   * @throws {AdapterClosedError} When the adapter is closed
   */
  transact<T>(work: (tx: RecordsTransaction) => Promise<T>): Promise<T>;

  /**
   * Closes the adapter. The records stay in the store for the next adapter
   * over it; this one refuses every call after.
   */
  close(): Promise<void>;
}

/**
 * A records transaction was used past its life: its work awaited something
 * other than the transaction's own operations, or went on using the
 * transaction once it had finished.
 */
export class RecordsTransactionError extends Error {
  constructor(reason: string) {
    super(`records transaction: ${reason} — a transaction's work awaits its own operations and nothing else`);
    this.name = 'RecordsTransactionError';
  }
}

// =============================================================================
// Blobs
// =============================================================================

/**
 * A blob's key: its parts, in order, at least one and none empty.
 *
 * @remarks
 * Keys order as record keys do ({@link RecordKey}). A key may be a blob and a
 * prefix of other blobs' keys at once: `['a']` and `['a', 'b']` are two blobs.
 * Keys that differ only in case are different keys.
 */
export type BlobKey = readonly string[];

/**
 * What a blob's size and age are.
 */
export interface BlobStat {
  /** Its size in bytes */
  readonly size: number;
  /** When it was last written, in milliseconds since the epoch */
  readonly lastModified: number;
}

/**
 * A blob a listing found: its key, size and age.
 */
export interface BlobInfo extends BlobStat {
  /** The blob's key */
  readonly key: BlobKey;
}

/**
 * The bytes a write stores: all at once, or a chunk at a time.
 */
export type ByteSource = Uint8Array | AsyncIterable<Uint8Array>;

/**
 * What a sweep of abandoned writes did, or in a dry run would do.
 */
export interface BlobSweepResult {
  /** What writes that never finished left, removed */
  readonly deleted: number;
  /** What was left because it is younger than the age gate: a write that may
   *  still be in flight */
  readonly skippedYoung: number;
}

/**
 * Blobs, read whole or by range, written whole.
 *
 * @remarks
 * A write replaces a blob whole, and a reader sees the blob before the write
 * or after it, never part of one: a new blob is there only once its write
 * has finished, and a write that fails leaves the blob as it was.
 *
 * @example
 * ```ts
 * await blobs.write(['objects', hash], chunks);
 * const head = await blobs.readRange(['objects', hash], 0, 16);
 * ```
 */
export interface BlobsAdapter {
  /**
   * Reads a blob whole.
   *
   * @param key - The blob's key
   * @returns Its bytes, or `null` when there is no blob of this key
   * @throws {TypeError} When the key is not a blob key
   */
  read(key: BlobKey): Promise<Uint8Array | null>;

  /**
   * Reads a range of a blob without reading the rest of it.
   *
   * @param key - The blob's key
   * @param offset - The byte the range starts at
   * @param length - How many bytes it holds
   * @returns The range's bytes, short only where the blob ends, or `null` when
   *   there is no blob of this key
   * @throws {TypeError} When the key is not a blob key
   * @throws {RangeError} When the offset or the length is not a whole number
   *   of zero or more
   */
  readRange(key: BlobKey, offset: number, length: number): Promise<Uint8Array | null>;

  /**
   * Reads a blob's size and age.
   *
   * @param key - The blob's key
   * @returns Its size and age, or `null` when there is no blob of this key
   * @throws {TypeError} When the key is not a blob key
   */
  stat(key: BlobKey): Promise<BlobStat | null>;

  /**
   * Writes a blob, replacing any of its key.
   *
   * @param key - The blob's key
   * @param data - Its bytes, all at once or a chunk at a time; the store
   *   keeps its own copy
   * @returns Its size in bytes
   * @throws {TypeError} When the key is not a blob key
   * @throws What the chunks' source throws, leaving the blob as it was
   */
  write(key: BlobKey, data: ByteSource): Promise<number>;

  /**
   * Deletes a blob.
   *
   * @param key - The blob's key
   * @returns Whether there was a blob of this key
   * @throws {TypeError} When the key is not a blob key
   */
  delete(key: BlobKey): Promise<boolean>;

  /**
   * Deletes every blob under a prefix, the prefix's own among them.
   *
   * @param prefix - The parts every key deleted begins with; `[]` for every
   *   blob
   * @throws {TypeError} When a part is empty
   */
  deletePrefix(prefix: BlobKey): Promise<void>;

  /**
   * Lists the blobs under a prefix, the prefix's own among them, in key
   * order.
   *
   * @param prefix - The parts every key listed begins with; `[]` for every
   *   blob
   * @returns Each blob's key, size and age
   * @throws {TypeError} When a part is empty
   */
  list(prefix: BlobKey): Promise<BlobInfo[]>;

  /**
   * Removes what writes that never finished left behind — a tab closed mid
   * write, say — older than an age gate; a store whose writes leave nothing
   * behind removes nothing.
   *
   * @param options - `minAge`: the age in milliseconds below which a leftover
   *   may be a write still in flight, and is left, `0` for none;
   *   `dryRun`: count, and remove nothing
   * @returns What it removed, or in a dry run would, and what it left as too
   *   young
   */
  sweep(options: { readonly minAge: number; readonly dryRun: boolean }): Promise<BlobSweepResult>;
}

// =============================================================================
// Locks
// =============================================================================

/**
 * How a lock is held: `exclusive`, against every other request, or `shared`
 * with other shared holds.
 */
export type LockMode = 'exclusive' | 'shared';

/**
 * How {@link LocksAdapter.acquire} asks for a lock.
 */
export interface LockRequest {
  /** Wait for the lock when it cannot be taken at once, rather than refuse */
  readonly wait?: boolean;
  /** When waiting, how long to wait, in milliseconds: unset, until the lock
   *  is free. A lock that can be taken at once is taken whatever this is. */
  readonly timeout?: number;
}

/**
 * A lock held.
 */
export interface LockHold {
  /** Releases the lock. Safe to call more than once: the first releases it. */
  release(): Promise<void>;
}

/**
 * Named locks, taken by a session: in a browser, the tab.
 *
 * @remarks
 * Every adapter answers as Web Locks do. A name is held by any number of
 * shared holds or one exclusive hold. Requests for a name that wait are
 * granted in the order they were made: a request that cannot be granted yet
 * waits behind the ones before it, and a request that does not wait is
 * refused while any other waits, so a waiting exclusive request is never
 * passed over by shared ones.
 *
 * A session lives until it is closed, or its tab is: then every lock it holds
 * is free, and {@link isAlive} answers `false` for it — which is how a tab
 * judges a lock or an execution another tab recorded, as a process judges
 * another's by its pid.
 */
export interface LocksAdapter {
  /** The session every lock of this adapter is held by: a holder's `bootId` */
  readonly session: string;

  /**
   * Takes a lock.
   *
   * @param name - The lock's name
   * @param mode - How to hold it
   * @param options - Whether to wait for it, and how long
   * @returns The hold, or `null` when the lock was not taken: at once, or in
   *   the time given, or before the session closed
   * @throws {AdapterClosedError} When the session is closed
   * @throws {TypeError} When the mode is neither `exclusive` nor `shared`
   * @throws {RangeError} When the timeout is not a whole number of
   *   milliseconds, zero or more
   */
  acquire(name: string, mode: LockMode, options?: LockRequest): Promise<LockHold | null>;

  /**
   * Reads how a lock is held, by any session.
   *
   * @param name - The lock's name
   * @returns The mode of each hold on it: none when it is free
   * @throws {AdapterClosedError} When the session is closed
   */
  held(name: string): Promise<LockMode[]>;

  /**
   * Answers whether a session is alive: open, in a tab that is open.
   *
   * @param session - The session, as a holder's `bootId` names it
   * @returns Whether it is alive; `false` for a session no adapter opened
   * @throws {AdapterClosedError} When this session is closed
   */
  isAlive(session: string): Promise<boolean>;

  /**
   * Closes the session: every lock it holds is released, and every request of
   * it still waiting is refused.
   */
  close(): Promise<void>;
}

// =============================================================================
// Files
// =============================================================================

/**
 * What a file's size and age are.
 */
export interface FileStat {
  /** Its size in bytes */
  readonly size: number;
  /** When it was last written, in milliseconds since the epoch */
  readonly lastModified: number;
}

/**
 * Files named by path: the machine's in Node, OPFS files in a browser.
 *
 * @remarks
 * A path means what its adapter's files mean: a path on the machine for the
 * machine's files, and an absolute path of `/`-separated names for OPFS and
 * memory files. A write replaces a file whole, and a reader sees the file
 * before the write or after it.
 */
export interface FilesAdapter {
  /**
   * Reads a file's size and age.
   *
   * @param path - The file's path
   * @returns Its size and age, or `null` when there is no file at the path
   */
  stat(path: string): Promise<FileStat | null>;

  /**
   * Reads a file a chunk at a time, never whole.
   *
   * @param path - The file's path
   * @returns The file's bytes, in order, a chunk at a time
   * @throws {FileNotFoundError} As it is read, when there is no file at the
   *   path
   */
  read(path: string): AsyncIterable<Uint8Array>;

  /**
   * Writes a file, replacing any at the path.
   *
   * @param path - The file's path, in a directory that exists
   * @param data - Its bytes, all at once or a chunk at a time
   * @returns Its size in bytes
   * @throws {FileNotFoundError} When the file's directory does not exist
   * @throws What the chunks' source throws, leaving the file as it was
   */
  write(path: string, data: ByteSource): Promise<number>;

  /**
   * Removes a file.
   *
   * @param path - The file's path
   * @returns Whether there was a file at the path; a directory there is left
   */
  remove(path: string): Promise<boolean>;

  /**
   * Makes a directory, and every directory above it that does not exist.
   * Making one that exists does nothing.
   *
   * @param path - The directory's path
   */
  mkdir(path: string): Promise<void>;
}

/**
 * A file, or the directory a file is written into, is not there.
 */
export class FileNotFoundError extends Error {
  /**
   * @param path - The path that names nothing
   */
  constructor(public readonly path: string) {
    super(`no such file or directory: ${path}`);
    this.name = 'FileNotFoundError';
  }
}

// =============================================================================
// Shared
// =============================================================================

/**
 * An adapter was used after it was closed.
 */
export class AdapterClosedError extends Error {
  /**
   * @param adapter - What was closed: `records`, `locks`, …
   */
  constructor(public readonly adapter: string) {
    super(`the ${adapter} adapter is closed`);
    this.name = 'AdapterClosedError';
  }
}

/**
 * Compares two keys in the order records and blobs keep: part by part, a part
 * by its UTF-16 code units, and a key before every key it is a prefix of.
 *
 * @param a - A key
 * @param b - Another key
 * @returns Less than zero when `a` sorts first, more when `b` does, and zero
 *   when they are the same key
 *
 * @example
 * ```ts
 * [['b'], ['a', 'b'], ['a']].sort(compareKeys); // [['a'], ['a', 'b'], ['b']]
 * ```
 */
export function compareKeys(a: readonly string[], b: readonly string[]): number {
  const common = Math.min(a.length, b.length);
  for (let i = 0; i < common; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x !== y) return x < y ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * Answers whether a key is under a prefix: begins with the prefix's parts, or
 * is the prefix.
 *
 * @param key - The key
 * @param prefix - The prefix
 * @returns Whether the key begins with every part of the prefix
 */
export function isUnder(key: readonly string[], prefix: readonly string[]): boolean {
  if (key.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (key[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * Checks a record key is a list of strings.
 *
 * @param key - The key
 * @throws {TypeError} When it is not
 */
export function checkRecordKey(key: RecordKey): void {
  if (!Array.isArray(key) || !key.every((part) => typeof part === 'string')) {
    throw new TypeError(`a record key is a list of strings, not ${describeKey(key)}`);
  }
}

/**
 * Checks a blob key has a part, and that none of its parts is empty.
 *
 * @param key - The key
 * @throws {TypeError} When it has none, or an empty one
 */
export function checkBlobKey(key: BlobKey): void {
  checkBlobPrefix(key);
  if (key.length === 0) throw new TypeError('a blob key has at least one part');
}

/**
 * Checks a blob prefix: a list of strings none of which is empty, or `[]`.
 *
 * @param prefix - The prefix
 * @throws {TypeError} When a part is not a string, or is empty
 */
export function checkBlobPrefix(prefix: BlobKey): void {
  if (!Array.isArray(prefix) || !prefix.every((part) => typeof part === 'string' && part.length > 0)) {
    throw new TypeError(`a blob key is a list of strings none of which is empty, not ${describeKey(prefix)}`);
  }
}

/**
 * Checks what a scan asks: a limit, when there is one, is a whole number
 * greater than zero.
 *
 * @param options - The scan's options
 * @throws {TypeError} When a bound is not a list of strings
 * @throws {RangeError} When the limit is not a whole number greater than zero
 */
export function checkScan(options: RecordScan): void {
  if (options.after !== undefined) checkRecordKey(options.after);
  if (options.before !== undefined) checkRecordKey(options.before);
  const { limit } = options;
  if (limit !== undefined && !(Number.isSafeInteger(limit) && limit > 0)) {
    throw new RangeError(`a scan's limit is a whole number greater than zero, not ${limit}`);
  }
}

/**
 * Checks a byte range: its offset and length are whole numbers of zero or
 * more.
 *
 * @param offset - The byte the range starts at
 * @param length - How many bytes it holds
 * @throws {RangeError} When either is not
 */
export function checkRange(offset: number, length: number): void {
  for (const [what, value] of [['offset', offset], ['length', length]] as const) {
    if (!(Number.isSafeInteger(value) && value >= 0)) {
      throw new RangeError(`a range's ${what} is a whole number of zero or more, not ${value}`);
    }
  }
}

/**
 * Checks how a lock is asked for: its mode is `exclusive` or `shared`, and a
 * timeout, when there is one, is a whole number of milliseconds, zero or more.
 *
 * @param mode - How the lock is to be held
 * @param options - Whether to wait for it, and how long
 * @throws {TypeError} When the mode is neither
 * @throws {RangeError} When the timeout is not a whole number of zero or more
 */
export function checkLockRequest(mode: LockMode, options: LockRequest): void {
  if (mode !== 'exclusive' && mode !== 'shared') {
    throw new TypeError(`a lock is held exclusive or shared, not ${describeKey(mode)}`);
  }
  const { timeout } = options;
  if (timeout !== undefined && !(Number.isSafeInteger(timeout) && timeout >= 0)) {
    throw new RangeError(`a lock's timeout is a whole number of milliseconds, zero or more, not ${timeout}`);
  }
}

/**
 * A copy of bytes that shares no memory with them, and holds only them: what a
 * store keeps, so a caller that changes its bytes after a write, or those a
 * read returned, changes nothing stored.
 *
 * @param bytes - The bytes
 * @returns A copy of exactly those bytes
 */
export function copyBytes(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}

/**
 * What `answer` returns, as a promise that rejects with what it throws: so a
 * method that answers at once fails as every method does, by rejecting.
 *
 * @param answer - What answers
 * @returns Its answer
 */
export function attempt<T>(answer: () => T): Promise<T> {
  try {
    return Promise.resolve(answer());
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(`${err as string}`));
  }
}

/**
 * The bytes a source yields, a chunk at a time: the one chunk of bytes given
 * whole, or each chunk of a stream.
 *
 * @param data - The source
 * @returns Its chunks, in order
 */
export async function* chunksOf(data: ByteSource): AsyncIterable<Uint8Array> {
  if (data instanceof Uint8Array) {
    yield data;
    return;
  }
  for await (const chunk of data) yield chunk;
}

/** A key as a message names it. */
function describeKey(key: unknown): string {
  try {
    return JSON.stringify(key) ?? String(key);
  } catch {
    return String(key);
  }
}
