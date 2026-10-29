/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The decision queue's example app (#1447, `Decision Queue Spec.md` §3.1,
 * §3.2): a warehouse, a print shop, a kiln yard and a workshop under one roof
 * — the repo's own example records — whose models propose changes to each.
 * Its cases are one record, every kind of decision in it: an option's change
 * is a variant, its tag the kind of decision and its value a patch of the
 * record that kind changes, built with East's own diff of the rows it touches.
 * Its verdicts are another record, which the queue writes; the price list is a
 * record no builder draws. Beside them, the smallest queue's: a record of the
 * model's proposals, each one decision with no alternatives, and its
 * verdicts. Every name and figure is generated.
 */
import {
    BooleanType, DateTimeType, DictType, East, FloatType, NullType, OptionType, PatchType, SetType, SortedMap, SortedSet, StringType, StructType,
    VariantType, compareFor, diffFor, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { KilnBin } from "../allocation/kiln-yard.js";
import { CalendarJob } from "../calendar/calendar.examples.js";
import { PrintJob, planEventJobs } from "../plan/plan-events.examples.js";
import { WarehouseDuty, warehouseDuties } from "../roster/warehouse.js";
import { OptimiseWorkOrder, optimiseWorkOrderRows } from "../sheet/optimise.examples.js";

// ============================================================================
// The app's records (§3.1)
// ============================================================================

/** A list price, and the demand a week the model expects at it: a record no builder draws. */
export const ListPrice = StructType({ region: StringType, price: FloatType, demand: FloatType, from: DateTimeType });

/** What an option changes: its tag is the kind of decision, its value a patch of the record that kind changes. */
export const OpsChange = VariantType({
    rota: PatchType(DictType(StringType, WarehouseDuty)),        // cover: the warehouse rota's duties, as the Roster draws them
    rotaCost: PatchType(DictType(StringType, WarehouseDuty)),    // pay: the same duties, a change read by what it costs
    print: PatchType(DictType(StringType, PrintJob)),            // the print shop's jobs, as the Plan draws them
    workshop: PatchType(DictType(StringType, CalendarJob)),      // the workshop's machine jobs, as the Calendar draws them
    yard: PatchType(DictType(StringType, KilnBin)),              // the kiln yard's bins, as the Allocation draws them
    orders: PatchType(DictType(StringType, OptimiseWorkOrder)),  // the shop's work orders, as the Sheet draws them
    pricing: PatchType(DictType(StringType, ListPrice)),         // the price list, which no builder draws
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
    money: BooleanType,                // whether its figures are money, or a count — the orders'
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

const byString = compareFor(StringType);
/** The price list's rows, by region. */
type PriceRow = ValueTypeOf<typeof ListPrice>;
/** The price list's patch, as a model diffs the rows it touches. */
const diffPrices = diffFor(DictType(StringType, ListPrice));
/** The work orders' patch, as a model diffs the rows it touches. */
const diffOrders = diffFor(DictType(StringType, OptimiseWorkOrder));
/** When this quarter's prices took effect. */
const pricesFrom = new Date("2028-01-01T00:00:00Z");

/** The price list: a row a region, each with the demand a week the model expects at it. */
export const listPriceRows: SortedMap<string, PriceRow> = new SortedMap<string, PriceRow>([
    ["central", { region: "Central", price: 10.80, demand: 9_600, from: pricesFrom }],
    ["coast", { region: "Coast", price: 10.50, demand: 14_200, from: pricesFrom }],
    ["north", { region: "North", price: 11.20, demand: 6_100, from: pricesFrom }],
    ["west", { region: "West", price: 10.90, demand: 7_800, from: pricesFrom }],
], byString);

/** The price list's patch changing one region's price and the demand the model expects at it: the patch of that row alone. */
function pricesPatch(key: string, price: number, demand: number) {
    const row = listPriceRows.get(key)!;
    return diffPrices(new SortedMap([[key, row]], byString), new SortedMap([[key, { ...row, price, demand }]], byString));
}
/** The work orders' patch scheduling ready orders, each due on its date: the patch of those rows alone. */
function ordersPatch(dues: readonly (readonly [string, Date])[]) {
    const before = new SortedMap(dues.map(([key]) => [key, optimiseWorkOrderRows.get(key)!] as const), byString);
    const after = new SortedMap(dues.map(([key, due]) => [key, { ...optimiseWorkOrderRows.get(key)!, status: "Scheduled", due: some(due) }] as const), byString);
    return diffOrders(before, after);
}
/** A duty of the warehouse's rota. */
type DutyRow = ValueTypeOf<typeof WarehouseDuty>;
/** The duties' patch, as a model diffs the rows it touches. */
const diffDuties = diffFor(DictType(StringType, WarehouseDuty));
/**
 * The duties' patch changing the duties given — each to the row it becomes, `undefined` where the model removes it —
 * from the rows as the rota holds them: the patch of those rows alone, a key the rota has not a new duty.
 */
function dutiesPatch(changes: readonly (readonly [string, DutyRow | undefined])[]) {
    const before = new SortedMap(changes.flatMap(([key]) => {
        const row = warehouseDuties.get(key);
        return row === undefined ? [] : [[key, row] as const];
    }), byString);
    const after = new SortedMap(changes.flatMap(([key, row]) => (row === undefined ? [] : [[key, row] as const])), byString);
    return diffDuties(before, after);
}
/** A print job of the shop's. */
type JobRow = ValueTypeOf<typeof PrintJob>;
/** The jobs' patch, as a model diffs the rows it touches. */
const diffJobs = diffFor(DictType(StringType, PrintJob));
/** The print works' jobs, as the shop's record holds them. */
const printJobs = planEventJobs.default!;
/** The jobs' patch changing one job to the row it becomes, from the row as the shop's record holds it: the patch of that row alone. */
function jobsPatch(key: string, row: JobRow) {
    return diffJobs(new SortedMap([[key, printJobs.get(key)!]], byString), new SortedMap([[key, row]], byString));
}
/** J-3007's loyalty cards on Press B2, 10:00–13:00 on the 20th: two hours over J-3006's market posters there. */
const loyaltyCards = printJobs.get("J-3007")!;
/** J. Tansy's Friday late, 14:00–22:00: the week's fifth shift of theirs, 4 h past their 38. */
const tansyFriday = warehouseDuties.get("s234")!;
/** Thursday's agency request on the late picking shift, whose fields a request for Saturday's takes. */
const thursdayRequest = warehouseDuties.get("s250")!;
const saturdayLate = new Date("2028-03-11T14:00:00Z");
const saturdayLateEnd = new Date("2028-03-11T22:00:00Z");
/** Monday to Wednesday of the week after the warehouse's: the days the shop's ready orders fall due. */
const mon13 = new Date("2028-03-13T00:00:00Z");
const tue14 = new Date("2028-03-14T00:00:00Z");
const wed15 = new Date("2028-03-15T00:00:00Z");
/** An option of the app's, its optional parts left out. */
function option(row: Pick<ValueTypeOf<typeof OpsOption>, "label" | "title" | "summary" | "detail" | "value" | "change">
    & Partial<ValueTypeOf<typeof OpsOption>>): ValueTypeOf<typeof OpsOption> {
    return {
        note: none, confidence: none, question: none, warn: none, refused: none,
        knockOn: new SortedSet<string>([], byString), guesses: new SortedMap<string, number>([], byString), ...row,
    };
}

/**
 * The cases the models left: who takes J. Tansy's Friday late, and a request for Saturday's open late — routine — on
 * the warehouse's rota; where the print works' J-3007 runs, overlapping J-3006 on Press B2; a price for the Coast
 * region; and the shop's ready work orders.
 */
export const opsCaseRows: SortedMap<string, ValueTypeOf<typeof OpsCase>> = new SortedMap<string, ValueTypeOf<typeof OpsCase>>([
    ["rota-tansy", {
        area: "rota", scope: "Picking · W10", due: some(new Date("2028-03-08T13:00:00Z")), routine: false, unit: "uplift", money: true,
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
    ["rota-saturday", {
        area: "rota", scope: "Picking · W10", due: none, routine: true, unit: "uplift", money: true,
        model: "roster-opt · run #204",
        why: "Saturday's late picking shift is one short of its seven; Northside Staffing can fill it.",
        ifWrong: none, recommended: "1-request",
        options: new SortedMap([
            ["1-request", option({ label: "Request", title: "Request an agency late on Saturday", summary: "Agency · Sat 14–22",
                detail: "Northside Staffing covers Saturday 14–22.", value: 1_200,
                change: variant("rota", dutiesPatch([["s319", { ...thursdayRequest, start: saturdayLate, end: saturdayLateEnd }]])) })],
        ], byString),
    }],
    ["print-j3007", {
        area: "print", scope: "Print works · Hall B", due: some(new Date("2028-03-08T14:25:00Z")), routine: false, unit: "uplift", money: true,
        model: "press-sched-v2 · run #118",
        why: "J-3006 runs on Press B2 until 12:00, so J-3007 overlaps it for two hours. Press A1 is free from 11:00 and carries the same stock.",
        ifWrong: some(-1_800), recommended: "1-a1",
        options: new SortedMap([
            ["1-a1", option({ label: "Press A1", title: "Move job J-3007 from Press B2 to Press A1", summary: "A1 · 11:30–14:30",
                detail: "J-3007 runs on A1 11:30–14:30, clearing the 2h overlap on B2.", note: some("same stock, no wash-up"), value: 6_200,
                confidence: some(0.9),
                change: variant("print", jobsPatch("J-3007", { ...loyaltyCards, press: some("a1"),
                    start: some(new Date("2026-10-20T11:30:00Z")), end: some(new Date("2026-10-20T14:30:00Z")) })) })],
            ["2-delay", option({ label: "12:00 on B2", title: "Start job J-3007 at 12:00 on Press B2", summary: "B2 · 12:00–15:00",
                detail: "J-3007 runs on B2 12:00–15:00, 2h before the 17:00 van.", note: some("clears the overlap · ends 15:00"), value: 4_100,
                confidence: some(0.8),
                change: variant("print", jobsPatch("J-3007", { ...loyaltyCards,
                    start: some(new Date("2026-10-20T12:00:00Z")), end: some(new Date("2026-10-20T15:00:00Z")) })) })],
            ["3-a2", option({ label: "Press A2", title: "Move job J-3007 from Press B2 to Press A2", summary: "A2 · 10:00–13:00",
                detail: "J-3007 runs on A2 10:00–13:00.", value: 0, refused: some("takes no board stock"),
                change: variant("print", jobsPatch("J-3007", { ...loyaltyCards, press: some("a2") })) })],
        ], byString),
    }],
    ["price-coast", {
        area: "pricing", scope: "Regional list prices", due: some(new Date("2028-03-10T17:00:00Z")), routine: false, unit: "uplift / mo", money: true,
        model: "demand-coast · query 2h ago",
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
    ["orders-ready", {
        area: "orders", scope: "Workshop orders", due: some(new Date("2028-03-08T17:00:00Z")), routine: false, unit: "orders", money: false,
        model: "sheet copilot · 5m ago",
        why: "Three orders are ready with no due date. The shop's next free days on their work centres give each one.",
        ifWrong: none, recommended: "1-all",
        options: new SortedMap([
            ["1-all", option({ label: "All three", title: "Schedule the three ready orders", summary: "3 orders",
                detail: "WO-1005, WO-1007 and WO-1008 are given due dates and set Scheduled.", value: 3, confidence: some(0.91),
                guesses: new SortedMap([["WO-1007", 0.69]], byString),
                change: variant("orders", ordersPatch([["WO-1005", mon13], ["WO-1007", tue14], ["WO-1008", wed15]])) })],
            ["2-first", option({ label: "WO-1005 only", title: "Schedule WO-1005 alone", summary: "1 order",
                detail: "WO-1005 is given a due date; the other two stay ready.", value: 1, confidence: some(0.96),
                change: variant("orders", ordersPatch([["WO-1005", mon13]])) })],
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
export const listPrices = e3.record("list_prices", DictType(StringType, ListPrice), listPriceRows);
export const listPricesPatch = e3.mutation.patch(listPrices);

// The models' cases: the app's record, filled by its own mutation — e3's tasks read records and never write them.
export const opsCases = e3.record("ops_cases", OpsCasesType, opsCaseRows);
export const opsCasesPropose = e3.mutation.reduce("ops_propose", opsCases, proposeCases);
export const opsCasesByArea = e3.recordIndex("ops_cases_by_area", opsCases, { on: ["area"] });
export const opsCasesByScope = e3.recordIndex("ops_cases_by_scope", opsCases, { on: ["scope"] });

// The people's verdicts: the record the queue writes.
export const opsVerdicts = e3.record("ops_verdicts", DictType(StringType, OpsVerdict), new Map());
export const opsVerdictsPatch = e3.mutation.patch(opsVerdicts);

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

/** The model's proposals: a price for the North region, and a due date for the first ready order. */
export const proposalRows: SortedMap<string, ValueTypeOf<typeof Proposal>> = new SortedMap<string, ValueTypeOf<typeof Proposal>>([
    ["prop-north", {
        site: "Regional list prices", deadline: some(new Date("2028-03-10T17:00:00Z")), metric: "uplift / mo", run: "demand-north · query 1h ago",
        rationale: "North demand held at $11.20 through the last two rises; competitors sit at $11.60.",
        headline: "Raise the North list price to $11.50", brief: "North $11.20 → $11.50", description: "Demand −1.2% · revenue +1.4%.",
        saving: 4_300, details: variant("pricing", pricesPatch("north", 11.50, 6_027)),
    }],
    ["prop-wo1005", {
        site: "Workshop orders", deadline: some(new Date("2028-03-08T17:00:00Z")), metric: "orders", run: "sheet copilot · 5m ago",
        rationale: "WO-1005 is ready with no due date; its work centre is free from Monday.",
        headline: "Schedule WO-1005 for Mon 13 Mar", brief: "WO-1005 · due Mon 13 Mar", description: "WO-1005 is given a due date and set Scheduled.",
        saving: 1, details: variant("orders", ordersPatch([["WO-1005", mon13]])),
    }],
], byString);

export const proposals = e3.record("proposals", DictType(StringType, Proposal), proposalRows);
export const proposalsBySite = e3.recordIndex("proposals_by_site", proposals, { on: ["site"] });
export const proposalVerdicts = e3.record("proposal_verdicts", DictType(StringType, OpsVerdict), new Map());
export const proposalVerdictsPatch = e3.mutation.patch(proposalVerdicts);
