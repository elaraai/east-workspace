/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Residency policy (#577): which windows of a paged source are loaded, how the
 * set follows the viewport, and what eviction may and may not drop.
 *
 * The properties under test are the ones that decide whether scrolling behaves:
 * the run stays CONTIGUOUS (so the tree is never holey and the body is rows
 * between two bands), a far jump REBASES instead of fetching everything it
 * scrolled past, and eviction can NEVER drop what the viewport is asking for —
 * the rule whose absence is the classic permanent fetch loop.
 */

import { describe, test, expect } from "vitest";
import { createLedger, observeWindow, type WindowLedger } from "./window-ledger.js";
import {
    NO_RESIDENCY, DEFAULT_RESIDENCY, isEmpty, residentWindows,
    demandRange, step, trim, advance, pin,
    type Residency, type ResidencyOptions,
} from "./window-residency.js";

const PAGE = 200;

/** A ledger over `windows` windows, each measured at `rows` canvas rows. */
function measured(windows: number, rows = 100): WindowLedger {
    let l = createLedger(windows * PAGE, PAGE);
    for (let w = 0; w < windows; w++) l = observeWindow(l, w, { px: rows * 20, rows });
    return l;
}

/** Walk `advance` to a fixed point — what a stream of landings does. */
function settle(ledger: WindowLedger, viewport: number, opts = DEFAULT_RESIDENCY): Residency {
    let r: Residency = NO_RESIDENCY;
    for (let i = 0; i < 200; i++) {
        const next = advance(r, ledger, viewport, opts);
        if (next === r) return r;
        r = next;
    }
    return r;
}

describe("residency — demand follows the viewport", () => {
    test("starts at the viewport's own window", () => {
        const l = measured(50);
        const r = step(NO_RESIDENCY, l, 20, DEFAULT_RESIDENCY);
        expect(r.lo).toBe(20);
        expect(r.hi).toBe(20);
    });

    test("extends ONE window per step, ahead first, then behind", () => {
        const l = measured(50);
        let r = step(NO_RESIDENCY, l, 20, DEFAULT_RESIDENCY);   // [20,20]
        r = step(r, l, 20, DEFAULT_RESIDENCY);                  // ahead → [20,21]
        expect([r.lo, r.hi]).toEqual([20, 21]);
        r = step(r, l, 20, DEFAULT_RESIDENCY);                  // ahead → [20,22]
        expect([r.lo, r.hi]).toEqual([20, 22]);
        r = step(r, l, 20, DEFAULT_RESIDENCY);                  // behind → [19,22]
        expect([r.lo, r.hi]).toEqual([19, 22]);
        // Satisfied: the same object, so a render loop cannot spin.
        expect(step(r, l, 20, DEFAULT_RESIDENCY)).toBe(r);
    });

    test("the run is always contiguous — the property the tree depends on", () => {
        const l = measured(50);
        let r: Residency = NO_RESIDENCY;
        for (const viewport of [10, 11, 12, 13, 12, 11, 14, 15]) {
            for (let i = 0; i < 4; i++) r = advance(r, l, viewport);
            const ws = residentWindows(r);
            for (let i = 1; i < ws.length; i++) expect(ws[i]! - ws[i - 1]!).toBe(1);
        }
    });

    test("demand is clamped to the source at both ends", () => {
        const l = measured(4);
        expect(demandRange(l, 0, DEFAULT_RESIDENCY)).toEqual({ from: 0, to: 2 });
        expect(demandRange(l, 3, DEFAULT_RESIDENCY)).toEqual({ from: 2, to: 3 });
    });
});

describe("residency — a far jump rebases", () => {
    test("a scrollbar drag does NOT fetch everything it scrolled past", () => {
        const l = measured(250);
        const near = settle(l, 5);
        expect(near.lo).toBeLessThanOrEqual(5);

        // The thumb goes to 60%: window 150. Walking there would fetch ~145
        // windows; rebasing starts a fresh run at the destination.
        const jumped = step(near, l, 150, DEFAULT_RESIDENCY);
        expect([jumped.lo, jumped.hi]).toEqual([150, 150]);
    });

    test("a SMALL move extends rather than rebasing — no needless refetch", () => {
        const l = measured(250);
        const r = settle(l, 10);                      // ~[9,12]
        const nudged = step(r, l, 13, DEFAULT_RESIDENCY);
        // Still the same run, one wider; nothing was thrown away.
        expect(nudged.lo).toBe(r.lo);
        expect(nudged.hi).toBe(r.hi + 1);
    });
});

describe("residency — eviction", () => {
    const tight: ResidencyOptions = { ...DEFAULT_RESIDENCY, maxRows: 400, evictTo: 0.5 };

    test("does nothing until the budget is exceeded (hysteresis)", () => {
        const l = measured(50, 100);                  // 100 rows per window
        const r: Residency = { lo: 10, hi: 12, pins: new Set() };   // 300 rows
        expect(trim(r, l, 11, tight)).toBe(r);
    });

    test("drops the end FURTHEST from the viewport", () => {
        const l = measured(50, 100);
        // Viewport at the tail: the head is further away, so the head goes.
        const r: Residency = { lo: 10, hi: 19, pins: new Set() };   // 1,000 rows
        const trimmed = trim(r, l, 19, tight);
        expect(trimmed.hi).toBe(19);
        expect(trimmed.lo).toBeGreaterThan(10);
    });

    test("NEVER drops what the viewport is demanding — the fetch-loop rule", () => {
        const l = measured(50, 100);
        // A budget below the demand span: 4 windows wanted, 200 rows allowed.
        const starved: ResidencyOptions = { ...DEFAULT_RESIDENCY, maxRows: 200, evictTo: 0.5 };
        const r: Residency = { lo: 8, hi: 20, pins: new Set() };
        const trimmed = trim(r, l, 12, starved);
        const want = demandRange(l, 12, starved);
        // Everything the viewport asks for survived, even though that leaves
        // the run over budget. The alternative is evicting what we are about to
        // refetch — a permanent loop.
        expect(trimmed.lo).toBeLessThanOrEqual(want.from);
        expect(trimmed.hi).toBeGreaterThanOrEqual(want.to);
    });

    test("never drops a PINNED window (a seek target in flight)", () => {
        const l = measured(50, 100);
        let r: Residency = { lo: 10, hi: 25, pins: new Set() };
        r = pin(r, 10);                                // the jump's own window
        const trimmed = trim(r, l, 25, tight);
        expect(trimmed.lo).toBe(10);
        expect(residentWindows(trimmed)).toContain(10);
    });

    test("trims down to the hysteresis fraction, not merely to the cap", () => {
        const l = measured(50, 100);
        const r: Residency = { lo: 0, hi: 19, pins: new Set() };    // 2,000 rows
        const trimmed = trim(r, l, 19, tight);                      // cap 400, to 200
        const rows = residentWindows(trimmed).length * 100;
        expect(rows).toBeLessThanOrEqual(400);
        // Trimming only to the cap would re-trigger on the very next landing.
        expect(rows).toBeLessThanOrEqual(300);
    });

    test("an UNMEASURED window costs no budget — nothing of it is resident", () => {
        // Rows are counted from what has actually been measured, so a run that
        // has been demanded but not yet landed cannot evict its own neighbours.
        let l = createLedger(50 * PAGE, PAGE);
        l = observeWindow(l, 0, { px: 2000, rows: 100 });
        const r: Residency = { lo: 0, hi: 30, pins: new Set() };
        expect(trim(r, l, 15, tight)).toBe(r);
    });
});

describe("residency — settles", () => {
    test("a stationary viewport reaches a fixed point and stays there", () => {
        const l = measured(250);
        const r = settle(l, 100);
        expect(isEmpty(r)).toBe(false);
        expect(advance(r, l, 100)).toBe(r);
        const want = demandRange(l, 100, DEFAULT_RESIDENCY);
        expect(r.lo).toBeLessThanOrEqual(want.from);
        expect(r.hi).toBeGreaterThanOrEqual(want.to);
    });

    test("scrolling back and forth across a boundary does not oscillate the run", () => {
        const l = measured(250);
        let r = settle(l, 40);
        const before = residentWindows(r);
        // Cross a window boundary and come back, settling at each stop.
        for (const viewport of [41, 40, 41, 40]) {
            for (let i = 0; i < 4; i++) r = advance(r, l, viewport);
        }
        // The run grew to cover both, and nothing was dropped and refetched.
        expect(r.lo).toBeLessThanOrEqual(before[0]!);
        expect(r.hi).toBeGreaterThanOrEqual(before[before.length - 1]!);
    });
});
