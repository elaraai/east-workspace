/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Domain error types for e3-core.
 *
 * All e3 errors extend E3Error, allowing callers to catch all domain errors
 * with `if (err instanceof E3Error)` or specific errors with their class.
 */

import {
  E3_RELEASE, nameProblem, type DatasetTypeMismatch, type HashKind, type IdKind, type IdentifierKind, type LockState, type NamedKind,
} from '@elaraai/e3-types';
import type { TaskExecutionResult } from './dataflow.js';
import { isObjectHash } from './objects.js';
import type { PackageZipCheckpoint } from './transfer/types.js';
import { isUuidv7 } from './uuid.js';

// =============================================================================
// Base Error
// =============================================================================

/** Base class for all e3 errors */
export class E3Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

// =============================================================================
// Repository Errors
// =============================================================================

/**
 * Thrown when a repository is not found.
 * Used by StorageBackend.validateRepository() and RepoStore operations.
 */
export class RepoNotFoundError extends E3Error {
  constructor(public readonly repo: string) {
    super(`Repository '${repo}' not found`);
  }
}

/**
 * Thrown when attempting to create a repository that already exists.
 */
export class RepoAlreadyExistsError extends E3Error {
  constructor(public readonly repo: string) {
    super(`Repository '${repo}' already exists`);
  }
}

/**
 * Thrown when this e3 cannot open a repository: it has no repository record
 * this e3 reads, which an older e3 wrote, or it has had a store upgrade this e3
 * does not know, which a newer e3 applied. Nothing in it is read.
 */
export class RepoLayoutError extends E3Error {
  constructor(
    public readonly repo: string,
    /** The upgrade this e3 does not know, with the release of e3 that applied
     *  it; `null` when the repository has no record this e3 reads */
    public readonly upgrade: { readonly name: string; readonly release: string } | null,
  ) {
    super(upgrade === null
      ? `the repository at ${repo} has no repository record: an older e3 wrote it — re-create it: deploy again and import its data again`
      : `the repository at ${repo} has had the upgrade ${JSON.stringify(upgrade.name)}, which e3 ${upgrade.release} applied and this e3, ` +
        `${E3_RELEASE}, does not know — open it with e3 ${upgrade.release} or a newer one`);
  }
}

/**
 * Thrown when work running in a repository holds it, so what must find it
 * still — gc, or an upgrade — cannot take it: a task, or a dataflow in one of
 * its workspaces.
 */
export class RepositoryBusyError extends E3Error {
  constructor(
    /** What wanted the repository held, which the message begins with */
    public readonly doing: string,
    /** The workspace whose dataflow runs, or `null` when a task runs */
    public readonly workspace: string | null,
  ) {
    super(workspace === null
      ? `${doing}: a task is running — retry when it finishes`
      : `${doing}: a dataflow is running in workspace '${workspace}' — retry when it finishes`);
  }
}

/**
 * Thrown by an open that does not apply the store upgrades a repository owes:
 * one that may not wait (`repositoryOpen`'s `waitMs: 0`) while work running in
 * the repository holds it, or one that leaves them to a job of its host's
 * (`apply: false`).
 *
 * @remarks
 * The steps apply once nothing runs in the repository, and nothing reads it
 * before they have. A server answers every request to the repository with it
 * but a running dataflow's cancel and poll, so the work the steps wait for can
 * always be stopped, and no request is held for the wait.
 */
export class RepositoryUpgradePendingError extends E3Error {
  constructor(
    public readonly repo: string,
    /** The steps the repository owes, in the order they apply */
    public readonly upgrades: readonly string[],
    /** The workspace whose dataflow holds the repository, or `null` when a
     *  task does, or when the steps are left to a job */
    public readonly workspace: string | null,
    /** Whether the steps are left to a job of the host's, which applies them,
     *  rather than to the next open that finds the repository still */
    public readonly job: boolean = false,
  ) {
    const one = upgrades.length === 1;
    const owes = `the repository ${repo} owes the upgrade${one ? '' : 's'} ${upgrades.map((name) => JSON.stringify(name)).join(', ')}`;
    super(job
      ? `${owes}, which a job applies before the repository is read — retry once it has`
      : `${owes}, which ${one ? 'applies' : 'apply'} once nothing runs in it, and ` +
        `${workspace === null ? 'a task is running' : `a dataflow is running in workspace '${workspace}'`} — retry when it finishes, or cancel it`);
  }
}

