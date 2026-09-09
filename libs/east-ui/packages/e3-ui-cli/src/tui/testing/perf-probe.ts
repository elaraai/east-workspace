/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The measurements behind `perf.spec.tsx`, as their own process so they run
 * React's production build (`NODE_ENV=production`, as the bin sets it)
 * rather than the test runner's. Both mount a dashboard through Ink's real
 * `render()` and print one JSON line. Test-only.
 *
 *   node dist/tui/testing/perf-probe.js keypress
 *     → { mode, reference, fixtures: [{ tasks, inputs, ms }], env }
 *     the CPU one arrow-down keypress costs on a six-task and a 250-task
 *     dashboard, keys 40 ms apart as a held key repeats — and `reference`, the
 *     CPU a fixed workload takes on this machine, so the spec can scale the
 *     design's budget to the machine it runs on (a shared CI runner is about
 *     half the speed of the box the budget was set on)
 *
 *   node --expose-gc dist/tui/testing/perf-probe.js idle <tasks> <inputs> <polls>
 *     → { mode, tasks, inputs, polls, growthKB, perPollKB, measures, marks, gc, env }
 *     the heap an idle dashboard retains over its polls (the status feed every
 *     poll, the execution and dataset feeds every fifth) after a forced GC, and
 *     the size of Node's user-timing buffer: React's development build logs a
 *     `performance.measure()` per component render, and Node keeps every such
 *     entry for the life of the process — the leak that took a session left
 *     open overnight to `JavaScript heap out of memory` on the release before
 *     the bin set NODE_ENV.
 *
 * @packageDocumentation
 */

import { dashboardFixture } from './fixtures.js';
import { NOW, dashboardView } from './harness.js';
import { mountInk } from './ink-probe.js';

/** Keys per measured batch. */
const KEYS = 10;
/** Batches; the cheapest is the measurement (the others absorb GC and a busy machine). */
const BATCHES = 3;
/** Milliseconds between keys — a held key at ~25 Hz. */
const KEY_GAP_MS = 40;
/** Milliseconds between idle polls (the real feed's second, compressed). */
const POLL_GAP_MS = 20;
/** Polls before the idle baseline, so lazily allocated caches exist by then. */
const WARM_POLLS = 20;

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** The workspaces the keypress budget is measured on: the issue's six-task and 250-task fixtures. */
const KEYPRESS_FIXTURES: readonly { tasks: number; inputs: number }[] = [{ tasks: 6, inputs: 4 }, { tasks: 250, inputs: 50 }];

/**
 * A fixed workload independent of the code under test — strings padded and
 * joined into a 40-line frame, a map of 300 names read back and sorted, 150
 * times — that calibrates the machine: `perf.spec.tsx` holds its CPU time on
 * the box the design's budget was set on, and scales the budget by the ratio.
 *
 * @returns A checksum, so the work cannot be optimized away
 */
export function referenceWork(): number {
    let acc = 0;
    for (let round = 0; round < 150; round++) {
        const lines: string[] = [];
        for (let r = 0; r < 40; r++) {
            const spans: string[] = [];
            for (let s = 0; s < 8; s++) spans.push(`cell ${r}:${s} ${round}`.padEnd(15, ' '));
            lines.push(spans.join(''));
        }
        acc += lines.join('\n').length;
        const index = new Map<string, number>();
        for (let i = 0; i < 300; i++) index.set(`task_${i}`, i * round);
        for (const [key, value] of index) acc += key.length + (value & 7);
        acc += [...index.keys()].sort()[0]!.length;
    }
    return acc;
}

/** Milliseconds of CPU {@link referenceWork} takes on this machine (the best of five runs). */
export function referenceMs(): number {
    let best = Number.POSITIVE_INFINITY;
    let sink = 0;
    for (let i = 0; i < 5; i++) {
        const before = process.cpuUsage();
        sink += referenceWork();
        const used = process.cpuUsage(before);
        best = Math.min(best, (used.user + used.system) / 1_000);
    }
    if (sink === 0) throw new Error('the reference workload produced nothing');
    return best;
}

/**
 * Milliseconds of CPU one arrow-down keypress costs on a dashboard of
 * `tasks` tasks and `inputs` inputs at 120×40.
 *
 * @param tasks - Tasks in the workspace
 * @param inputs - Inputs in the workspace
 * @returns The cheapest batch's CPU per keypress
 */
