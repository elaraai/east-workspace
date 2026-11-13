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
  equalFor,
  printFor,
  toEastTypeValue,
  variant,
  some,
  none,
  type EastType,
  type EastTypeValue,
  type ValueTypeOf,
  type VariantType,
} from '@elaraai/east';
import { InMemoryTransferBackend, MockTaskRunner, type OneShotGrant } from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import {
  BEAST2_CONTENT_TYPE,
  FunctionObjectType,
  MutationObjectType,
  PackageObjectType,
  RecordCommitType,
  RecordObjectType,
  WorkspaceRecordType,
  type RunnerValue,
} from '@elaraai/e3-types';
import {
  listPackageFunctions,
  describePackageFunction,
  callFunctionSync,
  cancelSplitCall,
  getSplitCallStatus,
} from './functions.js';
import {
  createOneShotRoutes, createPackageFunctionRoutes, createWorkspaceFunctionRoutes, oneShotAccessByRoles,
  type DraftAccess, type OneShotAccess,
} from '../routes/functions.js';
import type { Identity } from '../identity.js';
import {
  ErrorType,
  ResponseType,
  FunctionSignatureType,
  ExecuteResultType,
  FunctionCallAnswerType,
  FunctionCallRequestType,
  FunctionDraftType,
  OneShotRequestType,
  PackageJobResponseType,
  SplitCallRequestType,
  SplitCallStatusType,
  type FunctionCallRequest,
  type FunctionDraft,
} from '../types.js';
import { ArrayType } from '@elaraai/east';

const REPO = 'test-repo';
const PKG = 'fn-pkg';
const VERSION = '1.0.0';

const encodeInt = encodeBeast2For(IntegerType);

/** A route's answer, decoded as the API answers `type`: a success holding a value of it, or an error. */
async function decodeResponse<T extends EastType>(response: Response, type: T): Promise<ValueTypeOf<VariantType<{ success: T; error: typeof ErrorType }>>> {
  return decodeBeast2For(ResponseType(type))(new Uint8Array(await response.arrayBuffer()));
}

/** What a host's auth sets on a request's context, as the routes read it. */
type IdentityEnv = { Variables: { identity?: Identity } };

/** The input `scaled` reads. */
const N_PATH = [variant('field', 'inputs'), variant('field', 'n')];

/** The record `planned` reads, and lets a call draft. */
const JOBS_PATH = [variant('field', 'records'), variant('field', 'jobs')];

/** Seed a repo containing a function `double` (Integer -> Integer),
 *  `scaled`, which reads `.inputs.n` and is given an Integer, and `planned`,
 *  which reads the record `jobs` and lists it in its drafts. */
async function seedPackage(storage: InMemoryStorage): Promise<void> {
  await storage.repos.create(REPO);

  const bodyIrHash = await storage.objects.write(REPO, encodeInt(0n)); // stand-in IR blob
  const fnObject = (inputs: typeof N_PATH[], drafts: string[] = []) => ({
    bodyIr: bodyIrHash,
    inputs,
    drafts,
    argTypes: [toEastTypeValue(IntegerType)],
    outputType: toEastTypeValue(IntegerType),
    runner: variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }),
    environment: none,
  });
  const fnHash = await storage.objects.write(REPO, encodeBeast2For(FunctionObjectType)(fnObject([])));
  const scaledHash = await storage.objects.write(REPO, encodeBeast2For(FunctionObjectType)(fnObject([N_PATH])));
  const plannedHash = await storage.objects.write(REPO, encodeBeast2For(FunctionObjectType)(fnObject([JOBS_PATH], ['jobs'])));

  const pkgObject = {
    tasks: new Map<string, string>(),
    data: { structure: variant('struct', new Map()), refs: new Map() },
    functions: new Map([['double', fnHash], ['planned', plannedHash], ['scaled', scaledHash]]),
    records: new Map<string, string>(),
    sources: new Map(),
  };
  const pkgHash = await storage.objects.write(REPO, encodeBeast2For(PackageObjectType)(pkgObject));
  await storage.refs.packageWrite(REPO, PKG, VERSION, pkgHash);
}

