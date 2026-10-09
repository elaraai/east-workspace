/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's library pane on the wire (#1195, `Plan Builder Spec.md` §4.3,
 * §9.6, PB26, PB29, PB61, PB62): the tabs `library` lists, in its order, and
 * none without it; the Series tab's lines, in the order the canvas draws them,
 * and what hiding each hides; an author's tab's cards, and what a card dropped
 * on an event sets (`Schedule.patch`); and every refusal at build, naming
 * itself. What the viewer hides leaves the event kinds' rows in
 * `plan-event-rows.spec.ts`, and the pane the renderer draws is
 * e3-ui-components'.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType,
    encodeBeast2For, equalFor, isTypeEqual, none, some, variant,
    type BlockBuilder, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Data, Plan, PlanLibraryCardType, PlanLibraryTabType, PlanPayloadType, Record, Schedule } from "@elaraai/e3-ui/internal";
import { memoryData, memoryRecords } from "../schedule/memory-records.js";
import * as ex from "./plan-events.examples.js";

// ============================================================================
// The print works, in memory
// ============================================================================

/** An input's authored value: its `value` source. */
function valueOf(source: unknown): unknown {
    const s = source as { type: string; value: unknown } | undefined;
    if (s?.type !== "value") throw new Error("expected an input seeded with its value");
    return s.value;
}

/** The examples' records and datasets, each holding its seed, as the runtimes read them. */
const PLATFORM = [
    ...memoryRecords(new Map<string, unknown>([
        [ex.planPrintPresses.name, ex.planPrintPresses.default],
        [ex.planPrintCrews.name, ex.planPrintCrews.default],
        [ex.planPrintJobs.name, ex.planPrintJobs.default],
        [ex.planPrintStops.name, ex.planPrintStops.default],
        [ex.planPrintShifts.name, ex.planPrintShifts.default],
        [ex.planPrintCustomers.name, ex.planPrintCustomers.default],
        [ex.planLinkJobs.name, ex.planLinkJobs.default],
    ])),
    ...memoryData(new Map<string, unknown>([
        [ex.planPrintUtilisation.name, valueOf(ex.planPrintUtilisation.source)],
        [ex.planLinkStock.name, valueOf(ex.planLinkStock.source)],
    ])),
];

type Payload = ValueTypeOf<typeof PlanPayloadType>;
type Tab = ValueTypeOf<typeof PlanLibraryTabType>;
type Card = ValueTypeOf<typeof PlanLibraryCardType>;

/** Build a payload in East and read it back, over the print works in memory. */
function payloadOf(build: ($: BlockBuilder<typeof PlanPayloadType>) => ExprType<typeof PlanPayloadType>): Payload {
    return East.compile(East.function([], PlanPayloadType, ($) => build($)), PLATFORM)() as Payload;
}

/** What `build` throws inside a block, as `<Plan>`'s factory runs; `""` when it builds. */
function refusal(build: ($: BlockBuilder<NullType>) => unknown): string {
    try {
        East.function([], NullType, ($) => { build($); });
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

const WINDOW = { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") };
const sameTab = equalFor(PlanLibraryTabType);
const sameCards = equalFor(ArrayType(PlanLibraryCardType));
const sameText = equalFor(OptionType(StringType));
const asText = encodeBeast2For(StringType);

/** The presses, bound inside a block. */
function pressesOf($: BlockBuilder<never>) {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    return Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name });
}

/** The jobs over the presses, bound inside a block, their unscheduled ones in the backlog. */
function jobsOf($: BlockBuilder<never>) {
    const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" },
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
    });
}

/** The customers' tab, bound inside a block: a card a customer, by district, which sets a job's customer. */
function customersOf($: BlockBuilder<never>, name = "Customers") {
    const customers = $.let(Record.bind(ex.planPrintCustomers, []));
    return Plan.library.tab(customers.read(), {
        name, icon: "building",
        label: (c) => c.name, meta: (c) => some(c.trade), group: (c) => c.district,
        drop: (c) => Schedule.patch(ex.PrintJob, { customer: c.name }),
    });
}

