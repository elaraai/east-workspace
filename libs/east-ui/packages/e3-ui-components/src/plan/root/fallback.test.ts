/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * What the canvas does with its readers' notices (#1799): of those made at
 * the columns' period, the coarser period that shows them — taken by the
 * canvas's window hold before the frame paints, with nothing said — else the
 * one line naming what no period shows. Notices of another period are what
 * the readers handed on before the columns moved, and nothing is done or said
 * of them. The rule naming the period is `shared/schedule/fallback-period.test.ts`'s,
 * and a page over e3 carries it (`frame/plan-fallback.dom.test.tsx`).
 */

import { describe, test, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RecordTile } from "@elaraai/east-ui/internal";
import type { ScheduleCellNotice, ScheduleCellsRead } from "../../shared/schedule/cells.js";
import { planScale, type PlanResolution, type PlanScale } from "../scale.js";
import { initialEventLead, type PlanEventLead } from "./events.js";
import { NOTHING_OVER, planFallback, usePlanFallback } from "./fallback.js";
import type { PlanNestedLead, PlanNestedNotice } from "./nested.js";
import { createPlanWindowHold } from "./window.js";

/** Every period a time axis offers. */
const ALL: readonly PlanResolution[] = ["hour", "day", "week", "month", "quarter", "year"];
/** A kind shown nothing of: its notice, a summary shading it by the tiles given. */
const kind = (key: string, ...shades: RecordTile[]): ScheduleCellNotice => ({ kind: key, name: key, events: 10_001, shades });
/** A collection of the rows' own shown nothing of: its totals kept at the tiles given. */
const items = (...shades: RecordTile[]): PlanNestedNotice => ({ place: ["works"], items: 10_500, shades });

describe("what the canvas does with its readers' notices (#1799)", () => {
    test("notices of the columns' period that a coarser one shows: that period, and nothing said", () => {
        const done = planFallback("week", ALL, { notices: [kind("job", "month")], period: "week" }, { notices: [items("month")], period: "week" });
        expect(done.period).toBe("month");
        expect(done.over).toBe(NOTHING_OVER);
    });

    test("notices of another period are what the readers handed on before the columns moved: nothing is done, and nothing said", () => {
        // The columns fell back to months; the readers' last notices are the weeks'. Acted on, they would ask for quarters.
        const done = planFallback("month", ALL, { notices: [kind("job", "month")], period: "week" }, { notices: [items("month")], period: "week" });
        expect(done.period).toBeUndefined();
        expect(done.over).toBe(NOTHING_OVER);
    });

    test("what no coarser period offered shows is named, kinds and items alike, and the columns stay", () => {
        const job = kind("job");
        const works = items("day");
        // Days kept: no coarser period than the year shows anything.
        const done = planFallback("year", ALL, { notices: [job], period: "year" }, { notices: [works], period: "year" });
        expect(done.period).toBeUndefined();
        expect(done.over.kinds).toEqual([job]);
        expect(done.over.items).toEqual([works]);
        // A month's totals where the axis offers nothing past weeks.
        const unoffered = planFallback("day", ["day", "week"], { notices: [kind("job", "month")], period: "day" }, undefined);
        expect([unoffered.period, unoffered.over.kinds.length]).toEqual([undefined, 1]);
    });

    test("where one thing a coarser period shows sits beside one none does, the columns fall back and nothing is said yet: the next period's notices say what is left", () => {
        const done = planFallback("week", ALL, { notices: [kind("job", "month"), kind("stop")], period: "week" }, undefined);
        expect(done.period).toBe("month");
        expect(done.over).toBe(NOTHING_OVER);
    });

    test("on an axis of no periods nothing falls back, and what the readers name is said", () => {
        const works = items("day");
        const done = planFallback(undefined, [], undefined, { notices: [works], period: undefined });
        expect(done.period).toBeUndefined();
        expect(done.over.items).toEqual([works]);
    });

    test("no notice, or no reader: nothing, the one object", () => {
        expect(planFallback("week", ALL, undefined, undefined).over).toBe(NOTHING_OVER);
        expect(planFallback("week", ALL, { notices: [], period: "week" }, { notices: [], period: "week" }).over).toBe(NOTHING_OVER);
    });
});

describe("the canvas's fallback, through its window hold (#1799)", () => {
    /** Fifty-seven weeks on a wide plot: weeks, until a reader's notice asks for more. */
    const FROM = Date.UTC(2022, 6, 25);
    const TO = Date.UTC(2023, 7, 28);
    /** The scale the canvas draws with at a period, over that range. */
    const scaleAt = (period: PlanResolution): PlanScale =>
        planScale({ kind: "time", window: { min: new Date(FROM), max: new Date(TO) }, resolution: period }) as PlanScale;
    /** The event kinds' lead, its cells' notices read for the period given. */
    const leadOf = (notices: readonly ScheduleCellNotice[], period: PlanResolution): PlanEventLead =>
        ({ ...initialEventLead(), cells: { notices } as unknown as ScheduleCellsRead, cellsPeriod: period });

    test("the hold takes the period before the frame paints, and the frame is handed the same nothing while the notices hold; once the readers read at it, nothing more", () => {
        const hold = createPlanWindowHold();
        hold.layOut(2264);
        expect(hold.periodFor(FROM, TO, ALL)).toBe("week");
        const notices = [kind("job", "month")];
        const nested = { notices: [] as readonly PlanNestedNotice[], resolution: "week" } as unknown as PlanNestedLead;
        const { result, rerender } = renderHook(({ scale, lead }) => usePlanFallback(scale, ALL, lead, nested, hold),
            { initialProps: { scale: scaleAt("week"), lead: leadOf(notices, "week") } });
        expect(result.current).toBe(NOTHING_OVER);
        expect(hold.periodFor(FROM, TO, ALL)).toBe("month");
        // The canvas's next render: months, the readers' last lead still the weeks'. Nothing more is asked of the hold.
        rerender({ scale: scaleAt("month"), lead: leadOf(notices, "week") });
        expect(result.current).toBe(NOTHING_OVER);
        expect(hold.periodFor(FROM, TO, ALL)).toBe("month");
        // The readers read at months: the summary shades the job there, and gives no notice.
        rerender({ scale: scaleAt("month"), lead: leadOf([], "month") });
        expect(result.current).toBe(NOTHING_OVER);
        expect(hold.periodFor(FROM, TO, ALL)).toBe("month");
    });

    test("what no period shows is handed to the frame, the same object while the readers' notices are the same array", () => {
        const hold = createPlanWindowHold();
        hold.layOut(2264);
        expect(hold.periodFor(FROM, TO, ALL)).toBe("week");
        const notices = [kind("job")];
        const { result, rerender } = renderHook(({ lead }) => usePlanFallback(scaleAt("week"), ALL, lead, undefined, hold),
            { initialProps: { lead: leadOf(notices, "week") } });
        const said = result.current;
        expect(said.kinds).toEqual(notices);
        // Another lead holding the same notices: the same line, and the columns stay weeks.
        rerender({ lead: { ...leadOf(notices, "week"), version: 2 } });
        expect(result.current).toBe(said);
        expect(hold.periodFor(FROM, TO, ALL)).toBe("week");
    });
});
