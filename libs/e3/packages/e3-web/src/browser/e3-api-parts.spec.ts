/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The parts the API suites run in against e3 in Chromium
 * (`e3-api.ts`): together they run every suite e3-api-tests has, each once,
 * so a suite added there runs here too, or this fails naming it; each part
 * has its spec file; and a spec file runs the part its name names.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiTestSuites } from '@elaraai/e3-api-tests';
import { API_SUITE_PARTS, apiSuitePartOf } from './e3-api.js';

describe('the parts the API suites run in against e3 in Chromium', () => {
  it('run every API suite e3-api-tests has, each in one part', () => {
    const named = API_SUITE_PARTS.flat();
    const twice = named.filter((suite, at) => named.indexOf(suite) !== at);
    assert.deepEqual(twice, [], 'no suite runs in two parts');
    const suites = Object.keys(apiTestSuites);
    assert.deepEqual(suites.filter((suite) => !named.includes(suite)), [], 'every suite runs in a part');
    assert.deepEqual(named.filter((suite) => !suites.includes(suite)), [], 'every suite a part names is one e3-api-tests has');
  });

  it('has a spec file for each part, e3-api-<n>.spec.ts, and none for a part it has not', () => {
    const files = readdirSync(dirname(fileURLToPath(import.meta.url)))
      .map((file) => /^e3-api-(\d+)\.spec\.js$/.exec(file))
      .filter((match) => match !== null)
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b);
    assert.deepEqual(files, API_SUITE_PARTS.map((_, at) => at + 1));
  });

  it('runs in each spec file the part its name names, and refuses a file whose name names none', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const [at] of API_SUITE_PARTS.entries()) {
      assert.equal(apiSuitePartOf(new URL(`file://${here}/e3-api-${at + 1}.spec.js`).href), at, `e3-api-${at + 1}.spec runs part ${at + 1}`);
    }
    for (const file of [`${here}/e3-api-0.spec.js`, `${here}/e3-api-${API_SUITE_PARTS.length + 1}.spec.js`, `${here}/e3-api.js`, `${here}/e3-api-parts.spec.js`]) {
      assert.throws(() => apiSuitePartOf(file), /names no part of the API suites/, file);
    }
  });
});
