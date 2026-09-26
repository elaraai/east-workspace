/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Storage abstraction interfaces for e3 repositories.
 *
 * These interfaces enable e3-core logic to work against different backends:
 * - `LocalStorage`: a repository directory on a filesystem — the CLI, the API
 *   server and the VS Code extension
 * - `InMemoryStorage`: maps in memory, for tests
 * - the cloud's backend, S3 objects and DynamoDB refs, in `elaraai/e3-cloud`
 *
 * The core insight: e3-core business logic is storage-agnostic. By injecting
 * a StorageBackend, the same code can run locally or in the cloud.
 *
 * Every method is required. A capability a backend could leave out — ranged
 * reads, adopting a file, placing an object at a path, the owner and plan
 * records of an execution, the adoption memo — would need a fallback in every
 * caller, and the fallbacks were whole-object reads.
 */

import type { ExecutionOwner, ExecutionStatus, LockState, LockOperation, LockHolderVariant, DataflowRun, DatasetRef, RepoMetadata, RepoStatus } from '@elaraai/e3-types';
import type { LockHolderInfo } from '../errors.js';

// Re-export lock types for consumers of this module
export type { LockState, LockOperation, LockHolderInfo };

// =============================================================================
// Repository Lifecycle Types
// =============================================================================

export type { RepoMetadata, RepoStatus };

/** The name of a repository status: `creating`, `active`, `gc` or `deleting`. */
export type RepoStatusName = RepoStatus['type'];

/**
 * Result from batch operations (resumable pattern).
 *
 * Operations return { status: 'continue', cursor } if more work remains,
 * or { status: 'done' } when complete. This enables Step Functions orchestration.
 */
export interface BatchResult {
  /** 'continue' if more batches remain, 'done' if complete */
  status: 'continue' | 'done';
  /** Opaque cursor for next batch (only present if status='continue') */
  cursor?: string;
  /** Number of items deleted in this batch */
  deleted: number;
}

// =============================================================================
// GC Primitives
// =============================================================================


/**
 * A single object entry returned by gcScanObjects.
 */
export interface GcObjectEntry {
  /** SHA256 hash of the object */
  hash: string;
  /** Last modification time (epoch ms) */
  lastModified: number;
  /** Size of the object in bytes */
  size: number;
}

/**
 * Result from scanning root hashes for GC (paginated).
 */
export interface GcRootScanResult {
  /** Root object hashes in this batch */
  roots: string[];
  /** Opaque cursor for next batch; undefined means scan is complete */
  cursor?: unknown;
}

/**
 * Result from scanning objects for GC.
 */
export interface GcObjectScanResult {
  /** Object entries in this batch */
  objects: GcObjectEntry[];
  /** Opaque cursor for next batch; undefined means scan is complete */
  cursor?: unknown;
}

// =============================================================================
// Object Store
// =============================================================================

/**
 * Content-addressed object storage.
 *
 * Objects are immutable and identified by their SHA256 hash.
 * The store handles deduplication automatically.
 *
 * All methods take `repo` as first parameter to identify the repository.
 * For local storage, `repo` is the path to the e3 repository directory.
 * For cloud storage, `repo` is a repository identifier used as a key prefix.
 */
export interface ObjectStore {
  /**
   * Write data to the object store.
   * @param repo - Repository identifier
   * @param data - Raw bytes to store
   * @returns SHA256 hash of the data
   */
  write(repo: string, data: Uint8Array): Promise<string>;

  /**
   * Write data from a stream to the object store.
   * @param repo - Repository identifier
   * @param stream - Async iterable of chunks
   * @returns SHA256 hash of the data
   */
  writeStream(repo: string, stream: AsyncIterable<Uint8Array>): Promise<string>;

  /**
   * Read an object by hash.
   * @param repo - Repository identifier
   * @param hash - SHA256 hash of the object
   * @returns Raw bytes
   * @throws {ObjectNotFoundError} If object doesn't exist
   */
  read(repo: string, hash: string): Promise<Uint8Array>;

