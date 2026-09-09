/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The design's frame budget (DESIGN_TUI.md §17): CPU per arrow-down
 * keypress at 120×40 on a six-task and a 250-task workspace, measured by
 * `testing/perf-probe.ts` in a child process under `NODE_ENV=production`
 * — the build the bin runs — through Ink's real `render()`. A failure
 * prints the measured number. The tests are named `perf:` so
 * `--test-name-pattern` can select or skip them.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** CPU per keypress at most, in milliseconds (§17: a frame in 16 ms). */
const BUDGET_MS = 16;

/** Runs the probe for a workspace size and returns its measurement. */
function measure(tasks: number, inputs: number): { ms: number; env: string } {
    const probe = join(dirname(fileURLToPath(import.meta.url)), 'testing', 'perf-probe.js');
    const result = spawnSync(process.execPath, [probe, String(tasks), String(inputs)], {
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'production' },
        timeout: 60_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `the probe exits 0 (stderr: ${JSON.stringify(result.stderr)})`);
    return JSON.parse(result.stdout.trim()) as { ms: number; env: string };
}

describe('perf budgets (DESIGN_TUI.md §17)', () => {
    for (const [tasks, inputs] of [[6, 4], [250, 50]] as const) {
        test(`perf: an arrow-down keypress costs at most ${BUDGET_MS} ms of CPU on a ${tasks}-task dashboard at 120×40`, () => {
            const { ms, env } = measure(tasks, inputs);
            assert.equal(env, 'production', 'measured on the production build, as the bin runs');
            assert.ok(ms <= BUDGET_MS, `${tasks} tasks: ${ms.toFixed(1)} ms of CPU per keypress, budget ${BUDGET_MS} ms`);
        });
    }
});
