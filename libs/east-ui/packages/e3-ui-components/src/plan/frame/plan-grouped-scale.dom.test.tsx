/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Plan>` over grouped rows at a page's size (#1710), on e3 itself: halls,
 * each holding its presses, each press its tasks; one event kind, jobs, landing
 * on a press's task and read a cell at a time through its series index. What
 * the Plan asks e3 for is read from the harness's request log as the page
 * opens, as the view rests inside a hall, and as it rests with a hall's own row
 * at its top. A step waits for its scroll to rest before it reads the log
 * (`scrollStopped`): the Plan asks for a view's events only then, and a press's
 * row mounting says nothing of it.
 *
 * - At each rest the jobs read are those of the blocks of presses meeting the
 *   view, and of the next block the way the view went (#1797) — none where a
 *   page opens, which has gone no way — never every block from the page's
 *   first row: a hall's own row stands for no press (#1711). A rest back
 *   where the view has rested asks the jobs' index nothing: the jobs of the
 *   blocks it left are kept (#1797), through either index.
 * - The halls draw in the order their binding gives: by name beside their
 *   nested series index, in their keys' order without it. Their names run
 *   against their keys, so a hall's presses mount where the view looks for
 *   them only in that order (#1713).
 * - Read a hall at a time (`paging: { entries: 1 }`, #1714), the open reads
 *   the first hall's window and the two read ahead of it, a hall each, and no
 *   other; the end of the page reads the last hall's window and the few beside
 *   it, never the halls between.
 * - Read through the jobs' series index in time order, led by the hall
 *   (#1710), a rest asks a range a tile for each block of presses in view,
 *   under their own hall, from the block's first press through its last — and
 *   draws the jobs the index in key order draws, which asks a range a press a
 *   level.
 * - Some jobs are on no press. Over rows read a page at a time a Plan draws no
 *   Unassigned row (#1541), so it reads none of them: no search asks for them,
 *   through either index, and the index in time order is the only series index
 *   its page lists (#1710).
 * - With every hall folded the view shows no row a job lands on, so no press's
 *   jobs are read (#1795): folding them, a pan of the window under them, and a
 *   page opened with them so ask the jobs' index nothing, and the reader makes
 *   no kind's rows again meanwhile. Unfolded, the jobs held draw at once, and
 *   the index is asked for what is not held alone.
 * - A read of the jobs on its way is never given up while the next read is
 *   counted (#1797): a change of period, and the view moving on a block, ask
 *   it again as it was, and no read of the jobs' entries is asked twice.
 *   Through the index in time order, weeks pressed across a year's end name
 *   every cell anew over the runs the days' read asks: on its way when they are
 *   counted, they read those runs through it; landed while they were, they take
 *   them from it — e3 asked for none of them again.
 * - Zoomed out past the jobs' series tile (#1541, U1), each task beneath a
 *   press counts its own jobs, from a summary led by the task. With none, a
 *   task row draws its own jobs while the range holds few, and past the cap is
 *   hatched, one plain line saying there are too many to show (#1799): never
 *   its press's count.
 *
 * The sizes here run in the suite. A page's size is run by hand, its sizes from
 * the environment: `SCALE_HALLS=40 SCALE_PRESSES=3000 SCALE_TASKS=12`, with
 * `SCALE_NESTED=0` to bind the halls without their nested series index, and
 * `SCALE_LOG=1` to print what each step asked, the processor time it took, and
 * the rows and marks it left drawn — the same with the index and without, and
 * read a hall at a time.
 */

import { createHash } from "node:crypto";
import { describe, test, expect, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import {
    DateTimeType, DictType, East, OptionType, StringType, StructType, VariantType, equalFor, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import type { TreePath } from "@elaraai/e3-types";
import type { E3Request } from "../../e3-web.test-utils.js";
import { SCHEDULE_CELL_BLOCK, setScheduleCellsFiledProbe } from "../../shared/schedule/cells.js";
import { parseEventRef } from "../../shared/schedule/event-ref.js";
import { PLAN_GEOMETRY } from "../geometry.js";
import { rowIdOfKey } from "../model.js";
import { emulateWindowScroll, scrollStopped } from "../window-scroll.test-utils.js";
import { act, planHarness, settle, slot, zoomTo } from "./harness.test-utils.js";

// ── Sizes ────────────────────────────────────────────────────────────────────

/**
 * A size from the environment, for a run by hand; the suite's own without one. Read as the file loads, for the records
 * the test deploys are made then: a switch of this test's own, which no deployed program reads (the warning that
 * flags reading `process.env` at module scope is taken here as its rule allows, documented where it is read).
 */
function sized(name: string, fallback: number): number {
    const given = process.env[name];
    return given === undefined ? fallback : Number(given);
}
const HALLS = sized("SCALE_HALLS", 8);
const PRESSES = sized("SCALE_PRESSES", 480);
const TASKS = sized("SCALE_TASKS", 4);
/** Jobs a press, in the window. */
const JOBS = sized("SCALE_JOBS", 2);
/** Jobs a hall on no press, in the window: drawn nowhere over rows read a page at a time. */
const UNPLACED = 3;
/** Whether the halls are bound beside their nested series index, which files nothing here: `0` binds them without it. */
const NESTED = sized("SCALE_NESTED", 1) !== 0;
const LOG = sized("SCALE_LOG", 0) !== 0;

/** How many presses each hall holds: halls of four sizes in turn, adding up to the presses. */
function hallSizes(): number[] {
    const weights = Array.from({ length: HALLS }, (_x, h) => [1, 6, 3, 2][h % 4]!);
    const sum = weights.reduce((a, b) => a + b, 0);
    const sizes = weights.map((w) => Math.floor((PRESSES * w) / sum));
    sizes[0] = sizes[0]! + PRESSES - sizes.reduce((a, b) => a + b, 0);
    return sizes;
}
const SIZES = hallSizes();
const pad = (n: number, width: number) => String(n).padStart(width, "0");
const hallKey = (h: number) => `H${pad(h, 2)}`;
const taskKey = (t: number) => `t${pad(t, 2)}`;
/** Each press's code, by its hall: `P<hall><press in hall>`. */
const pressCodes: string[][] = SIZES.map((size, h) => Array.from({ length: size }, (_x, p) => `P${pad(h, 2)}${pad(p, 4)}`));
/**
 * The halls, by key, in the order the page draws them. Beside their nested series index the binding reads them through
 * the first plain index it lists, by name: the first hall, which has none, then the rest against their keys' order.
 * Without it the binding joins, and they come in their keys' order (#1713).
 */
const DRAWN: readonly number[] = NESTED
    ? [0, ...Array.from({ length: HALLS - 1 }, (_x, i) => HALLS - 1 - i)]
    : Array.from({ length: HALLS }, (_x, i) => i);

// ── The records ──────────────────────────────────────────────────────────────

const Task = StructType({});
const PressKind = VariantType({ press: StructType({}) });
const Press = StructType({ what: PressKind, tasks: DictType(StringType, Task) });
const Hall = StructType({ name: OptionType(StringType), presses: DictType(StringType, Press) });
const Halls = DictType(StringType, Hall);

const Job = StructType({ hall: StringType, press: OptionType(StringType), start: DateTimeType, end: DateTimeType, task: StringType, title: StringType });
const Jobs = DictType(StringType, Job);

const FIRST = new Date("2026-07-15T00:00:00Z");
const LAST = new Date("2026-07-29T00:00:00Z");
/**
 * The two weeks before a year ends (#1797): pressed to weeks, a window there runs into the next year, so every level's
 * run of tiles is another than the days' — the year's too, which two weeks in July never move.
 */
const YEAR_END = new Date("2026-12-14T00:00:00Z");
const YEAR_END_LAST = new Date("2026-12-28T00:00:00Z");
/** Two weeks of the next year's January: inside what weeks pressed at the year's end show, outside the days'. */
const NEXT_JANUARY = new Date("2027-01-11T00:00:00Z");
const DAY = 86_400_000;

function halls(): ValueTypeOf<typeof Halls> {
    const tasks = new Map(Array.from({ length: TASKS }, (_x, t) => [taskKey(t), {}] as const));
    return new Map(SIZES.map((_size, h) => [hallKey(h), {
        // The first hall states no name: its row is labelled by its key. The others' names run against their keys.
        name: h === 0 ? none : some(`Hall ${pad(HALLS - h, 2)}`),
        presses: new Map(pressCodes[h]!.map((code) => [code, { what: variant("press", {}), tasks: new Map(tasks) }] as const)),
    }] as const)) as ValueTypeOf<typeof Halls>;
}

/** The jobs, each in the two weeks from `first`: the window's, unless given. */
function jobs(first: Date = FIRST): ValueTypeOf<typeof Jobs> {
    const out = new Map<string, ValueTypeOf<typeof Job>>();
    let n = 0;
    for (const [h, codes] of pressCodes.entries()) {
        for (const code of codes) {
            for (let j = 0; j < JOBS; j++) {
                const at = new Date(first.getTime() + ((n + j * 5) % 14) * DAY + 9 * 3_600_000);
                out.set(`J${pad(n++, 7)}`, { hall: hallKey(h), press: some(code), start: at, end: at, task: taskKey(j % TASKS), title: `Job ${n}` });
            }
        }
        // Its jobs on no press yet.
        for (let j = 0; j < UNPLACED; j++) {
            const at = new Date(first.getTime() + ((n + j * 3) % 14) * DAY + 13 * 3_600_000);
            out.set(`J${pad(n++, 7)}`, { hall: hallKey(h), press: none, start: at, end: at, task: taskKey(0), title: `Job ${n}` });
        }
    }
    return out as ValueTypeOf<typeof Jobs>;
}

/** The jobs, by key: what a job a mark draws is found by — its press and its task. */
const JOB_ROWS = jobs();

/**
 * The jobs of the two weeks before a year ends, and as many again in the next January's first two weeks (#1797): the
 * weeks across the year's end want the days' runs, and the January's beside them.
 */
function yearEndJobs(): ValueTypeOf<typeof Jobs> {
    const out = new Map(jobs(YEAR_END));
    for (const [key, job] of jobs(NEXT_JANUARY)) out.set(`L${key}`, job);
    return out as ValueTypeOf<typeof Jobs>;
}

/**
 * 10,001 jobs more, all on the first press's third task, a few hundred a day over the window: past the cap with the
 * jobs before them (#1541, U1).
 */
function busyJobs(): ValueTypeOf<typeof Jobs> {
    const out = new Map(jobs());
    for (let i = 0; i < 10_001; i++) {
        const at = new Date(FIRST.getTime() + (i % 14) * DAY + 10 * 3_600_000);
        out.set(`X${pad(i, 5)}`, { hall: hallKey(0), press: some(pressCodes[0]![0]!), start: at, end: at, task: taskKey(2), title: `Proof ${i}` });
    }
    return out as ValueTypeOf<typeof Jobs>;
}

export const scaleHalls = e3.record("scale_halls", Halls, {
    initial: halls(),
    indexes: (index) => ({
        scale_halls_by_name: index.on(["name"]),
        // Declared only when asked: a record that declares one lists it beside every other index it pages by.
        ...(NESTED ? {
            scale_halls_in_time: index.nestedSeries({
                collections: { presses: index.nestedSeries.rows({ tasks: index.nestedSeries.rows({}) }) },
                tile: "day",
                summary: ["month"],
            }),
        } : {}),
    }),
});

export const scaleJobs = e3.record("scale_jobs", Jobs, {
    initial: jobs(),
    indexes: (index) => ({
        scale_jobs_by_time: index.interval({ from: "start", to: "end" }),
        scale_jobs_by_press_week: index.flatSeries({ key: "press", from: "start", to: "end", tile: "week" }),
        // The same jobs a week at a time under their hall, in their presses' order (#1710).
        scale_jobs_by_hall_week: index.flatSeries({ on: ["hall"], key: "press", from: "start", to: "end", tile: "week", order: "time" }),
        scale_jobs_by_press_day: index.summary({ key: "press", from: "start", to: "end", tile: "day" }),
        // The jobs counted by a press's task, the row beneath the press a job lands on (#1541, U1): led by the task.
        scale_jobs_by_task_day: index.summary({ on: ["task"], key: "press", from: "start", to: "end", tile: "day" }),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

const h = planHarness({ "plan/grouped-scale": { scaleHalls, scaleJobs } });

// ── The page ─────────────────────────────────────────────────────────────────

const page = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const record = $.let(Record.bind(scaleJobs, ["patch"]));
    const entries = $.let(Data.bindPaged(scaleJobs));
    const slice = $.let(Slice.bindRecords("plan.grouped.scale", {
        rows: {
            source: NESTED
                ? Data.bindPaged(scaleHalls, { indexes: ["scale_halls_by_name", "scale_halls_in_time"] })
                : Data.bindPaged(scaleHalls, { indexes: ["scale_halls_by_name"] }),
            fields: { name: { label: "Hall" } },
        },
        job: {
            source: Data.bindPaged(scaleJobs, { indexes: ["scale_jobs_by_time", "scale_jobs_by_press_week", "scale_jobs_by_press_day"] }),
            fields: { start: { label: "Dates" } }, range: "start",
        },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day", resolutions: ["day", "week"] }),
        slice: { slice },
        series: [Plan.series.group(Hall, {
            key: "halls", title: "Halls", label: (hall, key) => hall.name.match({ some: (_$2, name) => name, none: () => key }),
            children: Plan.children("presses", [Plan.series.kinds(Press, "what", {
                press: {
                    title: "Presses", icon: "print", label: (_press, code) => code,
                    children: Plan.children("tasks", [Plan.series.resources(Task, { key: "tasks", title: "Tasks", label: (_task, key) => key })]),
                },
            })]),
        })],
        events: {
            job: Schedule.events(record, {
                name: "Job", icon: "list-check", draw: "marks", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "press" }, child: { field: "task", of: "tasks" },
                overlaps: "allow", locked: () => true, entries,
            }),
        },
    });
}))) };

/**
 * The same page read a hall at a time (#1714): a window of the rows one hall, each with every press it holds, where a
 * window of 200 holds every hall here.
 */
const byHall = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const record = $.let(Record.bind(scaleJobs, ["patch"]));
    const entries = $.let(Data.bindPaged(scaleJobs));
    const slice = $.let(Slice.bindRecords("plan.grouped.scale.byHall", {
        rows: {
            source: NESTED
                ? Data.bindPaged(scaleHalls, { indexes: ["scale_halls_by_name", "scale_halls_in_time"] })
                : Data.bindPaged(scaleHalls, { indexes: ["scale_halls_by_name"] }),
            fields: { name: { label: "Hall" } },
        },
        job: {
            source: Data.bindPaged(scaleJobs, { indexes: ["scale_jobs_by_time", "scale_jobs_by_press_week", "scale_jobs_by_press_day"] }),
            fields: { start: { label: "Dates" } }, range: "start",
        },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day", resolutions: ["day", "week"] }),
        slice: { slice },
        paging: { entries: 1 },
        series: [Plan.series.group(Hall, {
            key: "halls", title: "Halls", label: (hall, key) => hall.name.match({ some: (_$2, name) => name, none: () => key }),
            children: Plan.children("presses", [Plan.series.kinds(Press, "what", {
                press: {
                    title: "Presses", icon: "print", label: (_press, code) => code,
                    children: Plan.children("tasks", [Plan.series.resources(Task, { key: "tasks", title: "Tasks", label: (_task, key) => key })]),
                },
            })]),
        })],
        events: {
            job: Schedule.events(record, {
                name: "Job", icon: "list-check", draw: "marks", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "press" }, child: { field: "task", of: "tasks" },
                overlaps: "allow", locked: () => true, entries,
            }),
        },
    });
}))) };

/**
 * The same page, a hall a window, its jobs read through their series index in time order led by the hall (#1710): the
 * one series index its source lists.
 */
const inTime = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const record = $.let(Record.bind(scaleJobs, ["patch"]));
    const entries = $.let(Data.bindPaged(scaleJobs));
    const slice = $.let(Slice.bindRecords("plan.grouped.scale.inTime", {
        rows: {
            source: NESTED
                ? Data.bindPaged(scaleHalls, { indexes: ["scale_halls_by_name", "scale_halls_in_time"] })
                : Data.bindPaged(scaleHalls, { indexes: ["scale_halls_by_name"] }),
            fields: { name: { label: "Hall" } },
        },
        job: {
            source: Data.bindPaged(scaleJobs, { indexes: ["scale_jobs_by_time", "scale_jobs_by_hall_week", "scale_jobs_by_press_day"] }),
            fields: { start: { label: "Dates" } }, range: "start",
        },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day", resolutions: ["day", "week"] }),
        slice: { slice },
        paging: { entries: 1 },
        series: [Plan.series.group(Hall, {
            key: "halls", title: "Halls", label: (hall, key) => hall.name.match({ some: (_$2, name) => name, none: () => key }),
            children: Plan.children("presses", [Plan.series.kinds(Press, "what", {
                press: {
                    title: "Presses", icon: "print", label: (_press, code) => code,
                    children: Plan.children("tasks", [Plan.series.resources(Task, { key: "tasks", title: "Tasks", label: (_task, key) => key })]),
                },
            })]),
        })],
        events: {
            job: Schedule.events(record, {
                name: "Job", icon: "list-check", draw: "marks", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "press" }, child: { field: "task", of: "tasks" },
                overlaps: "allow", locked: () => true, entries,
            }),
        },
    });
}))) };

/**
 * The page a hall a window, its zoom reaching a month (#1541, U1): zoomed out past the jobs' series index's week, each
 * row beneath a press shades from the summary its source lists led by the job's task — its own jobs counted.
 */
const byTask = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const record = $.let(Record.bind(scaleJobs, ["patch"]));
    const entries = $.let(Data.bindPaged(scaleJobs));
    const slice = $.let(Slice.bindRecords("plan.grouped.scale.byTask", {
        rows: {
            source: NESTED
                ? Data.bindPaged(scaleHalls, { indexes: ["scale_halls_by_name", "scale_halls_in_time"] })
                : Data.bindPaged(scaleHalls, { indexes: ["scale_halls_by_name"] }),
            fields: { name: { label: "Hall" } },
        },
        job: {
            source: Data.bindPaged(scaleJobs, { indexes: ["scale_jobs_by_time", "scale_jobs_by_press_week", "scale_jobs_by_press_day", "scale_jobs_by_task_day"] }),
            fields: { start: { label: "Dates" } }, range: "start",
        },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day", resolutions: ["day", "week", "month"] }),
        slice: { slice },
        paging: { entries: 1 },
        series: [Plan.series.group(Hall, {
            key: "halls", title: "Halls", label: (hall, key) => hall.name.match({ some: (_$2, name) => name, none: () => key }),
            children: Plan.children("presses", [Plan.series.kinds(Press, "what", {
                press: {
                    title: "Presses", icon: "print", label: (_press, code) => code,
                    children: Plan.children("tasks", [Plan.series.resources(Task, { key: "tasks", title: "Tasks", label: (_task, key) => key })]),
                },
            })]),
        })],
        events: {
            job: Schedule.events(record, {
                name: "Job", icon: "list-check", draw: "marks", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "press" }, child: { field: "task", of: "tasks" },
                overlaps: "allow", locked: () => true, entries,
            }),
        },
    });
}))) };

/** The same page, its source listing the presses' summary alone: no summary counts a task's jobs (#1541, U1). */
const byPress = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const record = $.let(Record.bind(scaleJobs, ["patch"]));
    const entries = $.let(Data.bindPaged(scaleJobs));
    const slice = $.let(Slice.bindRecords("plan.grouped.scale.byPress", {
        rows: {
            source: NESTED
                ? Data.bindPaged(scaleHalls, { indexes: ["scale_halls_by_name", "scale_halls_in_time"] })
                : Data.bindPaged(scaleHalls, { indexes: ["scale_halls_by_name"] }),
            fields: { name: { label: "Hall" } },
        },
        job: {
            source: Data.bindPaged(scaleJobs, { indexes: ["scale_jobs_by_time", "scale_jobs_by_press_week", "scale_jobs_by_press_day"] }),
            fields: { start: { label: "Dates" } }, range: "start",
        },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day", resolutions: ["day", "week", "month"] }),
        slice: { slice },
        paging: { entries: 1 },
        series: [Plan.series.group(Hall, {
            key: "halls", title: "Halls", label: (hall, key) => hall.name.match({ some: (_$2, name) => name, none: () => key }),
            children: Plan.children("presses", [Plan.series.kinds(Press, "what", {
                press: {
                    title: "Presses", icon: "print", label: (_press, code) => code,
                    children: Plan.children("tasks", [Plan.series.resources(Task, { key: "tasks", title: "Tasks", label: (_task, key) => key })]),
                },
            })]),
        })],
        events: {
            job: Schedule.events(record, {
                name: "Job", icon: "list-check", draw: "marks", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "press" }, child: { field: "task", of: "tasks" },
                overlaps: "allow", locked: () => true, entries,
            }),
        },
    });
}))) };

/**
 * The page read through the jobs' series index in time order, a hall a window, its window the two weeks before a year
 * ends (#1797): pressed to weeks, every cell it reads is named anew, over the runs of tiles the days read.
 */
const yearEnd = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const record = $.let(Record.bind(scaleJobs, ["patch"]));
    const entries = $.let(Data.bindPaged(scaleJobs));
    const slice = $.let(Slice.bindRecords("plan.grouped.scale.yearEnd", {
        rows: {
            source: NESTED
                ? Data.bindPaged(scaleHalls, { indexes: ["scale_halls_by_name", "scale_halls_in_time"] })
                : Data.bindPaged(scaleHalls, { indexes: ["scale_halls_by_name"] }),
            fields: { name: { label: "Hall" } },
        },
        job: {
            source: Data.bindPaged(scaleJobs, { indexes: ["scale_jobs_by_time", "scale_jobs_by_hall_week", "scale_jobs_by_press_day"] }),
            fields: { start: { label: "Dates" } }, range: "start",
        },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: YEAR_END, max: YEAR_END_LAST }, resolution: "day", resolutions: ["day", "week"] }),
        slice: { slice },
        paging: { entries: 1 },
        series: [Plan.series.group(Hall, {
            key: "halls", title: "Halls", label: (hall, key) => hall.name.match({ some: (_$2, name) => name, none: () => key }),
            children: Plan.children("presses", [Plan.series.kinds(Press, "what", {
                press: {
                    title: "Presses", icon: "print", label: (_press, code) => code,
                    children: Plan.children("tasks", [Plan.series.resources(Task, { key: "tasks", title: "Tasks", label: (_task, key) => key })]),
                },
            })]),
        })],
        events: {
            job: Schedule.events(record, {
                name: "Job", icon: "list-check", draw: "marks", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "press" }, child: { field: "task", of: "tasks" },
                overlaps: "allow", locked: () => true, entries,
            }),
        },
    });
}))) };

// ── What the Plan asked ──────────────────────────────────────────────────────

const pathText = (path: TreePath) => path.map((step) => step.value).join(".");
const HALLS_AT = pathText(scaleHalls.path as TreePath);
const JOBS_AT = pathText(scaleJobs.path as TreePath);
const SERIES = "scale_jobs_by_press_week";
/** The jobs' series index in time order, led by the hall (#1710). */
const IN_TIME = "scale_jobs_by_hall_week";
const SUMMARY = "scale_jobs_by_press_day";
/** The jobs' summary led by the task, a press's row beneath it (#1541, U1). */
const TASK_SUMMARY = "scale_jobs_by_task_day";
/** The levels the series index files a job at, from its week tile: week, month, quarter and year. */
const LEVELS = 4;

const printText = printFor(StringType);
const printPress = printFor(OptionType(StringType));
const textEqual = equalFor(StringType);
const pressEqual = equalFor(OptionType(StringType));
/** A press as the jobs' indexes file a job on it: the `.east` text of the job's press. */
const pressLiteral = (code: string) => printPress(some(code));

/** The finds of one of the jobs' indexes since `from`. */
const findsOf = (index: string, from: number): E3Request[] => h.requests().slice(from)
    .filter((request) => request.kind === "find" && request.dataset === JOBS_AT && request.query.get("index") === index);

/** What one of the jobs' indexes was asked since `from`, its searches and its entries alike: each request's kind. */
const askedOf = (index: string, from: number): string[] => h.requests().slice(from)
    .filter((request) => request.dataset === JOBS_AT && request.query.get("index") === index).map((request) => request.kind);

/** The searches the series index was asked since `from`: each a press's jobs at a level. */
const searchesOf = (from: number): number => findsOf(SERIES, from).reduce((n, request) => n + request.searches.length, 0);

/** Whether a request reads the jobs' entries through their series index in time order (#1797). */
const inTimeRuns = (request: E3Request) => request.kind === "runs" && request.dataset === JOBS_AT && request.query.get("index") === IN_TIME;
/** Whether a request counts searches of the jobs through their series index in time order (#1797). */
const inTimeFinds = (request: E3Request) => request.kind === "find" && request.dataset === JOBS_AT && request.query.get("index") === IN_TIME;

/** Each press's place among the presses the page draws — each hall's, in the halls' order — by the press as the jobs' indexes file a job on it. */
const PLACE_OF = new Map(DRAWN.flatMap((hall) => pressCodes[hall]!).map((code, at) => [pressLiteral(code), at] as const));

/**
 * The presses whose jobs the series index was asked for since `from`, each by its place among the presses the page
 * draws, ascending: a search of the index in key order names its press first.
 */
const pressesAsked = (from: number): number[] => {
    const places = new Set<number>();
    for (const search of findsOf(SERIES, from).flatMap((request) => request.searches)) {
        const press = "from" in search ? search.from?.[0] : undefined;
        const at = press === undefined ? undefined : PLACE_OF.get(press);
        // Every search is a press's: one that names none is no search of the page's.
        expect(at).toBeDefined();
        places.add(at!);
    }
    return [...places].sort((a, b) => a - b);
};

/** The blocks of presses some places are in, where every press is in one window of the rows, ascending. */
const blocksOf = (places: readonly number[]): number[] => [...new Set(places.map((at) => Math.floor(at / SCHEDULE_CELL_BLOCK)))];

/** The jobs' marks drawn now, each by its job, in order: what two pages over the same jobs are compared by. */
const marksOf = (container: HTMLElement): string[] =>
    [...container.querySelectorAll<HTMLElement>("[data-plan-row] [data-mark]")].map((mark) => mark.getAttribute("data-mark") ?? "").sort();

/** The windows of the halls read since `from`: each by the hall it starts at and how many halls it holds. */
const hallPages = (from: number): { offset: number; limit: number }[] => h.requests().slice(from)
    .filter((request) => request.kind === "page" && request.dataset === HALLS_AT)
    .map((request) => ({ offset: Number(request.query.get("offset")), limit: Number(request.query.get("limit")) }));

/** The halls whose windows were read since `from`, each once, ascending. */
const hallWindows = (from: number): number[] => [...new Set(hallPages(from).map((read) => read.offset))].sort((a, b) => a - b);

/** The rows mounted now, in document order: those in view and the overscan beside them. */
const mounted = (container: HTMLElement): string[] =>
    [...container.querySelectorAll<HTMLElement>("[data-plan-row]")].map((row) => row.getAttribute("data-plan-row") ?? "");

/**
 * Each task row drawn now, by its task (#1541, U1): how many count cells it draws, their counts added up — a hatched
 * cell's none — whether every cell is the no-data hatch, and how many jobs it draws a mark of — a mark and its label
 * name the same job — and of them how many are another press's or another task's.
 */
const taskRows = (container: HTMLElement): { task: string; cells: number; counted: number; hatched: boolean; marks: number; foreign: number }[] =>
    [...container.querySelectorAll<HTMLElement>("[data-plan-row]")].flatMap((row) => {
        const id = rowIdOfKey(row.getAttribute("data-plan-row") ?? "");
        if (id === undefined || id.type !== "entry" || !textEqual(id.value.series, "tasks")) return [];
        // A task's row is at its hall's, its press's and its own key.
        const press = id.value.path[1] ?? "";
        const task = id.value.path[2] ?? "";
        const cells = [...row.querySelectorAll<HTMLElement>("[data-plan-bucket]")];
        const labels = [...row.querySelectorAll<HTMLElement>("[data-plan-heat-label]")].map((label) => (label.textContent ?? "").trim());
        const marks = [...new Set([...row.querySelectorAll<HTMLElement>("[data-mark]")].map((mark) => mark.getAttribute("data-mark") ?? ""))]
            .map((key) => parseEventRef(key));
        const foreign = marks.filter((ref) => {
            const job = ref.success ? JOB_ROWS.get(ref.value.key) : undefined;
            return job === undefined || !textEqual(job.task, task) || !pressEqual(job.press, some(press));
        }).length;
        return [{
            task,
            cells: cells.length,
            counted: labels.reduce((sum, label) => sum + (/^\d+$/.test(label) ? Number(label) : textEqual(label, "–") ? 0 : Number.NaN), 0),
            hatched: cells.length > 0 && cells.every((cell) => cell.hasAttribute("data-nodata")),
            marks: marks.length,
            foreign,
        }];
    });

/** Processor seconds this process has used: what a step costs, whatever else the machine is doing. */
const cpu = () => { const used = process.cpuUsage(); return (used.user + used.system) / 1e6; };

/** A short digest of some texts, in their order: what two runs compare a step's drawn rows or marks by. */
const digest = (texts: readonly string[]) => createHash("sha256").update(texts.join("\n")).digest("hex").slice(0, 12);

/** What a step asked, by what it read, what it cost, and the rows and marks it left drawn: printed for a run by hand. */
function report(step: string, from: number, cpu0: number, container: HTMLElement): void {
    if (!LOG) return;
    const asked: Record<string, { requests: number; searches: number }> = {};
    for (const request of h.requests().slice(from)) {
        const of = request.dataset === HALLS_AT ? "halls" : request.dataset === JOBS_AT ? "jobs" : request.dataset ?? request.record ?? "-";
        const index = request.query.get("index");
        const key = `${of}${index === null ? "" : `[${index}]`} ${request.kind}`;
        const at = (asked[key] ??= { requests: 0, searches: 0 });
        at.requests += 1;
        at.searches += request.kind === "find" ? request.searches.length : 0;
    }
    const rows = mounted(container);
    const marks = [...container.querySelectorAll<HTMLElement>("[data-plan-row] [data-mark]")].map((mark) => mark.getAttribute("data-mark") ?? "");
    process.stdout.write(`\n### ${step}: ${(cpu() - cpu0).toFixed(1)} processor seconds\n`
        + `### ${step}, drawn: ${rows.length} rows (${digest(rows)}) from ${rows[0] ?? "-"} to ${rows[rows.length - 1] ?? "-"}, ${marks.length} marks (${digest(marks)})\n`
        + `${JSON.stringify(asked, null, 2)}\n`);
}

