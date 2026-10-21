/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import {
    DateTimeType, East, FloatType, IntegerType, SortedMap, StringType, StructType, VariantType, compareFor, example, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Roster } from "@elaraai/e3-ui";

/** A duty of the app's own: who — one of its staff, or an agency asked to send someone — its own times, and a note the Roster carries but never reads. */
export const DomainDuty = StructType({
    who: VariantType({ staff: StringType, agency: StringType }), start: DateTimeType, end: DateTimeType, note: StringType,
});
/** A week of the app's duties, as the Roster reads it. */
export const DomainWeek = Roster.Types.Week(DomainDuty);

/** Small staffing fixture with independently calculable hours and cost. */
export const context: ValueTypeOf<typeof Roster.Types.Context> = {
    people: new Map([
        ["lead", { key: "lead", name: "Lead", group: "goods", position: "lead", skills: new Set(["reach"]), contract: 40, agency: false, trainer: true, trainee: false, usual: some("early") }],
        ["agency", { key: "agency", name: "Agency", group: "goods", position: "crew", skills: new Set<string>(), contract: 0, agency: true, trainer: false, trainee: false, usual: none }],
        ["off", { key: "off", name: "Off", group: "goods", position: "crew", skills: new Set<string>(), contract: 40, agency: false, trainer: false, trainee: false, usual: none }],
    ]),
    groups: [{ key: "goods", label: "Goods" }],
    // Goods' one skill, and the duty every group shares.
    activities: [{ key: "reach", label: "Reach truck", code: "RT", group: some("goods") }, { key: "general", label: "General duties", code: "GD", group: none }],
    shifts: [
        { key: "early", label: "Early", code: "E", start: { hour: 6n, minute: 0n }, hours: 8 },
        { key: "late", label: "Late", code: "L", start: { hour: 14n, minute: 0n }, hours: 8 },
        { key: "night", label: "Night", code: "N", start: { hour: 22n, minute: 0n }, hours: 8 },
    ],
    positions: [{ key: "crew", label: "Crew", code: "", lead: false }, { key: "lead", label: "Lead", code: "SV", lead: true }],
    agencies: [{ key: "agency", name: "Staffing agency" }],
    rules: { rest: 10, lead: true, skill: true, trainer: true },
};
/** The week's first day, Sunday 5 March 2028. */
export const start = new Date("2028-03-05T00:00:00Z");
export const slot = { day: 0n, group: "goods", shift: "early" };
/** Sunday's early shift: the lead in an hour late and on to 17:00, an agency's worker, and a request to the agency. */
export const week: ValueTypeOf<typeof DomainWeek> = {
    status: variant("draft", null), dismissed: new Set<string>(),
    assignments: new Map([
        ["a", { slot, who: variant("person", "lead"), position: "lead", activity: some("reach"),
            start: new Date("2028-03-05T07:00:00Z"), end: new Date("2028-03-05T17:00:00Z"), hours: 10,
            row: { who: variant("staff", "lead"), start: new Date("2028-03-05T07:00:00Z"), end: new Date("2028-03-05T17:00:00Z"), note: "in late, stays on" } }],
        ["b", { slot, who: variant("person", "agency"), position: "crew", activity: some("general"),
            start: new Date("2028-03-05T06:00:00Z"), end: new Date("2028-03-05T14:00:00Z"), hours: 8,
            row: { who: variant("staff", "agency"), start: new Date("2028-03-05T06:00:00Z"), end: new Date("2028-03-05T14:00:00Z"), note: "" } }],
        ["c", { slot, who: variant("request", "agency"), position: "crew", activity: none,
            start: new Date("2028-03-05T06:00:00Z"), end: new Date("2028-03-05T14:00:00Z"), hours: 8,
            row: { who: variant("agency", "agency"), start: new Date("2028-03-05T06:00:00Z"), end: new Date("2028-03-05T14:00:00Z"), note: "" } }],
    ]),
    requirements: new SortedMap([[slot, { positions: 4n, hours: new Map([["reach", 24], ["general", 6]]) }]], compareFor(Roster.Types.Slot)),
};
/** The app's pay for the week, by its own codes: the lead's eight ordinary hours and two of overtime, and the agency's sixteen. */
export const pay: ValueTypeOf<typeof Roster.Types.Pay> = new Map([
    ["a", new Map([["ORD", 336], ["OT1", 126]])], ["b", new Map([["AGENCY", 408]])], ["c", new Map([["AGENCY", 408]])],
]);

