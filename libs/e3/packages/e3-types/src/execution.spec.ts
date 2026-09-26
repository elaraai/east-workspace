/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Execution status wire: the typed outcomes with their peaks, and the refusal
 * of a record an older e3 wrote before `cancelled` and `interrupted` were
 * cases of it, or before a runner's peak was recorded.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, DateTimeType, IntegerType, StringType, StructType, VariantType, encodeBeast2For, none, some, variant } from '@elaraai/east';
import { ExecutionStatusType, decodeExecutionStatus, type ExecutionStatus } from './execution.js';

/** The four-case wire every record had before the typed outcomes. */
const PreOutcomeExecutionStatusType = VariantType({
  running: StructType({
    executionId: StringType, inputHashes: ArrayType(StringType), startedAt: DateTimeType,
    pid: IntegerType, pidStartTime: IntegerType, bootId: StringType,
  }),
  success: StructType({
    executionId: StringType, inputHashes: ArrayType(StringType), outputHash: StringType,
    startedAt: DateTimeType, completedAt: DateTimeType,
  }),
  failed: StructType({
    executionId: StringType, inputHashes: ArrayType(StringType), startedAt: DateTimeType,
    completedAt: DateTimeType, exitCode: IntegerType,
  }),
  error: StructType({
    executionId: StringType, inputHashes: ArrayType(StringType), startedAt: DateTimeType,
    completedAt: DateTimeType, message: StringType,
  }),
});

describe('ExecutionStatusType', () => {
  const stopped = {
    executionId: '0199-a',
    inputHashes: ['a'.repeat(64)],
    startedAt: new Date(1000),
    completedAt: new Date(2000),
  };
  const encodeOlder = encodeBeast2For(PreOutcomeExecutionStatusType);

  it('round-trips the typed outcomes, with a runner\'s peak or without one', () => {
    const statuses: ExecutionStatus[] = [
      variant('success', { ...stopped, outputHash: 'b'.repeat(64), peakBytes: some(96n * 1024n ** 2n) }),
      variant('success', { ...stopped, outputHash: 'b'.repeat(64), peakBytes: none }),
      variant('failed', { ...stopped, exitCode: 1n, peakBytes: some(412n * 1024n ** 2n) }),
      variant('failed', { ...stopped, exitCode: -1n, peakBytes: none }),
      variant('cancelled', stopped),
      variant('interrupted', { ...stopped, pid: 4242n }),
      variant('error', { ...stopped, message: 'Failed to read output: no such file' }),
    ];
    const encode = encodeBeast2For(ExecutionStatusType);
    for (const status of statuses) assert.deepEqual(decodeExecutionStatus(encode(status)), status);
  });

  it('refuses a record an older e3 wrote, naming the fix', () => {
    const refusal = /^Error: the execution status does not decode: an older e3 wrote this repository — re-create it: deploy again and import its data again \(/;
    const records = [
      variant('error', { ...stopped, message: 'cancelled: e3 stopped the runner because the run was aborted' }),
      variant('success', { ...stopped, outputHash: 'b'.repeat(64) }),
    ] as const;
    for (const record of records) {
      assert.throws(() => decodeExecutionStatus(encodeOlder(record)), refusal);
    }
    // The typed outcomes, before a runner's peak was recorded.
    const withoutPeaks = VariantType({
      ...PreOutcomeExecutionStatusType.cases,
      cancelled: StructType({ executionId: StringType, inputHashes: ArrayType(StringType), startedAt: DateTimeType, completedAt: DateTimeType }),
      interrupted: StructType({
        executionId: StringType, inputHashes: ArrayType(StringType), startedAt: DateTimeType, completedAt: DateTimeType, pid: IntegerType,
      }),
    });
    assert.throws(() => decodeExecutionStatus(encodeBeast2For(withoutPeaks)(variant('success', { ...stopped, outputHash: 'b'.repeat(64) }))), refusal);
  });

  it('throws for bytes of no status shape', () => {
    assert.throws(() => decodeExecutionStatus(encodeBeast2For(IntegerType)(7n)), /the execution status does not decode/);
  });
});