/** A call of value arguments, each one's bytes. */
function callRequest(args: Uint8Array[], runner?: FunctionCallRequest['runner']): FunctionCallRequest {
  return { args: args.map((arg) => variant('value', arg)), runner: runner ?? none, limits: none, drafts: [] };
}

describe('function handlers', () => {
  let storage: InMemoryStorage;
  let runner: MockTaskRunner;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    runner = new MockTaskRunner();
    await seedPackage(storage);
  });

  it('listPackageFunctions surfaces each signature, the inputs a call reads apart from its arguments, and the records it may draft', async () => {
    const response = await listPackageFunctions(storage, REPO, PKG, VERSION);
    const result = await decodeResponse(response, ArrayType(FunctionSignatureType));
    assert.ok(result.type === 'success');
    assert.deepEqual(result.value.map((signature) => signature.name), ['double', 'planned', 'scaled']);
    const [double, planned, scaled] = result.value;
    assert.equal(double!.argTypes.length, 1);
    assert.equal(double!.inputs.length, 0);
    assert.deepEqual(double!.drafts, []);
    assert.equal(double!.outputType.type, 'Integer');
    assert.deepEqual(planned!.inputs, [JOBS_PATH]);
    assert.deepEqual(planned!.drafts, ['jobs']);
    assert.deepEqual(scaled!.inputs, [N_PATH]);
    assert.deepEqual(scaled!.drafts, [], 'an input is read as stored: only a listed record takes a draft');
    assert.equal(scaled!.argTypes.length, 1);
  });

  it('describePackageFunction answers one function\'s signature, as the list holds it', async () => {
    const listed = await decodeResponse(await listPackageFunctions(storage, REPO, PKG, VERSION), ArrayType(FunctionSignatureType));
    assert.ok(listed.type === 'success');
    for (const signature of listed.value) {
      const described = await decodeResponse(await describePackageFunction(storage, REPO, PKG, VERSION, signature.name), FunctionSignatureType);
      assert.deepEqual(described, variant('success', signature), signature.name);
    }
  });

  it('answers a function with inputs through the package, which has no workspace to read them from, invalid without executing', async () => {
    const response = await callFunctionSync(storage, REPO, runner, PKG, VERSION, 'scaled', callRequest([encodeInt(5n)]));
    const result = await decodeResponse(response, ExecuteResultType);
    assert.ok(result.type === 'success');
    const { outcome } = result.value;
    assert.ok(outcome.type === 'invalid');
    assert.equal(
      outcome.value.diagnostics[0]!.message,
      '\'scaled\' reads .inputs.n from the workspace it is called through, and a call through the package has none: '
      + 'call it through a workspace it is deployed to, at …/workspaces/<ws>/functions/scaled',
    );
    assert.equal(runner.getDetachedCalls().length, 0, 'nothing should have executed');
  });

  it('counts a function\'s arguments alone, never its inputs', async () => {
    const response = await callFunctionSync(storage, REPO, runner, PKG, VERSION, 'scaled', callRequest([encodeInt(1n), encodeInt(5n)]));
    const result = await decodeResponse(response, ExecuteResultType);
    assert.ok(result.type === 'success');
    const { outcome } = result.value;
    assert.ok(outcome.type === 'invalid');
    assert.equal(outcome.value.diagnostics[0]!.message, 'Expected 1 argument(s), got 2');
    assert.equal(runner.getDetachedCalls().length, 0, 'nothing should have executed');
  });

  it('describePackageFunction returns task_not_found for unknown functions', async () => {
    const response = await describePackageFunction(storage, REPO, PKG, VERSION, 'nope');
    const result = await decodeResponse(response, FunctionSignatureType);
    assert.ok(result.type === 'error');
    assert.equal(result.value.type, 'task_not_found');
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
    const result = await decodeResponse(response, ExecuteResultType);
    assert.ok(result.type === 'success');
    const { outcome } = result.value;
    assert.ok(outcome.type === 'success');
    assert.equal(decodeBeast2For(IntegerType)(outcome.value.value), 10n);
    assert.equal(result.value.stdout, 'log line');

    // The stored runner reached the spec
    const spec = runner.getDetachedCalls()[0]!;
    assert.deepEqual(spec.runner, variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }));
  });

  it('a request runner override replaces the stored runner, under the elevated grant', async () => {
    await callFunctionSync(
      storage, REPO, runner, PKG, VERSION, 'double',
      callRequest([encodeInt(5n)], some(variant('east_py', { platforms: ['east-py-std'], decode: variant('whole', null) }))), false, undefined, 'any'
    );
    const spec = runner.getDetachedCalls()[0]!;
    assert.deepEqual(spec.runner, variant('east_py', { platforms: ['east-py-std'], decode: variant('whole', null) }), 'and how it reads the inputs with it');
  });

  it('runs a call that names no runner for any caller, and one whose runner loads no package the function does not', async () => {
    await callFunctionSync(storage, REPO, runner, PKG, VERSION, 'double', callRequest([encodeInt(5n)]), false, undefined, 'none');
    assert.deepEqual(runner.getDetachedCalls()[0]!.runner, variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }), 'the function\'s own runner');

    await callFunctionSync(storage, REPO, runner, PKG, VERSION, 'double',
      callRequest([encodeInt(5n)], some(variant('east_c', { platforms: [], decode: variant('lazy', null) }))), false, undefined, 'platform_free');
    assert.deepEqual(runner.getDetachedCalls()[1]!.runner, variant('east_c', { platforms: [], decode: variant('lazy', null) }), 'another stock runtime, given fewer packages');
  });

  it('refuses a caller without the elevated grant a runner that loads a package the function does not, and runs nothing', async () => {
    for (const grant of ['platform_free', 'none'] as const) {
      const response = await callFunctionSync(storage, REPO, runner, PKG, VERSION, 'double',
        callRequest([encodeInt(5n)], some(variant('east_py', { platforms: ['east-py-std'], decode: variant('lazy', null) }))), false, undefined, grant);
      const result = await decodeResponse(response, ExecuteResultType);
      assert.equal(result.type, 'error', grant);
      assert.deepEqual(result.value, variant('permission_denied', { path: 'runner' }), grant);
    }
    assert.equal(runner.getDetachedCalls().length, 0, 'nothing ran');
  });

  it('refuses a call that names the custom runtime, whatever the caller\'s grant, and runs nothing', async () => {
    for (const grant of ['any', 'platform_free', 'none'] as const) {
      const response = await callFunctionSync(storage, REPO, runner, PKG, VERSION, 'double',
        callRequest([encodeInt(5n)], some(variant('custom', { command: ['sh', '-c', 'echo ran'] }))), false, undefined, grant);
      const result = await decodeResponse(response, ExecuteResultType);
      assert.ok(result.type === 'success', grant);
      const { outcome } = result.value;
      assert.ok(outcome.type === 'invalid', grant);
      assert.match(outcome.value.diagnostics[0]!.message, /names the custom runtime/, grant);
    }
    assert.equal(runner.getDetachedCalls().length, 0, 'nothing ran');
  });

  it('holds a runner a call names to the grant its routes\' access gives, and to none without one', async () => {
    const call = async (access: OneShotAccess | undefined) => {
      const app = new Hono();
      app.route('/api/repos/:repo/packages/:pkg/:version/functions',
        createPackageFunctionRoutes(storage, () => REPO, () => runner, access === undefined ? {} : { access }));
      const response = await app.request(`/api/repos/r/packages/${PKG}/${VERSION}/functions/double`, {
        method: 'POST',
        headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
        body: encodeBeast2For(FunctionCallRequestType)(callRequest([encodeInt(5n)], some(variant('east_py', { platforms: ['east-py-std'], decode: variant('lazy', null) })))),
      });
      return decodeResponse(response, ExecuteResultType);
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
    const result = await decodeResponse(response, ExecuteResultType);
    assert.ok(result.type === 'success');
    const { outcome } = result.value;
    assert.ok(outcome.type === 'invalid');
    assert.match(outcome.value.diagnostics[0]!.message, /Expected 1 argument/);
    assert.equal(runner.getDetachedCalls().length, 0, 'nothing should have executed');
  });

  it('answers a dataset argument through the package, which has no workspace to read it from, invalid without executing', async () => {
    const response = await callFunctionSync(
      storage, REPO, runner, PKG, VERSION, 'double',
      { args: [variant('dataset', [variant('field', 'inputs'), variant('field', 'n')])], runner: none, limits: none, drafts: [] }
    );
    const result = await decodeResponse(response, ExecuteResultType);
    assert.ok(result.type === 'success');
    const { outcome } = result.value;
    assert.ok(outcome.type === 'invalid');
    assert.equal(
      outcome.value.diagnostics[0]!.message,
      'Argument 0 is the dataset .inputs.n, and a call through the package has no workspace to read it from: '
      + 'call the function through a workspace it is deployed to, at …/workspaces/<ws>/functions/double',
    );
    assert.deepEqual(result.value.inputs, []);
    assert.equal(runner.getDetachedCalls().length, 0, 'nothing should have executed');
  });

  it('answers a draft through the package, which reads no workspace to lay it over, invalid without executing', async () => {
    const response = await callFunctionSync(
      storage, REPO, runner, PKG, VERSION, 'double',
      { ...callRequest([encodeInt(5n)]), drafts: [{ record: 'jobs', mutation: 'patch', args: [] }] }
    );
    const result = await decodeResponse(response, ExecuteResultType);
    assert.ok(result.type === 'success');
    const { outcome } = result.value;
    assert.ok(outcome.type === 'invalid');
    assert.equal(
      outcome.value.diagnostics[0]!.message,
      'The call passes 1 draft(s), and a call through the package reads no workspace to lay one over: '
      + 'start it as a call a workspace keeps, at …/workspaces/<ws>/functions/double',
    );
    assert.equal(result.value.drafts.length, 0);
    assert.equal(runner.getDetachedCalls().length, 0, 'nothing should have executed');
  });

  it('answers a draft of a call a host runs within its request, which keeps no call to hold what is laid, invalid without executing', async () => {
    // A function that lists the record, called in a workspace: the one thing
    // missing is a call that is kept
    const response = await callFunctionSync(
      storage, REPO, runner, PKG, VERSION, 'planned',
      { ...callRequest([encodeInt(5n)]), drafts: [{ record: 'jobs', mutation: 'patch', args: [] }, { record: 'jobs', mutation: 'patch', args: [] }] },
      false, undefined, 'platform_free', 'main',
    );
    const result = await decodeResponse(response, ExecuteResultType);
    assert.ok(result.type === 'success');
    const { outcome } = result.value;
    assert.ok(outcome.type === 'invalid');
    assert.equal(
      outcome.value.diagnostics[0]!.message,
      'The call passes 2 draft(s), and a call run within its request lays none: '
      + 'start it as a call a workspace keeps, at …/workspaces/main/functions/planned',
    );
    assert.equal(result.value.drafts.length, 0);
    assert.deepEqual(result.value.inputs, [], 'it read nothing of the workspace');
    assert.equal(runner.getCalls().length + runner.getDetachedCalls().length, 0, 'nothing should have executed: no mutation\'s program, nor the function');
  });

});

