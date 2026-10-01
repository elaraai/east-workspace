/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The shared API suites against e3 in Chromium, run in parts: each part a
 * spec file of its own (`e3-api-<n>.spec.ts`), with its own browser and page,
 * so each file's time stays well inside the time a test file is given, and
 * the parts run side by side.
 *
 * The suites run in Node, and each request they make is forwarded into a page
 * running e3 — its e3 worker over IndexedDB, OPFS and Web Locks, its units on
 * Web Workers — whose `e3.fetch` answers it. They run as an admin, and their
 * reader cases as a reader: the page's e3 knows each by its token, and grants
 * the admin's one-shots `any` and the reader's `platform_free`. A browser
 * runs no commands. The global `fetch` refuses every request for the run, so
 * a request that is not forwarded fails, and is named when the part ends.
 *
 * @packageDocumentation
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { apiTestSuites, createTestContext, type TestContext, type TestSetup } from '@elaraai/e3-api-tests';
import { WEB_E3_ORIGIN } from '../bridge/protocol.js';
import { ADMIN_TOKEN, READER_TOKEN } from '../testing/callers.js';
import type { E3PageOptions, E3PageStarted } from './e3.page.js';
import { forwardInto } from './e3-forward.js';
import { Harness, type HarnessPage } from './harness.js';

/**
 * The parts the suites run in, each by the names of the suites it runs
 * (`apiTestSuites`): every suite in one part, as `e3-api-parts.spec.ts`
 * checks.
 */
export const API_SUITE_PARTS: ReadonlyArray<readonly string[]> = [
  ['repository', 'packages', 'workspaces', 'datasets', 'datasetPages', 'datasetTransfer', 'packageTransfer', 'platform'],
  ['dataflow'],
  ['functions', 'records', 'keyedRecords', 'recordDeploy'],
];

/** The pages and workers a part's harness serves. */
const entries = {
  e3: fileURLToPath(new URL('./e3.page.js', import.meta.url)),
  'e3-worker': fileURLToPath(new URL('./e3.worker.js', import.meta.url)),
  'e3-unit-worker': fileURLToPath(new URL('./e3-unit.worker.js', import.meta.url)),
};

/**
 * The part of the API suites a spec file runs, by its name: `e3-api-<n>.spec`
 * runs part `n`, the index `n - 1` of {@link API_SUITE_PARTS}.
 *
 * @param file - The spec file's URL or path
 * @returns The part's index
 * @throws {Error} When the file's name names no part the suites have
 */
export function apiSuitePartOf(file: string): number {
  const named = /(?:^|[/\\])e3-api-(\d+)\.spec\.[jt]s$/.exec(file);
  const part = named === null ? -1 : Number(named[1]) - 1;
  if (API_SUITE_PARTS[part] === undefined) {
    throw new Error(`${file} names no part of the API suites: a part's spec file is e3-api-<n>.spec.ts, n from 1 to ${API_SUITE_PARTS.length}`);
  }
  return part;
}

/**
 * Registers the part of the API suites a spec file runs, against e3 in a
 * Chromium page of its own.
 *
 * @param file - The spec file's URL (`import.meta.url`), whose name names the
 *   part ({@link apiSuitePartOf})
 */
export function apiSuitesInChromium(file: string): void {
  const part = apiSuitePartOf(file);
  const names = API_SUITE_PARTS[part]!;

  describe(`the API suites against e3 in Chromium, part ${part + 1} of ${API_SUITE_PARTS.length} (${names.join(', ')})`, () => {
    let harness: Harness | undefined;
    /** The page running e3 */
    let page: HarnessPage | undefined;
    /** The page's storage, removed once the part has run */
    const name = `e3-web-api-${crypto.randomUUID()}`;
    /** The fetch every request goes through: forwarded into the page */
    let forwarded: typeof globalThis.fetch | undefined;
    /** The global fetch, put back once the part has run */
    const networkFetch = globalThis.fetch;
    /** The requests that reached the global fetch */
    const escaped: string[] = [];
    let answered = 0;

    before(async () => {
      harness = await Harness.open({ entries });
      page = await harness.newPage('e3');
      const options: E3PageOptions = { name, hold: false, pieceBytes: null };
      const started = await page.call<E3PageStarted>('start', options);
      assert.equal(started.apiUrl, WEB_E3_ORIGIN);
      forwarded = forwardInto(page);
      globalThis.fetch = ((input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);
        escaped.push(url);
        return Promise.reject(new TypeError(`a request went to the global fetch rather than into the page: ${url}`));
      }) as typeof globalThis.fetch;
    });

    after(async () => {
      globalThis.fetch = networkFetch;
      try {
        if (page !== undefined) {
          await page.call('close');
          await page.call('clear', name);
        }
      } finally {
        await harness?.close();
      }
    });

    const setup: TestSetup<TestContext> = async (t) => {
      const fetch = forwarded;
      if (fetch === undefined) throw new Error('the page running e3 did not start');
      const ctx = await createTestContext({
        baseUrl: WEB_E3_ORIGIN,
        getToken: async () => ADMIN_TOKEN,
        // The reader may read every repository of the page's e3, so needs no grant
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

    for (const suite of names) {
      const register = apiTestSuites[suite];
      if (register === undefined) throw new Error(`e3-api-tests has no API suite '${suite}'`);
      register(setup);
    }

    // Last, once every test before it has cleaned up: a request whose refusal
    // what made it swallowed — a cleanup's — is named here, and so is every
    // error the page raised, whether or not a call reported it.
    it('sent every request into the page, which raised nothing', () => {
      assert.deepEqual(escaped, [], 'every request goes into the page');
      assert.ok(answered > 0, 'the suites\' requests went into the page');
      assert.deepEqual(page?.raisedErrors.map((error) => error.message), [], 'the page raised nothing');
    });
  });
}
