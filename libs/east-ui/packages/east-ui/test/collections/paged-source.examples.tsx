/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */

import {
    ArrayType,
    DateTimeType,
    DictType,
    East,
    FloatType,
    IntegerType,
    StringType,
    StructType,
    example,
    some,
} from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Paged, Plan, Table } from "@elaraai/east-ui";

// The row-source contract (#567/#574). A component's `data` takes the whole
// collection or a WINDOWED source of it, and `Paged.of` is the in-memory
// producer — the one that needs no server, so it is what examples, fixtures and
// tests window against. Production sources come from the platform that owns the
// data (`Data.bindPaged` in @elaraai/e3-ui), which satisfies the same contract.

export const pagedSourceCanvas = example({
    keywords: [
        "Paged", "of", "paged", "source", "window", "page", "total", "seek",
        "key", "prefix", "row-source", "contract", "in-memory", "Plan", "canvas",
        "keyed", "Dict", "key order", "offline",
    ],
    description: "Window a collection already in hand — `Paged.of` over a KEYED dict serves DICT windows in canonical key order (the same shape and order a keyed dataset's windows arrive in), reports an exact total, and derives `seek` from the keys themselves, so a search result addresses a real canvas row; the canvas consumes it exactly as it consumes a bound source, which is what makes the whole paged path — windowing, exhaustion on an empty window, totals, key search — runnable with no server",
    fn: East.function([], UIComponentType, ($) => {
        // Monday of ISO week n, 2026 — window W27–W39 (half-open), now W31.
        const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
            const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
            return w1.addWeeks(n.subtract(1n));
        }));
        const UnitRow = StructType({ start: DateTimeType, end: DateTimeType, tonnes: FloatType });
        // KEYED, and the keys are the canvas keys: `page` windows this order,
        // `seek` searches it, and a leaf row's key IS its data key (#568). The
        // authored order is irrelevant — a Dict is canonical.
        const units = $.const(new Map([
            ["L1-M07", { start: week(27n), end: week(30n), tonnes: 64.0 }],
            ["L1-M09", { start: week(28n), end: week(32n), tonnes: 112.0 }],
            ["L2-M11", { start: week(30n), end: week(34n), tonnes: 92.0 }],
            ["L2-M12", { start: week(33n), end: week(38n), tonnes: 88.0 }],
        ]), DictType(StringType, UnitRow));
        const source = $.const(Paged.of("units", units));
        const series = $.const([
            Plan.series.span(UnitRow, {
                    key: "units", title: "Units",
                label: (_r, k) => k, id: true,
                runs: (r, k) => [Plan.run({
                    key: "run", start: r.start, end: r.end,
                    label: East.str`RUN · ${k}`,
                    quantity: East.str`${East.Float.printFixed(r.tonnes, 0n)} t`,
                    qty: r.tonnes, state: "actual",
                })],
            }),
        ], ArrayType(Plan.Types.Series(UnitRow)));
        // A paged canvas DECLARES its window: fitting the axis to whatever
        // prefix has landed would re-fit it on every landed window (#567 D8).
        const axis = $.const(Plan.axis({
            window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n),
        }));
        return <Plan axis={axis} data={source} series={series} />;
    }),
    inputs: [],
});

// ── A source big enough to actually WINDOW ────────────────────────────────
// The two examples above are four rows each: one page, so they show the
// contract but never the paging. This one is 1,000 elements — five windows at
// the canvas's 200-element page — so the card shows what a paged canvas
// actually does: the opening windows land, everything below is ONE band sized
// from the ledger, and the footer counts elements as the run walks.
//
// Generated at MODULE scope: an East body never calls a host helper (east
// 990020), so the rows are built here and handed in as data.

/** Monday of ISO week `n`, 2026 (W1 Monday = 2025-12-29). */
const MONDAY_W1 = Date.UTC(2025, 11, 29);
const mondayOfWeek = (n: number): Date => new Date(MONDAY_W1 + (n - 1) * 7 * 86_400_000);

