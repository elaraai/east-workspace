/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Task object wire: the typed task object's round trip and its refusals.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, BlobType, IntegerType, OptionType, StringType, StructType, encodeBeast2For, none, some, variant } from '@elaraai/east';
import {
  TASK_OBJECT_KIND,
  TaskObjectType,
  decodeTaskObject,
  type TaskObject,
} from './task.js';
import { RunnerType } from './runner.js';
import { TreePathType } from './structure.js';

describe('TaskObjectType', () => {
  const sales = [variant('field', 'inputs'), variant('field', 'sales')];
  const rates = [variant('field', 'inputs'), variant('field', 'rates')];
  const totals = [variant('field', 'tasks'), variant('field', 'totals'), variant('field', 'output')];
  const base: TaskObject = {
    kind: TASK_OBJECT_KIND,
    body: variant('east', { program: 'a'.repeat(64) }),
    runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
    inputs: [{ path: sales, partition: none }],
    output: { path: totals, kind: variant('value', null) },
    role: variant('data', null),
    environment: none,
  };

  it('round-trips every body, output kind and role', () => {
    const tasks: TaskObject[] = [
      base,
      {
        ...base,
        body: variant('command', { commandIr: 'b'.repeat(64) }),
        runner: variant('custom', { command: [] }),
        environment: some('c'.repeat(64)),
      },
      {
        ...base,
        inputs: [{ path: sales, partition: some({ by: ['account', 'at.day'] }) }, { path: rates, partition: none }],
        output: { path: totals, kind: variant('dict', { merge: some('d'.repeat(64)) }) },
      },
      { ...base, output: { path: totals, kind: variant('fold', { zero: 'e'.repeat(64), combine: 'f'.repeat(64) }) } },
      { ...base, output: { path: totals, kind: variant('set', null) } },
      { ...base, role: variant('ui', { paths: [sales], functions: ['forecast'], records: ['plans'], pages: [rates] }) },
    ];
    const encode = encodeBeast2For(TaskObjectType);
    for (const original of tasks) assert.deepEqual(decodeTaskObject(encode(original)), original);
  });

  it('refuses a task object an older SDK exported, saying to re-export the package', () => {
    const PreCutoverTaskObjectType = StructType({
      commandIr: StringType,
      inputs: ArrayType(TreePathType),
      output: TreePathType,
      kind: OptionType(StringType),
      metadata: OptionType(BlobType),
      runner: RunnerType,
      environment: OptionType(StringType),
    });
    const older = encodeBeast2For(PreCutoverTaskObjectType)({
      commandIr: 'a'.repeat(64),
      inputs: [[variant('field', 'tasks'), variant('field', 'totals'), variant('field', 'function_ir')], sales],
      output: totals,
      kind: none,
      metadata: none,
      runner: variant('east_node', { platforms: [] }),
      environment: none,
    });
    assert.throws(() => decodeTaskObject(older), /exported by an older e3 SDK — re-export it with the current one/);
  });

  it('refuses an object of the task shape that carries another kind tag', () => {
    assert.throws(() => decodeTaskObject(encodeBeast2For(TaskObjectType)({ ...base, kind: '$plan' })), /its kind is '\$plan', not '\$task'/);
  });

  it('throws for bytes of no known task shape', () => {
    assert.throws(() => decodeTaskObject(encodeBeast2For(IntegerType)(7n)), /re-export/);
  });
});
