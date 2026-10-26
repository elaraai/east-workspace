/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

import { East, example, some, variant } from "@elaraai/east";
import { Box, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Calendar, Data, Record } from "@elaraai/e3-ui";
import {
    planSeriesPresses, planSeriesPressesByHall, planWindowJobs, planWindowJobsByPressMonth, planWindowJobsByPressWeek, planWindowJobsByTime,
    planWindowJobsPatch, planWindowPresses,
} from "../plan/plan-windows.examples.js";

// A Calendar over records too large to read whole (#1424), the print works of
// the Plan's windows example: 2,000 presses, generated where data is made, paged
// 200 to a window as the timeline scrolls, and the print jobs on them read a
// cell at a time — those of the presses on screen, over the weeks on screen —
// through the jobs' series index and their summary, which the rail's `job`
// source lists beside its interval index. Past 10,000 jobs in the cells on
// screen a press's row shades from the summary instead, the share of each month
// booked. A Calendar of event kinds on paged presses reads them so, or refuses
// them. In `calendarWindowsByHall` the presses are a record of their own, which
// the rail narrows by hall through an index of it: the timeline pages the
// narrowing's presses themselves, in the index's order.

export const calendarWindows = example({
    inputs: [],
    description: "A Calendar read a page at a time — 2,000 presses paged 200 to a window (`Calendar.resources` over `Data.bindPaged`), the timeline's rows the pages around the view and its Choosers searching the presses by key, and the print jobs on them read a cell at a time through one Slice.bindRecords rail: its `job` source lists the interval index, a series index (`e3.recordIndex.series`, the jobs by press and week) and a summary index (`e3.recordIndex.summary`, each press's busy share by month), and the Calendar reads only the jobs of the presses and the weeks on screen, two requests a change, a press's months shaded from the summary past 10,000 — the time grids and the agenda the window counted first, its Backlog paged through the source, one job by its key through the record's own entries, never a record whole",
    keywords: [
        "Calendar", "Schedule", "Calendar.resources", "Calendar.events", "Slice", "Slice.bindRecords", "source", "range", "window",
        "interval", "interval index", "series", "series index", "summary", "summary index", "e3.recordIndex", "e3.recordIndex.series",
        "e3.recordIndex.summary", "tile", "cell", "paged", "page", "Data.bindPaged", "backlog", "large record", "key search",
        "timeline", "scroll", "shading", "presses", "jobs", "Record.bind", "entries", "by key", "Save", "#1424",
    ],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        // The presses a window at a time; the jobs bound with their patch door, and read through the rail's source.
        const presses = $.let(Data.bindPaged(planWindowPresses));
        const jobs = $.let(Record.bind(planWindowJobs, [planWindowJobsPatch]));
        const entries = $.let(Data.bindPaged(planWindowJobs));
        // One rail: its `job` source lists the series and the summary beside the interval index, its range the window the
        // Calendar's navigation writes — the Calendar reads the jobs' cells through them.
        const slice = $.let(Slice.bindRecords("ex.calendarWindows", {
            job: { source: Data.bindPaged(planWindowJobs, { indexes: [planWindowJobsByTime, planWindowJobsByPressWeek, planWindowJobsByPressMonth] }),
                label: "Print jobs", icon: { prefix: "fas", name: "file-lines" }, fields: { start: { label: "Dates" } }, range: "start" },
        }));
        return <Box height="720px"><Calendar id="windows" inspector
            view={{ layout: "timeline", period: "week", date: new Date("2026-10-05T00:00:00Z") }} now={new Date("2026-10-14T09:00:00Z")}
            slice={{ slice }}
            resources={{
                presses: Calendar.resources(presses, { name: "Presses", icon: "print", label: p => p.name, meta: (p, key) => some(East.str`${key} · ${p.hall}`) }),
            }}
            events={{
                job: Calendar.events(jobs, {
                    name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                    resource: { field: "press", of: "presses" },
                    backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
                    entries,
                }),
            }}
            library={[Calendar.library.backlog()]} />
        </Box>;
    }}</Reactive>),
});

