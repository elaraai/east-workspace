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

import type { ExecutionOwner, ExecutionStatus, LockState, LockOperation, LockHolderVariant, LockProgress, DataflowRun, DatasetRef, RepoMetadata, RepoStatus, RepositoryRecord } from '@elaraai/e3-types';
import type { LockHolderInfo } from '../errors.js';

// Re-export lock types for consumers of this module
export type { LockState, LockOperation, LockProgress, LockHolderInfo };

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
  /**
   * When a sweep beside running work first saw the object unreachable (epoch
   * ms), as {@link RepoStore.gcNoteUnreachable} noted it; `null` while no
   * note stands: none was made, or a write or a re-reference of the object
   * cleared it.
   */
  unreachableSince: number | null;
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
  /**
   * Opaque cursor for next batch; undefined means scan is complete. A string,
   * so a gc run in steps keeps it between them.
   */
  cursor?: string;
}

/**
 * How {@link RepoStore.gcSweepBackend} sweeps.
 */
export interface GcBackendSweepOptions {
  /** Minimum age in milliseconds of a staging file it removes: a younger one
   *  may be a write in flight */
  minAge: number;
  /** Whether to count what it would remove, and remove nothing */
  dryRun: boolean;
  /**
   * Whether gc holds the repository still, as `repoGc` does unless it is
   * given a retention window. When it does not, work runs beside the sweep,
   * so the backend removes nothing a running task may be using — a local
   * repository's built environments, say — and only what the age gate proves
   * abandoned.
   */
  held: boolean;
}

/**
 * What {@link RepoStore.gcSweepBackend} removed, or in a dry run would.
 */
export interface GcBackendSweepResult {
  /** Staging files of writes and transfers that never finished, removed */
  deletedPartials: number;
  /** Staging files left because they are younger than the age gate */
  skippedYoung: number;
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
 *
 * Every write re-references the object it stores, as {@link touch} does,
 * whether it stores the bytes or finds them stored already.
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
   * Re-reference objects the store holds, as a write of their bytes would,
   * without sending them: what a caller does before it roots objects it did
   * not write.
   *
   * @remarks
   * A package import skipping objects the store holds, an adoption the memo
   * answers, and a call naming an object by its hash each root objects
   * nothing may have named for a while. gc beside running work deletes an
   * object only if nothing wrote or re-referenced it since a sweep first saw
   * it unreachable ({@link RepoStore.gcDeleteUnreachable}), so an object
   * touched and then rooted within gc's retention window is never lost: the
   * touch clears the object's unreachable note, as every write does. It
   * answers true only for an object a racing delete leaves in place.
   *
   * It takes objects by the batch — a collection's segments, a zip's objects —
   * so a store whose re-references are requests makes them a batch at a time:
   * a caller re-referencing a large collection inside a request pays a request
   * per batch, not per segment. Each object is re-referenced on its own, and
   * the answers are in the order given.
   *
   * A touch re-references the objects alone. A caller rooting an object that
   * names others — a manifest, a record's state — touches what it names too:
   * `touchReachable` does both.
   *
   * @param repo - Repository identifier
   * @param hashes - SHA256 hashes of the objects
   * @returns For each object, in the order given, true when the store holds
   *   it, and false when it does not
   */
  touch(repo: string, hashes: readonly string[]): Promise<boolean[]>;

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
   * How {@link materialize} places an object: `link` where objects are files
   * on this machine, which it links or copies in the kernel, so placing one
   * transfers nothing; `download` where they are elsewhere, so placing one
   * transfers its bytes.
   *
   * @remarks
   * A unit's staging goes by it. Where placing is a link, every object a unit
   * may read is placed whole, since nothing is saved by placing less. Where it
   * is a download, only what the unit reads is placed: a run of a stored
   * delivery's segments, for an intake, as a blob of its own by ranged reads.
   */
  readonly placement: 'link' | 'download';

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
  // Repository Record
  // -------------------------------------------------------------------------

