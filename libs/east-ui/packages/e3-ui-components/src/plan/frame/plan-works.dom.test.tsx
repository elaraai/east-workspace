/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The works on a Plan (`planNestedAll`, #1438), on e3 itself: every series
 * kind over every collection a works holds — jobs, alarms, load, its crews'
 * hours and a tree of parts, sparse and spread evenly over ten years — read a
 * cell at a time through its nested series index, paged by rows and by time.
 *
 * - Opening the two hundred works the record holds reads them lean a page at
 *   a time by name, then the cells around the rows in view in one batch of
 *   searches and one read of entries, never a works whole: each works' jobs
 *   draw. A quarter on, every works in view draws jobs there too.
 * - The stress run (`E3_UI_PERF=1`, never in CI; `E3_WORKS_ROWS`, two thousand
 *   unless given) commits the works over ten years through the patch door,
 *   then times opening, a scroll, a job dragged and saved, a quarter's pan, a
 *   zoom to the year and a pan three years back, each with its requests, and
 *   prints them — and writes them, as a Markdown table, to `E3_UI_PERF_OUT`
 *   where it is given.
 */

import { appendFileSync } from "node:fs";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, type ValueTypeOf } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { layOut } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-nested";
import type { TreePath } from "@elaraai/e3-types";
import type { E3Request } from "../../e3-web.test-utils.js";
import { boundFrame, frameScrolls } from "../../sheet/frame.test-utils.js";
import { PLAN_GEOMETRY } from "../geometry.js";
import { rowKeyOf } from "../model.js";
import { carry } from "../plan-move.test-utils.js";
import { act, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness({ "plan/plan-nested": ex });

/** A dataset's path as e3's requests name it: its fields, joined by dots. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");
/** The works' record, as e3's requests name it. */
const WORKS = pathText(ex.planWorks.path as TreePath);
/** The works' index by name, which pages them lean, and their nested series index. */
const BY_NAME = ex.planWorks.indexes.plan_works_by_name;
const IN_TIME = ex.planWorks.indexes.plan_works_in_time;

/** Whether a request reads the works through one of their indexes. */
const through = (index: { readonly name: string }) => (request: E3Request) =>
    request.dataset === WORKS && (request.query.get("index") ?? undefined) === index.name;
/** What one of the works' indexes was asked: each request's kind — a batch of searches as `find`, its size after it. */
const askedOf = (index: { readonly name: string }) => h.requests().filter(through(index))
    .map((request) => (request.kind === "find" ? `find ${request.searches.length}` : request.kind));

/** A works' row of jobs. */
const worksRow = (c: HTMLElement, key: string) => slot(c, "main")!.querySelector<HTMLElement>(rowAt(entry("works", key)));
/** The works' keys by their rows' ids, as `data-plan-row` holds them: `W-` and each one's number plus 10,001. */
const worksKeys = (rows: bigint) => new Map(Array.from({ length: Number(rows) }, (_, n) => `W-${n + 10_001}`)
    .map((key) => [rowKeyOf(entry("works", key)), key] as const));
/** The works whose rows of jobs are mounted, and have drawn their runs. */
const drawnWorks = (c: HTMLElement, keys: ReadonlyMap<string, string>) => [...slot(c, "main")!.querySelectorAll<HTMLElement>("[data-plan-row]")]
    .filter((row) => row.querySelector("[data-run]") !== null)
    .flatMap((row) => { const key = keys.get(row.getAttribute("data-plan-row")!); return key === undefined ? [] : [key]; });

// The canvas's frame as a browser lays it: 400px tall over its rows' extent, each mounted row as tall as it draws, and
// scrolled when asked — jsdom lays nothing out, and a bounded frame of no height mounts no row.
const VIEWPORT = 400;
let restore: (() => void)[] = [];
beforeEach(() => { restore = [boundFrame(VIEWPORT), frameScrolls()]; });
afterEach(() => { for (const undo of restore.reverse()) undo(); });

/** The canvas's bounded frame. */
const frameOf = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-virtual-rows="bounded"]')!;
/** Scrolls the frame, as a wheel does: the canvas reads on intent once the view comes to rest. */
async function scrollRows(c: HTMLElement, top: number) {
    await act(async () => { frameOf(c).scrollTo({ top }); });
}

