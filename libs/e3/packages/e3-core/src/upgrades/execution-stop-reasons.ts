/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository upgrade that carries execution records into the form in
 * which a stopped execution says why it stopped: the `cancelled` and
 * `interrupted` cases of `ExecutionStatusType` gained their `reason`.
 *
 * A record's beast2 header names the whole status type, and a decode refuses
 * a header whose type differs, so every record an earlier release wrote, of
 * every case, is rewritten. A `cancelled` or `interrupted` one gains the
 * reason `unrecorded`, since nothing recorded why it stopped.
 *
 * @packageDocumentation
 */

import {
  ArrayType, BooleanType, DateTimeType, IntegerType, OptionType, StringType, StructType, VariantType,
  decodeBeast2For, variant, type ValueTypeOf,
} from '@elaraai/east';
import { decodeExecutionStatus, type ExecutionStatus, type StopReason } from '@elaraai/e3-types';
import { OBJECT_CONCURRENCY, eachAtMost } from '../concurrency.js';
import type { RepositoryUpgrade } from '../storage/interfaces.js';

/**
 * The execution status as the releases before this upgrade wrote it, frozen:
 * nothing but this upgrade reads it.
 *
 * @internal
 */
export const ExecutionStatusBeforeReasonsType = VariantType({
  running: StructType({
    executionId: StringType,
    inputHashes: ArrayType(StringType),
    startedAt: DateTimeType,
    pid: IntegerType,
    pidStartTime: IntegerType,
    bootId: StringType,
    unit: BooleanType,
  }),
  success: StructType({
    executionId: StringType,
    inputHashes: ArrayType(StringType),
    outputHash: StringType,
    startedAt: DateTimeType,
    completedAt: DateTimeType,
    peakBytes: OptionType(IntegerType),
    plan: OptionType(StringType),
    unit: BooleanType,
  }),
  failed: StructType({
    executionId: StringType,
    inputHashes: ArrayType(StringType),
    startedAt: DateTimeType,
    completedAt: DateTimeType,
    exitCode: IntegerType,
    peakBytes: OptionType(IntegerType),
    unit: BooleanType,
  }),
  error: StructType({
    executionId: StringType,
    inputHashes: ArrayType(StringType),
    startedAt: DateTimeType,
    completedAt: DateTimeType,
    message: StringType,
    unit: BooleanType,
  }),
  cancelled: StructType({
    executionId: StringType,
    inputHashes: ArrayType(StringType),
    startedAt: DateTimeType,
    completedAt: DateTimeType,
    unit: BooleanType,
  }),
  interrupted: StructType({
    executionId: StringType,
    inputHashes: ArrayType(StringType),
    startedAt: DateTimeType,
    completedAt: DateTimeType,
    pid: IntegerType,
    unit: BooleanType,
  }),
});

/** An execution status as the releases before this upgrade wrote it. */
type StatusBeforeReasons = ValueTypeOf<typeof ExecutionStatusBeforeReasonsType>;

const decodeBeforeReasons = decodeBeast2For(ExecutionStatusBeforeReasonsType);

/** Why a record from before reasons were recorded stopped: not recorded. */
const UNRECORDED: StopReason = { kind: variant('unrecorded', null), message: '' };

/** The name a repository's record keeps once the upgrade is applied. */
export const EXECUTION_STOP_REASONS = 'execution-stop-reasons';

/** Whether a record's bytes are in the current form. */
function isCurrent(data: Uint8Array): boolean {
  try {
    decodeExecutionStatus(data);
    return true;
  } catch {
    return false;
  }
}

/** A record in the form before reasons were recorded, or null for bytes of
 *  any other form. */
function beforeReasons(data: Uint8Array): StatusBeforeReasons | null {
  try {
    return decodeBeforeReasons(data);
  } catch {
    return null;
  }
}

/** A record from before reasons were recorded, in the current form: a
 *  stopped one's reason `unrecorded`, and every other case as it was. */
function withReason(status: StatusBeforeReasons): ExecutionStatus {
  switch (status.type) {
    case 'running': return variant('running', status.value);
    case 'success': return variant('success', status.value);
    case 'failed': return variant('failed', status.value);
    case 'error': return variant('error', status.value);
    case 'cancelled': return variant('cancelled', { ...status.value, reason: UNRECORDED });
    case 'interrupted': return variant('interrupted', { ...status.value, reason: UNRECORDED });
  }
}

/**
 * Reads an execution status as a repository or a package zip holds it: in
 * the current form, or in the form before a stopped execution said why,
 * carried into the current one as the upgrade carries a stored record.
 *
 * @remarks
 * A package zip an earlier release exported holds its executions' records in
 * that release's form, which its import carries forward so.
 *
 * @param data - The record's bytes
 * @returns The status, in the current form
 * @throws {Error} When the bytes are in neither form, as
 *   `decodeExecutionStatus` refuses them.
 */
export function decodeExecutionStatusCarried(data: Uint8Array): ExecutionStatus {
  try {
    return decodeExecutionStatus(data);
  } catch (err) {
    const earlier = beforeReasons(data);
    if (earlier === null) throw err;
    return withReason(earlier);
  }
}

/**
 * Rewrites every execution record of a repository in the current form: each
 * one an earlier release wrote, whatever its case, a `cancelled` or an
 * `interrupted` one with the reason `unrecorded`.
 *
 * @remarks
 * Every record is read as it is stored (`RefStore.executionReadBytes`), so
 * the upgrade goes through every backend's stores alike. A record already in
 * the current form is left as it is, so the upgrade runs again whole after a
 * crash cut it short; and so is one in neither form, which a crash or a
 * failing disk left, and which a read answers `ExecutionCorruptError`, as it
 * did before. The executions of {@link OBJECT_CONCURRENCY} tasks and inputs
 * are carried forward at once.
 */
export const executionStopReasons: RepositoryUpgrade = {
  name: EXECUTION_STOP_REASONS,
  async apply(storage, repo) {
    const { refs } = storage;
    await eachAtMost(await refs.executionList(repo), OBJECT_CONCURRENCY, async ({ taskHash, inputsHash }) => {
      for (const executionId of await refs.executionListIds(repo, taskHash, inputsHash)) {
        const data = await refs.executionReadBytes(repo, taskHash, inputsHash, executionId);
        if (data === null || isCurrent(data)) continue;
        const earlier = beforeReasons(data);
        if (earlier !== null) await refs.executionWrite(repo, taskHash, inputsHash, executionId, withReason(earlier));
      }
    });
  },
};
