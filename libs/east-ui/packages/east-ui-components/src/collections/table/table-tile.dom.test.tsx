/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A tile's Table (#1671) — the design system's Table running edge to edge in
 * a Frame: each head its label alone, the whole of it the button that sorts —
 * the least first, then the greatest, then as it was — with no pin, no sort
 * button and no resize grip; what its host says after a head's label; the
 * sort its host's program made, shown until the viewer sorts; a number as its
 * host prints it; and a date to its day.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import { ArrayType, DateTimeType, East, FloatType, StringType, StructType, variant, type ValueTypeOf } from "@elaraai/east";
import { Format, Table, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { nextTileSort } from "./tile-header.js";
import { EastChakraTable, type ColumnSort, type EastChakraTableProps, type TableRootValue, type TableTotalCell } from "./index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => { initializeStore(new UIStore()); });
afterEach(cleanup);

type UIValue = ValueTypeOf<typeof UIComponentType>;

/** Three orders: a region, its revenue, and when it was placed — one at midnight, one in the afternoon. */
const Row = StructType({ region: StringType, revenue: FloatType, ordered: DateTimeType });
const ROWS = [
    { region: "SA", revenue: 1_810_000, ordered: new Date(Date.UTC(2026, 8, 29)) },
    { region: "NSW", revenue: 480_000, ordered: new Date(Date.UTC(2026, 8, 30, 14, 30)) },
    { region: "VIC", revenue: 210_000, ordered: new Date(Date.UTC(2026, 9, 1)) },
];
/** Unvirtualized, so jsdom mounts every row. */
const ROOT: TableRootValue = (() => {
    const ui = East.compile(East.function([], UIComponentType, ($) => {
        const rows = $.const(ROWS, ArrayType(Row));
        return Table.Root(rows, { region: { header: "Region" }, revenue: { header: "Revenue AUD", format: Format.Number() }, ordered: { header: "Ordered" } },
            { virtualization: false });
    }), getRegisteredPlatformImplementations())() as UIValue;
    if (ui.type !== "Table") throw new Error("not a table");
    return ui.value;
})();

/** The revenue's goal, after its head. */
const NOTE = (columnKey: string) => (columnKey === "revenue" ? "goal 2.00M" : undefined);
/** Revenue in millions, as a host prints it. */
const MILLIONS = (n: number, columnKey: string) => (columnKey === "revenue" ? `${(n / 1_000_000).toFixed(2)}M` : undefined);
/** The total row. */
const TOTALS: readonly ReadonlyMap<string, TableTotalCell>[] = [new Map<string, TableTotalCell>([
    ["region", { value: variant("String", "Total") }],
    ["revenue", { value: variant("Float", 2_500_000), label: "sum" }],
])];

/** The table as a tile's, keeping its view state under its own key. */
function renderTile(storageKey: string, props: Partial<EastChakraTableProps> = {}) {
    return render(
        <ChakraProvider value={system}>
            <I18nProvider locale="en-AU">
                <EastChakraTable value={ROOT} storageKey={storageKey} tile enableMultiSort={false} {...props} />
            </I18nProvider>
        </ChakraProvider>,
    );
}

/** The heads, in order. */
const heads = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("thead th")];
/** The body's regions, in the order drawn. */
const regions = (container: HTMLElement) => [...container.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td")?.textContent);
/** What a head shows of its sort: its `aria-sort`, whether it is marked sorted, and its caret — Font Awesome's solid icon, by name. */
const sortOf = (th: HTMLElement) => [th.getAttribute("aria-sort"), th.querySelector("button")!.hasAttribute("data-sorted"), th.querySelector('button svg[data-prefix="fas"]')?.getAttribute("data-icon") ?? null];

describe("a tile's Table (#1671)", () => {
    test("each head is its label alone — no pin, no sort button, no resize grip — a number's ending at its end, with what its host says after its label", () => {
        const { container } = renderTile("table-tile.heads", { headerNote: NOTE });
        expect(heads(container).map((th) => [...th.querySelectorAll("button > span")].map((part) => part.textContent))).toEqual([["Region"], ["Revenue AUD", "goal 2.00M"], ["Ordered"]]);
        expect(container.querySelectorAll("thead [data-control], thead [data-slot=columnResizer], thead [data-slot=columnControls]")).toHaveLength(0);
        expect(heads(container).map((th) => th.querySelector("button")!.getAttribute("data-align"))).toEqual([null, "end", null]);
        // No head is sorted, so none has a caret.
        expect(heads(container).map(sortOf)).toEqual([[null, false, null], [null, false, null], [null, false, null]]);
    });

    test("a click on a head sorts by it — the least first, then the greatest, then as it was — and shows which way", async () => {
        const { container } = renderTile("table-tile.sort");
        const region = () => heads(container)[0]!;
        expect(regions(container)).toEqual(["SA", "NSW", "VIC"]);
        await act(async () => { fireEvent.click(region().querySelector("button")!); });
        expect([regions(container), sortOf(region())]).toEqual([["NSW", "SA", "VIC"], ["ascending", true, "caret-up"]]);
        await act(async () => { fireEvent.click(region().querySelector("button")!); });
        expect([regions(container), sortOf(region())]).toEqual([["VIC", "SA", "NSW"], ["descending", true, "caret-down"]]);
        await act(async () => { fireEvent.click(region().querySelector("button")!); });
        expect([regions(container), sortOf(region())]).toEqual([["SA", "NSW", "VIC"], [null, false, null]]);
        // Another head's click moves the sort to it: one column at a time.
        await act(async () => { fireEvent.click(heads(container)[1]!.querySelector("button")!); });
        expect([regions(container), sortOf(region()), sortOf(heads(container)[1]!)]).toEqual([["VIC", "NSW", "SA"], [null, false, null], ["ascending", true, "caret-up"]]);
    });

    test("shows the sort its host's program made until the viewer sorts, and a click from it sorts the least first", async () => {
        const sorts: ColumnSort[][] = [];
        const { container } = renderTile("table-tile.host", { sorted: { columnKey: "ordered", direction: "desc" }, onSortChange: (s) => sorts.push(s) });
        const ordered = () => heads(container)[2]!;
        // The rows are as the host gave them: the Table has sorted nothing.
        expect([regions(container), sortOf(ordered())]).toEqual([["SA", "NSW", "VIC"], ["descending", true, "caret-down"]]);
        await act(async () => { fireEvent.click(ordered().querySelector("button")!); });
        expect(sortOf(ordered())).toEqual(["ascending", true, "caret-up"]);
        expect(sorts).toEqual([[{ columnKey: "ordered", direction: "asc" }]]);
    });

    test("prints a number as its host prints it, in its rows and its total, and a date to its day — to its minute when it has a time", () => {
        const { container } = renderTile("table-tile.text", { numberText: MILLIONS, totals: TOTALS });
        const cells = [...container.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
        expect(cells).toEqual([["SA", "1.81M", "2026-09-29"], ["NSW", "0.48M", "2026-09-30 14:30"], ["VIC", "0.21M", "2026-10-01"]]);
        expect([...container.querySelectorAll("tfoot tr[data-table-total] td")].map((td) => td.textContent)).toEqual(["Total", "sum2.50M", ""]);
    });
});

describe("nextTileSort", () => {
    test("cycles none, the least first, the greatest first, none; a host's sort, which a click cannot clear, goes to the least first", () => {
        expect([nextTileSort(false, false), nextTileSort("asc", true), nextTileSort("desc", true)]).toEqual(["asc", "desc", false]);
        expect([nextTileSort("desc", false), nextTileSort("asc", false)]).toEqual(["asc", "desc"]);
    });
});
