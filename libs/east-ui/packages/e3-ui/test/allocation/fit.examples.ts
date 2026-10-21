/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import {
    ArrayType, DateTimeType, DictType, East, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, example, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Allocation } from "@elaraai/e3-ui";

/** A bin of a small yard's own: its bay, its time and its load, and the grade measured on arrival, which the board carries but never reads. */
export const GradeBin = StructType({ bay: StringType, at: DateTimeType, load: OptionType(StringType), grade: StringType });
/** One day of the yard's bins as the board reads them, and one of its bins. */
export const GradeDay = Allocation.Types.Day(GradeBin);
export const GradeBoardBin = Allocation.Types.Bin(GradeBin);

const byString = compareFor(StringType);
/** The plan day: Tue 11 May 2027. */
export const planDay = new Date("2027-05-11T00:00:00Z");
/** A small yard: two bays, three loads, and three kilns — K-1 with its next charge from Fri 21, K-2 free, K-3 drying until Fri 14. */
export const context: ValueTypeOf<typeof Allocation.Types.Context> = {
    lanes: [{ key: "B-1", label: "B-1", offset: variant("minutes", 15) }, { key: "B-2", label: "B-2", offset: variant("minutes", 35) }],
    every: variant("hours", 1),
    arrivals: new SortedMap<string, ValueTypeOf<typeof Allocation.Types.Arrival>>([
        ["L-1", { key: "L-1", label: "L-1", meta: none, quantity: 12, hold: variant("days", 8), kind: some("MC12"), due: none, window: none, details: [] }],
        ["L-2", { key: "L-2", label: "L-2", meta: none, quantity: 30, hold: variant("days", 6), kind: some("MC14"), due: none, window: none, details: [] }],
        ["L-3", { key: "L-3", label: "L-3", meta: none, quantity: 8, hold: variant("days", 9), kind: some("MC12"), due: none, window: none, details: [] }],
    ], byString),
    resources: new SortedMap<string, ValueTypeOf<typeof Allocation.Types.Resource>>([
        ["K-1", { key: "K-1", label: "K-1", group: some("Hall A"), meta: none, note: none, min: 10, max: 24, hold: variant("days", 8),
            jobs: [{ label: "planned", start: new Date("2027-05-21T00:00:00Z"), end: new Date("2027-05-29T00:00:00Z") }] }],
        ["K-2", { key: "K-2", label: "K-2", group: some("Bulk"), meta: none, note: none, min: 20, max: 32, hold: variant("days", 8), jobs: [] }],
        ["K-3", { key: "K-3", label: "K-3", group: some("Hall A"), meta: none, note: none, min: 10, max: 24, hold: variant("days", 8),
            jobs: [{ label: "C-1", start: new Date("2027-05-01T00:00:00Z"), end: new Date("2027-05-14T00:00:00Z") }] }],
    ], byString),
    rules: { under: true }, unit: "m³",
};
/** Tue 11's plan: L-1's 12 m³ in B-1 at 06:15, on K-1. */
export const plan: ValueTypeOf<typeof GradeDay> = {
    status: variant("draft", null),
    bins: new SortedMap<string, ValueTypeOf<typeof GradeBoardBin>>([
        ["b1", { lane: "B-1", at: new Date("2027-05-11T06:15:00Z"), arrival: some("L-1"), quantity: 12, kind: some("MC12"), hold: variant("days", 8),
            parts: new SortedMap<string, number>([["K-1", 12]], byString), row: { bay: "B-1", at: new Date("2027-05-11T06:15:00Z"), load: some("L-1"), grade: "R1" } }],
    ], byString),
};
/** The same day with two more bins drafted: L-2's 30 m³ with 26 on K-2, and L-3's 8 m³ on no kiln yet. */
export const drafted: ValueTypeOf<typeof GradeDay> = {
    status: variant("draft", null),
    bins: new SortedMap<string, ValueTypeOf<typeof GradeBoardBin>>([
        ["b1", { lane: "B-1", at: new Date("2027-05-11T06:15:00Z"), arrival: some("L-1"), quantity: 12, kind: some("MC12"), hold: variant("days", 8),
            parts: new SortedMap<string, number>([["K-1", 12]], byString), row: { bay: "B-1", at: new Date("2027-05-11T06:15:00Z"), load: some("L-1"), grade: "R1" } }],
        ["b2", { lane: "B-2", at: new Date("2027-05-11T07:35:00Z"), arrival: some("L-2"), quantity: 30, kind: some("MC14"), hold: variant("days", 6),
            parts: new SortedMap<string, number>([["K-2", 26]], byString), row: { bay: "B-2", at: new Date("2027-05-11T07:35:00Z"), load: some("L-2"), grade: "U1" } }],
        ["b3", { lane: "B-1", at: new Date("2027-05-11T09:15:00Z"), arrival: some("L-3"), quantity: 8, kind: some("MC12"), hold: variant("days", 9),
            parts: new SortedMap<string, number>([], byString), row: { bay: "B-1", at: new Date("2027-05-11T09:15:00Z"), load: some("L-3"), grade: "P2" } }],
    ], byString),
};