export const rosterCoverage = example({
    description: "Coverage over the app's own duties: named staff, requested positions, nominal skill capacity, each duty's own hours, and the slot's cost, the app's pay summed",
    keywords: ["Roster", "Roster.coverage", "coverage", "skills", "agency", "cost", "pay"], inputs: [week, context, pay],
    fn: East.function([DomainWeek, Roster.Types.Context, Roster.Types.Pay], Roster.Types.Coverage, ($, week, context, pay) => {
        const coverage = $.const(Roster.coverage(DomainDuty));
        return coverage(week, context, pay).get(slot);
    }),
    returns: { positions: 4n, filled: 3n, open: 1n, people: 2n,
        hours: { permanent: 10, agency: 8, requested: 8, needed: 30, rostered: 26 },
        lines: [{ skill: "reach", needed: 24, holders: some(1n), capacity: some(8), gap: 16, assigned: 10 },
            { skill: "general", needed: 6, holders: none, capacity: none, gap: 0, assigned: 8 }],
        cost: 1278, lead: true, trainer: true },
});
export const rosterChecks = example({
    description: "Built-in checks report an open position and a skill-capacity gap; a lead holds the slot, and the duties' own times ask for no agreement",
    keywords: ["Roster", "Roster.check", "issues", "fix"], inputs: [week, context], returns: 2n,
    fn: East.function([DomainWeek, Roster.Types.Context], IntegerType, ($, week, context) => {
        const check = $.const(Roster.check(DomainDuty));
        return check(week, context).size();
    }),
});
export const rosterWeeklyHours = example({
    description: "A person's week counts each duty's own hours: the lead's 07:00–17:00 counts ten",
    keywords: ["Roster", "Roster.weekHours", "hours"], inputs: [week, context], returns: 10,
    fn: East.function([DomainWeek, Roster.Types.Context], FloatType, ($, week, context) => {
        const hours = $.const(Roster.weekHours(DomainDuty));
        return hours(week, context).get("lead");
    }),
});
export const rosterRest = example({
    description: "A night duty that runs on to 08:00 leaves only six hours before the next day's late shift",
    keywords: ["Roster", "Roster.rest", "rest", "overnight"], inputs: [context], returns: 6,
    fn: East.function([Roster.Types.Context], FloatType, ($, context) => {
        const rest = $.const(Roster.rest(DomainDuty));
        const night = $.const({ who: variant("staff", "lead"), start: new Date("2028-03-05T22:00:00Z"), end: new Date("2028-03-06T08:00:00Z"), note: "" }, DomainDuty);
        const prior = $.const({ status: variant("draft", null), dismissed: new Set<string>(), requirements: new Map(), assignments: new Map([
            ["night", { slot: { day: 0n, group: "goods", shift: "night" }, who: variant("person", "lead"), position: "lead", activity: none,
                start: new Date("2028-03-05T22:00:00Z"), end: new Date("2028-03-06T08:00:00Z"), hours: 10, row: night }],
        ]) }, DomainWeek);
        const late = $.const({ who: variant("staff", "lead"), start: new Date("2028-03-06T14:00:00Z"), end: new Date("2028-03-06T22:00:00Z"), note: "" }, DomainDuty);
        const next = $.const({ slot: { day: 1n, group: "goods", shift: "late" }, who: variant("person", "lead"), position: "lead", activity: none,
            start: new Date("2028-03-06T14:00:00Z"), end: new Date("2028-03-06T22:00:00Z"), hours: 8, row: late }, Roster.Types.Assignment(DomainDuty));
        return rest(next, "next", prior, context).before;
    }),
});
export const rosterFitTrainer = example({
    description: "The ready-made fit: a trainer off that day whose rest is kept fits Goods' early shift, scored by spare contract hours and a week's more in the slot's group",
    keywords: ["Roster", "Roster.fit", "fit", "Find", "trainer", "spare hours", "rest"], inputs: [week, context],
    returns: variant("fits", { score: 198, why: "Goods · 30 h spare", warn: none }),
    fn: East.function([DomainWeek, Roster.Types.Context], Roster.Types.Fit, ($, week, context) => {
        const coverage = $.const(Roster.coverage(DomainDuty));
        const fit = $.const(Roster.fit(DomainDuty));
        const noPay = $.const(new Map(), Roster.Types.Pay);
        // Monday's early shift: the lead's Sunday duty ends at 17:00, so 13 hours' rest is kept; 10 of their 40 contract hours are rostered.
        const request = $.const({ need: variant("trainers", null), slot: { day: 1n, group: "goods", shift: "early" }, start: new Date("2028-03-05T00:00:00Z"),
            week, context, coverage: coverage(week, context, noPay) }, Roster.Types.FitRequest(DomainDuty));
        return fit(request, context.people.get("lead"));
    }),
});
export const rosterAnswerLeads = example({
    description: "Roster.answer maps a rule over every person, echoing the need and the slot: the lead fits, and the two associates are refused as not leads",
    keywords: ["Roster", "Roster.answer", "Roster.fit", "fit", "Find", "lead", "refused"], inputs: [week, context],
    returns: {
        need: variant("leads", null), slot: { day: 1n, group: "goods", shift: "early" },
        people: new Map<string, ValueTypeOf<typeof Roster.Types.Fit>>([
            ["agency", variant("refused", { group: "Not a lead", reason: "Crew · not a lead", measure: variant("none", null) })],
            ["lead", variant("fits", { score: 198, why: "Goods · 30 h spare", warn: none })],
            ["off", variant("refused", { group: "Not a lead", reason: "Crew · not a lead", measure: variant("none", null) })],
        ]),
    },
    fn: East.function([DomainWeek, Roster.Types.Context], Roster.Types.FitResult, ($, week, context) => {
        const coverage = $.const(Roster.coverage(DomainDuty));
        const answer = $.const(Roster.answer(DomainDuty));
        const fit = $.const(Roster.fit(DomainDuty));
        const noPay = $.const(new Map(), Roster.Types.Pay);
        const request = $.const({ need: variant("leads", null), slot: { day: 1n, group: "goods", shift: "early" }, start: new Date("2028-03-05T00:00:00Z"),
            week, context, coverage: coverage(week, context, noPay) }, Roster.Types.FitRequest(DomainDuty));
        return answer(request, fit);
    }),
});
