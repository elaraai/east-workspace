/** @jsxImportSource @elaraai/e3-ui */
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The plan-scale lab's package (#1710): one Plan over a print works far larger than the showcase's — 4,000 presses, and
 * as many jobs on them over five years as the generator writes (`generate.ts`), a million and more.
 *
 * The presses are a record of their own, made as the package is exported, and the canvas's rows: the rail's `rows`
 * source narrows them through their indexes — by hall, status and when each was last serviced, model, colour units,
 * whether it perfects and the shifts it runs, by a search of their names, and by two presets — and the canvas pages
 * the narrowing's presses 200 to a window as it scrolls. The jobs are a record with no initial value, seeded from the
 * generator's file (`e3 seed`), so the deploy carries none of them: the Plan reads them through the rail's `job`
 * source — a cell at a time through their flat series index, shaded from their summary where they are too many to
 * draw, the window and its count the interval index's, the horizon's bars their totals. Nothing reads them whole. It
 * is `planWindows` and `planSeriesByHall` (e3-ui's `plan-windows.examples.tsx`) at scale, served by an e3 on disk
 * rather than one in the page.
 *
 * @packageDocumentation
 */

import { ArrayType, East, IntegerType, StringType, some, variant } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record, Schedule, ui } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";
import { LAB_FIRST_PRESS, LAB_HALL_PRESSES, LAB_NOW, LAB_PRESSES, LabJobs, LabPress, LabPresses } from "./types.ts";

/** The first hall's number: halls are numbered from 10, so their names sort as their numbers do. */
const FIRST_HALL = 10n;

/** The halls' names, in order: what the rail offers to narrow the presses by. */
const HALLS = Array.from({ length: Number(LAB_PRESSES / LAB_HALL_PRESSES) }, (_, i) => `Hall ${i + Number(FIRST_HALL)}`);

/** The presses' models. */
const MODELS = ["Sheetfed 52", "Sheetfed 74", "Sheetfed 105", "Web 16"];

/** How a press stands. */
const STATUSES = ["running", "idle", "down"];

/** A press's key: `P-` and its number, fixed width, so key order is number order — the keys the generator's jobs name. */
const pressKey = East.function([IntegerType], StringType, (_$, n) => East.str`P-${n.add(LAB_FIRST_PRESS)}`);

/**
 * The presses, from their count, by key: each named by its number, a hundred to a hall, one of four models, running,
 * idle or down in turn, printing 6,000 to 15,000 sheets an hour on one to eight colour units, last serviced on one of
 * 320 days from 5 January 2026, every fifth one perfecting, and alternately on the day shift and the night shift.
 */
const generatePresses = East.function([IntegerType], LabPresses, ($, count) => {
    const models = $.const(MODELS, ArrayType(StringType));
    const statuses = $.const(STATUSES, ArrayType(StringType));
    const firstService = $.const(new Date("2026-01-05T00:00:00Z"));
    return East.Array.range(0n, count).toDict(
        (_$2, n) => pressKey(n),
        (_$2, n) => ({
            name: East.str`Press ${n.add(LAB_FIRST_PRESS)}`,
            hall: East.str`Hall ${n.divide(LAB_HALL_PRESSES).add(FIRST_HALL)}`,
            model: models.get(n.remainder(4n)),
            status: statuses.get(n.remainder(3n)),
            sheets_per_hour: n.remainder(10n).multiply(1_000n).add(6_000n).toFloat(),
            colours: n.remainder(8n).add(1n),
            serviced: firstService.addDays(n.multiply(37n).remainder(320n)),
            perfecting: n.remainder(5n).equal(0n),
            shifts: n.remainder(2n).equal(0n).ifElse(() => new Set(["Day shift"]), () => new Set(["Night shift"])),
        }),
    );
});

/** The presses, made as the package is exported, and narrowed through their indexes. */
const presses = e3.record("lab_presses", LabPresses, {
    initial: () => East.compile(generatePresses, [])(LAB_PRESSES),
    indexes: (index) => ({
        // The rail's default order, and its search.
        lab_presses_by_name: index.on(["name"]),
        lab_presses_by_hall: index.on(["hall"]),
        // A status chosen with a range of service dates is one range of this index.
        lab_presses_by_status_serviced: index.on(["status", "serviced"]),
        lab_presses_by_serviced: index.on(["serviced"]),
        lab_presses_by_model: index.on(["model"]),
        lab_presses_by_colours: index.on(["colours"]),
        lab_presses_by_perfecting: index.on(["perfecting"]),
        lab_presses_by_shift: index.on(["shifts"]),
    }),
});

/**
 * The print jobs on the presses: unassigned until `e3 seed` commits the generator's file as their first state, and
 * read only through their indexes.
 */
