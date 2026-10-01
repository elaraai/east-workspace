/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The portable entry (`@elaraai/e3-api-server/portable`): the route factories,
 * the handlers and the repository gate, with nothing of Node.
 *
 * Every module the entry reaches imports only another of them, East, e3's
 * types, e3-core's portable entry and Hono, and names none of Node's globals:
 * the walk e3-core holds its own portable entry to. What the entry exports is
 * the root entry's own, but for the local server, its byte endpoints and auth.
 * And an app mounted from it alone, over e3-core's portable pieces and with an
 * access of its own, answers the dataset, page, dataflow and one-shot routes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { Hono } from 'hono';
import {
  ArrayType, DictType, East, IntegerType, NullType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For,
  encodeEastIR, equalFor, none, printFor, toEastTypeValue, variant, type ValueTypeOf,
} from '@elaraai/east';
import { MockTaskRunner } from '@elaraai/e3-core';
import {
  InMemoryStateStore, LocalOrchestrator, workspaceCreate, workspaceDeploy, type TransferBackend,
} from '@elaraai/e3-core/portable';
import { InMemoryStorage, PORTABLE_PACKAGES, encodeInSegmentsOf, portableWalker, storeSegmentsOf } from '@elaraai/e3-core/test';
import {
  BEAST2_CONTENT_TYPE, PackageObjectType, TASK_OBJECT_KIND, TaskObjectType, type RunnerValue, type Structure, type TreePath,
} from '@elaraai/e3-types';
import * as portable from './portable.js';
import * as root from './index.js';
import {
  DataflowExecutionStateType, DataflowRequestType, ExecuteResultType, OneShotRequestType, ResponseType, type DataflowExecutionState,
} from './types.js';

/** e3-api-server's sources: the spec runs from `dist/src`. */
const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** The packages a module of the entry may import: those a module of e3-core's
 *  portable entry may, that entry itself, and Hono, which needs no more than
 *  the web's own Request and Response. */
const PACKAGES: ReadonlySet<string> = new Set([...PORTABLE_PACKAGES, '@elaraai/e3-core/portable', 'hono']);

/** The walk the entry is held to: e3-core's, over these packages. */
const portableGraph = portableWalker(ts, PACKAGES);

/**
 * Reads a source module by its path under `src`, or gives `null` for none.
 *
 * @param planted - Rewrites a module's text, as a change to it would, by its
 *   path
 */
function sources(planted: Record<string, (text: string) => string> = {}): (file: string) => string | null {
  return (file) => {
    const path = join(SRC, file);
    if (!existsSync(path)) return null;
    const text = readFileSync(path, 'utf8');
    const plant = planted[file];
    return plant === undefined ? text : plant(text);
  };
}

/** The modules of a source directory, but its specs. */
function modulesOf(dir: string): string[] {
  return readdirSync(join(SRC, dir))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.d.ts'))
    .map((file) => `${dir}/${file}`);
}

/** The root entry's exports the portable entry leaves out, and why: each needs
 *  Node, or is auth. */
const ROOT_ONLY: Record<string, string> = {
  createServer: 'the local server: local storage, runner processes and an HTTP listener',
  resolveBudget: 'a budget of this machine\'s cores and memory',
  createDataEndpoints: 'the local server\'s byte endpoints, which stage uploads and downloads as files in the repository',
  createAuthMiddleware: 'auth: it verifies tokens with node:crypto',
  generateKeyPair: 'auth: the keys the built-in OIDC provider signs with',
  signJwt: 'auth: a token signed with node:crypto',
};

