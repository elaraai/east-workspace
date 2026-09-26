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

import { nameProblem, type DatasetTypeMismatch, type NamedKind } from '@elaraai/e3-types';
import type { TaskExecutionResult } from './dataflow.js';

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
 * Thrown when a local repository is not in the layout this e3 reads: it has no
 * repository record, or one of another layout version. Nothing in it is read.
 */
export class RepoLayoutError extends E3Error {
  constructor(public readonly repo: string, public readonly layout: bigint | null, expected: bigint) {
    super(layout === null
      ? `the repository at ${repo} has no repository record: an older e3 wrote it — re-create it: deploy again and import its data again`
      : layout < expected
        ? `the repository at ${repo} is in layout ${layout}, and this e3 reads layout ${expected}: an older e3 wrote it — re-create it: deploy again and import its data again`
        : `the repository at ${repo} is in layout ${layout}, and this e3 reads layout ${expected}: a newer e3 wrote it — use that e3`);
  }
}

/**
 * Thrown when a name e3 would make a path of — a repository's, a workspace's,
 * a package's name or version, or a lock's — cannot be one path segment.
 */
export class InvalidNameError extends E3Error {
  constructor(public readonly kind: NamedKind, public readonly value: string, reason: string) {
    super(`the ${kind} name ${JSON.stringify(value)} ${reason}`);
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

/** Wrap unknown errors with context */
export function wrapError(err: unknown, message: string): E3Error {
  if (err instanceof E3Error) return err;
  const cause = err instanceof Error ? err.message : String(err);
  return new E3Error(`${message}: ${cause}`);
}
