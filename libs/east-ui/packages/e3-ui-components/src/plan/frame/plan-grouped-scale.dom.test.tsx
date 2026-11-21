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
 * at its top.
 *
 * - At each rest the jobs read are those of the blocks of presses meeting the
 *   view and its margin, never every block from the page's first row: a hall's
 *   own row stands for no press (#1711).
 *
 * The sizes here run in the suite. A page's size is run by hand, its sizes from
 * the environment: `SCALE_HALLS=40 SCALE_PRESSES=3000 SCALE_TASKS=12`, with
 * `SCALE_NESTED=0` to bind the halls without their nested series index, and
 * `SCALE_LOG=1` to print what each step asked and the processor time it took.
 */

import { describe, test, expect, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { DateTimeType, DictType, East, OptionType, StringType, StructType, VariantType, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import type { TreePath } from "@elaraai/e3-types";
import type { E3Request } from "../../e3-web.test-utils.js";
import { SCHEDULE_CELL_BLOCK } from "../../shared/schedule/cells.js";
import { PLAN_GEOMETRY } from "../geometry.js";
import { emulateWindowScroll } from "../window-scroll.test-utils.js";
import { act, planHarness, settle } from "./harness.test-utils.js";

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

// ── The records ──────────────────────────────────────────────────────────────

const Task = StructType({});
const PressKind = VariantType({ press: StructType({}) });
const Press = StructType({ what: PressKind, tasks: DictType(StringType, Task) });
const Hall = StructType({ name: OptionType(StringType), presses: DictType(StringType, Press) });
const Halls = DictType(StringType, Hall);

const Job = StructType({ press: StringType, start: DateTimeType, end: DateTimeType, task: StringType, title: StringType });
const Jobs = DictType(StringType, Job);

const FIRST = new Date("2026-07-15T00:00:00Z");
const LAST = new Date("2026-07-29T00:00:00Z");
const DAY = 86_400_000;

function halls(): ValueTypeOf<typeof Halls> {
    const tasks = new Map(Array.from({ length: TASKS }, (_x, t) => [taskKey(t), {}] as const));
    return new Map(SIZES.map((_size, h) => [hallKey(h), {
        // The first hall states no name: its row is labelled by its key.
        name: h === 0 ? none : some(`Hall ${pad(h, 2)}`),
        presses: new Map(pressCodes[h]!.map((code) => [code, { what: variant("press", {}), tasks: new Map(tasks) }] as const)),
    }] as const)) as ValueTypeOf<typeof Halls>;
}

function jobs(): ValueTypeOf<typeof Jobs> {
    const out = new Map<string, ValueTypeOf<typeof Job>>();
    let n = 0;
    for (const codes of pressCodes) {
        for (const code of codes) {
            for (let j = 0; j < JOBS; j++) {
                const at = new Date(FIRST.getTime() + ((n + j * 5) % 14) * DAY + 9 * 3_600_000);
                out.set(`J${pad(n++, 7)}`, { press: code, start: at, end: at, task: taskKey(j % TASKS), title: `Job ${n}` });
            }
        }
    }
    return out as ValueTypeOf<typeof Jobs>;
}

export const scaleHalls = e3.record("scale_halls", Halls, {
    initial: halls(),
    indexes: (index) => ({
        scale_halls_by_name: index.on(["name"]),
        // Declared only when asked: a record that declares one lists it beside every other index it pages by.
        ...(NESTED ? {
            scale_halls_in_time: index.nested({
                collections: { presses: index.nested.rows({ tasks: index.nested.rows({}) }) },
                tile: "day",
                summary: "month",
            }),
        } : {}),
    }),
});

export const scaleJobs = e3.record("scale_jobs", Jobs, {
    initial: jobs(),
    indexes: (index) => ({
        scale_jobs_by_time: index.interval({ from: "start", to: "end" }),
        scale_jobs_by_press_week: index.series({ key: "press", from: "start", to: "end", tile: "week" }),
        scale_jobs_by_press_day: index.summary({ key: "press", from: "start", to: "end", tile: "day" }),
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

// ── What the Plan asked ──────────────────────────────────────────────────────

const pathText = (path: TreePath) => path.map((step) => step.value).join(".");
const HALLS_AT = pathText(scaleHalls.path as TreePath);
const JOBS_AT = pathText(scaleJobs.path as TreePath);
const SERIES = "scale_jobs_by_press_week";
const SUMMARY = "scale_jobs_by_press_day";
/** The levels the series index files a job at, from its week tile: week, month, quarter and year. */
const LEVELS = 4;

/** The finds of one of the jobs' indexes since `from`. */
const findsOf = (index: string, from: number): E3Request[] => h.requests().slice(from)
    .filter((request) => request.kind === "find" && request.dataset === JOBS_AT && request.query.get("index") === index);

/** The searches the series index was asked since `from`: each a press's jobs at a level. */
const searchesOf = (from: number): number => findsOf(SERIES, from).reduce((n, request) => n + request.searches.length, 0);

/** The rows mounted now, in document order: those in view and the overscan beside them. */
const mounted = (container: HTMLElement): string[] =>
    [...container.querySelectorAll<HTMLElement>("[data-plan-row]")].map((row) => row.getAttribute("data-plan-row") ?? "");

/** Processor seconds this process has used: what a step costs, whatever else the machine is doing. */
const cpu = () => { const used = process.cpuUsage(); return (used.user + used.system) / 1e6; };

/** What a step asked, by what it read, and what it cost: printed for a run by hand. */
function report(step: string, from: number, cpu0: number): void {
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
    process.stdout.write(`\n### ${step}: ${(cpu() - cpu0).toFixed(1)} processor seconds\n${JSON.stringify(asked, null, 2)}\n`);
}

describe("a Plan over grouped rows at a page's size (#1710)", () => {
    test("each rest reads the jobs of the presses meeting the view and its margin, a hall's own row at the top of the view among them (#1711)", async () => {
        const restore = emulateWindowScroll();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            if (LOG) process.stdout.write(`\n### sizes: ${JSON.stringify({ nested: NESTED, halls: HALLS, presses: PRESSES, tasks: TASKS, jobs: PRESSES * JOBS, sizes: SIZES })}\n`);
            // At most three blocks of presses meet a view and its margin either side, each press its jobs at every level.
            const atMost = 3 * SCHEDULE_CELL_BLOCK * LEVELS;

            // Opening: the first block, where a view opens.
            let from = h.requests().length;
            let cpu0 = cpu();
            const { container } = await h.mount(page);
            await waitFor(() => expect(container.querySelectorAll("[data-plan-row]").length).toBeGreaterThan(0), { timeout: 600_000 });
            await settle();
            report("open", from, cpu0);
            expect(searchesOf(from)).toBeLessThanOrEqual(SCHEDULE_CELL_BLOCK * LEVELS);
            expect(findsOf(SUMMARY, from)).toEqual([]);

            // Row heights: the Plan's own geometry, which its virtualizer sizes its rows by.
            const hallPx = PLAN_GEOMETRY.default.group;
            const pressPx = (1 + TASKS) * PLAN_GEOMETRY.default.row;
            /** Where hall `h`'s own row sits. */
            const hallTop = (at: number) => SIZES.slice(0, at).reduce((sum, size) => sum + hallPx + size * pressPx, 0);
            const deep = HALLS - 2;

            // Inside a hall far down: a press's row at the top of the view.
            from = h.requests().length;
            cpu0 = cpu();
            act(() => { window.scrollTo({ top: hallTop(deep) + hallPx + 5 * pressPx }); });
            await waitFor(() => expect(mounted(container).some((key) => key.includes(`P${pad(deep, 2)}`))).toBe(true), { timeout: 600_000 });
            await settle();
            report(`inside hall ${deep}`, from, cpu0);
            expect(searchesOf(from)).toBeGreaterThan(0);
            expect(searchesOf(from)).toBeLessThanOrEqual(atMost);
            expect(findsOf(SUMMARY, from)).toEqual([]);

            // The same hall's own row at the top of the view: no press of its own, so the presses beneath it are the ends.
            from = h.requests().length;
            cpu0 = cpu();
            act(() => { window.scrollTo({ top: hallTop(deep) }); });
            await waitFor(() => expect(mounted(container).some((key) => key.includes(`P${pad(deep, 2)}0000`))).toBe(true), { timeout: 600_000 });
            await settle();
            report(`hall ${deep}'s own row at the top`, from, cpu0);
            expect(searchesOf(from)).toBeLessThanOrEqual(atMost);
            // Its jobs drawn, never its presses' shading from the summary.
            expect(findsOf(SUMMARY, from)).toEqual([]);
            expect(container.querySelectorAll("[data-plan-row] [data-mark]").length).toBeGreaterThan(0);

            // Nothing failed to read on the way.
            const failed = errors.mock.calls.map((call) => call.map(String).join(" ")).filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
            expect(failed).toEqual([]);
        } finally {
            errors.mockRestore();
            restore();
        }
    }, 1_800_000);
});