describe('draft access', () => {
  const WS = 'main';
  const STOCK = variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) });
  const sameDrafts = equalFor(ArrayType(FunctionDraftType));
  const printDrafts = printFor(ArrayType(FunctionDraftType));

  let storage: InMemoryStorage;
  let runner: MockTaskRunner;

  /** Deploys to `WS` a package of the record `jobs`, an Integer two reducers
   *  write, and the function `planned`, which reads it and lists it in its
   *  drafts. */
  beforeEach(async () => {
    storage = new InMemoryStorage();
    runner = new MockTaskRunner();
    await storage.repos.create(REPO);

    const state = await storage.objects.write(REPO, encodeInt(0n));
    const genesis = await storage.objects.write(REPO, encodeBeast2For(RecordCommitType)({
      parent: none, state, mutation: '$init', args: none, actor: 'system:deploy', at: new Date(0), delta: none,
    }));
    const ir = await storage.objects.write(REPO, encodeInt(0n)); // stand-in IR: the mock runner reads none
    const reducer = (argTypes: EastTypeValue[]): Promise<string> =>
      storage.objects.write(REPO, encodeBeast2For(MutationObjectType)({ bodyIr: ir, argTypes, runner: STOCK, form: variant('reduce', null), programIr: '' }));
    const record = await storage.objects.write(REPO, encodeBeast2For(RecordObjectType)({
      path: 'records/jobs',
      mutations: new Map([['add', await reducer([toEastTypeValue(IntegerType)])], ['reset', await reducer([])]]),
      indexes: new Map(),
      migrations: [],
    }));
    const planned = await storage.objects.write(REPO, encodeBeast2For(FunctionObjectType)({
      bodyIr: ir, inputs: [JOBS_PATH], drafts: ['jobs'], argTypes: [], outputType: toEastTypeValue(IntegerType), runner: STOCK, environment: none,
    }));
    const structure = variant('struct', new Map([
      ['records', variant('struct', new Map([
        ['jobs', variant('value', { type: toEastTypeValue(IntegerType), writable: false })],
      ]))],
    ]));
    const pkg = await storage.objects.write(REPO, encodeBeast2For(PackageObjectType)({
      tasks: new Map(),
      data: { structure, refs: new Map([['records/jobs', variant('value', { hash: state, versions: new Map() })]]) },
      functions: new Map([['planned', planned]]),
      records: new Map([['jobs', record]]),
      sources: new Map(),
    }));
    await storage.refs.packageWrite(REPO, 'plans', '1.0.0', pkg);
    await storage.refs.workspaceWrite(REPO, WS, encodeBeast2For(WorkspaceRecordType)(some({
      packageName: 'plans', packageVersion: '1.0.0', packageHash: pkg, deployedAt: new Date(0), currentRunId: none,
    })));
    await storage.datasets.write(REPO, WS, 'records/jobs', variant('value', { hash: state, versions: new Map([['.records.jobs', genesis]]) }));

    // Each reducer's run leaves a state the store holds, and the function answers
    runner.setDefaultResult({ state: 'success', cached: false, outputHash: await storage.objects.write(REPO, encodeInt(7n)) });
    runner.setDetachedResult({ kind: 'success', value: encodeInt(7n), stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false });
  });

  const add = (by: bigint): FunctionDraft => ({ record: 'jobs', mutation: 'add', args: [encodeInt(by)] });
  const reset: FunctionDraft = { record: 'jobs', mutation: 'reset', args: [] };

  /** The workspace's function routes as a host mounts them: with its rule for
   *  drafts, or with none. Its calls run in this process, on `runner`. */
  const buildApp = (draftAccess?: DraftAccess): Hono => {
    const app = new Hono();
    const transfer = new InMemoryTransferBackend({ storage, getRepoPath: () => REPO, getRunner: () => runner });
    app.route('/api/repos/:repo/workspaces/:ws/functions',
      createWorkspaceFunctionRoutes(storage, () => REPO, transfer, draftAccess === undefined ? {} : { draftAccess }));
    return app;
  };

  /** A call of `planned` that passes `drafts`: started, or made within its request. */
  const post = (app: Hono, route: 'calls' | 'sync', drafts: FunctionDraft[]): Promise<Response> =>
    Promise.resolve(app.request(`/api/repos/r/workspaces/${WS}/functions/planned${route === 'calls' ? '/calls' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
      body: encodeBeast2For(FunctionCallRequestType)({ args: [], runner: none, limits: none, drafts }),
    }));

  const keptCalls = async (): Promise<number> => (await storage.calls.list(REPO, WS, { limit: 10 })).calls.length;

  it('asks the host of each draft a call passes, in the order passed, with the request it came in, before the call is filed', async () => {
    for (const route of ['calls', 'sync'] as const) {
      const asked: Array<{ ws: string; draft: FunctionDraft; filed: number }> = [];
      const app = buildApp(async (c, draft) => {
        asked.push({ ws: c.req.param('ws')!, draft, filed: await keptCalls() });
        return true;
      });
      const before = await keptCalls();
      const passed = [add(2n), reset, add(5n)];
      const response = await post(app, route, passed);

      assert.ok(sameDrafts(asked.map(({ draft }) => draft), passed), `${route}: asked of ${printDrafts(asked.map(({ draft }) => draft))}`);
      assert.deepEqual(asked.map(({ ws }) => ws), [WS, WS, WS], `${route}: with the request's own context`);
      assert.deepEqual(asked.map(({ filed }) => filed), [before, before, before], `${route}: before any call is filed`);
      const result = route === 'calls'
        ? await decodeResponse(response, FunctionCallAnswerType).then((answer) => (
          answer.type === 'success' && answer.value.status.type === 'completed' ? answer.value.status.value : assert.fail(`${route}: not completed`)))
        : await decodeResponse(response, ExecuteResultType).then((answer) => (answer.type === 'success' ? answer.value : assert.fail(`${route}: an error`)));
      assert.equal(result.outcome.type, 'success', `${route}: every draft admitted, the call runs`);
      assert.deepEqual(result.drafts.map((drafted) => drafted.record), ['jobs'], `${route}: and names the record it drafted`);
      assert.equal(await keptCalls(), before + 1, `${route}: one call, kept`);
    }
    assert.equal(runner.getCalls().length, 6, 'each draft\'s reducer ran, for each call');
    assert.equal(runner.getDetachedCalls().length, 2);
  });

  it('answers a draft the host refuses permission_denied, naming its record and mutation, and files and runs nothing', async () => {
    for (const route of ['calls', 'sync'] as const) {
      const asked: string[] = [];
      const app = buildApp((_c, draft) => {
        asked.push(draft.mutation);
        return draft.mutation !== 'reset';
      });
      const response = await post(app, route, [add(2n), reset, add(5n)]);
      const answer = route === 'calls' ? await decodeResponse(response, FunctionCallAnswerType) : await decodeResponse(response, ExecuteResultType);
      assert.equal(answer.type, 'error', route);
      assert.deepEqual(answer.value, variant('permission_denied', { path: 'draft jobs.reset' }), route);
      assert.deepEqual(asked, ['add', 'reset'], `${route}: asked up to the first it refuses, and no further`);
    }
    assert.equal(await keptCalls(), 0, 'no call is filed');
    assert.equal(runner.getCalls().length + runner.getDetachedCalls().length, 0, 'and nothing runs: no reducer, nor the function');
  });

  it('admits every draft for a host that gives no rule, and asks nothing of a call that passes none', async () => {
    const open = await decodeResponse(await post(buildApp(), 'sync', [add(2n), reset]), ExecuteResultType);
    assert.ok(open.type === 'success' && open.value.outcome.type === 'success', 'no rule: what the mutate route allows');
    assert.equal(runner.getCalls().length, 2, 'both drafts laid');

    let asked = 0;
    const closed = buildApp(() => {
      asked += 1;
      return false;
    });
    const plain = await decodeResponse(await post(closed, 'sync', []), ExecuteResultType);
    assert.ok(plain.type === 'success' && plain.value.outcome.type === 'success', 'a call with no draft runs whatever the rule');
    assert.equal(asked, 0);
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
  const oneShotBody = (body: { toIR(): unknown } = twice, runner: RunnerValue = variant('east_node', { platforms: [], decode: variant('lazy', null) })): Uint8Array =>
    encodeBeast2For(OneShotRequestType)({
      bodyIr: encodeEastIR(body.toIR() as never),
      args: [],
      runner,
      limits: none,
    });

  /** The one-shot routes behind `access`, with the identity a host's auth
   *  sets, when there is one. */
  const buildApp = (access: OneShotAccess, runner: MockTaskRunner, roles?: string[]): Hono<IdentityEnv> => {
    const app = new Hono<IdentityEnv>();
    if (roles !== undefined) {
      app.use('*', async (c, next) => {
        c.set('identity', { sub: 'user', roles });
        await next();
      });
    }
    app.route(
      '/api/repos/:repo/workspaces/:ws/one-shot',
      createOneShotRoutes(new InMemoryStorage(), () => REPO, new InMemoryTransferBackend({}), () => runner, { access })
    );
    return app;
  };

  const post = (app: Hono<IdentityEnv>, body: Uint8Array = oneShotBody()) =>
    app.request('/api/repos/r/workspaces/w/one-shot', {
      method: 'POST',
      headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
      body,
    });

  it('gives an elevated role any one-shot, any other identity a platform-free one, and a request with none nothing', async () => {
    const grantOf = async (roles?: string[], elevated?: readonly string[]): Promise<string> => {
      const app = new Hono<IdentityEnv>();
      if (roles !== undefined) {
        app.use('*', async (c, next) => {
          c.set('identity', { sub: 'user', roles });
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
      ['platform_free', oneShotBody(twice, variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }))],
      ['platform_free', oneShotBody(twice, variant('custom', { command: ['sh'] }))],
    ];
    for (const [grant, body] of refused) {
      const runner = new MockTaskRunner();
      const result = await decodeResponse(await post(buildApp(() => grant, runner), body), ExecuteResultType);
      assert.equal(result.type, 'error');
      assert.deepEqual(result.value, variant('permission_denied', { path: 'one-shot' }));
      assert.equal(runner.getDetachedCalls().length, 0, 'nothing ran');
    }
  });

  it('runs a one-shot that uses a platform on a server without auth, as a single-tenant server always has', async () => {
    // Past the grant, the request fails on the workspace, which does not exist.
    const runner = new MockTaskRunner();
    const response = await post(buildApp(() => 'any', runner), oneShotBody(logging, variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) })));
    const result = await decodeResponse(response, ExecuteResultType);
    assert.ok(result.type === 'error');
    assert.notEqual(result.value.type, 'permission_denied');
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
      ['none', split(variant('east_node', { platforms: [], decode: variant('lazy', null) }))],
      ['platform_free', split(variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }))],
    ];
    for (const [grant, body] of refused) {
      const runner = new MockTaskRunner();
      const response = await buildApp(() => grant, runner).request('/api/repos/r/workspaces/w/one-shot/split', {
        method: 'POST',
        headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
        body,
      });
      const result = await decodeResponse(response, PackageJobResponseType);
      assert.equal(result.type, 'error');
      assert.deepEqual(result.value, variant('permission_denied', { path: 'one-shot' }));
      assert.equal(runner.getCalls().length, 0, 'nothing ran');
    }

    const polled = await buildApp(() => 'none', new MockTaskRunner()).request('/api/repos/r/workspaces/w/one-shot/split/job');
    const status = await decodeResponse(polled, SplitCallStatusType);
    assert.deepEqual(status.value, variant('permission_denied', { path: 'one-shot' }));
  });

  it('answers a split call only through the repository and workspace that launched it, and a reader only one a reader could launch', async () => {
    const store = new InMemoryTransferBackend({}).splitCall;
    const plan = { pieces: 3n, over: 0n, bytes: 100n };
    // An explain's job, launched in workspace `w` of repository `r`: one a
    // reader could launch, and one only an elevated grant could.
    for (const [id, platformFree] of [['free', true], ['elevated', false]] as const) {
      await store.create(id, {
        repo: 'r', workspace: 'w', task: '', inputs: [], objects: [], then: none, first: none,
        limits: { timeoutMs: 1000n, maxResultBytes: 1024n, maxLogBytes: 1024n },
        read: [], explain: true, platformFree, status: variant('planned', plan), createdAt: new Date(),
      });
    }
    const poll = async (repo: string, ws: string, id: string, grant: OneShotGrant) =>
      decodeResponse(await getSplitCallStatus(new InMemoryStorage(), repo, store, repo, ws, id, grant), SplitCallStatusType);

    for (const [repo, ws] of [['r', 'other'], ['other', 'w']] as const) {
      const elsewhere = await poll(repo, ws, 'free', 'any');
      assert.deepEqual(elsewhere, variant('error', variant('internal', { message: `workspace '${ws}' has no split call 'free'` })), `${repo}/${ws}`);
    }
    assert.deepEqual(await poll('r', 'w', 'free', 'any'), variant('success', variant('planned', plan)));
    assert.deepEqual(await poll('r', 'w', 'free', 'platform_free'), variant('success', variant('planned', plan)));
    assert.deepEqual(await poll('r', 'w', 'elevated', 'platform_free'), variant('error', variant('permission_denied', { path: 'one-shot' })));
    assert.deepEqual(await poll('r', 'w', 'elevated', 'any'), variant('success', variant('planned', plan)));
  });

  it('cancels a split call for whoever may poll it, and only while it runs: a cancel never overwrites an end, nor an end a cancel (#1104)', async () => {
    const store = new InMemoryTransferBackend({}).splitCall;
    const plan = { pieces: 3n, over: 0n, bytes: 100n };
    // Jobs launched in workspace `w` of repository `r`: two that run, one a
    // reader could launch and one only an elevated grant could, and one
    // that has ended.
    for (const [id, platformFree, status] of [
      ['running', true, variant('processing', none)],
      ['elevated', false, variant('processing', none)],
      ['planned', true, variant('planned', plan)],
    ] as const) {
      await store.create(id, {
        repo: 'r', workspace: 'w', task: '', inputs: [], objects: [], then: none, first: none,
        limits: { timeoutMs: 1000n, maxResultBytes: 1024n, maxLogBytes: 1024n },
        read: [], explain: true, platformFree, status, createdAt: new Date(),
      });
    }
    const cancel = async (ws: string, id: string, grant: OneShotGrant) =>
      decodeResponse(await cancelSplitCall(new InMemoryStorage(), 'r', store, 'r', ws, id, grant), SplitCallStatusType);

    assert.deepEqual(await cancel('w', 'running', 'none'), variant('error', variant('permission_denied', { path: 'one-shot' })));
    assert.deepEqual(await cancel('w', 'elevated', 'platform_free'), variant('error', variant('permission_denied', { path: 'one-shot' })));
    assert.deepEqual(await cancel('other', 'running', 'any'), variant('error', variant('internal', { message: 'workspace \'other\' has no split call \'running\'' })));
    for (const id of ['running', 'elevated']) {
      assert.equal((await store.get(id))?.status.type, 'processing', `no refused cancel stopped ${id}`);
    }

    assert.deepEqual(await cancel('w', 'running', 'platform_free'), variant('success', variant('cancelled', null)));
    assert.deepEqual(await cancel('w', 'running', 'any'), variant('success', variant('cancelled', null)), 'cancelled again, it stays so');
    assert.equal(await store.updateStatus('running', variant('failed', { message: 'too late' })), false, 'an end written after the cancel is refused');
    assert.equal((await store.get('running'))?.status.type, 'cancelled');
    assert.deepEqual(await cancel('w', 'elevated', 'any'), variant('success', variant('cancelled', null)));
    assert.deepEqual(await cancel('w', 'planned', 'any'), variant('success', variant('planned', plan)), 'a job that has ended answers as it ended');
  });
});
