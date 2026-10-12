/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The row stream on screen (#822). Every canvas here is built by the e3-ui
 * factory and COMPILED, so the rows the renderer draws are the ones the series
 * pipeline emits: nesting from the data at any depth, section headers over
 * child collections, `views` adjacency, the series list as the layout (and a
 * pick's list as its order, through the `Plan` carrier as an app renders
 * it), a repeated id drawn as a diagnostic, and sources keyed by any type.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, OptionType, RecursiveType,
    StringType, StructType, none, some, type ValueTypeOf,
} from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { system, EastChakraComponent, UIStore, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import { rowIdOfKey } from "./model.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => { initializeStore(new UIStore()); });
afterEach(() => {
    cleanup();
    localStorage.clear();
});

const W27 = new Date("2026-06-29T00:00:00Z");
const W28 = new Date("2026-07-06T00:00:00Z");
const END = new Date("2026-09-21T00:00:00Z");

type UIValue = ValueTypeOf<typeof UIComponentType>;

/** Compile a canvas program — the payload the renderer draws. */
function planOf(program: ReturnType<typeof East.function>): PlanRootValue {
    return East.compile(program as never, getRegisteredPlatformImplementations())() as PlanRootValue;
}

function renderPlan(value: PlanRootValue, key: string) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraPlan value={value} storageKey={key} />
        </ChakraProvider>,
    );
}

/** The body's row items in order — data rows and group bands alike. */
const rowItems = (c: HTMLElement) => [...c.querySelectorAll("[data-plan-body] [data-plan-item^='r:']")] as HTMLElement[];

/** A row item's id in words — `entry press-jobs H1/p03`, `section crew-block H1`. */
function idOf(item: Element): string {
    const id = rowIdOfKey(item.getAttribute("data-plan-item")!.slice(2))!;
    return `${id.type} ${id.value.series} ${id.value.path.join("/")}`;
}
const ids = (c: HTMLElement) => rowItems(c).map(idOf);
const itemById = (c: HTMLElement, id: string) => rowItems(c).find((it) => idOf(it) === id);

