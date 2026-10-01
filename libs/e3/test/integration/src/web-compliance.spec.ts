/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * API Compliance Tests, against e3 in a page
 *
 * Runs the shared e3-api-tests API suites against e3-web, in this process: the
 * e3 worker's side (`serveE3`) at one end of a `MessageChannel`, and the
 * page's (`createWebE3`) at the other, whose `fetch` the suites are given. Its
 * repositories are in memory (`persist: false`), and its units run in this
 * thread (`inProcessUnits()`). The suites run as an admin, and their reader
 * cases as a reader: the e3 knows each by its token, and grants the admin's
 * one-shots `any` and the reader's `platform_free`. It runs no commands, as a
 * browser runs none.
 *
 * The global `fetch` refuses every request for the run, so a request of the
 * client, of a suite or of a platform function that does not go through
 * `e3.fetch` fails, and is named when the run ends even if what made it
 * swallowed the refusal. e3-web's own specs run the same suites in Chromium.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  createTestContext,
  allApiTests,
  type TestSetup,
  type TestContext,
} from '@elaraai/e3-api-tests';
import { createWebE3, inProcessUnits, type WebE3 } from '@elaraai/e3-web';
import { serveE3, oneShotAccessByRoles, type Identity } from '@elaraai/e3-web/worker';

/** The admin's token, whose one-shots run with any platform. */
const ADMIN_TOKEN = 'e3-web-compliance-admin';
/** A reader's token, with no role: its one-shots are platform-free. */
const READER_TOKEN = 'e3-web-compliance-reader';

/** Whom each token's bearer is, as the e3 knows them. */
const callers = new Map<string, Identity>([
  [`Bearer ${ADMIN_TOKEN}`, { sub: 'admin', roles: ['admin'] }],
  [`Bearer ${READER_TOKEN}`, { sub: 'reader', roles: [] }],
]);

/** The global `fetch`, put back once the run ends. */
const networkFetch = globalThis.fetch;

/** The requests that reached the global `fetch`. */
const escaped: string[] = [];

/**
 * The e3 the suites run against, and how many requests went through its
 * fetch: started by the suite's `before` hook, and awaited by every test's
 * setup.
 */
let e3: WebE3 | undefined;
let answered = 0;
let started: Promise<WebE3> | null = null;
const getE3 = (): Promise<WebE3> => (started ??= (async () => {
  const { port1, port2 } = new MessageChannel();
  serveE3({
    units: inProcessUnits(),
    persist: false,
    identify: (request) => callers.get(request.headers.get('authorization') ?? ''),
    access: oneShotAccessByRoles(),
    // Small parts and no commit wait, as the local server's compliance run
    // has, so the suites' megabyte-sized uploads go through the protocol's
    // multi-part path and a polled commit; and small export rounds, so a
    // package's export resumes from its checkpoint round after round.
    transferPartBytes: 256 * 1024,
    transferCommitWaitMs: 0,
    transferExportRoundBytes: 64 * 1024,
  }, port1);
  return (e3 = await createWebE3(port2));
})());

// Per-test setup: creates a fresh repo + context, whose requests go through
// e3.fetch
const setup: TestSetup<TestContext> = async (t) => {
  const { apiUrl, fetch } = await getE3();
  const ctx = await createTestContext({
    baseUrl: apiUrl,
    getToken: async () => ADMIN_TOKEN,
    // The reader may read every repository of this e3, so needs no grant
    getReaderToken: async () => READER_TOKEN,
    cleanup: true,
    fetch: (input, init) => {
      answered++;
      return fetch(input, init);
    },
    commands: false,
  });
  t.after(() => ctx.cleanup());
  return ctx;
};

describe('API compliance against e3 in a page', { timeout: 900_000, concurrency: false }, () => {
  // Started here: what a request leaves running is reported against this hook,
  // as `api-compliance.spec.ts` starts its server.
  before(async () => {
    await getE3();
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      escaped.push(url);
      throw new Error(`a request went to the global fetch rather than e3.fetch: ${url}`);
    }) as typeof globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = networkFetch;
    e3?.close();
  });

  allApiTests(setup);

  // Last, once every test before it has cleaned up: a request whose refusal
  // what made it swallowed — a cleanup's — is named here.
  it('sent every request through e3.fetch', () => {
    assert.deepEqual(escaped, [], 'every request goes through e3.fetch');
    assert.ok(answered > 0, 'the suites\' requests went through e3.fetch');
  });
});
