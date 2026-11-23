/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The grouped example (#1710), on e3 itself: `planSeriesAll` mounts as a
 * surface mounts it — its halls read a hall at a time, and each of its four
 * kinds' events a cell at a time through the kind's series index in time order
 * led by the hall, each search a range a tile under one hall, never read whole
 * nor a row by its key — its Plan built with no refusal, and every way an
 * event kind draws drawn: the jobs' bars on the press's task rows, and the
 * services' chips, the deliveries' tiles and the checks' marks on the press's
 * own row.
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

/** Each kind's record and the series index in time order its source lists. */
const KINDS = [
    { record: ex.planSeriesJobs, series: "plan_series_jobs_by_hall_week" },
    { record: ex.planSeriesServices, series: "plan_series_services_by_hall_week" },
    { record: ex.planSeriesDeliveries, series: "plan_series_deliveries_by_hall_week" },
    { record: ex.planSeriesChecks, series: "plan_series_checks_by_hall_week" },
] as const;

const printText = printFor(StringType);
/** The halls' keys as the series indexes' leading field holds them: `.east` literals of a String. */
const HALLS = new Set([...ex.planSeriesHalls.default!.keys()].map((key) => printText(key)));

describe("the grouped example on e3 (#1710)", () => {
    test("planSeriesAll: its halls a hall at a time, each kind's events through its series index in time order, every way a kind draws drawn", async () => {
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
        for (const { record, series } of KINDS) {
            const dataset = pathText(record.path as TreePath);
            // Its cells through its series index in time order: the searches, then the entries they select.
            expect(h.readKinds(dataset, series)).toEqual(expect.arrayContaining(["find", "runs"]));
            // Each search a range a tile under one hall, the first of its key's parts.
            const searches = h.requests("find", dataset).filter((request) => request.query.get("index") === series).flatMap((request) => request.searches);
            expect(searches.length).toBeGreaterThan(0);
            for (const search of searches) {
                const from = "from" in search ? search.from ?? [] : [];
                const to = "to" in search ? search.to ?? [] : [];
                expect(HALLS.has(from[0] ?? "")).toBe(true);
                expect(to[0]).toBe(from[0]);
            }
            // Never read whole, nor a row by its key: nothing asked for one.
            expect(h.requests("read", dataset)).toEqual([]);
            expect(h.requests("rows", dataset)).toEqual([]);
        }
    });
});
