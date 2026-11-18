/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A visual's tile (#1670): it asks its programs through the query builder's
 * calls and draws each of its states — waiting, a well empty, a field
 * missing, a source with no date to compare periods by, its source's error
 * with a Retry, a source the page cannot query, no rows — and its answer; two
 * tiles with one program make one call, and so do two pages over the same
 * sources, one inside the other; an answer outlives its calls' identity.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, FloatType, IntegerType, StringType, StructType, none, parseJq, some, toEastTypeValue, variant, type JqNode, type ValueTypeOf,
} from "@elaraai/east";
import { Studio, type StudioCellType, type StudioSourceType } from "@elaraai/e3-ui/internal";
import { markOf } from "@elaraai/east-ui-components/testing";
import { StateRuntime, UIStore, system } from "@elaraai/east-ui-components";
import { utcAt as at } from "../plan/plan.test-utils.js";
import { QueryCallProvider, QuerySourceStatusProvider, type QueryCall } from "../query/hooks.js";
import { createInMemoryQueryCall, createInMemorySourceStatus } from "../query/in-memory-call.js";
import { VisualAnswersProvider } from "../query/visual/answers.js";
import { StudioLayout } from "./page.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});

beforeEach(() => { StateRuntime.initializeStore(new UIStore()); });
afterEach(() => { cleanup(); });

const Row = StructType({ ordered_at: DateTimeType, region: StringType, revenue: FloatType, units: IntegerType });
const PATH = [variant("field", "inputs"), variant("field", "orders")];
const ORDERS: ValueTypeOf<typeof Row>[] = [
    { ordered_at: at("2026-07-03T10:00:00"), region: "SA", revenue: 100, units: 4n },
    { ordered_at: at("2026-07-20T10:00:00"), region: "NSW", revenue: 50, units: 1n },
    { ordered_at: at("2026-08-02T10:00:00"), region: "SA", revenue: 60, units: 2n },
];
const DATASETS = [{ path: PATH, type: ArrayType(Row), value: ORDERS }];
const SOURCE: ValueTypeOf<typeof StudioSourceType> = {
    key: "orders", name: "Orders", icon: "receipt", description: none,
    binding: { name: "orders", source: variant("value", PATH), type: toEastTypeValue(ArrayType(Row)) },
    fields: [], range: some("ordered_at"), search: [], split: [],
};

const v = Studio.visual;
/** A placement holding content. */
function cell(key: string, content: ValueTypeOf<typeof StudioCellType>["content"]): ValueTypeOf<typeof StudioCellType> {
    return { key, row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content };
}
/** A jq condition. */
function condition(text: string): JqNode {
    const parsed = parseJq(text);
    if (parsed.program.type === "none") throw new Error(text);
    return parsed.program.value;
}

/** What a page draws in: the theme, and — given a call — its calls, its sources' status read in memory. */
function host(children: ReactNode, call?: QueryCall) {
    return (
        <ChakraProvider value={system}>
            {call === undefined ? children : (
                <QueryCallProvider call={call}>
                    <QuerySourceStatusProvider status={createInMemorySourceStatus(DATASETS)}>{children}</QuerySourceStatusProvider>
                </QueryCallProvider>
            )}
        </ChakraProvider>
    );
}

/** A page of placements over the sources — the orders unless given — its calls the given one's. */
function page(cells: ValueTypeOf<typeof StudioCellType>[], call?: QueryCall, sources: ValueTypeOf<typeof StudioSourceType>[] = [SOURCE]) {
    return render(host(<StudioLayout cells={cells} components={[]} sources={sources} storageKey="tile" />, call));
}

/** The in-memory call, counting its calls. */
function counting(): { call: QueryCall; calls: () => number } {
    let n = 0;
    const inMemory = createInMemoryQueryCall(DATASETS);
    return { call: (request, options) => { n += 1; return inMemory(request, options); }, calls: () => n };
}

/** The charts a page has drawn its answers as, by kind, in order (#1671). */
const charts = (container: HTMLElement) => [...container.querySelectorAll("[data-studio-chart]")].map((el) => el.getAttribute("data-studio-chart"));

/** A page's first tile's eyebrow: its name, and its meta. */
const eyebrow = (container: HTMLElement) =>
    [container.querySelector("[data-studio-visual-name]")?.textContent, container.querySelector("[data-studio-visual-meta]")?.textContent];