export const allocationDayLoads = example({
    description: "Allocation.loads: every resource's load on the plan day — K-1 loading 12 m³, held to Wed 19 by its bin's 8-day hold; K-2 free; K-3 busy, a job covering the day's start",
    keywords: ["Allocation", "Allocation.loads", "load", "fill", "hold", "free", "loading", "busy"], inputs: [plan, context],
    returns: new SortedMap<string, ValueTypeOf<typeof Allocation.Types.Load>>([
        ["K-1", { resource: "K-1", fill: 12, bins: 1n, hold: some({ from: new Date("2027-05-11T00:00:00Z"), to: new Date("2027-05-19T00:00:00Z") }), state: variant("loading", null) }],
        ["K-2", { resource: "K-2", fill: 0, bins: 0n, hold: none, state: variant("free", null) }],
        ["K-3", { resource: "K-3", fill: 0, bins: 0n, hold: none, state: variant("busy", null) }],
    ], byString),
    fn: East.function([GradeDay, Allocation.Types.Context], DictType(StringType, Allocation.Types.Load), ($, plan, context) => {
        const loads = $.const(Allocation.loads(GradeBin));
        return loads(planDay, plan, context);
    }),
});

export const allocationRules = example({
    description: "Allocation.fit, the built-in rules, over the candidates of placing L-2's 30 m³ (Allocation.candidates: one per resource, in key order) — K-1 refused over its max, K-2 fits with an open gap, K-3 refused busy",
    keywords: ["Allocation", "Allocation.fit", "Allocation.candidates", "candidate", "rules", "over max", "busy", "refused", "score"], inputs: [plan, context],
    returns: [
        variant("refused", { group: "Over max", reason: "over max by 18 m³", measure: variant("amount", { lead: "by", value: 18 }) }),
        variant("fits", { score: 0.6975, why: "open gap · leaves 30 m³ · takes 20–32", warn: none }),
        variant("refused", { group: "Busy", reason: "busy until Fri 14", measure: variant("day", { lead: "until", at: new Date("2027-05-14T00:00:00Z") }) }),
    ],
    fn: East.function([GradeDay, Allocation.Types.Context], ArrayType(Allocation.Types.Fit), ($, plan, context) => {
        const candidates = $.const(Allocation.candidates(GradeBin));
        const rule = $.const(Allocation.fit);
        const request = $.const({ day: planDay, plan, ask: variant("place", { subject: variant("arrival", "L-2"), quantity: 30 }), context }, Allocation.Types.FitRequest(GradeBin));
        return candidates(request).map(($2, candidate) => rule(candidate));
    }),
});

