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
 * Node never frees, are absent).
 *
 * The keypress budget is stated at a reference speed. The probe also times
 * a fixed workload independent of the code under test; the budget scales
 * by this machine's ratio to the box the budget was set on (a shared CI
 * runner is about half the speed), with a quarter allowed for measurement
 * noise. A second assertion pins what the dashboard fix guarantees
 * regardless of the machine: the 250-task keypress costs at most 2.5× the
 * six-task one — the cost follows the screen, not the workspace. A failure
 * prints the measured numbers. The tests are named `perf:` so
 * `--test-name-pattern` can select or skip them.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { IdleHeap } from './testing/perf-probe.js';

/** CPU per keypress at most, in milliseconds, at the reference speed (§17: a frame in 16 ms). */
const BUDGET_MS = 16;
/** The reference workload's CPU on the box the budget was set on (`referenceWork`, node 22, 2026-09). */
const REFERENCE_MS = 4.5;
/** Allowance for measurement noise on the budget. */
const NOISE = 1.25;
/** The 250-task keypress may cost at most this many times the six-task one. */
const SIZE_RATIO = 2.5;
/** Idle polls measured. */
const IDLE_POLLS = 200;
/** Heap retained over those polls at most, in KiB (the development build retains ~135 KiB per poll). */
const IDLE_GROWTH_KB = 2_048;

/** What the probe's keypress mode reports. */
interface KeypressReport {
    reference: number;
    fixtures: { tasks: number; inputs: number; ms: number }[];
}

/** Runs the probe and returns its JSON line. */
function probe<T>(args: string[], nodeFlags: string[] = []): T & { env: string } {
    const script = join(dirname(fileURLToPath(import.meta.url)), 'testing', 'perf-probe.js');
    const result = spawnSync(process.execPath, [...nodeFlags, script, ...args], {
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'production' },
        timeout: 120_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `the probe exits 0 (stderr: ${JSON.stringify(result.stderr)})`);
    const parsed = JSON.parse(result.stdout.trim()) as T & { env: string };
    assert.equal(parsed.env, 'production', 'measured on the production build, as the bin runs');
    return parsed;
}

describe('perf budgets (DESIGN_TUI.md §17)', () => {
    let report: KeypressReport | null = null;
    before(() => { report = probe<KeypressReport>(['keypress']); });

    /** The budget on this machine, and how it was scaled. */
    const budget = (): { ms: number; note: string } => {
        const scale = Math.max(1, report!.reference / REFERENCE_MS);
        const ms = BUDGET_MS * scale * NOISE;
        return { ms, note: `the reference workload takes ${report!.reference.toFixed(1)} ms here against ${REFERENCE_MS} ms on the reference box (${scale.toFixed(2)}×), and a quarter is allowed for noise: ${ms.toFixed(1)} ms` };
    };

    for (const tasks of [6, 250]) {
        test(`perf: an arrow-down keypress costs at most ${BUDGET_MS} ms of CPU at the reference speed on a ${tasks}-task dashboard at 120×40`, () => {
            const fixture = report!.fixtures.find(f => f.tasks === tasks)!;
            const { ms, note } = budget();
            assert.ok(fixture.ms <= ms, `${tasks} tasks: ${fixture.ms.toFixed(1)} ms of CPU per keypress — ${note}`);
        });
    }

    test(`perf: the 250-task keypress costs at most ${SIZE_RATIO}× the six-task one — the cost follows the screen, not the workspace`, () => {
        const small = report!.fixtures.find(f => f.tasks === 6)!;
        const large = report!.fixtures.find(f => f.tasks === 250)!;
        assert.ok(large.ms <= SIZE_RATIO * small.ms, `250 tasks: ${large.ms.toFixed(1)} ms against ${small.ms.toFixed(1)} ms on six tasks (${(large.ms / small.ms).toFixed(2)}×)`);
    });

    test('perf: an idle dashboard retains nothing per poll and logs no user-timing entries', () => {
        const idle = probe<IdleHeap>(['idle', '50', '10', String(IDLE_POLLS)], ['--expose-gc']);
        assert.equal(idle.gc, true, 'the growth is measured after a forced GC');
        assert.equal(idle.measures, 0, `${idle.measures} performance.measure() entries after ${IDLE_POLLS} polls — the development build's per-render instrumentation is back`);
        assert.equal(idle.marks, 0, `${idle.marks} performance.mark() entries after ${IDLE_POLLS} polls`);
        assert.ok(idle.growthKB <= IDLE_GROWTH_KB, `${idle.growthKB.toFixed(0)} KiB retained over ${IDLE_POLLS} idle polls (${idle.perPollKB.toFixed(1)} KiB per poll), at most ${IDLE_GROWTH_KB} KiB`);
    });
});
