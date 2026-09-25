/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The record wire types' decoders: each reads the current shape, and refuses
 * an older one naming the fix — a commit an older e3 wrote, whose repository
 * is re-created, and a mutation or record object an older SDK exported, whose
 * package is re-exported.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DateTimeType, DictType, IntegerType, OptionType, StringType, StructType, ArrayType, EastTypeType, encodeBeast2For, isTypeValueEqual, some, toEastTypeValue, variant } from '@elaraai/east';
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

  it('refuses a commit an older e3 wrote before deltas existed, naming the fix', () => {
    const PreDeltaCommitType = StructType({
      parent: OptionType(StringType), state: StringType, mutation: StringType,
      args: OptionType(StringType), actor: StringType, at: DateTimeType,
    });
    const { delta: _delta, ...older } = commit;
    assert.throws(
      () => decodeRecordCommit(encodeBeast2For(PreDeltaCommitType)(older)),
      /^Error: the record commit does not decode: an older e3 wrote this repository — re-create it: deploy again and import its data again \(/,
    );
  });

  it('refuses bytes of no commit shape', () => {
    assert.throws(() => decodeRecordCommit(encodeBeast2For(IntegerType)(7n)), /the record commit does not decode/);
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

  it('refuses a mutation an older SDK exported before the delta, naming the fix', () => {
    const PreDeltaMutationType = StructType({
      bodyIr: StringType, argTypes: ArrayType(EastTypeType), runner: RunnerType,
    });
    const { form: _form, programIr: _programIr, argTypes: _argTypes, ...older } = mutation;
    assert.throws(
      () => decodeMutationObject(encodeBeast2For(PreDeltaMutationType)({ ...older, argTypes: mutation.argTypes })),
      /^Error: the mutation object does not decode: the package was exported by an older e3 SDK — re-export it with the current one \(/,
    );
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

  it('refuses a record object an older SDK exported before indexes, naming the fix', () => {
    const MutationsEraRecordType = StructType({
      path: StringType, mutations: DictType(StringType, StringType),
    });
    const { indexes: _indexes, ...older } = record;
    assert.throws(
      () => decodeRecordObject(encodeBeast2For(MutationsEraRecordType)(older)),
      /^Error: the record object does not decode: the package was exported by an older e3 SDK — re-export it with the current one \(/,
    );
  });
});