  /**
   * Read the repository's record: the release of e3 that last wrote it, and
   * the store upgrades the repository has had.
   *
   * @param repo - Repository identifier
   * @returns The record, or null when the repository has none that reads: an
   *   e3 from before repositories recorded their upgrades wrote it
   */
  repositoryRead(repo: string): Promise<RepositoryRecord | null>;

  /**
   * Write the repository's record, replacing the one there. A reader sees the
   * old record or the new one, never a torn one.
   *
   * @param repo - Repository identifier
   * @param record - The record
   */
  repositoryWrite(repo: string, record: RepositoryRecord): Promise<void>;

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
   *
   * @remarks
   * A record that is there and does not decode — a crash or a failing disk
   * left it so — is `ExecutionCorruptError`, which gc takes for an attempt that
   * keeps nothing. Any other failure is a failure to read, and gc decides
   * nothing without the record, so a backend throws that error for a record
   * that does not decode, and for nothing else.
   *
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - Execution ID (UUIDv7)
   * @returns ExecutionStatus or null if not found
   * @throws {ExecutionCorruptError} When the record is there and does not
   *   decode
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
   * and the manifest it was taken in as — or, while an intake of a large
   * delivery is under way, a piece of it, under a key of its own.
   *
   * A delivery is taken in as segment objects, so its own hash names no
   * object. This is what lets an adoption, or a transfer init, of the same
   * bytes find the manifest without reading them again, and an intake stopped
   * part way take up the pieces it finished.
   *
   * @param repo - Repository identifier
   * @param sourceHash - SHA-256 of the delivered bytes, or a piece's key, a
   *   SHA-256 too
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

  /**
   * List every entry of the adoption memo: what gc reads to drop the entries
   * whose manifest it has collected.
   *
   * @param repo - Repository identifier
   * @returns Each entry's key and the manifest it names — null for an entry
   *   that does not read — in no particular order
   */
  adoptionList(repo: string): Promise<Array<{ sourceHash: string; manifestHash: string | null }>>;

