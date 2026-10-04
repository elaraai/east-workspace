/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A source that serves SHORT windows (#829), through the Plan's paged reader.
 * (The Table's walk is east-ui-components', where the Table renders; this half
 * moved here with the Plan, #1177.)
 *
 * e3 trims every page of a dataset to a byte budget, so a dataset of wide
 * elements answers a 200-element request with fewer. Every renderer addresses
 * its windows at `w × 200`, so if a short answer were taken as the window, the
 * elements between it and the next window would never be asked for — no
 * error, just rows that are not there. The canvas never sees the trim: its
 * DERIVED source (`buildRowSource`) re-requests whatever a short window left
 * out.
 *
 * The canvas is built by the real factory over a source built by hand to the
 * row-source contract, serving at most `TRIM` elements a window — the
 * in-memory twin of the server's trim — and compiled, so the windows the
 * driver reads are the ones the derived `page` actually assembles. The driver
 * is walked the way a user scrolls: to the end (which evicts), back to the
 * top, and by a seek jump; at every step each resident window must be WHOLE,
 * and over the walk every element must appear, each exactly once per window.
 * (The Plan's driver is framework-free since #815, so it is driven directly.)
 */

import { describe, test, expect, afterEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { ArrayType, DictType, East, IntegerType, OptionType, StringType, StructType, none, some } from "@elaraai/east";
import { Paged } from "@elaraai/east-ui/internal";
import { Plan } from "@elaraai/e3-ui/internal";
import { PLAN_PAGE_SIZE, type PlanPagedSourceValue } from "./use-plan-paging.js";
import { createPagingDriver, type PagingDriver } from "./controller/paging.js";
import { restUi, skeletonHeight, windowSkeleton } from "./model.js";
import { rowKey } from "./plan.test-utils.js";

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

/** The canvas — one span row per entry, over the trimmed pieces — built by the
 *  factory and compiled: its payload. */
const CANVAS = East.function([], Plan.Types.Root, ($) => {
    const source = $.const(TRIMMED_ENTRIES, Paged.Types.Source(Entries));
    const series = $.const([
        Plan.series.span(Entry, { key: "entries", title: "Entries", label: (_r, k) => k, runs: () => [] }),
    ], ArrayType(Plan.Types.Series(Entry)));
    const axis = $.const(Plan.axis({ window: { min: W27, max: W39 }, resolution: "week" }));
    return Plan.Payload({ axis, data: source, series });
});

/** The canvas's derived source. */
function planSource(): PlanPagedSourceValue {
    const root = East.compile(CANVAS, [])();
    if (root.rows.type !== "paged") throw new Error(`expected a paged canvas, got its ${root.rows.type} arm`);
    return root.rows.value;
}

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