/** The kinds of hash and id, whose refusal names its form rather than a name. */
const IDENTIFIER_KINDS: ReadonlySet<NamedKind | IdentifierKind> = new Set<IdentifierKind>([
  'object hash', 'task hash', 'inputs hash', 'execution id', 'run id', 'gc run id',
]);

/**
 * Thrown when a name e3 would make a path of — a repository's, a workspace's,
 * a package's name or version, or a lock's — cannot be one path segment; or
 * when a hash or an id it would make a path or a key of — an object's hash, an
 * execution's task or inputs hash, an execution's, a run's or a gc run's id —
 * is not of its form.
 *
 * @remarks
 * A server answers it `invalid_name`, with its kind, whichever store refused
 * it: every backend checks the same forms, before it reads or writes anything
 * ({@link checkName}, {@link checkHash}, {@link checkId}).
 */
export class InvalidNameError extends E3Error {
  constructor(public readonly kind: NamedKind | IdentifierKind, public readonly value: string, reason: string) {
    super(IDENTIFIER_KINDS.has(kind)
      ? `the ${kind} ${JSON.stringify(value)} ${reason}`
      : `the ${kind} name ${JSON.stringify(value)} ${reason}`);
  }
}

/**
 * Thrown when a repository status doesn't match the expected value.
 * Used for CAS (compare-and-swap) operations.
 */
export class RepoStatusConflictError extends E3Error {
  constructor(
    public readonly repo: string,
    public readonly expected: string | string[],
    public readonly actual: string | 'not_found'
  ) {
    super(`Repository '${repo}' status: expected ${JSON.stringify(expected)}, got '${actual}'`);
  }
}

// =============================================================================
// Workspace Errors
// =============================================================================

export class WorkspaceNotFoundError extends E3Error {
  constructor(public readonly workspace: string) {
    super(`Workspace '${workspace}' does not exist`);
  }
}

export class WorkspaceNotDeployedError extends E3Error {
  constructor(public readonly workspace: string) {
    super(`Workspace '${workspace}' has no package deployed`);
  }
}

export class WorkspaceExistsError extends E3Error {
  constructor(public readonly workspace: string) {
    super(`Workspace '${workspace}' already exists`);
  }
}

/**
 * Information about a lock holder for error display.
 *
 * This is a simplified flat structure used in error messages.
 * The actual lock state uses the structured LockState type from e3-types.
 */
export interface LockHolderInfo {
  /** Process ID of the lock holder (for local process locks) */
  pid?: number;
  /** When the lock was acquired (ISO 8601) */
  acquiredAt: string;
  /** What operation holds the lock */
  operation?: string;
  /** System boot ID (to detect stale locks after reboot) */
  bootId?: string;
  /** Process start time in jiffies (to detect PID reuse) */
  startTime?: number;
  /** Command that acquired the lock (for debugging) */
  command?: string;
}

/**
 * A lock's holder as an error names it.
 *
 * @param state - The lock's state
 * @returns The holder's details, flattened for a message
 */
export function lockStateToHolderInfo(state: LockState): LockHolderInfo {
  const info: LockHolderInfo = {
    acquiredAt: state.acquiredAt.toISOString(),
    operation: state.operation.type,
  };
  if (state.holder.type === 'process') {
    info.pid = Number(state.holder.value.pid);
    info.bootId = state.holder.value.bootId;
    info.startTime = Number(state.holder.value.startTime);
    info.command = state.holder.value.command;
  }
  return info;
}

