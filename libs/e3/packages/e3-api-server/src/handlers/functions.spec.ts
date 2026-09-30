/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
  East,
  IntegerType,
  NullType,
  StringType,
  encodeBeast2For,
  decodeBeast2For,
  encodeEastIR,
  toEastTypeValue,
  variant,
  some,
  none,
} from '@elaraai/east';
import { InMemoryTransferBackend, MockTaskRunner, type OneShotGrant } from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { BEAST2_CONTENT_TYPE, FunctionObjectType, PackageObjectType, type RunnerValue } from '@elaraai/e3-types';
import {
  listPackageFunctions,
  describePackageFunction,
  callFunctionSync,
  getSplitCallStatus,
} from './functions.js';
import { createOneShotRoutes, createPackageFunctionRoutes, oneShotAccessByRoles, type OneShotAccess } from '../routes/functions.js';
import {
  ResponseType,
  FunctionSignatureType,
  ExecuteResultType,
  FunctionCallRequestType,
  OneShotRequestType,
  PackageJobResponseType,
  SplitCallRequestType,
  SplitCallStatusType,
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
    environment: variant('none', null),
  };
  const fnHash = await storage.objects.write(REPO, encodeBeast2For(FunctionObjectType)(fnObject));

  const pkgObject = {
    tasks: new Map<string, string>(),
    data: { structure: variant('struct', new Map()), refs: new Map() },
    functions: new Map([['double', fnHash]]),
    records: new Map<string, string>(),
    sources: new Map(),
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

  it('a request runner override replaces the stored runner, under the elevated grant', async () => {
    await callFunctionSync(
      storage, REPO, runner, PKG, VERSION, 'double',
      callRequest([encodeInt(5n)], some(variant('east_py', { platforms: ['east-py-std'] }))), false, undefined, 'any'
    );
    const spec = runner.getDetachedCalls()[0]!;
    assert.deepEqual(spec.runner, variant('east_py', { platforms: ['east-py-std'] }));
  });

  it('runs a call that names no runner for any caller, and one whose runner loads no package the function does not', async () => {
    await callFunctionSync(storage, REPO, runner, PKG, VERSION, 'double', callRequest([encodeInt(5n)]), false, undefined, 'none');
    assert.deepEqual(runner.getDetachedCalls()[0]!.runner, variant('east_node', { platforms: ['@elaraai/east-node-std'] }), 'the function\'s own runner');

    await callFunctionSync(storage, REPO, runner, PKG, VERSION, 'double',
      callRequest([encodeInt(5n)], some(variant('east_c', { platforms: [] }))), false, undefined, 'platform_free');
    assert.deepEqual(runner.getDetachedCalls()[1]!.runner, variant('east_c', { platforms: [] }), 'another stock runtime, given fewer packages');
  });

  it('refuses a caller without the elevated grant a runner that loads a package the function does not, and runs nothing', async () => {
    for (const grant of ['platform_free', 'none'] as const) {
      const response = await callFunctionSync(storage, REPO, runner, PKG, VERSION, 'double',
        callRequest([encodeInt(5n)], some(variant('east_py', { platforms: ['east-py-std'] }))), false, undefined, grant);
      const result = await decodeResponse<any>(response, ExecuteResultType);
      assert.equal(result.type, 'error', grant);
      assert.deepEqual(result.value, variant('permission_denied', { path: 'runner' }), grant);
    }
    assert.equal(runner.getDetachedCalls().length, 0, 'nothing ran');
  });

  it('refuses a call that names the custom runtime, whatever the caller\'s grant, and runs nothing', async () => {
    for (const grant of ['any', 'platform_free', 'none'] as const) {
      const response = await callFunctionSync(storage, REPO, runner, PKG, VERSION, 'double',
        callRequest([encodeInt(5n)], some(variant('custom', { command: ['sh', '-c', 'echo ran'] }))), false, undefined, grant);
      const result = await decodeResponse<any>(response, ExecuteResultType);
      assert.equal(result.value.outcome.type, 'invalid', grant);
      assert.match(result.value.outcome.value.diagnostics[0].message, /names the custom runtime/, grant);
    }
    assert.equal(runner.getDetachedCalls().length, 0, 'nothing ran');
  });

  it('holds a runner a call names to the grant its routes\' access gives, and to none without one', async () => {
    const call = async (access: OneShotAccess | undefined): Promise<{ type: string; value: any }> => {
      const app = new Hono();
      app.route('/api/repos/:repo/packages/:pkg/:version/functions',
        createPackageFunctionRoutes(storage, () => REPO, () => runner, access === undefined ? {} : { access }));
      const response = await app.request(`/api/repos/r/packages/${PKG}/${VERSION}/functions/double`, {
        method: 'POST',
        headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
        body: encodeBeast2For(FunctionCallRequestType)(callRequest([encodeInt(5n)], some(variant('east_py', { platforms: ['east-py-std'] })))),
      });
      return decodeResponse<any>(response, ExecuteResultType);
    };
    assert.deepEqual((await call(undefined)).value, variant('permission_denied', { path: 'runner' }), 'no access: no caller adds a package');
    assert.deepEqual((await call(() => 'platform_free')).value, variant('permission_denied', { path: 'runner' }));
    assert.equal((await call(() => 'any')).type, 'success', 'an elevated caller adds one');
    assert.equal(runner.getDetachedCalls().length, 1);
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

describe('one-shot access', () => {
  const twice = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
  const log = East.platform('e3_test_log', [StringType], NullType);
  const logging = East.function([IntegerType], IntegerType, ($, x) => {
    $(log(East.value('called')));
    return x;
  });

  /** A one-shot request: a platform-free body on a runtime given no package,
   *  unless the test says otherwise. */
  const oneShotBody = (body: { toIR(): unknown } = twice, runner: RunnerValue = variant('east_node', { platforms: [] })): Uint8Array =>
    encodeBeast2For(OneShotRequestType)({
      bodyIr: encodeEastIR(body.toIR() as never),
      args: [],
      runner,
      limits: none,
    });

  /** The one-shot routes behind `access`, with the identity a host's auth
   *  sets, when there is one. */
  const buildApp = (access: OneShotAccess, runner: MockTaskRunner, roles?: string[]): Hono => {
    const app = new Hono();
    if (roles !== undefined) {
      app.use('*', async (c, next) => {
        (c as any).set('identity', { sub: 'user', roles });
        await next();
      });
    }
    app.route(
      '/api/repos/:repo/workspaces/:ws/one-shot',
      createOneShotRoutes(new InMemoryStorage(), () => REPO, new InMemoryTransferBackend({}), () => runner, { access })
    );
    return app;
  };

  const post = (app: Hono, body: Uint8Array = oneShotBody()) =>
    app.request('/api/repos/r/workspaces/w/one-shot', {
      method: 'POST',
      headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
      body,
    });

  it('gives an elevated role any one-shot, any other identity a platform-free one, and a request with none nothing', async () => {
    const grantOf = async (roles?: string[], elevated?: readonly string[]): Promise<string> => {
      const app = new Hono();
      if (roles !== undefined) {
        app.use('*', async (c, next) => {
          (c as any).set('identity', { sub: 'user', roles });
          await next();
        });
      }
      const access = elevated === undefined ? oneShotAccessByRoles() : oneShotAccessByRoles(elevated);
      app.get('/', async (c) => c.text(await access(c)));
      return (await app.request('/')).text();
    };
    assert.equal(await grantOf(['admin']), 'any');
    assert.equal(await grantOf(['owner']), 'any');
    assert.equal(await grantOf(['member']), 'platform_free');
    assert.equal(await grantOf([]), 'platform_free');
    assert.equal(await grantOf(undefined), 'none');
    assert.equal(await grantOf(['owner'], ['admin']), 'platform_free', 'a host names the roles it elevates');
  });

  it('answers permission_denied for a refused caller, and calls no runner', async () => {
    const refused: [OneShotGrant, Uint8Array][] = [
      ['none', oneShotBody()],
      ['platform_free', oneShotBody(logging)],
      ['platform_free', oneShotBody(twice, variant('east_node', { platforms: ['@elaraai/east-node-std'] }))],
      ['platform_free', oneShotBody(twice, variant('custom', { command: ['sh'] }))],
    ];
    for (const [grant, body] of refused) {
      const runner = new MockTaskRunner();
      const result = await decodeResponse<any>(await post(buildApp(() => grant, runner), body), ExecuteResultType);
      assert.equal(result.type, 'error');
      assert.deepEqual(result.value, variant('permission_denied', { path: 'one-shot' }));
      assert.equal(runner.getDetachedCalls().length, 0, 'nothing ran');
    }
  });

  it('runs a one-shot that uses a platform on a server without auth, as a single-tenant server always has', async () => {
    // Past the grant, the request fails on the workspace, which does not exist.
    const runner = new MockTaskRunner();
    const response = await post(buildApp(() => 'any', runner), oneShotBody(logging, variant('east_node', { platforms: ['@elaraai/east-node-std'] })));
    const result = await decodeResponse<any>(response, ExecuteResultType);
    assert.equal(result.type, 'error');
    assert.notEqual((result.value as { type: string }).type, 'permission_denied');
  });

  it('launches a split call only under a grant that runs it, and polls one only for a caller with a grant', async () => {
    const split = (runner: RunnerValue): Uint8Array => encodeBeast2For(SplitCallRequestType)({
      bodyIr: encodeEastIR(twice.toIR()),
      args: [{ arg: variant('value', encodeInt(1n)), partition: some({ by: [] }) }],
      output: variant('array', null),
      then: none,
      runner,
      limits: none,
    });
    const refused: [OneShotGrant, Uint8Array][] = [
      ['none', split(variant('east_node', { platforms: [] }))],
      ['platform_free', split(variant('east_node', { platforms: ['@elaraai/east-node-std'] }))],
    ];
    for (const [grant, body] of refused) {
      const runner = new MockTaskRunner();
      const response = await buildApp(() => grant, runner).request('/api/repos/r/workspaces/w/one-shot/split', {
        method: 'POST',
        headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
        body,
      });
      const result = await decodeResponse<any>(response, PackageJobResponseType);
      assert.equal(result.type, 'error');
      assert.deepEqual(result.value, variant('permission_denied', { path: 'one-shot' }));
      assert.equal(runner.getCalls().length, 0, 'nothing ran');
    }

    const polled = await buildApp(() => 'none', new MockTaskRunner()).request('/api/repos/r/workspaces/w/one-shot/split/job');
    const status = await decodeResponse<any>(polled, SplitCallStatusType);
    assert.deepEqual(status.value, variant('permission_denied', { path: 'one-shot' }));
  });

  it('answers a split call only through the repository and workspace that launched it, and a reader only one a reader could launch', async () => {
    const store = new InMemoryTransferBackend({}).splitCall;
    const plan = { pieces: 3n, over: 0n, bytes: 100n };
    // An explain's job, launched in workspace `w` of repository `r`: one a
    // reader could launch, and one only an elevated grant could.
    for (const [id, platformFree] of [['free', true], ['elevated', false]] as const) {
      await store.create(id, {
        repo: 'r', workspace: 'w', task: '', inputs: [], objects: [], then: none,
        limits: { timeoutMs: 1000n, maxResultBytes: 1024n, maxLogBytes: 1024n },
        read: [], explain: true, platformFree, status: variant('planned', plan), createdAt: new Date(),
      });
    }
    const poll = async (repo: string, ws: string, id: string, grant: OneShotGrant) =>
      decodeResponse<any>(await getSplitCallStatus(new InMemoryStorage(), repo, store, repo, ws, id, grant), SplitCallStatusType);

    for (const [repo, ws] of [['r', 'other'], ['other', 'w']] as const) {
      const elsewhere = await poll(repo, ws, 'free', 'any');
      assert.deepEqual(elsewhere, variant('error', variant('internal', { message: `workspace '${ws}' has no split call 'free'` })), `${repo}/${ws}`);
    }
    assert.deepEqual(await poll('r', 'w', 'free', 'any'), variant('success', variant('planned', plan)));
    assert.deepEqual(await poll('r', 'w', 'free', 'platform_free'), variant('success', variant('planned', plan)));
    assert.deepEqual(await poll('r', 'w', 'elevated', 'platform_free'), variant('error', variant('permission_denied', { path: 'one-shot' })));
    assert.deepEqual(await poll('r', 'w', 'elevated', 'any'), variant('success', variant('planned', plan)));
  });
});
