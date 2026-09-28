/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Lock state type definitions.
 *
 * A lock gives exclusive or shared access to a resource: a workspace, a
 * workspace's dataflow, the repository's tasks, or one dataset's ref. The state
 * records:
 * - what operation acquired the lock (dataflow, deployment, etc.);
 * - who holds it: a local process, or a cloud function;
 * - when it was acquired;
 * - when it expires, for a cloud backend's lease.
 *
 * An exclusive holder may also report how far its operation has got, for
 * another process to read while it holds the lock: a deploy taking its file
 * sources in and deploying its records.
 *
 * A local repository keeps each resource's locks in `locks/<resource>/`.
 */

import {
  VariantType,
  StructType,
  StringType,
  IntegerType,
  DateTimeType,
  OptionType,
  NullType,
  ValueTypeOf,
} from '@elaraai/east';
import { DeployProgressType } from './api.js';

/**
 * Lock operation - what acquired the lock.
 */
export const LockOperationType = VariantType({
  /** Running a dataflow */
  dataflow: NullType,
  /** Deploying a package to the workspace */
  deployment: NullType,
  /** Removing the workspace */
  removal: NullType,
  /** Writing to a dataset */
  dataset_write: NullType,
  /** Exporting a workspace */
  export: NullType,
});

export type LockOperation = ValueTypeOf<typeof LockOperationType>;

/**
 * A local process holding a lock: alive while a process of this pid and start
 * time runs under this boot.
 */
export const ProcessHolderType = StructType({
  /** Process ID */
  pid: IntegerType,
  /** System boot ID (from /proc/sys/kernel/random/boot_id) */
  bootId: StringType,
  /** Process start time in jiffies since boot */
  startTime: IntegerType,
  /** Command that acquired the lock (for debugging) */
  command: StringType,
});

export type ProcessHolder = ValueTypeOf<typeof ProcessHolderType>;

/**
 * A cloud function holding a lock, which the lock's lease bounds.
 */
export const LambdaHolderType = StructType({
  /** The invocation's request ID */
  requestId: StringType,
  /** The function's name */
  functionName: StringType,
});

export type LambdaHolder = ValueTypeOf<typeof LambdaHolderType>;

/**
 * Who holds a lock.
 */
export const LockHolderVariantType = VariantType({
  /** A local process */
  process: ProcessHolderType,
  /** A cloud function */
  lambda: LambdaHolderType,
});

export type LockHolderVariant = ValueTypeOf<typeof LockHolderVariantType>;

/**
 * The state of a held lock.
 *
 * The locking itself is the backend's — an atomically created file locally, a
 * conditional write in the cloud — and every backend records this state.
 */
export const LockStateType = StructType({
  /** What operation acquired the lock */
  operation: LockOperationType,
  /** Who holds the lock */
  holder: LockHolderVariantType,
  /** When the lock was acquired */
  acquiredAt: DateTimeType,
  /** When the lock expires (for cloud TTL-based locks) */
  expiresAt: OptionType(DateTimeType),
});

export type LockState = ValueTypeOf<typeof LockStateType>;

/**
 * How far the operation holding a lock exclusively has got, as its holder
 * reports it for another process to read while it holds the lock.
 */
export const LockProgressType = VariantType({
  /** A deploy: its file sources and its records */
  deployment: DeployProgressType,
});

export type LockProgress = ValueTypeOf<typeof LockProgressType>;

/**
 * A resource's exclusive lock as another process reads it while it is held:
 * what holds it, and how far that operation says it has got.
 */
export const LockStatusType = StructType({
  /** The lock's state: the operation, its holder, and when it was acquired */
  state: LockStateType,
  /** What the holder last reported of its progress; `none` until it reports */
  progress: OptionType(LockProgressType),
});

export type LockStatus = ValueTypeOf<typeof LockStatusType>;
