/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `serveE3` in Node: the e3 worker's side at one end of a `MessageChannel`,
 * and the page's `createWebE3` at the other, over in-memory repositories and
 * units in this thread — how it boots, refuses to, closes with its page,
 * answers a caller it does not know with what a server's auth answers, and
 * serves e3's own platform functions to a unit, bound to itself. The shared
 * API suites run against it in `libs/e3/test/integration`'s
 * `web-compliance.spec.ts`, and in Chromium in `browser/e3-api.ts`'s parts.
 */

import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, East, IntegerType, StringType, decodeBeast2For, encodeBeast2For, encodeEastIR, none, variant } from '@elaraai/east';
import {
  ApiError,
  dataflowExecute,
  datasetGet,
  datasetSet,
  oneShotExecute,
  packageImport,
  repoCreate,
  repoList,
  workspaceCreate,
  workspaceDeploy,
  workspaceList,
  type RequestOptions,
} from '@elaraai/e3-api-client';
import type { OneShotRequest } from '@elaraai/e3-types';
import { assertDataflowSucceeded } from '@elaraai/e3-api-tests';
import { createWebE3, inProcessUnits, type UnitWorker, type WebE3 } from './index.js';
import { serveE3, type ServeE3Options } from './worker.js';
import { ADMIN_TOKEN, READER_TOKEN, identifyCaller } from './testing/callers.js';
import { FIXTURE_VERSION, PLATFORM_PACKAGE, buildE3Fixtures } from './testing/e3-fixtures.js';

/** The e3s a test started, closed once it has run. */
const started: WebE3[] = [];

/**
 * Serves e3 over a `MessageChannel`, and connects to it.
 *
 * @param options - How the e3 is served: its repositories in memory unless
 *   the test says
 * @returns The page's e3
 */
async function connect(options: Partial<ServeE3Options> = {}): Promise<WebE3> {
  const { port1, port2 } = new MessageChannel();
  serveE3({ units: inProcessUnits(), persist: false, ...options }, port1);
  const e3 = await createWebE3(port2);
  started.push(e3);
  return e3;
}

/** Unit workers in this thread, each counted as it starts and as it ends. */
function countedUnits(): { readonly units: () => UnitWorker; readonly live: () => number; readonly startedCount: () => number } {
  const inProcess = inProcessUnits();
  let live = 0;
  let count = 0;
  return {
    units: () => {
      const worker = inProcess();
      const terminate = worker.terminate.bind(worker);
      live++;
      count++;
      let ended = false;
      worker.terminate = () => {
        if (!ended) {
          ended = true;
          live--;
        }
        terminate();
      };
      return worker;
    },
    live: () => live,
    startedCount: () => count,
  };
}

