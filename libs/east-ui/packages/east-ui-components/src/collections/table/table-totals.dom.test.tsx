/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A host's totals, its cells' tones and its group heads (#1671): the rows of
 * values a host that builds a Table's value in the browser totals it with — a
 * Studio summary's total row — drawn in its footer as its cells print, through
 * a column's format, at the end of a number column and after what made each,
 * and never sorted with its rows; a cell its host marks negative — a value on
 * the wrong side of its goal — with the exclamation before it, named; a
 * row its host marks a group's head, with its count after its label; and a
 * row its host marks as chosen (#1673), on the selected row's ground with no
 * checkbox column.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import { ArrayType, East, FloatType, RecursiveType, StringType, StructType, variant, type ValueTypeOf } from "@elaraai/east";
import { Format, Table, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { markOf } from "../../testing/icons.js";
import { EastChakraTable, type TableCellTone, type TableRootValue, type TableRowHead, type TableTotalCell } from "./index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => { initializeStore(new UIStore()); });
afterEach(cleanup);

type UIValue = ValueTypeOf<typeof UIComponentType>;

/** A region and its revenue, or a region over its categories. Unvirtualized, so jsdom mounts every row. */
const Row = RecursiveType((self) => StructType({ region: StringType, revenue: FloatType, lines: ArrayType(self) }));
/** NSW, then SA over its two categories: the rows in pre-order NSW 0, SA 1, Tools 2, Wire 3. */
const ROWS = [
    { region: "NSW", revenue: 70, lines: [] },
    { region: "SA", revenue: 1234.5, lines: [{ region: "Tools", revenue: 1000, lines: [] }, { region: "Wire", revenue: 234.5, lines: [] }] },
];
const ROOT: TableRootValue = (() => {
    const ui = East.compile(East.function([], UIComponentType, ($) => {
        const rows = $.const(ROWS, ArrayType(Row));
        return Table.Root(rows, { region: { header: "Region" }, revenue: { header: "Revenue", format: Format.Number() } },
            { virtualization: false, tree: { children: (r) => r.lines } });
    }), getRegisteredPlatformImplementations())() as UIValue;
    if (ui.type !== "Table") throw new Error("not a table");
    return ui.value;
})();

/** Below its goal. */
const BELOW: TableCellTone = { tone: "negative", label: "below goal" };

/** The total row: a label, and the revenue's sum, below its goal. */
const TOTALS: readonly ReadonlyMap<string, TableTotalCell>[] = [new Map<string, TableTotalCell>([
    ["region", { value: variant("String", "Total") }],
    ["revenue", { value: variant("Float", 1304.5), label: "sum", tone: BELOW }],
])];

/** NSW's revenue, on the wrong side of a goal. */
const TONE = (rowIndex: number, columnKey: string) => (rowIndex === 0 && columnKey === "revenue" ? BELOW : undefined);

/** SA heads its two categories. */
const HEAD = (rowIndex: number): TableRowHead | undefined => (rowIndex === 1 ? { count: 2 } : undefined);

/** The table, keeping its view state — its sort — under its own key; its host marking rows, when it does. */
function renderTable(storageKey: string, rowMarked?: (rowIndex: number) => boolean) {
    return render(
        <ChakraProvider value={system}>
            <I18nProvider locale="en-AU">
                <EastChakraTable value={ROOT} storageKey={storageKey} totals={TOTALS} cellTone={TONE} rowHead={HEAD} rowMarked={rowMarked} />
            </I18nProvider>
        </ChakraProvider>,
    );
}

/** The body's top-level regions, in the order drawn. */
const regions = (container: HTMLElement) => [...container.querySelectorAll('tbody tr[data-depth="0"]')].map((tr) => tr.querySelector("td")?.textContent);

describe("a host's totals (#1671)", () => {
    test("are drawn in the footer as the cells print — after what made them, through the column's format, at the end of a number column — and a sort never moves them", async () => {
        const { container } = renderTable("table-totals.sorted");
        const total = () => [...container.querySelectorAll("tfoot tr[data-table-total] td")];
        expect(total().map((td) => [td.querySelector("[data-total-label]")?.textContent, td.querySelector("[data-numeric], p")?.textContent]))
            .toEqual([[undefined, "Total"], ["sum", "1,304.5"]]);
        expect(total()[1]!.querySelector("[data-numeric]")).not.toBeNull();
        // A total on the wrong side of its goal is marked as a body cell is.
        expect([total()[1]!.getAttribute("data-tone"), markOf(total()[1]!.querySelector("[data-cell-mark]"))]).toEqual(["negative", "fas circle-exclamation"]);
        expect(regions(container)).toEqual(["NSW", "SA2"]);
        // A text column sorts the greatest first: the rows move, the total stays under them.
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sort by region" })); });
        expect(regions(container)).toEqual(["SA2", "NSW"]);
        expect(total().map((td) => td.textContent)).toEqual(["Total", "sum1,304.5"]);
    });
});

describe("a cell's tone (#1671)", () => {
    test("a negative cell wears the tone with Font Awesome's exclamation before its value, named for a screen reader; the rest are plain", () => {
        const { container } = renderTable("table-totals.tones");
        // Each top-level region's revenue cell, by its region.
        const revenue = new Map([...container.querySelectorAll('tbody tr[data-depth="0"]')].map((tr) => [tr.querySelector("td")!.textContent, tr.querySelectorAll("td")[1]!]));
        expect([revenue.get("NSW")!.getAttribute("data-tone"), revenue.get("SA2")!.getAttribute("data-tone")]).toEqual(["negative", null]);
        expect([markOf(revenue.get("NSW")!.querySelector("[data-cell-mark]")), revenue.get("SA2")!.querySelector("[data-cell-mark]")]).toEqual(["fas circle-exclamation", null]);
        expect(screen.getAllByRole("img", { name: "below goal" })).toHaveLength(2);
        expect(revenue.get("NSW")!.textContent).toBe("70");
    });
});

describe("a group's head (#1671)", () => {
    test("is marked as a head, its count after its label; its children and any other row are not", () => {
        const { container } = renderTable("table-totals.heads");
        const rows = [...container.querySelectorAll("tbody tr")];
        expect(rows.map((tr) => [tr.querySelector("td")!.textContent, tr.hasAttribute("data-row-head")])).toEqual([
            ["NSW", false], ["SA2", true], ["Tools", false], ["Wire", false],
        ]);
        expect(rows[1]!.querySelector("td [data-row-count]")!.textContent).toBe("2");
        expect(container.querySelectorAll("[data-row-count]")).toHaveLength(1);
    });
});

describe("a row its host marks (#1673)", () => {
    /** SA's row, by its pre-order index: the one a click chose. */
    const SA = (rowIndex: number) => rowIndex === 1;
    /** Each body row: its first cell's words, whether it is marked, and the ground its row stands on. */
    const drawn = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("tbody tr")].map((tr) =>
        [tr.querySelector("td")!.textContent, tr.getAttribute("data-selected"), tr.parentElement!.style.background] as const);

    test("wears the selected row's ground and data-selected, with no checkbox column; no other row does, and a table whose host marks none has none", () => {
        const marked = renderTable("table-totals.marked", SA);
        expect(drawn(marked.container)).toEqual([
            ["NSW", null, ""], ["SA2", "true", "var(--chakra-colors-bg-subtle)"], ["Tools", null, ""], ["Wire", null, ""],
        ]);
        expect(marked.container.querySelectorAll("input[type=checkbox], input[type=radio]")).toHaveLength(0);
        marked.unmount();
        const plain = renderTable("table-totals.unmarked");
        expect(drawn(plain.container).map(([, selected, ground]) => [selected, ground])).toEqual([[null, ""], [null, ""], [null, ""], [null, ""]]);
    });

    test("follows its row by its pre-order index through a sort", async () => {
        const { container } = renderTable("table-totals.marked-sorted", SA);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sort by region" })); });
        // SA sorts first, and is still the marked one.
        expect(drawn(container).filter(([, selected]) => selected === "true").map(([words]) => words)).toEqual(["SA2"]);
        expect(drawn(container)[0]![0]).toBe("SA2");
    });
});
