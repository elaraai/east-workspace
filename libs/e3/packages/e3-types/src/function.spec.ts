/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Function object wire: the function object's round trip, with an input that
 * is an index of a record, and its refusal of the form before it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, EastTypeType, IntegerType, OptionType, StringType, StructType, encodeBeast2For, equalFor, none, some, toEastTypeValue, variant } from '@elaraai/east';
import { FunctionObjectType, decodeFunctionObject, type FunctionObject } from './function.js';
import { RunnerType } from './runner.js';
import { TreePathType } from './structure.js';

describe('FunctionObjectType', () => {
  const jobs = [variant('field', 'records'), variant('field', 'jobs')];
  const presses = [variant('field', 'inputs'), variant('field', 'presses')];
  const base: FunctionObject = {
    bodyIr: 'a'.repeat(64),
    inputs: [],
    drafts: [],
    argTypes: [toEastTypeValue(StringType)],
    outputType: toEastTypeValue(IntegerType),
    runner: variant('east_c', { platforms: [], decode: variant('lazy', null) }),
    environment: none,
  };

  it('round-trips a function that reads nothing, datasets, and an index of a record beside the record', () => {
    const functions: FunctionObject[] = [
      base,
      { ...base, inputs: [{ path: presses, index: none }], environment: some('b'.repeat(64)) },
      {
        ...base,
        inputs: [{ path: jobs, index: some('jobs_by_press') }, { path: jobs, index: none }],
        drafts: ['jobs'],
      },
    ];
    const encode = encodeBeast2For(FunctionObjectType);
    const same = equalFor(FunctionObjectType);
    for (const original of functions) {
      assert.ok(same(decodeFunctionObject(encode(original)), original), `a function with ${original.inputs.length} inputs decodes as it was encoded`);
    }
  });

  it('refuses a function object whose inputs predate the index they may name, saying to re-export the package', () => {
    // A function object as a package exported before an input could be an
    // index of a record: each input its dataset's path alone.
    const older = encodeBeast2For(StructType({
      bodyIr: StringType,
      inputs: ArrayType(TreePathType),
      drafts: ArrayType(StringType),
      argTypes: ArrayType(EastTypeType),
      outputType: EastTypeType,
      runner: RunnerType,
      environment: OptionType(StringType),
    }))({ ...base, inputs: [presses] });
    assert.throws(() => decodeFunctionObject(older), /exported by an older e3 SDK — re-export it with the current one/);
  });

  it('throws for bytes of no known function shape', () => {
    assert.throws(() => decodeFunctionObject(encodeBeast2For(IntegerType)(7n)), /re-export/);
  });
});