/** Pans the canvas a bucket at a time — `]` on, `[` back — as a planner's keys do, from the first works' row. */
async function pan(c: HTMLElement, key: "[" | "]", times: number) {
    for (let i = 0; i < times; i++) {
        await act(async () => { fireEvent.keyDown(worksRow(c, "W-10001")!, { key }); });
        await settle();
    }
}

/** Zooms the canvas to a resolution through the toolbar's segment: the works' Plan lists week, month, quarter and year. */
async function zoomTo(c: HTMLElement, resolution: "week" | "month" | "quarter" | "year") {
    const seg = slot(c, "toolbar")!.querySelector<HTMLElement>("[data-plan-seg='resolution']")!;
    const radio = [...seg.querySelectorAll<HTMLElement>("[role='radio']")][["week", "month", "quarter", "year"].indexOf(resolution)]!;
    await act(async () => {
        fireEvent.mouseDown(radio, { button: 0 });
        fireEvent.click(radio);
    });
    await settle();
}

/** The works rows mounted, and whether each draws a job. */
const mountedWorks = (c: HTMLElement, keys: ReadonlyMap<string, string>) => [...slot(c, "main")!.querySelectorAll<HTMLElement>("[data-plan-row]")]
    .flatMap((row) => { const key = keys.get(row.getAttribute("data-plan-row")!); return key === undefined ? [] : [[key, row.querySelector("[data-run]") !== null] as const]; });

describe("the works on a Plan (#1438)", () => {
    test("opens on the works lean by name, then one batch of the cells' searches and one read of their entries: each works' jobs draw, and no works is read whole", async () => {
        const { container } = await h.mount(ex.planNestedAll);
        await settle();
        expect(h.requests("page", WORKS).every((request) => through(BY_NAME)(request) && request.query.get("join") !== "true")).toBe(true);
        const asked = askedOf(IN_TIME);
        expect(asked).toHaveLength(2);
        expect(asked[0]).toMatch(/^find \d+$/);
        expect(asked[1]).toBe("runs");
        expect(h.requests("rows", WORKS)).toEqual([]);
        expect(h.requests("read", WORKS)).toEqual([]);
        expect(worksRow(container, "W-10001")!.querySelectorAll("[data-run]").length).toBeGreaterThan(0);
    });

    test("a quarter on, every works in view draws jobs there: the works are sparse, and spread evenly over their years", async () => {
        const { container } = await h.mount(ex.planNestedAll);
        await settle();
        const keys = worksKeys(200n);
        await pan(container, "]", 13);
        const mounted = mountedWorks(container, keys);
        expect(mounted.length).toBeGreaterThan(0);
        expect(mounted.filter(([, drawn]) => !drawn)).toEqual([]);
    });
});

/** A phase of the stress run: its time, and the requests it made of the works. */
interface Phase {
    readonly phase: string;
    readonly ms: number;
    readonly requests: string;
}

