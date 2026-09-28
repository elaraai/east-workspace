/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Table's rows nest (#954), and every row reference follows its row.
 *
 * The rows arrive in PRE-ORDER — each parent, then its subtree — and a row's
 * position in that order is the one index every row reference carries: the
 * `rowStatus` tint, the `expandedContent` detail, the selection, the review,
 * and every event (which also carries the row's `path`). Before #954 the tint
 * and the expanded detail were keyed by the row's DISPLAY position and the
 * checkbox toggled it, so a sort moved them onto other rows; with `pagination`
 * a click and `expandedContent` got the index within the page.
 *
 * A parent is the group row: it draws its own cells, and in an `aggregate`
 * column its children's subtotal, composed bottom-up. Siblings sort among
 * themselves; a page holds whole top-level rows.
 *
 * The trees here are decoded payloads — the shape the renderer receives —
 * with host callbacks; the factory's own flattening is pinned by the east-ui
 * spec, and `table-cells.dom.test.tsx` renders a compiled nested table.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DictType, East, FloatType, IntegerType, SortedMap, StringType,
    compareFor, decodeBeast2For, encodeBeast2For, none, printFor, some, toEastTypeValue, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Table, Text, UIComponentType, type TableAggregateLiteral } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { EastChakraTable, type TableRootValue } from "./index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => {
    initializeStore(new UIStore());
    localStorage.clear();
});
afterEach(cleanup);

type UIValue = ValueTypeOf<typeof UIComponentType>;
type Cell = ValueTypeOf<typeof Table.Types.Cell>;
type Row = ValueTypeOf<typeof Table.Types.Row>;
type Column = ValueTypeOf<typeof Table.Types.Column>;

// ── Fixtures, at module scope ───────────────────────────────────────────────

/** `detail <rowIndex>` — the expanded detail, a compiled East function. */
const detailOf = East.compile(
    East.function([IntegerType], UIComponentType, (_$, i) => Text.Root(East.str`detail ${i}`)),
    getRegisteredPlatformImplementations(),
) as (i: bigint) => UIValue;

/** `<rowIndex> <path>` — what a render sees of its row, a compiled East function. */
const whereOf = East.compile(
    East.function([Table.Types.CellRenderContext], UIComponentType, (_$, ctx) => Text.Root(East.str`${ctx.rowIndex} ${ctx.path}`)),
    getRegisteredPlatformImplementations(),
) as (ctx: unknown) => UIValue;

const printPath = printFor(ArrayType(IntegerType));

/** `<text>` — footer content, a compiled East function. */
const textOf = East.compile(
    East.function([StringType], UIComponentType, (_$, s) => Text.Root(s)),
    getRegisteredPlatformImplementations(),
) as (s: string) => UIValue;

type FooterCell = ValueTypeOf<typeof Table.Types.FooterCell>;
const FooterRowType = DictType(StringType, Table.Types.FooterCell);
const encodeFooterRow = encodeBeast2For(FooterRowType);
const decodeFooterRow = decodeBeast2For(FooterRowType);
const compareStrings = compareFor(StringType);

/** A footer row as the renderer receives it: decoded from East's own encoding. */
function footerRow(cells: Record<string, FooterCell>): ValueTypeOf<typeof FooterRowType> {
    return decodeFooterRow(encodeFooterRow(new SortedMap(Object.entries(cells), compareStrings)));
}

/** A footer cell showing `text`, over `colSpan` columns. */
function footerCell(text: string, colSpan?: bigint): FooterCell {
    return { content: textOf(text), colSpan: colSpan === undefined ? none : some(colSpan), rowSpan: none };
}

/** A review config with every verb off — the quiet dot needs none. */
const REVIEW: ValueTypeOf<typeof Table.Types.Review> = {
    columnLabel: "Decision", summary: none,
    onApprove: none, onReject: none,
    onApproveAll: none, onRejectAll: none, onRerun: none, rerunLabel: "Rerun",
};

