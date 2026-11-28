/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The record's totals a tile, read through a record Slice on e3 itself
 * (#1732): the grouped example's print jobs (`planSeriesJobs`), bound with
 * their month, quarter and year totals listed apart from their indexes. A
 * source's totals at a tile are one range of the whole tiles a range touches,
 * through the totals that serve its narrowing — its window's own range among
 * its choices — read in one request, each tile's count the jobs that touch
 * it; they are kept for the record's revision, so the same range asked again
 * reads nothing. A tile no totals are listed at, and a narrowing no totals
 * serve, are unserved.
 */

import { describe, test, expect } from "vitest";
import { waitFor } from "@testing-library/react";
import { SortedMap, StringType, compareFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Slice, type RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { recordSliceTotals, type RecordSliceTileTotals } from "@elaraai/east-ui-components/internal";
import { Data } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-grouped";
import type { TreePath } from "@elaraai/e3-types";
import { e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { bindRail } from "../plan/rail.test-utils.js";

const h = e3Harness({ "plan/plan-grouped": ex }, { measure: false });

/** The jobs' record, as e3's requests name it. */
const JOBS = (ex.planSeriesJobs.path as TreePath).map((step) => step.value).join(".");
/** Four whole years around the jobs' three, in ms: what a horizon reads, and the window the source narrows to. */
const FROM = Date.UTC(2026, 0, 1);
const TO = Date.UTC(2030, 0, 1);

/** The jobs' source on a rail, bound with their totals listed apart from their indexes, its window the four years. */
const bindJobs = () => bindRail(() => Slice.bindRecords("totals.jobs", {
    job: {
        source: Data.bindPaged(ex.planSeriesJobs, {
            indexes: ["plan_series_jobs_by_time"],
            totals: ["plan_series_jobs_month_totals", "plan_series_jobs_quarter_totals", "plan_series_jobs_year_totals"],
        }),
        fields: { start: { label: "Dates" } }, range: "start", initial: { start: { from: new Date(FROM), to: new Date(TO) } },
    },
}), []);

/** Each tile's start from one instant to another, a tile of so many months, in ms. */
function tilesOf(months: number, from: number, to: number): number[] {
    const out: number[] = [];
    for (let at = new Date(from); at.getTime() < to; at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + months, 1))) out.push(at.getTime());
    return out;
}

/** Each tile's count of the jobs that touch it — those starting in it, and those running into it — from the record's own rows; a tile none touches left out. */
function touched(months: number): Map<number, bigint> {
    const jobs = [...ex.planSeriesJobs.default!.values()].map((row) => [row.start.getTime(), row.end.getTime()] as const);
    const out = new Map<number, bigint>();
    for (const at of tilesOf(months, FROM, TO)) {
        const next = new Date(at);
        const end = Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + months, 1);
        const n = jobs.filter(([start, stop]) => (start >= at && start < end) || (start < at && stop > at)).length;
        if (n > 0) out.set(at, BigInt(n));
    }
    return out;
}

/** The counts of some totals read, by each tile's start. */
const counts = (tiles: ReadonlyMap<number, RecordSliceTileTotals>) => new Map([...tiles].map(([at, totals]) => [at, totals.count]));

describe("a record Slice's totals (#1732)", () => {
    test("a month's: one range of the whole months the years touch, under the source's window, read in one request — each month's count the jobs that touch it — and asked again, read nowhere", async () => {
        const part = (await bindJobs()).part("job");
        let tiles: ReadonlyMap<number, RecordSliceTileTotals> | undefined;
        await waitFor(() => {
            const read = recordSliceTotals(part, part.read().where, "month", FROM, TO);
            expect(read?.type).toBe("some");
            if (read?.type === "some") tiles = read.value;
        }, { timeout: 10_000 });
        expect(counts(tiles!)).toEqual(touched(1));
        // One search of the month totals, one range, and the entries it selects in one read; no event read, nor counted.
        const searches = h.requests("find", JOBS);
        expect(searches.map((request) => request.query.get("index"))).toEqual(["plan_series_jobs_month_totals"]);
        expect(searches[0]!.searches).toHaveLength(1);
        expect(h.requests("read", JOBS)).toEqual([]);
        // The same range again, at the same revision: nothing asked.
        const asked = h.requests().length;
        expect(recordSliceTotals(part, part.read().where, "month", FROM, TO)?.type).toBe("some");
        await settle();
        expect(h.requests().length).toBe(asked);
    });

    test("a quarter's and a year's: each tile's count the jobs that touch it, an event over two months counted once in their quarter", async () => {
        const part = (await bindJobs()).part("job");
        for (const [tile, months] of [["quarter", 3], ["year", 12]] as const) {
            let tiles: ReadonlyMap<number, RecordSliceTileTotals> | undefined;
            await waitFor(() => {
                const read = recordSliceTotals(part, part.read().where, tile, FROM, TO);
                expect(read?.type, tile).toBe("some");
                if (read?.type === "some") tiles = read.value;
            }, { timeout: 10_000 });
            expect(counts(tiles!), tile).toEqual(touched(months));
        }
    });

    test("a tile no totals are listed at, and a narrowing no totals serve, are unserved: nothing read", async () => {
        const part = (await bindJobs()).part("job");
        expect(recordSliceTotals(part, part.read().where, "week", FROM, TO)).toBeUndefined();
        // A hall chosen: the jobs' totals are led by no field, and would hold every hall's.
        const narrowed: ValueTypeOf<RecordSliceWhereType> = new SortedMap(
            [...part.read().where, ["hall", variant("values", ['"H-101"'])] as const], compareFor(StringType));
        expect(recordSliceTotals(part, narrowed, "month", FROM, TO)).toBeUndefined();
        await settle();
        expect(h.requests("find", JOBS)).toEqual([]);
    });
});
