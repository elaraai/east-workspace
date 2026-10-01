/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * API Compliance Tests, through a given fetch
 *
 * Runs the shared e3-api-tests API suites against the local server with
 * `TestConfig.fetch` set, as a host that answers e3's API itself sets it: e3
 * running in a page, whose requests a function answers rather than the
 * network. The given fetch forwards each request to the server. The global
 * `fetch` refuses every request for the run, so a request of the client, of a
 * suite or of a platform function that does not go through the given one
 * fails, and is named when the run ends even if what made it swallowed the
 * refusal.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  createTestContext,
  allApiTests,
  type TestSetup,
  type TestContext,
} from '@elaraai/e3-api-tests';

import { startComplianceServer, type ComplianceServer } from './compliance-server.js';

/** The global `fetch`, which the given one forwards to. */
const networkFetch = globalThis.fetch;

/** How many requests went through the given fetch. */
let forwarded = 0;

/** The requests that reached the global `fetch` instead. */
const escaped: string[] = [];

/** The `fetch` the harness gives: each request, forwarded to the server. */
const forwarding: typeof globalThis.fetch = (input, init) => {
  forwarded++;
  return networkFetch(input, init);
};

// Shared server, one per test run: started by the suite's `before` hook, and
// awaited by every test's setup
let server: ComplianceServer | undefined;
let started: Promise<ComplianceServer> | null = null;
const getServer = (): Promise<ComplianceServer> => (started ??= startComplianceServer().then((running) => (server = running)));

// Per-test setup: creates a fresh repo + context, whose requests go through
// the given fetch
const setup: TestSetup<TestContext> = async (t) => {
  const { baseUrl, adminToken, readerToken } = await getServer();
  const ctx = await createTestContext({
    baseUrl,
    getToken: async () => adminToken,
    // Any caller the server's key signed for may read any repository here, so
    // a reader needs no grant
    getReaderToken: async () => readerToken,
    cleanup: true,
    fetch: forwarding,
  });
  t.after(() => ctx.cleanup());
  return ctx;
};

describe('API compliance through a given fetch', { timeout: 600_000, concurrency: false }, () => {
  // Started here, as `api-compliance.spec.ts` starts it: what a request leaves
  // running is reported against this hook.
  before(async () => {
    await getServer();
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      escaped.push(url);
      throw new Error(`a request went to the global fetch rather than the one the harness gives: ${url}`);
    }) as typeof globalThis.fetch;
  });

  after(async () => {
    globalThis.fetch = networkFetch;
    await server?.stop();
  });

  allApiTests(setup);

  // Last, once every test before it has cleaned up: a request whose refusal
  // what made it swallowed — a cleanup's — is named here. A failing `after`
  // hook would say so and leave the run passing.
  it('sent every request through the given fetch', () => {
    assert.deepEqual(escaped, [], 'every request goes through the given fetch');
    assert.ok(forwarded > 0, 'the suites\' requests went through the given fetch');
  });
});
