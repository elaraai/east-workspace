/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The grouped example (#1710), on e3 itself: `planSeriesAll` mounts as a
 * surface mounts it — its halls read a hall at a time, rows beside groups at
 * every level, and each of its five kinds' events a cell at a time through the
 * kind's own series index, never read whole nor a row by its key: the halls'
 * inspections through an index in the halls' order, each search a range of one
 * hall; the folders' runs and the bays' deliveries through indexes in time
 * order led by the hall, each search under one hall; the presses' jobs and
 * the guillotines' trims through indexes led by the hall and the line, each
 * search under one line of one hall. Its Plan built with no refusal, and every
 * way an event kind draws drawn: chips, bars, tiles and marks.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { StringType, printFor } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-grouped";
import type { TreePath } from "@elaraai/e3-types";
import { boundFrame, frameScrolls } from "../../sheet/frame.test-utils.js";
import { planHarness, settle, slot } from "./harness.test-utils.js";

const h = planHarness({ "plan/plan-grouped": ex });

/** A record's path, as e3's requests name it. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");

// The example's frame as a browser lays it: 700px tall, each mounted row as tall as it draws.
let restore: (() => void)[] = [];
beforeEach(() => { restore = [boundFrame(700), frameScrolls()]; });
afterEach(() => { for (const undo of restore.reverse()) undo(); });

/**
 * Each kind's record, the series index its source lists, and the rows its
 * searches stand under: one hall — the index in the halls' own order, or one
 * led by the hall — or one line of one hall.
 */
const KINDS = [
    { record: ex.planSeriesInspections, series: "plan_series_inspections_by_hall_week", under: "hall" },
    { record: ex.planSeriesFolding, series: "plan_series_folding_by_hall_week", under: "hall" },
    { record: ex.planSeriesDeliveries, series: "plan_series_deliveries_by_hall_week", under: "hall" },
    { record: ex.planSeriesJobs, series: "plan_series_jobs_by_line_week", under: "line" },
    { record: ex.planSeriesTrims, series: "plan_series_trims_by_line_week", under: "line" },
] as const;

const printText = printFor(StringType);
/** Each line's key, as an index's second leading field holds it, by its hall's key as the first holds it: `.east` literals of a String. */
const LINES = new Map([...ex.planSeriesHalls.default!].map(([hall, of]) => [printText(hall), new Set([...of.lines.keys()].map((line) => printText(line)))] as const));

describe("the grouped example on e3 (#1710)", () => {
    test("planSeriesAll: its halls a hall at a time, rows beside groups, each kind's events through its series index under the rows its resources stand under, every way a kind draws drawn", async () => {
        const { container: c } = await h.mount(ex.planSeriesAll);
        await settle();
        const main = slot(c, "main") ?? c;
        expect([...c.querySelectorAll("[data-plan-diagnostic],[data-plan-error],[role='alert']")].map((el) => el.textContent ?? "")).toEqual([]);
        // Every way a kind draws: the jobs' bars, the services' chips, the deliveries' tiles and the checks' marks.
        await waitFor(() => {
            for (const drawn of ["[data-run]", "[data-chip]", "[data-event]", "[data-mark]"]) {
                expect(main.querySelectorAll(`[data-plan-row] ${drawn}`).length, drawn).toBeGreaterThan(0);
            }
        });
        // The halls a window each.
        const pages = h.requests("page", pathText(ex.planSeriesHalls.path as TreePath));
        expect(pages.length).toBeGreaterThan(0);
        expect(pages.every((read) => read.query.get("limit") === "1")).toBe(true);
        for (const { record, series, under } of KINDS) {
            const dataset = pathText(record.path as TreePath);
            // Its cells through its series index: the searches, then the entries they select.
            expect(h.readKinds(dataset, series), series).toEqual(expect.arrayContaining(["find", "runs"]));
            // Each search under one hall, the first of its key's parts, or one line of one hall, the first two.
            const searches = h.requests("find", dataset).filter((request) => request.query.get("index") === series).flatMap((request) => request.searches);
            expect(searches.length, series).toBeGreaterThan(0);
            for (const search of searches) {
                const from = "from" in search ? search.from ?? [] : [];
                const to = "to" in search ? search.to ?? [] : [];
                if (under === "hall") {
                    expect(LINES.has(from[0] ?? ""), series).toBe(true);
                    expect(to[0], series).toBe(from[0]);
                } else {
                    expect(LINES.get(from[0] ?? "")?.has(from[1] ?? ""), series).toBe(true);
                    expect([to[0], to[1]], series).toEqual([from[0], from[1]]);
                }
            }
            // Never read whole, nor a row by its key: nothing asked for one.
            expect(h.requests("read", dataset)).toEqual([]);
            expect(h.requests("rows", dataset)).toEqual([]);
        }
    });
});