/** The tab of one kind, the first `library` lists. */
function tabOf<K extends Tab["type"]>(payload: Payload, kind: K): Extract<Tab, { type: K }> {
    const tab = payload.library.find((t) => t.type === kind);
    if (tab === undefined) assert.fail(`no ${kind} tab`);
    return tab as Extract<Tab, { type: K }>;
}

/** A Series line known at build: its id, title, subtitle and kind's glyph. */
const line = (id: string, title: string, subtitle: string | undefined, icon: string) => ({
    id, title, subtitle: subtitle === undefined ? none : some(subtitle),
    icon: some({ name: icon, prefix: "fas", label: none, style: none }), count: none, narrowed: false,
});

// ============================================================================
// The tabs `library` lists (PB26, PB61)
// ============================================================================

describe("the tabs `library` lists (PB26, PB61)", () => {
    test("in its order, each tab a `Plan.library.*` call; left out, or empty, there are none", () => {
        const plan = (library: ($: BlockBuilder<typeof PlanPayloadType>) => readonly ReturnType<typeof Plan.library.events>[] | undefined) =>
            payloadOf(($) => {
                const tabs = library($);
                return Plan.Payload({
                    axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                    resources: { presses: pressesOf($) }, events: { job: jobsOf($) },
                    ...(tabs === undefined ? {} : { library: tabs }),
                });
            });
        const listed = plan(($) => [Plan.library.series(), customersOf($), Plan.library.events(), Plan.library.backlog()]);
        assert.deepEqual(listed.library.map((t) => t.type), ["series", "tab", "events", "backlog"]);
        assert.ok(sameTab(listed.library[2]!, variant("events", null)) && sameTab(listed.library[3]!, variant("backlog", null)));
        assert.deepEqual(plan(() => undefined).library, []);
        assert.deepEqual(plan(() => []).library, []);
    });

    test("a Plan over its rows alone takes a library too: the Series tab lists its rows", () => {
        const payload = payloadOf(($) => {
            const stock = $.let(Data.bind(ex.planLinkStock));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "week" }),
                rows: [Plan.over(stock, [Plan.series.table(ex.PrintStock, { key: "stock", title: "Paper stock", label: (s) => s.name })])],
                library: [Plan.library.series()],
            });
        });
        assert.ok(sameTab(tabOf(payload, "series"), variant("series", {
            kinds: [],
            rows: [{ item: line("series.stock", "Paper stock", undefined, "table-list"), hides: variant("series", ["stock"]) }],
        })));
    });
});

// ============================================================================
// The Series tab (PB29)
// ============================================================================