const jobs = e3.record("lab_jobs", LabJobs, {
    indexes: (index) => ({
        // What the rail's `job` source narrows them through: the window, its count, and the backlog.
        lab_jobs_by_time: index.interval({ from: "start", to: "end" }),
        // The cells the canvas reads them by: each job filed once, at the level its length fits from the week up,
        // under its press — the presses around the rows in view, over the weeks the window touches.
        lab_jobs_by_press_week: index.flatSeries({ key: "press", from: "start", to: "end", tile: "week" }),
        // What the canvas shades zoomed out past what it draws: each press's busy share a month.
        lab_jobs_by_press_month: index.summary({ key: "press", from: "start", to: "end", tile: "month" }),
        // What the horizon's bars read, at the period that fits the strip: how many jobs touch each.
        lab_jobs_day_totals: index.totals({ from: "start", to: "end", tile: "day" }),
        lab_jobs_week_totals: index.totals({ from: "start", to: "end", tile: "week" }),
        lab_jobs_month_totals: index.totals({ from: "start", to: "end", tile: "month" }),
        lab_jobs_quarter_totals: index.totals({ from: "start", to: "end", tile: "quarter" }),
        lab_jobs_year_totals: index.totals({ from: "start", to: "end", tile: "year" }),
    }),
    mutations: (mutation) => ({
        // The jobs' patch door: every Save commits through it.
        patch: mutation.patch(),
    }),
});

/**
 * The Plan: the presses the rail's narrowing keeps, a page at a time, each a landing row its jobs land on by `press`;
 * the jobs read a cell at a time through the rail's `job` source; four weeks to the window at day columns, zoomed out
 * to a year.
 */
const planLab = ui("plan_lab", [], East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const jobsBound = $.let(Record.bind(jobs));
        const jobEntries = $.let(Data.bindPaged(jobs));
        const slice = $.let(Slice.bindRecords("lab.plan", {
            rows: {
                source: Data.bindPaged(presses, {
                    indexes: [
                        "lab_presses_by_name", "lab_presses_by_hall", "lab_presses_by_status_serviced", "lab_presses_by_serviced",
                        "lab_presses_by_model", "lab_presses_by_colours", "lab_presses_by_perfecting", "lab_presses_by_shift",
                    ],
                }),
                label: "Presses", icon: { prefix: "fas", name: "print" },
                fields: {
                    name: { label: "Name" },
                    hall: { label: "Hall", hints: HALLS },
                    status: { label: "Status", hints: STATUSES },
                    serviced: { label: "Serviced" },
                    model: { label: "Model", hints: MODELS },
                    colours: { label: "Colours" },
                    perfecting: { label: "Perfecting" },
                    shifts: { label: "Shift", hints: ["Day shift", "Night shift"] },
                },
                search: ["name"],
            },
            job: {
                source: Data.bindPaged(jobs, {
                    indexes: ["lab_jobs_by_time", "lab_jobs_by_press_week", "lab_jobs_by_press_month"],
                    totals: ["lab_jobs_day_totals", "lab_jobs_week_totals", "lab_jobs_month_totals", "lab_jobs_quarter_totals", "lab_jobs_year_totals"],
                }),
                label: "Print jobs", fields: { start: { label: "Dates" } }, range: "start",
            },
        }, {
            presets: [
                { id: "down", name: "Down", where: { rows: { status: ["down"] } } },
                { id: "perfectors", name: "Perfectors", where: { rows: { perfecting: [true] } } },
            ],
        }));
        const axis = $.let(Plan.axis({
            window: { min: new Date("2026-11-02T00:00:00Z"), max: new Date("2026-11-30T00:00:00Z") },
            resolution: "day", resolutions: ["day", "week", "month", "quarter", "year"], now: LAB_NOW,
        }));
        return (
            <Plan
                id="scale-lab"
                axis={axis}
                slice={{ slice }}
                // Its rows are presses: the rail counts them so, and the footer's line names them so.
                vocabulary={{ rows: { one: "Press", other: "Presses" } }}
                series={[Plan.series.resources(LabPress, {
                    key: "presses", title: "Presses", icon: "print", label: p => p.name,
                    sub: (p, key) => some(East.str`${key} · ${p.hall} · ${p.model}`),
                })]}
                events={{
                    job: Schedule.events(jobsBound, {
                        name: "Print job", icon: "file-lines",
                        title: "title", start: "start", end: "end",
                        resource: { field: "press", of: "presses" },
                        state: "state", quantity: { field: "sheets", unit: "sheets" },
                        backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
                        entries: jobEntries,
                    }),
                }}
                library={[Plan.library.backlog()]}
                // The page's own height, less the harness's bar of workspaces over it.
                style={{ height: "calc(100vh - 48px)" }}
            />
        );
    }}</Reactive>
)));

export default e3.package("plan_scale_lab", "1.0.0", planLab, presses, jobs);