  /**
   * Read a byte range of an object without buffering it whole.
   *
   * A file, or an S3 ranged GET, serves one, so the paged dataset endpoint and
   * every reader of a collection stay O(range) in memory. Ranges past the end
   * return the available bytes (objects are immutable and sized via
   * {@link stat}, so callers can always request exact ranges).
   *
   * @param repo - Repository identifier
   * @param hash - SHA256 hash of the object
   * @param offset - Byte offset to start reading at
   * @param length - Number of bytes to read
   * @returns The requested bytes (short only at end of object)
   * @throws {ObjectNotFoundError} If object doesn't exist
   */
  readRange(repo: string, hash: string, offset: number, length: number): Promise<Uint8Array>;

  /**
   * Take an existing file into the store as an object, without reading it
   * into this process.
   *
   * A backend whose objects are files links it, so a large file becomes an
   * object without being copied; one whose objects are elsewhere streams it
   * there. Either way the object's hash is the SHA256 of the bytes the store
   * took, checked against `hash` before anything is stored under it.
   *
   * The file is never opened for writing and its mode and mtime are left
   * alone. A backend may hard-link it, so the caller's contract is that the
   * file is immutable from here on: modifying it IN PLACE afterwards would
   * change the bytes stored under a hash that no longer describes them.
   * (Replacing it — a new delivery written to a fresh inode — is exactly the
   * intended workflow and is safe.)
   *
   * @param repo - Repository identifier
   * @param file - Path to the file to adopt
   * @param hash - The file's SHA256 when the caller already streamed it;
   *   otherwise the backend computes it
   * @returns The object's hash and size
   * @throws {Error} When the file does not hash to `hash` — one replaced since
   *   the caller hashed it — in which case nothing is stored under `hash`
   */
  adoptFile(repo: string, file: string, hash?: string): Promise<{ hash: string; size: number }>;

  /**
   * Place an object's bytes at `destPath`, without reading them into this
   * process.
   *
   * A backend whose objects are files links or kernel-copies one, so staging a
   * task's inputs never puts an object on the orchestrator's heap; one whose
   * objects are elsewhere streams it down.
   *
   * A link makes the staged file share the object's storage, so a consumer
   * that could WRITE to it must ask for `link: false`. The stock runners only
   * ever read their inputs; a `custom` runner is an arbitrary command.
   *
   * @param repo - Repository identifier
   * @param hash - SHA256 hash of the object
   * @param destPath - Where to place the bytes; its directory must exist
   * @param options - `link: false` forbids sharing storage with the object
   * @throws {ObjectNotFoundError} If object doesn't exist
   */
  materialize(repo: string, hash: string, destPath: string, options?: { link?: boolean }): Promise<void>;

  /**
   * Check if an object exists.
   * @param repo - Repository identifier
   * @param hash - SHA256 hash of the object
   * @returns true if object exists
   */
  exists(repo: string, hash: string): Promise<boolean>;

  /**
   * Get the size of an object without reading its contents.
   * @param repo - Repository identifier
   * @param hash - SHA256 hash of the object
   * @returns Object metadata including size in bytes
   * @throws {ObjectNotFoundError} If object doesn't exist
   */
  stat(repo: string, hash: string): Promise<{ size: number }>;

  /**
   * List all object hashes in the store.
   * Used for garbage collection.
   * @param repo - Repository identifier
   * @returns Array of hashes
   */
  list(repo: string): Promise<string[]>;

  /**
   * Count objects in the store.
   * More efficient than list() when only the count is needed.
   * @param repo - Repository identifier
   * @returns Number of objects
   */
  count(repo: string): Promise<number>;
}

// =============================================================================
// Reference Store
// =============================================================================

/**
 * Mutable reference storage for packages, workspaces, and executions.
 *
 * Unlike objects, references can be updated and deleted.
 * All methods take `repo` as first parameter to identify the repository.
 */
export interface RefStore {
  // -------------------------------------------------------------------------
  // Package References
  // -------------------------------------------------------------------------

  /**
   * List all packages with their versions.
   * @param repo - Repository identifier
   * @returns Array of {name, version} pairs
   */
  packageList(repo: string): Promise<{ name: string; version: string }[]>;

