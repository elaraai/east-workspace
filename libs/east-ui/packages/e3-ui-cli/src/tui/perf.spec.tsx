/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The design's budgets (DESIGN_TUI.md §17), measured by
 * `testing/perf-probe.ts` in a child process under `NODE_ENV=production`
 * — the build the bin runs — through Ink's real `render()`: CPU per
 * arrow-down keypress at 120×40 on a six-task and a 250-task workspace,
 * and the heap an idle dashboard retains per poll (nothing: the
 * development build's per-render `performance.measure()` entries, which
 * Node never frees, are absent). A failure prints the measured number.
 * The tests are named `perf:` so `--test-name-pattern` can select or skip
 * them.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { IdleHeap } from './testing/perf-probe.js';

/** CPU per keypress at most, in milliseconds (§17: a frame in 16 ms). */
const BUDGET_MS = 16;
/** Idle polls measured. */
const IDLE_POLLS = 200;
/** Heap retained over those polls at most, in KiB (the development build retains ~135 KiB per poll). */
const IDLE_GROWTH_KB = 2_048;

/** Runs the probe and returns its JSON line. */
function probe<T>(args: string[], nodeFlags: string[] = []): T & { env: string } {
    const script = join(dirname(fileURLToPath(import.meta.url)), 'testing', 'perf-probe.js');
    const result = spawnSync(process.execPath, [...nodeFlags, script, ...args], {
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'production' },
        timeout: 60_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `the probe exits 0 (stderr: ${JSON.stringify(result.stderr)})`);
    const parsed = JSON.parse(result.stdout.trim()) as T & { env: string };
    assert.equal(parsed.env, 'production', 'measured on the production build, as the bin runs');
    return parsed;
}

describe('perf budgets (DESIGN_TUI.md §17)', () => {
    for (const [tasks, inputs] of [[6, 4], [250, 50]] as const) {
        test(`perf: an arrow-down keypress costs at most ${BUDGET_MS} ms of CPU on a ${tasks}-task dashboard at 120×40`, () => {
            const { ms } = probe<{ ms: number }>(['keypress', String(tasks), String(inputs)]);
            assert.ok(ms <= BUDGET_MS, `${tasks} tasks: ${ms.toFixed(1)} ms of CPU per keypress, budget ${BUDGET_MS} ms`);
        });
    }

    test('perf: an idle dashboard retains nothing per poll and logs no user-timing entries', () => {
        const idle = probe<IdleHeap>(['idle', '50', '10', String(IDLE_POLLS)], ['--expose-gc']);
        assert.equal(idle.gc, true, 'the growth is measured after a forced GC');
        assert.equal(idle.measures, 0, `${idle.measures} performance.measure() entries after ${IDLE_POLLS} polls — the development build's per-render instrumentation is back`);
        assert.equal(idle.marks, 0, `${idle.marks} performance.mark() entries after ${IDLE_POLLS} polls`);
        assert.ok(idle.growthKB <= IDLE_GROWTH_KB, `${idle.growthKB.toFixed(0)} KiB retained over ${IDLE_POLLS} idle polls (${idle.perPollKB.toFixed(1)} KiB per poll), at most ${IDLE_GROWTH_KB} KiB`);
    });
});
