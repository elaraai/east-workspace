/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Execution status type definitions.
 *
 * An execution represents a single run of a task with specific inputs.
 * A local repository keeps each attempt at
 * executions/<taskHash>/<inputsHash>/<executionId>/
 *
 * The status file tracks:
 * - For running: process identification for crash detection
 * - For success: output hash, timing and peak memory
 * - For failed: exit code, timing and peak memory
 * - For error: internal error message and timing
 * - For cancelled and interrupted: how e3, not the task, ended it
 */

import {
  VariantType,
  StructType,
  ArrayType,
  OptionType,
  StringType,
  IntegerType,
  DateTimeType,
  ValueTypeOf,
  decodeBeast2For,
} from '@elaraai/east';

/** A running execution's process identification. */
const RunningStatusType = StructType({
  /** Unique execution ID (UUIDv7) */
  executionId: StringType,
  /** Input dataset hashes */
  inputHashes: ArrayType(StringType),
  /** When execution started */
  startedAt: DateTimeType,
  /** Process ID of the runner */
  pid: IntegerType,
  /** Process start time in jiffies since boot (from /proc/<pid>/stat field 22) */
  pidStartTime: IntegerType,
  /** System boot ID (from /proc/sys/kernel/random/boot_id) */
  bootId: StringType,
});

const SuccessStatusType = StructType({
  /** Unique execution ID (UUIDv7) */
  executionId: StringType,
  /** Input dataset hashes */
  inputHashes: ArrayType(StringType),
  /** Hash of the output dataset */
  outputHash: StringType,
  /** When execution started */
  startedAt: DateTimeType,
  /** When execution completed */
  completedAt: DateTimeType,
  /** The highest peak resident memory, in bytes, a runner process of the
   *  execution reached — a split task's, the largest of its units' — when
   *  its runners reported one */
  peakBytes: OptionType(IntegerType),
});

const FailedStatusType = StructType({
  /** Unique execution ID (UUIDv7) */
  executionId: StringType,
  /** Input dataset hashes */
  inputHashes: ArrayType(StringType),
  /** When execution started */
  startedAt: DateTimeType,
  /** When execution completed */
  completedAt: DateTimeType,
  /** Process exit code */
  exitCode: IntegerType,
  /** The highest peak resident memory, in bytes, a runner process of the
   *  execution reached — a split task's, the largest of its units' — when
   *  its runners reported one */
  peakBytes: OptionType(IntegerType),
});

const ErrorStatusType = StructType({
  /** Unique execution ID (UUIDv7) */
  executionId: StringType,
  /** Input dataset hashes */
  inputHashes: ArrayType(StringType),
  /** When execution started */
  startedAt: DateTimeType,
  /** When execution completed */
  completedAt: DateTimeType,
  /** Error message describing what went wrong */
  message: StringType,
});

/**
 * Execution status, stored locally at
 * executions/<taskHash>/<inputsHash>/<executionId>/status.beast2
 *
 * - `running`: Task has been launched but not yet completed
 * - `success`: Task ran and returned exit code 0
 * - `failed`: Task ran and returned non-zero exit code
 * - `error`: e3 execution engine had an internal error (runner not found, output missing, etc.)
 * - `cancelled`: e3 stopped the execution because the run was aborted, before
 *   its runner started or while it ran — not the task's own failure
 * - `interrupted`: the orchestrator that owned the execution exited before it
 *   finished, and its runner is gone too, so nothing will write its outcome
 *
 * The `running` state includes process identification fields (pid, pidStartTime, bootId)
 * to enable detection of crashed executions. See design/e3-execution.md for details.
 *
 * Stored state: read it with {@link decodeExecutionStatus}.
 */
export const ExecutionStatusType = VariantType({
  running: RunningStatusType,
  success: SuccessStatusType,
  failed: FailedStatusType,
  error: ErrorStatusType,
  cancelled: StructType({
    /** Unique execution ID (UUIDv7) */
    executionId: StringType,
    /** Input dataset hashes */
    inputHashes: ArrayType(StringType),
    /** When execution started */
    startedAt: DateTimeType,
    /** When e3 stopped it */
    completedAt: DateTimeType,
  }),
  interrupted: StructType({
    /** Unique execution ID (UUIDv7) */
    executionId: StringType,
    /** Input dataset hashes */
    inputHashes: ArrayType(StringType),
    /** When execution started */
    startedAt: DateTimeType,
    /** When the interruption was found */
    completedAt: DateTimeType,
    /** Process ID the runner had */
    pid: IntegerType,
  }),
});

export type ExecutionStatus = ValueTypeOf<typeof ExecutionStatusType>;

const decodeCurrentStatus = decodeBeast2For(ExecutionStatusType);

/**
 * Decode an execution status.
 *
 * @remarks
 * Stored state, so it changes by hard cutover: a repository an older e3 wrote
 * is re-created rather than read, and this says so.
 *
 * @param data - the stored bytes
 * @returns the status
 * @throws {Error} When the bytes are not a current status — one an older e3
 *   wrote, whose repository is re-created.
 */
export function decodeExecutionStatus(data: Uint8Array): ExecutionStatus {
  try {
    return decodeCurrentStatus(data);
  } catch (err) {
    throw new Error(
      `the execution status does not decode: an older e3 wrote this repository — re-create it: deploy again and import its data again ` +
      `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/**
 * The orchestrator process that launched an execution.
 *
 * @remarks
 * Written beside the execution's `running` status as its owner record. A
 * `running` record whose runner is gone is repaired only when its owner is
 * gone too: a live owner may be between the runner's exit and the record's
 * write, hashing the output.
 *
 * Stored state: a record of another shape is read as none recorded.
 */
export const ExecutionOwnerType = StructType({
  /** Process ID of the orchestrator */
  pid: IntegerType,
  /** Orchestrator start time in jiffies since boot (from /proc/<pid>/stat field 22) */
  pidStartTime: IntegerType,
  /** System boot ID (from /proc/sys/kernel/random/boot_id) */
  bootId: StringType,
});

export type ExecutionOwner = ValueTypeOf<typeof ExecutionOwnerType>;
