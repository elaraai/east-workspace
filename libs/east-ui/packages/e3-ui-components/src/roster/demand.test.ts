/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The People layout's work requirement (#1568) over a span's coverage — a week's, or a month's weeks: a lane a shift a
 * target of the scope names in any week, in the shifts' order; its days' and its span's hours its slots' summed over the
 * scope's groups, what each slot is short summed so that no slot's surplus nets another's shortfall (K4); its skill rows
 * in the activities' order; the scope's figures each day, each week and over the span, every one of its slots counted, a
 * shift with no target's too; a month's marks and how far each fills as a cup; a difference's figure and tone; and a
 * shift's day summed across the groups, as the inspector draws it.
 */
import { describe, expect, test } from "vitest";
import { SortedMap, StringType, compareFor, none, printFor, some, type option } from "@elaraai/east";
import { RosterCoverageType } from "@elaraai/e3-ui/internal";
import { compareSlot, type Coverage, type Requirement, type RosterValue, type Slot } from "./model.js";
import { demandOf, difference, laneCup, laneMark, signed, skillCup, skillMark, summedCoverage, toneOf } from "./demand.js";

const byString = compareFor(StringType);
const printCoverage = printFor(RosterCoverageType);
const shift = (key: string, label: string, hour: bigint): RosterValue["shifts"][number] =>
    ({ key, label, code: label.slice(0, 1), start: { hour, minute: 0n }, hours: 8, color: none });
/** What the work requirement reads of the payload: its shifts and its activities, each in its order. */
const value: Pick<RosterValue, "shifts" | "activities"> = {
    shifts: [shift("early", "Early", 6n), shift("late", "Late", 14n), shift("night", "Night", 22n)],
    activities: [
        { key: "pick", label: "Order picking", code: "OP", group: some("picking") },
        { key: "unload", label: "Unloading", code: "UL", group: some("inbound") },
        { key: "general", label: "General duties", code: "GD", group: none },
    ],
};
const slot = (day: number, group: string, shift: string): Slot => ({ day: BigInt(day), group, shift });
const target = (positions: bigint, hours: [string, number][]): Requirement => ({ positions, hours: new SortedMap(hours, byString) });
/** A skill's line of a slot's coverage: what it needs and has, short by the rest. */
function line(skill: string, needed: number, assigned: number, holders: option<bigint> = none, capacity: option<number> = none): Coverage["lines"][number] {
    return { skill, needed, assigned, gap: Math.max(0, needed - assigned), holders, capacity };
}
/** A slot's coverage: its hours needed and rostered — the requests' part of them given — and its skills' lines. */
function covered(needed: number, rostered: number, lines: Coverage["lines"] = [], requested = 0): Coverage {
    return {
        positions: 2n, filled: 2n, open: 0n, people: 2n, cost: 0, lead: false, trainer: false, lines,
        hours: { permanent: rostered - requested, agency: 0, requested, needed, rostered },
    };
}

/**
 * Monday's Early: Picking 4 hours short, Inbound 6 over; Tuesday's Early, Picking exact, half of it requested; Monday's
 * Late rostered with no target; the Night no slot at all.
 */
const requirements = new SortedMap<Slot, Requirement>([
    [slot(1, "picking", "early"), target(2n, [["pick", 16]])],
    [slot(1, "inbound", "early"), target(1n, [["unload", 8]])],
    [slot(2, "picking", "early"), target(1n, [["pick", 8]])],
], compareSlot);
const coverage = new SortedMap<Slot, Coverage>([
    [slot(1, "picking", "early"), covered(16, 12, [line("pick", 16, 12, some(3n), some(24))])],
    [slot(1, "inbound", "early"), covered(8, 14, [line("unload", 8, 14)])],
    [slot(2, "picking", "early"), covered(8, 8, [line("pick", 8, 8)], 4)],
    [slot(1, "picking", "late"), covered(0, 8)],
], compareSlot);
const NONE = { target: false, needed: 0, rostered: 0, permanent: 0, agency: 0, requested: 0, short: 0, shortSlots: 0 };

