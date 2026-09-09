/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The budget measurement behind `perf.spec.tsx`, as its own process so it
 * runs React's production build (`NODE_ENV=production`, as the bin sets
 * it) rather than the test runner's: mounts a dashboard of the given size
 * through Ink's real `render()`, presses arrow-down as a held key repeats,
 * and prints the CPU one keypress costs. Test-only.
 *
 *   node dist/tui/testing/perf-probe.js <tasks> <inputs>   →   { "tasks", "inputs", "ms" }
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

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

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

const tasks = Number(process.argv[2] ?? '6');
const inputs = Number(process.argv[3] ?? '4');
const ms = await cpuPerKeypress(tasks, inputs);
process.stdout.write(`${JSON.stringify({ tasks, inputs, ms, env: process.env['NODE_ENV'] ?? '' })}\n`);
