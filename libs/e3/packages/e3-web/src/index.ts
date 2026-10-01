/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 in a browser: the page's connection to its e3 worker, and the seams the
 * e3 worker runs e3 over — its storage over IndexedDB, OPFS and Web Locks,
 * its runner over a pool of Web Workers, and its transfers.
 *
 * `createWebE3` connects a page to its e3 worker, whose script calls
 * `serveE3()` from `@elaraai/e3-web/worker`, and gives the page the `fetch`
 * the worker answers, with the URL e3's client is given. The seams the e3
 * worker runs: `openWebStorage` opens e3's storage backend — `WebStorage`,
 * over the four adapters below — and `WebStateStore` keeps a dataflow run's
 * state beside it; `WebTaskRunner` runs a repository's units on the workers of
 * a `UnitPool`: Web Workers whose script calls `serveUnits()` from
 * `@elaraai/e3-web/units`, or, for a test in Node, workers in this thread
 * (`inProcessUnits`); and `WebTransferBackend` stages uploads and runs the
 * jobs, and `createWebDataEndpoints` answers the byte URLs it gives. This entry reaches nothing of Node, so a page or a worker bundles it.
 * The files adapter over the machine's files is `@elaraai/e3-web/node`.
 *
 * @packageDocumentation
 */

export { createWebE3, type WebE3, type WebE3Options } from './bridge/page.js';

export {
  DEFAULT_EXPORT_ROUND_BYTES,
  DEFAULT_RECORD_RETENTION_MS,
  DEFAULT_RESULT_TTL_MS,
  DEFAULT_RETENTION_INTERVAL_MS,
  DEFAULT_WEB_PART_BYTES,
  WebTransferBackend,
  type TransferKind,
  type WebTransferBackendOptions,
} from './transfer/WebTransferBackend.js';

export { createWebDataEndpoints, type WebDataEndpoints } from './transfer/endpoints.js';

export {
  DEFAULT_WHOLE_INTAKE_LIMIT,
  NO_COMMANDS,
  WEB_RUNNER,
  WebTaskRunner,
  type WebTaskRunnerOptions,
} from './execution/WebTaskRunner.js';

export { UnitPool, type UnitConnection, type UnitPoolOptions, type UnitRun, type UnitRunOptions } from './execution/pool.js';

export { inProcessUnits, type InProcessUnitsOptions } from './execution/in-process.js';

export type { HostMessage, UnitFile, UnitWorker, WorkerMessage } from './execution/protocol.js';

export type { UnitPlatformContext, UnitPlatformPackage, UnitPlatforms } from './execution/unit-server.js';

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
  FILE_READ_CHUNK,
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
  type FilesOptions,
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
