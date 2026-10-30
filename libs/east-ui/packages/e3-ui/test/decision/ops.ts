/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The decision queue's example app (#1447, `Decision Queue Spec.md` §3.1,
 * §3.2, §15): a warehouse, a print shop, a kiln yard and a workshop under one
 * roof — the repo's own example records — whose models propose changes to
 * each. Its cases are one record, every kind of decision in it: an option's
 * change is a variant, its tag the kind of decision and its value a patch of
 * the record that kind changes, built with East's own diff of the rows it
 * touches (`changes.ts`). Its verdicts are another record, which the queue
 * writes; the price list, the stock levels, the lines' cure settings and the
 * presses' readiness are records no builder draws. The cases are the spec's
 * mock's, like for like — its scopes, titles, options, figures, questions and
 * warnings — on Tuesday 10 March 2026 at 13:00, the examples' `now`, over the
 * rows of the records each changes. Beside them, the smallest queue's — a
 * record of the model's proposals, each one decision with no alternatives, and
 * its verdicts — and the routine queue's: the models' routine changes, each its
 * own one proposal, and their verdicts. Every name and figure is generated.
 */
import {
    BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, PatchType, SetType, SortedMap, StringType, StructType,
    VariantType, diffFor, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { KilnBin } from "../allocation/kiln-yard.js";
import { CalendarService, calendarServices } from "../calendar/calendar.examples.js";
import { PrintJob, planEventJobs } from "../plan/plan-events.examples.js";
import { WarehouseCover, WarehouseDuty, warehouseDuties } from "../roster/warehouse.js";
import { OptimiseWorkOrder } from "../sheet/optimise.examples.js";
import { binPatch, byString, coverPatch, dutiesFor, dutiesPatch, dutiesTo, jobsPatch, ld2235Bin, optionDefaults, ordersPatch, servicesPatch } from "./changes.js";

// ============================================================================
// The app's records (§3.1)
// ============================================================================

/** A list price, and the demand a week the model expects at it: a record no builder draws. */
export const ListPrice = StructType({ region: StringType, price: FloatType, demand: FloatType, from: DateTimeType });

/** An item's stock: the units on order, and the model's stock-out risk in the week ahead, in percent: a record no builder draws. */
export const StockLevel = StructType({ item: StringType, onOrder: FloatType, risk: FloatType });

/** A line's cure: its cure time in minutes, the bond strength it gives in MPa, and the batches on trial at the slow cure: a record no builder draws. */
export const CureSetting = StructType({ line: StringType, cure: FloatType, bond: FloatType, trialBatches: IntegerType });

/** A press's readiness: the days until it is ready, as the forecast has them, and whether a person confirmed them: a record no builder draws. */
export const PressReadiness = StructType({ press: StringType, days: FloatType, confirmed: BooleanType });

/** What an option changes: its tag is the kind of decision, its value a patch of the record that kind changes. */
export const OpsChange = VariantType({
    rota: PatchType(DictType(StringType, WarehouseDuty)),        // cover: the warehouse rota's duties, as the Roster draws them
    rotaCost: PatchType(DictType(StringType, WarehouseDuty)),    // pay: the same duties, a change read by what it costs
    print: PatchType(DictType(StringType, PrintJob)),            // the print shop's jobs, as the Plan draws them
    workshop: PatchType(DictType(StringType, CalendarService)),  // the workshop's machine maintenance, as the Calendar draws it
    yard: PatchType(DictType(StringType, KilnBin)),              // the kiln yard's bins, as the Allocation draws them
    orders: PatchType(DictType(StringType, OptimiseWorkOrder)),  // the shop's work orders, as the Sheet draws them
    pricing: PatchType(DictType(StringType, ListPrice)),         // the price list, which no builder draws
    stock: PatchType(DictType(StringType, StockLevel)),          // the stock levels, which no builder draws
    trial: PatchType(DictType(StringType, CureSetting)),         // the lines' cure settings, which no builder draws
    cover: PatchType(DictType(StringType, WarehouseCover)),      // the rota's cover targets, which the Roster edits in a form of its own
    ready: PatchType(DictType(StringType, PressReadiness)),      // the presses' readiness, which no builder draws
});

/** One way to decide a case: the app's own words for it, what it is worth, and its change. */
export const OpsOption = StructType({
    label: StringType,
    title: StringType,
    summary: StringType,
    detail: StringType,
    note: OptionType(StringType),
    value: FloatType,
    confidence: OptionType(FloatType),
    question: OptionType(StringType),
    warn: OptionType(StringType),
    refused: OptionType(StringType),
    knockOn: SetType(StringType),                    // rows of the target moved because of the change, not by it
    guesses: DictType(StringType, FloatType),        // the changed rows the model is unsure of, by key
    change: OpsChange,
});

/** A case a model leaves to a person. */
export const OpsCase = StructType({
    area: StringType,                  // the app's own field, which the rail narrows by; the queue maps none
    scope: StringType,
    due: OptionType(DateTimeType),
    routine: BooleanType,
    unit: StringType,
    figure: VariantType({ money: NullType, count: NullType }),  // what its figures are: money or a count
    model: StringType,
    why: StringType,
    ifWrong: OptionType(FloatType),
    recommended: StringType,           // the key of the option the card opens on
    options: DictType(StringType, OpsOption),  // keyed by the model's rank, which orders them: `1-pumice`, `2-osier`, …
});

/** When a verdict was given: each case of a verdict holds it. */
const Given = StructType({ at: DateTimeType });

/** A person's verdict on a case, under the case's key. */
export const OpsVerdict = StructType({
    verdict: VariantType({ applied: Given, overridden: Given, deferred: Given, handedOff: Given }),
    option: OptionType(StringType),
    answer: OptionType(VariantType({ yes: NullType, no: NullType, unsure: NullType })),
    reason: OptionType(VariantType({ context: NullType, data: NullType, priorities: NullType, other: NullType })),
    note: OptionType(StringType),
});

/** An option of the app's, its optional parts left out. */
export function option(row: Pick<ValueTypeOf<typeof OpsOption>, "label" | "title" | "summary" | "detail" | "value" | "change">
    & Partial<ValueTypeOf<typeof OpsOption>>): ValueTypeOf<typeof OpsOption> {
    return { ...optionDefaults(), ...row };
}

/** The price list's rows, by region. */
type PriceRow = ValueTypeOf<typeof ListPrice>;
/** The price list's patch, as a model diffs the rows it touches. */
const diffPrices = diffFor(DictType(StringType, ListPrice));
/** When this quarter's prices took effect. */
const pricesFrom = new Date("2026-01-01T00:00:00Z");

/** The price list: a row a region, each with the demand a week the model expects at it. */
export const listPriceRows: SortedMap<string, PriceRow> = new SortedMap<string, PriceRow>([
    ["central", { region: "Central", price: 10.80, demand: 9_600, from: pricesFrom }],
    ["coast", { region: "Coast", price: 10.50, demand: 14_200, from: pricesFrom }],
    ["north", { region: "North", price: 11.20, demand: 6_100, from: pricesFrom }],
    ["west", { region: "West", price: 10.90, demand: 7_800, from: pricesFrom }],
], byString);

/** The price list's patch changing one region's price and the demand the model expects at it: the patch of that row alone. */
export function pricesPatch(key: string, price: number, demand: number) {
    const row = listPriceRows.get(key)!;
    return diffPrices(new SortedMap([[key, row]], byString), new SortedMap([[key, { ...row, price, demand }]], byString));
}

/** The stock levels' rows, by item. */
type StockRow = ValueTypeOf<typeof StockLevel>;
/** The stock levels: the C5 envelopes, with nothing on order and a 34% risk of running out in week 11, and two items beside them. */
export const stockLevelRows: SortedMap<string, StockRow> = new SortedMap<string, StockRow>([
    ["a4-labels", { item: "A4 labels", onOrder: 1_200, risk: 6 }],
    ["c5", { item: "C5 envelopes", onOrder: 0, risk: 34 }],
    ["dl", { item: "DL envelopes", onOrder: 2_500, risk: 2 }],
], byString);
/** The stock levels' patch, as a model diffs the rows it touches. */
const diffStock = diffFor(DictType(StringType, StockLevel));
/** The stock levels' patch putting units of one item on order, at the risk the model expects then: the patch of that row alone. */
export function stockPatch(key: string, onOrder: number, risk: number) {
    const row = stockLevelRows.get(key)!;
    return diffStock(new SortedMap([[key, row]], byString), new SortedMap([[key, { ...row, onOrder, risk }]], byString));
}

/** The cure settings' rows, by line. */
type CureRow = ValueTypeOf<typeof CureSetting>;
/** The lines' cure settings: line 2 at the standard 40 minutes, its bond 41.0 MPa, and the other two beside it. */
export const cureSettingRows: SortedMap<string, CureRow> = new SortedMap<string, CureRow>([
    ["line-1", { line: "Line 1", cure: 40, bond: 40.6, trialBatches: 0n }],
    ["line-2", { line: "Line 2", cure: 40, bond: 41.0, trialBatches: 0n }],
    ["line-3", { line: "Line 3", cure: 45, bond: 42.3, trialBatches: 0n }],
], byString);
/** The cure settings' patch, as a model diffs the rows it touches. */
const diffCure = diffFor(DictType(StringType, CureSetting));
/** The cure settings' patch changing one line's fields: the patch of that row alone. */
export function curePatch(key: string, change: Partial<CureRow>) {
    const row = cureSettingRows.get(key)!;
    return diffCure(new SortedMap([[key, row]], byString), new SortedMap([[key, { ...row, ...change }]], byString));
}

/** The presses' readiness rows, by press. */
type ReadinessRow = ValueTypeOf<typeof PressReadiness>;
/** The presses' readiness: Press A1 back in about two days, as yet unconfirmed, and Press B3 ready. */
export const pressReadinessRows: SortedMap<string, ReadinessRow> = new SortedMap<string, ReadinessRow>([
    ["a1", { press: "Press A1", days: 2, confirmed: false }],
    ["b3", { press: "Press B3", days: 0, confirmed: true }],
], byString);
/** The presses' readiness's patch, as a model diffs the rows it touches. */
const diffReadiness = diffFor(DictType(StringType, PressReadiness));
/** The presses' readiness's patch confirming one press's days: the patch of that row alone. */
export function readinessPatch(key: string) {
    const row = pressReadinessRows.get(key)!;
    return diffReadiness(new SortedMap([[key, row]], byString), new SortedMap([[key, { ...row, confirmed: true }]], byString));
}

/** The print shop's jobs, as the shop's record holds them. */
const printJobs = planEventJobs.default!;
/** J-3007's loyalty cards on Press B2, 10:00–13:00 on the 20th: two hours over J-3006's market posters there. */
const loyaltyCards = printJobs.get("J-3007")!;
/** Press 1's preventive maintenance, 09:00–11:00 on Thursday the 1st: an hour over the mounting brackets' run there. */
const pressOneService = calendarServices.default!.get("service1")!;
/** Bay B-1's free slots: Tue 11 May 2027 at 14:15, after its 13:15 bin, and Wed 12 at 07:15, after its 06:15. */
const tue11 = new Date("2027-05-11T14:15:00Z");
const wed12 = new Date("2027-05-12T07:15:00Z");
/** J. Tansy's Friday late, 14:00–22:00: the week's fifth shift of theirs, 4 h past their 38. */
const tansyFriday = warehouseDuties.get("s234")!;
/** The duties the week's overtime case moves: K. Jasper's Wednesday early and L. Holm's Friday late, each past their 38 h, and Thursday's early agency request. */
const overtime = ["s295", "s104", "s217"] as const;
/** Monday to Wednesday next week: the days the shop's ready orders fall due. */
const mon16 = new Date("2026-03-16T00:00:00Z");
const tue17 = new Date("2026-03-17T00:00:00Z");
const wed18 = new Date("2026-03-18T00:00:00Z");
/** The routine changes: C. Kestrel's late and S. Meadow's night on Thursday, each 10 h, ended at 8 h; Saturday's inbound early cover trimmed to the 11 heads rostered; and Press A1's readiness confirmed. */
const thursdayTrim = dutiesFor([["s121", 8], ["s153", 8]]);
const saturdayCover = coverPatch("2028-03-11-inbound-early", 11n);
const pressA1Ready = readinessPatch("a1");

/**
 * The cases the models left, the mock's like for like. Overdue: who takes J. Tansy's Friday late, two hours late, and
 * where the print works' J-3007 runs, overlapping J-3006 on Press B2, 35 minutes late. Due today: which kiln the kiln
 * yard's LD-2235 dries in, the C5 envelopes' reorder, and when Press 1's maintenance runs, overlapping the mounting
 * brackets on Thursday. This week: a price for the Coast region and the week's overtime, both by Friday, line 2's
 * slow cure by Thursday, and the ready orders' due dates by Wednesday. Routine: two long Thursday shifts trimmed,
 * Saturday's inbound early cover trimmed to the heads rostered, and Press A1's readiness confirmed.
 */
export const opsCaseRows: SortedMap<string, ValueTypeOf<typeof OpsCase>> = new SortedMap<string, ValueTypeOf<typeof OpsCase>>([
    ["rota-tansy", {
        area: "rota", scope: "Picking · W10", due: some(new Date("2026-03-10T11:00:00Z")), routine: false, unit: "uplift", figure: variant("money", null),
        model: "staffing-v3.2.1 · run #42",
        why: "Picking demand runs 14% above plan for the next two weeks. The extra late shift sits on J. Tansy, 4h over contract; B. Pumice has 14h spare.",
        ifWrong: some(-8_000), recommended: "1-pumice",
        options: new SortedMap([
            ["1-pumice", option({ label: "B. Pumice", title: "Move J. Tansy's Friday late to B. Pumice", summary: "B. Pumice · Fri 14–22",
                detail: "B. Pumice takes Friday 14–22; J. Tansy drops to 34h.", note: some("B. Pumice lands at 32h of 38"), value: 80_000,
                confidence: some(0.82), question: some("Has B. Pumice been told this is on the table?"),
                change: variant("rota", dutiesPatch([["s234", { ...tansyFriday, who: variant("staff", "bpumice") }]])) })],
            ["2-osier", option({ label: "A. Osier", title: "Move J. Tansy's Friday late to A. Osier", summary: "A. Osier · Fri 14–22",
                detail: "A. Osier takes Friday 14–22.", note: some("A. Osier lands at 40h of 38"), value: 72_000, confidence: some(0.74),
                warn: some("A. Osier lands 2h over contract, paid at 1.5×."), question: some("Has A. Osier been told this is on the table?"),
                change: variant("rota", dutiesPatch([["s234", { ...tansyFriday, who: variant("staff", "aosier") }]])) })],
            ["3-agency", option({ label: "Agency", title: "Request an agency late on Friday", summary: "Agency · 1 request",
                detail: "Northside Staffing covers Friday 14–22.", note: some("$408 agency fee"), value: 61_000, confidence: some(0.70),
                change: variant("rota", dutiesPatch([["s234", { ...tansyFriday, who: variant("agency", "northside") }]])) })],
            ["4-keep", option({ label: "Keep with J. Tansy", title: "Keep Friday's late with J. Tansy", summary: "no change",
                detail: "No change to the roster.", note: some("J. Tansy stays 4h over contract"), value: 0,
                warn: some("J. Tansy stays 4h over contract; an SLA breach is likely in week 2."),
                change: variant("rota", dutiesPatch([["s234", tansyFriday]])) })],
        ], byString),
    }],
    ["print-j3007", {
        area: "print", scope: "Print works · Hall B", due: some(new Date("2026-03-10T12:25:00Z")), routine: false, unit: "uplift", figure: variant("money", null),
        model: "press-sched-v2 · run #118",
        why: "J-3006 runs on Press B2 until 12:00, so J-3007 overlaps it for two hours. Press A1 is free from 11:00 and carries the same stock.",
        ifWrong: some(-1_800), recommended: "1-a1",
        options: new SortedMap([
            ["1-a1", option({ label: "Press A1", title: "Move job J-3007 from Press B2 to Press A1", summary: "A1 · 11:30–14:30",
                detail: "J-3007 runs on A1 11:30–14:30, clearing the 2h overlap on B2.", note: some("same stock, no wash-up"), value: 6_200,
                confidence: some(0.9),
                change: variant("print", jobsPatch(printJobs, [["J-3007", { ...loyaltyCards, press: some("a1"),
                    start: some(new Date("2026-10-20T11:30:00Z")), end: some(new Date("2026-10-20T14:30:00Z")) }]])) })],
            ["2-delay", option({ label: "12:00 on B2", title: "Start job J-3007 at 12:00 on Press B2", summary: "B2 · 12:00–15:00",
                detail: "J-3007 runs on B2 12:00–15:00, 2h before the 17:00 van.", note: some("clears the overlap · ends 15:00"), value: 4_100,
                confidence: some(0.8),
                change: variant("print", jobsPatch(printJobs, [["J-3007", { ...loyaltyCards,
                    start: some(new Date("2026-10-20T12:00:00Z")), end: some(new Date("2026-10-20T15:00:00Z")) }]])) })],
            ["3-a2", option({ label: "Press A2", title: "Move job J-3007 from Press B2 to Press A2", summary: "A2 · 10:00–13:00",
                detail: "J-3007 runs on A2 10:00–13:00.", value: 0, refused: some("takes no board stock"),
                change: variant("print", jobsPatch(printJobs, [["J-3007", { ...loyaltyCards, press: some("a2") }]])) })],
        ], byString),
    }],
    ["yard-ld2235", {
        area: "yard", scope: "Kiln yard", due: some(new Date("2026-03-10T14:00:00Z")), routine: false, unit: "uplift", figure: variant("money", null),
        model: "yard-fit · run #77",
        why: "K-305 is free on Tue 11 and takes 4–10 m³: LD-2235's 8 m³ dries its 9 days there before the kiln's next planned charge on Thu 20. The bulk kilns take no load under 40 m³.",
        ifWrong: some(-600), recommended: "1-k305",
        options: new SortedMap([
            ["1-k305", option({ label: "K-305", title: "Load LD-2235 (8 m³) into kiln K-305", summary: "K-305 · Tue 11 14:15",
                detail: "K-305 dries it Tue 11 14:15 – Thu 20 and fills to 8 of 10 m³.", note: some("fits best"), value: 1_900,
                confidence: some(0.88), question: some("Has LD-2235 passed its moisture check?"),
                change: variant("yard", binPatch("3127", ld2235Bin("K-305", tue11))) })],
            ["2-k403", option({ label: "K-403 on Wed", title: "Hold LD-2235 for kiln K-403 on Wed 12", summary: "K-403 · Wed 12 07:15",
                detail: "K-403 dries it Wed 12 07:15 – Fri 21.", note: some("waits a day · $1.5k holding cost"), value: 400,
                confidence: some(0.7), warn: some("K-403 runs 2 m³ short of its 10 m³ minimum."),
                question: some("Has LD-2235 passed its moisture check?"),
                change: variant("yard", binPatch("3204", ld2235Bin("K-403", wed12))) })],
            ["3-k601", option({ label: "K-601", title: "Load LD-2235 (8 m³) into kiln K-601", summary: "K-601 · Tue 11 14:15",
                detail: "K-601 dries it Tue 11 14:15 – Thu 20.", value: 0, refused: some("bulk kiln · takes no load under 40 m³"),
                change: variant("yard", binPatch("3127", ld2235Bin("K-601", tue11))) })],
        ], byString),
    }],
    ["stock-c5", {
        area: "stock", scope: "Replenishment", due: some(new Date("2026-03-10T16:00:00Z")), routine: false, unit: "uplift", figure: variant("money", null),
        model: "replen-v1.4 · run #31",
        why: "Week 10 demand runs 9% above forecast. Without an order, the C5 envelopes fall under their 400-unit safety level in week 11; the supplier needs 6 days.",
        ifWrong: some(-5_000), recommended: "1-q2000",
        options: new SortedMap([
            ["1-q2000", option({ label: "2,000 units", title: "Reorder 2,000 units of C5 envelopes", summary: "on order 0 → 2,000",
                detail: "Arrives Mar 16.", note: some("stock-out risk 3%"), value: 42_000, confidence: some(0.77),
                change: variant("stock", stockPatch("c5", 2_000, 3)) })],
            ["2-q1500", option({ label: "1,500 units", title: "Reorder 1,500 units of C5 envelopes", summary: "on order 0 → 1,500",
                detail: "Arrives Mar 16.", note: some("stock-out risk 9%"), value: 35_000, confidence: some(0.75),
                change: variant("stock", stockPatch("c5", 1_500, 9)) })],
            ["3-wait", option({ label: "Wait a week", title: "Wait a week to reorder C5 envelopes", summary: "no order this week",
                detail: "No order this week.", note: some("stock-out risk 34% in wk 11"), value: 18_000, confidence: some(0.6),
                warn: some("Stock falls under the safety level in week 11."),
                change: variant("stock", stockPatch("c5", 0, 34)) })],
        ], byString),
    }],
    ["workshop-press1", {
        area: "workshop", scope: "Fabrication", due: some(new Date("2026-03-10T17:00:00Z")), routine: false, unit: "uplift", figure: variant("money", null),
        model: "fab-sched · run #12",
        why: "Press 1's preventive maintenance overlaps the mounting brackets on Thursday. Saturday morning is free on Press 1 and inside the service interval.",
        ifWrong: some(-900), recommended: "1-sat",
        options: new SortedMap([
            ["1-sat", option({ label: "Sat 06:00", title: "Move Press 1 maintenance to Sat 06:00", summary: "Press 1 · Sat 3 06:00–08:00",
                detail: "Clears the overlap with the mounting brackets · $380 call-out.", value: 2_400, confidence: some(0.74),
                question: some("Is A. Ash free on Saturday at 06:00?"),
                change: variant("workshop", servicesPatch("service1", { ...pressOneService,
                    start: new Date("2026-10-03T06:00:00Z"), end: new Date("2026-10-03T08:00:00Z") })) })],
            ["2-keep", option({ label: "Keep Thu 09:00", title: "Keep Press 1 maintenance on Thu 09:00", summary: "no change",
                detail: "No change to the calendar.", note: some("the overlap with the mounting brackets stays"), value: 0,
                change: variant("workshop", servicesPatch("service1", pressOneService)) })],
        ], byString),
    }],
    ["price-coast", {
        area: "pricing", scope: "Regional list prices", due: some(new Date("2026-03-13T17:00:00Z")), routine: false, unit: "uplift / mo",
        figure: variant("money", null), model: "demand-coast · query 2h ago",
        why: "Coast demand is less sensitive to price than other regions, at an elasticity of −0.42. Competitors sit at a median of $11.20.",
        ifWrong: some(-6_100), recommended: "1-p1100",
        options: new SortedMap([
            ["1-p1100", option({ label: "$11.00", title: "Raise the Coast list price to $11.00", summary: "Coast $10.50 → $11.00",
                detail: "Demand −2.0% · revenue +2.7%.", value: 17_400, confidence: some(0.74),
                change: variant("pricing", pricesPatch("coast", 11.00, 13_916)) })],
            ["2-p1075", option({ label: "$10.75", title: "Raise the Coast list price to $10.75", summary: "Coast $10.50 → $10.75",
                detail: "Demand −1.0% · revenue +1.4%.", value: 9_100, confidence: some(0.79),
                change: variant("pricing", pricesPatch("coast", 10.75, 14_058)) })],
            ["3-hold", option({ label: "Hold at $10.50", title: "Hold the Coast list price at $10.50", summary: "no change",
                detail: "No change to prices.", note: some("margin stays at 18%"), value: 0,
                change: variant("pricing", pricesPatch("coast", 10.50, 14_200)) })],
        ], byString),
    }],
    // The week's overtime, read by what it costs: two overtime shifts to people under contract, and an agency request to a third.
    ["rota-overtime", {
        area: "rota", scope: "Warehouse · W10", due: some(new Date("2026-03-13T17:00:00Z")), routine: false, unit: "saved / wk",
        figure: variant("money", null), model: "roster-opt · run #204",
        why: "Week 10 carries 60h of overtime and two agency requests while B. Pumice, N. Ochre and J. Quartz sit under contract. Moving 3 shifts to them cuts overtime and agency cost.",
        ifWrong: some(-2_100), recommended: "1-all",
        options: new SortedMap([
            ["1-all", option({ label: "All 3 changes", title: "Rebalance week 10 across 3 people", summary: "3 shifts · 3 people",
                detail: "Overtime falls from 60h to 56h and Thursday's early agency request goes.", value: 156, confidence: some(0.81),
                change: variant("rotaCost", dutiesTo([["s295", "jquartz"], ["s104", "nochre"], ["s217", "bpumice"]])) })],
            ["2-overtime", option({ label: "Overtime only", title: "Move only the 2 overtime shifts in week 10", summary: "2 shifts · 2 people",
                detail: "Overtime falls from 60h to 56h; the agency requests stay.", note: some("agency stays at 2 requests"), value: 84,
                confidence: some(0.84),
                change: variant("rotaCost", dutiesTo([["s295", "jquartz"], ["s104", "nochre"]])) })],
            ["3-keep", option({ label: "Keep as rostered", title: "Keep week 10 as rostered", summary: "no change",
                detail: "No change to the roster.", note: some("60h of overtime stays"), value: 0,
                change: variant("rotaCost", dutiesPatch(overtime.map(key => [key, warehouseDuties.get(key)!] as const))) })],
        ], byString),
    }],
    // A causal estimate: line 2's slow cure, its bond strength the figure.
    ["trial-cure", {
        area: "trial", scope: "Line 2", due: some(new Date("2026-03-12T17:00:00Z")), routine: false, unit: "MPa bond", figure: variant("count", null),
        model: "causal · slow_cure · 2d ago",
        why: "Slow cure raises bond strength by 5.2 MPa (95% 3.9 to 6.5) after adjusting for line and resin batch. All four refutation checks pass.",
        ifWrong: some(-16), recommended: "1-switch",
        options: new SortedMap([
            ["1-switch", option({ label: "Switch now", title: "Switch line 2 to slow cure", summary: "cure 40 → 55 min",
                detail: "Throughput falls from 120 to 104 / h.", note: some("4 of 4 checks pass"), value: 5.2, confidence: some(0.86),
                change: variant("trial", curePatch("line-2", { cure: 55, bond: 46.2 })) })],
            ["2-trial", option({ label: "Trial first", title: "Run a 2-week trial of slow cure on line 2", summary: "48 batches · half slow",
                detail: "Decide on Mar 24 with the trial result.", note: some("confirms the effect first"), value: 0, confidence: some(0.95),
                change: variant("trial", curePatch("line-2", { trialBatches: 48n })) })],
        ], byString),
    }],
    // The Sheet's cells filled from history, one a guess.
    ["orders-ready", {
        area: "orders", scope: "Workshop orders", due: some(new Date("2026-03-11T17:00:00Z")), routine: false, unit: "due dates",
        figure: variant("count", null), model: "sheet copilot · 5m ago",
        why: "WO-1005, WO-1007 and WO-1008 can't be scheduled while they have no due date. 38 similar orders on the same work centres give a date for each.",
        ifWrong: none, recommended: "1-all",
        options: new SortedMap([
            ["1-all", option({ label: "Fill all 3", title: "Fill 3 due dates on the ready orders from history", summary: "3 due dates",
                detail: "WO-1005, WO-1007 and WO-1008 are given due dates and set Scheduled.", value: 3, confidence: some(0.91),
                guesses: new SortedMap([["WO-1007", 0.69]], byString),
                change: variant("orders", ordersPatch([["WO-1005", mon16], ["WO-1007", tue17], ["WO-1008", wed18]])) })],
            ["2-sure", option({ label: "Fill the 2 sure ones", title: "Fill the 2 due dates the copilot is sure of", summary: "2 due dates",
                detail: "WO-1007 stays without a due date.", note: some("conf 0.95 or more"), value: 2, confidence: some(0.96),
                change: variant("orders", ordersPatch([["WO-1005", mon16], ["WO-1008", wed18]])) })],
        ], byString),
    }],
    // Routine: the band at the end, applied together.
    ["rota-trim", {
        area: "rota", scope: "Inbound · W10", due: none, routine: true, unit: "uplift", figure: variant("money", null),
        model: "roster-opt · run #204",
        why: "C. Kestrel's late and S. Meadow's night on Thursday run 10h, and neither agreed to the extra 2h.",
        ifWrong: none, recommended: "1-trim",
        options: new SortedMap([
            ["1-trim", option({ label: "Trim", title: "Trim 4h from Thursday's long shifts", summary: "2 shifts · 10h → 8h",
                detail: "C. Kestrel's late and S. Meadow's night end 2h earlier.", value: 168,
                change: variant("rota", thursdayTrim) })],
        ], byString),
    }],
    ["cover-saturday", {
        area: "cover", scope: "Inbound · Sat 11", due: none, routine: true, unit: "uplift", figure: variant("money", null),
        model: "cover-plan · run #8",
        why: "Saturday's inbound early has 11 rostered against a target of 12; the forecast's unloading fits 11.",
        ifWrong: none, recommended: "1-trim",
        options: new SortedMap([
            ["1-trim", option({ label: "Trim", title: "Trim Saturday's inbound early cover by one", summary: "heads 12 → 11",
                detail: "Saturday's inbound early needs 11, the heads rostered.", value: 408,
                change: variant("cover", saturdayCover) })],
        ], byString),
    }],
    ["ready-a1", {
        area: "ready", scope: "Press A1", due: none, routine: true, unit: "days", figure: variant("count", null),
        model: "eta-forecast · run #3",
        why: "Press A1's new rollers fit on Wednesday; the forecast has it ready two days later.",
        ifWrong: none, recommended: "1-confirm",
        options: new SortedMap([
            ["1-confirm", option({ label: "Confirm", title: "Confirm Press A1 ready in ~2 days", summary: "confirmed",
                detail: "Press A1's readiness is confirmed.", value: 2,
                change: variant("ready", pressA1Ready) })],
        ], byString),
    }],
], byString);

/** The cases, the app's record of them, keyed by case. */
const OpsCasesType = DictType(StringType, OpsCase);

/** The models' mutation of their cases: a run's cases in, each under a key of its own, and the cases decided since out. */
const proposeCases = East.function([OpsCasesType, OpsCasesType, SetType(StringType)], OpsCasesType, ($, cases, run, decided) => {
    const next = $.let(cases.copy());
    $(next.unionInPlace(run, (_$, _held, proposed) => proposed));
    return next.filter((_$, _row, key) => decided.has(key).not());
});

/** The price list, a record no builder draws, written through its patch door. */
export const listPrices = e3.record("list_prices", DictType(StringType, ListPrice), {
    initial: listPriceRows,
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** The stock levels, a record no builder draws, written through their patch door. */
export const stockLevels = e3.record("stock_levels", DictType(StringType, StockLevel), {
    initial: stockLevelRows,
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** The lines' cure settings, a record no builder draws, written through their patch door. */
export const cureSettings = e3.record("cure_settings", DictType(StringType, CureSetting), {
    initial: cureSettingRows,
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** The presses' readiness, a record no builder draws, written through its patch door. */
export const pressReadiness = e3.record("press_readiness", DictType(StringType, PressReadiness), {
    initial: pressReadinessRows,
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** The models' cases: the app's record, filled by its own mutation — e3's tasks read records and never write them. */
export const opsCases = e3.record("ops_cases", OpsCasesType, {
    initial: opsCaseRows,
    indexes: (index) => ({
        // The app's own fields, which the rail narrows the cases by.
        ops_cases_by_area: index.on(["area"]),
        ops_cases_by_scope: index.on(["scope"]),
    }),
    mutations: (mutation) => ({
        ops_propose: mutation.reduce(proposeCases),
    }),
});

/** The people's verdicts: the record the queue writes, through its patch door. */
export const opsVerdicts = e3.record("ops_verdicts", DictType(StringType, OpsVerdict), {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

// ============================================================================
// The smallest queue's (§3.2)
// ============================================================================

/** What a proposal changes: its tag is the kind of decision, its value a patch of the record that kind changes. */
export const ProposalDetails = VariantType({
    orders: PatchType(DictType(StringType, OptimiseWorkOrder)),  // the shop's work orders
    pricing: PatchType(DictType(StringType, ListPrice)),         // the price list
});

/** A proposal of the app's model, in the app's own words: one decision, no alternatives. */
export const Proposal = StructType({
    site: StringType, deadline: OptionType(DateTimeType), metric: StringType, run: StringType, rationale: StringType,
    headline: StringType, brief: StringType, description: StringType, saving: FloatType, details: ProposalDetails,
});

/** The model's proposals: a price for the North region by Friday, and a due date for the first ready order by 17:00 today. */
export const proposalRows: SortedMap<string, ValueTypeOf<typeof Proposal>> = new SortedMap<string, ValueTypeOf<typeof Proposal>>([
    ["prop-north", {
        site: "Regional list prices", deadline: some(new Date("2026-03-13T17:00:00Z")), metric: "uplift / mo", run: "demand-north · query 1h ago",
        rationale: "North demand held at $11.20 through the last two rises; competitors sit at $11.60.",
        headline: "Raise the North list price to $11.50", brief: "North $11.20 → $11.50", description: "Demand −1.2% · revenue +1.4%.",
        saving: 4_300, details: variant("pricing", pricesPatch("north", 11.50, 6_027)),
    }],
    ["prop-wo1005", {
        site: "Workshop orders", deadline: some(new Date("2026-03-10T17:00:00Z")), metric: "orders", run: "sheet copilot · 5m ago",
        rationale: "WO-1005 is ready with no due date; its work centre is free from Monday.",
        headline: "Schedule WO-1005 for Mon 16 Mar", brief: "WO-1005 · due Mon 16 Mar", description: "WO-1005 is given a due date and set Scheduled.",
        saving: 1, details: variant("orders", ordersPatch([["WO-1005", mon16]])),
    }],
], byString);

/** The model's proposals, the rail narrowing them by site. */
export const proposals = e3.record("proposals", DictType(StringType, Proposal), {
    initial: proposalRows,
    indexes: (index) => ({
        proposals_by_site: index.on(["site"]),
    }),
});
/** The verdicts on them, which the queue writes through their patch door. */
export const proposalVerdicts = e3.record("proposal_verdicts", DictType(StringType, OpsVerdict), {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

// ============================================================================
// The routine queue's (§15)
// ============================================================================

/** What a routine change changes: its tag is the kind of decision, its value a patch of the record that kind changes. */
export const RoutineChange = VariantType({
    rota: PatchType(DictType(StringType, WarehouseDuty)),        // the warehouse rota's duties, as the Roster draws them
    cover: PatchType(DictType(StringType, WarehouseCover)),      // the rota's cover targets
    ready: PatchType(DictType(StringType, PressReadiness)),      // the presses' readiness
});

/** A routine change of the models', in the app's own words: its own one proposal, applied with the others in one go. */
export const Routine = StructType({
    scope: StringType, unit: StringType, figure: VariantType({ money: NullType, count: NullType }), model: StringType, why: StringType,
    title: StringType, summary: StringType, detail: StringType, value: FloatType, change: RoutineChange,
});

/** The routine changes the models left, the mock's like for like: the Ops cases' routine band, each its own proposal. */
export const routineRows: SortedMap<string, ValueTypeOf<typeof Routine>> = new SortedMap<string, ValueTypeOf<typeof Routine>>([
    ["rota-trim", {
        scope: "Inbound · W10", unit: "uplift", figure: variant("money", null), model: "roster-opt · run #204",
        why: "C. Kestrel's late and S. Meadow's night on Thursday run 10h, and neither agreed to the extra 2h.",
        title: "Trim 4h from Thursday's long shifts", summary: "2 shifts · 10h → 8h", detail: "C. Kestrel's late and S. Meadow's night end 2h earlier.",
        value: 168, change: variant("rota", thursdayTrim),
    }],
    ["cover-saturday", {
        scope: "Inbound · Sat 11", unit: "uplift", figure: variant("money", null), model: "cover-plan · run #8",
        why: "Saturday's inbound early has 11 rostered against a target of 12; the forecast's unloading fits 11.",
        title: "Trim Saturday's inbound early cover by one", summary: "heads 12 → 11", detail: "Saturday's inbound early needs 11, the heads rostered.",
        value: 408, change: variant("cover", saturdayCover),
    }],
    ["ready-a1", {
        scope: "Press A1", unit: "days", figure: variant("count", null), model: "eta-forecast · run #3",
        why: "Press A1's new rollers fit on Wednesday; the forecast has it ready two days later.",
        title: "Confirm Press A1 ready in ~2 days", summary: "confirmed", detail: "Press A1's readiness is confirmed.",
        value: 2, change: variant("ready", pressA1Ready),
    }],
], byString);

/** The routine changes, a record of the models'. */
export const routines = e3.record("routines", DictType(StringType, Routine), {
    initial: routineRows,
});
/** The verdicts on them, which the queue writes through their patch door. */
export const routineVerdicts = e3.record("routine_verdicts", DictType(StringType, OpsVerdict), {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
