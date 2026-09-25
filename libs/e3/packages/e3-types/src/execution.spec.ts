/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Execution status wire: the typed outcomes, and the records written before
 * `cancelled` and `interrupted` were cases of it, read back as those cases.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, DateTimeType, IntegerType, StringType, StructType, VariantType, encodeBeast2For, variant } from '@elaraai/east';
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

  it('round-trips the typed outcomes', () => {
    const statuses: ExecutionStatus[] = [
      variant('cancelled', stopped),
      variant('interrupted', { ...stopped, pid: 4242n }),
      variant('error', { ...stopped, message: 'Failed to read output: no such file' }),
    ];
    const encode = encodeBeast2For(ExecutionStatusType);
    for (const status of statuses) assert.deepEqual(decodeExecutionStatus(encode(status)), status);
  });

  it('reads an older record an e3 stopped as cancelled', () => {
    for (const message of [
      'cancelled: e3 stopped the runner because the run was aborted',
      'cancelled: e3 did not start the runner because the run was aborted',
    ]) {
      assert.deepEqual(decodeExecutionStatus(encodeOlder(variant('error', { ...stopped, message }))), variant('cancelled', stopped));
    }
  });

  it('reads an older record an exited orchestrator left as interrupted, with the runner pid it named', () => {
    const older = encodeOlder(variant('error', {
      ...stopped,
      message: 'interrupted: the orchestrator exited before this execution finished (runner pid 31337)',
    }));
    assert.deepEqual(decodeExecutionStatus(older), variant('interrupted', { ...stopped, pid: 31337n }));
  });

  it('reads every other older record as it was written', () => {
    const records = [
      variant('error', { ...stopped, message: 'timed out: e3 stopped the runner after 50 ms' }),
      variant('failed', { ...stopped, exitCode: 3n }),
      variant('success', { ...stopped, outputHash: 'b'.repeat(64) }),
      variant('running', { executionId: '0199-a', inputHashes: [], startedAt: new Date(1000), pid: 7n, pidStartTime: 9n, bootId: 'boot' }),
    ] as const;
    for (const record of records) assert.deepEqual(decodeExecutionStatus(encodeOlder(record)), record);
  });

  it('throws for bytes of no known status shape', () => {
    assert.throws(() => decodeExecutionStatus(encodeBeast2For(IntegerType)(7n)));
  });
});