describe("nesting comes from the data (#822)", () => {
    const Account = RecursiveType((self) => StructType({
        name: StringType,
        values: ArrayType(StructType({ at: DateTimeType, value: OptionType(FloatType) })),
        children: ArrayType(self),
    }));
    const ACCOUNTS = new Map([
        ["pnl", { name: "P&L", values: [], children: [
            { name: "Revenue", values: [], children: [
                { name: "Product", values: [], children: [
                    { name: "Widgets", values: [{ at: W27, value: some(10.0) }], children: [] },
                    { name: "Gadgets", values: [{ at: W27, value: some(5.0) }], children: [] },
                ] },
                { name: "Services", values: [{ at: W27, value: some(3.0) }], children: [] },
            ] },
            { name: "Costs", values: [{ at: W27, value: some(-7.0) }], children: [] },
        ] }],
    ]);
    const statement = East.function([], Plan.Types.Root, ($) => {
        const accounts = $.const(ACCOUNTS, DictType(StringType, Account));
        return Plan.Root({
            axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
            data: accounts,
            series: [Plan.series.table(Account, {
                key: "accounts", title: "Accounts",
                label: (a) => a.name,
                cells: (a) => Plan.tableCells(a.values),
                aggregate: "sum",
                children: (a) => a.children,
            })],
        });
    });

    test("a recursive table four deep draws a subtotal at every level, each row at its depth", () => {
        const { container } = renderPlan(planOf(statement), "plan-822-statement");
        const rows = rowItems(container);
        expect(rows.map(idOf)).toEqual([
            "entry accounts pnl", "entry accounts pnl/0", "entry accounts pnl/0/0",
            "entry accounts pnl/0/0/0", "entry accounts pnl/0/0/1", "entry accounts pnl/0/1", "entry accounts pnl/1",
        ]);
        expect(rows.map((r) => r.getAttribute("aria-level"))).toEqual(["1", "2", "3", "4", "4", "3", "2"]);
        // Every parent's W27 number is its subtree's sum — derived at each level
        // from the level below: Product 15, Revenue 18, P&L 11.
        expect(rows.map((r) => r.querySelector("[data-cell]")?.textContent)).toEqual(["11", "18", "15", "10", "5", "3", "-7"]);
    });

    test("any row with children may start collapsed — the declaration rides the row, and a click opens it", () => {
        // Not a group band: a table parent, folded by an accessor over its entry.
        const folded = East.function([], Plan.Types.Root, ($) => {
            const accounts = $.const(ACCOUNTS, DictType(StringType, Account));
            return Plan.Root({
                axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
                data: accounts,
                series: [Plan.series.table(Account, {
                    key: "accounts", title: "Accounts",
                    label: (a) => a.name,
                    cells: (a) => Plan.tableCells(a.values),
                    aggregate: "sum",
                    children: (a) => a.children,
                    collapsed: (a) => a.name.equal("Revenue"),
                })],
            });
        });
        const { container } = renderPlan(planOf(folded), "plan-822-folded");
        expect(ids(container)).toEqual(["entry accounts pnl", "entry accounts pnl/0", "entry accounts pnl/1"]);
        expect(itemById(container, "entry accounts pnl/0")!.getAttribute("aria-expanded")).toBe("false");
        fireEvent.click(itemById(container, "entry accounts pnl/0")!.querySelector("[role='rowheader']")!);
        expect(ids(container)).toHaveLength(7);
        expect(itemById(container, "entry accounts pnl/0")!.getAttribute("aria-expanded")).toBe("true");
    });

    test("collapsing a level hides exactly its subtree — and changes no number above it", () => {
        const { container } = renderPlan(planOf(statement), "plan-822-statement-collapse");
        const revenue = itemById(container, "entry accounts pnl/0")!;
        fireEvent.click(revenue.querySelector("[role='rowheader']")!);
        expect(ids(container)).toEqual(["entry accounts pnl", "entry accounts pnl/0", "entry accounts pnl/1"]);
        expect(itemById(container, "entry accounts pnl")!.querySelector("[data-cell]")!.textContent).toBe("11");
        expect(itemById(container, "entry accounts pnl/0")!.querySelector("[data-cell]")!.textContent).toBe("18");
    });

    test("a step-down: a hall's presses as views and its crews as cards, each under its section header", () => {
        const Job = StructType({ key: StringType, start: DateTimeType, end: DateTimeType });
        const Press = StructType({ jobs: ArrayType(Job), load: FloatType });
        const Crew = StructType({ hours: FloatType });
        const Hall = StructType({ presses: DictType(StringType, Press), crews: DictType(StringType, Crew) });
        const HALLS = new Map([
            ["H1", {
                presses: new Map([
                    ["p03", { jobs: [{ key: "b1", start: W27, end: W28 }], load: 40.0 }],
                    ["p04", { jobs: [], load: 60.0 }],
                ]),
                crews: new Map([["crewA", { hours: 80.0 }]]),
            }],
        ]);
        const program = East.function([], Plan.Types.Root, ($) => {
            const halls = $.const(HALLS, DictType(StringType, Hall));
            return Plan.Root({
                axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
                data: halls,
                series: [Plan.series.group(Hall, {
                    key: "halls", title: "Halls", label: (_h, k) => k,
                    children: [
                        Plan.children((h) => h.presses, [
                            Plan.series.section(Press, { key: "press-block", title: "Presses" }, [
                                Plan.series.views(Press, { key: "presses", title: "Presses" }, [
                                    Plan.series.span(Press, {
                                        key: "press-jobs", title: "Jobs", label: (_p, k) => k,
                                        runs: (p) => p.jobs.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.key, state: "confirmed" })),
                                    }),
                                    Plan.series.heat(Press, {
                                        key: "press-load", title: "Load", label: (_p, k) => k,
                                        cells: (p) => Plan.heatCells([{ at: Plan.at.time(W27), value: some(p.load), label: none }]),
                                    }),
                                ]),
                            ]),
                        ]),
                        Plan.children((h) => h.crews, [
                            Plan.series.section(Crew, { key: "crew-block", title: "Crews" }, [
                                Plan.series.cards(Crew, { key: "crews", title: "Crews", label: (_c, k) => k, chips: _c => [] }),
                            ]),
                        ]),
                    ],
                })],
            });
        });
        const { container } = renderPlan(planOf(program), "plan-822-stepdown");
        expect(ids(container)).toEqual([
            "entry halls H1",
            "section press-block H1",
            "entry press-jobs H1/p03", "entry press-load H1/p03",
            "entry press-jobs H1/p04", "entry press-load H1/p04",
            "section crew-block H1",
            "entry crews H1/crewA",
        ]);
        // The headers are group bands under the hall, named by their titles.
        const presses = itemById(container, "section press-block H1")!;
        expect(presses.hasAttribute("data-plan-group")).toBe(true);
        expect(presses.getAttribute("aria-level")).toBe("2");
        expect(presses.textContent).toContain("Presses");
        expect(itemById(container, "entry press-load H1/p04")!.getAttribute("aria-level")).toBe("3");
        // Closing the presses' header hides its members — and only them.
        fireEvent.click(presses);
        expect(ids(container)).toEqual([
            "entry halls H1", "section press-block H1", "section crew-block H1", "entry crews H1/crewA",
        ]);
    });

    test("views: an entry's rows are adjacent in declared order; its child follows them, nested under the first — and collapses with it alone", () => {
        const Kid = StructType({ v: FloatType });
        const Row = StructType({ v: FloatType, jobs: BooleanType, kids: DictType(StringType, Kid) });
        const DATA = new Map([
            ["p03", { v: 1.0, jobs: true, kids: new Map([["k1", { v: 5.0 }]]) }],
            ["p04", { v: 2.0, jobs: false, kids: new Map() }],
        ]);
        const program = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(DATA, DictType(StringType, Row));
            return Plan.Root({
                axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
                data,
                series: [Plan.series.views(Row, {
                    key: "presses", title: "Presses",
                    children: Plan.children((r) => r.kids, [
                        Plan.series.heat(Kid, { key: "parts", title: "Parts", label: (_k, key) => key, cells: _k => Plan.heatCells([]) }),
                    ]),
                }, [
                    Plan.series.span(Row, { key: "press-jobs", title: "Jobs", match: r => r.jobs, label: (_r, k) => k, runs: _r => [] }),
                    Plan.series.heat(Row, { key: "press-load", title: "Load", label: (_r, k) => k,
                        cells: r => Plan.heatCells([{ at: Plan.at.time(W27), value: some(r.v), label: none }]) }),
                    Plan.series.table(Row, { key: "press-sheets", title: "Sheets", label: (_r, k) => k,
                        cells: r => Plan.tableCells([{ at: W27, value: some(r.v) }]) }),
                ])],
            });
        });
        const { container } = renderPlan(planOf(program), "plan-822-views");
        expect(ids(container)).toEqual([
            "entry press-jobs p03", "entry press-load p03", "entry press-sheets p03",
            "entry parts p03/k1",
            "entry press-load p04", "entry press-sheets p04",
        ]);
        expect(itemById(container, "entry parts p03/k1")!.getAttribute("aria-level")).toBe("2");
        expect(itemById(container, "entry press-load p03")!.getAttribute("aria-level")).toBe("1");
        // The child's parent is the first view row: closing it hides the child,
        // and the view rows between them stay.
        fireEvent.click(itemById(container, "entry press-jobs p03")!.querySelector("[role='rowheader']")!);
        expect(ids(container)).toEqual([
            "entry press-jobs p03", "entry press-load p03", "entry press-sheets p03",
            "entry press-load p04", "entry press-sheets p04",
        ]);
    });
});

