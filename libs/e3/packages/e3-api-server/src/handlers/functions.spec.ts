/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
  IntegerType,
  encodeBeast2For,
  decodeBeast2For,
  toEastTypeValue,
  variant,
  some,
  none,
} from '@elaraai/east';
import { MockTaskRunner, BEAST2_CONTENT_TYPE } from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { FunctionObjectType, PackageObjectType } from '@elaraai/e3-types';
import {
  listPackageFunctions,
  describePackageFunction,
  callFunctionSync,
} from './functions.js';
import { createOneShotRoutes } from '../routes/functions.js';
import {
  ResponseType,
  FunctionSignatureType,
  ExecuteResultType,
  OneShotRequestType,
  type FunctionCallRequest,
} from '../types.js';
import { ArrayType } from '@elaraai/east';

const REPO = 'test-repo';
const PKG = 'fn-pkg';
const VERSION = '1.0.0';

const encodeInt = encodeBeast2For(IntegerType);

async function decodeResponse<T>(response: Response, type: any): Promise<{ type: string; value: T }> {
  const body = new Uint8Array(await response.arrayBuffer());
  return decodeBeast2For(ResponseType(type))(body) as { type: string; value: T };
}

/** Seed a repo containing one function `double` (Integer -> Integer). */
async function seedPackage(storage: InMemoryStorage): Promise<void> {
  await storage.repos.create(REPO);

  const bodyIrHash = await storage.objects.write(REPO, encodeInt(0n)); // stand-in IR blob
  const fnObject = {
    bodyIr: bodyIrHash,
    inputTypes: [toEastTypeValue(IntegerType)],
    outputType: toEastTypeValue(IntegerType),
    runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
  };
  const fnHash = await storage.objects.write(REPO, encodeBeast2For(FunctionObjectType)(fnObject));

  const pkgObject = {
    tasks: new Map<string, string>(),
    data: { structure: variant('struct', new Map()), refs: new Map() },
    functions: new Map([['double', fnHash]]),
  };
  const pkgHash = await storage.objects.write(REPO, encodeBeast2For(PackageObjectType)(pkgObject));
  await storage.refs.packageWrite(REPO, PKG, VERSION, pkgHash);
}

function callRequest(args: Uint8Array[], runner?: FunctionCallRequest['runner']): FunctionCallRequest {
  return { args, runner: runner ?? none, limits: none };
}

describe('function handlers', () => {
  let storage: InMemoryStorage;
  let runner: MockTaskRunner;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    runner = new MockTaskRunner();
    await seedPackage(storage);
  });

  it('listPackageFunctions surfaces the signature', async () => {
    const response = await listPackageFunctions(storage, REPO, PKG, VERSION);
    const result = await decodeResponse<any[]>(response, ArrayType(FunctionSignatureType));
    assert.equal(result.type, 'success');
    assert.equal(result.value.length, 1);
    assert.equal(result.value[0].name, 'double');
    assert.equal(result.value[0].inputTypes.length, 1);
    assert.equal(result.value[0].outputType.type, 'Integer');
  });

  it('describePackageFunction returns task_not_found for unknown functions', async () => {
    const response = await describePackageFunction(storage, REPO, PKG, VERSION, 'nope');
    const result = await decodeResponse<any>(response, FunctionSignatureType);
    assert.equal(result.type, 'error');
    assert.equal((result.value as { type: string }).type, 'task_not_found');
  });

  it('callFunctionSync returns the runner result inline', async () => {
    const payload = encodeInt(10n);
    runner.setDetachedResult({
      kind: 'success', value: payload,
      stdout: 'log line', stderr: '', stdoutTruncated: false, stderrTruncated: false,
    });

    const response = await callFunctionSync(
      storage, REPO, runner, PKG, VERSION, 'double',
      callRequest([encodeInt(5n)])
    );
    const result = await decodeResponse<any>(response, ExecuteResultType);
    assert.equal(result.type, 'success');
    assert.equal(result.value.outcome.type, 'success');
    assert.equal(decodeBeast2For(IntegerType)(result.value.outcome.value.value), 10n);
    assert.equal(result.value.stdout, 'log line');

    // The stored runner reached the spec
    const spec = runner.getDetachedCalls()[0]!;
    assert.deepEqual(spec.runner, variant('east_node', { platforms: ['@elaraai/east-node-std'] }));
  });

  it('a request runner override replaces the stored runner', async () => {
    await callFunctionSync(
      storage, REPO, runner, PKG, VERSION, 'double',
      callRequest([encodeInt(5n)], some(variant('east_py', { platforms: ['east-py-std'] })))
    );
    const spec = runner.getDetachedCalls()[0]!;
    assert.deepEqual(spec.runner, variant('east_py', { platforms: ['east-py-std'] }));
  });

  it('arity mismatch returns invalid without executing', async () => {
    const response = await callFunctionSync(
      storage, REPO, runner, PKG, VERSION, 'double',
      callRequest([encodeInt(1n), encodeInt(2n)])
    );
    const result = await decodeResponse<any>(response, ExecuteResultType);
    assert.equal(result.type, 'success');
    assert.equal(result.value.outcome.type, 'invalid');
    assert.match(result.value.outcome.value.diagnostics[0].message, /Expected 1 argument/);
    assert.equal(runner.getDetachedCalls().length, 0, 'nothing should have executed');
  });

});

describe('one-shot role gate', () => {
  const oneShotBody = (): Uint8Array =>
    encodeBeast2For(OneShotRequestType)({
      bodyIr: new Uint8Array([0]),
      args: [],
      runner: variant('east_node', { platforms: [] }),
      limits: none,
    });

  const buildApp = (roles: string[] | undefined): Hono => {
    const storage = new InMemoryStorage();
    const runner = new MockTaskRunner();
    const app = new Hono();
    if (roles !== undefined) {
      app.use('*', async (c, next) => {
        (c as any).set('identity', { sub: 'user', roles });
        await next();
      });
    }
    app.route(
      '/api/repos/:repo/workspaces/:ws/one-shot',
      createOneShotRoutes(storage, () => REPO, () => runner)
    );
    return app;
  };

  const post = (app: Hono) =>
    app.request('/api/repos/r/workspaces/w/one-shot', {
      method: 'POST',
      headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
      body: oneShotBody(),
    });

  it('refuses one-shot without an elevated role', async () => {
    const response = await post(buildApp(['member']));
    const result = await decodeResponse<any>(response, ExecuteResultType);
    assert.equal(result.type, 'error');
    assert.equal((result.value as { type: string }).type, 'permission_denied');
  });

  it('admits an admin past the gate (fails later on the missing workspace)', async () => {
    const response = await post(buildApp(['admin']));
    const result = await decodeResponse<any>(response, ExecuteResultType);
    assert.equal(result.type, 'error');
    assert.notEqual((result.value as { type: string }).type, 'permission_denied');
  });

  it('admits unauthenticated callers when no auth is configured (single-tenant)', async () => {
    const response = await post(buildApp(undefined));
    const result = await decodeResponse<any>(response, ExecuteResultType);
    assert.equal(result.type, 'error');
    assert.notEqual((result.value as { type: string }).type, 'permission_denied');
  });
});