  /**
   * Resolve a package reference to its hash.
   * @param repo - Repository identifier
   * @param name - Package name
   * @param version - Package version
   * @returns Package object hash, or null if not found
   */
  packageResolve(repo: string, name: string, version: string): Promise<string | null>;

  /**
   * Write a package reference.
   * @param repo - Repository identifier
   * @param name - Package name
   * @param version - Package version
   * @param hash - Package object hash
   */
  packageWrite(repo: string, name: string, version: string, hash: string): Promise<void>;

  /**
   * Remove a package reference.
   * @param repo - Repository identifier
   * @param name - Package name
   * @param version - Package version
   */
  packageRemove(repo: string, name: string, version: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Workspace State
  // -------------------------------------------------------------------------

  /**
   * List all workspace names.
   * @param repo - Repository identifier
   * @returns Array of workspace names
   */
  workspaceList(repo: string): Promise<string[]>;

  /**
   * Read a workspace's record.
   * @param repo - Repository identifier
   * @param name - Workspace name
   * @returns The encoded `WorkspaceRecordType`, or null if there is no
   *   workspace of this name
   */
  workspaceRead(repo: string, name: string): Promise<Uint8Array | null>;

  /**
   * Write a workspace's record.
   * @param repo - Repository identifier
   * @param name - Workspace name
   * @param state - The encoded `WorkspaceRecordType`: `none` until a package
   *   is deployed, then its state
   */
  workspaceWrite(repo: string, name: string, state: Uint8Array): Promise<void>;

  /**
   * Remove a workspace: its state, its dataflow execution state and its run
   * records, so none of them passes to a workspace of the same name.
   * @param repo - Repository identifier
   * @param name - Workspace name
   */
  workspaceRemove(repo: string, name: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Execution Cache (with execution history)
  // -------------------------------------------------------------------------

  /**
   * Get execution status for a specific execution.
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - Execution ID (UUIDv7)
   * @returns ExecutionStatus or null if not found
   */
  executionGet(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<ExecutionStatus | null>;

  /**
   * Write execution status.
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - Execution ID (UUIDv7)
   * @param status - Execution status
   */
  executionWrite(repo: string, taskHash: string, inputsHash: string, executionId: string, status: ExecutionStatus): Promise<void>;

  /**
   * Delete an execution attempt's record: its status and its owner. gc, which
   * bounds the history a repository keeps, removes the attempt's logs first,
   * through the log store.
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - Execution ID (UUIDv7)
   */
  executionDelete(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<void>;

  /**
   * List all execution IDs for a (taskHash, inputsHash) pair.
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @returns Array of executionId values (sorted lexicographically ascending)
   */
  executionListIds(repo: string, taskHash: string, inputsHash: string): Promise<string[]>;

  /**
   * Get the latest execution status (lexicographically greatest executionId).
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @returns ExecutionStatus or null if no executions exist
   */
  executionGetLatest(repo: string, taskHash: string, inputsHash: string): Promise<ExecutionStatus | null>;

  /**
   * List all executions in the repository.
   * @param repo - Repository identifier
   * @returns Array of {taskHash, inputsHash} pairs
   */
  executionList(repo: string): Promise<{ taskHash: string; inputsHash: string }[]>;

  /**
   * List executions for a specific task.
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @returns Array of inputsHash values
   */
  executionListForTask(repo: string, taskHash: string): Promise<string[]>;

  /**
   * List the latest execution status for every inputsHash of a task.
   *
   * Semantically equivalent to executionListForTask + executionGetLatest per
   * entry, but exposed as one call so backends can serve the whole set in a
   * single round trip. This matters for remote stores: workspaceStatus calls
   * this once per task, and composing it client-side from N individual
   * lookups made status requests O(repo history) network round trips — the
   * DynamoDB backend's listing query already fetches the status bytes it
   * would then re-fetch one by one.
   *
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @returns Latest execution status per inputsHash (order unspecified)
   */
  executionListLatest(repo: string, taskHash: string): Promise<Array<{ inputsHash: string; status: ExecutionStatus }>>;

  /**
   * Record the orchestrator that launched an execution, beside its status. A
   * stale `running` record is repaired only where a dead owner is recorded.
   *
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - Execution ID (UUIDv7)
   * @param owner - The orchestrator process
   */
  executionOwnerWrite(repo: string, taskHash: string, inputsHash: string, executionId: string, owner: ExecutionOwner): Promise<void>;

  /**
   * Read the orchestrator that launched an execution.
   *
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - Execution ID (UUIDv7)
   * @returns The owner, or null when none is recorded
   */
  executionOwnerRead(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<ExecutionOwner | null>;

  /**
   * Point the execution of a task split into pieces at the `$plan` of the
   * stage it is in. It roots the plan for garbage collection while the
   * execution can resume, and a run of the task takes the stage it names up
   * again. `null` clears it, when the execution ends.
   *
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param planHash - Hash of the `$plan` object, or `null` to clear it
   */
  executionPlanWrite(repo: string, taskHash: string, inputsHash: string, planHash: string | null): Promise<void>;

  /**
   * Read the `$plan` the execution of a task split into pieces is in.
   *
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @returns The plan object hash, or null when none is recorded
   */
  executionPlanRead(repo: string, taskHash: string, inputsHash: string): Promise<string | null>;

  // -------------------------------------------------------------------------
  // Adoption Memo
  // -------------------------------------------------------------------------

  /**
   * Record the collection a delivered file was stored as: the file's SHA-256
   * and the manifest the store's door split it into.
   *
   * A delivery is read and split into segment objects when it is adopted, so
   * its own hash names no object. This is what lets an adoption, or a transfer
   * init, of the same bytes find the manifest without reading them again.
   *
   * @param repo - Repository identifier
   * @param sourceHash - SHA-256 of the delivered bytes
   * @param manifestHash - Hash of the manifest they were stored as
   */
  adoptionWrite(repo: string, sourceHash: string, manifestHash: string): Promise<void>;

  /**
   * Read the manifest a delivered file was stored as.
   *
   * An entry is a memo, not a garbage-collection root: the manifest may have
   * been collected since, which the caller checks.
   *
   * @param repo - Repository identifier
   * @param sourceHash - SHA-256 of the delivered bytes
   * @returns The manifest's hash, or null when none is recorded
   */
  adoptionRead(repo: string, sourceHash: string): Promise<string | null>;

  // -------------------------------------------------------------------------
  // Dataflow Run History
  // -------------------------------------------------------------------------

  /**
   * Get a specific dataflow run.
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param runId - Run ID (UUIDv7)
   * @returns DataflowRun or null if not found
   */
  dataflowRunGet(repo: string, workspace: string, runId: string): Promise<DataflowRun | null>;

  /**
   * Write a dataflow run.
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param run - The dataflow run record
   */
  dataflowRunWrite(repo: string, workspace: string, run: DataflowRun): Promise<void>;

  /**
   * List all run IDs for a workspace (sorted lexicographically ascending).
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @returns Array of runId values
   */
  dataflowRunList(repo: string, workspace: string): Promise<string[]>;

  /**
   * Get the latest dataflow run for a workspace.
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @returns DataflowRun or null if no runs exist
   */
  dataflowRunGetLatest(repo: string, workspace: string): Promise<DataflowRun | null>;

  /**
   * Delete a specific dataflow run.
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param runId - Run ID (UUIDv7)
   */
  dataflowRunDelete(repo: string, workspace: string, runId: string): Promise<void>;
}

// =============================================================================
// Lock Service
// =============================================================================

/**
 * Handle to a held lock.
 */
export interface LockHandle {
  /** The resource this lock is for */
  readonly resource: string;
  /** Release the lock. Safe to call multiple times. */
  release(): Promise<void>;
}

/**
 * Workspace locking service mediating concurrent access.
 *
 * A second implementation (e.g. the cloud's DynamoDB-lease backend) must honour
 * this mutual-exclusion contract, which is the contract e3-core relies on:
 *
 * - `exclusive` excludes every other holder (shared and exclusive). Deploy and
 *   remove take it, so they fence out all readers/writers.
 * - `shared` coexists with other `shared` holders but is excluded by an
 *   `exclusive` holder. Dataflow execution and record mutation take it, so they
 *   run concurrently with each other yet never overlap a deploy.
 *
 * The lock state is stored using the LockState type from e3-types, whose holder
 * is a local process or a cloud function. All methods (except isHolderAlive)
 * take `repo` as the first parameter.
 */
export interface LockService {
  /**
   * Acquire a lock on a resource in the requested mode (default `exclusive`).
   *
   * Returns null if the mode is incompatible with a current holder per the
   * shared/exclusive contract above (unless `wait` is set, in which case it
   * blocks up to `timeout`). The implementation gathers holder information
   * (process ID for local, request ID for Lambda, etc.) and writes the lock
   * state.
   *
   * @param repo - Repository identifier
   * @param resource - Resource identifier (e.g., "workspaces/production")
   * @param operation - What operation is acquiring the lock
   * @param options - Lock options (`mode` defaults to `exclusive`)
   * @returns Lock handle, or null if the lock couldn't be acquired
   */
  acquire(
    repo: string,
    resource: string,
    operation: LockOperation,
    options?: { wait?: boolean; timeout?: number; mode?: 'shared' | 'exclusive' }
  ): Promise<LockHandle | null>;

  /**
   * Get the current lock state.
   * @param repo - Repository identifier
   * @param resource - Resource identifier
   * @returns Lock state, or null if not locked
   */
  getState(repo: string, resource: string): Promise<LockState | null>;

  /**
   * Check if a lock holder is still alive.
   *
   * For local process locks, checks if the PID is still running.
   * For cloud locks, checks expiry or queries the cloud service.
   *
   * @param holder - The holder a lock's state names
   * @returns true if the holder is still active
   */
  isHolderAlive(holder: LockHolderVariant): Promise<boolean>;
}

// =============================================================================
// Log Store
// =============================================================================

/**
 * A chunk of log output.
 */
export interface LogChunk {
  /** Log content (UTF-8) */
  data: string;
  /** Byte offset of this chunk */
  offset: number;
  /** Bytes in this chunk */
  size: number;
  /** Total log file size (for pagination) */
  totalSize: number;
  /** True if this is the end of the file */
  complete: boolean;
}

/**
 * Log storage for execution stdout/stderr.
 * All methods take `repo` as first parameter to identify the repository.
 */
export interface LogStore {
  /**
   * Append data to a log stream.
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - Execution ID (UUIDv7)
   * @param stream - 'stdout' or 'stderr'
   * @param data - Data to append
   */
  append(
    repo: string,
    taskHash: string,
    inputsHash: string,
    executionId: string,
    stream: 'stdout' | 'stderr',
    data: string
  ): Promise<void>;

  /**
   * Read from a log stream.
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - Execution ID (UUIDv7)
   * @param stream - 'stdout' or 'stderr'
   * @param options - Read options
   * @returns Log chunk
   */
  read(
    repo: string,
    taskHash: string,
    inputsHash: string,
    executionId: string,
    stream: 'stdout' | 'stderr',
    options?: { offset?: number; limit?: number }
  ): Promise<LogChunk>;

  // Note: The options.limit parameter corresponds to a maximum bytes to read.
  // The returned LogChunk.size indicates actual bytes read.
  // The returned LogChunk.complete indicates if end of file was reached.

  /**
   * Remove both streams of an execution attempt's logs.
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - Execution ID (UUIDv7)
   */
  remove(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<void>;
}

// =============================================================================
// Repository Store
// =============================================================================

/**
 * Repository lifecycle management.
 *
 * Handles repo creation, deletion, status tracking, and GC.
 * Follows the sub-interface pattern (storage.repos.*) like other stores.
 */
export interface RepoStore {
  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * List all repository names.
   * @returns Array of repository names
   */
  list(): Promise<string[]>;

  /**
   * Check if a repository exists.
   * @param repo - Repository name
   * @returns true if repository exists
   */
  exists(repo: string): Promise<boolean>;

  /**
   * Get repository metadata.
   * @param repo - Repository name
   * @returns Metadata or null if not found
   */
  getMetadata(repo: string): Promise<RepoMetadata | null>;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Create a new repository.
   * Sets status to 'active' after initialization.
   * @param repo - Repository name
   * @throws {RepoAlreadyExistsError} If repository already exists
   */
  create(repo: string): Promise<void>;

  /**
   * Atomically set repository status.
   * Used for CAS (compare-and-swap) operations.
   * @param repo - Repository name
   * @param status - New status
   * @param expected - Optional expected current status (single or array) for CAS
   * @throws {RepoNotFoundError} If repository doesn't exist
   * @throws {RepoStatusConflictError} If expected status doesn't match
   */
  setStatus(repo: string, status: RepoStatusName, expected?: RepoStatusName | RepoStatusName[]): Promise<void>;

  /**
   * Remove repository metadata/tombstone.
   * Called after GC completes for 'deleting' repos.
   * @param repo - Repository name
   */
  remove(repo: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Batched Deletion (Resumable)
  // -------------------------------------------------------------------------

  /**
   * Delete all refs for a repo in batches.
   * Loop until status='done'.
   * @param repo - Repository name
   * @param cursor - Cursor from previous call (undefined for first call)
   * @returns Batch result with status and optional cursor
   */
  deleteRefsBatch(repo: string, cursor?: string): Promise<BatchResult>;

  /**
   * Delete all objects for a repo in batches.
   * Loop until status='done'.
   * @param repo - Repository name
   * @param cursor - Cursor from previous call (undefined for first call)
   * @returns Batch result with status and optional cursor
   */
  deleteObjectsBatch(repo: string, cursor?: string): Promise<BatchResult>;

  // -------------------------------------------------------------------------
  // GC Primitives (data-access only; algorithm lives in e3-core gc.ts)
  // -------------------------------------------------------------------------

  /**
   * Scan package references for root hashes.
   * @param repo - Repository name
   * @param cursor - Opaque cursor from previous call (undefined for first call)
   * @returns Root hashes and optional cursor for next batch
   */
  gcScanPackageRoots(repo: string, cursor?: unknown): Promise<GcRootScanResult>;

  /**
   * Scan workspace state for root hashes.
   * @param repo - Repository name
   * @param cursor - Opaque cursor from previous call (undefined for first call)
   * @returns Root hashes and optional cursor for next batch
   */
  gcScanWorkspaceRoots(repo: string, cursor?: unknown): Promise<GcRootScanResult>;

  /**
   * Scan execution history for root hashes.
   * @param repo - Repository name
   * @param cursor - Opaque cursor from previous call (undefined for first call)
   * @returns Root hashes and optional cursor for next batch
   */
  gcScanExecutionRoots(repo: string, cursor?: unknown): Promise<GcRootScanResult>;

  /**
   * Scan object catalogue entries for GC.
   * @param repo - Repository name
   * @param cursor - Opaque cursor from previous call (undefined for first call)
   * @returns Object entries and optional cursor for next batch
   */
  gcScanObjects(repo: string, cursor?: unknown): Promise<GcObjectScanResult>;

  /**
   * Delete objects by hash. Idempotent — safe to retry on failure.
   * @param repo - Repository name
   * @param hashes - Object hashes to delete
   */
  gcDeleteObjects(repo: string, hashes: string[]): Promise<void>;
}

// =============================================================================
// Dataset Ref Store
// =============================================================================

/**
 * Per-dataset reference storage for reactive dataflow.
 *
 * Each dataset in a workspace has its own ref file tracking its current
 * value and version vector. This replaces the single rootHash approach,
 * enabling concurrent writes and reactive re-execution.
 *
 * A local repository keeps a ref at `workspaces/<ws>/data/<path>.beast2`,
 * where `<path>` uses directory separators (e.g. `inputs/sales.beast2`).
 */
export interface DatasetRefStore {
  /**
   * Read a dataset ref.
   * @param repo - Repository identifier
   * @param ws - Workspace name
   * @param path - Dataset path (e.g., "inputs/sales" for .inputs.sales)
   * @returns DatasetRef or null if ref doesn't exist
   */
  read(repo: string, ws: string, path: string): Promise<DatasetRef | null>;

  /**
   * Write a dataset ref atomically.
   *
   * Unconditional, last-writer-wins. Used by callers that already serialize
   * writes under a workspace lock (deploy, dataflow output writes). For
   * concurrent writers that must not clobber each other, use {@link writeIf}.
   *
   * @param repo - Repository identifier
   * @param ws - Workspace name
   * @param path - Dataset path (e.g., "inputs/sales" for .inputs.sales)
   * @param ref - The dataset ref to write
   */
  write(repo: string, ws: string, path: string, ref: DatasetRef): Promise<void>;

  /**
   * Read a dataset ref together with an opaque revision token.
   *
   * The revision identifies one write of the ref; pass it back to
   * {@link writeIf} to make a conditional write that only succeeds if nothing
   * changed in between. The token is store-specific and meaningful only to the
   * same store (a token minted per write locally, a counter in memory, a
   * DynamoDB revision attribute in the cloud) — never compare tokens across
   * stores.
   *
   * @param repo - Repository identifier
   * @param ws - Workspace name
   * @param path - Dataset path
   * @returns The ref and its revision, or null if the ref does not exist
   */
  readVersioned(repo: string, ws: string, path: string): Promise<{ ref: DatasetRef; revision: string } | null>;

  /**
   * Conditionally write a dataset ref iff the stored revision still matches.
   *
   * The compare-and-swap primitive behind reactive-dataflow consistency: a
   * caller reads a revision with {@link readVersioned}, decides on a new ref,
   * and commits it only if no concurrent writer slipped in. Serialized
   * per-path so the read-compare-write is atomic across processes.
   *
   * @param repo - Repository identifier
   * @param ws - Workspace name
   * @param path - Dataset path
   * @param ref - The ref to write
   * @param expectedRevision - Revision from {@link readVersioned}; null means
   *   "the ref must not currently exist"
   * @returns The new revision on success
   * @throws {DatasetRefConflictError} If the stored revision no longer matches
   */
  writeIf(
    repo: string,
    ws: string,
    path: string,
    ref: DatasetRef,
    expectedRevision: string | null
  ): Promise<{ revision: string }>;

  /**
   * List all dataset ref paths in a workspace.
   * @param repo - Repository identifier
   * @param ws - Workspace name
   * @returns Array of dataset paths (e.g., ["inputs/sales", "tasks/etl/output"])
   */
  list(repo: string, ws: string): Promise<string[]>;

  /**
   * Remove a single dataset ref.
   * @param repo - Repository identifier
   * @param ws - Workspace name
   * @param path - Dataset path
   */
  remove(repo: string, ws: string, path: string): Promise<void>;

  /**
   * Remove all dataset refs for a workspace.
   * @param repo - Repository identifier
   * @param ws - Workspace name
   */
  removeAll(repo: string, ws: string): Promise<void>;
}

// =============================================================================
// Combined Storage Backend
// =============================================================================

/**
 * Complete storage backend combining all storage interfaces.
 *
 * This is the main abstraction point for e3-core. Functions receive a
 * StorageBackend instead of a repoPath, allowing the same logic to work
 * against different storage implementations.
 */
export interface StorageBackend {
  /** Content-addressed object storage */
  readonly objects: ObjectStore;

  /** Mutable reference storage */
  readonly refs: RefStore;

  /** Distributed locking service */
  readonly locks: LockService;

  /** Execution log storage */
  readonly logs: LogStore;

  /** Repository lifecycle management */
  readonly repos: RepoStore;

  /** Per-dataset reference storage (reactive dataflow) */
  readonly datasets: DatasetRefStore;

  /**
   * Validate that a repository exists and is properly structured.
   * @param repo - Repository identifier (path to e3 repository directory for local storage)
   * @throws {RepoNotFoundError} If repository doesn't exist or is invalid
   */
  validateRepository(repo: string): Promise<void>;
}