/** One decoded wire row. */
function row(cells: Record<string, Cell>, depth = 0n, collapsed = false): Row {
    return { cells: new Map(Object.entries(cells)), depth, collapsed };
}

const str = (s: string): Cell => variant("String", s) as Cell;
const int = (n: bigint): Cell => variant("Integer", n) as Cell;
const flt = (n: number): Cell => variant("Float", n) as Cell;

/** A decoded column with no `render`: the table prints its cells (#874). */
function column(key: string, type: typeof StringType | typeof IntegerType | typeof FloatType, extra: Partial<Column> = {}): Column {
    return {
        key,
        dataType: toEastTypeValue(type),
        valueType: toEastTypeValue(type),
        header: some(key),
        width: none, minWidth: none, maxWidth: none,
        render: none,
        format: none,
        aggregate: none,
        ...extra,
    };
}

/** A decoded Table root: every option off unless given. */
function tableRoot(rows: Row[], columns: Column[], options: Partial<TableRootValue> = {}): TableRootValue {
    return {
        rows: variant("inline", rows),
        columns,
        frozen: [],
        columnGroups: none, footer: none, footerRows: none, expandedContent: none,
        interactive: none, columnResize: some(false), virtualization: some(false),
        density: none, rowStatus: none, pagination: none, selection: none,
        onCellClick: none, onCellDoubleClick: none, onRowClick: none, onRowDoubleClick: none,
        onRowSelectionChange: none, onSortChange: none,
        review: none, reviewStatus: none, reviewApproval: none,
        slice: none, style: none,
        ...options,
    };
}

function renderTable(value: TableRootValue, key: string) {
    const view = (v: TableRootValue) => (
        <ChakraProvider value={system}>
            <EastChakraTable value={v} storageKey={key} />
        </ChakraProvider>
    );
    const utils = render(view(value));
    return { ...utils, rerender: (v: TableRootValue) => utils.rerender(view(v)) };
}

/** A body row's first printed cell — its name: the selection and expand
 *  columns print nothing. */
function nameOf(tr: Element): string {
    return tr.querySelector("td p")?.textContent ?? "";
}

/** Each body row's name, in display order. */
function firstCells(container: HTMLElement): string[] {
    return [...container.querySelectorAll("tbody tr")].map(nameOf);
}

/** The body row named `name`. */
function rowNamed(container: HTMLElement, name: string): HTMLElement {
    const tr = [...container.querySelectorAll<HTMLElement>("tbody tr")].find((r) => nameOf(r) === name);
    if (tr === undefined) throw new Error(`no row ${name}; rows: ${firstCells(container).join(", ")}`);
    return tr;
}

/** The wrapper holding the row whose first cell reads `name` (its detail rides in it). */
function wrapperNamed(container: HTMLElement, name: string): HTMLElement {
    return rowNamed(container, name).closest<HTMLElement>("div[data-index]")!;
}

/** A row's cell texts, in column order. */
function cellsOf(tr: HTMLElement): string[] {
    return [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "");
}

/** Lets queued East callbacks run. */
async function flush(): Promise<void> {
    await act(async () => { await Promise.resolve(); });
}

// ── Identity: every row reference follows its row ──────────────────────────

/** B, C, A in data order: B is row 0. */
const BCA = [row({ name: str("B"), v: int(2n) }), row({ name: str("C"), v: int(3n) }), row({ name: str("A"), v: int(1n) })];
const NAME_V = [column("name", StringType), column("v", IntegerType)];

