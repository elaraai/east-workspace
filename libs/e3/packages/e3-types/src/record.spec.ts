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
import { BooleanType, DateTimeType, DictType, IntegerType, NullType, OptionType, StringType, StructType, ArrayType, EastTypeType, VariantType, dictPatchOpsType, decodeBeast2For, encodeBeast2For, equalFor, isTypeEqual, isTypeValueEqual, none, printFor, some, toEastTypeValue, variant, type EastType } from '@elaraai/east';
import { RunnerType } from './runner.js';
import {
  MigrationObjectType,
  MutationObjectType,
  RECORD_LOAD_KIND,
  RecordCommitType,
  RecordIndexObjectType,
  RecordLoadArgsType,
  RecordLoadObjectType,
  RecordObjectType,
  RecordSummaryOpType,
  RecordSummaryTotalsType,
  decodeMigrationObject,
  decodeMutationObject,
  decodeRecordCommit,
  decodeRecordIndexObject,
  decodeRecordLoadObject,
  decodeRecordObject,
  indexCollectionType,
  loadCommitName,
  loadCommitSource,
  mutationDeltaType,
  type MigrationObject,
  type MutationObject,
  type RecordCommit,
  type RecordIndexObject,
  type RecordLoadArgs,
  type RecordLoadObject,
  type RecordObject,
  type RecordSource,
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
    cases: none,
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

  it('round-trips the sources a composite record\'s mutation may write', () => {
    const composite: MutationObject = { ...mutation, cases: some(new Set(['plans', 'own'])) };
    const decoded = decodeMutationObject(encodeBeast2For(MutationObjectType)(composite));
    assert.ok(equalFor(MutationObjectType)(decoded, composite), printFor(MutationObjectType)(decoded));
    assert.ok(!equalFor(MutationObjectType)(decoded, mutation), 'a mutation of a record with no sources names none');
  });

  it('refuses a mutation an older SDK exported before it named the sources it may write, naming the fix', () => {
    const PreCasesMutationType = StructType({
      bodyIr: StringType, argTypes: ArrayType(EastTypeType), runner: RunnerType, form: MutationObjectType.fields.form, programIr: StringType,
    });
    const { cases: _cases, ...older } = mutation;
    assert.throws(
      () => decodeMutationObject(encodeBeast2For(PreCasesMutationType)(older)),
      /^Error: the mutation object does not decode: the package was exported by an older e3 SDK — re-export it with the current one \(/,
    );
  });

  it('refuses a mutation whose form is a String, as an older SDK wrote it, whatever the string', () => {
    // A String form decoded as any string, and a form e3 does not know ran as
    // whichever form its checks fell through to.
    const StringFormMutationType = StructType({
      bodyIr: StringType, argTypes: ArrayType(EastTypeType), runner: RunnerType, form: StringType, programIr: StringType,
      cases: MutationObjectType.fields.cases,
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
    form: variant('entries', null),
  };

  /** A decoded index object with its types checked off separately: a decoded
   *  type value carries no memoized identity, so only the East comparison
   *  says whether two of them are the same type. */
  function read(bytes: Uint8Array, as: RecordIndexObject): Omit<RecordIndexObject, 'keyType' | 'valueType'> {
    const decoded = decodeRecordIndexObject(bytes);
    assert.ok(isTypeValueEqual(decoded.keyType, as.keyType));
    assert.ok(isTypeValueEqual(decoded.valueType, as.valueType));
    const { keyType: _keyType, valueType: _valueType, ...rest } = decoded;
    return rest;
  }

  it('round-trips a current index object, its types among it', () => {
    const { keyType: _k, valueType: _v, ...expected } = index;
    assert.deepEqual(read(encodeBeast2For(RecordIndexObjectType)(index), index), expected);
  });

  it('round-trips a summary index object, the merge its build sums by among it (#1039)', () => {
    const summary: RecordIndexObject = {
      ...index,
      multi: true,
      valueIr: none,
      valueType: toEastTypeValue(RecordSummaryTotalsType),
      form: variant('summary', { mergeIr: 'd'.repeat(64) }),
    };
    const { keyType: _k, valueType: _v, ...expected } = summary;
    assert.deepEqual(read(encodeBeast2For(RecordIndexObjectType)(summary), summary), expected);
  });

  it('refuses an index object an older SDK exported before it named its collection, naming the fix (#1039)', () => {
    const PreFormIndexType = StructType({
      keyIr: StringType, multi: BooleanType, valueIr: OptionType(StringType), keyType: EastTypeType,
      valueType: EastTypeType, buildIr: StringType, runner: RunnerType,
    });
    const { form: _form, ...older } = index;
    assert.throws(
      () => decodeRecordIndexObject(encodeBeast2For(PreFormIndexType)(older)),
      /^Error: the index object does not decode: the package was exported by an older e3 SDK — re-export it with the current one \(/,
    );
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

describe('mutationDeltaType', () => {
  // A summary index's key: its leading fields under `on`, then a tile and a key (#1432).
  const ik = StructType({ on: StructType({}), tile: DateTimeType, key: StringType });
  const caseOf = (delta: EastType, part: 'key' | 'value', name: string): EastType =>
    ((delta as unknown as Record<'key' | 'value', { cases: Record<string, EastType> }>)[part]).cases[name]!;

  it("carries a summary's changes as add ops, under its `{ik, k: Null}` keys, beside an index's patch ops (#1039)", () => {
    const delta = mutationDeltaType([
      { name: 'primary', keyType: StringType, collectionType: DictType(StringType, IntegerType) },
      { name: 'jobs_by_press_month', keyType: StructType({ ik, k: NullType }), collectionType: indexCollectionType(NullType, ik, RecordSummaryTotalsType), summary: true },
      { name: 'jobs_by_press_week', keyType: StructType({ ik, k: StringType }), collectionType: indexCollectionType(StringType, ik, IntegerType) },
    ]);
    assert.ok(isTypeEqual(caseOf(delta, 'value', 'jobs_by_press_month'), RecordSummaryOpType));
    assert.ok(isTypeEqual(caseOf(delta, 'key', 'jobs_by_press_month'), StructType({ ik, k: NullType })));
    assert.ok(isTypeEqual(caseOf(delta, 'value', 'jobs_by_press_week'), dictPatchOpsType(IntegerType)));
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
      bodyIr: 'a'.repeat(64), argTypes: [], runner: migration.runner, form: variant('reduce', null), programIr: '', cases: none,
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
    sources: new Map(),
  };
  const same = equalFor(RecordObjectType);
  const print = printFor(RecordObjectType);

  it('round-trips a current record object, its migrations in their order', () => {
    const decoded = decodeRecordObject(encodeBeast2For(RecordObjectType)(record));
    assert.ok(same(decoded, record), print(decoded));
    assert.deepEqual(decoded.migrations.map(({ name }) => name), ['add_shift', 'widen_row']);
  });

  it('round-trips a composite record\'s sources: an external one naming its load object, and the solution\'s own', () => {
    const composite: RecordObject = { ...record, sources: new Map<string, RecordSource>([['own', variant('mutations', null)], ['erp', variant('load', 'e'.repeat(64))]]) };
    const decoded = decodeRecordObject(encodeBeast2For(RecordObjectType)(composite));
    assert.ok(same(decoded, composite), print(decoded));
    assert.deepEqual([...decoded.sources.keys()], ['erp', 'own'], 'by name');
    assert.ok(!same(decoded, record));
  });

  it('refuses a record object an older SDK exported before sources, naming the fix', () => {
    const MigrationsEraRecordType = StructType({
      path: StringType, mutations: DictType(StringType, StringType), indexes: DictType(StringType, StringType),
      migrations: RecordObjectType.fields.migrations,
    });
    const { sources: _sources, ...older } = record;
    assert.throws(
      () => decodeRecordObject(encodeBeast2For(MigrationsEraRecordType)(older)),
      /^Error: the record object does not decode: the package was exported by an older e3 SDK — re-export it with the current one \(/,
    );
  });

  it('refuses a record object an older SDK exported before migrations, naming the fix', () => {
    const IndexesEraRecordType = StructType({
      path: StringType, mutations: DictType(StringType, StringType), indexes: DictType(StringType, StringType),
    });
    const { migrations: _migrations, sources: _sources, ...older } = record;
    assert.throws(
      () => decodeRecordObject(encodeBeast2For(IndexesEraRecordType)(older)),
      /^Error: the record object does not decode: the package was exported by an older e3 SDK — re-export it with the current one \(/,
    );
  });
});

describe('decodeRecordLoadObject', () => {
  const ErpDeliveryType = DictType(StringType, StructType({ cust: StringType, qty: IntegerType }));
  const load: RecordLoadObject = {
    kind: RECORD_LOAD_KIND,
    key: toEastTypeValue(StringType),
    delivery: toEastTypeValue(ErpDeliveryType),
    feed: none,
    task: 'a'.repeat(64),
  };
  const same = equalFor(RecordLoadObjectType);
  const print = printFor(RecordLoadObjectType);

  it('round-trips a load object, its key and delivery types among it', () => {
    const decoded = decodeRecordLoadObject(encodeBeast2For(RecordLoadObjectType)(load));
    assert.ok(same(decoded, load), print(decoded));
    assert.equal(decoded.kind, '$recordLoad');
    assert.ok(isTypeValueEqual(decoded.delivery, toEastTypeValue(ErpDeliveryType)));
  });

  it('round-trips the dataset that feeds a fed source', () => {
    const fed: RecordLoadObject = { ...load, feed: some([variant('field', 'tasks'), variant('field', 'erp_orders'), variant('field', 'output')]) };
    const decoded = decodeRecordLoadObject(encodeBeast2For(RecordLoadObjectType)(fed));
    assert.ok(same(decoded, fed), print(decoded));
    assert.ok(!same(decoded, load));
  });

  it('refuses the bytes of another object, naming the re-export', () => {
    assert.throws(
      () => decodeRecordLoadObject(encodeBeast2For(IntegerType)(7n)),
      /^Error: the load object does not decode: the package was exported by an older e3 SDK — re-export it with the current one \(/,
    );
  });
});

describe('a load\'s commit', () => {
  it('is named by its source, which its name gives back', () => {
    assert.equal(loadCommitName('erp'), '$load:erp');
    assert.equal(loadCommitSource('$load:erp'), 'erp');
    assert.equal(loadCommitSource(loadCommitName('crm_accounts')), 'crm_accounts');
    for (const other of ['plan_order', '$init', '$migrate:add_owner', '$load', 'load:erp']) {
      assert.equal(loadCommitSource(other), null, other);
    }
  });

  it('round-trips what it says of itself: its delivery, its load, its as-of, whether it was the source\'s first, its execution and its counts', () => {
    const args: RecordLoadArgs = {
      delivery: 'a'.repeat(64), load: 'b'.repeat(64), asOf: some(new Date(Date.UTC(2026, 10, 17, 9, 0))), first: true,
      execution: { inputsHash: 'c'.repeat(64), executionId: '0190a0b0-4444-7000-8000-000000000000' },
      set: 1_204n, deleted: 3n, unchanged: 58_811n,
    };
    const same = equalFor(RecordLoadArgsType);
    const decode = (value: RecordLoadArgs) => decodeBeast2For(RecordLoadArgsType)(encodeBeast2For(RecordLoadArgsType)(value));
    assert.ok(same(decode(args), args), printFor(RecordLoadArgsType)(decode(args)));
    const later: RecordLoadArgs = { ...args, asOf: none, first: false };
    assert.ok(same(decode(later), later) && !same(decode(later), args));
  });
});
