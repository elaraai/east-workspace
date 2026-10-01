/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Records in IndexedDB.
 *
 * A database holds one object store of records, each keyed by its
 * {@link RecordKey} — an array of strings, which IndexedDB orders part by
 * part — and holding its bytes. A transaction is an IndexedDB `readwrite`
 * transaction, so transactions over one database, from any tab, run one after
 * another wherever they touch the same records.
 *
 * @packageDocumentation
 */

import {
  AdapterClosedError,
  RecordsTransactionError,
  checkRecordKey,
  checkScan,
  copyBytes,
  type RecordEntry,
  type RecordKey,
  type RecordScan,
  type RecordsAdapter,
  type RecordsTransaction,
} from './adapters.js';

/** The object store every record is in. */
const STORE = 'records';

/** The database's version: its one object store, since its first. */
const VERSION = 1;

/**
 * How {@link openIndexedDbRecords} and {@link deleteIndexedDbRecords} reach
 * IndexedDB.
 */
export interface IndexedDbOptions {
  /** The IndexedDB to open the database in: the global `indexedDB` unless
   *  given */
  readonly factory?: IDBFactory;
}

/** The global IndexedDB, unless the page has none. */
function factoryOf(options: IndexedDbOptions): IDBFactory {
  const factory = options.factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (factory === undefined) throw new Error('IndexedDB is not available here');
  return factory;
}

/** What an IndexedDB request answers, once it has. */
function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('an IndexedDB request failed'));
  });
}

/**
 * Opens the records of a database, making the database when it is not there.
 *
 * @param name - The database's name
 * @param options - The IndexedDB to open it in
 * @returns The records
 * @throws {Error} When the page has no IndexedDB, or the database will not
 *   open
 *
 * @example
 * ```ts
 * const records = await openIndexedDbRecords('e3');
 * await records.transact(async (tx) => { tx.put(['refs', 'main'], bytes); });
 * ```
 */
export async function openIndexedDbRecords(name: string, options: IndexedDbOptions = {}): Promise<IndexedDbRecords> {
  const factory = factoryOf(options);
  const request = factory.open(name, VERSION);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE);
  };
  request.onblocked = () => {
    // An older version is open elsewhere: the request waits until it closes.
  };
  return new IndexedDbRecords(await settle(request), factory);
}

/**
 * Deletes a database, and every record in it, once every connection to it has
 * closed: an adapter over it closes its connection when asked to.
 *
 * @param name - The database's name
 * @param options - The IndexedDB it is in
 */
export async function deleteIndexedDbRecords(name: string, options: IndexedDbOptions = {}): Promise<void> {
  await settle(factoryOf(options).deleteDatabase(name));
}

/** The key range of the records under a prefix a scan asks for, or `null`
 *  when there are none. */
function rangeOf(factory: IDBFactory, prefix: RecordKey, options: RecordScan): IDBKeyRange | null {
  let lower: IDBValidKey = [...prefix];
  let lowerOpen = false;
  if (options.after !== undefined && factory.cmp([...options.after], lower) >= 0) {
    lower = [...options.after];
    lowerOpen = true;
  }
  // An array sorts after every string, so every key under the prefix sorts
  // before the prefix followed by an empty array.
  let upper: IDBValidKey = [...prefix, []];
  if (options.before !== undefined && factory.cmp([...options.before], upper) < 0) {
    upper = [...options.before];
  }
  const order = factory.cmp(lower, upper);
  if (order > 0 || (order === 0 && lowerOpen)) return null;
  return IDBKeyRange.bound(lower, upper, lowerOpen, true);
}

/**
 * The error an operation on a transaction IndexedDB has made inactive
 * answers: {@link RecordsTransactionError}, for the inactive transaction's
 * errors, and the error itself for any other.
 */
function inactive(err: unknown): unknown {
  if (err instanceof DOMException && (err.name === 'TransactionInactiveError' || err.name === 'InvalidStateError')) {
    return new RecordsTransactionError('its work awaited something else, and IndexedDB ended it');
  }
  return err;
}