describe("a Plan over grouped rows at a page's size (#1710)", () => {
    /**
     * The runs the reads of the jobs' entries through the index in time order since `from` asked that a read before
     * them asked too, each by its first row and how many entries it holds (#1797): what was asked of e3 again, a read
     * given up and asked once more among them. Each read's runs are its body's, the wire's JSON, parsed as the test
     * reads its log (the warning that flags `JSON.parse` at module scope is a deployed program's rule; no program reads
     * this).
     */
    const runsAskedAgain = (from: number): string[] => {
        const seen = new Set<string>();
        const again: string[] = [];
        for (const request of h.requests().slice(from).filter(inTimeRuns)) {
            const { runs } = JSON.parse(new TextDecoder().decode(request.body)) as { runs: number[][] };
            for (const [row, count] of runs) {
                const run = `${row}+${count}`;
                if (seen.has(run)) again.push(run);
                seen.add(run);
            }
        }
        return again;
    };

    test("each rest reads the jobs of the presses meeting the view and of the next block the way it went, a hall's own row at the top of the view among them (#1711, #1797)", async () => {
        const restore = emulateWindowScroll();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            if (LOG) process.stdout.write(`\n### sizes: ${JSON.stringify({ nested: NESTED, halls: HALLS, presses: PRESSES, tasks: TASKS, jobs: PRESSES * JOBS, sizes: SIZES })}\n`);
            // At most three blocks of presses: two a view may meet, and the next the way it went — each press its jobs at
            // every level.
            const atMost = 3 * SCHEDULE_CELL_BLOCK * LEVELS;

            // Opening: the first block, where a view opens.
            let from = h.requests().length;
            let cpu0 = cpu();
            const { container } = await h.mount(page);
            await waitFor(() => expect(container.querySelectorAll("[data-plan-row]").length).toBeGreaterThan(0), { timeout: 600_000 });
            await settle();
            report("open", from, cpu0, container);
            expect(searchesOf(from)).toBeLessThanOrEqual(SCHEDULE_CELL_BLOCK * LEVELS);
            expect(findsOf(SUMMARY, from)).toEqual([]);

            // Row heights: the Plan's own geometry, which its virtualizer sizes its rows by.
            const hallPx = PLAN_GEOMETRY.default.group;
            const pressPx = (1 + TASKS) * PLAN_GEOMETRY.default.row;
            /** Where hall `at`'s own row sits: beneath every hall drawn before it, each its own row and its presses'. */
            const hallTop = (at: number) => DRAWN.slice(0, DRAWN.indexOf(at)).reduce((sum, hall) => sum + hallPx + SIZES[hall]! * pressPx, 0);
            // The hall drawn second to last by name, far down the page; by key, the third. The halls before it differ
            // in each order, so its presses mount where the view looks only in the order the binding gives.
            const deep = 2;
            // The presses the page draws before the hall's, and how far into the hall the view rests: at the fifth press
            // of a block, so the rows in view meet that block alone.
            const before = DRAWN.slice(0, DRAWN.indexOf(deep)).reduce((sum, hall) => sum + SIZES[hall]!, 0);
            const into = (SCHEDULE_CELL_BLOCK + 5 - (before % SCHEDULE_CELL_BLOCK)) % SCHEDULE_CELL_BLOCK;
            const inside = Math.floor((before + into) / SCHEDULE_CELL_BLOCK);

            // Inside a hall far down: a press's row at the top of the view.
            from = h.requests().length;
            cpu0 = cpu();
            act(() => { window.scrollTo({ top: hallTop(deep) + hallPx + into * pressPx }); });
            await waitFor(() => expect(mounted(container).some((key) => key.includes(`P${pad(deep, 2)}`))).toBe(true), { timeout: 600_000 });
            await scrollStopped();
            await settle();
            report(`inside hall ${deep}`, from, cpu0, container);
            expect(searchesOf(from)).toBeGreaterThan(0);
            expect(searchesOf(from)).toBeLessThanOrEqual(atMost);
            expect(findsOf(SUMMARY, from)).toEqual([]);
            // The block the rows in view meet, and the next one down the page, the way the view went: none before it (#1797).
            expect(blocksOf(pressesAsked(from))).toEqual([inside, inside + 1]);
            const rested = marksOf(container);
            expect(rested.length).toBeGreaterThan(0);

            // A wheel's step on from there, a press down, inside the blocks read: the rows in view move, so the jobs are
            // read again — from the cells held, asking e3 nothing, and ordering none of the jobs by their keys again
            // (east-workspace#1776): each step of a wheel did, every job of the blocks held.
            let filed = 0;
            setScheduleCellsFiledProbe(() => { filed += 1; });
            try {
                from = h.requests().length;
                const rows = mounted(container);
                act(() => { window.scrollTo({ top: hallTop(deep) + hallPx + (into + 1) * pressPx }); });
                await waitFor(() => expect(mounted(container)).not.toEqual(rows), { timeout: 600_000 });
                await scrollStopped();
                await settle();
                expect(findsOf(SERIES, from)).toEqual([]);
                expect(filed).toBe(0);
            } finally {
                setScheduleCellsFiledProbe(undefined);
            }

            // The same hall's own row at the top of the view: no press of its own, so the presses beneath it are the ends.
            from = h.requests().length;
            cpu0 = cpu();
            act(() => { window.scrollTo({ top: hallTop(deep) }); });
            await waitFor(() => expect(mounted(container).some((key) => key.includes(`P${pad(deep, 2)}0000`))).toBe(true), { timeout: 600_000 });
            await scrollStopped();
            await settle();
            report(`hall ${deep}'s own row at the top`, from, cpu0, container);
            expect(searchesOf(from)).toBeLessThanOrEqual(atMost);
            // Back up the page: the block before the view's first is read, the way the view went, and none past those
            // the view left, which a view going back is not headed for (#1797).
            const back = blocksOf(pressesAsked(from));
            expect(back[0]).toBe(Math.floor(before / SCHEDULE_CELL_BLOCK) - 1);
            expect(back.every((block) => block < inside)).toBe(true);
            // Its jobs drawn, never its presses' shading from the summary.
            expect(findsOf(SUMMARY, from)).toEqual([]);
            expect(container.querySelectorAll("[data-plan-row] [data-mark]").length).toBeGreaterThan(0);

            // Back down to where the view rested inside the hall: the block it meets there was read and is still held,
            // and the next one down, which the view going back wanted no more, was kept (#1797) — the jobs' index is
            // asked nothing, neither a search nor an entry, and the jobs drawn there draw again.
            from = h.requests().length;
            act(() => { window.scrollTo({ top: hallTop(deep) + hallPx + into * pressPx }); });
            await waitFor(() => expect(marksOf(container)).toEqual(rested), { timeout: 600_000 });
            await scrollStopped();
            await settle();
            expect(askedOf(SERIES, from)).toEqual([]);
            expect(findsOf(SUMMARY, from)).toEqual([]);

            // Nothing failed to read on the way.
            const failed = errors.mock.calls.map((call) => call.map(String).join(" ")).filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
            expect(failed).toEqual([]);
        } finally {
            errors.mockRestore();
            restore();
        }
    }, 1_800_000);

    test("read a hall at a time, the open reads the first halls' windows alone, a hall each, and the end of the page the last hall's (#1714)", async () => {
        const restore = emulateWindowScroll();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            if (LOG) process.stdout.write(`\n### sizes, a hall a window: ${JSON.stringify({ nested: NESTED, halls: HALLS, presses: PRESSES, tasks: TASKS, jobs: PRESSES * JOBS, sizes: SIZES })}\n`);
            let from = h.requests().length;
            let cpu0 = cpu();
            const { container } = await h.mount(byHall);
            await waitFor(() => expect(container.querySelectorAll("[data-plan-row]").length).toBeGreaterThan(0), { timeout: 600_000 });
            await settle();
            report("open, a hall a window", from, cpu0, container);
            // The first hall's window and the two the driver reads ahead of it, a hall each: no other hall is read, nor made.
            expect(hallPages(from).every((read) => read.limit === 1)).toBe(true);
            expect(hallWindows(from)).toEqual([0, 1, 2]);
            // The jobs of the first hall's presses alone, the block the view opens on: a view that has gone no way reads
            // no block ahead of it (#1797) — never the next hall's first, a window on.
            expect(searchesOf(from)).toBeLessThanOrEqual(SCHEDULE_CELL_BLOCK * LEVELS);
            expect(pressesAsked(from).every((at) => at < SIZES[DRAWN[0]!]!)).toBe(true);

            // The end of the page, where the last hall drawn sits whatever the halls not read are estimated at: the
            // canvas's height moves as their windows land, and the view goes with it until the hall is drawn.
            from = h.requests().length;
            cpu0 = cpu();
            const extent = () => Number(container.querySelector("[data-virtual-extent]")?.getAttribute("data-virtual-extent") ?? "0");
            const last = DRAWN[DRAWN.length - 1]!;
            act(() => { window.scrollTo({ top: Math.max(0, extent() - window.innerHeight) }); });
            await waitFor(() => {
                act(() => { window.scrollTo({ top: Math.max(0, extent() - window.innerHeight) }); });
                expect(mounted(container).some((key) => key.includes(`P${pad(last, 2)}`))).toBe(true);
            }, { timeout: 600_000 });
            await scrollStopped();
            await settle();
            report(`the end, hall ${last}`, from, cpu0, container);
            // The last hall's window, with the few the driver keeps beside the view as the halls estimated above it settle
            // at the heights their windows land at — each in the page's second half: the view goes to the end, never
            // through the halls between.
            expect(hallPages(from).every((read) => read.limit === 1)).toBe(true);
            expect(hallWindows(from)).toContain(HALLS - 1);
            for (const w of hallWindows(from)) expect(w).toBeGreaterThanOrEqual(Math.floor(HALLS / 2));
            // Its presses' jobs, at most the blocks meeting the view and the next the way it went.
            expect(searchesOf(from)).toBeGreaterThan(0);
            expect(searchesOf(from)).toBeLessThanOrEqual(3 * SCHEDULE_CELL_BLOCK * LEVELS);
            expect(findsOf(SUMMARY, from)).toEqual([]);

            // Nothing failed to read on the way.
            const failed = errors.mock.calls.map((call) => call.map(String).join(" ")).filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
            expect(failed).toEqual([]);
        } finally {
            errors.mockRestore();
            restore();
        }
    }, 1_800_000);

    test("read through a series index in time order led by the hall, a rest asks a range a tile for each block of presses under its own hall, and draws the jobs the index in key order draws (#1710)", async () => {
        const restore = emulateWindowScroll();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            // The page read by key, a hall a window: the jobs a rest draws, and the searches it asks for them.
            let from = h.requests().length;
            const byKey = await h.mount(byHall, { storageKey: "plan-by-key" });
            await waitFor(() => expect(byKey.container.querySelectorAll("[data-plan-row] [data-mark]").length).toBeGreaterThan(0), { timeout: 600_000 });
            await settle();
            const drawn = marksOf(byKey.container);
            const asked = searchesOf(from);
            expect(drawn.length).toBeGreaterThan(0);
            expect(asked).toBeGreaterThan(0);
            byKey.unmount();

            // The same page through the index in time order: its jobs drawn — or, were it read as a kind past the cap is,
            // its presses shaded from the summary.
            from = h.requests().length;
            let cpu0 = cpu();
            const { container } = await h.mount(inTime, { storageKey: "plan-in-time" });
            await waitFor(() => expect(container.querySelectorAll("[data-plan-row] [data-mark]").length + findsOf(SUMMARY, from).length).toBeGreaterThan(0),
                { timeout: 600_000 });
            await settle();
            report("open, in time order", from, cpu0, container);
            // Never shaded: the jobs on no press, which the index led by the hall files under no press's hall, are not read.
            expect(findsOf(SUMMARY, from)).toEqual([]);
            // The same jobs drawn, and none of them through the index in key order, which this page's source does not list.
            expect(marksOf(container)).toEqual(drawn);
            expect(findsOf(SERIES, from)).toEqual([]);
            // Each search a range a tile under one hall and one level: from a first press of that hall through a last.
            const searches = findsOf(IN_TIME, from).flatMap((request) => request.searches);
            expect(searches.length).toBeGreaterThan(0);
            const runs = new Set<string>();
            for (const search of searches) {
                // A range, both its ends given: a search of another form holds no bounds.
                const from = "from" in search ? search.from ?? [] : [];
                const to = "to" in search ? search.to ?? [] : [];
                const [hall, level, tile, first] = from;
                expect(to).toEqual([hall, level, tile, expect.any(String), "true"]);
                const last = to[3]!;
                // The hall a search is under is the one its presses stand in, and it runs from a press — never from the
                // jobs on none.
                const at = pressCodes.findIndex((codes) => codes.some((code) => textEqual(pressLiteral(code), first ?? "")));
                expect(at).toBeGreaterThanOrEqual(0);
                expect(hall).toBe(printText(hallKey(at)));
                expect(pressCodes[at]!.some((code) => textEqual(pressLiteral(code), last))).toBe(true);
                runs.add(`${hall} ${first} ${last}`);
            }
            // The first hall drawn alone: a block a hall, never a search a press — and a view that has gone no way reads
            // no block ahead of it (#1797), so not the next hall's first.
            expect(runs.size).toBe(1);
            expect(searches.length).toBeLessThan(asked);

            // Further down the first hall drawn that fills a view: its presses' jobs through the same index, drawn.
            from = h.requests().length;
            cpu0 = cpu();
            const pressPx = (1 + TASKS) * PLAN_GEOMETRY.default.row;
            act(() => { window.scrollTo({ top: PLAN_GEOMETRY.default.group + Math.floor(SIZES[DRAWN[0]!]! / 2) * pressPx }); });
            await scrollStopped();
            await settle();
            report("down the page, in time order", from, cpu0, container);
            expect(container.querySelectorAll("[data-plan-row] [data-mark]").length).toBeGreaterThan(0);
            expect(findsOf(SERIES, from)).toEqual([]);
            expect(findsOf(SUMMARY, from)).toEqual([]);

            // On down into the next hall drawn, whose presses' jobs are read there, the first hall's wanted no more...
            const next = DRAWN[1]!;
            from = h.requests().length;
            act(() => { window.scrollTo({ top: 2 * PLAN_GEOMETRY.default.group + (SIZES[DRAWN[0]!]! + Math.floor(SIZES[next]! / 2)) * pressPx }); });
            await waitFor(() => expect(mounted(container).some((key) => key.includes(`P${pad(next, 2)}`))).toBe(true), { timeout: 600_000 });
            await scrollStopped();
            await settle();
            expect(askedOf(IN_TIME, from).length).toBeGreaterThan(0);
            // ...then back to the top of the page: the first hall's jobs were kept (#1797) — the index is asked nothing,
            // neither a search nor an entry, and the jobs the page opened on draw again.
            from = h.requests().length;
            act(() => { window.scrollTo({ top: 0 }); });
            await waitFor(() => expect(marksOf(container)).toEqual(drawn), { timeout: 600_000 });
            await scrollStopped();
            await settle();
            expect(askedOf(IN_TIME, from)).toEqual([]);
            expect(findsOf(SUMMARY, from)).toEqual([]);

            // Nothing failed to read on the way.
            const failed = errors.mock.calls.map((call) => call.map(String).join(" ")).filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
            expect(failed).toEqual([]);
        } finally {
            errors.mockRestore();
            restore();
        }
    }, 1_800_000);

    test("with every group folded no press's jobs are read — as the window is panned under them, nor as a page opens so — and an Expand all draws what is held and reads what is not (#1795)", async () => {
        const restore = emulateWindowScroll();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            let from = h.requests().length;
            const first = await h.mount(byHall, { storageKey: "plan-folded" });
            const { container } = first;
            await waitFor(() => expect(container.querySelectorAll("[data-plan-row] [data-mark]").length).toBeGreaterThan(0), { timeout: 600_000 });
            await scrollStopped();
            await settle();
            // What a view opening on the first hall's presses asks of the jobs' index: every level of each.
            const opened = searchesOf(from);
            expect(opened).toBeGreaterThan(0);
            const drawn = marksOf(container);
            let filed = 0;
            const fold = (of: HTMLElement) => slot(of, "toolbar")!.querySelector<HTMLElement>("[data-plan-fold-all]")!;
            /** Every hall's own row drawn, folded, and no press's: the view shows no row a job lands on. */
            const folded = async (of: HTMLElement) => {
                await waitFor(() => expect(of.querySelectorAll("[data-plan-group]").length).toBe(HALLS), { timeout: 600_000 });
                await scrollStopped();
                await settle();
                expect(mounted(of)).toEqual([]);
                expect(fold(of).getAttribute("aria-label")).toBe("Expand all");
            };
            /** The window moved a day at a time, a week in all: past the week tiles the jobs read so far lie in. */
            const pan = async (of: HTMLElement, key: "[" | "]") => {
                for (let step = 0; step < 7; step++) {
                    await act(async () => { fireEvent.keyDown(of.querySelector("[data-plan-body]")!, { key }); });
                    await settle();
                }
            };

            // What the reader makes of the jobs it holds, beside what it asks e3: each time it makes a kind's rows from
            // other tiles than the last it files their jobs by their keys (east-workspace#1776). A view of no row is
            // handed nothing made again: the read that stood, or none — never the kind's rows made over no press.
            setScheduleCellsFiledProbe(() => { filed += 1; });

            // A page at rest: folding every group asks for no job and makes no kind's rows again, and unfolding them
            // draws the jobs it held, asking for none.
            from = h.requests().length;
            fireEvent.click(fold(container));
            await folded(container);
            expect(findsOf(SERIES, from)).toEqual([]);
            expect(filed).toBe(0);
            fireEvent.click(fold(container));
            await waitFor(() => expect(marksOf(container)).toEqual(drawn), { timeout: 600_000 });
            await scrollStopped();
            await settle();
            expect(findsOf(SERIES, from)).toEqual([]);
            expect(findsOf(SUMMARY, from)).toEqual([]);
            expect(filed).toBe(0);

            // Folded, the window panned a week on: the jobs of the weeks it comes to are nobody's to see, and none is asked
            // for — nor is any kind's rows made over the weeks it leaves.
            fireEvent.click(fold(container));
            await folded(container);
            from = h.requests().length;
            await pan(container, "]");
            await scrollStopped();
            await settle();
            expect(findsOf(SERIES, from)).toEqual([]);
            expect(findsOf(SUMMARY, from)).toEqual([]);
            expect(filed).toBe(0);

            // Unfolded there: the jobs of the presses in view are drawn, and the index is asked for the weeks not held alone —
            // fewer searches than the view's opening, which asked every level of each press.
            from = h.requests().length;
            fireEvent.click(fold(container));
            await waitFor(() => expect(container.querySelectorAll("[data-plan-row] [data-mark]").length).toBeGreaterThan(0), { timeout: 600_000 });
            await scrollStopped();
            await settle();
            expect(searchesOf(from)).toBeGreaterThan(0);
            expect(searchesOf(from)).toBeLessThan(opened);
            expect(findsOf(SUMMARY, from)).toEqual([]);

            // The page opened as it was left — every group folded, its window on weeks no press's jobs have been read for,
            // which no read before this one answers: its halls are read, and no press's jobs — nor as its window is panned
            // on under them.
            fireEvent.click(fold(container));
            await folded(container);
            await pan(container, "]");
            await scrollStopped();
            await settle();
            first.unmount();
            from = h.requests().length;
            filed = 0;
            const again = await h.mount(byHall, { storageKey: "plan-folded" });
            await folded(again.container);
            expect(hallPages(from).length).toBeGreaterThan(0);
            expect(findsOf(SERIES, from)).toEqual([]);
            await pan(again.container, "]");
            await scrollStopped();
            await settle();
            expect(findsOf(SERIES, from)).toEqual([]);
            expect(findsOf(SUMMARY, from)).toEqual([]);
            // No kind's rows made of a page that has shown no press yet.
            expect(filed).toBe(0);

            // Unfolded, the presses it shows are drawn, and their jobs asked for then — and made into the kind's rows.
            fireEvent.click(fold(again.container));
            await waitFor(() => expect(searchesOf(from)).toBeGreaterThan(0), { timeout: 600_000 });
            await settle();
            expect(mounted(again.container).length).toBeGreaterThan(0);
            expect(findsOf(SUMMARY, from)).toEqual([]);
            expect(filed).toBeGreaterThan(0);
            again.unmount();

            // Nothing failed to read on the way.
            const failed = errors.mock.calls.map((call) => call.map(String).join(" ")).filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
            expect(failed).toEqual([]);
        } finally {
            setScheduleCellsFiledProbe(undefined);
            errors.mockRestore();
            restore();
        }
    }, 1_800_000);

    test("a read of the jobs on its way is never given up while the next is counted, nor its entries asked again: a change of period, and the view moving on a block (#1797)", async () => {
        const restore = emulateWindowScroll();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            /** A read of the jobs' entries, or a count of their searches, through the series index. */
            const entriesOf = (request: E3Request) => request.kind === "runs" && request.dataset === JOBS_AT && request.query.get("index") === SERIES;
            const countOf = (request: E3Request) => request.kind === "find" && request.dataset === JOBS_AT && request.query.get("index") === SERIES;
            /** The reads of the jobs' entries since `from` given up on their way: each one's signal aborted. */
            const givenUp = (from: number) => h.requests().slice(from).filter((request) => entriesOf(request) && request.signal.aborted);
            /** What each read of the jobs' entries since `from` asked: the runs it read, as its body names them. */
            const runsAsked = (from: number) => h.requests().slice(from).filter(entriesOf).map((request) => new TextDecoder().decode(request.body));

            // The page opening, the entries of the first block's jobs held on their way.
            let from = h.requests().length;
            let entries = h.e3.hold(entriesOf);
            const { container } = await h.mount(page, { storageKey: "plan-on-its-way" });
            await waitFor(() => expect(container.querySelectorAll("[data-plan-row]").length).toBeGreaterThan(0), { timeout: 600_000 });
            await entries.holding;
            await settle();

            // Weeks pressed while they are on their way, the next read's searches held as they are counted: the read on its
            // way is still wanted, and asked again as it was — never given up.
            let counts = h.e3.hold(countOf);
            await zoomTo(container, "week");
            await counts.holding;
            await settle();
            expect(givenUp(from)).toEqual([]);
            expect(entries.held).toBe(1);
            // Counted, and landed: the read on its way lands once — the jobs lie inside the window, so the weeks either
            // side hold none, and it holds every entry the weeks want — and no read of the jobs' entries is asked twice.
            await act(async () => { counts.release(); });
            await settle();
            await act(async () => { entries.release(); });
            await settle();
            await waitFor(() => expect(container.querySelectorAll("[data-plan-row] [data-mark]").length).toBeGreaterThan(0), { timeout: 600_000 });
            expect(givenUp(from)).toEqual([]);
            const atWeeks = runsAsked(from);
            expect(atWeeks.length).toBeGreaterThan(0);
            expect(new Set(atWeeks).size).toBe(atWeeks.length);

            // Inside a hall far down, as the first test of this file rests there: the two blocks of presses the view meets
            // and the next, their jobs' entries held on their way.
            const hallPx = PLAN_GEOMETRY.default.group;
            const pressPx = (1 + TASKS) * PLAN_GEOMETRY.default.row;
            const hallTop = (at: number) => DRAWN.slice(0, DRAWN.indexOf(at)).reduce((sum, hall) => sum + hallPx + SIZES[hall]! * pressPx, 0);
            const deep = 2;
            const before = DRAWN.slice(0, DRAWN.indexOf(deep)).reduce((sum, hall) => sum + SIZES[hall]!, 0);
            const into = (SCHEDULE_CELL_BLOCK + 5 - (before % SCHEDULE_CELL_BLOCK)) % SCHEDULE_CELL_BLOCK;
            from = h.requests().length;
            entries = h.e3.hold(entriesOf);
            act(() => { window.scrollTo({ top: hallTop(deep) + hallPx + into * pressPx }); });
            await scrollStopped();
            await entries.holding;
            await settle();

            // On a block while they are on their way, the next block's searches held as they are counted: the read on its
            // way still holds the block the view meets now, and is asked again as it was — never given up.
            counts = h.e3.hold(countOf);
            act(() => { window.scrollTo({ top: hallTop(deep) + hallPx + (into + SCHEDULE_CELL_BLOCK) * pressPx }); });
            await scrollStopped();
            await counts.holding;
            await settle();
            expect(givenUp(from)).toEqual([]);
            expect(entries.held).toBe(1);
            await act(async () => { counts.release(); });
            await settle();
            await act(async () => { entries.release(); });
            await settle();
            expect(givenUp(from)).toEqual([]);
            const onABlock = runsAsked(from);
            expect(onABlock.length).toBeGreaterThan(1);
            expect(new Set(onABlock).size).toBe(onABlock.length);
            expect(container.querySelectorAll("[data-plan-row] [data-mark]").length).toBeGreaterThan(0);

            // Nothing failed to read on the way.
            const failed = errors.mock.calls.map((call) => call.map(String).join(" ")).filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
            expect(failed).toEqual([]);
        } finally {
            errors.mockRestore();
            restore();
        }
    }, 1_800_000);

    test("through a series index in time order, weeks pressed across a year's end name every cell anew over the runs of the days' read on its way: it is never given up while the weeks are counted, and they read its runs through it, as it was, asking none again (#1797)", async () => {
        const restore = emulateWindowScroll();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            /** The reads of the jobs' entries since `from` given up on their way: each one's signal aborted. */
            const givenUp = (from: number) => h.requests().slice(from).filter((request) => inTimeRuns(request) && request.signal.aborted);
            await h.patch(scaleJobs, yearEndJobs());
            // The page opening on the days before the year ends, the entries of its first block's jobs held on their way.
            const from = h.requests().length;
            const entries = h.e3.hold(inTimeRuns);
            const { container } = await h.mount(yearEnd, { storageKey: "plan-year-end" });
            await waitFor(() => expect(container.querySelectorAll("[data-plan-row]").length).toBeGreaterThan(0), { timeout: 600_000 });
            await entries.holding;
            await settle();

            // Weeks pressed while they are on their way, the weeks' searches held as they are counted: what the weeks want
            // is not known until they are, so the read on its way is asked again as it was — never given up.
            const counts = h.e3.hold(inTimeFinds);
            await zoomTo(container, "week");
            await counts.holding;
            await settle();
            expect(givenUp(from)).toEqual([]);
            expect(entries.held).toBe(1);
            // Counted, the weeks want the runs the read on its way asks, every cell of theirs another's, and the January's
            // beside them: they read the days' through it, as it was, and ask the January's alone.
            await act(async () => { counts.release(); });
            await settle();
            expect(givenUp(from)).toEqual([]);
            await act(async () => { entries.release(); });
            await settle();
            await waitFor(() => expect(container.querySelectorAll("[data-plan-row] [data-mark]").length).toBeGreaterThan(0), { timeout: 600_000 });
            expect(givenUp(from)).toEqual([]);
            expect(runsAskedAgain(from)).toEqual([]);
            expect(h.requests().slice(from).filter(inTimeRuns).length).toBe(2);

            // Nothing failed to read on the way.
            const failed = errors.mock.calls.map((call) => call.map(String).join(" ")).filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
            expect(failed).toEqual([]);
        } finally {
            errors.mockRestore();
            restore();
        }
    }, 1_800_000);

    test("through a series index in time order, the days' read landing while the weeks across a year's end are counted is taken in, and the weeks take its runs from it, asking none of them of e3 again (#1797)", async () => {
        const restore = emulateWindowScroll();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            /** The reads of the jobs' entries since `from` given up on their way: each one's signal aborted. */
            const givenUp = (from: number) => h.requests().slice(from).filter((request) => inTimeRuns(request) && request.signal.aborted);
            await h.patch(scaleJobs, yearEndJobs());
            const from = h.requests().length;
            const entries = h.e3.hold(inTimeRuns);
            const { container } = await h.mount(yearEnd, { storageKey: "plan-year-end-landed" });
            await waitFor(() => expect(container.querySelectorAll("[data-plan-row]").length).toBeGreaterThan(0), { timeout: 600_000 });
            await entries.holding;
            await settle();

            // Weeks pressed while the days' read is on its way; it lands while the weeks' searches are still counted, and
            // is read again as it was, so taken in.
            const counts = h.e3.hold(inTimeFinds);
            await zoomTo(container, "week");
            await counts.holding;
            await settle();
            await act(async () => { entries.release(); });
            await settle();
            expect(givenUp(from)).toEqual([]);
            // Counted, the weeks want its runs under cells of their own, and the January's beside them: each of its runs is
            // taken from the read that brought it, so e3 is asked for the January's alone.
            await act(async () => { counts.release(); });
            await settle();
            await waitFor(() => expect(container.querySelectorAll("[data-plan-row] [data-mark]").length).toBeGreaterThan(0), { timeout: 600_000 });
            expect(givenUp(from)).toEqual([]);
            expect(runsAskedAgain(from)).toEqual([]);
            expect(h.requests().slice(from).filter(inTimeRuns).length).toBe(2);

            // Nothing failed to read on the way.
            const failed = errors.mock.calls.map((call) => call.map(String).join(" ")).filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
            expect(failed).toEqual([]);
        } finally {
            errors.mockRestore();
            restore();
        }
    }, 1_800_000);

    test("zoomed out past the jobs' series tile, each task beneath a press counts its own jobs from the summary led by the task; with none, it draws its own jobs, and past the cap is hatched, one plain line saying there are too many to show — never its press's count (#1541, U1, #1799)", async () => {
        const restore = emulateWindowScroll();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            // A press's j-th job is on its task j % TASKS: how many of its jobs each task holds — its press holds JOBS.
            const own = (task: string) => Array.from({ length: JOBS }, (_x, j) => taskKey(j % TASKS)).filter((one) => textEqual(one, task)).length;
            /** A page mounted, its tasks' rows drawn, then zoomed to a month as a planner zooms. */
            const atMonth = async (example: typeof byTask, storageKey: string) => {
                const mounted = await h.mount(example, { storageKey });
                await waitFor(() => expect(taskRows(mounted.container).length).toBeGreaterThan(0), { timeout: 600_000 });
                await zoomTo(mounted.container, "month");
                return mounted;
            };

            // Its source listing a summary led by the task beside the presses': each task row counts its own jobs.
            let from = h.requests().length;
            const counted = await atMonth(byTask, "plan-by-task");
            await waitFor(() => expect(taskRows(counted.container).some((row) => row.cells > 0)).toBe(true), { timeout: 600_000 });
            await settle();
            report("a month, counted by task", from, cpu(), counted.container);
            const rows = taskRows(counted.container);
            expect(rows.length).toBeGreaterThan(0);
            for (const row of rows) expect([row.task, row.counted, row.hatched, row.marks]).toEqual([row.task, own(row.task), false, 0]);
            expect(rows.some((row) => row.counted === 0)).toBe(true);
            // Read through the summary led by the task, a search a task; the presses' summary counts no task's jobs.
            expect(findsOf(TASK_SUMMARY, from).length).toBeGreaterThan(0);
            expect(findsOf(SUMMARY, from)).toEqual([]);
            counted.unmount();

            // Its source listing the presses' summary alone, the range holding few jobs: each task row draws its own.
            from = h.requests().length;
            const drawn = await atMonth(byPress, "plan-by-press");
            await waitFor(() => expect(taskRows(drawn.container).some((row) => row.marks > 0)).toBe(true), { timeout: 600_000 });
            await settle();
            for (const row of taskRows(drawn.container)) expect([row.task, row.cells, row.marks, row.foreign]).toEqual([row.task, 0, own(row.task), 0]);
            expect(findsOf(SUMMARY, from)).toEqual([]);
            drawn.unmount();

            // Past the cap: every task row hatched, none given its press's count — no period shows a task's own, so the
            // columns stay at the month — and one plain line says so, in a planner's words.
            await h.patch(scaleJobs, busyJobs());
            from = h.requests().length;
            const hatched = await atMonth(byPress, "plan-by-press-past-the-cap");
            await waitFor(() => expect(taskRows(hatched.container).some((row) => row.hatched)).toBe(true), { timeout: 600_000 });
            await settle();
            const bare = taskRows(hatched.container);
            for (const row of bare) expect([row.task, row.hatched, row.counted, row.marks]).toEqual([row.task, true, 0, 0]);
            /** The banners drawn, each by its kind and its words: the one line, where no period shows what is in view. */
            const lines = () => [...slot(hatched.container, "banners")?.querySelectorAll<HTMLElement>("[data-plan-banner]") ?? []]
                .map((banner) => [banner.getAttribute("data-plan-banner"), banner.textContent]);
            /** The period the columns take, as the toolbar's segment shows it pressed. */
            const periodShown = () => slot(hatched.container, "toolbar")!.querySelector('[data-toolbar-item="resolution"] [aria-checked="true"]')?.textContent;
            const tooMany = [["over", "Too many jobs to show at once: pick a shorter range or narrow the filters."]];
            expect(lines()).toEqual(tooMany);
            expect(periodShown()).toBe("MONTH");
            expect(findsOf(SUMMARY, from)).toEqual([]);
            // Weeks pressed: no period shows a task's own there either, so none is taken for nothing — the columns are weeks,
            // and the same line says so once the jobs are read at them.
            await zoomTo(hatched.container, "week");
            await waitFor(() => expect(lines()).toEqual(tooMany), { timeout: 600_000 });
            await settle();
            expect(periodShown()).toBe("WEEK");
            for (const row of taskRows(hatched.container)) expect([row.task, row.hatched]).toEqual([row.task, true]);

            // Nothing failed to read on the way.
            const failed = errors.mock.calls.map((call) => call.map(String).join(" ")).filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
            expect(failed).toEqual([]);
        } finally {
            errors.mockRestore();
            restore();
        }
    }, 1_800_000);
});