describe("a scope's work requirement over a week", () => {
    test("every group's: a lane a shift a target names, each day's hours its groups' slots summed, short as each slot is short", () => {
        const both = demandOf(value, [{ requirements, coverage }], ["inbound", "picking"]);
        expect(both.lanes.map(lane => lane.shift.key)).toEqual(["early"]);
        const early = both.lanes[0]!;
        // Monday: 26 hours rostered of 24 needed, yet Picking's 4 short stand: Inbound's 6 over net none of them (K4).
        expect(early.days[1]).toEqual({ target: true, needed: 24, rostered: 26, permanent: 26, agency: 0, requested: 0, short: 4, shortSlots: 1 });
        // Tuesday: exact, the requests' hours rostered among them.
        expect(early.days[2]).toEqual({ target: true, needed: 8, rostered: 8, permanent: 4, agency: 0, requested: 4, short: 0, shortSlots: 0 });
        // Sunday: no slot of the shift has a target.
        expect(early.days[0]).toEqual(NONE);
        expect(early.total).toEqual({ target: true, needed: 32, rostered: 34, permanent: 30, agency: 0, requested: 4, short: 4, shortSlots: 1 });
        // The scope's own figures count every slot of it, the Late's with no target too, as the Shifts layout's band does.
        expect(both.days[1]).toEqual({ target: true, needed: 24, rostered: 34, permanent: 34, agency: 0, requested: 0, short: 4, shortSlots: 1 });
        expect(both.total).toEqual({ target: true, needed: 32, rostered: 42, permanent: 38, agency: 0, requested: 4, short: 4, shortSlots: 1 });
    });

    test("a lane's skill rows: each skill its slots' lines need, summed each day, in the activities' order, a day none of its slots needs it empty", () => {
        const [early] = demandOf(value, [{ requirements, coverage }], ["inbound", "picking"]).lanes;
        expect(early!.skills.map(skill => skill.skill)).toEqual(["pick", "unload"]);
        expect(early!.skills[0]!.days).toEqual([undefined, { needed: 16, assigned: 12 }, { needed: 8, assigned: 8 }, undefined, undefined, undefined, undefined]);
        expect(early!.skills[0]!.total).toEqual({ needed: 24, assigned: 20 });
        expect(early!.skills[1]!.total).toEqual({ needed: 8, assigned: 14 });
    });

    test("a band's: its own group's slots alone", () => {
        const picking = demandOf(value, [{ requirements, coverage }], ["picking"]);
        expect(picking.lanes.map(lane => lane.shift.key)).toEqual(["early"]);
        expect(picking.lanes[0]!.days[1]).toEqual({ target: true, needed: 16, rostered: 12, permanent: 12, agency: 0, requested: 0, short: 4, shortSlots: 1 });
        expect(picking.lanes[0]!.skills.map(skill => skill.skill)).toEqual(["pick"]);
        const inbound = demandOf(value, [{ requirements, coverage }], ["inbound"]);
        expect(inbound.lanes[0]!.total).toEqual({ target: true, needed: 8, rostered: 14, permanent: 14, agency: 0, requested: 0, short: 0, shortSlots: 0 });
    });

    test("lanes in the shifts' order, whatever order the targets are in; a week naming no target, no lane", () => {
        const late = new SortedMap<Slot, Requirement>([...requirements, [slot(1, "picking", "late"), target(1n, [["pick", 8]])]], compareSlot);
        expect(demandOf(value, [{ requirements: late, coverage }], ["inbound", "picking"]).lanes.map(lane => lane.shift.key)).toEqual(["early", "late"]);
        const untargeted = demandOf(value, [{ requirements: new SortedMap<Slot, Requirement>([], compareSlot), coverage }], ["inbound", "picking"]);
        expect(untargeted.lanes).toEqual([]);
        expect(untargeted.total.target).toBe(false);
    });
});

/** The next week: Wednesday's Late, Picking 4 hours short of its 8. */
const nextRequirements = new SortedMap<Slot, Requirement>([[slot(3, "picking", "late"), target(1n, [["pick", 8]])]], compareSlot);
const nextCoverage = new SortedMap<Slot, Coverage>([[slot(3, "picking", "late"), covered(8, 4, [line("pick", 8, 4)])]], compareSlot);

