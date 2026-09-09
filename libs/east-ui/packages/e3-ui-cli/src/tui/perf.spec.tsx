/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The design's budgets (DESIGN_TUI.md §17), measured by
 * `testing/perf-probe.ts` in a child process under `NODE_ENV=production`
 * — the build the bin runs — through Ink's real `render()`.
 *
 * Two kinds, deliberately apart. The **memory** gate is deterministic and
 * runs everywhere: an idle dashboard must leave Node's user-timing buffer
 * empty (the signature of the development build's leak — a
 * `performance.measure()` per component render that Node never frees) and
 * retain nothing per poll, with a bound far above the jitter of a forced
 * collection and far below the leak. The **timing** gates — CPU per
 * arrow-down keypress at 120×40 on a six-task and a 250-task workspace —
 * are opt-in (`E3_UI_PERF=1`) and skipped otherwise: a shared CI runner
 * does not measure time reliably, and a gate that fails on a slow moment
 * is worse than none. They are stated at a reference speed and scaled by
 * a fixed calibration workload, so a slower machine reads the same budget.
 * Every failure prints the measured numbers. The tests are named `perf:`
 * so `--test-name-pattern` can select them.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { IdleHeap } from './testing/perf-probe.js';

/** Whether the timing budgets run (`E3_UI_PERF=1`). */
const timing = process.env['E3_UI_PERF'] === '1';

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
/**
 * Heap retained over those polls at most, in KiB. A forced collection leaves
 * a heap that differs by a couple of MiB from one point to the next (−2.4 MiB
 * measured on an unchanged frame); the development build's leak is 22 MiB
 * over these polls.
 */
const IDLE_GROWTH_KB = 8_192;

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

describe('perf budgets — memory (DESIGN_TUI.md §17)', () => {
    test('perf: an idle dashboard retains nothing per poll and logs no user-timing entries', () => {
        const idle = probe<IdleHeap>(['idle', '50', '10', String(IDLE_POLLS)], ['--expose-gc']);
        assert.equal(idle.gc, true, 'the growth is measured after a forced GC');
        assert.equal(idle.measures, 0, `${idle.measures} performance.measure() entries after ${IDLE_POLLS} polls — the development build's per-render instrumentation is back`);
        assert.equal(idle.marks, 0, `${idle.marks} performance.mark() entries after ${IDLE_POLLS} polls`);
        assert.ok(idle.growthKB <= IDLE_GROWTH_KB, `${idle.growthKB.toFixed(0)} KiB retained over ${IDLE_POLLS} idle polls (${idle.perPollKB.toFixed(1)} KiB per poll), at most ${IDLE_GROWTH_KB} KiB`);
    });
});

describe('perf budgets — timing (E3_UI_PERF=1; not a CI gate)', { skip: !timing }, () => {
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
});