describe("the Series tab (PB29)", () => {
    test("each resource kind followed by its measures, then the event kinds; then the Plan's rows — a hand-built row by its key, the rows nested in it going with it, a Plan.over series by its own — each with its glyph, and what hiding it hides", () => {
        const payload = payloadOf(($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const crews = $.let(Record.bind(ex.planPrintCrews, []));
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            const stops = $.let(Record.bind(ex.planPrintStops, [ex.planPrintStopsPatch]));
            const shifts = $.let(Record.bind(ex.planPrintShifts, [ex.planPrintShiftsPatch]));
            const stock = $.let(Data.bind(ex.planLinkStock));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                resources: {
                    presses: Schedule.resources(presses.read(), {
                        name: "Presses", icon: "print", label: (p) => p.name, group: (p) => p.hall,
                        measures: [
                            Plan.series.heat(ex.PrintPress, { key: "util", title: "Utilisation", label: () => "Utilisation", cells: () => Plan.heatCells([]) }),
                            Plan.series.table(ex.PrintPress, { key: "speed", title: "Speed", label: () => "Speed" }),
                        ],
                    }),
                    crews: Schedule.resources(crews.read(), { name: "Crews", icon: "user-group", label: (c) => c.name }),
                },
                events: {
                    job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
                    stop: Schedule.events(stops, { name: "Stop", icon: "screwdriver-wrench", title: "title", at: "at", resource: { field: "press", of: "presses" } }),
                    shift: Schedule.events(shifts, { name: "Crew shift", icon: "user-clock", draw: "cards", title: "title", start: "start", end: "end", resource: { field: "crew", of: "crews" } }),
                },
                rows: [
                    Plan.chart({ key: "output", label: "SHEETS / DAY", id: true, pinned: true, layers: [] }),
                    // One line for a hand-built row and the rows nested in it: hiding it hides them all.
                    Plan.span({ key: "works", label: "Planned works", rows: [
                        Plan.span({ key: "elec", label: "Electrical" }),
                        Plan.span({ key: "mech", label: "Mechanical" }),
                    ] }),
                    Plan.over(stock, [
                        Plan.series.section(ex.PrintStock, { key: "paper", title: "Paper" }, [
                            Plan.series.table(ex.PrintStock, { key: "stock", title: "Paper stock", label: (s) => s.name }),
                        ]),
                        Plan.series.events(ex.PrintStock, { key: "deliveries", title: "Deliveries", label: (s) => s.name, marks: () => [] }),
                    ]),
                    Plan.events({ key: "ms", label: "Milestones" }),
                ],
                library: [Plan.library.series()],
            });
        });
        assert.ok(sameTab(tabOf(payload, "series"), variant("series", {
            kinds: [
                line("resources.presses", "Presses", undefined, "print"),
                line("measures.util", "Utilisation", "Presses", "table-cells-large"),
                line("measures.speed", "Speed", "Presses", "table-list"),
                line("resources.crews", "Crews", undefined, "user-group"),
                line("events.job", "Print job", undefined, "file-lines"),
                line("events.stop", "Stop", undefined, "screwdriver-wrench"),
                line("events.shift", "Crew shift", undefined, "user-clock"),
            ],
            rows: [
                { item: line("rows.output", "SHEETS / DAY", undefined, "chart-line"), hides: variant("rows", "output") },
                { item: line("rows.works", "Planned works", undefined, "bars-staggered"), hides: variant("rows", "works") },
                { item: line("series.paper", "Paper", undefined, "heading"), hides: variant("series", ["paper", "stock"]) },
                { item: line("series.deliveries", "Deliveries", undefined, "flag"), hides: variant("series", ["deliveries"]) },
                { item: line("rows.ms", "Milestones", undefined, "flag"), hides: variant("rows", "ms") },
            ],
        })), JSON.stringify(tabOf(payload, "series").value.rows.map((r) => r.item.id)));
    });

    test("the Series tab is a Plan's with anything a viewer can hide: `data`'s series when they are picked, and nothing else", () => {
        const Row = StructType({ v: FloatType });
        const marks = Plan.series.events(Row, { key: "marks", title: "Marks", label: (_r, k) => k, marks: () => [] });
        assert.equal(refusal(($) => {
            const data = $.const(new Map([["a", { v: 1.0 }]]), DictType(StringType, Row));
            const all = $.const([marks], ArrayType(Plan.Types.Series(Row)));
            const picked = $.let(Plan.pick("lib.pick", all));
            return Plan.Payload({ axis: Plan.axis({ window: WINDOW, resolution: "day" }), data, pick: picked, library: [Plan.library.series()] });
        }), "");
        assert.match(refusal(($) => {
            const data = $.const(new Map([["a", { v: 1.0 }]]), DictType(StringType, Row));
            return Plan.Payload({ axis: Plan.axis({ window: WINDOW, resolution: "day" }), data, series: [marks], library: [Plan.library.series()] });
        }), /^Plan: the library lists Plan\.library\.series\(\), and this Plan has nothing a viewer can hide — it lists event kinds, resource kinds and their measures, `rows`, and `data`'s series when they are picked \(`pick`\)$/);
    });
});