export const allocationAnswerPlace = example({
    description: "Allocation.answer over the built-in rules, placing L-3's 8 m³: a verdict per resource — K-1 fits best, beside a bin of its kind with a day spare before its next charge; K-2 fits under its minimum, a warning; K-3 refused busy",
    keywords: ["Allocation", "Allocation.answer", "Allocation.fit", "fit", "place", "FitRequest", "FitResult", "under min", "e3.function"], inputs: [plan, context],
    returns: {
        ask: variant("place", { subject: variant("arrival", "L-3"), quantity: 8 }),
        resources: new SortedMap<string, ValueTypeOf<typeof Allocation.Types.Fit>>([
            ["K-1", variant("fits", { score: 1.0433333333333334, why: "1 d spare to Fri 21 · leaves 20 m³ · takes 10–24", warn: none })],
            ["K-2", variant("fits", { score: -0.49, why: "open gap · leaves 8 m³ · min 20 · 12 short", warn: some("under min") })],
            ["K-3", variant("refused", { group: "Busy", reason: "busy until Fri 14", measure: variant("day", { lead: "until", at: new Date("2027-05-14T00:00:00Z") }) })],
        ], byString),
        bins: new SortedMap<string, ValueTypeOf<typeof Allocation.Types.Fit>>([], byString),
        arrivals: new SortedMap<string, ValueTypeOf<typeof Allocation.Types.Fit>>([], byString),
        reserve: none, basis: "ranked by load, kind and spare days",
    },
    fn: East.function([GradeDay, Allocation.Types.Context], Allocation.Types.FitResult, ($, plan, context) => {
        const answer = $.const(Allocation.answer(GradeBin));
        const rule = $.const(Allocation.fit);
        const request = $.const({ day: planDay, plan, ask: variant("place", { subject: variant("arrival", "L-3"), quantity: 8 }), context }, Allocation.Types.FitRequest(GradeBin));
        return answer(request, rule, "ranked by load, kind and spare days");
    }),
});

export const allocationAnswerTake = example({
    description: "Allocation.answer for a take — what can K-1 take: a verdict for its bin, one for each arrival the plan has not booked (L-2 over its max, L-3 beside a bin of its kind) and one for reserving an empty slot",
    keywords: ["Allocation", "Allocation.answer", "Allocation.fit", "fit", "take", "reserve", "FitResult", "bins", "arrivals"], inputs: [plan, context],
    returns: {
        ask: variant("take", { resource: "K-1" }),
        resources: new SortedMap<string, ValueTypeOf<typeof Allocation.Types.Fit>>([], byString),
        bins: new SortedMap<string, ValueTypeOf<typeof Allocation.Types.Fit>>([
            ["b1", variant("fits", { score: 0.42, why: "2 d spare to Fri 21 · leaves 12 m³ · takes 10–24", warn: none })],
        ], byString),
        arrivals: new SortedMap<string, ValueTypeOf<typeof Allocation.Types.Fit>>([
            ["L-2", variant("refused", { group: "Over max", reason: "over max by 18 m³", measure: variant("amount", { lead: "by", value: 18 }) })],
            ["L-3", variant("fits", { score: 1.0433333333333334, why: "1 d spare to Fri 21 · leaves 20 m³ · takes 10–24", warn: none })],
        ], byString),
        reserve: some(variant("fits", { score: 0.32, why: "2 d spare to Fri 21 · leaves 12 m³ · takes 10–24", warn: none })),
        basis: "ranked by load, kind and spare days",
    },
    fn: East.function([GradeDay, Allocation.Types.Context], Allocation.Types.FitResult, ($, plan, context) => {
        const answer = $.const(Allocation.answer(GradeBin));
        const rule = $.const(Allocation.fit);
        const request = $.const({ day: planDay, plan, ask: variant("take", { resource: "K-1" }), context }, Allocation.Types.FitRequest(GradeBin));
        return answer(request, rule, "ranked by load, kind and spare days");
    }),
});

