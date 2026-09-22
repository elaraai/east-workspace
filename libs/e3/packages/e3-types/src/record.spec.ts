/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The record wire types' dual decoders.
 *
 * A commit, a mutation and a record object are all read by every vintage of
 * e3 that can see them, and a struct encodes positionally — so one written
 * before a field existed simply ends early. What is asserted here is that each
 * decoder reads both shapes and that what it fills the absent field with is a
 * real value of that field's type, not a look-alike: an option that is not a
 * variant passes `tsc` and fails wherever the runtime asks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DateTimeType, DictType, IntegerType, OptionType, StringType, StructType, ArrayType, EastTypeType, encodeBeast2For, isTypeValueEqual, isVariant, none, some, toEastTypeValue, variant } from '@elaraai/east';
import { RunnerType } from './runner.js';
import {
  MutationObjectType,
  RecordCommitType,
  RecordObjectType,
  decodeMutationObject,
  decodeRecordCommit,
  decodeRecordObject,
  type MutationObject,
  type RecordCommit,
  type RecordObject,
} from './record.js';

describe('decodeRecordCommit', () => {
  const commit: RecordCommit = {
    parent: some('a'.repeat(64)),
    state: 'b'.repeat(64),
    mutation: 'increment',
    args: some('c'.repeat(64)),
    actor: 'cli:test',
    at: new Date(0),
    delta: some('d'.repeat(64)),
  };

  it('round-trips a current commit', () => {
    assert.deepEqual(decodeRecordCommit(encodeBeast2For(RecordCommitType)(commit)), commit);
  });

  it('reads a commit written before deltas existed, with the delta absent', () => {
    const PreDeltaCommitType = StructType({
      parent: OptionType(StringType), state: StringType, mutation: StringType,
      args: OptionType(StringType), actor: StringType, at: DateTimeType,
    });
    const { delta: _delta, ...older } = commit;
    const read = decodeRecordCommit(encodeBeast2For(PreDeltaCommitType)(older));

    assert.deepEqual(read, { ...older, delta: none });
    // The absent delta is a real option, not a struct that reads like one:
    // everything downstream — the re-encode a transfer does, an equality, a
    // history page — asks the runtime, which asks the constructor's mark.
    assert.ok(isVariant(read.delta), 'the filled-in delta is a variant');
    assert.deepEqual(decodeRecordCommit(encodeBeast2For(RecordCommitType)(read)), read);
  });

  it('throws the current format\'s error for bytes of no commit shape', () => {
    assert.throws(() => decodeRecordCommit(encodeBeast2For(IntegerType)(7n)));
  });
});

describe('decodeMutationObject', () => {
  const mutation: MutationObject = {
    bodyIr: 'a'.repeat(64),
    argTypes: [toEastTypeValue(IntegerType)],
    runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
    form: 'edit',
    programIr: 'b'.repeat(64),
  };

  /** A decoded mutation with its arg types checked off separately: a decoded
   *  type value carries no memoized identity, so only the East comparison
   *  says whether two of them are the same type. */
  function read(bytes: Uint8Array): Omit<MutationObject, 'argTypes'> {
    const decoded = decodeMutationObject(bytes);
    assert.equal(decoded.argTypes.length, 1);
    assert.ok(isTypeValueEqual(decoded.argTypes[0]!, toEastTypeValue(IntegerType)));
    const { argTypes: _argTypes, ...rest } = decoded;
    return rest;
  }

  it('round-trips a current mutation', () => {
    const { argTypes: _argTypes, ...expected } = mutation;
    assert.deepEqual(read(encodeBeast2For(MutationObjectType)(mutation)), expected);
  });

  it('reads a mutation deployed before the delta as a reduce whose program is its body', () => {
    const PreDeltaMutationType = StructType({
      bodyIr: StringType, argTypes: ArrayType(EastTypeType), runner: RunnerType,
    });
    const { form: _form, programIr: _programIr, argTypes: _argTypes, ...older } = mutation;
    assert.deepEqual(read(encodeBeast2For(PreDeltaMutationType)({ ...older, argTypes: mutation.argTypes })),
      { ...older, form: 'reduce', programIr: '' });
  });
});

describe('decodeRecordObject', () => {
  const record: RecordObject = {
    path: 'records/orders',
    mutations: new Map([['place', 'a'.repeat(64)]]),
    indexes: new Map([['by_status', 'b'.repeat(64)]]),
  };

  /** A decoded record object with its dicts as entry lists: a decoded Dict is
   *  a SortedMap, which is the same mapping and not the same container. */
  const read = (bytes: Uint8Array): { path: string; mutations: [string, string][]; indexes: [string, string][] } => {
    const decoded = decodeRecordObject(bytes);
    return { path: decoded.path, mutations: [...decoded.mutations], indexes: [...decoded.indexes] };
  };

  it('round-trips a current record object', () => {
    assert.deepEqual(read(encodeBeast2For(RecordObjectType)(record)),
      { path: record.path, mutations: [...record.mutations], indexes: [...record.indexes] });
  });

  it('reads a record deployed before indexes existed, with none declared', () => {
    const MutationsEraRecordType = StructType({
      path: StringType, mutations: DictType(StringType, StringType),
    });
    const { indexes: _indexes, ...older } = record;
    assert.deepEqual(read(encodeBeast2For(MutationsEraRecordType)(older)),
      { path: record.path, mutations: [...record.mutations], indexes: [] });
  });
});
