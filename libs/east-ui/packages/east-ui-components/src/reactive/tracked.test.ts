/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The framework-free tracked read (#815): it subscribes to exactly what its
 * last run read, follows a dependency set that grows (#580), disarms every
 * tracker whatever the closure does, goes quiet once released, and listens
 * again on the next run.
 */

import { describe, test, expect, afterEach } from "vitest";
import { registerReactiveTracker, type ReactiveTracker } from "./tracker.js";
import { createTrackedRead } from "./tracked.js";

/** A tracker with explicit channels: `read(key)` records, `fire(key)` notifies. */
function channelTracker(id: string) {
    const subs = new Map<string, Set<() => void>>();
    let recording: string[] | null = null;
    const tracker: ReactiveTracker = {
        id,
        enableTracking() { recording = []; },
        disableTracking() { const r = recording ?? []; recording = null; return r; },
        getStore: () => ({
            subscribe(key, cb) {
                const set = subs.get(key) ?? new Set<() => void>();
                set.add(cb);
                subs.set(key, set);
                return () => { set.delete(cb); };
            },
            getKeyVersion: () => 0,
        }),
    };
    return {
        tracker,
        read(key: string) { recording?.push(key); },
        fire(key: string) { for (const cb of [...(subs.get(key) ?? [])]) cb(); },
        get recording() { return recording; },
        subscribed: () => [...subs.entries()].filter(([, s]) => s.size > 0).map(([k]) => k).sort(),
    };
}

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length > 0) cleanups.pop()!(); });

function registered(id: string) {
    const ch = channelTracker(id);
    cleanups.push(registerReactiveTracker(ch.tracker));
    return ch;
}

describe("createTrackedRead", () => {
    test("a run subscribes to what it read, and a change there invalidates it", () => {
        const ch = registered("t1");
        let invalidated = 0;
        const tr = createTrackedRead(() => { invalidated += 1; });
        cleanups.push(() => tr.release());

        const out = tr.run(() => { ch.read("a"); ch.read("b"); return 42; });
        expect(out).toEqual({ ok: true, value: 42 });
        expect(ch.subscribed()).toEqual(["a", "b"]);
        ch.fire("a");
        expect(invalidated).toBe(1);
        // A key it never read notifies nobody.
        ch.fire("z");
        expect(invalidated).toBe(1);
    });

    test("each run REPLACES the subscriptions — a key discovered later is covered, a dropped one released (#580)", () => {
        const ch = registered("t2");
        let invalidated = 0;
        const tr = createTrackedRead(() => { invalidated += 1; });
        cleanups.push(() => tr.release());

        tr.run(() => ch.read("w0"));
        expect(ch.subscribed()).toEqual(["w0"]);
        tr.run(() => { ch.read("w1"); ch.read("w2"); });
        expect(ch.subscribed()).toEqual(["w1", "w2"]);
        ch.fire("w0");
        expect(invalidated).toBe(0);
        ch.fire("w2");
        expect(invalidated).toBe(1);
    });

    test("a closure that throws still disarms every tracker and follows what it read before the throw", () => {
        const ch = registered("t3");
        let invalidated = 0;
        const tr = createTrackedRead(() => { invalidated += 1; });
        cleanups.push(() => tr.release());

        const boom = new Error("page failed");
        const out = tr.run(() => { ch.read("w0"); throw boom; });
        expect(out).toEqual({ ok: false, error: boom });
        // Left recording, the tracker would attribute a component's reads to us.
        expect(ch.recording).toBeNull();
        ch.fire("w0");
        expect(invalidated).toBe(1);
    });

    test("a tracker that registers AFTER a run invalidates it", () => {
        let invalidated = 0;
        const tr = createTrackedRead(() => { invalidated += 1; });
        cleanups.push(() => tr.release());
        tr.run(() => 1);
        registered("late");
        expect(invalidated).toBe(1);
    });

    test("released, it drops everything and a queued notification reaches nobody", () => {
        const ch = registered("t4");
        let invalidated = 0;
        const tr = createTrackedRead(() => { invalidated += 1; });
        tr.run(() => ch.read("w0"));
        tr.release();
        expect(ch.subscribed()).toEqual([]);
        ch.fire("w0");
        registered("after-release");
        expect(invalidated).toBe(0);
    });

    test("a run after a release subscribes afresh — a canvas remounted by StrictMode keeps listening", () => {
        const ch = registered("t5");
        let invalidated = 0;
        const tr = createTrackedRead(() => { invalidated += 1; });
        cleanups.push(() => tr.release());
        tr.run(() => ch.read("w0"));
        tr.release();
        tr.run(() => ch.read("w0"));
        expect(ch.subscribed()).toEqual(["w0"]);
        ch.fire("w0");
        expect(invalidated).toBe(1);
        // The registry watch is back too.
        registered("after-rearm");
        expect(invalidated).toBe(2);
    });
});