describe("the series list is the layout (#822)", () => {
    const Row = StructType({ v: FloatType });
    const DATA = new Map([["a", { v: 1.0 }], ["b", { v: 2.0 }]]);
    const heat = Plan.series.heat(Row, {
        key: "load", title: "Load", label: (_r, k) => k,
        cells: r => Plan.heatCells([{ at: Plan.at.time(W27), value: some(r.v), label: none }]),
    });
    const table = Plan.series.table(Row, {
        key: "sheets", title: "Sheets", label: (_r, k) => k,
        cells: r => Plan.tableCells([{ at: W27, value: some(r.v) }]),
    });
    const LOAD_FIRST = ["entry load a", "entry load b", "entry sheets a", "entry sheets b"];
    const SHEETS_FIRST = ["entry sheets a", "entry sheets b", "entry load a", "entry load b"];

    test("reordering the series list reorders the blocks", () => {
        const canvas = (series: typeof heat[]) => planOf(East.function([], Plan.Types.Root, ($) => {
            const data = $.const(DATA, DictType(StringType, Row));
            return Plan.Root({ axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }), data, series });
        }));
        const forward = renderPlan(canvas([heat, table]), "plan-822-order-f");
        expect(ids(forward.container)).toEqual(LOAD_FIRST);
        cleanup();
        const reverse = renderPlan(canvas([table, heat]), "plan-822-order-r");
        expect(ids(reverse.container)).toEqual(SHEETS_FIRST);
    });

    test("a pick's list is the order on screen; switching a series off takes its block", async () => {
        const picked = (key: string, all: typeof heat[], hidden: string[]) => East.compile(
            East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
                const data = $.const(DATA, DictType(StringType, Row));
                const list = $.const(all, ArrayType(Plan.Types.Series(Row)));
                const shown = $.let(Plan.pick(key, list, { hidden }));
                return Plan({ axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }), data, pick: shown });
            }))) as never,
            getRegisteredPlatformImplementations(),
        )() as UIValue;
        const mount = (value: UIValue) => render(
            <ChakraProvider value={system}>
                <EastChakraComponent value={value} storageKey="plan-822-pick" />
            </ChakraProvider>,
        );
        const loadFirst = mount(picked("plan.822.pick.a", [heat, table], []));
        await waitFor(() => expect(ids(loadFirst.container)).toEqual(LOAD_FIRST));
        cleanup();
        const sheetsFirst = mount(picked("plan.822.pick.b", [table, heat], []));
        await waitFor(() => expect(ids(sheetsFirst.container)).toEqual(SHEETS_FIRST));
        cleanup();
        const loadOff = mount(picked("plan.822.pick.c", [heat, table], ["load"]));
        await waitFor(() => expect(ids(loadOff.container)).toEqual(["entry sheets a", "entry sheets b"]));
    });
});