// ============================================================================
// An author's tab (PB62)
// ============================================================================

describe("an author's tab (PB62)", () => {
    const withTab = (tab: ($: BlockBuilder<typeof PlanPayloadType>) => ReturnType<typeof Plan.library.tab>) => payloadOf(($) => {
        const own = tab($);
        return Plan.Payload({ axis: Plan.axis({ window: WINDOW, resolution: "day" }), resources: { presses: pressesOf($) }, events: { job: jobsOf($) }, library: [own] });
    });

    test("a card per row, in its rows' order: its key's text, its label, meta and group; its `drop` names the event kind a card lands on, and each card the field it sets, at its path, as bytes of its type", () => {
        const tab = tabOf(withTab(($) => customersOf($)), "tab");
        assert.deepEqual([tab.value.name, tab.value.cards.length], ["Customers", 16]);
        assert.ok(sameText(tab.value.icon, some("building")) && sameText(tab.value.drop, some("job")));
        assert.ok(sameCards(tab.value.cards.slice(0, 2), [
            { key: "alder-finch", label: "Alder & Finch", meta: some("Retail"), group: some("Old Town"), sets: [{ path: ["customer"], value: asText("Alder & Finch") }] },
            { key: "bluewater-tours", label: "Bluewater Tours", meta: some("Travel"), group: some("North Quay"), sets: [{ path: ["customer"], value: asText("Bluewater Tours") }] },
        ]));
        assert.deepEqual(tab.value.cards.map((c: Card) => c.key).slice(-2), ["northwind", "orchard-market"]);
    });

    test("a patch setting several fields sets each, in the row type's order; one clearing an Option field sets it to none", () => {
        const tab = tabOf(withTab(($) => {
            const customers = $.let(Record.bind(ex.planPrintCustomers, []));
            return Plan.library.tab(customers.read(), {
                name: "Customers", label: (c) => c.name,
                drop: (c) => Schedule.patch(ex.PrintJob, { stock: variant("board", null), customer: c.name, due: none }),
            });
        }), "tab");
        const Stock = ex.PrintJob.fields.stock;
        assert.ok(sameCards(tab.value.cards.slice(0, 1), [{
            key: "alder-finch", label: "Alder & Finch", meta: none, group: none, sets: [
                { path: ["customer"], value: asText("Alder & Finch") },
                { path: ["stock"], value: encodeBeast2For(Stock)(variant("board", null)) },
                { path: ["due"], value: encodeBeast2For(OptionType(DateTimeType))(none) },
            ],
        }]));
    });

    test("with no `drop`, no card lands: the tab names no kind and its cards set nothing; a key of another type than String is its text as East prints it", () => {
        const tab = tabOf(withTab(($) => {
            const byNumber = $.const(new Map([[2n, { name: "Two", district: "Old Town", trade: "Retail" }], [10n, { name: "Ten", district: "Riverside", trade: "Arts" }]]), DictType(IntegerType, ex.PrintCustomer));
            return Plan.library.tab(byNumber, { name: "Numbered", label: (c, k) => East.str`${c.name} (${East.print(k)})` });
        }), "tab");
        assert.ok(sameText(tab.value.icon, none) && sameText(tab.value.drop, none));
        assert.ok(sameCards(tab.value.cards, [
            { key: "2", label: "Two (2)", meta: none, group: none, sets: [] },
            { key: "10", label: "Ten (10)", meta: none, group: none, sets: [] },
        ]));
    });

    test("Schedule.patch: every field of the row type an Option, the fields it sets some and the rest none", () => {
        const Patch = Schedule.Types.Patch(ex.PrintCustomer);
        assert.ok(isTypeEqual(Patch, StructType({ name: OptionType(StringType), district: OptionType(StringType), trade: OptionType(StringType) })));
        const patch = East.compile(East.function([StringType], Patch, (_$, trade) => Schedule.patch(ex.PrintCustomer, { name: "Ivy Lane Studio", trade })), [])("Design");
        assert.ok(equalFor(Patch)(patch, { name: some("Ivy Lane Studio"), district: none, trade: some("Design") }));
    });
});