describe("a scope's work requirement over a month's weeks", () => {
    const month = demandOf(value, [{ requirements, coverage }, { requirements: nextRequirements, coverage: nextCoverage }], ["inbound", "picking"]);
    test("a lane a shift any week's targets name, its days seven a week; a week naming none of its targets, untargeted days", () => {
        expect(month.lanes.map(lane => lane.shift.key)).toEqual(["early", "late"]);
        const [early, late] = month.lanes;
        expect(early!.days).toHaveLength(14);
        expect(early!.days.slice(7)).toEqual(Array.from({ length: 7 }, () => NONE));
        expect(early!.total).toEqual({ target: true, needed: 32, rostered: 34, permanent: 30, agency: 0, requested: 4, short: 4, shortSlots: 1 });
        // The first week's Monday Late: rostered with no target; the next week's Wednesday, short.
        expect(late!.days[1]).toEqual({ target: false, needed: 0, rostered: 8, permanent: 8, agency: 0, requested: 0, short: 0, shortSlots: 0 });
        expect(late!.days[7 + 3]).toEqual({ target: true, needed: 8, rostered: 4, permanent: 4, agency: 0, requested: 0, short: 4, shortSlots: 1 });
        expect(late!.total).toEqual({ target: true, needed: 8, rostered: 12, permanent: 12, agency: 0, requested: 0, short: 4, shortSlots: 1 });
        expect(late!.skills.map(skill => skill.skill)).toEqual(["pick"]);
        expect(late!.skills[0]!.days.flatMap((day, i) => day === undefined ? [] : [[i, day]])).toEqual([[10, { needed: 8, assigned: 4 }]]);
        expect(late!.skills[0]!.total).toEqual({ needed: 8, assigned: 4 });
    });
    test("each week's figures the scope's that week; the span's their sum, each slot short its own", () => {
        expect(month.days).toHaveLength(14);
        expect(month.weeks).toEqual([
            demandOf(value, [{ requirements, coverage }], ["inbound", "picking"]).total,
            { target: true, needed: 8, rostered: 4, permanent: 4, agency: 0, requested: 0, short: 4, shortSlots: 1 },
        ]);
        expect(month.total).toEqual({ target: true, needed: 40, rostered: 46, permanent: 42, agency: 0, requested: 4, short: 8, shortSlots: 2 });
    });
});

describe("a month's marks", () => {
    const [early] = demandOf(value, [{ requirements, coverage }], ["inbound", "picking"]).lanes;
    test("a lane's day: off with no target, covered over or exact, requested where requests make up part of its hours, short by its difference", () => {
        expect(laneMark(early!.days[0]!)).toEqual({ state: "off", difference: 0 });
        expect(laneMark(early!.days[1]!)).toEqual({ state: "covered", difference: 2 });
        expect(laneMark(early!.days[2]!)).toEqual({ state: "requested", difference: 0 });
        expect(laneMark({ ...early!.days[1]!, rostered: 20, permanent: 20 })).toEqual({ state: "short", difference: -4 });
        // Short with requests among its hours is short: the requests do not cover it.
        expect(laneMark({ ...early!.days[2]!, rostered: 6, requested: 2 })).toEqual({ state: "short", difference: -2 });
    });
    test("a skill's day: off where none of its slots needs it, short by its difference, else covered", () => {
        expect(skillMark(undefined)).toEqual({ state: "off", difference: 0 });
        expect(skillMark({ needed: 16, assigned: 12 })).toEqual({ state: "short", difference: -4 });
        expect(skillMark({ needed: 8, assigned: 14 })).toEqual({ state: "covered", difference: 6 });
        expect(skillMark({ needed: 8, assigned: 8 })).toEqual({ state: "covered", difference: 0 });
    });
});