export const allocationLookahead = example({
    description: "Allocation.lookahead over the built-in rules, as a fit's body: placing L-3 on K-2 would leave L-2 with nowhere to go, so that fit drops by one and says so; K-1's leaves room for L-2 on K-2 and stands",
    keywords: ["Allocation", "Allocation.lookahead", "Allocation.answer", "Allocation.fit", "greedy", "look-ahead", "fit", "e3.function"], inputs: [plan, context],
    returns: {
        ask: variant("place", { subject: variant("arrival", "L-3"), quantity: 8 }),
        resources: new SortedMap<string, ValueTypeOf<typeof Allocation.Types.Fit>>([
            ["K-1", variant("fits", { score: 1.0433333333333334, why: "1 d spare to Fri 21 · leaves 20 m³ · takes 10–24", warn: none })],
            ["K-2", variant("fits", { score: -1.49, why: "open gap · leaves 8 m³ · min 20 · 12 short · leaves 1 load with no fit", warn: some("under min") })],
            ["K-3", variant("refused", { group: "Busy", reason: "busy until Fri 14", measure: variant("day", { lead: "until", at: new Date("2027-05-14T00:00:00Z") }) })],
        ], byString),
        bins: new SortedMap<string, ValueTypeOf<typeof Allocation.Types.Fit>>([], byString),
        arrivals: new SortedMap<string, ValueTypeOf<typeof Allocation.Types.Fit>>([], byString),
        reserve: none, basis: "ranked by load, kind and spare days, and what it leaves for the day's other loads",
    },
    fn: East.function([GradeDay, Allocation.Types.Context], Allocation.Types.FitResult, ($, plan, context) => {
        const answer = $.const(Allocation.answer(GradeBin));
        const rule = $.const(Allocation.fit);
        const ahead = $.const(Allocation.lookahead(GradeBin));
        const request = $.const({ day: planDay, plan, ask: variant("place", { subject: variant("arrival", "L-3"), quantity: 8 }), context }, Allocation.Types.FitRequest(GradeBin));
        return answer(request, East.function([Allocation.Types.Candidate], Allocation.Types.Fit, (_$2, c) => ahead(request, c, rule)),
            "ranked by load, kind and spare days, and what it leaves for the day's other loads");
    }),
});

export const allocationChecks = example({
    description: "Allocation.check, the built-in checks, over a drafted day: L-3's bin on no resource yet, with its fix Choose a resource; L-2's with 4 m³ unallocated, with its fix Find a fit",
    keywords: ["Allocation", "Allocation.check", "issues", "not linked", "unallocated", "split", "fix"], inputs: [drafted, context],
    returns: [
        { kind: variant("unlinked", null), tone: variant("warning", null), title: "L-3 · 8 m³", detail: "B-1 09:15 · no resource yet",
            bin: some("b3"), resource: none, flag: none, fix: some(variant("choose", null)) },
        { kind: variant("unallocated", null), tone: variant("warning", null), title: "L-2 · 30 m³", detail: "4 m³ unallocated · B-2 07:35",
            bin: some("b2"), resource: none, flag: none, fix: some(variant("find", null)) },
    ],
    fn: East.function([GradeDay, Allocation.Types.Context], ArrayType(Allocation.Types.Issue), ($, plan, context) => {
        const check = $.const(Allocation.check(GradeBin));
        return check(planDay, plan, context);
    }),
});

export const allocationSlots = example({
    description: "Allocation.slots: the day's lane slots, one per lane per hour at its offset, in time then lane order — 48 for two bays — each free, booked or reserved; B-1 06:15 is booked with bin b1",
    keywords: ["Allocation", "Allocation.slots", "slots", "lanes", "booked", "free", "reserved"], inputs: [plan, context],
    returns: { slots: 48n, held: [{ lane: "B-1", at: new Date("2027-05-11T06:15:00Z"), status: variant("booked", null), bins: ["b1"] }] },
    fn: East.function([GradeDay, Allocation.Types.Context], StructType({ slots: IntegerType, held: ArrayType(Allocation.Types.Slot) }), ($, plan, context) => {
        const slots = $.const(Allocation.slots(GradeBin));
        const all = $.const(slots(planDay, plan, context));
        return { slots: all.size(), held: all.filter(($2, slot) => slot.status.hasTag("free").not()) };
    }),
});