/** A record's bytes as IndexedDB answers them. */
function bytesOf(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new TypeError('a record in IndexedDB holds something other than bytes');
  return value;
}

/** A key as IndexedDB answers it. */
function keyOf(key: IDBValidKey): RecordKey {
  if (!Array.isArray(key) || !key.every((part) => typeof part === 'string')) {
    throw new TypeError('a record in IndexedDB has a key other than a list of strings');
  }
  return key as string[];
}

/** Reads the keys a scan asks for, from an object store. */
async function scanKeys(store: IDBObjectStore, factory: IDBFactory, prefix: RecordKey, options: RecordScan): Promise<RecordKey[]> {
  const range = rangeOf(factory, prefix, options);
  if (range === null) return [];
  if (options.reverse !== true) return (await settle(store.getAllKeys(range, options.limit))).map(keyOf);
  const keys: RecordKey[] = [];
  const cursor = store.openKeyCursor(range, 'prev');
  await new Promise<void>((resolve, reject) => {
    cursor.onerror = () => reject(cursor.error ?? new Error('an IndexedDB cursor failed'));
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (at === null || keys.length === options.limit) return resolve();
      keys.push(keyOf(at.key));
      at.continue();
    };
  });
  return keys;
}

/** Reads the records a scan asks for, from an object store. */
async function scanEntries(store: IDBObjectStore, factory: IDBFactory, prefix: RecordKey, options: RecordScan): Promise<RecordEntry[]> {
  const range = rangeOf(factory, prefix, options);
  if (range === null) return [];
  if (options.reverse !== true) {
    const [keys, values] = await Promise.all([settle(store.getAllKeys(range, options.limit)), settle(store.getAll(range, options.limit))]);
    return keys.map((key, i) => ({ key: keyOf(key), value: bytesOf(values[i]) }));
  }
  const entries: RecordEntry[] = [];
  const cursor = store.openCursor(range, 'prev');
  await new Promise<void>((resolve, reject) => {
    cursor.onerror = () => reject(cursor.error ?? new Error('an IndexedDB cursor failed'));
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (at === null || entries.length === options.limit) return resolve();
      entries.push({ key: keyOf(at.key), value: bytesOf(at.value) });
      at.continue();
    };
  });
  return entries;
}

/**
 * Records in an IndexedDB database: the {@link RecordsAdapter} of a browser.
 *
 * @remarks
 * A transaction is one IndexedDB `readwrite` transaction, which IndexedDB
 * commits the moment it has nothing to do. Work that awaits anything but the
 * transaction's own operations lets it commit early, and is refused with
 * {@link RecordsTransactionError}: an operation after that throws it, and so
 * does the transaction once its work finishes — what the work wrote before
 * the early commit has applied.
 */
export class IndexedDbRecords implements RecordsAdapter {
  private closed = false;

  /**
   * @param db - The open database
   * @param factory - The IndexedDB it is in, which orders keys
   * @internal
   */
  constructor(private readonly db: IDBDatabase, private readonly factory: IDBFactory) {
    // A deletion or an upgrade elsewhere waits for this connection to close.
    db.onversionchange = () => {
      this.closed = true;
      db.close();
    };
    // The browser closed it: its storage was cleared, say.
    db.onclose = () => {
      this.closed = true;
    };
  }

  /** A transaction over the records, unless the adapter is closed. */
  private transaction(mode: IDBTransactionMode): IDBTransaction {
    if (this.closed) throw new AdapterClosedError('records');
    return this.db.transaction(STORE, mode);
  }

  async get(key: RecordKey): Promise<Uint8Array | null> {
    checkRecordKey(key);
    const value: unknown = await settle(this.transaction('readonly').objectStore(STORE).get([...key]));
    return value === undefined ? null : bytesOf(value);
  }

  async scan(prefix: RecordKey, options: RecordScan = {}): Promise<RecordEntry[]> {
    checkRecordKey(prefix);
    checkScan(options);
    return scanEntries(this.transaction('readonly').objectStore(STORE), this.factory, prefix, options);
  }

