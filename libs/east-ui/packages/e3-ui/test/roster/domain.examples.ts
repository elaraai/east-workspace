/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, FloatType, IntegerType, SortedMap, compareFor, example, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Roster } from "@elaraai/e3-ui";

/** Small staffing fixture with independently calculable hours and cost. */
export const context: ValueTypeOf<typeof Roster.Types.Context> = {
    people: new Map([
        ["lead", { key: "lead", name: "Lead", group: "goods", position: "lead", skills: new Set(["reach"]), contract: 40, agency: false, trainer: true, trainee: false, usual: some("early") }],
        ["agency", { key: "agency", name: "Agency", group: "goods", position: "crew", skills: new Set<string>(), contract: 0, agency: true, trainer: false, trainee: false, usual: none }],
        ["off", { key: "off", name: "Off", group: "goods", position: "crew", skills: new Set<string>(), contract: 40, agency: false, trainer: false, trainee: false, usual: none }],
    ]),
    groups: [{ key: "goods", label: "Goods", skills: [{ key: "reach", label: "Reach truck", code: "RT" }] }],
    duties: [{ key: "general", label: "General duties", code: "GD" }],
    shifts: [{ key: "early", label: "Early", code: "E", start: { hour: 6n, minute: 0n }, hours: 8 }, { key: "night", label: "Night", code: "N", start: { hour: 22n, minute: 0n }, hours: 8 }],
    positions: [{ key: "crew", label: "Crew", code: "", lead: false }, { key: "lead", label: "Lead", code: "SV", lead: true }],
    agencies: [{ key: "agency", name: "Staffing agency" }],
    rules: { rest: 10, lead: true, skill: true, trainer: true, agree: true },
    costs: some({ currency: "AUD", rates: { permanent: 42, overtime: 63, agency: 51 }, budget: none }),
};
export const slot = { day: 0n, group: "goods", shift: "early" };
export const week: ValueTypeOf<typeof Roster.Types.Week> = {
    status: variant("draft", null), dismissed: new Set<string>(),
    assignments: new Map([
        ["a", { slot, who: variant("person", "lead"), position: "lead", activity: some("reach"), offset: 1, overtime: 2, agreed: none }],
        ["b", { slot, who: variant("person", "agency"), position: "crew", activity: some("general"), offset: 0, overtime: 0, agreed: none }],
        ["c", { slot, who: variant("request", "agency"), position: "crew", activity: none, offset: 0, overtime: 0, agreed: none }],
    ]),
    requirements: new SortedMap([[slot, { positions: 4n, hours: new Map([["reach", 24], ["general", 6]]) }]], compareFor(Roster.Types.Slot)),
};

export const rosterCoverage = example({
    description: "Coverage separates named staff, requested positions, nominal skill capacity, assigned activity hours and overtime cost",
    keywords: ["Roster", "Roster.coverage", "coverage", "skills", "agency", "cost"], inputs: [week, context],
    fn: East.function([Roster.Types.Week, Roster.Types.Context], Roster.Types.Coverage, ($, week, context) => {
        const coverage = $.const(Roster.coverage); return coverage(week, context).get(slot);
    }),
    returns: { positions: 4n, filled: 3n, open: 1n, people: 2n,
        hours: { permanent: 8, agency: 8, overtime: 2, requested: 8, needed: 30, rostered: 26 },
        lines: [{ skill: "reach", needed: 24, holders: some(1n), capacity: some(8), gap: 16, assigned: 10 },
            { skill: "general", needed: 6, holders: none, capacity: none, gap: 0, assigned: 8 }],
        cost: 1278, lead: true, trainer: true },
});
export const rosterChecks = example({
    description: "Built-in checks report an open position, a skill-capacity gap and unagreed changed hours",
    keywords: ["Roster", "Roster.check", "issues", "fix"], inputs: [week, context], returns: 3n,
    fn: East.function([Roster.Types.Week, Roster.Types.Context], IntegerType, ($, week, context) => {
        const check = $.const(Roster.check); return check(week, context).size();
    }),
});
export const rosterWeeklyHours = example({
    description: "Weekly hours include overtime without shortening the shift for a later start",
    keywords: ["Roster", "Roster.weekHours", "offset", "overtime"], inputs: [week, context], returns: 10,
    fn: East.function([Roster.Types.Week, Roster.Types.Context], FloatType, ($, week, context) => {
        const hours = $.const(Roster.weekHours); return hours(week, context).get("lead");
    }),
});
export const rosterRest = example({
    description: "A night shift with overtime leaves only six hours before the following late shift",
    keywords: ["Roster", "Roster.rest", "rest", "overnight", "overtime"], inputs: [context], returns: 6,
    fn: East.function([Roster.Types.Context], FloatType, ($, context) => {
        const rest = $.const(Roster.rest);
        const prior = $.const({ status: variant("draft", null), dismissed: new Set<string>(), requirements: new Map(), assignments: new Map([
            ["night", { slot: { day: 0n, group: "goods", shift: "night" }, who: variant("person", "lead"), position: "lead", activity: none, offset: 0, overtime: 2, agreed: some(true) }],
        ]) }, Roster.Types.Week);
        return rest({ slot: { day: 1n, group: "goods", shift: "early" }, who: variant("person", "lead"), position: "lead", activity: none, offset: 8, overtime: 0, agreed: none }, "next", prior, context).before;
    }),
});