/** Waits for a condition, failing with what it waits for after five seconds. */
async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`waited five seconds for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('serveE3, over a MessageChannel', () => {
  afterEach(() => {
    for (const e3 of started.splice(0)) e3.close();
  });

  it('serves e3\'s API to the page, at the URL only e3.fetch answers, keeping nothing past the page', async () => {
    const e3 = await connect();
    assert.equal(e3.apiUrl, 'https://e3-web.invalid');
    assert.equal(e3.persisted, false, 'repositories in memory are not kept past the page');
    const opts: RequestOptions = { token: null, fetch: e3.fetch };
    assert.deepEqual(await repoList(e3.apiUrl, opts), []);
    await repoCreate(e3.apiUrl, 'default', opts);
    assert.deepEqual(await repoList(e3.apiUrl, opts), ['default']);
  });

  it('refuses to boot, naming the API, where the page cannot keep repositories, and createWebE3 rejects with it', async () => {
    const { port1, port2 } = new MessageChannel();
    serveE3({ units: inProcessUnits() }, port1);
    await assert.rejects(createWebE3(port2), (err: Error) => {
      assert.match(err.message, /^createWebE3: the e3 worker did not start: e3-web cannot keep repositories in this page: it has no IndexedDB/);
      assert.match(err.message, /persist: false/, 'naming the way to keep them in memory');
      return true;
    });
  });

  it('refuses to boot with a whole-intake limit that is not a whole number of bytes, naming it, and createWebE3 rejects with it', async () => {
    for (const wholeIntakeLimit of [-1, 1.5]) {
      const { port1, port2 } = new MessageChannel();
      serveE3({ units: inProcessUnits(), persist: false, wholeIntakeLimit }, port1);
      await assert.rejects(createWebE3(port2), {
        message: new RegExp(`^createWebE3: the e3 worker did not start: RangeError: a runner's whole-intake limit is a whole number of bytes, zero or more, not ${wholeIntakeLimit}$`),
      }, `a limit of ${wholeIntakeLimit}`);
    }
  });

  it('closes with its page: its unit workers end with the port', async () => {
    const counted = countedUnits();
    const e3 = await connect({ units: counted.units });
    const opts: RequestOptions = { token: null, fetch: e3.fetch };
    const zip = (await buildE3Fixtures()).platform;
    await repoCreate(e3.apiUrl, 'default', opts);
    await packageImport(e3.apiUrl, 'default', zip, opts);
    await workspaceCreate(e3.apiUrl, 'default', 'main', opts);
    await workspaceDeploy(e3.apiUrl, 'default', 'main', `${PLATFORM_PACKAGE}@${FIXTURE_VERSION}`, opts);
    await datasetSet(e3.apiUrl, 'default', 'main', [variant('field', 'inputs'), variant('field', 'repo')], encodeBeast2For(StringType)('default'), opts);
    assertDataflowSucceeded(await dataflowExecute(e3.apiUrl, 'default', 'main', {}, opts));
    assert.ok(counted.startedCount() > 0, 'units ran on workers of the pool');
    assert.ok(counted.live() > 0, 'the pool keeps its idle workers');

    e3.close();
    await until(() => counted.live() === 0, 'every unit worker to end once the page\'s port closed');
    await assert.rejects(repoList(e3.apiUrl, opts), /e3\.close\(\) has closed the e3 worker/);
  });

  describe('who calls, when the host says', () => {
    /** Who calls, by the specs' tokens; a verifier that throws for one. */
    const identify: ServeE3Options['identify'] = (request) => {
      if (request.headers.get('authorization') === 'Bearer breaks-the-verifier') throw new Error('the verifier broke');
      return identifyCaller(request);
    };

    it('answers a request to a repository from a caller it does not know 401, as a server\'s auth does, and a reader as one it knows', async () => {
      const e3 = await connect({ identify });
      await repoCreate(e3.apiUrl, 'default', { token: ADMIN_TOKEN, fetch: e3.fetch });
      const url = `${e3.apiUrl}/api/repos/default/workspaces`;
      const anonymous = await e3.fetch(url);
      assert.equal(anonymous.status, 401, 'a request with no token');
      assert.equal(await anonymous.text(), 'Unauthorized: Missing Bearer token');
      const stranger = await e3.fetch(url, { headers: { authorization: 'Bearer a-token-no-one-has' } });
      assert.equal(stranger.status, 401, 'a token it does not know');
      assert.equal(await stranger.text(), 'Unauthorized: Invalid token');
      const broken = await e3.fetch(url, { headers: { authorization: 'Bearer breaks-the-verifier' } });
      assert.equal(broken.status, 401, 'a verifier that throws');
      assert.equal(await broken.text(), 'Unauthorized: the verifier broke');
      assert.deepEqual(await workspaceList(e3.apiUrl, 'default', { token: READER_TOKEN, fetch: e3.fetch }), [], 'a reader is answered');
    });

    it('grants by the caller\'s roles unless given access: an admin\'s one-shot with a platform runs, and a reader\'s is refused', async () => {
      const e3 = await connect({ identify });
      const admin: RequestOptions = { token: ADMIN_TOKEN, fetch: e3.fetch };
      await repoCreate(e3.apiUrl, 'default', admin);
      await packageImport(e3.apiUrl, 'default', (await buildE3Fixtures()).platform, admin);
      await workspaceCreate(e3.apiUrl, 'default', 'main', admin);
      await workspaceDeploy(e3.apiUrl, 'default', 'main', `${PLATFORM_PACKAGE}@${FIXTURE_VERSION}`, admin);
      const request: OneShotRequest = {
        bodyIr: encodeEastIR(East.function([], IntegerType, () => 42n).toIR()),
        args: [],
        runner: variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }),
        limits: none,
      };
      const ran = await oneShotExecute(e3.apiUrl, 'default', 'main', request, admin);
      assert.equal(ran.outcome.type, 'success', 'the admin\'s runs');
      await assert.rejects(oneShotExecute(e3.apiUrl, 'default', 'main', request, { token: READER_TOKEN, fetch: e3.fetch }),
        (err: unknown) => err instanceof ApiError && err.code === 'permission_denied', 'the reader\'s is refused');
    });
  });

  describe('e3\'s own platform functions, in a unit', () => {
    /** The global fetch, put back once the cases have run. */
    const networkFetch = globalThis.fetch;
    /** The requests that reached the global fetch. */
    const escaped: string[] = [];
    let zip: Uint8Array;

    before(async () => {
      zip = (await buildE3Fixtures()).platform;
      globalThis.fetch = ((input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);
        escaped.push(url);
        return Promise.reject(new TypeError(`a request went to the global fetch rather than e3.fetch: ${url}`));
      }) as typeof globalThis.fetch;
    });

    after(() => {
      globalThis.fetch = networkFetch;
    });

    it('lists this e3\'s workspaces: Platform.workspaceList, called from a unit, is answered by the e3 that started its worker', async () => {
      const e3 = await connect();
      const opts: RequestOptions = { token: ADMIN_TOKEN, fetch: e3.fetch };
      await repoCreate(e3.apiUrl, 'default', opts);
      await packageImport(e3.apiUrl, 'default', zip, opts);
      for (const name of ['main', 'other']) await workspaceCreate(e3.apiUrl, 'default', name, opts);
      await workspaceDeploy(e3.apiUrl, 'default', 'main', `${PLATFORM_PACKAGE}@${FIXTURE_VERSION}`, opts);
      await datasetSet(e3.apiUrl, 'default', 'main', [variant('field', 'inputs'), variant('field', 'repo')], encodeBeast2For(StringType)('default'), opts);

      assertDataflowSucceeded(await dataflowExecute(e3.apiUrl, 'default', 'main', {}, opts));
      const { data } = await datasetGet(e3.apiUrl, 'default', 'main', [variant('field', 'tasks'), variant('field', 'workspaces'), variant('field', 'output')], opts);
      assert.deepEqual(decodeBeast2For(ArrayType(StringType))(data), ['main', 'other'], 'the workspaces of the e3 the unit runs in');
      assert.deepEqual(escaped, [], 'no request reached the network');
    });
  });
});
