/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * The period a canvas's window hold falls back to (#1799): a coarser one than
 * its range and its plot give, taken for the range as it is where the finer
 * shows nothing of what is in view. It only ever goes coarser; it stands
 * while the range moves along — a pan, a step, the now rung, a brush dragged
 * along — and through a change of the plot's width; and a range of another
 * length, or a period pressed, is picked again on the plot. The rule that
 * names the period is `shared/schedule/fallback-period.test.ts`'s, the
 * controller's gestures over a hold `controller/controller.test.ts`'s, and a
 * page over e3 carries it through a Plan (`frame/plan-grouped-scale.dom.test.tsx`).
 */

import { describe, test, expect } from "vitest";
import { PLAN_UNLAID_PLOT } from "../geometry.js";
import type { PlanResolution } from "../scale.js";
import { createPlanWindowHold, type PlanWindowHold } from "./window.js";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
/** A UTC day's start, in ms. */
const at = (year: number, month: number, day: number): number => Date.UTC(year, month - 1, day);
/** Every period a time axis offers. */
const ALL: readonly PlanResolution[] = ["hour", "day", "week", "month", "quarter", "year"];
/** A wide screen's plot, in px: fifty-seven weeks hold the column floor on it. */
const WIDE = 2264;
/** Fifty-seven weeks on week edges, Monday 25 July 2022 to Monday 28 August 2023: they touch fourteen months. */
const FROM = at(2022, 7, 25);
const TO = at(2023, 8, 28);

/** A hold laid out on a plot, with a count of what it tells its render. */
function laid(plot: number): { hold: PlanWindowHold; told: () => number } {
    const hold = createPlanWindowHold();
    hold.layOut(plot);
    let told = 0;
    hold.subscribe(() => { told += 1; });
    return { hold, told: () => told };
}

/** A hold on the wide plot that fell back from weeks to months over the fifty-seven weeks. */
function fallen(): { hold: PlanWindowHold; told: () => number } {
    const made = laid(WIDE);
    expect(made.hold.periodFor(FROM, TO, ALL)).toBe("week");
    made.hold.fallBack("month");
    expect(made.hold.periodFor(FROM, TO, ALL)).toBe("month");
    return made;
}

