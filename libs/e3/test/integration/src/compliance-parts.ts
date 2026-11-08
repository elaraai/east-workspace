/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The shared e3-api-tests suites against the local server, in parts: a test
 * file each (#1466). As one file they took ten minutes on a slow Windows
 * runner, more than an integration shard's share, and no split of the specs
 * by time could level the shards around it. Each part starts its own server
 * and runs its suites one at a time, each test in a fresh repository and
 * context; `api-compliance.spec` holds the parts to running every suite of
 * `apiTestSuites` once.
 *
 * The server checks every request's token, as a deployed server does: the
 * suites run as an `admin`, and their reader cases as a caller with no role.
 *
 * The parts of `apiTestSuites` run through a given fetch, as a host that
 * answers e3's API itself gives one — e3 running in a page, whose requests a
 * function answers rather than the network: it forwards each request to the
 * server, and the global `fetch` refuses every request for the part, so a
 * request of the client, of a suite or of a platform function that does not
 * go through the given one fails, and is named when the part ends even if
 * what made it swallowed the refusal. The CLI part runs through the global
 * `fetch`, as its child processes must.
 *
 * A spec file declares its part's `describe` itself, with {@link COMPLIANCE_PART}'s
 * options, and calls {@link compliancePart} in it: the test runner names a test
 * by the file that declared it, and CI splits the integration specs by the times
 * their files took (#1466).
 */

import { it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { apiTestSuites, createTestContext, type TestSetup, type TestContext } from '@elaraai/e3-api-tests';

import { startComplianceServer, type ComplianceServer } from './compliance-server.js';

/**
 * The suites of `apiTestSuites` each part runs, by name, every suite in one
 * part: parts of about equal time on the slowest runner (run 41294732185's
 * Windows times). The CLI part, `api-compliance-cli.spec`, runs the suites
 * that are not `apiTestSuites`.
 */
export const COMPLIANCE_PARTS = {
  rest: [
    'repository', 'packages', 'workspaces', 'datasets', 'datasetPages', 'datasetBatches', 'datasetTransfer',
    'functions', 'areaRecords', 'inputDeploy', 'packageTransfer', 'platform',
  ],
  dataflow: ['dataflow', 'calls', 'records', 'keyedRecords', 'recordDeploy'],
  series: ['seriesRecords', 'placeRecords'],
} as const satisfies Record<string, readonly string[]>;

/** How a part's requests reach the server. */
export interface CompliancePartOptions {
  /** Through a given fetch, the global `fetch` refusing every request (the parts of `apiTestSuites`); else through the global `fetch`. */
  readonly givenFetch: boolean;
}

/** What a part registers its suites with. */
export interface ComplianceHarness {
  /** A fresh repository and context for each test. */
  readonly setup: TestSetup<TestContext>;
  /** The CLI suites' environment: the admin's credentials, approved as given. */
  readonly credentialsEnv: () => Record<string, string>;
}

/**
 * A part's `describe` options. A part takes under three minutes on a slow
 * Windows runner: the limit leaves a runner twice as slow again more than room.
 * Its suites run one at a time.
 */
export const COMPLIANCE_PART = { timeout: 600_000, concurrency: false } as const;

/**
 * Runs one part of the API compliance suites against a server of its own:
 * called in the part's `describe`, which its spec file declares with
 * {@link COMPLIANCE_PART}'s options.
 *
 * @param options - How the part's requests reach the server
 * @param register - Registers the part's suites
 */
export function compliancePart(options: CompliancePartOptions, register: (harness: ComplianceHarness) => void): void {
  // One server for the part: started by the part's `before` hook, and awaited
  // by every test's setup
  let server: ComplianceServer | undefined;
  let started: Promise<ComplianceServer> | null = null;
  const getServer = (): Promise<ComplianceServer> => (started ??= startComplianceServer().then((running) => (server = running)));

  // The global `fetch`, which the given one forwards to; how many requests
  // went through the given one; and those that reached the global one instead
  const networkFetch = globalThis.fetch;
  let forwarded = 0;
  const escaped: string[] = [];
  const forwarding: typeof globalThis.fetch = (input, init) => {
    forwarded++;
    return networkFetch(input, init);
  };

  const setup: TestSetup<TestContext> = async (t) => {
    const { baseUrl, adminToken, readerToken } = await getServer();
    const ctx = await createTestContext({
      baseUrl,
      getToken: () => Promise.resolve(adminToken),
      // Any caller the server's key signed for may read any repository here, so
      // a reader needs no grant
      getReaderToken: () => Promise.resolve(readerToken),
      cleanup: true,
      ...(options.givenFetch ? { fetch: forwarding } : {}),
    });
    t.after(() => ctx.cleanup());
    return ctx;
  };

  const credentialsEnv = (): Record<string, string> => ({
    E3_CREDENTIALS_PATH: server!.credentialsPath,
    E3_AUTH_AUTO_APPROVE: 'true',
  });

  // node:test charges asynchronous activity to the test or hook whose async
  // context created it, and everything the server does descends from its
  // start: started here, what a request leaves running is reported against
  // this hook rather than against whichever test happened to run first.
  before(async () => {
    await getServer();
    if (!options.givenFetch) return;
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      escaped.push(url);
      return Promise.reject(new Error(`a request went to the global fetch rather than the one the harness gives: ${url}`));
    }) as typeof globalThis.fetch;
  });

  after(async () => {
    globalThis.fetch = networkFetch;
    await server?.stop();
  });

  register({ setup, credentialsEnv });

  // Last, once every test before it has cleaned up: a request whose refusal
  // what made it swallowed — a cleanup's — is named here. A failing `after`
  // hook would say so and leave the run passing.
  if (options.givenFetch) {
    void it('sent every request through the given fetch', () => {
      assert.deepEqual(escaped, [], 'every request goes through the given fetch');
      assert.ok(forwarded > 0, 'the suites\' requests went through the given fetch');
    });
  }
}

/**
 * Registers the named suites of `apiTestSuites`, in the order given.
 *
 * @param names - The suites' names
 * @param setup - A fresh repository and context for each test
 * @throws {Error} Naming a suite `apiTestSuites` does not hold
 */
export function registerSuites(names: readonly string[], setup: TestSetup<TestContext>): void {
  for (const name of names) {
    const register = apiTestSuites[name];
    if (register === undefined) throw new Error(`apiTestSuites holds no suite '${name}'`);
    register(setup);
  }
}