/**
 * Thrown when a workspace is locked by another process.
 *
 * This error is thrown when attempting to acquire an exclusive lock on a
 * workspace that is already locked by another process (e.g., another
 * `e3 start` command or API server).
 */
export class WorkspaceLockError extends E3Error {
  constructor(
    public readonly workspace: string,
    public readonly holder?: LockHolderInfo
  ) {
    let msg: string;
    if (!holder) {
      msg = `Workspace '${workspace}' is locked by another process`;
    } else if (holder.pid !== undefined) {
      msg = `Workspace '${workspace}' is locked by process ${holder.pid} (since ${holder.acquiredAt})`;
    } else {
      msg = `Workspace '${workspace}' is locked (since ${holder.acquiredAt})`;
    }
    super(msg);
  }
}

/**
 * Thrown when a deploy refuses to carry one or more of a workspace's records
 * into the package it deploys. It is thrown before the deploy writes anything.
 *
 * @remarks
 * A record is refused when it changed type with no migration, when the
 * package no longer declares in order the migrations the workspace applied,
 * when the deploy's policy leaves its migrations to their own change control,
 * or when the package no longer declares it at all. Every refusal is named at
 * once, each with its fix.
 */
export class RecordDeployRefusedError extends E3Error {
  constructor(public readonly refusals: ReadonlyArray<{ record: string; reason: string }>) {
    super(`the deploy was refused, and wrote nothing:\n${refusals.map((r) => `  record '${r.record}' ${r.reason}`).join('\n')}`);
  }
}

// =============================================================================
// Package Errors
// =============================================================================

export class PackageNotFoundError extends E3Error {
  constructor(
    public readonly packageName: string,
    public readonly version?: string
  ) {
    super(
      version
        ? `Package '${packageName}@${version}' not found`
        : `Package '${packageName}' not found`
    );
  }
}

export class PackageInvalidError extends E3Error {
  constructor(public readonly reason: string) {
    super(`Invalid package: ${reason}`);
  }
}

export class PackageExistsError extends E3Error {
  constructor(
    public readonly packageName: string,
    public readonly version: string
  ) {
    super(`Package '${packageName}@${version}' already exists`);
  }
}

/**
 * Thrown by an export stopped at its signal, once the entry it was writing is
 * written: where its zip had got to, which an export resumes from.
 *
 * @remarks
 * What compute with a time limit keeps at its deadline, beside the bytes its
 * destination holds, and hands the next round, which resumes the export.
 */
export class ExportStoppedError extends E3Error {
  constructor(
    /** Where the zip had got to */
    public readonly checkpoint: PackageZipCheckpoint,
  ) {
    super(`the export stopped at its signal with ${checkpoint.entries.length} entries in ${checkpoint.bytes} bytes of its zip: resume it from its checkpoint`);
  }
}

// =============================================================================
// Dataset Errors
// =============================================================================

export class DatasetNotFoundError extends E3Error {
  constructor(
    public readonly workspace: string,
    public readonly path: string
  ) {
    super(`Dataset '${path}' not found in workspace '${workspace}'`);
  }
}

/**
 * Thrown by {@link DatasetRefStore.writeIf} when the stored revision no longer
 * matches the expected one — another writer committed in between.
 *
 * Callers performing a compare-and-swap (read revision, compute, conditional
 * write) catch this to re-read and retry. This is the primitive that closes the
 * lost-update window in the blind `e3 set` / `Data.write` path.
 */
export class DatasetRefConflictError extends E3Error {
  constructor(
    public readonly workspace: string,
    public readonly path: string,
    public readonly expectedRevision: string | null,
    public readonly actualRevision: string | null
  ) {
    super(
      `Dataset ref '${path}' in workspace '${workspace}' changed concurrently ` +
      `(expected revision ${expectedRevision ?? '<absent>'}, found ${actualRevision ?? '<absent>'})`
    );
  }
}

