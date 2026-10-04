/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The record client reads a record response of its own release field by
 * field, and refuses a body of any other shape in the current type's words:
 * nothing reads an older server's.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ArrayType, EastTypeType, IntegerType, NullType, OptionType, StringType, StructType, decodeBeast2For, encodeBeast2For, equalFor, none,
  some, toEastTypeValue, variant,
} from '@elaraai/east';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-types';
import { workspaceRecordDescribe, workspaceRecordHistory, workspaceRecordMutate } from './records.js';
import {
  MutationResultType, RecordCommitArgsType, RecordHistoryResultType, RecordMigrationAppliedType, RecordSignatureType, ResponseType,
} from './types.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const BASE = 'https://example.test';
const HASH = 'a'.repeat(64);
const AT = new Date('2026-09-01T00:00:00.000Z');
const call = { args: [], actor: none, limits: none };

/** Answers every request with `body`, an encoded BEAST2 response. */
function serve(body: Uint8Array): void {
  globalThis.fetch = (async () => new Response(body, {
    status: 200,
    headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
  })) as typeof fetch;
}

describe('record responses', () => {
  it('reads each field as sent', async () => {
    const applied = some({ at: some(AT), commit: some(HASH) });
    serve(encodeBeast2For(ResponseType(RecordSignatureType))(variant('success', {
      name: 'plans', mutations: [{ name: 'patch', argTypes: [], form: 'patch' }],
      indexes: [{ name: 'by_status', keyType: toEastTypeValue(StringType), valueType: toEastTypeValue(NullType), multi: true, built: false }],
      migrations: [{ name: 'add_owner', form: 'rows', from: toEastTypeValue(StringType), to: toEastTypeValue(IntegerType), applied }],
    })));
    const signature = await workspaceRecordDescribe(BASE, 'r', 'ws', 'plans', { token: null });
    assert.equal(signature.mutations[0]!.form, 'patch');
    assert.deepEqual(signature.indexes.map(({ name, multi, built }) => [name, multi, built]), [['by_status', true, false]]);
    assert.deepEqual(signature.migrations.map(({ name, form }) => [name, form]), [['add_owner', 'rows']]);
    assert.ok(equalFor(OptionType(RecordMigrationAppliedType))(signature.migrations[0]!.applied, applied));

    const args = some({
      hash: HASH,
      bytes: 40n,
      values: [{ type: toEastTypeValue(StringType), bytes: 31n, text: '"Q3 plan"', truncated: false }],
    });
    serve(encodeBeast2For(ResponseType(RecordHistoryResultType))(variant('success', { commits: [
      { hash: HASH, parent: none, state: HASH, mutation: 'retitle', actor: 'cli:x', at: AT, delta: some(HASH), args },
    ] })));
    const { commits } = await workspaceRecordHistory(BASE, 'r', 'ws', 'plans', 1, { token: null });
    assert.deepEqual(commits[0]!.delta, some(HASH));
    assert.ok(equalFor(OptionType(RecordCommitArgsType))(commits[0]!.args, args));

    serve(encodeBeast2For(ResponseType(MutationResultType))(variant('success', {
      outcome: variant('conflict', { attempts: 1n, detail: some('delete of "p-7", which the record does not hold') }),
    })));
    const result = await workspaceRecordMutate(BASE, 'r', 'ws', 'plans', 'drop', call, { token: null });
    assert.ok(result.outcome.type === 'conflict', `expected conflict, got ${result.outcome.type}`);
    assert.deepEqual(result.outcome.value.detail, some('delete of "p-7", which the record does not hold'));
  });

  it('refuses a body of another shape — an older server\'s — with the current type\'s error', async () => {
    // A describe from before each mutation carried its `form`.
    const PreFormSignature = StructType({
      name: StringType,
      mutations: ArrayType(StructType({ name: StringType, argTypes: ArrayType(EastTypeType) })),
    });
    const body = encodeBeast2For(ResponseType(PreFormSignature))(variant('success', {
      name: 'plans', mutations: [{ name: 'seed', argTypes: [] }],
    }));
    let current: string | undefined;
    try {
      decodeBeast2For(ResponseType(RecordSignatureType))(body);
    } catch (err) {
      current = (err as Error).message;
    }
    assert.ok(current !== undefined, 'the current type refuses the body');

    serve(body);
    await assert.rejects(workspaceRecordDescribe(BASE, 'r', 'ws', 'plans', { token: null }), { message: current });
  });
});