  async keys(prefix: RecordKey, options: RecordScan = {}): Promise<RecordKey[]> {
    checkRecordKey(prefix);
    checkScan(options);
    return scanKeys(this.transaction('readonly').objectStore(STORE), this.factory, prefix, options);
  }

  async transact<T>(work: (tx: RecordsTransaction) => Promise<T>): Promise<T> {
    const transaction = this.transaction('readwrite');
    const tx = new IndexedDbTransaction(transaction.objectStore(STORE), this.factory);
    let committed = false;
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => {
        committed = true;
        tx.end('it had committed, as IndexedDB commits a transaction with nothing to do');
        resolve();
      };
      transaction.onabort = () => {
        tx.end('it had been aborted');
        reject(transaction.error ?? new Error('the IndexedDB transaction was aborted'));
      };
    });
    let result: T;
    try {
      result = await work(tx);
    } catch (err) {
      tx.end('its work had failed');
      try {
        transaction.abort();
      } catch {
        // It has committed or aborted already.
      }
      await done.catch(() => undefined);
      throw err;
    }
    tx.end('it was used after its work had finished');
    // Committing a transaction that is no longer active fails: it is
    // committing, or has committed, on its own — its work went on to
    // something else while it had nothing to do.
    let active = !committed;
    if (active) {
      try {
        transaction.commit();
      } catch {
        active = false;
      }
    }
    await done;
    if (!active) throw new RecordsTransactionError('its work awaited something else, and IndexedDB committed it early');
    return result;
  }

  close(): Promise<void> {
    this.closed = true;
    this.db.close();
    return Promise.resolve();
  }
}

/** A transaction's view of the records: an IndexedDB `readwrite`
 *  transaction's object store. */
class IndexedDbTransaction implements RecordsTransaction {
  /** Why the transaction takes no more operations, once it takes none */
  private ended: string | null = null;

  constructor(private readonly store: IDBObjectStore, private readonly factory: IDBFactory) {}

  /** Ends the transaction, for a reason an operation after gives. */
  end(reason: string): void {
    this.ended ??= reason;
  }

  /** Makes IndexedDB requests of the transaction, or throws when it can take
   *  none: it has ended, or IndexedDB has made it inactive. */
  private request<R>(make: () => R): R {
    if (this.ended !== null) throw new RecordsTransactionError(this.ended);
    try {
      return make();
    } catch (err) {
      throw inactive(err);
    }
  }

  async get(key: RecordKey): Promise<Uint8Array | null> {
    checkRecordKey(key);
    const value: unknown = await settle(this.request(() => this.store.get([...key])));
    return value === undefined ? null : bytesOf(value);
  }

  async scan(prefix: RecordKey, options: RecordScan = {}): Promise<RecordEntry[]> {
    checkRecordKey(prefix);
    checkScan(options);
    try {
      return await this.request(() => scanEntries(this.store, this.factory, prefix, options));
    } catch (err) {
      throw inactive(err);
    }
  }

  async keys(prefix: RecordKey, options: RecordScan = {}): Promise<RecordKey[]> {
    checkRecordKey(prefix);
    checkScan(options);
    try {
      return await this.request(() => scanKeys(this.store, this.factory, prefix, options));
    } catch (err) {
      throw inactive(err);
    }
  }

  put(key: RecordKey, value: Uint8Array): void {
    checkRecordKey(key);
    // A copy of exactly the bytes: IndexedDB keeps the whole buffer a view
    // is into.
    this.request(() => this.store.put(copyBytes(value), [...key]));
  }

  delete(key: RecordKey): void {
    checkRecordKey(key);
    this.request(() => this.store.delete([...key]));
  }

  deletePrefix(prefix: RecordKey): void {
    checkRecordKey(prefix);
    this.request(() => this.store.delete(IDBKeyRange.bound([...prefix], [...prefix, []], false, true)));
  }
}
