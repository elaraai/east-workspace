/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Table's PAGED arm (#576) — the test of whether the row-source contract
 * genuinely serves two differently-shaped components. Table is POSITIONAL: its
 * windows are arrays of mapped rows that CONCATENATE in offset order, where the
 * Plan's keyed windows merge by key. Neither component sniffs the other's
 * shape; the contract carries it.
 *
 * Also the affordance that must be withdrawn: client sort over a loaded prefix
 * sorts "within whatever happened to load" while looking like a sort of the
 * table, so a paged table offers no sort and says so where the counts are.
 *
 * And the first frame: rows with nothing to wait for render their cells at
 * once, so a table mounts at the height it keeps.
 */

import { describe, test, expect, afterEach } from "vitest";
import { useLayoutEffect } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none, toEastTypeValue, StringType, IntegerType } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { EastChakraTable, type TableRootValue } from "./index.js";

afterEach(cleanup);

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

/** One decoded cell dict — the Table's own row collection element. */
function row(name: string, qty: bigint): Map<string, unknown> {
    return new Map<string, unknown>([
        ["name", variant("String", name)],
        ["qty", variant("Integer", qty)],
    ]);
}

/** A decoded column with no `render`: the table prints its cells (#874). */
function column(key: string, tag: "String" | "Integer") {
    return {
        key,
        dataType: toEastTypeValue(tag === "String" ? StringType : IntegerType),
        valueType: toEastTypeValue(tag === "String" ? StringType : IntegerType),
        header: some(key.toUpperCase()),
        width: none, minWidth: none, maxWidth: none,
        render: none,
        format: none,
        aggregate: none,
        aggregateRender: none,
    };
}

function tableRoot(rows: unknown): TableRootValue {
    return {
        rows,
        columns: [column("name", "String"), column("qty", "Integer")],
        frozen: [],
        columnGroups: none, footer: none, footerRows: none, expandedContent: none,
        interactive: none, columnResize: some(false), virtualization: some(false),
        density: none, rowStatus: none, pagination: none, selection: none,
        onCellClick: none, onCellDoubleClick: none, onRowClick: none, onRowDoubleClick: none,
        onRowSelectionChange: none, onSortChange: none,
        review: none, reviewStatus: none, reviewApproval: none,
        slice: none, groupBy: none, style: none,
    } as unknown as TableRootValue;
}

function renderTable(value: TableRootValue, key = "table") {
    return render(
        <ChakraProvider value={system}>
            <EastChakraTable value={value} storageKey={key} />
        </ChakraProvider>,
    );
}

describe("Table paged source (#576)", () => {
    test("windows CONCATENATE in offset order — the positional arm of the shared contract", async () => {
        const w0 = [row("alpha", 1n), row("bravo", 2n)];
        const w1 = [row("charlie", 3n)];
        const offsets: bigint[] = [];
        const source = {
            id: "dom-test-table",
            page: (offset: bigint) => {
                offsets.push(offset);
                if (offset === 0n) return some(w0);
                if (offset === 200n) return some(w1);
                return some([]);
            },
            total: () => some(400n),
            seek: none,
        };
        renderTable(tableRoot(variant("paged", source)), "table-paged");

        // Rows from BOTH windows, in offset order — an array window is a
        // stream-order slice, so the prefix is the concatenation.
        await screen.findByText("alpha");
        expect(screen.getByText("charlie")).toBeTruthy();
        expect(offsets[0]).toBe(0n);
        expect(offsets).toContain(200n);
    });

    test("an INLINE table is unchanged — same rows, same one row space", async () => {
        renderTable(tableRoot(variant("inline", [row("alpha", 1n), row("bravo", 2n)])), "table-inline");
        await screen.findByText("alpha");
        expect(screen.getByText("bravo")).toBeTruthy();
    });

    test("sort is WITHDRAWN on a paged table, and only there", async () => {
        // Sorting a loaded prefix sorts within whatever landed while looking
        // like a sort of the table. The affordance goes rather than lies.
        const source = {
            id: "dom-test-sort",
            page: (offset: bigint) => (offset === 0n ? some([row("alpha", 1n)]) : some([])),
            total: () => some(400n),
            seek: none,
        };
        const { container } = renderTable(tableRoot(variant("paged", source)), "table-nosort");
        await screen.findByText("alpha");
        expect(container.querySelector('[aria-label="Sort by name"]')).toBeNull();

        cleanup();
        const inline = renderTable(tableRoot(variant("inline", [row("alpha", 1n)])), "table-sort");
        await screen.findByText("alpha");
        expect(inline.container.querySelector('[aria-label="Sort by name"]')).toBeTruthy();
    });

    test("a source that cannot be READ says why, rather than rendering an empty table", async () => {
        const boom = (): never => { throw new Error("no paging service — resolves only inside a live workspace"); };
        const source = { id: "dom-test-unreadable", page: boom, total: boom, seek: none };
        const { container } = renderTable(tableRoot(variant("paged", source)), "table-error");
        const band = await screen.findByText(/NO ROWS — the paged source could not be read/);
        expect(band.textContent).toMatch(/no paging service/);
        expect(container.querySelector("[data-table-error]")).toBeTruthy();
    });
});

/** Records the page's text at the first commit — a later sibling's layout
 *  effect runs once the table's DOM is in place, before any passive effect. */
function FirstFrame({ seen }: { seen: string[] }) {
    useLayoutEffect(() => {
        seen.push(document.body.textContent ?? "");
    }, [seen]);
    return null;
}

describe("Table rows on the first frame", () => {
    test("rows with nothing to wait for render their cells in the first frame, not a skeleton", () => {
        // A skeleton row is taller than a text row. When every mount opened
        // on skeletons, a table changed height a frame after it mounted, and
        // a virtualized host that remounts it as it scrolls chased the change.
        const seen: string[] = [];
        render(
            <ChakraProvider value={system}>
                <EastChakraTable value={tableRoot(variant("inline", [row("alpha", 1n), row("bravo", 2n)]))} storageKey="table-first-frame" />
                <FirstFrame seen={seen} />
            </ChakraProvider>,
        );
        expect(seen[0]).toContain("alpha");
        expect(seen[0]).toContain("bravo");
    });
});
