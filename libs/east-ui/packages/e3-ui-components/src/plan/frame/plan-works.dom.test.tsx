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
import { describe, test, expect, beforeEach, afterEach, onTestFinished, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, type ValueTypeOf } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { layOut } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-nested";
import { nestedSpanName, type TreePath } from "@elaraai/e3-types";
import type { E3Request } from "../../e3-web.test-utils.js";
import { boundFrame, frameScrolls } from "../../sheet/frame.test-utils.js";
import { PLAN_GEOMETRY } from "../geometry.js";
import { rowKeyOf } from "../model.js";
import { carry } from "../plan-move.test-utils.js";
import { act, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";
import { width } from "../../e3-web-mount.test-utils.js";
import { periodText } from "../../shared/time/scale.js";

const h = planHarness({ "plan/plan-nested": ex });

/** A dataset's path as e3's requests name it: its fields, joined by dots. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");
/** The works' record, as e3's requests name it. */
const WORKS = pathText(ex.planWorks.path as TreePath);
/** The works' index by name, which pages them lean, and their nested series index. */
const BY_NAME = ex.planWorks.indexes.plan_works_by_name;
const IN_TIME = ex.planWorks.indexes.plan_works_in_time;
/** The span e3 keeps beside their nested series index: each collection's months across the works. */
const SPAN = { name: nestedSpanName(IN_TIME.name) };

/** Whether a request reads the works through one of their indexes. */
const through = (index: { readonly name: string }) => (request: E3Request) =>
    request.dataset === WORKS && (request.query.get("index") ?? undefined) === index.name;
/** What one of the works' indexes was asked: each request's kind — a batch of searches as `find`, its size after it. */
const askedOf = (index: { readonly name: string }) => h.requests().filter(through(index))
    .map((request) => (request.kind === "find" ? `find ${request.searches.length}` : request.kind));

/** A works' row of jobs. */
const worksRow = (c: HTMLElement, key: string) => slot(c, "main")!.querySelector<HTMLElement>(rowAt(entry("works", key)));

/**
 * Lays the horizon's strip out over jsdom's measures (#1438), which the
 * harness leaves to the test: its width is what the returned setter last set,
 * and a resize tells the strip it moved.
 *
 * @returns Sets the strip's width, px
 */
function horizonLaidOut(): (px: number) => void {
    let laid = 0;
    const real = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        return this.hasAttribute("data-plan-horizon-track") || this.hasAttribute("data-brush-track")
            ? { x: 0, y: 0, top: 0, left: 0, right: laid, bottom: 32, width: laid, height: 32, toJSON() {} } as DOMRect
            : real.call(this);
    });
    return (px) => { laid = px; };
}
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

    test("the horizon spans the ten years the series shown read, as e3 keeps their span, and a series switched off leaves its collections out", async () => {
        const { container } = await h.mount(ex.planNestedAll);
        await settle();
        // The span's searches: one for each collection the series read, in one request, then their months.
        const spanReads = () => h.requests().filter(through(SPAN)).map((request) => (request.kind === "find" ? `find ${request.searches.length}` : request.kind));
        expect(spanReads()).toEqual(["find 5", "runs"]);
        // Ten years of weeks, from the works' first month to their last: the strip spans them, not the window's own margins.
        const caption = () => Number((container.querySelector("[data-plan-horizon-caption]")?.textContent ?? "").replace(/[^0-9]/g, ""));
        await waitFor(() => expect(caption()).toBeGreaterThanOrEqual(520));
        expect(caption()).toBeLessThan(540);
        // Jobs switched off: its jobs and alarms are read no more, and the span of the rest is — their searches held from
        // the first batch, one read of their months.
        const before = spanReads().length;
        const pane = slot(container, "start")!;
        fireEvent.click([...pane.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith("Series "))!);
        await settle();
        const panel = pane.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
        fireEvent.click([...panel.querySelectorAll<HTMLElement>("button[aria-pressed]")].find((b) => b.getAttribute("aria-label") === "Toggle Jobs")!);
        await settle();
        await waitFor(() => expect(spanReads().slice(before)).toEqual(["runs"]));
    });

    test("the horizon's bars are each month's items as e3 keeps them in the span: a month a bar toned by its count, the largest in the meta line, a bar's hover its month and count; a narrower strip counts by quarter", async () => {
        // The strip laid out 1,000px wide: ten years keep some 8px a month.
        const horizonWidth = horizonLaidOut();
        horizonWidth(1000);
        // Load alone: each works' load every four weeks, as the generator made them, counted by month.
        const months = new Map<number, number>();
        for (const works of East.compile(ex.generateWorksAll, [])(200n, 522n).values()) {
            for (const at of works.load.keys()) {
                const month = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1);
                months.set(month, (months.get(month) ?? 0) + 1);
            }
        }
        const expected = [...months].sort(([a], [b]) => a - b);
        const max = expected.reduce((m, [, n]) => Math.max(m, n), 0);
        const { container } = await h.mount(ex.planNestedAll);
        await settle();
        const pane = slot(container, "start")!;
        fireEvent.click([...pane.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith("Series "))!);
        await settle();
        for (const name of ["Jobs", "Crew hours", "Parts"]) {
            const panel = pane.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
            fireEvent.click([...panel.querySelectorAll<HTMLElement>("button[aria-pressed]")].find((b) => b.getAttribute("aria-label") === `Toggle ${name}`)!);
            await settle();
        }
        const band = () => container.querySelector<HTMLElement>("[data-slot='horizon']")!;
        const meta = () => band().querySelector("[data-plan-horizon-meta]")?.textContent;
        // Every bar on the layer under the window's, in order: a month the load is in, at its count.
        const bars = () => [...band().querySelectorAll<HTMLElement>("[data-brush-bars=''] > [data-brush-bar]")];
        await waitFor(() => expect(meta()).toBe(`max ${max} items / mo`));
        expect(bars().map((b) => Number(b.getAttribute("data-count")))).toEqual(expected.map(([, n]) => n));
        expect(bars().filter((b) => b.getAttribute("data-step") === "5").map((b) => Number(b.getAttribute("data-count")))).toContain(max);
        // A bar's hover: its month, then its count.
        const top = expected.findIndex(([, n]) => n === max);
        const track = band().querySelector<HTMLElement>("[data-brush-track]")!;
        fireEvent.pointerMove(track, { clientX: parseFloat(getComputedStyle(bars()[top]!).left) + 1, pointerType: "mouse" });
        await waitFor(() => expect(document.querySelector("[data-brush-tip]")?.textContent).toBe(`${periodText(new Date(expected[top]![0]), "month")} · ${max} items`));
        fireEvent.pointerLeave(track, { pointerType: "mouse" });
        // 300px keeps no 4px a month: a quarter a bar, each its three months' counts.
        horizonWidth(300);
        await width(900);
        await waitFor(() => expect(meta()).toMatch(/^max \d+ items \/ q$/));
        const quarters = new Map<number, number>();
        for (const [month, n] of expected) {
            const at = new Date(month);
            const quarter = Date.UTC(at.getUTCFullYear(), Math.floor(at.getUTCMonth() / 3) * 3, 1);
            quarters.set(quarter, (quarters.get(quarter) ?? 0) + n);
        }
        expect(bars().map((b) => Number(b.getAttribute("data-count")))).toEqual([...quarters].sort(([a], [b]) => a - b).map(([, n]) => n));
    });

    test("a zoom shows as many buckets as before about the same middle: the year shows the ten years, and the week again a few weeks in their middle", async () => {
        const { container } = await h.mount(ex.planNestedAll);
        await settle();
        const caption = () => Number((container.querySelector("[data-plan-horizon-caption]")?.textContent ?? "").replace(/[^0-9]/g, ""));
        await waitFor(() => expect(caption()).toBeGreaterThanOrEqual(520));
        const ruler = () => container.querySelector("[data-slot='ruler'], [data-plan-ruler]")?.textContent ?? "";
        await zoomTo(container, "year");
        await waitFor(() => expect(ruler()).toContain("2022"));
        for (const year of ["2023", "2026", "2029", "2031"]) expect(ruler()).toContain(year);
        await zoomTo(container, "week");
        await waitFor(() => expect(ruler()).toContain("2027"));
        expect(ruler()).not.toContain("2022");
    });

    test("a works' crew hours, folded, draw each week's sum of its crews' hours as e3 keeps it", async () => {
        const { container } = await h.mount(ex.planNestedAll);
        await settle();
        // Jobs and Load switched off: the works' crew hours come to the top, each works folded over its two crews.
        const pane = slot(container, "start")!;
        fireEvent.click([...pane.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith("Series "))!);
        await settle();
        for (const name of ["Jobs", "Load"]) {
            const panel = pane.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
            fireEvent.click([...panel.querySelectorAll<HTMLElement>("button[aria-pressed]")].find((b) => b.getAttribute("aria-label") === `Toggle ${name}`)!);
            await settle();
        }
        // The first works' crews' hours in the weeks drawn — the window's, and the one it ends at — summed by week, as the
        // generator made them.
        const first = East.compile(ex.generateWorks, [])(0n, 522n);
        const from = new Date("2026-09-28T00:00:00Z").getTime();
        const to = new Date("2026-12-28T00:00:00Z").getTime();
        const sums = new Map<number, number>();
        for (const crew of first.crews.values()) {
            for (const [at, hours] of crew.hours) if (at.getTime() >= from && at.getTime() <= to) sums.set(at.getTime(), (sums.get(at.getTime()) ?? 0) + hours);
        }
        expect(sums.size).toBeGreaterThan(0);
        const row = () => slot(container, "main")!.querySelector(rowAt(entry("crews", "W-10001")));
        await waitFor(() => expect(row()?.querySelectorAll("[data-cell] [data-part]").length ?? 0).toBeGreaterThan(0));
        const drawn = [...row()!.querySelectorAll<HTMLElement>("[data-cell]")].flatMap((cell) => {
            const part = cell.querySelector("[data-part]");
            return part === null ? [] : [[cell.getAttribute("data-cell"), Number((part.textContent ?? "").replace(/,/g, ""))] as const];
        });
        expect(drawn).toEqual([...sums].sort(([a], [b]) => a - b).map(([at, sum]) => [`time:${new Date(at).toISOString().replace("Z", "")}`, sum]));
    });

    test("a value too wide for its column draws a dot in its place, its numerals kept, hidden, for its hover to say; a column wide enough, its numerals", async () => {
        // The plot laid out at a width: the thirteen weeks across 300px are some 23px a week, narrower than a crew sum's numerals.
        let plotPx = 300;
        const was = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!;
        Object.defineProperty(Element.prototype, "clientWidth", {
            configurable: true, get(this: Element) { return this.hasAttribute("data-plan-measure") ? plotPx : was.get!.call(this); },
        });
        onTestFinished(() => { Object.defineProperty(Element.prototype, "clientWidth", was); });
        const crewsFirst = async () => {
            const { container } = await h.mount(ex.planNestedAll, { storageKey: `dots-${plotPx}` });
            await settle();
            const pane = slot(container, "start")!;
            fireEvent.click([...pane.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith("Series "))!);
            await settle();
            for (const name of ["Jobs", "Load"]) {
                const panel = pane.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
                fireEvent.click([...panel.querySelectorAll<HTMLElement>("button[aria-pressed]")].find((b) => b.getAttribute("aria-label") === `Toggle ${name}`)!);
                await settle();
            }
            return () => slot(container, "main")!.querySelector(rowAt(entry("crews", "W-10001")));
        };
        const narrow = await crewsFirst();
        await waitFor(() => expect(narrow()?.querySelectorAll("[data-plan-cell-dot]").length ?? 0).toBeGreaterThan(0));
        // Every cell holding a sum draws its dot, its numerals kept beside it — hidden by the dotted cell — for its hover to say.
        const sums = [...narrow()!.querySelectorAll("[data-cell]")].filter((c) => /[0-9]/.test(c.querySelector(":scope > [data-table-parts]")?.textContent ?? ""));
        expect(sums.length).toBeGreaterThan(0);
        expect(sums.filter((c) => !c.hasAttribute("data-plan-dotted") || c.querySelector(":scope > [data-plan-cell-dot]") === null)).toEqual([]);
        expect(sums[0]!.getAttribute("aria-label")).toMatch(/[0-9]{3}/);
        // 2000px: some 150px a week, each sum's numerals drawn, no dot.
        plotPx = 2000;
        const wide = await crewsFirst();
        await waitFor(() => expect(wide()?.querySelectorAll("[data-cell] [data-part]").length ?? 0).toBeGreaterThan(0));
        expect(wide()!.querySelectorAll("[data-plan-cell-dot], [data-plan-dotted]").length).toBe(0);
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
