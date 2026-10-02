/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * east-node-std's compliance suite over east-web-std, in Chromium: the
 * Chromium leg of what east-web-std's own `compliance.spec.ts` runs in Node.
 *
 * `make -C libs/east-node test-export-std` exports the suite to
 * `EAST_NODE_STD_IR`, which the root `paths.mk` sets to this checkout's
 * `tmp/east-node-std`, and this reads it from the same place. The harness serves the export, and a page
 * runs the suite of each module east-web-std provides. Each module is a test
 * here, which fails listing every East test that failed, with its message. A
 * canary shows the page reports a failure as one, and every suite in the
 * export is one the page runs or one east-web-std leaves out. Each test ends
 * asserting the page raised nothing.
 *
 * The Fetch suite calls httpbin on :8085 (the workspace root's
 * `make services-up`). The page is on another loopback port, so each request
 * crosses origins, as an app's would.
 *
 * Like every Chromium spec it never skips: when the export is missing or
 * Chromium does not launch, its `before` hook fails with the remediation.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SUITES, suiteFile, type ComplianceModules, type EastTestRecord, type SuiteRun } from './compliance.js';
import { Harness, type HarnessPage } from './harness.js';

/** Where the export is: `EAST_NODE_STD_IR`, which the root `paths.mk` sets to
 *  this checkout's `tmp/east-node-std` when this runs through make. */
const IR_DIR = process.env.EAST_NODE_STD_IR;

/** Where the Fetch suite sends its requests. */
const HTTPBIN = 'http://localhost:8085';

const entries = {
  compliance: fileURLToPath(new URL('./compliance.page.js', import.meta.url)),
};

/** Text whose lines after the first are indented, to sit under a line of a
 *  failure's listing. */
function indented(text: string): string {
  return text.split('\n').join('\n      ');
}

/** A suite or test that failed, as a line of a failure's listing: where it
 *  is, and why. */
function listed(record: EastTestRecord): string {
  return `  - ${record.path.join(' > ')}: ${indented(record.message ?? '(no message)')}`;
}

/** What a program wrote to one of its streams, as lines of a failure's
 *  listing; none when it wrote nothing. */
function written(stream: string, text: string): string[] {
  return text === '' ? [] : [`  its ${stream}:`, `      ${indented(text.replace(/\n$/, ''))}`];
}

/**
 * Why the Fetch suite cannot pass when httpbin does not answer Node either,
 * as a line of a failure's listing.
 *
 * @returns The remediation, or nothing when httpbin answers
 */
async function httpbinRemediation(): Promise<string[]> {
  try {
    const response = await fetch(`${HTTPBIN}/get`);
    await response.body?.cancel();
    if (response.ok) return [];
    return [`  httpbin at ${HTTPBIN} answers ${response.status} to GET /get: the Fetch suite needs httpbin there.`];
  } catch (err) {
    const why = err instanceof Error ? err.message : `${err as string}`;
    return [`  httpbin does not answer at ${HTTPBIN} (${why}): the Fetch suite calls it. Start it with \`make services-up\` at the workspace root.`];
  }
}

describe('east-node-std\'s compliance suite over east-web-std, in Chromium', () => {
  let harness: Harness | undefined;
  /** The page every suite runs in */
  let page: HarnessPage;
  /** The modules the page runs the suites of, and those it leaves out */
  let modules: ComplianceModules;
  /** The export's directory, once `before` has found it */
  let irDir: string;

  before(async () => {
    if (IR_DIR === undefined) {
      throw new Error(
        'EAST_NODE_STD_IR is unset: run it through make (`make -C libs/e3 test`), which sets it to this checkout\'s tmp/east-node-std',
      );
    }
    if (!existsSync(IR_DIR)) {
      throw new Error(
        `nothing at ${IR_DIR}: export east-node-std's compliance suite with \`make -C libs/east-node test-export-std\``,
      );
    }
    irDir = IR_DIR;
    harness = await Harness.open({ entries, directories: { [SUITES]: irDir } });
    page = await harness.newPage('compliance');
    modules = await page.call<ComplianceModules>('modules');
  });

  after(async () => {
    await harness?.close();
  });

  /** Asserts the page has raised nothing, a call's answer saying so or not. */
  function raisedNothing(): void {
    assert.deepEqual(page.raisedErrors.map((error) => error.stack ?? error.message), [], 'the page raised nothing');
  }

  it('records each East suite and test, a failure with its message, as a canary program shows', async () => {
    const run = await page.call<SuiteRun>('runCanary');
    const expected: SuiteRun = {
      records: [
        { kind: 'describe', path: ['canary'], passed: true, message: null },
        { kind: 'test', path: ['canary', 'passes'], passed: true, message: null },
        { kind: 'test', path: ['canary', 'fails an assertion'], passed: false, message: 'the canary\'s assertion' },
        { kind: 'test', path: ['canary', 'raises an East error'], passed: false, message: 'the canary\'s error' },
        { kind: 'describe', path: ['canary', 'nested'], passed: true, message: null },
        { kind: 'test', path: ['canary', 'nested', 'passes'], passed: true, message: null },
        { kind: 'describe', path: ['a suite that fails outside its tests'], passed: false, message: 'the suite\'s error' },
        { kind: 'test', path: ['a suite that fails outside its tests', 'passes'], passed: true, message: null },
      ],
      stdout: 'the canary sings\n',
      stderr: '',
      error: null,
    };
    assert.deepEqual(run, expected);
    raisedNothing();
  });

  it('every suite in the export is one east-web-std runs or leaves out', () => {
    const exported = readdirSync(irDir).filter((file) => file.endsWith('.json')).sort();
    assert.deepEqual(exported, [...modules.provided, ...modules.notProvided].map(suiteFile).sort());
  });

  it('runs the suite of each module east-web-std provides', async (t) => {
    for (const module of modules.provided) {
      await t.test(module, async (t) => {
        const run = await page.call<SuiteRun>('runSuite', module);
        const tests = run.records.filter((record) => record.kind === 'test');
        const failed = run.records.filter((record) => !record.passed);
        if (failed.length > 0 || run.error !== null) {
          assert.fail([
            `${module}'s suite failed in Chromium: ${tests.filter((record) => !record.passed).length} of its ${tests.length} East tests failed`,
            ...failed.map(listed),
            ...(run.error === null ? [] : [`  - the program: ${indented(run.error)}`]),
            ...written('standard output', run.stdout),
            ...written('standard error', run.stderr),
            ...(module === 'Fetch' ? await httpbinRemediation() : []),
          ].join('\n'));
        }
        assert.ok(tests.length > 0, `${module}'s suite declared no East test`);
        t.diagnostic(`${tests.length} East tests passed`);
        raisedNothing();
      });
    }
  });
});