describe.skipIf(process.env["E3_UI_PERF"] !== "1")("the works at scale (#1438; E3_UI_PERF=1, never in CI)", () => {
    test("the works over ten years: opening, a scroll, a job dragged and saved, a quarter's pan, a zoom to the year and a pan three years back", { timeout: 3_600_000 }, async () => {
        const rows = BigInt(process.env["E3_WORKS_ROWS"] ?? "2000");
        const phases: Phase[] = [];
        let mark = h.requests().length;
        const timed = async (phase: string, run: () => Promise<void>) => {
            const t0 = performance.now();
            await run();
            const asked = h.requests().slice(mark).filter((request) => request.dataset === WORKS)
                .map((request) => (request.kind === "find" ? `find ${request.searches.length}` : request.kind));
            mark = h.requests().length;
            phases.push({ phase, ms: Math.round(performance.now() - t0), requests: asked.join(", ") });
            console.log(`${phase}: ${phases.at(-1)!.ms} ms; ${phases.at(-1)!.requests}`);
        };
        const keys = worksKeys(rows);
        await timed(`commit ${rows} works over ten years`, async () => {
            await h.patch(ex.planWorks, East.compile(ex.generateWorksAll, [])(rows, 522n));
        });
        let c!: HTMLElement;
        await timed("open", async () => {
            c = (await h.mount(ex.planNestedAll, { drag: true })).container;
            await waitFor(() => expect(worksRow(c, "W-10001")?.querySelectorAll("[data-run]").length ?? 0).toBeGreaterThan(0), { timeout: 600_000 });
            await settle();
        });
        // Three hundred works down — half way down a smaller run's works, which come first.
        const down = Math.min(300, Number(rows) / 2);
        await timed(`scroll ${down} works down`, async () => {
            const before = new Set(drawnWorks(c, keys));
            await scrollRows(c, down * PLAN_GEOMETRY.default.rowStacked);
            await waitFor(() => expect(drawnWorks(c, keys).filter((key) => !before.has(key))).not.toEqual([]), { timeout: 600_000 });
            await settle();
        });
        await timed("back to the top", async () => {
            await scrollRows(c, 0);
            await waitFor(() => expect(drawnWorks(c, keys)).toContain("W-10001"), { timeout: 600_000 });
            await settle();
        });
        // The first works' first job in view, dragged a week on: its works read whole once, then saved by key.
        const job = worksRow(c, "W-10001")!.querySelector<HTMLElement>("[data-run]")!;
        const moved = job.getAttribute("data-run")!;
        const before = ((await h.read(ex.planWorks)) as ReadonlyMap<string, ValueTypeOf<typeof ex.Works>>).get("W-10001")!;
        const rowsRead = h.requests("rows", WORKS).length;
        await timed("drag a job a week on", async () => {
            const plot = worksRow(c, "W-10001")!.querySelector("[data-plan-plot]")!;
            // The thirteen weeks in view across 800px.
            layOut(new Map([[plot, { left: 200, top: 0, width: 800, height: 32 }]]));
            const x = 200 + Number(job.getAttribute("data-plan-frac")) * 800 + 5;
            const letGo = await carry(job, { x, y: 16 }, { x: x + 800 / 13, y: 16 });
            await letGo();
            await settle();
        });
        expect(h.requests("rows", WORKS).length - rowsRead).toBe(1);
        await timed("save", async () => {
            await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() })); });
            await settle();
        });
        // e3 holds the job a week on, and every other job of the works as it was.
        const after = ((await h.read(ex.planWorks)) as ReadonlyMap<string, ValueTypeOf<typeof ex.Works>>).get("W-10001")!;
        expect(after.jobs.get(moved)!.start.getTime() - before.jobs.get(moved)!.start.getTime()).toBe(7 * 86_400_000);
        for (const [id, held] of before.jobs) if (id !== moved) expect(after.jobs.get(id)).toEqual(held);
        // Across time: a quarter on, a week at a time; the ten years at the year, and three of them back; the week again.
        await timed("pan a quarter on, a week at a time", async () => {
            await pan(c, "]", 13);
            await waitFor(() => expect(mountedWorks(c, keys).filter(([, drawn]) => !drawn)).toEqual([]), { timeout: 600_000 });
        });
        await timed("zoom to the year", async () => { await zoomTo(c, "year"); });
        await timed("pan three years back", async () => { await pan(c, "[", 3); });
        await timed("back to the week", async () => {
            await zoomTo(c, "week");
            await waitFor(() => expect(mountedWorks(c, keys).filter(([, drawn]) => !drawn)).toEqual([]), { timeout: 600_000 });
        });
        console.table(phases);
        const out = process.env["E3_UI_PERF_OUT"];
        if (out !== undefined) {
            appendFileSync(out, [`| ${rows} works: phase | ms | requests |`, "|---|---:|---|",
                ...phases.map((p) => `| ${p.phase} | ${p.ms} | ${p.requests} |`), ""].join("\n"));
        }
    });
});