describe("a row reference is the row's pre-order index, under sorting and pagination (#954)", () => {
    test("after a sort, a row's tint and its expanded detail stay with the row", () => {
        const { container } = renderTable(tableRoot(BCA, NAME_V, {
            rowStatus: some((i: bigint) => (i === 0n ? variant("danger", null) : variant("success", null))),
            expandedContent: some(detailOf),
        }), "tree-identity-sort");
        fireEvent.click(wrapperNamed(container, "B").querySelector('[aria-label="Expand row"]')!);
        expect(wrapperNamed(container, "B").textContent).toContain("detail 0");

        fireEvent.click(container.querySelector('[aria-label="Sort by v"]')!);
        // The sort moved B off the top.
        expect(firstCells(container)[0]).not.toBe("B");

        expect(wrapperNamed(container, "B").style.background).toContain("status-neg-subtle");
        for (const other of ["A", "C"]) {
            expect(wrapperNamed(container, other).style.background).toContain("status-pos-subtle");
            expect(wrapperNamed(container, other).textContent).not.toContain("detail");
        }
        expect(wrapperNamed(container, "B").textContent).toContain("detail 0");
    });

    test("after a sort, a row's checkbox selects that row", async () => {
        const changes: bigint[][] = [];
        const selection = (selected: bigint[]) => some({
            mode: variant("multiple", null),
            selected,
            onChange: (idxs: bigint[]) => { changes.push(idxs); return null; },
        });
        const { container, rerender } = renderTable(tableRoot(BCA, NAME_V, { selection: selection([]) }), "tree-identity-select");
        fireEvent.click(container.querySelector('[aria-label="Sort by v"]')!);
        // B, row 0, no longer shows at position 0.
        expect(firstCells(container).indexOf("B")).not.toBe(0);

        fireEvent.click(rowNamed(container, "B").querySelector('input[type="checkbox"]')!);
        await flush();
        expect(changes).toEqual([[0n]]);

        rerender(tableRoot(BCA, NAME_V, { selection: selection([0n]) }));
        expect((rowNamed(container, "B").querySelector("input") as HTMLInputElement).checked).toBe(true);
        expect((rowNamed(container, "C").querySelector("input") as HTMLInputElement).checked).toBe(false);
    });

    test("a shift-click range spans the rows between, as displayed", async () => {
        const changes: bigint[][] = [];
        const { container } = renderTable(tableRoot(BCA, NAME_V, {
            selection: some({ mode: variant("range", null), selected: [], onChange: (idxs: bigint[]) => { changes.push(idxs); return null; } }),
        }), "tree-identity-range");
        fireEvent.click(container.querySelector('[aria-label="Sort by v"]')!);
        const shown = firstCells(container);
        // B sits between the other two once sorted.
        expect(shown[1]).toBe("B");
        fireEvent.click(rowNamed(container, shown[0]!).querySelector("input")!);
        fireEvent.click(rowNamed(container, shown[2]!).querySelector("input")!, { shiftKey: true });
        await flush();
        // The anchor alone, then all three: B's pre-order index (0) lies
        // outside the other two's (1, 2), and is selected all the same.
        expect(changes.map((c) => [...c].sort())).toEqual([[shown[0] === "C" ? 1n : 2n], [0n, 1n, 2n]]);
    });

    test("after a sort, a row's review dot stays with the row", () => {
        const { container } = renderTable(tableRoot(BCA, NAME_V, {
            review: some(REVIEW),
            // B, row 0, is flagged; the others are clean.
            reviewStatus: some((i: bigint) => (i === 0n ? some(variant("danger", null)) : none)),
        }), "tree-identity-review");
        const statusOf = (name: string) =>
            rowNamed(container, name).querySelector('[data-slot="decisionCol"]')!.getAttribute("data-status");
        expect(["A", "B", "C"].map(statusOf)).toEqual([null, "danger", null]);

        fireEvent.click(container.querySelector('[aria-label="Sort by v"]')!);
        expect(firstCells(container)[0]).not.toBe("B");
        expect(["A", "B", "C"].map(statusOf)).toEqual([null, "danger", null]);
        // The dot is drawn on the flagged row alone.
        expect(rowNamed(container, "B").querySelector('[data-slot="statusDot"]')).not.toBeNull();
        expect(rowNamed(container, "A").querySelector('[data-slot="statusDot"]')).toBeNull();
    });

    test("with pagination, clicks and the expanded detail receive the index over the whole data", async () => {
        const rows = ["r0", "r1", "r2", "r3", "r4"].map((name, i) => row({ name: str(name), v: int(BigInt(i)) }));
        const rowClicks: unknown[] = [];
        const cellClicks: unknown[] = [];
        const { container } = renderTable(tableRoot(rows, NAME_V, {
            pagination: some({ pageSize: 2n, page: 1n, onPageChange: () => null }),
            expandedContent: some(detailOf),
            onRowClick: some((e: unknown) => { rowClicks.push(e); return null; }),
            onCellClick: some((e: unknown) => { cellClicks.push(e); return null; }),
        }), "tree-identity-page");
        expect(firstCells(container)).toEqual(["r2", "r3"]);

        fireEvent.click(rowNamed(container, "r3"));
        fireEvent.click(rowNamed(container, "r3").querySelectorAll("td")[2]!);
        await flush();
        expect(rowClicks).toEqual([{ rowIndex: 3n, path: [3n] }]);
        expect(cellClicks).toEqual([{ rowIndex: 3n, path: [3n], columnKey: "v", cellValue: int(3n) }]);

        fireEvent.click(wrapperNamed(container, "r3").querySelector('[aria-label="Expand row"]')!);
        expect(wrapperNamed(container, "r3").textContent).toContain("detail 3");
    });
});

