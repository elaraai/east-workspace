/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A source that serves SHORT windows (#829), through the Plan's and the Table's
 * paged readers. (The Sheet derives through the same `buildRowSource`, which
 * the east-ui specs pin; its reader is being reworked in #741, so it keeps its
 * own paging tests rather than growing new ones here.)
 *
 * e3 trims every page of a dataset to a byte budget, so a dataset of wide
 * elements answers a 200-element request with fewer. Every renderer addresses
 * its windows at `w × 200`, so if a short answer were taken as the window, the
 * elements between it and the next window would never be asked for — no
 * error, just rows that are not there. The components never see the trim:
 * their DERIVED source (`buildRowSource`) re-requests whatever a short window
 * left out.
 *
 * These trees are built by the real factories over sources built by hand to
 * the row-source contract, each serving at most `TRIM` elements a window — the
 * in-memory twin of the server's trim — and compiled, so the windows the
 * drivers read are the ones the derived `page` actually assembles. Each driver
 * is walked the way a user scrolls: to the end (which evicts), back to the top,
 * and by a seek jump; at every step each resident window must be WHOLE, and
 * over the walk every element must appear, each exactly once per window. (The
 * Plan's driver is framework-free since #815, so it is driven directly.)
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { ArrayType, DictType, East, IntegerType, OptionType, StringType, StructType, none, some, type ValueTypeOf } from "@elaraai/east";
import { Paged, Plan, Table, UIComponentType } from "@elaraai/east-ui/internal";
import { PLAN_PAGE_SIZE, type PlanPagedSourceValue } from "./plan/use-plan-paging.js";
import { createPagingDriver, type PagingDriver } from "./plan/controller/paging.js";
import { restUi, skeletonHeight, windowSkeleton } from "./plan/model.js";
import { useTablePagedRows, type TablePagedSourceValue } from "./table/use-paged-rows.js";
import { rowKey } from "./plan/plan.test-utils.js";

afterEach(cleanup);

type UIValue = ValueTypeOf<typeof UIComponentType>;

/** Elements a piece serves — a 200-element window is six pieces. */
const TRIM = 37n;

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");

/** 5,000 keyed entries — 25 windows, enough rows to make the Plan evict. */
const Entry = StructType({ n: IntegerType });
const Entries = DictType(StringType, Entry);
const ENTRIES = new Map(Array.from({ length: 5_000 }, (_, i) =>
    [`e${String(i).padStart(5, "0")}`, { n: BigInt(i) }] as const));
/** The entries' keys, in key order — fixed width, so build order is key order. */
const ENTRY_KEYS = [...ENTRIES.keys()];
/** An entry's row on the canvas — the `entries` series at the entry's key (#822). */
const entryRow = (i: number) => rowKey(ENTRY_KEYS[i]!, "entries");

/** The entries a piece at a time: a window of at most `TRIM` entries, in key order. */
const TRIMMED_ENTRIES_PAGE = East.function([IntegerType, IntegerType], OptionType(Entries), ($, offset, limit) => {
    const all = $.const(ENTRIES, Entries);
    const keys = $.const(ENTRY_KEYS, ArrayType(StringType));
    const n = $.let(keys.size());
    const start = $.let(offset.less(n).ifElse(() => offset, () => n));
    const served = $.let(limit.less(TRIM).ifElse(() => limit, () => TRIM));
    const end = $.let(start.add(served).less(n).ifElse(() => start.add(served), () => n));
    return some(all.getKeys(keys.slice(start, end).toSet()));
});
const ENTRIES_TOTAL = East.function([], OptionType(IntegerType), ($) => {
    const all = $.const(ENTRIES, Entries);
    return some(all.size());
});
const TRIMMED_ENTRIES = { id: "trim-plan", page: TRIMMED_ENTRIES_PAGE, total: ENTRIES_TOTAL, seek: none };

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

/** The Plan's derived source: one span row per entry, trimmed pieces. */
function planSource(): PlanPagedSourceValue {
    const ui = compiled(East.function([], UIComponentType, ($) => {
        const source = $.const(TRIMMED_ENTRIES, Paged.Types.Source(Entries));
        const series = $.const([
            Plan.series.span(Entry, { key: "entries", title: "Entries", label: (_r, k) => k, runs: () => [] }),
        ], ArrayType(Plan.Types.Series(Entry)));
        const axis = $.const(Plan.axis({ window: { min: W27, max: W39 }, resolution: "week" }));
        return Plan.Root({ axis, data: source, series });
    }));
    if (ui.type !== "Plan" || ui.value.rows.type !== "paged") throw new Error(`expected a paged Plan, got ${ui.type}`);
    return ui.value.rows.value;
}

function tableSource(): TablePagedSourceValue {
    const ui = compiled(East.function([], UIComponentType, ($) => {
        const source = $.const(TRIMMED_ROWS, Paged.Types.Source(Rows));
        return Table.Root(source, ["id", "name"]);
    }));
    if (ui.type !== "Table" || ui.value.rows.type !== "paged") throw new Error(`expected a paged Table, got ${ui.type}`);
    return ui.value.rows.value;
}

// ── The Plan ────────────────────────────────────────────────────────────────

let plan: PagingDriver | undefined;
afterEach(() => {
    plan?.disconnect();
    plan = undefined;
});

/** The Plan's paging driver over `src`, as the canvas drives it. */
function drivePlan(src: PlanPagedSourceValue): PagingDriver {
    const driver = createPagingDriver({
        skeletonOf: (rows) => windowSkeleton(rows),
        heightOf: (sk) => skeletonHeight(sk, restUi("resource"), false),
        restHeightOf: (sk) => skeletonHeight(sk, restUi("resource"), false),
        onChange: () => undefined,
    });
    plan = driver;
    driver.setSource(src);
    return driver;
}

/** Rows per resident window — from the driver's own row → window map. */
function planWindowSizes(): Map<number, number> {
    const sizes = new Map<number, number>();
    for (const { w } of plan?.getSnapshot().origin.values() ?? []) sizes.set(w, (sizes.get(w) ?? 0) + 1);
    return sizes;
}

/** Every resident window holds all of its elements' rows — 200, one per entry. */
function expectWholePlanWindows(): void {
    for (const [w, n] of planWindowSizes()) expect(n, `window ${w}`).toBe(PLAN_PAGE_SIZE);
}

describe("a trimmed source through the Plan's paging driver (#829)", () => {
    test("walking to the end reads every entry, in whole windows, through eviction and back", async () => {
        const driver = drivePlan(planSource());
        await waitFor(() => expect(driver.getSnapshot().resident).toBeDefined());

        const seen = new Set<string>();
        let evicted = false;
        for (let i = 0; i < 400; i++) {
            expectWholePlanWindows();
            const snap = driver.getSnapshot();
            for (const row of snap.rows) seen.add(row.key);
            if ((snap.resident?.from ?? 0) > 0) evicted = true;
            if (snap.blocks[0]?.tail === undefined) break;
            driver.reportViewport({ kind: "band", block: 0, at: "tail" }, false);
        }
        // Every entry was on the canvas at some point — none fell between a
        // trimmed piece and the next window.
        expect(seen.size).toBe(ENTRY_KEYS.length);
        expect(evicted, "the walk evicted the head").toBe(true);

        // Back to the top: the evicted window is read again — whole again.
        driver.jumpToElement(0);
        await waitFor(() => expect(driver.getSnapshot().origin.has(entryRow(0))).toBe(true));
        expectWholePlanWindows();
    });

    test("a seek jump lands on its element inside a whole window", async () => {
        const driver = drivePlan(planSource());
        await waitFor(() => expect(driver.getSnapshot().resident).toBeDefined());
        driver.jumpToElement(3_333);
        await waitFor(() => expect(driver.getSnapshot().origin.has(entryRow(3_333))).toBe(true));
        expectWholePlanWindows();
        expect(driver.getSnapshot().origin.get(entryRow(3_333))).toEqual({ block: 0, w: Math.floor(3_333 / PLAN_PAGE_SIZE) });
    });
});

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