describe("a month's cups (ruled 8 Nov 2026)", () => {
    const [early] = demandOf(value, [{ requirements, coverage }], ["inbound", "picking"]).lanes;
    const empty = { permanent: 0, agency: 0, fill: 0 };
    test("a lane's day: empty with no target, or with no hours; short, filled to its hours rostered of needed, the permanent staff's, agency staff's and the requests' stacked from the bottom; covered or over, full, its parts in proportion", () => {
        // Sunday: no target. Monday's Late: rostered, but with no target.
        expect(laneCup(early!.days[0]!)).toEqual(empty);
        expect(laneCup({ ...NONE, rostered: 8, permanent: 8 })).toEqual(empty);
        // A target needing no hours, none rostered.
        expect(laneCup({ ...NONE, target: true })).toEqual(empty);
        // Monday: 26 hours rostered of 24, every one the permanent staff's.
        expect(laneCup(early!.days[1]!)).toEqual({ permanent: 1, agency: 1, fill: 1 });
        // Tuesday: exact, half of it requested: the requests the top half.
        expect(laneCup(early!.days[2]!)).toEqual({ permanent: 0.5, agency: 0.5, fill: 1 });
        // Short: 6 permanent, 3 agency and 3 requested of 16 needed.
        expect(laneCup({ ...early!.days[1]!, needed: 16, rostered: 12, permanent: 6, agency: 3, requested: 3 })).toEqual({ permanent: 0.375, agency: 0.5625, fill: 0.75 });
        // Over: 10 permanent, 6 agency and 4 requested of 16 needed — full, each part its share of the 20 rostered.
        expect(laneCup({ ...early!.days[1]!, needed: 16, rostered: 20, permanent: 10, agency: 6, requested: 4 })).toEqual({ permanent: 0.5, agency: 0.8, fill: 1 });
    });
    test("a skill's day: empty where none of its slots needs it; filled to its hours assigned of needed, full at them and over; full where its slots need none of it", () => {
        expect(skillCup(undefined)).toEqual(empty);
        expect(skillCup({ needed: 16, assigned: 12 })).toEqual({ permanent: 0.75, agency: 0.75, fill: 0.75 });
        expect(skillCup({ needed: 8, assigned: 8 })).toEqual({ permanent: 1, agency: 1, fill: 1 });
        expect(skillCup({ needed: 8, assigned: 14 })).toEqual({ permanent: 1, agency: 1, fill: 1 });
        expect(skillCup({ needed: 0, assigned: 4 })).toEqual({ permanent: 1, agency: 1, fill: 1 });
    });
});

describe("a difference's figure and tone", () => {
    const number = new Intl.NumberFormat("en-US").format;
    test("a hair either side of zero is none; short is the warning's, over muted, exact positive", () => {
        expect(difference(8 + 1e-9, 8)).toBe(0);
        expect(difference(4, 10)).toBe(-6);
        expect([toneOf(-6), toneOf(0), toneOf(4)]).toEqual(["short", "exact", "over"]);
    });
    test("a figure: `+4`, `−6` with a true minus, nothing at zero — or the band's `+0`", () => {
        expect([signed(number, 4), signed(number, -6), signed(number, 1.5), signed(number, 0), signed(number, 1e-9)]).toEqual(["+4", "−6", "+1.5", "", ""]);
        expect(signed(number, 0, "+0")).toBe("+0");
    });
});

describe("a shift's day across the groups", () => {
    test("positions, people, hours and cost added, a lead or a trainer where any slot has one, each skill's line summed in the activities' order, its holders and capacity where any slot counts them", () => {
        const picking: Coverage = {
            positions: 3n, filled: 2n, open: 1n, people: 2n, cost: 120, lead: true, trainer: false,
            hours: { permanent: 12, agency: 0, requested: 0, needed: 16, rostered: 12 },
            lines: [line("unload", 8, 4, some(2n), some(16)), line("general", 8, 8)],
        };
        const inbound: Coverage = {
            positions: 1n, filled: 2n, open: 0n, people: 1n, cost: 80, lead: false, trainer: true,
            hours: { permanent: 8, agency: 4, requested: 2, needed: 8, rostered: 14 },
            lines: [line("pick", 8, 14, some(1n)), line("unload", 4, 0, none, some(8))],
        };
        expect(printCoverage(summedCoverage(value, [picking, inbound]))).toBe(printCoverage({
            positions: 4n, filled: 4n, open: 1n, people: 3n, cost: 200, lead: true, trainer: true,
            hours: { permanent: 20, agency: 4, requested: 2, needed: 24, rostered: 26 },
            lines: [line("pick", 8, 14, some(1n)), line("unload", 12, 4, some(2n), some(24)), line("general", 8, 8)],
        }));
        expect(printCoverage(summedCoverage(value, []))).toBe(printCoverage({
            positions: 0n, filled: 0n, open: 0n, people: 0n, cost: 0, lead: false, trainer: false,
            hours: { permanent: 0, agency: 0, requested: 0, needed: 0, rostered: 0 }, lines: [],
        }));
    });
    test("its hours are the lane's day's: both sum the same slots", () => {
        const [early] = demandOf(value, [{ requirements, coverage }], ["inbound", "picking"]).lanes;
        const monday = summedCoverage(value, [coverage.get(slot(1, "inbound", "early"))!, coverage.get(slot(1, "picking", "early"))!]);
        expect([monday.hours.needed, monday.hours.rostered, monday.hours.requested]).toEqual([early!.days[1]!.needed, early!.days[1]!.rostered, early!.days[1]!.requested]);
    });
});