// ── Nesting ──────────────────────────────────────────────────────────────────

/**
 * a            (0)  [0]
 *   a1         (1)  [0, 0]
 *     a1x      (2)  [0, 0, 0]
 *   a2         (3)  [0, 1]
 * b            (4)  [1]
 */
const TREE = [
    row({ name: str("a"), v: int(0n) }, 0n),
    row({ name: str("a1"), v: int(0n) }, 1n),
    row({ name: str("a1x"), v: int(5n) }, 2n),
    row({ name: str("a2"), v: int(7n) }, 1n),
    row({ name: str("b"), v: int(1n) }, 0n),
];

describe("nested rows (#954)", () => {
    test("rows show in pre-order, each at its depth, with a caret on the parents only", () => {
        const { container } = renderTable(tableRoot(TREE, NAME_V), "tree-display");
        expect(firstCells(container)).toEqual(["a", "a1", "a1x", "a2", "b"]);
        const trs = [...container.querySelectorAll<HTMLElement>("tbody tr")];
        expect(trs.map((tr) => tr.getAttribute("data-depth"))).toEqual(["0", "1", "2", "1", "0"]);
        expect(trs.map((tr) => tr.hasAttribute("data-parent"))).toEqual([true, true, false, false, false]);
        expect(trs.map((tr) => tr.querySelector('[data-slot="treeToggle"]') !== null)).toEqual([true, true, false, false, false]);
        // The indent rides on the row's depth.
        expect(trs.map((tr) => (tr.querySelector('[data-slot="treeIndent"]') as HTMLElement).style.getPropertyValue("--table-depth")))
            .toEqual(["0", "1", "2", "1", "0"]);
    });

    test("a flat table draws no indent and no caret", () => {
        const { container } = renderTable(tableRoot(BCA, NAME_V), "tree-flat");
        expect(container.querySelector('[data-slot="treeIndent"]')).toBeNull();
        expect(container.querySelector("tbody tr[data-depth]")).toBeNull();
    });

    test("collapsing a parent hides exactly its descendants, and the fold persists", () => {
        const first = renderTable(tableRoot(TREE, NAME_V), "tree-fold");
        const caret = rowNamed(first.container, "a1").querySelector<HTMLElement>('[data-slot="treeToggle"]')!;
        expect(caret.getAttribute("aria-expanded")).toBe("true");
        fireEvent.click(caret);
        expect(firstCells(first.container)).toEqual(["a", "a1", "a2", "b"]);
        expect(rowNamed(first.container, "a1").querySelector('[data-slot="treeToggle"]')!.getAttribute("aria-expanded")).toBe("false");

        // Folding the top parent hides its whole subtree.
        fireEvent.click(rowNamed(first.container, "a").querySelector('[data-slot="treeToggle"]')!);
        expect(firstCells(first.container)).toEqual(["a", "b"]);
        first.unmount();

        // Remounted under the same key, the folds hold.
        const second = renderTable(tableRoot(TREE, NAME_V), "tree-fold");
        expect(firstCells(second.container)).toEqual(["a", "b"]);
        fireEvent.click(rowNamed(second.container, "a").querySelector('[data-slot="treeToggle"]')!);
        expect(firstCells(second.container)).toEqual(["a", "a1", "a2", "b"]);
    });

    test("a row that declares itself collapsed starts closed", () => {
        const tree = TREE.map((r, i) => (i === 1 ? { ...r, collapsed: true } : r));
        const { container } = renderTable(tableRoot(tree, NAME_V), "tree-declared");
        expect(firstCells(container)).toEqual(["a", "a1", "a2", "b"]);
    });

    test("siblings sort among themselves, each parent carrying its subtree", () => {
        // v sums: a1 = 5, a = 12; so ascending puts b (1) before a (12), and
        // under a, a1 (5) before a2 (7).
        const columns = [column("name", StringType), column("v", IntegerType, { aggregate: some(variant("sum", null)) })];
        const { container } = renderTable(tableRoot(TREE, columns), "tree-sort");
        const sort = container.querySelector<HTMLElement>('[aria-label="Sort by v"]')!;
        fireEvent.click(sort);
        const once = firstCells(container);
        fireEvent.click(sort);
        const twice = firstCells(container);
        const ascending = [once, twice].find((order) => order[0] === "b")!;
        const descending = [once, twice].find((order) => order[0] === "a")!;
        expect(ascending).toEqual(["b", "a", "a1", "a1x", "a2"]);
        expect(descending).toEqual(["a", "a2", "a1", "a1x", "b"]);
    });

    test("a page holds whole top-level rows, and the pager counts top-level rows", () => {
        const page = (n: bigint) => tableRoot(TREE, NAME_V, {
            pagination: some({ pageSize: 1n, page: n, onPageChange: () => null }),
        });
        const { container, rerender } = renderTable(page(0n), "tree-page");
        expect(firstCells(container)).toEqual(["a", "a1", "a1x", "a2"]);
        expect(container.textContent).toContain("Page 1 of 2 (2 total)");
        // The second page is the second TOP-LEVEL row — not the second row.
        rerender(page(1n));
        expect(firstCells(container)).toEqual(["b"]);
        expect(container.textContent).toContain("Page 2 of 2 (2 total)");
    });

    test("events and the render context carry the row's pre-order index and path", async () => {
        const rowClicks: unknown[] = [];
        const selections: unknown[] = [];
        const columns = [column("name", StringType), column("v", IntegerType, { render: some(whereOf) })];
        const { container } = renderTable(tableRoot(TREE, columns, {
            onRowClick: some((e: unknown) => { rowClicks.push(e); return null; }),
            onRowSelectionChange: some((e: unknown) => { selections.push(e); return null; }),
            selection: some({ mode: variant("multiple", null), selected: [], onChange: () => null }),
        }), "tree-events");
        // The render sees each row's own index and path.
        expect(cellsOf(rowNamed(container, "a1x"))[2]).toBe(`2 ${printPath([0n, 0n, 0n])}`);
        expect(cellsOf(rowNamed(container, "a2"))[2]).toBe(`3 ${printPath([0n, 1n])}`);

        fireEvent.click(rowNamed(container, "a1x"));
        fireEvent.click(rowNamed(container, "a2").querySelector('input[type="checkbox"]')!);
        await flush();
        expect(rowClicks).toEqual([{ rowIndex: 2n, path: [0n, 0n, 0n] }]);
        expect(selections).toEqual([{ rowIndex: 3n, path: [0n, 1n], selected: true, selectedRowsIndices: [3n] }]);
    });

    test("select-all selects every row in the data, at every depth and on every page", async () => {
        const changes: bigint[][] = [];
        const { container } = renderTable(tableRoot(TREE, NAME_V, {
            pagination: some({ pageSize: 1n, page: 0n, onPageChange: () => null }),
            selection: some({ mode: variant("multiple", null), selected: [], onChange: (idxs: bigint[]) => { changes.push(idxs); return null; } }),
        }), "tree-select-all");
        fireEvent.click(container.querySelector('[aria-label="Select all rows"]')!);
        await flush();
        expect(changes).toEqual([[0n, 1n, 2n, 3n, 4n]]);
    });
});