describe('the portable entry', () => {
  it('reaches nothing but its own modules, East, e3\'s types, e3-core\'s portable entry and Hono, and names none of Node\'s globals', () => {
    const { modules, faults } = portableGraph('portable.ts', sources());
    assert.deepEqual(faults, [], 'these reach beyond the portable modules: move what needs Node to a module of the root entry');

    const routes = modulesOf('routes').filter((file) => file !== 'routes/data.ts' && file !== 'routes/index.ts');
    for (const carried of [...routes, ...modulesOf('handlers'), 'middleware/repository.ts', 'identity.ts', 'errors.ts', 'beast2.ts', 'types.ts']) {
      assert.ok(modules.includes(carried), `the walk reached ${carried}`);
    }
    for (const left of ['routes/data.ts', 'middleware/auth.ts', 'auth/index.ts', 'auth/keys.ts', 'auth/device.ts', 'server.ts', 'local-dataflow.ts', 'index.ts']) {
      assert.ok(!modules.includes(left), `the walk left ${left} to the root entry`);
    }
  });

  it('fails a planted Node import however far from the entry, a use of Buffer, and e3-core\'s root entry, even for a type', () => {
    const cases: [what: string, planted: Record<string, (text: string) => string>, faults: string[]][] = [
      ['a Node builtin, in a handler', { 'handlers/datasets.ts': (text) => `import { randomUUID } from 'node:crypto';\n${text}` },
        ['handlers/datasets.ts:1 imports node:crypto']],
      ['Buffer, in a route', { 'routes/objects.ts': (text) => `export const planted = (text: string) => Buffer.from(text);\n${text}` },
        ['routes/objects.ts:1 uses Buffer']],
      ['e3-core\'s root entry, for a type', { 'routes/executions.ts': (text) => `import type { Budget } from '@elaraai/e3-core';\n${text}` },
        ['routes/executions.ts:1 imports @elaraai/e3-core']],
    ];
    for (const [what, planted, faults] of cases) {
      assert.deepEqual(portableGraph('portable.ts', sources(planted)).faults, faults, what);
    }

    // A route that names a type of the auth middleware reaches all of auth's
    // Node: why the identity a host's auth sets is declared apart from it.
    const auth = portableGraph('middleware/auth.ts', sources()).faults;
    assert.ok(auth.some((fault) => /^middleware\/auth\.ts:\d+ imports node:crypto$/.test(fault)), auth.join('\n'));
    assert.deepEqual(
      portableGraph('portable.ts', sources({ 'routes/records.ts': (text) => `import type { AuthConfig } from '../middleware/auth.js';\n${text}` })).faults,
      auth,
    );
  });

  it('exports the root entry\'s own functions and objects, but for the local server, its byte endpoints and auth', () => {
    const rooted = root as Record<string, unknown>;
    const portables = portable as Record<string, unknown>;
    for (const [name, value] of Object.entries(portables)) {
      assert.ok(name in rooted, `${name} is the root entry's too`);
      assert.equal(rooted[name], value, `${name} is the root entry's own`);
    }
    for (const name of Object.keys(rooted)) {
      assert.ok(name in portables || name in ROOT_ONLY,
        `${name} is the root entry's alone: export it from the portable entry, or say in ROOT_ONLY why it needs Node`);
    }
    for (const name of Object.keys(ROOT_ONLY)) {
      assert.ok(name in rooted && !(name in portables), `${name} is the root entry's alone`);
    }
  });

  it('is the package\'s `./portable` export', () => {
    assert.equal(import.meta.resolve('@elaraai/e3-api-server/portable'), new URL('./portable.js', import.meta.url).href);
  });
});