  /**
   * Forget an entry of the adoption memo: a delivery's pieces, once the
   * delivery itself is remembered, or an entry whose manifest gc collected.
   * Forgetting one that is not there does nothing.
   *
   * @param repo - Repository identifier
   * @param sourceHash - The entry's key
   */
  adoptionDelete(repo: string, sourceHash: string): Promise<void>;

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
  /**
   * Record how far the operation holding the lock has got, for another process
   * to read through {@link LockService.getProgress} while the lock is held.
   *
   * @remarks
   * Each report replaces the last, and the release takes it away, so what a
   * reader sees is always the live holder's. Only an exclusive holder's report
   * is kept: a shared holder's is ignored.
   *
   * @param progress - How far the operation has got
   */
  report(progress: LockProgress): Promise<void>;
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
   * Null is the answer for a holder, and for nothing else: a caller reports a
   * null as the resource held (a gc, a deploy, a running dataflow), so any
   * other failure to take the lock is thrown as itself.
   *
   * @param repo - Repository identifier
   * @param resource - Resource identifier (e.g., "workspaces/production")
   * @param operation - What operation is acquiring the lock
   * @param options - Lock options (`mode` defaults to `exclusive`)
   * @returns Lock handle, or null if a current holder's mode excludes it
   * @throws {InvalidNameError} When the resource is a name the store cannot key
   *   by
   * @throws When the store fails to take the lock for any other reason
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
   * How far the operation holding a resource exclusively says it has got.
   *
   * @param repo - Repository identifier
   * @param resource - Resource identifier
   * @returns What its holder last reported through {@link LockHandle.report},
   *   or null when the resource is not held exclusively, or its holder has
   *   reported nothing
   */
  getProgress(repo: string, resource: string): Promise<LockProgress | null>;

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
 *
 * @remarks
 * Once an execution's record says it has ended, its log is whole for every
 * reader: e3 flushes an attempt's log ({@link LogStore.flush}) after its last
 * append and before it records how the attempt ended. The one log this cannot
 * make whole is that of an execution whose host died before its end, which a
 * later probe records `interrupted`: it is what its store made readable
 * before the host died.
 */
export interface LogStore {
  /**
   * Append data to a log stream. What it appends is readable by every reader
   * once the attempt's log is flushed ({@link flush}), or sooner.
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
   * Make both streams of an execution attempt's log readable by every reader,
   * as they stand once every append made before the flush has resolved.
   *
   * @remarks
   * A store may resolve an append before its data is readable elsewhere: one
   * whose storage has no append of its own gathers appends into fewer, larger
   * writes. Such a store writes what it holds of the attempt's log here. e3
   * records how an attempt ended only once its log is flushed — a runner's
   * attempt (`ExecutionAttempt`), a split task's own execution (`SplitTask`)
   * and an execution a package import files — so a reader that finds an
   * execution ended reads its whole log. A store whose appends are readable
   * once they resolve, as the local, in-memory and browser stores' are, does
   * nothing; nor does a flush of a log nothing appended to.
   *
   * @param repo - Repository identifier
   * @param taskHash - Task object hash
   * @param inputsHash - Combined input hashes
   * @param executionId - Execution ID (UUIDv7)
   */
  flush(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<void>;

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
 *
 * Its lifecycle names a repository as {@link RepoStore.list} does; its gc
 * primitives take the identifier the other stores take. A local repository's
 * are its directory's name and its path, and its gc runs without the
 * directory the repositories are in.
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
   * Create a new repository, with its record: this release and every store
   * upgrade this e3 knows (`newRepositoryRecord`), since a new repository is
   * in the forms they write.
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
   * Scan object catalogue entries for GC, a page at a time, each with the
   * unreachable note that stands for it. It changes nothing, so a dry run
   * scans as any run does.
   * @param repo - Repository name
   * @param cursor - Opaque cursor from previous call (undefined for first call)
   * @returns Object entries and optional cursor for next batch
   */
  gcScanObjects(repo: string, cursor?: string): Promise<GcObjectScanResult>;

  /**
   * Delete objects by hash, unconditionally: gc holding the repository still
   * deletes so, since nothing writes while it runs. Their unreachable notes go
   * with them. Idempotent — safe to retry on failure.
   * @param repo - Repository name
   * @param hashes - Object hashes to delete
   */
  gcDeleteObjects(repo: string, hashes: string[]): Promise<void>;

  /**
   * Note when a sweep beside running work first saw objects unreachable: gc
   * deletes such an object only once it has stayed unreachable for its
   * retention window, measured from this note.
   *
   * @remarks
   * A note that stands is kept, so the window runs from the first sweep that
   * saw the object unreachable. A write or a re-reference of the object
   * ({@link ObjectStore.touch}) clears its note, and so does
   * {@link gcClearUnreachable} once a mark reaches the object again.
   *
   * @param repo - Repository identifier
   * @param hashes - The objects the sweep found unreachable
   * @param at - When the sweep saw them (epoch ms)
   * @returns The time each object's note stands at, in the order given: `at`,
   *   or an earlier sweep's
   */
  gcNoteUnreachable(repo: string, hashes: readonly string[], at: number): Promise<number[]>;

  /**
   * Clear the unreachable notes of objects a mark reached. Clearing an object
   * with no note does nothing.
   *
   * @param repo - Repository identifier
   * @param hashes - The objects the mark reached
   */
  gcClearUnreachable(repo: string, hashes: readonly string[]): Promise<void>;

  /**
   * Delete an object a sweep beside running work found unreachable for gc's
   * retention window, while its note still stands at `since`: unless nothing
   * wrote or re-referenced it since. Its note goes with it.
   *
   * @remarks
   * The delete is conditional on the note, never on the scan that found the
   * object: a write, or a {@link ObjectStore.touch}, clears the note, so a
   * delete that races a re-reference leaves the object, and a touch answers
   * true only for an object the delete leaves.
   *
   * A store that keeps versions of an object deletes the one the note stood
   * over, and any older, never one written after the conditional delete: a
   * write that lands after it stores its bytes anew, and that version stays.
   *
   * @param repo - Repository identifier
   * @param hash - The object
   * @param since - The time its note stood at when the sweep decided
   * @returns true when it deleted the object; false when its note no longer
   *   stands at `since`, or the object is gone
   */
  gcDeleteUnreachable(repo: string, hash: string, since: number): Promise<boolean>;

  /**
   * Keep a part of a gc run in steps between its steps: the roots the history
   * kept, and the mark's reachable set, in shards. A part written again
   * replaces the last.
   *
   * @param repo - Repository identifier
   * @param run - The run's id, a UUIDv7
   * @param name - The part's name: lowercase letters, digits and dots
   * @param data - Its bytes: an East value, as beast2
   */
  gcRunWrite(repo: string, run: string, name: string, data: Uint8Array): Promise<void>;

  /**
   * Read a part of a gc run in steps.
   *
   * @param repo - Repository identifier
   * @param run - The run's id, a UUIDv7
   * @param name - The part's name
   * @returns Its bytes, or null when the run has no such part
   */
  gcRunRead(repo: string, run: string, name: string): Promise<Uint8Array | null>;

  /**
   * Delete a gc run in steps, every part of it: once it is done, or given up.
   * Deleting a run that is not there does nothing.
   *
   * @param repo - Repository identifier
   * @param run - The run's id, a UUIDv7
   */
  gcRunDelete(repo: string, run: string): Promise<void>;

  /**
   * Sweep what the backend keeps beside a repository's objects and records,
   * which gc's mark does not reach: a local repository's staging files of
   * writes and transfers that never finished, the scratch directories of
   * orchestrators that have exited, the built environments no kept object
   * names, and the unreachable notes a delete cut short left of objects
   * already gone. A backend that keeps nothing of the kind sweeps nothing. gc
   * calls it last: holding the repository still, or beside running work, as
   * `options.held` says.
   *
   * @param repo - Repository identifier
   * @param reachable - The objects gc's mark reached
   * @param options - The age gate, whether this is a dry run, and whether gc
   *   holds the repository still
   * @returns What it removed, or in a dry run would
   */
  gcSweepBackend(repo: string, reachable: ReadonlySet<string>, options: GcBackendSweepOptions): Promise<GcBackendSweepResult>;
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
// Repository Upgrades
// =============================================================================

/**
 * A change to the forms a repository keeps its records in, which the release
 * that makes it ships, and which an e3 opening a repository written before it
 * applies in place (`repositoryOpen`).
 *
 * @remarks
 * A change to a record's East type is every backend's, and its step goes
 * through the stores. A change to one backend's layout — a local repository's
 * files, the cloud's items — is that backend's own, in
 * {@link StorageBackend.upgrades}. A step runs with the repository held still
 * — no task, dataflow or gc runs meanwhile — and it is idempotent: it leaves a
 * record already in the new form as it is, so a step a crash cut short runs
 * again whole.
 */
export interface RepositoryUpgrade {
  /** The step's name, which the repository record keeps once it is applied:
   *  never another step's, a backend's or a shared one, nor reused */
  readonly name: string;
  /**
   * Rewrites the repository's records into the forms the release that ships
   * the step reads.
   *
   * @param storage - Storage backend
   * @param repo - Repository identifier
   */
  apply(storage: StorageBackend, repo: string): Promise<void>;
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
  /**
   * The upgrades of this backend's own layout, in the order they apply: none
   * yet for the local and in-memory backends. An open applies them before the
   * steps every backend shares, since those go through this backend's stores,
   * which read its current layout.
   */
  readonly upgrades: readonly RepositoryUpgrade[];

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
   * Validate that a repository exists and is properly structured. It reads no
   * record: `repositoryOpen` does, and applies the upgrades the repository
   * owes.
   * @param repo - Repository identifier (path to e3 repository directory for local storage)
   * @throws {RepoNotFoundError} If repository doesn't exist or is invalid
   */
  validateRepository(repo: string): Promise<void>;
}