/**
 * Thrown by every door into a dataset when the bytes' wire type is not the type
 * the dataset declares.
 *
 * @remarks
 * Raised before any object is written, so a refused write leaves the store
 * untouched. The message is built once, in `checkDatasetType`, so the SDK's
 * export, `workspaceSetDataset`, `datasetAdoptFile`, the API `PUT` and the
 * transfer commit all report a mismatch identically — declared type, given
 * type, and the first position they differ at.
 */
export class DatasetTypeMismatchError extends E3Error {
  constructor(
    public readonly workspace: string,
    public readonly path: string,
    public readonly mismatch: DatasetTypeMismatch
  ) {
    super(mismatch.message);
  }
}

/**
 * Thrown when a runner refuses a delivered collection an intake unit took in:
 * the delivery is not a beast2 collection of the declared type, a segment of
 * it is malformed or larger than a segment is read in, a row does not decode,
 * or its keys do not ascend.
 *
 * @remarks
 * The refusal is the runner's own words, which every runner shares, and names
 * the delivery's segment where it found the fault. It is the delivery's, so
 * no other runner is tried.
 */
export class DeliveryRefusedError extends E3Error {
  constructor(
    /** The runner that refused it, as its command is named */
    public readonly runner: string,
    /** What the runner recorded */
    public readonly refusal: string,
    /** The tail of the runner's stderr */
    public readonly stderr: string,
    /** What the message calls the delivery */
    public readonly delivery = 'the delivery',
  ) {
    super(`${runner} refused ${delivery}: ${refusal}`);
  }
}

// =============================================================================
// Task Errors
// =============================================================================

export class TaskNotFoundError extends E3Error {
  constructor(public readonly task: string) {
    super(`Task '${task}' not found`);
  }
}

// =============================================================================
// Object Errors
// =============================================================================

export class ObjectNotFoundError extends E3Error {
  constructor(public readonly hash: string) {
    super(`Object '${hash.slice(0, 8)}...' not found`);
  }
}

export class ObjectCorruptError extends E3Error {
  constructor(
    public readonly hash: string,
    public readonly reason: string
  ) {
    super(`Object ${hash.slice(0, 8)}... is corrupt: ${reason}`);
  }
}

/**
 * Thrown when gc cannot tell what an object it reached names: a read of it
 * failed for a reason other than its absence — a store under load, a timeout,
 * an expired credential — or it is of a shape that names other objects and
 * does not decode.
 *
 * @remarks
 * Only an object's absence ({@link ObjectNotFoundError}) tells gc the object
 * names nothing. An object it could not read may name objects nothing else
 * keeps, so gc stops before it deletes anything that depends on what it
 * names, rather than sweep them.
 */
export class GcReadError extends E3Error {
  constructor(
    /** The object gc could not read */
    public readonly hash: string,
    /** Why: the read's failure, or the decoder's */
    public readonly reason: string,
    /** Whether the object was read, and is a shape that names other objects
     *  but does not decode */
    public readonly undecodable: boolean = false,
  ) {
    super(undecodable
      ? `gc stopped: object ${hash} names other objects and does not decode, so gc cannot tell what it keeps: ${reason}`
      : `gc stopped: it cannot read object ${hash}, so it cannot tell what that object keeps: ${reason}`);
  }
}

// =============================================================================
// Execution Errors
// =============================================================================

export class ExecutionCorruptError extends E3Error {
  constructor(
    public readonly taskHash: string,
    public readonly inputsHash: string,
    public readonly cause: Error
  ) {
    super(
      `Execution ${taskHash.slice(0, 8)}.../${inputsHash.slice(0, 8)}... is corrupt: ${cause.message}`
    );
  }
}

export class ExecutionNotFoundError extends E3Error {
  constructor(public readonly task: string) {
    super(`No execution found for task '${task}'`);
  }
}

// =============================================================================
// Dataflow Errors
// =============================================================================

