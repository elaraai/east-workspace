/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's library pane on the wire (#1195, `Plan Builder Spec.md` §4.3,
 * §9.6, PB26, PB29, PB61, PB62) over the print works' records on e3 itself
 * (#1379): each payload's East function compiles against the platform a UI
 * task's preview gives it, so the presses, the jobs, the customers and the
 * paper in stock it reads are e3's — the tabs `library` lists, in its order;
 * the Series tab's lines, in the order the canvas draws them, and what hiding
 * each hides, `data`'s series through the canvas's own pick (#1541); and an
 * author's tab's cards, and what a card dropped on an event sets
 * (`Schedule.patch`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, IntegerType, OptionType, StringType,
    encodeBeast2For, equalFor, none, some, variant,
    type BlockBuilder, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { StateImpl, StateRuntime, UIStore } from "@elaraai/east-ui-components/platform";
import { Data, Plan, PlanLibraryCardType, PlanLibraryTabType, PlanPayloadType, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "plan/plan-events": ex });

type Payload = ValueTypeOf<typeof PlanPayloadType>;
type Tab = ValueTypeOf<typeof PlanLibraryTabType>;
type Card = ValueTypeOf<typeof PlanLibraryCardType>;

/**
 * A payload built in East over e3, as a UI task's preview runs it — with its state, which a Plan whose `data` has
 * series picks them through (#1541).
 */
async function payloadOf(build: ($: BlockBuilder<typeof PlanPayloadType>) => ExprType<typeof PlanPayloadType>): Promise<Payload> {
    const program = East.function([], PlanPayloadType, ($) => build($));
    const { platform } = await h.platform(program);
    StateRuntime.initializeStore(new UIStore());
    return East.compile(program, [...platform, ...StateImpl])() as Payload;
}

const WINDOW = { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") };
const sameTab = equalFor(PlanLibraryTabType);
const sameCards = equalFor(ArrayType(PlanLibraryCardType));
const sameText = equalFor(OptionType(StringType));
const asText = encodeBeast2For(StringType);

/** The presses, bound inside a block, as the canvas's rows (#1541): a landing row each, the jobs landing on them. */
function pressesOf($: BlockBuilder<never>) {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    return { data: presses.read(), series: [Plan.series.resources(ex.PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name })] };
}

/** The jobs over the presses, bound inside a block, their unscheduled ones in the backlog. */
function jobsOf($: BlockBuilder<never>) {
    const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
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

describe("the tabs `library` lists (PB26, PB61)", () => {
    test("in its order, each tab a `Plan.library.*` call; left out, or empty, there are none", async () => {
        const plan = (library: ($: BlockBuilder<typeof PlanPayloadType>) => readonly ReturnType<typeof Plan.library.events>[] | undefined) =>
            payloadOf(($) => {
                const tabs = library($);
                return Plan.Payload({
                    axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                    ...pressesOf($), events: { job: jobsOf($) },
                    ...(tabs === undefined ? {} : { library: tabs }),
                });
            });
        const listed = await plan(($) => [Plan.library.series(), customersOf($), Plan.library.events(), Plan.library.backlog()]);
        assert.deepEqual(listed.library.map((t) => t.type), ["series", "tab", "events", "backlog"]);
        assert.ok(sameTab(listed.library[2]!, variant("events", null)) && sameTab(listed.library[3]!, variant("backlog", null)));
        assert.deepEqual((await plan(() => undefined)).library, []);
        assert.deepEqual((await plan(() => [])).library, []);
    });

    test("a Plan over its rows alone takes a library too: the Series tab lists its rows", async () => {
        const payload = await payloadOf(($) => {
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

describe("the Series tab (PB29)", () => {
    test("the event kinds; then the Plan's rows — a hand-built row by its key, the rows nested in it going with it, a Plan.over series by its own — each with its glyph, and what hiding it hides; `data`'s series through the canvas's own pick, a resources series one line, its series beneath it going with it (#1541)", async () => {
        const payload = await payloadOf(($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
            const stops = $.let(Record.bind(ex.planPrintStops, ["patch"]));
            const stock = $.let(Data.bind(ex.planLinkStock));
            return Plan.Payload({
                axis: Plan.axis({ window: WINDOW, resolution: "day" }),
                data: presses.read(),
                series: [Plan.series.resources(ex.PrintPress, {
                    key: "presses", title: "Presses", icon: "print", label: (p) => p.name,
                    series: [
                        Plan.series.heat(ex.PrintPress, { key: "util", title: "Utilisation", label: () => "Utilisation", cells: () => Plan.heatCells([]) }),
                        Plan.series.table(ex.PrintPress, { key: "speed", title: "Speed", label: () => "Speed" }),
                    ],
                })],
                events: {
                    job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
                    stop: Schedule.events(stops, { name: "Stop", icon: "screwdriver-wrench", title: "title", at: "at", resource: { field: "press", of: "presses" } }),
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
                line("events.job", "Print job", undefined, "file-lines"),
                line("events.stop", "Stop", undefined, "screwdriver-wrench"),
            ],
            rows: [
                { item: line("rows.output", "SHEETS / DAY", undefined, "chart-line"), hides: variant("rows", "output") },
                { item: line("rows.works", "Planned works", undefined, "bars-staggered"), hides: variant("rows", "works") },
                { item: line("series.paper", "Paper", undefined, "heading"), hides: variant("series", ["paper", "stock"]) },
                { item: line("series.deliveries", "Deliveries", undefined, "flag"), hides: variant("series", ["deliveries"]) },
                { item: line("rows.ms", "Milestones", undefined, "flag"), hides: variant("rows", "ms") },
            ],
        })), JSON.stringify(tabOf(payload, "series").value.rows.map((r) => r.item.id)));
        // `data`'s series, through the canvas's own pick: the presses one line, their series beneath them going with them.
        if (payload.plan.pick.type !== "some") assert.fail("expected `data`'s series picked");
        assert.deepEqual(payload.plan.pick.value.items.map((item) => [item.id, item.title]), [["presses", "Presses"]]);
    });
});

describe("an author's tab (PB62)", () => {
    const withTab = (tab: ($: BlockBuilder<typeof PlanPayloadType>) => ReturnType<typeof Plan.library.tab>) => payloadOf(($) => {
        const own = tab($);
        return Plan.Payload({ axis: Plan.axis({ window: WINDOW, resolution: "day" }), ...pressesOf($), events: { job: jobsOf($) }, library: [own] });
    });

    test("a card per row, in its rows' order: its key's text, its label, meta and group; its `drop` names the event kind a card lands on, and each card the field it sets, at its path, as bytes of its type", async () => {
        const tab = tabOf(await withTab(($) => customersOf($)), "tab");
        assert.deepEqual([tab.value.name, tab.value.cards.length], ["Customers", 16]);
        assert.ok(sameText(tab.value.icon, some("building")) && sameText(tab.value.drop, some("job")));
        assert.ok(sameCards(tab.value.cards.slice(0, 2), [
            { key: "alder-finch", label: "Alder & Finch", meta: some("Retail"), group: some("Old Town"), sets: [{ path: ["customer"], value: asText("Alder & Finch") }] },
            { key: "bluewater-tours", label: "Bluewater Tours", meta: some("Travel"), group: some("North Quay"), sets: [{ path: ["customer"], value: asText("Bluewater Tours") }] },
        ]));
        assert.deepEqual(tab.value.cards.map((c: Card) => c.key).slice(-2), ["northwind", "orchard-market"]);
    });

    test("a patch setting several fields sets each, in the row type's order; one clearing an Option field sets it to none", async () => {
        const tab = tabOf(await withTab(($) => {
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

    test("with no `drop`, no card lands: the tab names no kind and its cards set nothing; a key of another type than String is its text as East prints it", async () => {
        const tab = tabOf(await withTab(($) => {
            const byNumber = $.const(new Map([[2n, { name: "Two", district: "Old Town", trade: "Retail" }], [10n, { name: "Ten", district: "Riverside", trade: "Arts" }]]), DictType(IntegerType, ex.PrintCustomer));
            return Plan.library.tab(byNumber, { name: "Numbered", label: (c, k) => East.str`${c.name} (${East.print(k)})` });
        }), "tab");
        assert.ok(sameText(tab.value.icon, none) && sameText(tab.value.drop, none));
        assert.ok(sameCards(tab.value.cards, [
            { key: "2", label: "Two (2)", meta: none, group: none, sets: [] },
            { key: "10", label: "Ten (10)", meta: none, group: none, sets: [] },
        ]));
    });
});