export async function cpuPerKeypress(tasks: number, inputs: number): Promise<number> {
    const probe = await mountInk({ view: dashboardView(), actions: dashboardFixture(tasks, inputs, NOW) });
    try {
        for (let i = 0; i < 5; i++) {
            probe.key({ downArrow: true });
            await wait(KEY_GAP_MS);
        }
        let best = Number.POSITIVE_INFINITY;
        for (let batch = 0; batch < BATCHES; batch++) {
            const before = process.cpuUsage();
            for (let i = 0; i < KEYS; i++) {
                probe.key({ downArrow: true });
                await wait(KEY_GAP_MS);
            }
            await probe.flush();
            const used = process.cpuUsage(before);
            best = Math.min(best, (used.user + used.system) / 1_000 / KEYS);
        }
        return best;
    } finally {
        await probe.unmount();
    }
}

/** What {@link idleHeap} measures. */
export interface IdleHeap {
    /** Heap retained over the polls, after a forced GC, in KiB. */
    growthKB: number;
    /** The same per poll. */
    perPollKB: number;
    /** `performance.measure()` entries in Node's user-timing buffer at the end. */
    measures: number;
    /** `performance.mark()` entries at the end. */
    marks: number;
    /** Whether a GC could be forced (`--expose-gc`); without one the growth is noise. */
    gc: boolean;
}

/**
 * The heap an idle dashboard of `tasks` tasks retains over `polls` status
 * polls with unchanged data — the server returns a fresh object each poll,
 * as it does — plus the execution and dataset feeds every fifth poll.
 *
 * @param tasks - Tasks in the workspace
 * @param inputs - Inputs in the workspace
 * @param polls - Polls measured (after a warm-up)
 * @returns The retained growth and the user-timing buffer's size
 */
export async function idleHeap(tasks: number, inputs: number, polls: number): Promise<IdleHeap> {
    const probe = await mountInk({ view: dashboardView(), actions: dashboardFixture(tasks, inputs, NOW) });
    try {
        const state = probe.store.getState();
        const status = state.data.status['main']!.result;
        const execution = state.data.execution['main']!;
        const datasets = state.data.datasets['main']!;
        const gc = (globalThis as { gc?: () => void }).gc ?? null;
        const poll = (i: number): void => {
            probe.store.dispatch({ type: 'data/status', ws: 'main', result: { ...status, tasks: [...status.tasks], datasets: [...status.datasets] }, at: NOW + i * 1_000 });
            if (i % 5 === 0) {
                probe.store.dispatch({ type: 'data/execution', ws: 'main', state: execution.state, events: [...execution.events], startedAt: execution.startedAt });
                probe.store.dispatch({ type: 'data/datasets', ws: 'main', entries: [...datasets] });
            }
        };
        for (let i = 1; i <= WARM_POLLS; i++) {
            poll(i);
            await wait(POLL_GAP_MS);
        }
        await probe.flush();
        gc?.();
        const before = process.memoryUsage().heapUsed;
        for (let i = WARM_POLLS + 1; i <= WARM_POLLS + polls; i++) {
            poll(i);
            await wait(POLL_GAP_MS);
        }
        await probe.flush();
        gc?.();
        const growthKB = (process.memoryUsage().heapUsed - before) / 1024;
        return {
            growthKB,
            perPollKB: growthKB / polls,
            measures: performance.getEntriesByType('measure').length,
            marks: performance.getEntriesByType('mark').length,
            gc: gc !== null,
        };
    } finally {
        await probe.unmount();
    }
}

const mode = process.argv[2] ?? 'keypress';
const env = process.env['NODE_ENV'] ?? '';
if (mode === 'idle') {
    const tasks = Number(process.argv[3] ?? '50');
    const inputs = Number(process.argv[4] ?? '10');
    const polls = Number(process.argv[5] ?? '200');
    const result = await idleHeap(tasks, inputs, polls);
    process.stdout.write(`${JSON.stringify({ mode, tasks, inputs, polls, ...result, env })}\n`);
} else {
    // The reference is taken around each fixture (the least contended moment wins),
    // so the scale reflects the machine as it was while the keys were measured.
    let reference = referenceMs();
    const fixtures: { tasks: number; inputs: number; ms: number }[] = [];
    for (const { tasks, inputs } of KEYPRESS_FIXTURES) {
        fixtures.push({ tasks, inputs, ms: await cpuPerKeypress(tasks, inputs) });
        reference = Math.min(reference, referenceMs());
    }
    process.stdout.write(`${JSON.stringify({ mode, reference, fixtures, env })}\n`);
}
