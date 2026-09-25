/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The record client against a server that predates a response field.
 *
 * A struct decodes positionally, so a field appended to a response is absent
 * from what an older server encodes, and the current type alone cannot read
 * it. Each test serves the body an older server sends and asserts the client
 * reads it with the field defaulted — and reads the current body unchanged.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ArrayType, DateTimeType, EastTypeType, IntegerType, OptionType, StringType, StructType, VariantType,
  decodeBeast2For, encodeBeast2For, none, some, toEastTypeValue, variant, type EastType,
} from '@elaraai/east';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-types';
import { workspaceRecordDescribe, workspaceRecordHistory, workspaceRecordMutate } from './records.js';
import { MutationResultType, RecordHistoryResultType, RecordSignatureType, ResponseType } from './types.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const BASE = 'https://example.test';
const HASH = 'a'.repeat(64);
const AT = new Date('2026-09-01T00:00:00.000Z');
const call = { args: [], actor: none, limits: none };

// The success types as servers that predate each field encode them.
const PreFormSignature = StructType({
  name: StringType,
  mutations: ArrayType(StructType({ name: StringType, argTypes: ArrayType(EastTypeType) })),
});
const PreDeltaHistory = StructType({
  commits: ArrayType(StructType({
    hash: StringType, parent: OptionType(StringType), state: StringType,
    mutation: StringType, actor: StringType, at: DateTimeType,
  })),
});
const PreDetailResult = StructType({
  outcome: VariantType({
    committed: StructType({ commitHash: StringType, stateHash: StringType }),
    invalid:   StructType({ message: StringType }),
    failed:    StructType({ exitCode: IntegerType, stderr: StringType }),
    too_large: StructType({ bytes: IntegerType, limit: IntegerType, stderr: StringType }),
    timed_out: StructType({ ms: IntegerType, stderr: StringType }),
    conflict:  StructType({ attempts: IntegerType }),
  }),
});

/** Answers every request with `body`, an encoded BEAST2 response. */
function serve(body: Uint8Array): void {
  globalThis.fetch = (async () => new Response(body, {
    status: 200,
    headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
  })) as typeof fetch;
}

describe('record responses from a server that predates a field', () => {
  it('reads a describe with no write form as reduce mutations', async () => {
    serve(encodeBeast2For(ResponseType(PreFormSignature))(variant('success', { name: 'plans', mutations: [
      { name: 'seed', argTypes: [] },
      { name: 'retitle', argTypes: [toEastTypeValue(StringType)] },
    ] })));
    const sig = await workspaceRecordDescribe(BASE, 'r', 'ws', 'plans', { token: null });
    assert.deepEqual(sig.mutations.map((m) => [m.name, m.form, m.argTypes.length]),
      [['seed', 'reduce', 0], ['retitle', 'reduce', 1]]);
  });

  it('reads a history with no deltas as commits that wrote none', async () => {
    serve(encodeBeast2For(ResponseType(PreDeltaHistory))(variant('success', { commits: [
      { hash: HASH, parent: some(HASH), state: HASH, mutation: 'seed', actor: 'cli:x', at: AT },
      { hash: HASH, parent: none, state: HASH, mutation: '$init', actor: 'cli:x', at: AT },
    ] })));
    const { commits } = await workspaceRecordHistory(BASE, 'r', 'ws', 'plans', undefined, { token: null });
    assert.deepEqual(commits.map((c) => [c.mutation, c.delta.type]), [['seed', 'none'], ['$init', 'none']]);
  });

  it('reads a conflict with no detail as one naming no key, and every other outcome as sent', async () => {
    serve(encodeBeast2For(ResponseType(PreDetailResult))(variant('success', { outcome: variant('conflict', { attempts: 3n }) })));
    const conflict = await workspaceRecordMutate(BASE, 'r', 'ws', 'plans', 'patch', call, { token: null });
    assert.ok(conflict.outcome.type === 'conflict', `expected conflict, got ${conflict.outcome.type}`);
    assert.equal(conflict.outcome.value.attempts, 3n);
    assert.equal(conflict.outcome.value.detail.type, 'none');

    for (const outcome of [
      variant('committed', { commitHash: HASH, stateHash: HASH }),
      variant('invalid', { message: 'no such mutation' }),
      variant('failed', { exitCode: 1n, stderr: 'the reducer threw' }),
      variant('timed_out', { ms: 5n, stderr: 'a slow reducer' }),
    ]) {
      serve(encodeBeast2For(ResponseType(PreDetailResult))(variant('success', { outcome })));
      const result = await workspaceRecordMutate(BASE, 'r', 'ws', 'plans', 'patch', call, { token: null });
      assert.deepEqual(result.outcome, outcome, `a ${outcome.type} outcome reads as sent`);
    }
  });

  it('reads a too_large outcome, which a current server never sends, as a failure saying so', async () => {
    serve(encodeBeast2For(ResponseType(PreDetailResult))(variant('success', {
      outcome: variant('too_large', { bytes: 9n, limit: 8n, stderr: 'a large state\n' }),
    })));
    const result = await workspaceRecordMutate(BASE, 'r', 'ws', 'plans', 'patch', call, { token: null });
    assert.deepEqual(result.outcome, variant('failed', {
      exitCode: -1n,
      stderr: "a large state\nthe new state is 9 bytes, over the server's 8-byte limit\n",
    }));
  });
});