// ── Subtotals ────────────────────────────────────────────────────────────────

/**
 * P            (0)
 *   Q          (1)
 *     q1       (2)
 *     q2       (3)
 *   p1         (4)
 *   p2         (5)
 */
const COMPOSED = [
    row({ name: str("P"), s: int(0n), m: flt(0), lo: int(0n), hi: int(0n), n: str("") }, 0n),
    row({ name: str("Q"), s: int(0n), m: flt(0), lo: int(0n), hi: int(0n), n: str("") }, 1n),
    row({ name: str("q1"), s: int(1n), m: flt(1), lo: int(5n), hi: int(5n), n: str("x") }, 2n),
    row({ name: str("q2"), s: int(2n), m: flt(2), lo: int(3n), hi: int(3n), n: str("y") }, 2n),
    row({ name: str("p1"), s: int(10n), m: flt(6), lo: int(4n), hi: int(4n), n: str("z") }, 1n),
    row({ name: str("p2"), s: int(4n), m: flt(3), lo: int(8n), hi: int(8n), n: str("w") }, 1n),
];
const agg = (tag: TableAggregateLiteral): Partial<Column> => ({ aggregate: some(variant(tag, null)) });
const COMPOSED_COLUMNS = [
    column("name", StringType),
    column("s", IntegerType, agg("sum")),
    column("m", FloatType, agg("mean")),
    column("lo", IntegerType, agg("min")),
    column("hi", IntegerType, agg("max")),
    column("n", StringType, agg("count")),
];