describe("a visual's tile", () => {
    test("asks its program and draws what it answered, under its eyebrow: a name made from its wells, and a meta that says what it groups by (TIL-1)", async () => {
        const { container } = page([cell("c1", v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue")] })))], createInMemoryQueryCall(DATASETS));
        await waitFor(() => expect(charts(container)).toEqual(["column"]));
        expect(eyebrow(container)).toEqual(["Revenue by region", "by region"]);
    });

    test("names a tile by its placement's own title before its wells, and by its view while its wells are empty (TIL-1)", () => {
        const { container } = page([
            { ...cell("c1", v.of("orders", v.kpi({ value: v.count() }))), title: some("Orders this quarter") },
            cell("c2", v.of("orders", v.column({ x: v.group("region"), values: [] }))),
        ], createInMemoryQueryCall(DATASETS));
        const names = [...container.querySelectorAll("[data-studio-visual-name]")].map((el) => el.textContent);
        expect(names).toEqual(["Orders this quarter", "Column chart"]);
    });

    test("waits on the shared loading clock: once the wait passes the delay its meta says loading over blocks in its own shape", async () => {
        const never: QueryCall = () => new Promise(() => {});
        const { container } = page([
            cell("c1", v.of("orders", v.kpi({ value: v.count() }))),
            cell("c2", v.of("orders", v.column({ x: v.group("region"), values: [v.count()] }))),
            cell("c3", v.of("orders", v.list({ item: v.group("region"), values: [v.count()] }))),
        ], never);
        expect(container.querySelector("[data-studio-visual=waiting]")).toBeNull();
        // Until then its eyebrow says nothing of it.
        expect(eyebrow(container)).toEqual(["Orders", ""]);
        await waitFor(() => expect(container.querySelectorAll("[data-studio-visual=waiting]")).toHaveLength(3), { timeout: 2_000 });
        expect([...container.querySelectorAll("[data-studio-visual-meta]")].map((meta) => meta.textContent)).toEqual(["loading", "loading", "loading"]);
        // A KPI's number over its line; a chart's legend line over its plot; a list's rows.
        const blocks = [...container.querySelectorAll("[data-studio-visual=waiting]")].map((state) => [...state.querySelectorAll("[data-block]")].map((block) => block.getAttribute("data-block")));
        expect(blocks).toEqual([["number", "line"], ["line", "plot"], ["row", "row", "row", "row"]]);
    });

    test("lists the wells it needs filled as a checklist — its source chosen, each well it needs missing — under its source's name (TIL-3)", () => {
        const { container } = page([cell("c1", v.of("orders", v.column({ x: v.group("region"), values: [] })))], createInMemoryQueryCall(DATASETS));
        const state = container.querySelector<HTMLElement>("[data-studio-visual=empty]")!;
        expect(within(state).getByRole("heading", { name: "Add fields to draw it" })).toBeTruthy();
        // A check for what is chosen, a dot for what is missing; the view's icon over them.
        expect([...state.querySelectorAll("li")].map((item) => [item.textContent, item.hasAttribute("data-done"), markOf(item)?.split(" ").slice(0, 2).join(" ")])).toEqual([
            ["Pick a source", true, "fas circle-check"], ["A number in Values", false, "fas circle"],
        ]);
        expect(markOf(state.querySelector("h4")!.previousElementSibling)).toBe("fas chart-column");
        expect(eyebrow(container)).toEqual(["Column chart", "Orders"]);
    });

    test("names a field its source does not have, as code, and its meta says it needs a field; a published page offers no link to pick another (TIL-3)", () => {
        const { container } = page([cell("c1", v.of("orders", v.kpi({ value: v.sum("net_revenue") })))], createInMemoryQueryCall(DATASETS));
        const state = container.querySelector<HTMLElement>("[data-studio-visual=missing]")!;
        expect([state.textContent, state.querySelector("code")?.textContent, markOf(state)?.split(" ").slice(0, 2).join(" ")]).toEqual(["Orders has no field net_revenue", "net_revenue", "fas circle-exclamation"]);
        expect(state.querySelector("button")).toBeNull();
        expect(eyebrow(container)[1]).toBe("needs a field");
    });

    test("says no data where its value would be when it reads no rows, never a zero, and why under it (TIL-3)", async () => {
        const { container } = page([cell("c1", v.of("orders", v.kpi({ value: v.sum("revenue") }), { where: condition(`.region == "WA"`) }))], createInMemoryQueryCall(DATASETS));
        expect(await screen.findByText("no data")).toBeTruthy();
        const state = container.querySelector<HTMLElement>("[data-studio-visual=no-rows]")!;
        expect([...state.firstElementChild!.children].map((part) => part.textContent)).toEqual(["no data", "No orders"]);
    });

    test("shows its source's error when there is no server to ask", async () => {
        page([cell("c1", v.of("orders", v.kpi({ value: v.count() })))]);
        expect(await screen.findByText("Orders could not be read")).toBeTruthy();
    });

    test("two tiles with one program make one call", async () => {
        const { call, calls } = counting();
        const content = v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] }));
        const { container } = page([cell("c1", content), cell("c2", content)], call);
        await waitFor(() => expect(charts(container)).toEqual(["bar", "bar"]));
        expect(calls()).toBe(1);
    });

    test("offers Retry when its call failed, and asks again", async () => {
        let tries = 0;
        const inMemory = createInMemoryQueryCall(DATASETS);
        // e3 unreachable once, then back.
        const flaky: QueryCall = (request, options) => {
            tries += 1;
            return tries === 1 ? Promise.reject(new TypeError("fetch failed")) : inMemory(request, options);
        };
        const { container } = page([cell("c1", v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] })))], flaky);
        expect(await screen.findByText("Orders could not be read")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(charts(container)).toEqual(["bar"]));
        expect(tries).toBe(2);
    });

    test("says a source with no date range has no date to compare periods by", () => {
        page([cell("c1", v.of("orders", v.kpi({ value: v.sum("revenue", { period: "previous" }) })))], createInMemoryQueryCall(DATASETS), [{ ...SOURCE, range: none }]);
        expect(screen.getByText("Orders has no date to compare periods by")).toBeTruthy();
    });

    test("a source the page cannot query fails only the visuals that read it, with no Retry", async () => {
        const lines: ValueTypeOf<typeof StudioSourceType> = {
            ...SOURCE, key: "lines", name: "Lines",
            binding: { name: "lines", source: variant("paged", "not-bound"), type: toEastTypeValue(ArrayType(Row)) },
        };
        const { container } = page([
            cell("c1", v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] }))),
            cell("c2", v.of("lines", v.bar({ x: v.group("region"), values: [v.count()] }))),
        ], createInMemoryQueryCall(DATASETS), [SOURCE, lines]);
        await waitFor(() => expect(charts(container)).toEqual(["bar"]));
        expect(await screen.findByText("Lines could not be read")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });

    test("a page inside another over the same sources asks through it: what one has answered, the other draws", async () => {
        const { call, calls } = counting();
        const content = v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] }));
        // A builder's canvas, and its preview beside it.
        const { container } = render(host(
            <VisualAnswersProvider sources={[SOURCE]}>
                <StudioLayout cells={[cell("c1", content)]} components={[]} sources={[SOURCE]} storageKey="canvas" />
                <StudioLayout cells={[cell("c1", content)]} components={[]} sources={[SOURCE]} storageKey="preview" />
            </VisualAnswersProvider>,
            call,
        ));
        await waitFor(() => expect(charts(container)).toEqual(["bar", "bar"]));
        expect(calls()).toBe(1);
    });

    test("keeps its answer when the host's calls change identity — a token refreshed — and asks nothing again", async () => {
        const first = counting();
        const content = v.of("orders", v.bar({ x: v.group("region"), values: [v.count()] }));
        const layout = <StudioLayout cells={[cell("c1", content)]} components={[]} sources={[SOURCE]} storageKey="tile" />;
        const { container, rerender } = render(host(layout, first.call));
        await waitFor(() => expect(charts(container)).toEqual(["bar"]));
        const second = counting();
        rerender(host(layout, second.call));
        // Still drawn as it was: no answer dropped, so no wait.
        expect(charts(container)).toEqual(["bar"]);
        expect([first.calls(), second.calls()]).toEqual([1, 0]);
    });
});

