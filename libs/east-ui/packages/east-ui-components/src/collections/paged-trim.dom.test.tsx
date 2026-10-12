/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A source that serves SHORT windows (#829), through the Table's paged reader.
 * (The Plan's walk is e3-ui-components', where the Plan renders, #1177. The
 * Sheet derives through the same `buildRowSource`, which the east-ui specs
 * pin; its reader is being reworked in #741, so it keeps its own paging tests
 * rather than growing new ones here.)
 *
 * e3 trims every page of a dataset to a byte budget, so a dataset of wide
 * elements answers a 200-element request with fewer. Every renderer addresses
 * its windows at `w × 200`, so if a short answer were taken as the window, the
 * elements between it and the next window would never be asked for — no
 * error, just rows that are not there. The components never see the trim:
 * their DERIVED source (`buildRowSource`) re-requests whatever a short window
 * left out.
 *
 * The tree is built by the real factory over a source built by hand to the
 * row-source contract, serving at most `TRIM` elements a window — the
 * in-memory twin of the server's trim — and compiled, so the windows the
 * reader reads are the ones the derived `page` actually assembles: every row
 * must appear, once, in order.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { ArrayType, East, IntegerType, OptionType, StringType, StructType, none, some, type ValueTypeOf } from "@elaraai/east";
import { Paged, Table, UIComponentType } from "@elaraai/east-ui/internal";
import { useTablePagedRows, type TablePagedSourceValue } from "./table/use-paged-rows.js";

afterEach(cleanup);

type UIValue = ValueTypeOf<typeof UIComponentType>;

/** Elements a piece serves — a 200-element window is six pieces. */
const TRIM = 37n;

/** 1,000 positional rows for the Table — five windows, all inside the dense
 *  prefix it reads (at most 20 windows). */
const Row = StructType({ id: StringType, name: StringType });
const Rows = ArrayType(Row);
const ROWS = Array.from({ length: 1_000 }, (_, i) => ({
    id: `r${String(i).padStart(5, "0")}`, name: `row ${i}`,
}));

/** The rows a piece at a time: a window of at most `TRIM` rows, in stream order. */
const TRIMMED_ROWS_PAGE = East.function([IntegerType, IntegerType], OptionType(Rows), ($, offset, limit) => {
    const all = $.const(ROWS, Rows);
    const n = $.let(all.size());
    const start = $.let(offset.less(n).ifElse(() => offset, () => n));
    const served = $.let(limit.less(TRIM).ifElse(() => limit, () => TRIM));
    const end = $.let(start.add(served).less(n).ifElse(() => start.add(served), () => n));
    return some(all.slice(start, end));
});
const ROWS_TOTAL = East.function([], OptionType(IntegerType), ($) => {
    const all = $.const(ROWS, Rows);
    return some(all.size());
});
const TRIMMED_ROWS = { id: "trim-table", page: TRIMMED_ROWS_PAGE, total: ROWS_TOTAL, seek: none };

/** A component tree built by the real factories, compiled and run. */
function compiled(fn: ReturnType<typeof East.function>): UIValue {
    return East.compile(fn as never, [])() as UIValue;
}

function tableSource(): TablePagedSourceValue {
    const ui = compiled(East.function([], UIComponentType, ($) => {
        const source = $.const(TRIMMED_ROWS, Paged.Types.Source(Rows));
        return Table.Root(source, ["id", "name"]);
    }));
    if (ui.type !== "Table" || ui.value.rows.type !== "paged") throw new Error(`expected a paged Table, got ${ui.type}`);
    return ui.value.rows.value;
}

// ── The Table ───────────────────────────────────────────────────────────────

let table: ReturnType<typeof useTablePagedRows> | undefined;

function TableHarness({ src }: { src: TablePagedSourceValue }) {
    table = useTablePagedRows(src);
    return null;
}

describe("a trimmed source through the Table's paged rows (#829)", () => {
    test("the dense prefix holds every row once, in order", async () => {
        render(<TableHarness src={tableSource()} />);
        await waitFor(() => expect(table?.loadedElements).toBe(1_000));
        expect(table!.total).toBe(1_000);
        expect(table!.rows).toHaveLength(1_000);
        // Row i is element i: the `id` cell of each row, in stream order — a
        // flat source's rows all at the top level (#954).
        table!.rows.forEach((row, i) => {
            expect(row.cells.get("id")?.value).toBe(ROWS[i]!.id);
            expect(row.depth).toBe(0n);
        });
    });
});