/** 1,000 units across four lines. Keys sort by LINE first, so canonical key
 *  order is deliberately not build order — the thing a windowed keyed source
 *  has to get right. */
const WIDE_UNITS = new Map(Array.from({ length: 1_000 }, (_, i) => {
    const startWeek = 27 + (i % 10);
    return [
        `L${1 + (i % 4)}-U${String(i).padStart(4, "0")}`,
        { start: mondayOfWeek(startWeek), end: mondayOfWeek(startWeek + 2), tonnes: 40 + (i % 80) },
    ] as const;
}));

export const pagedTableSource = example({
    keywords: [
        "Paged", "of", "paged", "source", "Table", "window", "page", "total",
        "row-source", "contract", "positional", "sort", "partial", "in-memory",
    ],
    description: "The SAME row-source contract over a positional component — a `Table` takes `Paged.of` exactly as a Plan does, and the difference is only the collection: Table windows are ARRAYS that concatenate in stream order (rows are addressed by index, having no identity field), where a Plan's keyed windows merge by key. Client sort is withdrawn on a paged table and the footer says so, because sorting a loaded prefix sorts within whatever happened to land while looking like a sort of the whole table",
    fn: East.function([], UIComponentType, ($) => {
        const UnitRow = StructType({ unit: StringType, line: StringType, tonnes: FloatType });
        const units = $.const([
            { unit: "L1-M07", line: "Line 1", tonnes: 64.0 },
            { unit: "L1-M09", line: "Line 1", tonnes: 112.0 },
            { unit: "L2-M11", line: "Line 2", tonnes: 92.0 },
            { unit: "L2-M12", line: "Line 2", tonnes: 88.0 },
        ], ArrayType(UnitRow));
        // POSITIONAL: an array source, so no key accessor and no `seek` — an
        // Array's stream order has nothing to binary-search.
        const source = $.const(Paged.of("units", units));
        return <Table data={source} columns={["unit", "line", "tonnes"]} />;
    }),
    inputs: [],
});

export const pagedSourceWindows = example({
    keywords: [
        "Paged", "of", "paged", "window", "windows", "band", "transport", "footer",
        "total", "scroll", "virtual", "large", "collection", "Plan", "canvas",
        "key order", "residency", "offline",
    ],
    description: "The paged canvas doing the thing it exists for — 1,000 source elements behind a 200-element page, so only the opening windows are ever built into canvas rows and everything below them is ONE band sized from the ledger, captioned with the elements it stands for. Scrolling walks the resident run forward a window at a time rather than materialising the source; the footer counts in ELEMENTS (never canvas rows, since a series may emit any number per element) and marks itself partial until the total is both known and reached. The keys sort by line, so canonical key order is deliberately not build order — the ordering a windowed keyed source has to preserve for a row to stay addressable",
    fn: East.function([], UIComponentType, ($) => {
        const UnitRow = StructType({ start: DateTimeType, end: DateTimeType, tonnes: FloatType });
        const units = $.const(WIDE_UNITS, DictType(StringType, UnitRow));
        const source = $.const(Paged.of("units", units));
        const series = $.const([
            Plan.series.span(UnitRow, {
                    key: "units-2", title: "Units",
                label: (_r, k) => k, id: true,
                value: r => some(East.str`${East.Float.printFixed(r.tonnes, 0n)} t`),
                runs: (r, k) => [Plan.run({
                    key: "run", start: r.start, end: r.end,
                    label: East.str`RUN · ${k}`,
                    qty: r.tonnes, state: "actual",
                })],
            }),
        ], ArrayType(Plan.Types.Series(UnitRow)));
        const axis = $.const(Plan.axis({
            window: { min: mondayOfWeek(27), max: mondayOfWeek(40) }, resolution: "week",
            now: mondayOfWeek(31),
        }));
        // Bounded, so the canvas virtualizes: an unbounded paged canvas would
        // mount every resident row at once and page purely on demand.
        return <Plan axis={axis} data={source} series={series} style={{ maxHeight: "420px" }} />;
    }),
    inputs: [],
});
