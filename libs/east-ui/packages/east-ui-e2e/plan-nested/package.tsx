/** @jsxImportSource @elaraai/e3-ui */
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The plan-nested lab's package (#1710): every series kind a Plan reads a cell at a time, over as many works as the
 * generator writes (`generate.ts`) and five years — e3-ui's `planNestedAll` at scale, served by an e3 on disk.
 *
 * The works are a record with no initial value, seeded from the generator's file, and the canvas's rows: the rail's
 * `rows` source pages them lean by name, narrowed by site and status, and their collections are read a cell at a time
 * through their nested series index, never whole. Each series kind stands in a section of its own over the same works:
 * the load as a line chart, the jobs as runs with the alarms as decisions, the load as a heat strip, the crews' hours
 * as a table with each crew a child row beneath its works, the parts as a tree of child rows, the alarms as marks, the
 * jobs as chips and the alarms as tiles. The library's Series tab switches each on and off.
 *
 * @packageDocumentation
 */

import { East, some, variant } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record, ui } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";
import { LabWorks, LabWorksByKey, LabWorksCrew, LabWorksPart } from "./types.ts";

/**
 * The works: unassigned until `e3 seed` commits the generator's file as their first state, read lean a page at a time
 * and their collections a cell at a time through their nested series index.
 */
const works = e3.record("lab_works", LabWorksByKey, {
    indexes: (index) => ({
        // The works by name: the rail's default order, and its search.
        lab_works_by_name: index.on(["name"]),
        // The works by site and status: what the rail narrows by.
        lab_works_by_site_status: index.on(["site", "status"]),
        // Every collection of a works in time: its jobs a span each, its alarms an instant each, its load and its crews'
        // hours at their instants, the works keeping their crews' sums, and its parts' jobs filed under every part above them.
        lab_works_in_time: index.nestedSeries({
            collections: {
                jobs: index.nestedSeries.items({ from: "start", to: "end" }),
                alarms: index.nestedSeries.items({ at: "at" }),
                load: index.nestedSeries.values(),
                crews: index.nestedSeries.rows({ hours: index.nestedSeries.values({ rollup: "sum" }) }),
                parts: index.nestedSeries.rows({ jobs: index.nestedSeries.items({ from: "start", to: "end" }, { rollup: true }), parts: index.nestedSeries.recursive() }),
            },
            tile: "week",
            // Each works' totals a week and a month at a time: what its rows shade from where they hold too many to draw.
            summary: ["week", "month"],
            // Every works' together a month, a quarter and a year at a time: the horizon's bars.
            totals: ["month", "quarter", "year"],
        }),
    }),
    mutations: (mutation) => ({
        // The works' patch door: a canvas's Save commits through it, by the works' key and each item's.
        patch: mutation.patch(),
    }),
});

/** The Plan: a section a series kind, each over the works the rail's narrowing keeps, thirteen weeks to the window. */
const planLab = ui("plan_lab", [], East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const bound = $.let(Record.bind(works, ["patch"]));
        const slice = $.let(Slice.bindRecords("lab.nested", {
            rows: {
                source: Data.bindPaged(works, { indexes: ["lab_works_by_name", "lab_works_by_site_status", "lab_works_in_time"] }),
                label: "Works", icon: { prefix: "fas", name: "industry" },
                fields: {
                    name: { label: "Name" },
                    site: { label: "Site", hints: ["north", "south", "east", "west"] },
                    status: { label: "Status", hints: ["running", "idle", "down"] },
                },
                search: ["name"],
            },
        }));
        const axis = $.let(Plan.axis({
            window: { min: new Date("2026-09-28T00:00:00Z"), max: new Date("2026-12-28T00:00:00Z") },
            resolution: "week", resolutions: ["week", "month", "quarter", "year"], now: new Date("2026-11-25T09:00:00Z"),
        }));
        return (
            <Plan
                id="nested-lab"
                axis={axis}
                slice={{ slice }}
                vocabulary={{ rows: { one: "Works", other: "Works" } }}
                series={[
                    Plan.series.section(LabWorks, { key: "load-chart", title: "Load line" }, [Plan.series.chart(LabWorks, {
                        key: "load-line", title: "Line", label: (w) => w.name,
                        layers: [Plan.line(Plan.values("load", (v) => ({ y: v })))],
                    })]),
                    Plan.series.section(LabWorks, { key: "jobs", title: "Jobs" }, [Plan.series.span(LabWorks, {
                        key: "works", title: "Runs and alarms", label: (w) => w.name, edit: true,
                        runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: job.state })),
                        decisions: Plan.items("alarms", { at: "at" }, () => ({ applied: false })),
                    })]),
                    Plan.series.section(LabWorks, { key: "loads", title: "Load" }, [Plan.series.heat(LabWorks, {
                        key: "load", title: "Heat strip", label: (w) => w.name,
                        cells: Plan.heatCells(Plan.values("load", (v) => ({ value: some(v) })), { min: 0, max: 1 }),
                    })]),
                    Plan.series.section(LabWorks, { key: "crew-hours", title: "Crew hours" }, [Plan.series.table(LabWorks, {
                        key: "crews", title: "Table", label: (w) => w.name, aggregate: "sum",
                        // Each crew a child row beneath its works, its hours typed into a week at a time: the works' sum above
                        // moves at once.
                        children: Plan.children("crews", [Plan.series.table(LabWorksCrew, {
                            key: "crew", title: "Crew", label: (c) => c.name,
                            cells: Plan.tableCells(Plan.values("hours", (h) => ({ value: some(h) }))), edit: true,
                        })]),
                    })]),
                    Plan.series.section(LabWorks, { key: "parts-tree", title: "Parts" }, [Plan.series.group(LabWorks, {
                        key: "assembly", title: "Tree", label: (w) => w.name,
                        // Each part a child row, and its parts child rows beneath it: a folded part draws its band from the
                        // jobs e3 files under it.
                        children: Plan.children("parts", [Plan.series.span(LabWorksPart, {
                            key: "parts", title: "Part", label: (p) => p.name, children: "parts", rollup: "union",
                            runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: job.state })),
                        })]),
                    })]),
                    Plan.series.section(LabWorks, { key: "alarms", title: "Alarms" }, [Plan.series.events(LabWorks, {
                        key: "alarm-marks", title: "Marks", label: (w) => w.name,
                        marks: Plan.items("alarms", { at: "at" }, (alarm) => ({ kind: variant("exception", null), label: some(alarm.code) })),
                    })]),
                    Plan.series.section(LabWorks, { key: "job-cards", title: "Job chips" }, [Plan.series.cards(LabWorks, {
                        key: "job-chips", title: "Chips", label: (w) => w.name,
                        chips: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: job.state })),
                    })]),
                    Plan.series.section(LabWorks, { key: "alarm-buckets", title: "Alarm tiles" }, [Plan.series.buckets(LabWorks, {
                        key: "alarm-tiles", title: "Tiles", label: (w) => w.name,
                        events: Plan.items("alarms", { at: "at" }, (alarm) => ({ state: variant("confirmed", null), label: some(alarm.code) })),
                    })]),
                ]}
                library={[Plan.library.series()]}
                // The works' save door: a moved job and a typed hour are drafts, saved to the record by key.
                record={bound}
                // The page's own height, less the harness's bar of workspaces over it.
                style={{ height: "calc(100vh - 48px)" }}
            />
        );
    }}</Reactive>
)));

export default e3.package("plan_nested_lab", "1.0.0", planLab, works);
