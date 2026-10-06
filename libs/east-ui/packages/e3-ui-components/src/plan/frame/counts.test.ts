/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * What the Plan's footer counts of its event kinds (#1193, PB23): every kind's
 * events in the window the canvas shows, the backlog of the kinds that keep
 * one, the events awaiting a call of the kinds that are reviewed, and the
 * newest commit to any kind's record; the last counts while a read is in
 * flight or has failed.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { none, some, variant } from "@elaraai/east";
import { UIStore } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { utcAt } from "../plan.test-utils.js";
import { planScale, type PlanScale } from "../scale.js";
import { usePlanEventCounts, type PlanEventKindValue } from "./counts.js";

beforeEach(() => { initializeStore(new UIStore()); });

/** Four weeks by the day, from Monday 5 October. */
const scale = planScale({ kind: "time", window: { min: utcAt("2026-10-05T00:00:00"), max: utcAt("2026-11-02T00:00:00") }, resolution: "day" }) as PlanScale;

/** An event in the window, with its verdict when its kind is reviewed. */
const item = (verdict?: "pending" | "approved" | "rejected") => ({ verdict: verdict !== undefined ? some(variant(verdict, null)) : none });

/** A kind's answer: its items, or none while its read is in flight. */
type Answer = () => ReturnType<PlanEventKindValue["planItems"]>;

/** An event kind, as the payload carries it: the seams the footer reads, each answering what it is given. */
function kind(k: { items: Answer; reviewed?: boolean; backlog?: Answer; commits?: readonly Date[]; asked?: [Date, Date][] }): PlanEventKindValue {
    return {
        planItems: (from: Date, to: Date) => {
            k.asked?.push([from, to]);
            return k.items();
        },
        roles: { review: k.reviewed === true ? some("verdict") : none },
        backlog: k.backlog !== undefined,
        planUnscheduled: () => k.backlog!(),
        history: () => some((k.commits ?? []).map((at) => ({ at }))),
    } as unknown as PlanEventKindValue;
}

describe("the footer's counts of the event kinds (#1193, PB23)", () => {
    test("every kind's events in the window, the backlog of the kinds that keep one, the events awaiting a call of the kinds reviewed, and the newest commit of any", () => {
        const asked: [Date, Date][] = [];
        const kinds = [
            kind({
                items: () => some([item("pending"), item("approved"), item("rejected")]) as never,
                reviewed: true, backlog: () => some([item(), item()]) as never,
                commits: [utcAt("2026-10-09T10:00:00"), utcAt("2026-10-01T10:00:00")], asked,
            }),
            kind({ items: () => some([item(), item()]) as never, commits: [utcAt("2026-10-12T08:30:00")] }),
        ];
        const { result } = renderHook(() => usePlanEventCounts(kinds, scale));
        expect(result.current).toEqual({ events: 5, backlog: 2, toReview: 1, saved: utcAt("2026-10-12T08:30:00") });
        // Read over the window the canvas shows.
        expect(asked[0]).toEqual([utcAt("2026-10-05T00:00:00"), utcAt("2026-11-02T00:00:00")]);
    });

    test("no kind keeps a backlog or is reviewed: neither is counted; no commit, no last save; no kinds, no counts", () => {
        const plain = renderHook(() => usePlanEventCounts([kind({ items: () => some([item()]) as never })], scale));
        expect(plain.result.current).toEqual({ events: 1, backlog: undefined, toReview: undefined, saved: undefined });
        const bare = renderHook(() => usePlanEventCounts([], scale));
        expect(bare.result.current).toBeUndefined();
    });

    test("a read in flight keeps the last counts; one that fails keeps them and says why; a Plan without event kinds counts nothing", () => {
        let answer: Answer = () => some([item("pending")]) as never;
        // A new list each time, so the counts are read again.
        const kindsNow = () => [kind({ items: () => answer(), reviewed: true })];
        const { result, rerender } = renderHook(({ kinds }) => usePlanEventCounts(kinds, scale), { initialProps: { kinds: kindsNow() } });
        const first = result.current;
        expect(first).toEqual({ events: 1, backlog: undefined, toReview: 1, saved: undefined });
        // In flight: the last counts stand.
        answer = () => none;
        rerender({ kinds: kindsNow() });
        expect(result.current).toBe(first);
        // Failed: they stand still, and the console says why.
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            answer = () => { throw new Error("the record could not be read"); };
            rerender({ kinds: kindsNow() });
            expect(result.current).toBe(first);
            expect(errors).toHaveBeenCalled();
        } finally {
            errors.mockRestore();
        }
        // An answer moves them.
        answer = () => some([item("approved"), item("pending")]) as never;
        rerender({ kinds: kindsNow() });
        expect(result.current).toEqual({ events: 2, backlog: undefined, toReview: 1, saved: undefined });
        // No event kinds: nothing to count, and nothing held.
        rerender({ kinds: [] });
        expect(result.current).toBeUndefined();
    });
});