describe("a row's identity (#822)", () => {
    test("two hand-built rows under one id both stay — the second drawn as a diagnostic in place", () => {
        const Row = StructType({ v: FloatType });
        const program = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(new Map([["a", { v: 1.0 }]]), DictType(StringType, Row));
            return Plan.Root({
                axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
                data,
                series: [Plan.series.rows(Row, { key: "chrome", title: "Chrome" }, [
                    Plan.span({ key: "dup", label: "first" }),
                    Plan.span({ key: "dup", label: "second" }),
                ])],
            });
        });
        const { container } = renderPlan(planOf(program), "plan-822-duplicate");
        const rows = rowItems(container);
        expect(rows.map(idOf)).toEqual(["entry chrome dup", "entry chrome dup"]);
        expect(rows[0]!.querySelector("[data-plan-diagnostic]")).toBeNull();
        expect(rows[0]!.textContent).toContain("first");
        // The repeat keeps its gutter and its place, and says why it draws nothing.
        expect(rows[1]!.textContent).toContain("second");
        const diagnostic = rows[1]!.querySelector('[data-plan-diagnostic="duplicate"]')!;
        expect(diagnostic.textContent).toBe('DUPLICATE ID — an earlier row already has .entry (series="chrome", path=["dup"])');
        const chip = container.querySelector('[data-plan-diagnostics="rows"]')!;
        expect(chip.textContent).toBe("1 row skipped");
    });

    test("a Dict<Integer, R> and a Dict<{hall, bin}, R> source: each path segment is the key's text, in the source's order", () => {
        const Row = StructType({ v: FloatType });
        const byNumber = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(new Map([[20n, { v: 2.0 }], [1n, { v: 1.0 }]]), DictType(IntegerType, Row));
            return Plan.Root({
                axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
                data,
                series: [Plan.series.heat(Row, {
                    key: "load", title: "Load", keyType: IntegerType,
                    label: (_r, k) => East.print(k),
                    cells: r => Plan.heatCells([{ at: Plan.at.time(W27), value: some(r.v), label: none }]),
                })],
            });
        });
        const numbers = renderPlan(planOf(byNumber), "plan-822-integer-keys");
        // 1 before 20: the source's own (numeric) order, not the text's.
        expect(ids(numbers.container)).toEqual(["entry load 1", "entry load 20"]);
        expect(rowItems(numbers.container)[0]!.textContent).toContain("1");
        cleanup();

        const Key = StructType({ hall: StringType, bin: IntegerType });
        const byStruct = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(new Map([
                [{ hall: "H1", bin: 2n }, { v: 1.0 }],
                [{ hall: "H1", bin: 1n }, { v: 2.0 }],
            ]), DictType(Key, Row));
            return Plan.Root({
                axis: Plan.axis({ window: { min: W27, max: END }, resolution: "week" }),
                data,
                series: [Plan.series.table(Row, {
                    key: "bins", title: "Bins", keyType: Key,
                    label: (_r, k) => East.str`${k.hall} · ${East.print(k.bin)}`,
                    cells: r => Plan.tableCells([{ at: W27, value: some(r.v) }]),
                })],
            });
        });
        const structs = renderPlan(planOf(byStruct), "plan-822-struct-keys");
        expect(ids(structs.container)).toEqual(['entry bins (hall="H1", bin=1)', 'entry bins (hall="H1", bin=2)']);
        expect(rowItems(structs.container).map((r) => r.querySelector("[role='rowheader']")!.textContent))
            .toEqual(["H1 · 1", "H1 · 2"]);
    });
});