export class DataflowError extends E3Error {
  constructor(
    message: string,
    public readonly taskResults?: TaskExecutionResult[],
    public readonly cause?: Error
  ) {
    super(cause ? `${message}: ${cause.message}` : message);
  }
}

/**
 * Thrown when a dataflow execution is aborted via AbortSignal.
 *
 * This is not an error condition - it indicates the execution was intentionally
 * cancelled (e.g., by an API server before applying a write). The partial
 * results contain the status of tasks that completed before the abort.
 */
export class DataflowAbortedError extends E3Error {
  constructor(public readonly partialResults?: TaskExecutionResult[]) {
    super('Dataflow execution was aborted');
  }
}

/**
 * Thrown by a run's wait when another process has moved the run on: the state
 * store refused the loop's write, built on a state the run has since left.
 *
 * @remarks
 * Not an error of the run, which goes on where it was moved on — a host that
 * runs a run's loop in successive processes moves it on to the next. The loop
 * stopped what it launched, launched and wrote nothing more, and failed no
 * task.
 */
export class DataflowSupersededError extends E3Error {
  constructor(
    /** The run, by its id */
    public readonly runId: string,
  ) {
    super(`the run ${runId} was moved on by another process: this loop stopped, and wrote nothing more of it`);
  }
}

// =============================================================================
// Generic Errors
// =============================================================================

export class PermissionDeniedError extends E3Error {
  constructor(public readonly path: string) {
    super(`Permission denied: '${path}'`);
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/** Check if error is ENOENT (file not found) */
export function isNotFoundError(err: unknown): boolean {
  return (
    err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

/** Check if error is EACCES (permission denied) */
export function isPermissionError(err: unknown): boolean {
  return (
    err instanceof Error && (err as NodeJS.ErrnoException).code === 'EACCES'
  );
}

/** Check if error is EEXIST (already exists) */
export function isExistsError(err: unknown): boolean {
  return (
    err instanceof Error && (err as NodeJS.ErrnoException).code === 'EEXIST'
  );
}

/**
 * Refuses a name that cannot be one path segment, before anything makes a
 * path of it.
 *
 * @param kind - What the name names
 * @param name - The name
 * @throws {InvalidNameError} When the name cannot be a path segment
 */
export function checkName(kind: NamedKind, name: string): void {
  const problem = nameProblem(kind, name);
  if (problem !== null) throw new InvalidNameError(kind, name, problem);
}

/**
 * Refuses a hash that is not of the form e3 names objects by — a SHA-256 in
 * lowercase hex ({@link isObjectHash}) — before anything makes a path or a key
 * of it.
 *
 * @param kind - What the hash names
 * @param hash - The hash
 * @throws {InvalidNameError} When the hash is not of that form
 */
export function checkHash(kind: HashKind, hash: string): void {
  if (!isObjectHash(hash)) throw new InvalidNameError(kind, hash, 'is not a SHA-256 in lowercase hex');
}

/**
 * Refuses an id that is not of the form e3 mints ids in — a UUIDv7
 * ({@link isUuidv7}) — before anything makes a path or a key of it.
 *
 * @param kind - What the id names
 * @param id - The id
 * @throws {InvalidNameError} When the id is not a UUIDv7
 */
export function checkId(kind: IdKind, id: string): void {
  if (!isUuidv7(id)) throw new InvalidNameError(kind, id, 'is not a UUIDv7');
}

/**
 * Refuses the size of a page of a listing that is not a whole number greater
 * than zero, before a store reads anything for it.
 *
 * @param limit - The most entries the page holds
 * @throws {RangeError} When it is not a whole number greater than zero
 */
export function checkPageLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`a page's limit must be a whole number greater than zero, got ${limit}`);
}

/** Wrap unknown errors with context */
export function wrapError(err: unknown, message: string): E3Error {
  if (err instanceof E3Error) return err;
  const cause = err instanceof Error ? err.message : String(err);
  return new E3Error(`${message}: ${cause}`);
}
