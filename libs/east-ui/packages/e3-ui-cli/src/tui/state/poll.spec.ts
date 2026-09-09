/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BACKOFF_MS, connectionState, createPoller, type PollClock } from './poll.js';

/** Deterministic timers: `advance(ms)` fires due callbacks in order. */
function fakeClock(): PollClock & { advance(ms: number): Promise<void>; pending(): number } {
    let now = 1_000_000;
    let seq = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    return {
        now: () => now,
        setTimeout(fn, ms) {
            const id = ++seq;
            timers.set(id, { at: now + ms, fn });
            return id;
        },
        clearTimeout(handle) {
            timers.delete(handle as number);
        },
        async advance(ms) {
            const target = now + ms;
            for (;;) {
                const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
                if (due === undefined) break;
                timers.delete(due[0]);
                now = due[1].at;
                due[1].fn();
                // Let the tick's promise chain settle before the next timer.
                await new Promise(resolve => setImmediate(resolve));
                await new Promise(resolve => setImmediate(resolve));
            }
            now = target;
        },
        pending: () => timers.size,
    };
}

const settle = async (): Promise<void> => {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
};

describe('createPoller', () => {
    test('runs immediately on start, then every interval', async () => {
        const clock = fakeClock();
        const results: number[] = [];
        let n = 0;
        const poller = createPoller({
            key: 'status', intervalMs: 1000, clock,
            run: async () => ++n,
            onResult: (r) => results.push(r),
        });
        poller.start();
        await settle();
        assert.deepEqual(results, [1]);
        await clock.advance(1000);
        assert.deepEqual(results, [1, 2]);
        await clock.advance(2000);
        assert.deepEqual(results, [1, 2, 3, 4]);
        poller.stop();
        await clock.advance(5000);
        assert.deepEqual(results, [1, 2, 3, 4]);
        assert.equal(clock.pending(), 0);
    });

    test('backs off 1 → 2 → 4 → 8 → 15 s on consecutive failures and recovers', async () => {
        const clock = fakeClock();
        const errors: number[] = [];
        let fail = true;
        let runs = 0;
        const poller = createPoller({
            key: 'x', intervalMs: 1000, clock,
            run: async () => { runs++; if (fail) throw new Error('down'); return runs; },
            onResult: () => undefined,
            onError: (_e, failures) => errors.push(failures),
        });
        poller.start();
        await settle();
        assert.deepEqual(errors, [1]);
        const attemptsAt: number[] = [];
        for (const step of BACKOFF_MS) {
            const before = runs;
            await clock.advance(step - 1);
            assert.equal(runs, before, `nothing fires before ${step}ms`);
            await clock.advance(1);
            attemptsAt.push(runs);
        }
        assert.deepEqual(errors, [1, 2, 3, 4, 5, 6]);
        assert.equal(poller.status().failures, 6);
        // Recovery resets the failure count and the interval.
        fail = false;
        await clock.advance(15_000);
        assert.equal(poller.status().failures, 0);
        assert.equal(poller.status().lastOkAt, clock.now());
        poller.stop();
    });

    test('keeps a single request in flight and ignores a superseded result', async () => {
        const clock = fakeClock();
        const results: string[] = [];
        let resolveFirst: ((v: string) => void) | undefined;
        let calls = 0;
        const poller = createPoller<string>({
            key: 'slow', intervalMs: 1000, clock,
            run: () => new Promise((resolve) => { calls++; if (calls === 1) resolveFirst = resolve; else resolve(`r${calls}`); }),
            onResult: (r) => results.push(r),
        });
        poller.start();
        await settle();
        assert.equal(calls, 1);
        poller.fireNow(); // supersedes the slow first request
        await settle();
        assert.equal(calls, 2);
        assert.deepEqual(results, ['r2']);
        resolveFirst?.('r1'); // the stale result is dropped
        await settle();
        assert.deepEqual(results, ['r2']);
        poller.stop();
    });

    test('pause / resume / setInterval', async () => {
        const clock = fakeClock();
        let n = 0;
        const poller = createPoller({ key: 'p', intervalMs: 1000, clock, run: async () => ++n, onResult: () => undefined });
        poller.start();
        await settle();
        poller.pause();
        assert.equal(poller.status().running, false);
        await clock.advance(5000);
        assert.equal(n, 1);
        poller.setInterval(5000);
        poller.resume();
        await settle();
        assert.equal(n, 2);
        await clock.advance(4999);
        assert.equal(n, 2);
        await clock.advance(1);
        assert.equal(n, 3);
        poller.stop();
    });
});

describe('connectionState', () => {
    const at = (failures: number, running = true) => ({
        status: () => ({ key: 'k', running, inFlight: false, failures, lastOkAt: 1, lastAttemptAt: 2 }),
    });
    test('idle without running pollers, connected while they succeed', () => {
        assert.deepEqual(connectionState([]), { kind: 'idle' });
        assert.deepEqual(connectionState([at(0, false)]), { kind: 'idle' });
        assert.deepEqual(connectionState([at(0), at(0)]), { kind: 'connected' });
    });
    test('reconnecting n/4 during the backoff, offline once the ladder is exhausted', () => {
        assert.deepEqual(connectionState([at(0), at(3)]), { kind: 'reconnecting', attempt: 3, of: 4 });
        assert.deepEqual(connectionState([at(5)]), { kind: 'offline' });
    });
});
