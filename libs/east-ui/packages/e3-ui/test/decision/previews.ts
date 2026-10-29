/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The decision queue's previews gallery (#1453, `Decision Queue Spec.md` §11):
 * a case for each preview a builder draws, as the spec's gallery shows them —
 * the Roster's crop and its week's map, the Plan's crop and its day's map, the
 * Allocation's crop, the Calendar's and the Sheet's — and a Plan crop for each
 * of its other marks: a breach, a knock-on, a row two cases share and a
 * change the record has moved under; its lock is on the Plan's crop, the
 * confirmed job the moved one overlapped. The cases are the example app's
 * (`ops.ts`), their changes patches of the records it holds beside them
 * (`changes.ts`) — the warehouse rota's duties, the print works' jobs, the
 * workshop's maintenance, the kiln yard's bins and the shop's work orders —
 * on Tuesday 20 October 2026 at 09:14, the example's `now`; the rota's week
 * and the kiln yard's days are their records' own. Every name and figure is
 * generated.
 */
import { DictType, SortedMap, SortedSet, StringType, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { calendarServices } from "../calendar/calendar.examples.js";
import { planPrintJobs } from "../plan/plan-events.examples.js";
import { binPatch, byString, dutiesTo, jobsPatch, ld2235Bin, option, ordersPatch, servicesPatch } from "./changes.js";
import { OpsCase, OpsVerdict } from "./ops.js";

/** The print works' jobs, as the works' record holds them. */
const printJobs = planPrintJobs.default!;
/** The jobs' patch running each job named on the press given, from its start to its end, its every other field as the record holds it. */
function jobsTo(moves: readonly (readonly [string, string, Date, Date])[]) {
    return jobsPatch(printJobs, moves.map(([key, press, start, end]) => [key, {
        ...printJobs.get(key)!, press: some(press), start: some(start), end: some(end),
    }] as const));
}
/** J-1008's seed catalogue as the model last read it, on Press A2 07:00–17:00 on the 21st: an hour later than the works now has it. */
const seedCatalogueRead = { ...printJobs.get("J-1008")!, start: some(new Date("2026-10-21T07:00:00Z")), end: some(new Date("2026-10-21T17:00:00Z")) };
/** Press 1's preventive maintenance, 09:00–11:00 on Thursday the 1st: an hour over the mounting brackets' run there. */
const pressOneService = calendarServices.default!.get("service1")!;
/** Bay B-1's free slot on Tue 11 May 2027 at 14:15, after its 13:15 bin. */
const tue11 = new Date("2027-05-11T14:15:00Z");

/**
 * The gallery's cases, each one option the card opens on: the Roster's crop, two hours late; the Plan's crop, 35
 * minutes late; the Plan's day map, the Allocation's crop and the Calendar's, due today; the Sheet's crop and the
 * Roster's week map, due this week; and the Plan's other marks, a case each.
 */
export const previewCaseRows: SortedMap<string, ValueTypeOf<typeof OpsCase>> = new SortedMap<string, ValueTypeOf<typeof OpsCase>>([
    // The Roster's crop: three of one person's early shifts to another, which the card asks about.
    ["rota-garnet", {
        area: "rota", scope: "Dispatch · W10", due: some(new Date("2026-10-20T07:14:00Z")), routine: false, unit: "uplift", money: true,
        model: "staffing-v3.2.1 · run #43",
        why: "P. Garnet is booked on a training course on Monday, Tuesday and Thursday. J. Quartz labels and handles returns, and has those days free.",
        ifWrong: some(-9_000), recommended: "1-quartz",
        options: new SortedMap([
            ["1-quartz", option({ label: "J. Quartz", title: "Move 3 early shifts from P. Garnet to J. Quartz", summary: "J. Quartz · Mon, Tue, Thu 06–14",
                detail: "J. Quartz takes Monday, Tuesday and Thursday 06–14; P. Garnet drops to 16h.", note: some("J. Quartz lands at 48h of 38"),
                value: 80_000, confidence: some(0.8), question: some("Has J. Quartz agreed to the extra shifts?"),
                change: variant("rota", dutiesTo([["s286", "jquartz"], ["s287", "jquartz"], ["s284", "jquartz"]])) })],
        ], byString),
    }],
    // The Plan's crop: a job off the press it overlaps a confirmed job on, the now line across it.
    ["print-j1019", {
        area: "print", scope: "Print works · Hall B", due: some(new Date("2026-10-20T08:39:00Z")), routine: false, unit: "uplift", money: true,
        model: "press-sched-v2 · run #119",
        why: "J-1018 runs on Press B2 until 12:00, so J-1019 overlaps it for two hours. Press B3 is free from 09:00 and carries the same board stock.",
        ifWrong: some(-1_800), recommended: "1-b3",
        options: new SortedMap([
            ["1-b3", option({ label: "Press B3", title: "Move job J-1019 from Press B2 to Press B3", summary: "B3 · 09:30–15:30",
                detail: "J-1019 runs on B3 09:30–15:30, clearing the 2h overlap on B2.", note: some("same stock, no wash-up"), value: 6_200,
                confidence: some(0.9),
                change: variant("print", jobsTo([["J-1019", "b3", new Date("2026-10-20T09:30:00Z"), new Date("2026-10-20T15:30:00Z")]])) })],
        ], byString),
    }],
    // The Plan's day map: five jobs onto Thursday's presses, four of them from the backlog.
    ["print-thursday", {
        area: "print", scope: "Print works · Thu 22", due: some(new Date("2026-10-20T12:00:00Z")), routine: false, unit: "uplift · 5 jobs move",
        money: true, model: "press-sched-v2 · run #120",
        why: "Four jobs wait in the backlog, due this week and next. Press B2 prints J-1012's 48,000 sheets in four hours, against six on Press A3.",
        ifWrong: some(-4_000), recommended: "1-all",
        options: new SortedMap([
            ["1-all", option({ label: "All five", title: "Resequence Thursday across 6 presses", summary: "5 jobs · Thu 22",
                detail: "J-1012 moves to Press B2; J-1025 and J-1026 run on Press B1, J-1027 on Press A1 and J-1028 on Press A2.", value: 12_000,
                confidence: some(0.84),
                change: variant("print", jobsTo([
                    ["J-1012", "b2", new Date("2026-10-22T10:00:00Z"), new Date("2026-10-22T14:00:00Z")],
                    ["J-1025", "b1", new Date("2026-10-22T07:00:00Z"), new Date("2026-10-22T11:30:00Z")],
                    ["J-1026", "b1", new Date("2026-10-22T11:30:00Z"), new Date("2026-10-22T15:00:00Z")],
                    ["J-1027", "a1", new Date("2026-10-22T08:00:00Z"), new Date("2026-10-22T16:30:00Z")],
                    ["J-1028", "a2", new Date("2026-10-22T09:00:00Z"), new Date("2026-10-22T11:00:00Z")],
                ])) })],
        ], byString),
    }],
    // The Allocation's crop: a load off the Waiting row into a kiln, which the card asks about.
    ["yard-ld2235", {
        area: "yard", scope: "Kiln yard", due: some(new Date("2026-10-20T14:00:00Z")), routine: false, unit: "uplift", money: true,
        model: "yard-fit · run #78",
        why: "K-305 is free on Tue 11 and takes 4–10 m³: LD-2235's 8 m³ dries its 9 days there before the kiln's next planned charge on Thu 20. The bulk kilns take no load under 40 m³.",
        ifWrong: some(-600), recommended: "1-k305",
        options: new SortedMap([
            ["1-k305", option({ label: "K-305", title: "Load LD-2235 (8 m³) into kiln K-305", summary: "K-305 · Tue 11 14:15",
                detail: "K-305 dries it Tue 11 14:15 – Thu 20 and fills to 8 of 10 m³.", note: some("fits best"), value: 1_900,
                confidence: some(0.88), question: some("Has LD-2235 passed its moisture check?"),
                change: variant("yard", binPatch("3127", ld2235Bin("K-305", tue11))) })],
        ], byString),
    }],
    // The Calendar's crop: a machine's maintenance off the day it overlaps a job.
    ["workshop-press1", {
        area: "workshop", scope: "Fabrication", due: some(new Date("2026-10-20T17:00:00Z")), routine: false, unit: "uplift", money: true,
        model: "fab-sched · run #13",
        why: "Press 1's preventive maintenance overlaps the mounting brackets on Thursday. Saturday morning is free on Press 1 and inside the service interval.",
        ifWrong: some(-900), recommended: "1-sat",
        options: new SortedMap([
            ["1-sat", option({ label: "Sat 06:00", title: "Move Press 1 maintenance to Sat 06:00", summary: "Press 1 · Sat 3 06:00–08:00",
                detail: "Clears the overlap with the mounting brackets · $380 call-out.", value: 2_400, confidence: some(0.74),
                change: variant("workshop", servicesPatch("service1", { ...pressOneService,
                    start: new Date("2026-10-03T06:00:00Z"), end: new Date("2026-10-03T08:00:00Z") })) })],
        ], byString),
    }],
    // The Sheet's crop: cells filled from history, one a guess.
    ["orders-ready", {
        area: "orders", scope: "Workshop orders", due: some(new Date("2026-10-21T17:00:00Z")), routine: false, unit: "due dates · 1 low confidence",
        money: false, model: "sheet copilot · 5m ago",
        why: "Three orders are ready with no due date. Past orders through the same work centres give each one.",
        ifWrong: none, recommended: "1-all",
        options: new SortedMap([
            ["1-all", option({ label: "All three", title: "Fill 3 due dates on the ready orders from history", summary: "3 orders",
                detail: "WO-1005, WO-1007 and WO-1008 are given due dates and set Scheduled.", value: 3, confidence: some(0.91),
                guesses: new SortedMap([["WO-1007", 0.69]], byString),
                change: variant("orders", ordersPatch([
                    ["WO-1005", new Date("2026-10-23T00:00:00Z")], ["WO-1007", new Date("2026-10-26T00:00:00Z")], ["WO-1008", new Date("2026-10-27T00:00:00Z")],
                ])) })],
        ], byString),
    }],
    // The Roster's week map: twenty of the warehouse's people change, two of them only losing shifts.
    ["rota-week10", {
        area: "rota", scope: "Warehouse · W10", due: some(new Date("2026-10-23T17:00:00Z")), routine: false, unit: "uplift · 18 changes", money: true,
        model: "staffing-v3.2.1 · run #43",
        why: "R. Wold and G. Ember run 2h over contract while B. Pumice and J. Quartz have room. Eight swaps between teammates even out the week's days off.",
        ifWrong: some(-5_000), recommended: "1-week",
        options: new SortedMap([
            ["1-week", option({ label: "The week", title: "Rebalance week 10 across 69 people", summary: "20 people · 18 shifts",
                detail: "B. Pumice takes R. Wold's Sunday night and J. Quartz G. Ember's Monday early; eight pairs of teammates swap a day each.",
                value: 31_000, confidence: some(0.76), question: some("Have the eight pairs agreed to swap their days?"),
                change: variant("rota", dutiesTo([
                    ["s260", "bpumice"], ["s281", "jquartz"],
                    ["s63", "jfern"], ["s68", "bfallow"], ["s291", "tkelp"], ["s301", "charrow"], ["s207", "dquarry"], ["s183", "cshale"],
                    ["s197", "wrowan"], ["s191", "grush"], ["s114", "lholm"], ["s104", "givy"], ["s46", "rbirch"], ["s13", "kcoppice"],
                    ["s54", "tcorrie"], ["s50", "fdune"], ["s120", "tlarch"], ["s134", "pjuniper"],
                ])) })],
        ], byString),
    }],
    // The Plan's other marks, a crop each. A change the record moved under: diffed against J-1008 as the model read it,
    // an hour before the works moved it.
    ["print-stale", {
        area: "print", scope: "Print works · Hall A", due: some(new Date("2026-10-20T15:00:00Z")), routine: false, unit: "uplift", money: true,
        model: "press-sched-v2 · run #97",
        why: "Press B1 prints J-1008's 100,000 sheets in seven hours, against ten on Press A2, which frees A2 for Wednesday's late work.",
        ifWrong: some(-700), recommended: "1-b1",
        options: new SortedMap([
            ["1-b1", option({ label: "Press B1", title: "Move job J-1008 from Press A2 to Press B1", summary: "B1 · 08:00–15:00",
                detail: "J-1008 runs on B1 08:00–15:00 on Wednesday.", value: 1_400, confidence: some(0.81),
                change: variant("print", jobsPatch(printJobs, [["J-1008", { ...seedCatalogueRead, press: some("b1"),
                    start: some(new Date("2026-10-21T08:00:00Z")), end: some(new Date("2026-10-21T15:00:00Z")) }, seedCatalogueRead]])) })],
        ], byString),
    }],
    // A row two cases share: J-1025, which the day map also places.
    ["print-shared", {
        area: "print", scope: "Print works · Hall B", due: some(new Date("2026-10-20T16:00:00Z")), routine: false, unit: "uplift", money: true,
        model: "press-sched-v2 · run #118",
        why: "J-1025's winter brochure is due on Wednesday. Press B3 is free all day on Wednesday.",
        ifWrong: some(-2_200), recommended: "1-b3",
        options: new SortedMap([
            ["1-b3", option({ label: "Press B3", title: "Run job J-1025 on Press B3 on Wed 21", summary: "B3 · 06:00–17:00",
                detail: "J-1025 runs on B3 06:00–17:00, the day it is due.", value: 3_400, confidence: some(0.72),
                change: variant("print", jobsTo([["J-1025", "b3", new Date("2026-10-21T06:00:00Z"), new Date("2026-10-21T17:00:00Z")]])) })],
        ], byString),
    }],
    // A knock-on: a job moved later because of the change, not by it.
    ["print-knock", {
        area: "print", scope: "Print works · Hall B", due: some(new Date("2026-10-23T12:00:00Z")), routine: false, unit: "uplift", money: true,
        model: "press-sched-v2 · run #121",
        why: "J-1024's order forms are overdue. Press B1 takes them first thing on Monday, and J-1016's exhibition book starts three hours later to make room.",
        ifWrong: some(-1_100), recommended: "1-b1",
        options: new SortedMap([
            ["1-b1", option({ label: "Press B1", title: "Run job J-1024 first on Press B1 on Mon 26", summary: "B1 · 06:00–09:00",
                detail: "J-1024 runs on B1 06:00–09:00; J-1016 moves to 09:00–15:00.", value: 2_100, confidence: some(0.85),
                knockOn: new SortedSet(["J-1016"], byString),
                change: variant("print", jobsTo([
                    ["J-1024", "b1", new Date("2026-10-26T06:00:00Z"), new Date("2026-10-26T09:00:00Z")],
                    ["J-1016", "b1", new Date("2026-10-26T09:00:00Z"), new Date("2026-10-26T15:00:00Z")],
                ])) })],
        ], byString),
    }],
    // A breach: the change still overlaps another job on its press.
    ["print-breach", {
        area: "print", scope: "Print works · Hall A", due: some(new Date("2026-10-26T09:00:00Z")), routine: false, unit: "uplift", money: true,
        model: "press-sched-v2 · run #121",
        why: "J-1023's guide reprint was due on the 16th. Press A1 is the only press with coated stock free on Tuesday, from an hour after J-1005 starts.",
        ifWrong: some(-400), recommended: "1-a1",
        options: new SortedMap([
            ["1-a1", option({ label: "Press A1", title: "Run job J-1023 on Press A1 on Tue 27", summary: "A1 · 07:00–09:00",
                detail: "J-1023 runs on A1 07:00–09:00, an hour over J-1005.", value: 900, confidence: some(0.7),
                warn: some("J-1023 overlaps J-1005 on Press A1 for an hour."),
                change: variant("print", jobsTo([["J-1023", "a1", new Date("2026-10-27T07:00:00Z"), new Date("2026-10-27T09:00:00Z")]])) })],
        ], byString),
    }],
], byString);

/** The gallery's cases, the app's record of them, keyed by case. */
export const previewCases = e3.record("preview_cases", DictType(StringType, OpsCase), {
    initial: previewCaseRows,
});

/** The people's verdicts on them: the record the queue writes, through its patch door. */
export const previewVerdicts = e3.record("preview_verdicts", DictType(StringType, OpsVerdict), {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
