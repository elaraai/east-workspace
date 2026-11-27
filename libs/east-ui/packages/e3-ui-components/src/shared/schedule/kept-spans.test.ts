/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What a reader of a schedule's events keeps of the spans its latest read no
 * longer wants (#1797): the most recently wanted, while together they weigh
 * at most the cap — a span its entries and one more — and none before the
 * first that does not fit. The readers' own tests carry it through e3: a
 * scroll back to rows a view has left reads nothing
 * (`plan/frame/plan-series.dom.test.tsx`, `plan/frame/plan-nested.dom.test.tsx`).
 */

import { describe, test, expect } from "vitest";
import { SCHEDULE_EVENT_CAP } from "@elaraai/e3-ui/internal";
import { scheduleSpansKept } from "./kept-spans.js";

/** A span no longer wanted, by its name: how many entries it holds. */
const span = (name: string, entries: number): readonly [string, number] => [name, entries];
/** A span's entries: the span itself, here. */
const entries = (held: number): number => held;
/** The names of the spans kept, in order. */
const kept = (unwanted: readonly (readonly [string, number])[]): string[] => scheduleSpansKept(unwanted, entries).map(([name]) => name);

describe("the spans a reader keeps of those no longer wanted (#1797)", () => {
    test("every one while together they fit, in the order given; none of none", () => {
        expect(kept([])).toEqual([]);
        expect(kept([span("a", 3_000), span("b", 0), span("c", 4_000)])).toEqual(["a", "b", "c"]);
    });

    test("past the cap, the least recently wanted are let go first", () => {
        expect(SCHEDULE_EVENT_CAP).toBe(10_000);
        // The newest two fit; the one before them would pass the cap, and nothing before it is kept.
        expect(kept([span("a", 100), span("b", 5_000), span("c", 4_000), span("d", 4_000)])).toEqual(["c", "d"]);
    });

    test("never a newer one let go for an older that would fit: what is kept is the newest, unbroken", () => {
        // The oldest would fit beside the newest, but the one between them does not.
        expect(kept([span("a", 10), span("b", 9_000), span("c", 2_000)])).toEqual(["c"]);
    });

    test("a span weighs its entries and one more: a span of no entry takes a place", () => {
        // One span of the cap's entries is past it by its own place.
        expect(kept([span("a", SCHEDULE_EVENT_CAP)])).toEqual([]);
        expect(kept([span("a", SCHEDULE_EVENT_CAP - 1)])).toEqual(["a"]);
        // As many empty spans as the cap, and no more: the oldest of one more is let go.
        const empty = Array.from({ length: SCHEDULE_EVENT_CAP + 1 }, (_x, i) => span(`s${i}`, 0));
        const held = kept(empty);
        expect(held).toHaveLength(SCHEDULE_EVENT_CAP);
        expect(held[0]).toBe("s1");
    });

    test("the spans kept are the ones given, each with its name", () => {
        const a = { entries: [1, 2] };
        const b = { entries: [3] };
        const out = scheduleSpansKept<{ entries: number[] }>([["a", a], ["b", b]], (one) => one.entries.length);
        expect(out).toEqual([["a", a], ["b", b]]);
        expect(out[0]![1]).toBe(a);
    });
});
