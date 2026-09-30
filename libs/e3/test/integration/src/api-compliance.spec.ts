/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * API Compliance Tests
 *
 * Runs the shared e3-api-tests suites against the local server.
 * One shared server, per-test context for full isolation and concurrency.
 * The server checks every request's token, as a deployed server does: the
 * suites run as an `admin`, and their reader cases as a caller with no role.
 */

import { describe, before, after } from 'node:test';

import {
  createTestContext,
  allApiTests,
  cliTests,
  transferTests,
  type TestSetup,
  type TestContext,
} from '@elaraai/e3-api-tests';

import { startComplianceServer, type ComplianceServer } from './compliance-server.js';

// Shared server, one per test run: started by the suite's `before` hook, and
// awaited by every test's setup
let server: ComplianceServer | undefined;
let started: Promise<ComplianceServer> | null = null;
const getServer = (): Promise<ComplianceServer> => (started ??= startComplianceServer().then((running) => (server = running)));

// Per-test setup: creates a fresh repo + context
const setup: TestSetup<TestContext> = async (t) => {
  const { baseUrl, adminToken, readerToken } = await getServer();
  const ctx = await createTestContext({
    baseUrl,
    getToken: async () => adminToken,
    // Any caller the server's key signed for may read any repository here, so
    // a reader needs no grant
    getReaderToken: async () => readerToken,
    cleanup: true,
  });
  t.after(() => ctx.cleanup());
  return ctx;
};

/** The CLI suites' environment: the admin's credentials, approved as given. */
const credentialsEnv = (): Record<string, string> => ({
  E3_CREDENTIALS_PATH: server!.credentialsPath,
  E3_AUTH_AUTO_APPROVE: 'true',
});

describe('API compliance', { timeout: 600_000, concurrency: false }, () => {
  // node:test charges asynchronous activity to the test or hook whose async
  // context created it, and everything the server does descends from its
  // start: started here, what a request leaves running is reported against
  // this hook rather than against whichever test happened to run first.
  before(() => getServer());

  after(async () => {
    await server?.stop();
  });

  // Run all API test suites
  allApiTests(setup);

  // Run CLI test suite with credentials env
  cliTests(setup, credentialsEnv);

  // Run cross-repository transfer tests
  transferTests(setup, credentialsEnv);
});