describe('record responses from a current server', () => {
  it('reads each field as sent', async () => {
    serve(encodeBeast2For(ResponseType(RecordSignatureType))(variant('success', {
      name: 'plans', mutations: [{ name: 'patch', argTypes: [], form: 'patch' }],
    })));
    assert.equal((await workspaceRecordDescribe(BASE, 'r', 'ws', 'plans', { token: null })).mutations[0]!.form, 'patch');

    serve(encodeBeast2For(ResponseType(RecordHistoryResultType))(variant('success', { commits: [
      { hash: HASH, parent: none, state: HASH, mutation: 'retitle', actor: 'cli:x', at: AT, delta: some(HASH) },
    ] })));
    const { commits } = await workspaceRecordHistory(BASE, 'r', 'ws', 'plans', 1, { token: null });
    assert.deepEqual(commits[0]!.delta, some(HASH));

    serve(encodeBeast2For(ResponseType(MutationResultType))(variant('success', {
      outcome: variant('conflict', { attempts: 1n, detail: some('delete of "p-7", which the record does not hold') }),
    })));
    const result = await workspaceRecordMutate(BASE, 'r', 'ws', 'plans', 'drop', call, { token: null });
    assert.ok(result.outcome.type === 'conflict', `expected conflict, got ${result.outcome.type}`);
    assert.deepEqual(result.outcome.value.detail, some('delete of "p-7", which the record does not hold'));
  });

  it('still refuses a body that is no known shape, with the current type\'s error', async () => {
    // A mutation whose third field is neither the current `form` nor absent,
    // as it is in the older shape: each reader fails on it somewhere else.
    const NoKnownSignature = StructType({
      name: StringType,
      mutations: ArrayType(StructType({ name: StringType, argTypes: ArrayType(EastTypeType), weight: IntegerType })),
    });
    const body = encodeBeast2For(ResponseType(NoKnownSignature))(variant('success', {
      name: 'plans', mutations: [{ name: 'seed', argTypes: [], weight: 1n }],
    }));
    const refusal = (type: EastType): string => {
      try {
        decodeBeast2For(ResponseType(type))(body);
      } catch (err) {
        return (err as Error).message;
      }
      throw new Error('a body of no known shape decoded');
    };
    const current = refusal(RecordSignatureType);
    assert.notEqual(current, refusal(PreFormSignature), 'the two readers refuse it in words of their own');

    serve(body);
    await assert.rejects(workspaceRecordDescribe(BASE, 'r', 'ws', 'plans', { token: null }), { message: current });
  });
});
