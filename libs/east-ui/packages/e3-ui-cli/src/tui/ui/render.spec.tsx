/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The frame writer, through Ink's real `render()`: incremental rendering
 * rewrites the lines a selection move changes rather than the screen, and
 * an idle status poll — the same data, a later `polledAt`, the same second
 * — produces a byte-identical frame that Ink does not write at all.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardFixture } from '../testing/fixtures.js';
import { NOW, dashboardView } from '../testing/harness.js';
import { mountInk, type InkProbe } from '../testing/ink-probe.js';

let probe: InkProbe | null = null;
afterEach(async () => { await probe?.unmount(); probe = null; });

describe('the frame writer (real Ink, 120×40)', () => {
    test('incremental rendering: a selection move rewrites a few lines, not the frame', async () => {
        probe = await mountInk({ view: dashboardView(), actions: dashboardFixture(6, 4, NOW) });
        probe.mark();
        probe.key({ downArrow: true });
        await probe.flush();
        const incremental = probe.bytes();
        assert.ok(probe.writes() >= 1, 'the move was written');
        // Two restyled rows (the old and the new selection) plus cursor moves: hundreds of
        // bytes. A 120×40 frame is above five kibibytes.
        assert.ok(incremental < 1_024, `${incremental} bytes for one selection move`);
        await probe.unmount();

        probe = await mountInk({ view: dashboardView(), actions: dashboardFixture(6, 4, NOW), incremental: false });
        probe.mark();
        probe.key({ downArrow: true });
        await probe.flush();
        const whole = probe.bytes();
        assert.ok(whole > 4 * incremental, `a full rewrite is ${whole} bytes against ${incremental} incremental`);
    });

    test('idle: status polls with unchanged data in the same second write nothing', async () => {
        let clock = NOW;
        probe = await mountInk({ view: dashboardView(), actions: dashboardFixture(6, 4, NOW), now: () => clock });
        const status = probe.store.getState().data.status['main']!.result;
        probe.mark();
        // Three polls inside the second the last frame was rendered in: `polledAt` moves,
        // the data does not, the hint reads `polled just now` throughout.
        for (let i = 1; i <= 3; i++) {
            clock = NOW + i * 150;
            probe.store.dispatch({ type: 'data/status', ws: 'main', result: status, at: clock });
            await probe.flush();
        }
        assert.equal(probe.writes(), 0, 'no write for an unchanged frame');
        assert.equal(probe.bytes(), 0);
        // The clock's next tick lands in the same second as the last poll and moves no
        // age the frame shows (the fixture's ages sit at 2m / 1m): still nothing.
        clock = NOW + 400;
        await new Promise(resolve => setTimeout(resolve, 1_100));
        assert.equal(probe.writes(), 0, 'no write on a tick that changes no text');
        // New data does write.
        probe.store.dispatch({ type: 'data/status', ws: 'main', result: { ...status, summary: { ...status.summary, tasks: { ...status.summary.tasks, ready: 5n } } }, at: clock });
        await probe.flush();
        assert.ok(probe.writes() >= 1, 'changed data is written');
    });
});
