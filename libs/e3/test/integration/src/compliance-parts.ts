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
 */

import { describe, before, after } from 'node:test';

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
  dataflow: ['dataflow', 'records', 'keyedRecords', 'recordDeploy'],
  series: ['seriesRecords', 'placeRecords'],
} as const satisfies Record<string, readonly string[]>;

/** What a part registers its suites with. */
export interface ComplianceHarness {
  /** A fresh repository and context for each test. */
  readonly setup: TestSetup<TestContext>;
  /** The CLI suites' environment: the admin's credentials, approved as given. */
  readonly credentialsEnv: () => Record<string, string>;
}

/**
 * Runs one part of the API compliance suites against a server of its own.
 *
 * @param title - The part's title
 * @param register - Registers the part's suites
 */
export function compliancePart(title: string, register: (harness: ComplianceHarness) => void): void {
  // One server for the part: started by the part's `before` hook, and awaited
  // by every test's setup
  let server: ComplianceServer | undefined;
  let started: Promise<ComplianceServer> | null = null;
  const getServer = (): Promise<ComplianceServer> => (started ??= startComplianceServer().then((running) => (server = running)));

  const setup: TestSetup<TestContext> = async (t) => {
    const { baseUrl, adminToken, readerToken } = await getServer();
    const ctx = await createTestContext({
      baseUrl,
      getToken: () => Promise.resolve(adminToken),
      // Any caller the server's key signed for may read any repository here, so
      // a reader needs no grant
      getReaderToken: () => Promise.resolve(readerToken),
      cleanup: true,
    });
    t.after(() => ctx.cleanup());
    return ctx;
  };

  const credentialsEnv = (): Record<string, string> => ({
    E3_CREDENTIALS_PATH: server!.credentialsPath,
    E3_AUTH_AUTO_APPROVE: 'true',
  });

  // A part takes under three minutes on a slow Windows runner: the limit
  // leaves a runner twice as slow again more than room.
  void describe(title, { timeout: 600_000, concurrency: false }, () => {
    // node:test charges asynchronous activity to the test or hook whose async
    // context created it, and everything the server does descends from its
    // start: started here, what a request leaves running is reported against
    // this hook rather than against whichever test happened to run first.
    before(() => getServer());

    after(async () => {
      await server?.stop();
    });

    register({ setup, credentialsEnv });
  });
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
