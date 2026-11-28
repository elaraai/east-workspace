/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the schedule's modules load east-ui-components'
 * entry, which needs one as it loads (#1177).
 *
 * The period a host's columns fall back to where the one its range gave shows
 * nothing of what is in view (#1799): the finest coarser period offered that
 * a summary's tile divides. The hold that follows it is `plan/root/window.test.ts`'s,
 * and a page over e3 carries it through a Plan
 * (`plan/frame/plan-grouped-scale.dom.test.tsx`).
 */

import { describe, test, expect } from "vitest";
import type { RecordTile } from "@elaraai/east-ui/internal";
import type { TimeResolution } from "../time/scale.js";
import { scheduleFallbackPeriod } from "./fallback-period.js";

/** Every period a time axis offers. */
const ALL: readonly TimeResolution[] = ["hour", "day", "week", "month", "quarter", "year"];
/** One thing a reader shows nothing of: the tiles a summary shades it by. */
const kept = (...tiles: RecordTile[]): readonly RecordTile[] => tiles;

describe("the period a host's columns fall back to (#1799)", () => {
    test("weeks that a month's summary cannot shade take months: the finest coarser period its tile divides", () => {
        expect(scheduleFallbackPeriod("week", ALL, [kept("month")])).toBe("month");
        // A day's columns go to months too: an ISO week is cut by a month's end, so a month's totals shade no week.
        expect(scheduleFallbackPeriod("day", ALL, [kept("month")])).toBe("month");
        expect(scheduleFallbackPeriod("hour", ALL, [kept("month")])).toBe("month");
    });

    test("only ever coarser: never the period in use, though its tile divides it, and none past the coarsest", () => {
        // A reader names a thing it shows nothing of at the period in use, so that period is never the answer.
        expect(scheduleFallbackPeriod("month", ALL, [kept("month")])).toBe("quarter");
        expect(scheduleFallbackPeriod("quarter", ALL, [kept("day")])).toBe("year");
        expect(scheduleFallbackPeriod("year", ALL, [kept("day"), kept("year")])).toBeUndefined();
    });

    test("a week's summary shades weeks alone, and a day's every period", () => {
        expect(scheduleFallbackPeriod("day", ALL, [kept("week")])).toBe("week");
        // Past weeks, no coarser period is cut into whole weeks.
        expect(scheduleFallbackPeriod("week", ALL, [kept("week")])).toBeUndefined();
        expect(scheduleFallbackPeriod("month", ALL, [kept("week")])).toBeUndefined();
        expect(scheduleFallbackPeriod("hour", ALL, [kept("day")])).toBe("day");
        expect(scheduleFallbackPeriod("week", ALL, [kept("day")])).toBe("month");
    });

    test("of the tiles a summary shades a thing by, any that divides a period shows it there", () => {
        // Kept by the week and by the quarter: weeks from days, and from months — which neither divides — quarters.
        expect(scheduleFallbackPeriod("day", ALL, [kept("week", "quarter")])).toBe("week");
        expect(scheduleFallbackPeriod("month", ALL, [kept("week", "quarter")])).toBe("quarter");
    });

    test("only the periods offered, in whatever order they are given", () => {
        expect(scheduleFallbackPeriod("week", ["year", "week", "day", "quarter"], [kept("month")])).toBe("quarter");
        expect(scheduleFallbackPeriod("week", ["day", "week"], [kept("month")])).toBeUndefined();
        expect(scheduleFallbackPeriod("week", [], [kept("month")])).toBeUndefined();
    });

    test("several things: the finest period that shows them all", () => {
        // One kept by the month, one by the quarter: months show only the first, quarters both.
        expect(scheduleFallbackPeriod("week", ALL, [kept("month"), kept("quarter")])).toBe("quarter");
        expect(scheduleFallbackPeriod("week", ALL, [kept("month"), kept("month")])).toBe("month");
    });

    test("a thing no summary shades asks for no period, and holds no other back", () => {
        expect(scheduleFallbackPeriod("week", ALL, [kept()])).toBeUndefined();
        expect(scheduleFallbackPeriod("week", ALL, [])).toBeUndefined();
        expect(scheduleFallbackPeriod("week", ALL, [kept(), kept("month")])).toBe("month");
    });

    test("where no one period shows them all, the finest that shows any — and from there it comes to rest", () => {
        // One kept by the week alone, one by the month alone: no period is cut into both.
        const week = kept("week");
        const month = kept("month");
        expect(scheduleFallbackPeriod("day", ALL, [week, month])).toBe("week");
        // At weeks the first shows, and the second asks for months; at months the first asks for a period none is.
        expect(scheduleFallbackPeriod("week", ALL, [month])).toBe("month");
        expect(scheduleFallbackPeriod("month", ALL, [week])).toBeUndefined();
    });
});
