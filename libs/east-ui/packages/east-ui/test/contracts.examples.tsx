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
} from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Paged, Plan } from "@elaraai/east-ui";

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
