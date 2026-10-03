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
 * - For success: output hash, timing, peak memory and a split task's last plan
 * - For failed: exit code, timing and peak memory
 * - For error: internal error message and timing
 * - For cancelled and interrupted: how e3, not the task, ended it, and why
 *
 * Every case says whether the execution is a unit of a split task — a piece,
 * or a merge of the pieces' outputs — which is recorded under its task's hash
 * as the task's own executions are, but is not a run of the task.
 */

import {
  VariantType,
  StructType,
  ArrayType,
  OptionType,
  StringType,
  IntegerType,
  BooleanType,
  DateTimeType,
  NullType,
  ValueTypeOf,
  decodeBeast2For,
} from '@elaraai/east';

/**
 * Why an execution stopped without finishing: what a `cancelled` or an
 * `interrupted` record says, written in the same write as the record.
 *
 * - `aborted`: the signal it ran under was aborted — its run was cancelled,
 *   or the call it ran for ended
 * - `yielded`: its run yielded mid-stage, and a run resumed takes the stage up
 *   again
 * - `owner_gone`: its runner and the process, or the browser tab, that owned
 *   it are gone
 * - `host`: a host's own reason, by its code — e3-cloud's for a container
 *   that stopped, say
 * - `unrecorded`: it stopped before e3 recorded reasons; only the repository
 *   upgrade that carried its record forward writes it
 *
 * `message` is what e3 wrote as the attempt's log's last line, after its
 * `e3: `, or the host's words; empty for `unrecorded`.
 */
export const StopReasonType = StructType({
  kind: VariantType({
    aborted: NullType,
    yielded: NullType,
    owner_gone: NullType,
    host: StringType,
    unrecorded: NullType,
  }),
  message: StringType,
});

export type StopReason = ValueTypeOf<typeof StopReasonType>;

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
  /** Whether the execution is a unit of a split task — a piece, or a merge of
   *  the pieces' outputs — rather than a task's own execution, which the one
   *  unit of a task whose input closes no piece is */
  unit: BooleanType,
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
  /** A split task's: the `$plan` of the last stage it ran, which names the
   *  stages before it, and so every unit its output was assembled from;
   *  `none` for any other execution */
  plan: OptionType(StringType),
  /** Whether the execution is a unit of a split task — a piece, or a merge of
   *  the pieces' outputs — rather than a task's own execution, which the one
   *  unit of a task whose input closes no piece is */
  unit: BooleanType,
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
  /** Whether the execution is a unit of a split task — a piece, or a merge of
   *  the pieces' outputs — rather than a task's own execution, which the one
   *  unit of a task whose input closes no piece is */
  unit: BooleanType,
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
  /** Whether the execution is a unit of a split task — a piece, or a merge of
   *  the pieces' outputs — rather than a task's own execution, which the one
   *  unit of a task whose input closes no piece is */
  unit: BooleanType,
});

/**
 * Execution status, stored locally at
 * executions/<taskHash>/<inputsHash>/<executionId>/status.beast2
 *
 * - `running`: Task has been launched but not yet completed
 * - `success`: Task ran and returned exit code 0
 * - `failed`: Task ran and returned non-zero exit code
 * - `error`: e3 execution engine had an internal error (runner not found, output missing, etc.)
 * - `cancelled`: e3 stopped the execution because the signal it ran under was
 *   aborted, before its runner started or while it ran — not the task's own
 *   failure
 * - `interrupted`: the execution can no longer finish, and nothing will write
 *   its outcome: its runner and its owner are gone, its host says it cannot,
 *   or its run yielded mid-stage
 *
 * Each of the two says why it stopped ({@link StopReasonType}).
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
    /** Whether the execution is a unit of a split task — a piece, or a merge of
     *  the pieces' outputs — rather than a task's own execution, which the one
     *  unit of a task whose input closes no piece is */
    unit: BooleanType,
    /** Why it stopped: `aborted` */
    reason: StopReasonType,
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
    /** Whether the execution is a unit of a split task — a piece, or a merge of
     *  the pieces' outputs — rather than a task's own execution, which the one
     *  unit of a task whose input closes no piece is */
    unit: BooleanType,
    /** Why it can no longer finish: `owner_gone`, `yielded`, or its host's
     *  reason */
    reason: StopReasonType,
  }),
});

export type ExecutionStatus = ValueTypeOf<typeof ExecutionStatusType>;

/** An object's hash: a SHA-256 in lowercase hex. */
const OBJECT_HASH = /^[0-9a-f]{64}$/;

/**
 * The objects an execution's record keeps from garbage collection: a
 * success's output, and a split task's last `$plan`, which names every stage
 * before it and so the units gc keeps beside the task; and the inputs a
 * running attempt reads.
 *
 * @remarks
 * Every backend's scan of execution roots applies it, as gc does to the
 * executions it keeps. A running attempt reads its inputs as it goes — a unit
 * fetches their segments as it reads them — so gc beside running work never
 * takes one from under it, however long it runs: a merge's `merge` tag, which
 * names no object, is passed over. gc keeps whatever is running, so a
 * `running` record nothing repairs keeps its inputs until an execution of its
 * task over them does.
 *
 * @param status - the execution's status
 * @returns the hashes of the objects it keeps
 */
export function executionStatusRoots(status: ExecutionStatus): string[] {
  if (status.type === 'running') return status.value.inputHashes.filter((hash) => OBJECT_HASH.test(hash));
  if (status.type !== 'success') return [];
  const { outputHash, plan } = status.value;
  return plan.type === 'some' ? [outputHash, plan.value] : [outputHash];
}

const decodeCurrentStatus = decodeBeast2For(ExecutionStatusType);

/**
 * Decode an execution status.
 *
 * @remarks
 * Stored state, which changes as `docs/conventions/WIRE_MIGRATION.md` says:
 * this reads the current form alone. A repository's upgrade steps carry its
 * records into it when an e3 first opens the repository — the stop reasons'
 * step those from before a stopped execution recorded why — so a record in an
 * earlier form here is one from before repositories recorded their upgrades,
 * whose repository is re-created, and this says so.
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