describe('an app mounted from the portable entry alone', () => {
  const REPO = 'shop';
  const WS = 'main';
  const RowsType = DictType(StringType, IntegerType);
  const rowsPath: TreePath = [variant('field', 'inputs'), variant('field', 'rows')];
  const countPath: TreePath = [variant('field', 'tasks'), variant('field', 'count'), variant('field', 'output')];
  const rows = new SortedMap(
    Array.from({ length: 1000 }, (_, i) => [`k${String(i).padStart(4, '0')}`, BigInt(i)] as [string, bigint]),
    compareFor(StringType),
  );
  const freeRunner: RunnerValue = variant('east_node', { platforms: [], decode: variant('lazy', null) });

  /** A deployed workspace: `.inputs.rows`, 1000 rows in segments of 100,
   *  `.inputs.limit`, and a task `count` over the rows. */
  async function deployed(storage: InMemoryStorage): Promise<{ rowsHash: string; countTask: string }> {
    await storage.repos.create(REPO);
    const rowsHash = await storeSegmentsOf(storage, REPO, encodeInSegmentsOf(RowsType, 100)(rows));
    const limitHash = await storage.objects.write(REPO, encodeBeast2For(IntegerType)(100n));
    // A stand-in program: the mock runner never reads it.
    const program = await storage.objects.write(REPO, new Uint8Array([0]));
    const countTask = await storage.objects.write(REPO, encodeBeast2For(TaskObjectType)({
      kind: TASK_OBJECT_KIND,
      body: variant('east', { program }),
      runner: freeRunner,
      inputs: [{ path: rowsPath, partition: none }],
      output: { path: countPath, kind: variant('value', null) },
      role: variant('data', null),
      environment: none,
    }));
    const structure: Structure = variant('struct', new Map<string, Structure>([
      ['inputs', variant('struct', new Map<string, Structure>([
        ['limit', variant('value', { type: toEastTypeValue(IntegerType), writable: true })],
        ['rows', variant('value', { type: toEastTypeValue(RowsType), writable: true })],
      ]))],
      ['tasks', variant('struct', new Map<string, Structure>([
        ['count', variant('struct', new Map<string, Structure>([
          ['output', variant('value', { type: toEastTypeValue(IntegerType), writable: false })],
        ]))],
      ]))],
    ]));
    const pkg = await storage.objects.write(REPO, encodeBeast2For(PackageObjectType)({
      tasks: new Map([['count', countTask]]),
      data: {
        structure,
        refs: new Map([
          ['inputs/limit', variant('value', { hash: limitHash, versions: new Map() })],
          ['inputs/rows', variant('value', { hash: rowsHash, versions: new Map() })],
        ]),
      },
      functions: new Map(),
      records: new Map(),
      sources: new Map(),
    }));
    await storage.refs.packageWrite(REPO, 'shop', '1.0.0', pkg);
    await workspaceCreate(storage, REPO, WS);
    await workspaceDeploy(storage, REPO, WS, 'shop', '1.0.0');
    return { rowsHash, countTask };
  }

  /** A host's transfer backend that none of these requests reaches: reaching
   *  any of its stores fails the request. */
  const unreached = new Proxy({} as TransferBackend, {
    get: (_backend, store) => {
      throw new Error(`the request reached the transfer backend's ${String(store)}`);
    },
  });

  /**
   * The host: the repositories and their gate, datasets, the dataflow and
   * one-shot, every factory from the portable entry, over an in-memory store,
   * a mock runner, and e3-core's portable orchestrator and state store. Its
   * access is its own: an `X-Caller` of `operator` runs any one-shot, a
   * `reader` a platform-free one, and anyone else none.
   */
  async function host(): Promise<{ app: Hono; storage: InMemoryStorage; runner: MockTaskRunner; rowsHash: string; countTask: string }> {
    const storage = new InMemoryStorage();
    const { rowsHash, countTask } = await deployed(storage);
    const runner = new MockTaskRunner();
    const stateStore = new InMemoryStateStore();
    const orchestrator = new LocalOrchestrator(stateStore);
    const getRepoPath = (repo: string): string => repo;
    const access: portable.OneShotAccess = (c) => {
      const caller = c.req.header('X-Caller');
      return caller === 'operator' ? 'any' : caller === 'reader' ? 'platform_free' : 'none';
    };

    const app = new Hono();
    app.use('/api/repos/:repo/*', portable.createRepositoryGate(storage, getRepoPath));
    app.route('/api/repos', portable.createRepositoriesRoutes(storage));
    app.route('/api/repos/:repo/workspaces/:ws/datasets', portable.createDatasetRoutes(storage, getRepoPath));
    app.route('/api/repos/:repo/workspaces/:ws/dataflow', portable.createExecutionRoutes(storage, getRepoPath, {
      getRunner: () => runner,
      getOrchestrator: () => orchestrator,
      getStateStore: () => stateStore,
    }));
    app.route('/api/repos/:repo/workspaces/:ws/one-shot', portable.createOneShotRoutes(storage, getRepoPath, unreached, () => runner, { access }));
    return { app, storage, runner, rowsHash, countTask };
  }

  const bytes = async (response: Response): Promise<Uint8Array> => new Uint8Array(await response.arrayBuffer());
  const datasets = `/api/repos/${REPO}/workspaces/${WS}/datasets`;

  it('lists the repositories its store keeps, and its gate refuses one it does not', async () => {
    const { app } = await host();
    const listed = decodeBeast2For(ResponseType(ArrayType(StringType)))(await bytes(await app.request('/api/repos')));
    assert.deepEqual(listed, variant('success', [REPO]));

    const elsewhere = await app.request(`/api/repos/elsewhere/workspaces/${WS}/datasets/inputs/rows`);
    assert.equal(elsewhere.status, 404);
    assert.deepEqual(await elsewhere.json(), { error: 'not_found', message: 'Repository \'elsewhere\' not found' });
  });

  it('reads a dataset whole, a page of it and a key in it, and writes one', async () => {
    const { app, rowsHash } = await host();

    const whole = await app.request(`${datasets}/inputs/rows`);
    assert.equal(whole.status, 200);
    assert.ok(equalFor(RowsType)(decodeBeast2For(RowsType)(await bytes(whole)), rows), 'the rows, whole');

    const page = await app.request(`${datasets}/inputs/rows?page=true&offset=150&limit=100`);
    assert.equal(page.status, 200);
    assert.deepEqual(
      ['X-Content-SHA256', 'X-Total-Elements', 'X-Segment-Count', 'X-Page-Offset', 'X-Page-Count'].map((header) => page.headers.get(header)),
      [rowsHash, '1000', '10', '150', '100'],
    );
    const expected = new SortedMap([...rows].slice(150, 250), compareFor(StringType));
    assert.ok(equalFor(RowsType)(decodeBeast2For(RowsType)(await bytes(page)), expected), 'rows 150 to 249');

    const found = await app.request(`${datasets}/inputs/rows?find=true&key=${encodeURIComponent('"k0420"')}`);
    assert.equal(found.status, 200);
    assert.deepEqual(await found.json(), { found: true, row: 420, count: 1 });

    const written = await app.request(`${datasets}/inputs/limit`, { method: 'PUT', body: encodeBeast2For(IntegerType)(500n) });
    assert.deepEqual(decodeBeast2For(ResponseType(NullType))(await bytes(written)), variant('success', null));
    assert.equal(decodeBeast2For(IntegerType)(await bytes(await app.request(`${datasets}/inputs/limit`))), 500n);
  });

  it('runs the dataflow through the orchestrator and state store the host gives, and serves what the run wrote', async () => {
    const { app, storage, runner, rowsHash, countTask } = await host();
    const read: string[][] = [];
    runner.setResult(countTask, async (inputs) => {
      read.push(inputs);
      return { state: 'success', cached: false, outputHash: await storage.objects.write(REPO, encodeBeast2For(IntegerType)(1000n)) };
    });

    const started = await app.request(`/api/repos/${REPO}/workspaces/${WS}/dataflow`, {
      method: 'POST',
      headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
      body: encodeBeast2For(DataflowRequestType)({ force: false, filter: none }),
    });
    assert.equal(started.status, 202);
    assert.deepEqual(decodeBeast2For(ResponseType(NullType))(await bytes(started)), variant('success', null));

    // A client polls the run's state, as the state store keeps it, until the
    // run has ended.
    const decodeState = decodeBeast2For(ResponseType(DataflowExecutionStateType));
    let state: DataflowExecutionState;
    for (;;) {
      const answer = decodeState(await bytes(await app.request(`/api/repos/${REPO}/workspaces/${WS}/dataflow/execution`)));
      if (answer.type !== 'success') assert.fail(`the poll was refused: ${answer.value.type}`);
      state = answer.value;
      if (state.status.type !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(state.status.type, 'completed');
    if (state.summary.type !== 'some') assert.fail('a run that has ended has a summary');
    assert.deepEqual([state.summary.value.executed, state.summary.value.failed], [1n, 0n]);

    assert.deepEqual(read, [[rowsHash]], 'the task read the workspace\'s rows');
    assert.equal(decodeBeast2For(IntegerType)(await bytes(await app.request(`${datasets}/tasks/count/output`))), 1000n);
  });

  it('runs a one-shot over the workspace\'s datasets under the grant the host\'s own access gives each caller', async () => {
    const { app, runner, rowsHash } = await host();
    const counted = encodeBeast2For(IntegerType)(1000n);
    runner.setDetachedResult({ kind: 'success', value: counted, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false });

    const count = East.function([RowsType], IntegerType, ($, given) => given.size());
    const log = East.platform('e3_test_log', [StringType], NullType);
    const logged = East.function([RowsType], IntegerType, ($, given) => {
      $(log('counted'));
      return given.size();
    });
    const ResultType = ResponseType(ExecuteResultType);
    const decodeResult = decodeBeast2For(ResultType);
    const oneShot = async (caller: string | null, body: typeof count) =>
      decodeResult(await bytes(await app.request(`/api/repos/${REPO}/workspaces/${WS}/one-shot`, {
        method: 'POST',
        headers: { 'Content-Type': BEAST2_CONTENT_TYPE, ...(caller !== null && { 'X-Caller': caller }) },
        body: encodeBeast2For(OneShotRequestType)({
          bodyIr: encodeEastIR(body.toIR()),
          args: [variant('dataset', rowsPath)],
          runner: freeRunner,
          limits: none,
        }),
      })));
    const ran = variant('success', {
      outcome: variant('success', { value: counted }),
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      inputs: [{ path: rowsPath, hash: rowsHash }],
    });
    const refused = variant('error', variant('permission_denied', { path: 'one-shot' }));
    const answers = (answer: ValueTypeOf<typeof ResultType>, expected: ValueTypeOf<typeof ResultType>, what: string): void =>
      assert.ok(equalFor(ResultType)(answer, expected), `${what}, and the answer is ${printFor(ResultType)(answer)}`);

    answers(await oneShot('operator', logged), ran, 'an operator runs a body that calls a platform function');
    answers(await oneShot('reader', count), ran, 'a reader runs a platform-free body');
    answers(await oneShot('reader', logged), refused, 'a reader runs no body that calls a platform function');
    answers(await oneShot(null, count), refused, 'a caller the host does not know runs nothing');
    assert.deepEqual(runner.getDetachedCalls().map((call) => call.args), [[{ dataset: rowsHash }], [{ dataset: rowsHash }]],
      'the two calls that ran read the rows the workspace holds');
  });
});