describe("a KPI's tile (#1671)", () => {
    test("draws its value and unit under its name, its change a pill in its valence with a caret at their row's end, its goal, its trend and one line of annotation", async () => {
        // Revenue: 210 against an average order of 70; a goal of 300; a month a bucket, July's and August's.
        const kpi = v.kpi({ value: v.sum("revenue", { goal: 300 }), compare: v.mean("revenue"), trend: "ordered_at" });
        const { container } = page([cell("c1", v.of("orders", kpi))], createInMemoryQueryCall(DATASETS));
        expect(await screen.findByText("210")).toBeTruthy();
        // The eyebrow names it; the KPI draws no label of its own.
        // A KPI's unit stands beside its number: its meta says nothing more.
        expect([eyebrow(container), screen.getAllByText("Revenue")]).toEqual([["Revenue", ""], [container.querySelector("[data-studio-visual-name]")]]);
        // Its number, and its change at the end of its row; this source's revenue declares no unit to say beside it.
        const row = container.querySelector("[data-studio-kpi-value]")!.parentElement!.parentElement!;
        expect([...row.children].map((part) => part.textContent)).toEqual(["210", "+200%"]);
        const change = container.querySelector("[data-studio-kpi-change]")!;
        expect([change.getAttribute("data-studio-kpi-change"), change.textContent]).toEqual(["positive", "+200%"]);
        expect(change.querySelector("svg[data-icon=caret-up]")).not.toBeNull();
        expect(container.querySelector("[data-studio-kpi-goal] [data-studio-kpi-goal-tick]")).not.toBeNull();
        expect(container.querySelectorAll("[data-studio-kpi-trend] svg path")).toHaveLength(1);
        // One line says what the change is against, then the goal and the gap.
        expect([...container.querySelectorAll("[data-studio-kpi-note]")].map((note) => note.textContent)).toEqual(["vs average revenue 70 · by month · 70% of goal 300 · 90 to go"]);
        // In the mock's order: the row, the goal's bar, the trend, the annotation.
        expect([...container.querySelector("[data-studio-kpi]")!.children].map((part) => [...part.attributes].find((a) => a.name.startsWith("data-studio-kpi-"))?.name ?? "row"))
            .toEqual(["row", "data-studio-kpi-goal", "data-studio-kpi-trend", "data-studio-kpi-note"]);
    });

    test("says a count's unit beside its number: its source, mid-sentence", async () => {
        const { container } = page([cell("c1", v.of("orders", v.kpi({ value: v.count() })))], createInMemoryQueryCall(DATASETS));
        await waitFor(() => expect(container.querySelector("[data-studio-kpi-unit]")).not.toBeNull());
        const value = container.querySelector("[data-studio-kpi-value]")!;
        expect([...value.parentElement!.children].map((part) => [part === value, part.textContent === "orders"])).toEqual([[true, false], [false, true]]);
    });

    test("draws only its value when its compare, trend and goal are empty, and says an absent value in words", async () => {
        const { container } = page([cell("c1", v.of("orders", v.kpi({ value: v.max("units") }), { where: condition(`.region == "SA"`) }))], createInMemoryQueryCall(DATASETS));
        expect(await screen.findByText("4")).toBeTruthy();
        expect(container.querySelector("[data-studio-kpi-change], [data-studio-kpi-trend], [data-studio-kpi-goal], [data-studio-kpi-note], [data-studio-kpi-unit]")).toBeNull();
    });
});