describe("the period a window hold falls back to (#1799)", () => {
    test("a coarser period for the range as it is: the hold tells its render, and the range is none of its to move", () => {
        const { hold, told } = laid(WIDE);
        // The range and the plot give weeks: fifty-seven columns of forty pixels.
        expect(hold.periodFor(FROM, TO, ALL)).toBe("week");
        const version = hold.version;
        hold.fallBack("month");
        expect(told()).toBe(1);
        expect(hold.version).toBe(version + 1);
        expect(hold.periodFor(FROM, TO, ALL)).toBe("month");
        expect(hold.last).toBeUndefined();
    });

    test("only ever coarser: the period in use, a finer one, one the axis does not offer, or any before a range is shown changes nothing", () => {
        const { hold, told } = fallen();
        hold.fallBack("month");
        hold.fallBack("week");
        hold.fallBack("day");
        expect(told()).toBe(1);
        expect(hold.periodFor(FROM, TO, ALL)).toBe("month");
        // Coarser again, it falls back again.
        hold.fallBack("quarter");
        expect(told()).toBe(2);
        expect(hold.periodFor(FROM, TO, ALL)).toBe("quarter");

        const unoffered = laid(WIDE);
        const some: readonly PlanResolution[] = ["day", "week", "quarter"];
        expect(unoffered.hold.periodFor(FROM, TO, some)).toBe("week");
        unoffered.hold.fallBack("month");
        expect(unoffered.told()).toBe(0);
        expect(unoffered.hold.periodFor(FROM, TO, some)).toBe("week");

        const unshown = laid(WIDE);
        unshown.hold.fallBack("month");
        expect(unshown.told()).toBe(0);
        expect(unshown.hold.periodFor(FROM, TO, ALL)).toBe("week");
    });

    test("it stands while the range moves along: a pan, a step and the now rung shift whole columns of it, and a brush dragged along keeps its length", () => {
        const { hold, told } = fallen();
        // At months the scale draws July 2022 to August 2023 whole; a pan of one month writes the fourteen after it. The
        // plot alone would give each of these weeks.
        expect(hold.periodFor(at(2022, 8, 1), at(2023, 10, 1), ALL)).toBe("month");
        expect(hold.periodFor(at(2022, 11, 1), at(2024, 1, 1), ALL)).toBe("month");
        // The now rung: as many months, wherever now is.
        expect(hold.periodFor(at(2026, 9, 1), at(2027, 11, 1), ALL)).toBe("month");
        // A brush dragged along three days: as long, on no month's edge — and the pan after it, the fifteen months it touches.
        expect(hold.periodFor(at(2026, 9, 4), at(2027, 11, 4), ALL)).toBe("month");
        expect(hold.periodFor(at(2026, 10, 1), at(2028, 1, 1), ALL)).toBe("month");
        // Reading the period tells the render nothing: only the fallback did.
        expect(told()).toBe(1);
        // Without the fallback the same ranges are weeks.
        const plain = laid(WIDE);
        expect(plain.hold.periodFor(at(2022, 8, 1), at(2023, 10, 1), ALL)).toBe("week");
        expect(plain.hold.periodFor(at(2026, 9, 4), at(2027, 11, 4), ALL)).toBe("week");
    });

    test("a range of another length is the viewer's change of it: picked again on the plot, and the fallback is gone", () => {
        // A brush resized to twenty-seven weeks.
        const shorter = fallen();
        expect(shorter.hold.periodFor(FROM, FROM + 27 * WEEK, ALL)).toBe("week");
        // The fifty-seven weeks again are weeks: nothing remembers they fell back.
        expect(shorter.hold.periodFor(FROM, TO, ALL)).toBe("week");

        // Thirteen whole months are not the fourteen moved along.
        const fewer = fallen();
        expect(fewer.hold.periodFor(at(2022, 8, 1), at(2023, 9, 1), ALL)).toBe("week");

        // A week more at the start touches the same fourteen months, on no month's edge and no longer as long.
        const longer = fallen();
        expect(longer.hold.periodFor(FROM - WEEK, TO, ALL)).toBe("week");
    });

    test("at the edge of what a period holds, a range moved along and back keeps the fallback", () => {
        // On this plot fifty-seven weeks hold the column floor and fifty-eight do not.
        const { hold } = laid(1400);
        expect(hold.periodFor(FROM, TO, ALL)).toBe("week");
        expect(laid(1400).hold.periodFor(FROM + 3 * DAY, TO + 3 * DAY, ALL)).toBe("month");
        hold.fallBack("month");
        // Dragged three days on, the plot gives months itself; dragged back, weeks — and the fallback stands through both.
        expect(hold.periodFor(FROM + 3 * DAY, TO + 3 * DAY, ALL)).toBe("month");
        expect(hold.periodFor(FROM, TO, ALL)).toBe("month");
    });

    test("it gives way to a coarser period the plot gives the range moved along", () => {
        // Twenty weeks of days on a very wide plot, fallen back to weeks.
        const { hold, told } = laid(3600);
        const to = FROM + 20 * WEEK;
        expect(hold.periodFor(FROM, to, ALL)).toBe("day");
        hold.fallBack("week");
        // The plot narrows: twenty columns still hold the squeeze floor, so the period stands.
        hold.layOut(300);
        expect(told()).toBe(1);
        expect(hold.periodFor(FROM, to, ALL)).toBe("week");
        // A pan of a week: the plot as it is gives months, coarser than the fallback.
        expect(hold.periodFor(FROM + WEEK, to + WEEK, ALL)).toBe("month");
        // No fallback stands there: a period pressed has nothing to pick again.
        hold.pickAgain();
        expect(told()).toBe(1);
    });

    test("the plot's width never undoes it: not the first layout, nor one after — until its columns fall under the squeeze floor", () => {
        // Not laid out, thirty weeks are weeks on the plot a canvas weighs its window on.
        const hold = createPlanWindowHold();
        let told = 0;
        hold.subscribe(() => { told += 1; });
        const to = FROM + 30 * WEEK;
        expect(hold.plot).toBe(PLAN_UNLAID_PLOT);
        expect(hold.periodFor(FROM, to, ALL)).toBe("week");
        hold.fallBack("month");
        expect(told).toBe(1);
        // Its first layout picks the period again — weeks, on the wide plot — and the fallback stands.
        hold.layOut(WIDE);
        expect(hold.periodFor(FROM, to, ALL)).toBe("month");
        // Narrower, its eight months still hold the squeeze floor.
        hold.layOut(500);
        expect(hold.periodFor(FROM, to, ALL)).toBe("month");
        expect(told).toBe(1);
        // Under it, the period is the plot's: years, and the fallback is gone.
        hold.layOut(60);
        expect(hold.periodFor(FROM, to, ALL)).toBe("year");
        expect(told).toBe(2);
        hold.pickAgain();
        expect(told).toBe(2);
        expect(hold.periodFor(FROM, to, ALL)).toBe("year");
    });

    test("a period pressed is tried again: the period is picked on the plot anew, once", () => {
        const { hold, told } = fallen();
        hold.pickAgain();
        expect(told()).toBe(2);
        expect(hold.periodFor(FROM, TO, ALL)).toBe("week");
        hold.pickAgain();
        expect(told()).toBe(2);
        // With no fallback, nothing is picked again.
        const plain = laid(WIDE);
        expect(plain.hold.periodFor(FROM, TO, ALL)).toBe("week");
        plain.hold.pickAgain();
        expect(plain.told()).toBe(0);
    });

    test("other periods offered are another axis: the range is picked again among them", () => {
        const { hold } = fallen();
        expect(hold.periodFor(FROM, TO, ["day", "week", "month"])).toBe("week");
    });
});