describe("a parent's subtotals compose bottom-up (#954)", () => {
    test("sum of sums, mean of means, min and max of theirs, and count the leaves beneath", () => {
        const { container } = renderTable(tableRoot(COMPOSED, COMPOSED_COLUMNS), "tree-subtotals");
        // Q over q1, q2: sum 3, mean 1.5, min 3, max 5, 2 leaves.
        expect(cellsOf(rowNamed(container, "Q"))).toEqual(["Q", "3", "1.5", "3", "5", "2"]);
        // P over Q, p1 and p2: sum 17; the mean of Q's mean, p1's and p2's —
        // 3.5, not the four leaves' 3; min 3, max 8; four leaves.
        expect(cellsOf(rowNamed(container, "P"))).toEqual(["P", "17", "3.5", "3", "8", "4"]);
        // Leaves draw their own cells.
        expect(cellsOf(rowNamed(container, "q1"))).toEqual(["q1", "1", "1.0", "5", "5", "x"]);
    });

    test("only a parent's aggregate cells are subtotals", () => {
        const { container } = renderTable(tableRoot(COMPOSED, COMPOSED_COLUMNS), "tree-subtotal-marks");
        const marks = (name: string) => [...rowNamed(container, name).querySelectorAll("td")].map((td) => td.hasAttribute("data-subtotal"));
        expect(marks("P")).toEqual([false, true, true, true, true, true]);
        expect(marks("q1")).toEqual([false, false, false, false, false, false]);
    });

    test("a parent with nothing beneath a column shows Null there, and no subtotal over it counts it", () => {
        // E's one child has no `s`, `m` or `hi` — so E shows Null in each — and
        // G's subtotals leave E out: a sum of Integers stays an Integer, a mean
        // averages the one child that shows a number, a max picks a number.
        const rows = [
            row({ name: str("G"), s: int(0n), m: flt(0), hi: int(0n) }, 0n),
            row({ name: str("E"), s: int(0n), m: flt(0), hi: int(0n) }, 1n),
            row({ name: str("e1") }, 2n),
            row({ name: str("g1"), s: int(4n), m: flt(4), hi: int(4n) }, 1n),
        ];
        const columns = [
            column("name", StringType),
            column("s", IntegerType, agg("sum")),
            column("m", FloatType, agg("mean")),
            column("hi", IntegerType, agg("max")),
        ];
        const { container } = renderTable(tableRoot(rows, columns), "tree-subtotal-null");
        expect(cellsOf(rowNamed(container, "E"))).toEqual(["E", "null", "null", "null"]);
        expect(cellsOf(rowNamed(container, "G"))).toEqual(["G", "4", "4.0", "4"]);
    });

    test("a subtotal draws through the column's render, which sees it as the cell", () => {
        const sumOf = East.compile(
            East.function([Table.Types.CellRenderContext], UIComponentType, (_$, ctx) =>
                Text.Root(East.str`= ${ctx.cellValue.unwrap("Integer")}`)),
            getRegisteredPlatformImplementations(),
        ) as (ctx: unknown) => UIValue;
        const columns = [column("name", StringType), column("s", IntegerType, { ...agg("sum"), render: some(sumOf) })];
        const { container } = renderTable(tableRoot(COMPOSED, columns), "tree-subtotal-render");
        expect(cellsOf(rowNamed(container, "P"))[1]).toBe("= 17");
        expect(cellsOf(rowNamed(container, "q2"))[1]).toBe("= 2");
    });

    test("a paged source's parents are exact over the loaded prefix — a window holds whole subtrees", async () => {
        // 400 top-level rows in two windows; the second never lands.
        const window0 = [row({ name: str("P"), s: int(0n) }, 0n), row({ name: str("p1"), s: int(4n) }, 1n), row({ name: str("p2"), s: int(5n) }, 1n)];
        const source = {
            id: "tree-paged",
            page: (offset: bigint) => (offset === 0n ? some(window0) : none),
            total: () => some(400n),
            seek: none,
        };
        const columns = [column("name", StringType), column("s", IntegerType, agg("sum"))];
        const value = tableRoot([], columns, { rows: variant("paged", source) });
        const { container, findByText } = renderTable(value, "tree-paged");
        await findByText("P");
        expect(firstCells(container)).toEqual(["P", "p1", "p2"]);
        expect(cellsOf(rowNamed(container, "P"))).toEqual(["P", "9"]);
    });
});

// ── Footer ───────────────────────────────────────────────────────────────────

/** A single footer, and one more footer row whose cell spans both columns —
 *  decoded once, here: a footer cell carries a component. */
const FOOTER = footerRow({ name: footerCell("Total"), v: footerCell("6") });
const FOOTER_ROWS = [footerRow({ name: footerCell("All rows", 2n) })];

describe("the footer", () => {
    test("the single footer draws first, then each footer row; a cell spans its colSpan's columns", () => {
        const { container } = renderTable(tableRoot(BCA, NAME_V, {
            footer: some(FOOTER),
            footerRows: some(FOOTER_ROWS),
        }), "tree-footer");
        const rows = [...container.querySelectorAll("tfoot tr")]
            .map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent ?? ""));
        expect(rows).toEqual([["Total", "6"], ["All rows"]]);
    });
});