/** Opens a chip's menu, as a pointer does. */
async function openMenu(chip: HTMLElement) {
    await act(async () => { fireEvent.click(chip); });
    await waitFor(() => expect(chip.getAttribute("aria-expanded")).toBe("true"));
}

/** Picks an item of a chip's open menu as a pointer does: pressed on it, then its click. */
async function pick(chip: HTMLElement, words: string) {
    const menu = document.getElementById(chip.getAttribute("aria-controls")!)!;
    const item = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")].find((el) => el.textContent === words);
    if (item === undefined) throw new Error(`no item “${words}”`);
    await act(async () => { fireEvent.pointerDown(item); });
    await act(async () => { fireEvent.click(item); });
}

/**
 * Runs a test with every element laid out 1200 × 600: a Table or a Matrix
 * virtualises its rows, drawing those its box has room for, which jsdom lays
 * out at 0.
 */
async function sized(run: () => Promise<void>) {
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1200 });
    try {
        await run();
    } finally {
        if (height !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
        if (width !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetWidth", width);
    }
}

/** Saves what the page downloads, in order: each file's name and its text. */
function capturing(): { saved: { name: string; blob: Blob }[]; restore: () => void } {
    const saved: { name: string; blob: Blob }[] = [];
    let last: Blob | undefined;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => { last = blob; return "blob:rows"; } });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        saved.push({ name: this.download, blob: last! });
    });
    return {
        saved,
        restore: () => {
            click.mockRestore();
            Reflect.deleteProperty(URL, "createObjectURL");
            Reflect.deleteProperty(URL, "revokeObjectURL");
        },
    };
}

