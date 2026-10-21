/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The guard every vitest test runs under (`vitest.setup.ts`, #1380): a test's
 * requests go to e3 through the harness's fetch, so the global `fetch`
 * refuses each, as a network that fails does, and the test that made one
 * fails, naming it. The spec runs vitest over two tests under the package's
 * setup (`fixtures/fetch-guard/`): one whose request reaches the global
 * fetch, and one that makes none.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** Vitest's command line, as the package's `vitest run` starts it. */
const vitest = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");
const config = join(import.meta.dirname, "fixtures", "fetch-guard", "vitest.config.ts");

/** One test's outcome, as vitest's JSON report gives it. */
interface Outcome {
    readonly title: string;
    readonly status: string;
    readonly failureMessages: readonly string[];
}

/** Runs the guard's two tests, and reads each one's outcome from vitest's report. */
function runGuarded(): Promise<{ code: number | null; outcomes: Outcome[] }> {
    return new Promise((resolve, reject) => {
        execFile(process.execPath, [vitest, "run", "--config", config, "--reporter", "json"], { cwd: dirname(config) }, (error, stdout) => {
            const start = stdout.indexOf("{");
            if (start < 0) {
                reject(new Error(`vitest wrote no report: ${error?.message ?? stdout}`));
                return;
            }
            const report = JSON.parse(stdout.slice(start)) as { testResults: { assertionResults: Outcome[] }[] };
            resolve({ code: error === null ? 0 : (error as { code?: number }).code ?? null, outcomes: report.testResults.flatMap((file) => file.assertionResults) });
        });
    });
}

test("a test whose request reaches the global fetch fails, naming it; a test that makes none passes", { timeout: 120_000 }, async () => {
    const { code, outcomes } = await runGuarded();
    assert.notEqual(code, 0, "the run fails");
    assert.deepEqual(outcomes.map((outcome) => [outcome.title, outcome.status]), [["a request to the global fetch", "failed"], ["no request", "passed"]]);
    const [reached] = outcomes;
    assert.match(reached!.failureMessages.join("\n"),
        /the test's requests reached the global fetch, not the harness's: http:\/\/e3\.invalid\/api\/repos\/default\/workspaces\/w\/status/);
});