export const calendarWindowsByHall = example({
    inputs: [],
    description: "The Calendar of calendarWindows, its 2,000 presses a record narrowed by hall through the rail — a `presses` source named after the paged resource kind's slot, `Data.bindPaged(record, { indexes })` over the presses' hall index — the timeline paging the narrowing's presses themselves in the index's order, and reading the jobs' cells for the presses of the hall on screen alone; a choice keeps the last view standing until its presses land",
    keywords: [
        "Calendar", "Schedule", "Calendar.resources", "Slice", "Slice.bindRecords", "source", "rail", "narrow", "narrowing", "filter",
        "resource kind", "hall", "e3.recordIndex", "index", "paged", "Data.bindPaged", "series index", "summary index", "cell",
        "large record", "presses", "jobs", "timeline", "#1424",
    ],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const presses = $.let(Data.bindPaged(planSeriesPresses));
        const jobs = $.let(Record.bind(planWindowJobs, [planWindowJobsPatch]));
        const entries = $.let(Data.bindPaged(planWindowJobs));
        // The `presses` source narrows the paged kind by hall, through the presses' hall index: the timeline pages the
        // narrowing's presses. The `job` source reads the jobs a cell at a time, as in calendarWindows.
        const slice = $.let(Slice.bindRecords("ex.calendarWindowsByHall", {
            presses: { source: Data.bindPaged(planSeriesPresses, { indexes: [planSeriesPressesByHall] }), label: "Presses",
                icon: { prefix: "fas", name: "print" },
                fields: { hall: { label: "Hall", hints: ["Hall 1", "Hall 2", "Hall 3", "Hall 4", "Hall 5", "Hall 6", "Hall 7", "Hall 8"] } } },
            job: { source: Data.bindPaged(planWindowJobs, { indexes: [planWindowJobsByTime, planWindowJobsByPressWeek, planWindowJobsByPressMonth] }),
                label: "Print jobs", icon: { prefix: "fas", name: "file-lines" }, fields: { start: { label: "Dates" } }, range: "start" },
        }));
        return <Box height="720px"><Calendar id="windowsByHall" inspector
            view={{ layout: "timeline", period: "week", date: new Date("2026-10-05T00:00:00Z") }} now={new Date("2026-10-14T09:00:00Z")}
            slice={{ slice }}
            resources={{
                presses: Calendar.resources(presses, { name: "Presses", icon: "print", label: p => p.name, meta: (p, key) => some(East.str`${key} · ${p.hall}`) }),
            }}
            events={{
                job: Calendar.events(jobs, {
                    name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                    resource: { field: "press", of: "presses" },
                    backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
                    entries,
                }),
            }}
            library={[Calendar.library.backlog()]} />
        </Box>;
    }}</Reactive>),
});

export const calendarWindowsMobile = example({
    inputs: [],
    description: "The Calendar of calendarWindows in a phone-width container: the agenda cards of the jobs in the day, the window counted first and read through the interval index, their explicit Move, Resize and Return to backlog actions searching the 2,000 presses by key, and the Backlog paged through the rail's source",
    keywords: ["Calendar", "mobile", "agenda", "cards", "paged", "Data.bindPaged", "series index", "summary index", "presses", "jobs", "key search", "#1424"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const presses = $.let(Data.bindPaged(planWindowPresses));
        const jobs = $.let(Record.bind(planWindowJobs, [planWindowJobsPatch]));
        const entries = $.let(Data.bindPaged(planWindowJobs));
        const slice = $.let(Slice.bindRecords("ex.calendarWindowsMobile", {
            job: { source: Data.bindPaged(planWindowJobs, { indexes: [planWindowJobsByTime, planWindowJobsByPressWeek, planWindowJobsByPressMonth] }),
                label: "Print jobs", icon: { prefix: "fas", name: "file-lines" }, fields: { start: { label: "Dates" } }, range: "start" },
        }));
        return <Box width="100%" maxWidth="390px" height="760px"><Calendar id="windowsMobile" inspector
            view={{ layout: "calendar", period: "day", date: new Date("2026-10-05T00:00:00Z") }} now={new Date("2026-10-14T09:00:00Z")}
            slice={{ slice }}
            resources={{
                presses: Calendar.resources(presses, { name: "Presses", icon: "print", label: p => p.name, meta: (p, key) => some(East.str`${key} · ${p.hall}`) }),
            }}
            events={{
                job: Calendar.events(jobs, {
                    name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                    resource: { field: "press", of: "presses" },
                    backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
                    entries,
                }),
            }}
            library={[Calendar.library.backlog()]} />
        </Box>;
    }}</Reactive>),
});