describe("a records table's tile, and a tile's menu (#1671)", () => {
    test("draws a page of its rows in the Table, its columns in their well order under their labels, and where the page stands (TBL-1)", async () => {
        const records = v.records({ columns: ["region", "revenue"], sort: "revenue", descending: true });
        const { container } = page([cell("c1", v.of("orders", records))], createInMemoryQueryCall(DATASETS));
        await waitFor(() => expect(container.querySelector("[data-studio-records='']")).not.toBeNull());
        const records_ = container.querySelector<HTMLElement>("[data-studio-records]")!;
        expect([...records_.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Region", "Revenue"]);
        expect(records_.querySelector("[data-studio-visual-note]")!.textContent).toBe("Showing 1–3 of 3");
        // A table's rows run edge to edge in its tile.
        expect(container.querySelector("[data-studio-visual-tile] > [data-flush]")).not.toBeNull();
    });

    test("Show rows lists the rows under a visual in the drawer, newest first; its Export CSV writes every one, named after the visual (TIL-2)", async () => {
        const downloads = capturing();
        try {
            const { container } = page([cell("c1", v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue")] })))], createInMemoryQueryCall(DATASETS));
            await waitFor(() => expect(charts(container)).toEqual(["column"]));
            const chip = container.querySelector<HTMLElement>("[data-studio-visual-menu]")!;
            await openMenu(chip);
            await pick(chip, "Show rows");
            const drawer = await screen.findByRole("dialog");
            expect([within(drawer).getByText("Rows"), within(drawer).getByText("Revenue by region")]).toHaveLength(2);
            await waitFor(() => expect(within(drawer).getByText("Showing 1–3 of 3")).toBeTruthy());
            // Every field of the rows, as its source lists none.
            expect([...drawer.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Ordered at", "Region", "Revenue", "Units"]);
            await act(async () => { fireEvent.click(within(drawer).getByRole("button", { name: "Export CSV" })); });
            await waitFor(() => expect(downloads.saved).toHaveLength(1));
            const [head, ...lines] = (await downloads.saved[0]!.blob.text()).split("\r\n").filter((line) => line !== "");
            expect([downloads.saved[0]!.name, head, lines.map((line) => line.split(",")[1])])
                .toEqual(["revenue-by-region.csv", "ordered_at,region,revenue,units", ["SA", "NSW", "SA"]]);
        } finally {
            downloads.restore();
        }
    });

    test("a summary draws each region's head over its months, with its count; the total row after its function; a cell short of its goal marked (TBL-2, TBL-3)", () => sized(async () => {
        const summary = v.summary({ rows: [v.group("region"), v.group("ordered_at", { bucket: "month" })], values: [v.sum("revenue", { goal: 80 })], total: true });
        const { container } = page([cell("c1", v.of("orders", summary))], createInMemoryQueryCall(DATASETS));
        await waitFor(() => expect(container.querySelector("[data-studio-summary] tbody tr")).not.toBeNull());
        const table = container.querySelector<HTMLElement>("[data-studio-summary]")!;
        // Each head its label alone; the value's goal a small label of its own after it.
        expect([...table.querySelectorAll("thead th")].map((th) => [...th.querySelectorAll("button > span")].map((part) => part.textContent))).toEqual([["Region · month"], ["Revenue", "goal 80"]]);
        expect(table.querySelectorAll("thead [data-control]")).toHaveLength(0);
        // New South Wales over July; South Australia over July and August — each head's first cell, its count after it.
        expect([...table.querySelectorAll("tbody tr[data-row-head]")].map((tr) => tr.querySelector("td")!.textContent)).toEqual(["NSW1", "SA2"]);
        expect([...table.querySelectorAll("tbody tr")].map((tr) => tr.getAttribute("data-depth"))).toEqual(["0", "1", "0", "1", "1"]);
        expect([...table.querySelectorAll("tfoot tr[data-table-total] td")].map((td) => td.textContent)).toEqual(["Total", "sum210"]);
        // Under 80: New South Wales' 50, its July's, and South Australia's August, 60.
        expect(within(table).getAllByRole("img", { name: "below goal" })).toHaveLength(3);
    }));

    test("a pivot puts each region's month in the Matrix, shaded on the heat steps — paper on the top two — a pair with no rows in words, the legend under it (TBL-4)", () => sized(async () => {
        const pivot = v.pivot({ rows: v.group("region"), columns: v.group("ordered_at", { bucket: "month" }), value: v.sum("revenue"), heat: true });
        const { container } = page([cell("c1", v.of("orders", pivot))], createInMemoryQueryCall(DATASETS));
        await waitFor(() => expect(container.querySelector("[data-studio-pivot] [data-slot=seg]")).not.toBeNull());
        const grid = container.querySelector<HTMLElement>("[data-studio-pivot]")!;
        const rows = [...grid.querySelectorAll("[data-row-key]")].map((row) => [
            row.querySelector("[data-slot=rowHeaderName]")!.textContent,
            ...[...row.querySelectorAll("[data-slot=seg]")].map((seg) => [seg.textContent, seg.getAttribute("data-fill")]),
        ]);
        // July: NSW 50, SA 100; August: SA 60 — the 95th percentile 100, so steps of 20.
        expect(rows).toEqual([["NSW", ["50", "neutral"], ["no data", "free"]], ["SA", ["100", "brand"], ["60", "brand"]]]);
        const legend = grid.querySelector<HTMLElement>("[data-studio-heat]")!;
        expect([...legend.querySelectorAll("[data-step]")].map((swatch) => swatch.getAttribute("aria-label"))).toEqual(["0–20", "20–40", "40–60", "60–80", "≥80"]);
        expect([...legend.querySelectorAll("[aria-hidden] span")].map((tick) => tick.textContent)).toEqual(["0", "20", "40", "60", "≥80"]);
    }));

    test("a list draws a two-line row an item, its values at the end, and its ranking bar against the largest (LST-1, LST-2)", async () => {
        const list = v.list({ item: v.group("region", { sort: "high" }), values: [v.sum("revenue")], bar: true });
        const { container } = page([cell("c1", v.of("orders", list))], createInMemoryQueryCall(DATASETS));
        await waitFor(() => expect(container.querySelector("[data-studio-list-row]")).not.toBeNull());
        const rows = [...container.querySelectorAll<HTMLElement>("[data-studio-list-row]")].map((row) => [
            row.querySelector("[data-studio-list-name]")!.textContent,
            row.querySelector("[data-studio-list-value]")!.textContent,
            // The bar's fill: its width its share.
            (row.querySelector("[data-studio-list-bar]")!.firstElementChild as HTMLElement).style.width,
        ]);
        // South Australia 100 + 60, New South Wales 50: its share of 160.
        expect(rows).toEqual([["SA", "160", "100%"], ["NSW", "50", "31.25%"]]);
        expect(container.querySelector("[data-studio-visual-tile] > [data-flush]")).not.toBeNull();
    });

    test("a visual holding fewer groups than its source has says how many of how many under it (CHT-9)", async () => {
        // A list keeps its first N, with no Other: South Australia, of two regions.
        const list = v.list({ item: v.group("region", { sort: "high", top: 1n }), values: [v.sum("revenue")] });
        const { container } = page([cell("c1", v.of("orders", list))], createInMemoryQueryCall(DATASETS));
        await waitFor(() => expect(container.querySelector("[data-studio-list-row]")).not.toBeNull());
        expect([container.querySelectorAll("[data-studio-list-row]").length, container.querySelector("[data-studio-visual-note]")?.textContent])
            .toEqual([1, "Showing 1 of 2 groups"]);
    });

    test("an export that could not be made says why over the tile's body, until it is put away", async () => {
        const inMemory = createInMemoryQueryCall(DATASETS);
        let calls = 0;
        // The tile's call answers; the export's, the next, finds e3 unreachable.
        const call: QueryCall = (request, options) => {
            calls += 1;
            return calls > 1 ? Promise.reject(new TypeError("fetch failed")) : inMemory(request, options);
        };
        const { container } = page([cell("c1", v.of("orders", v.kpi({ value: v.count() })))], call);
        expect(await screen.findByText("3")).toBeTruthy();
        const chip = container.querySelector<HTMLElement>("[data-studio-visual-menu]")!;
        await openMenu(chip);
        await pick(chip, "Export CSV");
        expect(await screen.findByText("The rows could not be exported")).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dismiss" })); });
        expect(screen.queryByText("The rows could not be exported")).toBeNull();
    });
});
