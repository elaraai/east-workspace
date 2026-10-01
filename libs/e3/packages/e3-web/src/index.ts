/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 in a browser: its storage over IndexedDB, OPFS and Web Locks.
 *
 * `openWebStorage` opens e3's storage backend in a page — `WebStorage`, over
 * the four adapters below — and `WebStateStore` keeps a dataflow run's state
 * beside it. This entry reaches nothing of Node, so a page or a worker
 * bundles it. The files adapter over the machine's files is
 * `@elaraai/e3-web/node`.
 *
 * @packageDocumentation
 */

export {
  WEB_REPOSITORY_UPGRADES,
  WebStorage,
  openWebStorage,
  type WebAdapters,
  type WebStorageOptions,
} from './storage/WebStorage.js';

export { WebStateStore } from './storage/WebStateStore.js';

export {
  AdapterClosedError,
  FileNotFoundError,
  RecordsTransactionError,
  compareKeys,
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
  type RecordsRead,
  type RecordsTransaction,
} from './storage/adapters.js';

export {
  MemoryBlobs,
  MemoryFiles,
  MemoryLockSpace,
  MemoryLocks,
  MemoryRecordStore,
  MemoryRecords,
  openMemoryRecords,
} from './storage/memory.js';

export {
  IndexedDbRecords,
  deleteIndexedDbRecords,
  openIndexedDbRecords,
  type IndexedDbOptions,
} from './storage/indexeddb.js';

export { OpfsBlobs, OpfsFiles, opfsDirectory } from './storage/opfs.js';

export { WebLocks, openWebLocks, sessionLockName, type WebLocksOptions } from './storage/web-locks.js';
