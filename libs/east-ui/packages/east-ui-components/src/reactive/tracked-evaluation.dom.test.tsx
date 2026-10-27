/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `useTrackedEvaluation` over an ASYNCHRONOUS tracker whose dependency set GROWS
 * across evaluations (#580).
 *
 * This is the shape every paged read has: evaluation 1 reads window 0, finds it
 * missing, starts the fetch and returns; when it lands, evaluation 2 reads
 * window 0 (hit) and window 1 (miss, starts it) — so the dependency set gains a
 * key it did not have when the subscription was created. If the subscription is
 * not refreshed, window 1's landing notifies nobody and the reader stalls
 * forever at window 0.
 *
 * The repo had no asynchronous paged fixture before this: every paged fixture in
 * `plan-paged.dom.test.tsx` / `table-paged.dom.test.tsx` resolves synchronously inside
 * one evaluation, which is exactly why the stall shipped.
 *
 * And what an evaluation runs for: once a change of what it read — never again
 * as its subscription takes up a key it read for the first time, while the
 * versions of the keys it read hold — and again, as before, where a key it read
 * moved while it ran.
 */

import { describe, test, expect, afterEach } from "vitest";
import { act, render, screen, cleanup, waitFor } from "@testing-library/react";
import { registerReactiveTracker, type ReactiveTracker } from "./tracker.js";
import { useTrackedEvaluation } from "./index.js";

afterEach(cleanup);

/**
 * A tracker that mimics `PagedRuntime`: one channel per window key, values that
 * land asynchronously, and a reader that walks `k0, k1, k2 …` stopping at the
 * first key that has not landed (the loader's contiguous-prefix rule).
 */
function walkingTracker(id = "w") {
    const landed = new Set<string>();
    const version = new Map<string, number>();
    const subs = new Map<string, Set<() => void>>();
    let recording: string[] | null = null;

    const land = (key: string): void => {
        setTimeout(() => {
            landed.add(key);
            version.set(key, (version.get(key) ?? 0) + 1);
            for (const cb of subs.get(key) ?? []) cb();
        }, 0);
    };

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
            getKeyVersion: (key) => version.get(key) ?? 0,
        }),
    };

    /** Walk the prefix; returns how many keys have landed. */
    const read = (): number => {
        for (let n = 0; n < 32; n++) {
            const key = `k${n}`;
            recording?.push(key);
            if (!landed.has(key)) { land(key); return n; }
        }
        return 32;
    };

    return { tracker, read, get subscribedKeys() { return [...subs.keys()].filter(k => (subs.get(k)?.size ?? 0) > 0); } };
}

function Walker({ read }: { read: () => number }) {
    const { result } = useTrackedEvaluation(read);
    return <div data-testid="loaded">{result.ok ? result.value : -1}</div>;
}

describe("useTrackedEvaluation — a growing dependency set (#580)", () => {
    test("a key discovered on a LATER evaluation still notifies", async () => {
        const w = walkingTracker();
        const unregister = registerReactiveTracker(w.tracker);
        try {
            render(<Walker read={w.read} />);
            // Evaluation 1 finds nothing landed and starts k0.
            expect(screen.getByTestId("loaded").textContent).toBe("0");

            // Each landing must drive the next evaluation, which discovers the
            // NEXT key. Without a refreshed subscription this stalls at 1.
            await waitFor(
                () => expect(Number(screen.getByTestId("loaded").textContent)).toBeGreaterThanOrEqual(4),
                { timeout: 3000 },
            );
        } finally {
            unregister();
        }
    });

    test("the subscription COVERS the keys the latest evaluation read", async () => {
        const w = walkingTracker("w2");
        const unregister = registerReactiveTracker(w.tracker);
        try {
            render(<Walker read={w.read} />);
            await waitFor(
                () => expect(Number(screen.getByTestId("loaded").textContent)).toBeGreaterThanOrEqual(3),
                { timeout: 3000 },
            );
            // The in-flight key is the one that must be listened to — a
            // subscription pinned to the first evaluation's keys would hold
            // only `k0`.
            const loaded = Number(screen.getByTestId("loaded").textContent);
            expect(w.subscribedKeys).toContain(`k${loaded}`);
        } finally {
            unregister();
        }
    });
});

/**
 * A tracker whose keys land as the test lands them — a channel a key, `k0`, `k1`, … — read as a paged reader
 * walks its windows: every key landed, and the first that has not, so each landing gives the next evaluation a
 * key it had not read.
 */
function steppedTracker(id: string) {
    const landed = new Set<string>();
    const version = new Map<string, number>();
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
            getKeyVersion: (key) => version.get(key) ?? 0,
        }),
    };
    return {
        tracker,
        /** Reads every key landed and the first that has not; returns how many have landed. */
        read(): number {
            for (let n = 0; ; n++) {
                const key = `k${n}`;
                recording?.push(key);
                if (!landed.has(key)) return n;
            }
        },
        /** Lands the first key not landed, telling its readers, as a page landing does. */
        land(): void {
            const key = `k${landed.size}`;
            landed.add(key);
            version.set(key, (version.get(key) ?? 0) + 1);
            for (const cb of [...(subs.get(key) ?? [])]) cb();
        },
        /** Moves a key's version without telling its readers yet, as a change the tracker has still to tell. */
        move(key: string): void { version.set(key, (version.get(key) ?? 0) + 1); },
        /** A key's version, as a read of it sees it. */
        versionOf(key: string): number { recording?.push(key); return version.get(key) ?? 0; },
    };
}

describe("useTrackedEvaluation — what an evaluation runs for", () => {
    test("an evaluation runs once a change of what it read: one that reads a key it had not is not run again as its subscription takes the key up", async () => {
        const s = steppedTracker("s1");
        const unregister = registerReactiveTracker(s.tracker);
        let runs = 0;
        const read = () => { runs += 1; return s.read(); };
        try {
            render(<Walker read={read} />);
            // The mount: one evaluation, which reads k0, not landed.
            expect([screen.getByTestId("loaded").textContent, runs]).toEqual(["0", 1]);
            for (let n = 1; n <= 3; n++) {
                // A key lands: one evaluation, which reads the next key, not landed — a key it had not read.
                await act(async () => { s.land(); });
                expect([screen.getByTestId("loaded").textContent, runs]).toEqual([String(n), n + 1]);
            }
        } finally {
            unregister();
        }
    });

    test("a key it read that moved while it ran holds nothing: the evaluation runs again, and draws what the key holds now", async () => {
        const s = steppedTracker("s2");
        const unregister = registerReactiveTracker(s.tracker);
        let runs = 0;
        // Each evaluation reads k0's version, and the second moves it as it runs, after reading it.
        const read = () => {
            runs += 1;
            const seen = s.versionOf("k0");
            if (runs === 2) s.move("k0");
            return seen;
        };
        try {
            render(<Walker read={read} />);
            expect([screen.getByTestId("loaded").textContent, runs]).toEqual(["0", 1]);
            // k0 lands: the evaluation reads version 1, then moves k0 to 2 — so it runs again, and draws 2.
            await act(async () => { s.land(); });
            expect([screen.getByTestId("loaded").textContent, runs]).toEqual(["2", 3]);
        } finally {
            unregister();
        }
    });
});
