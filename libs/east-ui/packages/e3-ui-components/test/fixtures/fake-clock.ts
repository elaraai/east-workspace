/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `FakeClock` — drives `ReactiveDatasetCache`'s polling deterministically.
 *
 * Tests construct one, pass it to the cache constructor, and then invoke
 * `tickAll()` (or `tickOnce(handle)`) to fire pending intervals exactly
 * once. Real-time elapses zero between ticks.
 */

import type { Clock } from "../../src/platform/dataset-store.js";

export interface FakeIntervalHandle {
    /** Cancel — equivalent to `clearInterval`. */
    clear(): void;
    /** Whether the interval is still active (i.e. `clear()` has not
     *  been called). */
    readonly active: boolean;
    /** The original interval period in ms. */
    readonly intervalMs: number;
    /** Number of times the callback has been invoked via `tick()`. */
    readonly tickCount: number;
}

export interface FakeClock extends Clock {
    /** All currently-active intervals — useful for assertions. */
    readonly intervals: ReadonlyArray<FakeIntervalHandle>;
    /** Fire every active interval's callback once. */
    tickAll(): void;
    /** Fire a specific interval's callback once. */
    tickOnce(handle: FakeIntervalHandle): void;
    /** Fire every active interval's callback `n` times in sequence. */
    tickN(n: number): void;
}

interface FakeIntervalEntry {
    readonly fn: () => void;
    readonly intervalMs: number;
    cancelled: boolean;
    tickCount: number;
}

export function createFakeClock(): FakeClock {
    const entries = new Set<FakeIntervalEntry>();
    const handleByEntry = new WeakMap<FakeIntervalEntry, FakeIntervalHandle>();

    function makeHandle(entry: FakeIntervalEntry): FakeIntervalHandle {
        const handle: FakeIntervalHandle = {
            clear: () => {
                entry.cancelled = true;
                entries.delete(entry);
            },
            get active() { return !entry.cancelled; },
            get intervalMs() { return entry.intervalMs; },
            get tickCount() { return entry.tickCount; },
        };
        handleByEntry.set(entry, handle);
        return handle;
    }

    return {
        setInterval(fn, ms) {
            const entry: FakeIntervalEntry = {
                fn, intervalMs: ms, cancelled: false, tickCount: 0,
            };
            entries.add(entry);
            return makeHandle(entry);
        },
        get intervals() {
            return [...entries].map(e => handleByEntry.get(e)!).filter(h => h.active);
        },
        tickAll() {
            for (const entry of [...entries]) {
                if (entry.cancelled) continue;
                entry.tickCount++;
                entry.fn();
            }
        },
        tickOnce(handle) {
            for (const entry of entries) {
                if (handleByEntry.get(entry) === handle && !entry.cancelled) {
                    entry.tickCount++;
                    entry.fn();
                    return;
                }
            }
        },
        tickN(n) {
            for (let i = 0; i < n; i++) this.tickAll();
        },
    };
}

/** Yield to microtasks once. */
export const flushMicrotasks = (): Promise<void> =>
    new Promise(resolve => queueMicrotask(resolve));

/** Drain ALL pending microtasks (and short macrotask hops). The cache's
 *  poll path chains 5+ awaits — `setImmediate` lets every queued
 *  microtask drain before we resume. Use after `tick()` whenever you
 *  need the poll's full state-update pipeline to have settled. */
export const settle = async (): Promise<void> => {
    // Yield to setImmediate twice — drains microtask queues that were
    // populated by other microtasks. Two passes covers the common
    // 5-deep await chain in the cache's polling code.
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
};
