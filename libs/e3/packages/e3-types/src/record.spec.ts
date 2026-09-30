/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The record wire types' decoders: each reads the current shape, and refuses
 * an older one naming the fix — a commit an older e3 wrote, whose repository
 * is re-created, and a mutation, migration, index or record object an older
 * SDK exported, whose package is re-exported.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BooleanType, DateTimeType, DictType, IntegerType, OptionType, StringType, StructType, ArrayType, EastTypeType, VariantType, encodeBeast2For, isTypeValueEqual, some, toEastTypeValue, variant } from '@elaraai/east';
import { RunnerType } from './runner.js';
import {
  MigrationObjectType,
  MutationObjectType,
  RecordCommitType,
  RecordIndexObjectType,
  RecordObjectType,
  decodeMigrationObject,
  decodeMutationObject,
  decodeRecordCommit,
  decodeRecordIndexObject,
  decodeRecordObject,
  type MigrationObject,
  type MutationObject,
  type RecordCommit,
  type RecordIndexObject,
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
    runner: variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }),
    form: variant('edit', null),
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

  it('refuses a mutation whose form is a String, as an older SDK wrote it, whatever the string', () => {
    // A String form decoded as any string, and a form e3 does not know ran as
    // whichever form its checks fell through to.
    const StringFormMutationType = StructType({
      bodyIr: StringType, argTypes: ArrayType(EastTypeType), runner: RunnerType, form: StringType, programIr: StringType,
    });
    for (const form of ['edit', 'bogus']) {
      assert.throws(
        () => decodeMutationObject(encodeBeast2For(StringFormMutationType)({ ...mutation, form })),
        /^Error: the mutation object does not decode: the package was exported by an older e3 SDK — re-export it with the current one \(/,
        form,
      );
    }
  });
});

describe('decodeRecordIndexObject', () => {
  const index: RecordIndexObject = {
    keyIr: 'a'.repeat(64),
    multi: false,
    valueIr: some('b'.repeat(64)),
    keyType: toEastTypeValue(StringType),
    valueType: toEastTypeValue(IntegerType),
    buildIr: 'c'.repeat(64),
    runner: variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('whole', null) }),
  };

  it('round-trips a current index object, its types among it', () => {
    const decoded = decodeRecordIndexObject(encodeBeast2For(RecordIndexObjectType)(index));
    // A decoded type value carries no memoized identity, so only the East
    // comparison says whether two of them are the same type.
    assert.ok(isTypeValueEqual(decoded.keyType, index.keyType));
    assert.ok(isTypeValueEqual(decoded.valueType, index.valueType));
    const { keyType: _keyType, valueType: _valueType, ...rest } = decoded;
    const { keyType: _k, valueType: _v, ...expected } = index;
    assert.deepEqual(rest, expected);
  });

  it('refuses an index object whose runner predates its decode, naming the fix', () => {
    // A stock runner as a package exported before runners said how they read
    // a program's inputs: its platforms alone.
    const PreDecodeRunnerType = VariantType({
      east_node: StructType({ platforms: ArrayType(StringType) }),
      east_py: StructType({ platforms: ArrayType(StringType) }),
      east_c: StructType({ platforms: ArrayType(StringType) }),
      custom: StructType({ command: ArrayType(StringType) }),
    });
    const PreDecodeIndexType = StructType({
      keyIr: StringType, multi: BooleanType, valueIr: OptionType(StringType), keyType: EastTypeType,
      valueType: EastTypeType, buildIr: StringType, runner: PreDecodeRunnerType,
    });
    const older = encodeBeast2For(PreDecodeIndexType)({ ...index, runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }) });
    assert.throws(
      () => decodeRecordIndexObject(older),
      /^Error: the index object does not decode: the package was exported by an older e3 SDK — re-export it with the current one \(/,
    );
  });
});

describe('decodeMigrationObject', () => {
  const RowV1Type = StructType({ name: StringType });
  const RowV2Type = StructType({ name: StringType, shift: IntegerType });
  const migration: MigrationObject = {
    form: variant('rows', null),
    from: toEastTypeValue(DictType(StringType, RowV1Type)),
    to: toEastTypeValue(DictType(StringType, RowV2Type)),
    bodyIr: 'a'.repeat(64),
    programIr: 'b'.repeat(64),
    runner: variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }),
  };

  it('round-trips a current migration, its types among it', () => {
    const decoded = decodeMigrationObject(encodeBeast2For(MigrationObjectType)(migration));
    // A decoded type value carries no memoized identity, so only the East
    // comparison says whether two of them are the same type.
    assert.ok(isTypeValueEqual(decoded.from, migration.from));
    assert.ok(isTypeValueEqual(decoded.to, migration.to));
    assert.ok(!isTypeValueEqual(decoded.from, decoded.to));
    const { from: _from, to: _to, ...rest } = decoded;
    const { from: _f, to: _t, ...expected } = migration;
    assert.deepEqual(rest, expected);
  });

  it('refuses the bytes of another object, naming the re-export', () => {
    const mutation: MutationObject = {
      bodyIr: 'a'.repeat(64), argTypes: [], runner: migration.runner, form: variant('reduce', null), programIr: '',
    };
    assert.throws(
      () => decodeMigrationObject(encodeBeast2For(MutationObjectType)(mutation)),
      /^Error: the migration object does not decode: the package was exported by an older e3 SDK — re-export it with the current one \(/,
    );
  });

  it('refuses a migration whose form is a String, as an older SDK wrote it, whatever the string', () => {
    // A deploy ran a String form it did not know as a split step.
    const StringFormMigrationType = StructType({
      form: StringType, from: EastTypeType, to: EastTypeType, bodyIr: StringType, programIr: StringType, runner: RunnerType,
    });
    for (const form of ['rows', 'bogus']) {
      assert.throws(
        () => decodeMigrationObject(encodeBeast2For(StringFormMigrationType)({ ...migration, form })),
        /^Error: the migration object does not decode: the package was exported by an older e3 SDK — re-export it with the current one \(/,
        form,
      );
    }
  });
});

describe('decodeRecordObject', () => {
  const record: RecordObject = {
    path: 'records/orders',
    mutations: new Map([['place', 'a'.repeat(64)]]),
    indexes: new Map([['by_status', 'b'.repeat(64)]]),
    migrations: [{ name: 'add_shift', migration: 'c'.repeat(64) }, { name: 'widen_row', migration: 'd'.repeat(64) }],
  };

  /** A decoded record object with its dicts as entry lists: a decoded Dict is
   *  a SortedMap, which is the same mapping and not the same container. */
  const read = (bytes: Uint8Array) => {
    const decoded = decodeRecordObject(bytes);
    return { path: decoded.path, mutations: [...decoded.mutations], indexes: [...decoded.indexes], migrations: decoded.migrations };
  };

  it('round-trips a current record object, its migrations in their order', () => {
    assert.deepEqual(read(encodeBeast2For(RecordObjectType)(record)),
      { path: record.path, mutations: [...record.mutations], indexes: [...record.indexes], migrations: record.migrations });
  });

  it('refuses a record object an older SDK exported before migrations, naming the fix', () => {
    const IndexesEraRecordType = StructType({
      path: StringType, mutations: DictType(StringType, StringType), indexes: DictType(StringType, StringType),
    });
    const { migrations: _migrations, ...older } = record;
    assert.throws(
      () => decodeRecordObject(encodeBeast2For(IndexesEraRecordType)(older)),
      /^Error: the record object does not decode: the package was exported by an older e3 SDK — re-export it with the current one \(/,
    );
  });
});