// ============================================================================
// Refused at build, each naming itself (PB61, PB62)
// ============================================================================

describe("the library's refusals (PB61, PB62)", () => {
    const axis = Plan.axis({ window: WINDOW, resolution: "day" });
    const overJobs = ($: BlockBuilder<NullType>, library: readonly ReturnType<typeof Plan.library.events>[]) =>
        Plan.Payload({ axis, resources: { presses: pressesOf($) }, events: { job: jobsOf($) }, library });

    test("a tab listed twice, the author's by its name", () => {
        assert.match(refusal(($) => overJobs($, [Plan.library.events(), Plan.library.series(), Plan.library.events()])),
            /^Plan: the library lists Plan\.library\.events\(\) twice — each tab once$/);
        assert.match(refusal(($) => overJobs($, [customersOf($), customersOf($)])),
            /^Plan: the library lists two tabs named "Customers" — each tab's name is its own$/);
        // Two of the author's own, each named apart, are two tabs.
        assert.equal(refusal(($) => overJobs($, [customersOf($), customersOf($, "Accounts")])), "");
    });

    test("a `drop` whose patch is over no event kind's row type, or over one two kinds share", () => {
        const customers = ($: BlockBuilder<NullType>) => $.let(Record.bind(ex.planPrintCustomers, []));
        assert.match(refusal(($) => overJobs($, [Plan.library.tab(customers($).read(), {
            name: "Customers", label: (c) => c.name, drop: (c) => Schedule.patch(ex.PrintCustomer, { name: c.name }),
        })])), /^Plan: the "Customers" tab's `drop` returns a patch over no event kind's row type — build it with Schedule\.patch\(RowType, \{ … \}\) over the row type of the kind its cards land on \(job\)$/);
        assert.match(refusal(($) => {
            const rush = $.let(Record.bind(ex.planLinkJobs, [ex.planLinkJobsPatch]));
            return Plan.Payload({
                axis, resources: { presses: pressesOf($) },
                events: {
                    job: jobsOf($),
                    rush: Schedule.events(rush, { name: "Rush job", icon: "bolt", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
                },
                library: [customersOf($)],
            });
        }), /^Plan: the "Customers" tab's `drop` returns a patch over a row type 2 event kinds share \(job, rush\) — a card lands on one kind, so give each kind a row type of its own$/);
        // On a Plan of no event kinds, no kind takes it.
        assert.match(refusal(($) => Plan.Payload({ axis, rows: [Plan.events({ key: "ms", label: "Milestones" })], library: [customersOf($)] })),
            /^Plan: the "Customers" tab's `drop` returns a patch over no event kind's row type — .* \(this Plan has no event kinds\)$/);
    });

    test("the Events or the Backlog tab on a Plan with no event kinds", () => {
        const rows = [Plan.events({ key: "ms", label: "Milestones" })];
        assert.match(refusal(() => Plan.Payload({ axis, rows, library: [Plan.library.events()] })),
            /^Plan: the library lists Plan\.library\.events\(\), and this Plan has no event kinds — its templates are its event kinds' \(Schedule\.events\)$/);
        assert.match(refusal(() => Plan.Payload({ axis, rows, library: [Plan.library.backlog()] })),
            /^Plan: the library lists Plan\.library\.backlog\(\), and this Plan has no event kinds — its unscheduled events are its event kinds' \(Schedule\.events\)$/);
    });

    test("an author's tab over rows that are not a Dict", () => {
        assert.match(refusal(($) => overJobs($, [Plan.library.tab($.const([1n], ArrayType(IntegerType)) as never, { name: "Numbers", label: () => "n" })])),
            /^Plan: the "Numbers" tab reads its rows as Schedule\.resources does — a Dict, usually a record's read\(\) — and these are \.Array \.Integer$/);
    });
});
