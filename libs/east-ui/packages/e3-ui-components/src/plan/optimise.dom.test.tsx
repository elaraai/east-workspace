/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Optimise in the Plan (#1409, #1419; `Optimise Spec.md` §9, R24) on e3: the
 * print works' optimiser is the example's own `e3.function`, called by name on
 * e3 once per run. The eye shows only with an optimiser (R6); a click sends
 * one call over the plan window — every job in it and the backlog by key, the
 * presses beside them (R1, R24) — and while it is out the eye runs, the footer
 * counts and the history is locked (R2); the result lands as one edit (R7,
 * R8): the backlog placed on the presses, each new bar marked and named for
 * the run, the banner saying what changed, the Backlog count and the footer's
 * `in backlog` flashing — and one Undo reverts it all, Redo replays the
 * landing without the banner, Save commits it with everything else (R9, R11).
 * Stop ignores a late answer (R3); nothing to change and a failed call say so
 * (R10). What a run's request waits on is read in a component of its own
 * (#1343): over jobs read a window at a time, the eye waits for the rows the
 * canvas reads over its range, which hold each job's row, and reads none by
 * its key — whatever the number of jobs in the window, it asks e3 for the
 * windows alone, and a click builds its request from one read of the jobs'
 * rows over the range, never one a job (R24) — each of its reads landing re-running that reader
 * alone, never the canvas or the frame, which draw again as the eye can be
 * used. A rows' window that fails is said once, on the footer's loading line
 * in the jobs' words — `Couldn't read print job events` — with Retry, never a
 * status in the toolbar (#1398): the eye stays disabled, asking nothing again,
 * until Retry asks e3 again at once and the read lands; beside another kind,
 * the line names the kind whose window failed.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, East, OptionType, equalFor, none, printFor, some, variant } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { Data, Func, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as events from "@elaraai/e3-ui/examples/plan/plan-events";
import * as opt from "@elaraai/e3-ui/examples/plan/optimise";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import type { E3Request } from "../e3-web.test-utils.js";
import { MAX_RETAINED_WINDOWS } from "../platform/paged-runtime.js";
import { fitCalls } from "../shared/func/fit-calls.test-utils.js";
import { setPlanFrameRenderProbe } from "./frame/index.js";
import { setPlanRootRenderProbe } from "./index.js";
import { setPlanOptimiseProbe } from "./optimise.js";

const h = e3Harness({ "plan/plan-events": events, "plan/optimise": opt }, { main: "data-plan-body" });
const calls = fitCalls(h, { request: opt.PlanOptimiseRequest, result: opt.PlanOptimiseResult });

async function press(node: Element | null) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
const eye = (c: HTMLElement) => c.querySelector<HTMLButtonElement>("[data-optimise-button]");
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const history = (c: HTMLElement, name: string) => toolbar(c).getByRole("button", { name });
const added = (c: HTMLElement) => c.querySelectorAll<HTMLElement>('[data-plan-body] [data-run][data-op="add"]');
const banner = (c: HTMLElement, kind: string) => c.querySelector<HTMLElement>(`[data-optimise-banner="${kind}"]`);
const words = (el: HTMLElement) => [el.querySelector("[data-banner-title]")!.textContent, el.querySelector("[data-banner-body]")!.textContent];
const line = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-slot=footer] [data-footer-line]")!;
const lit = (c: HTMLElement) => c.querySelector("[data-plan-frame]")!.hasAttribute("data-optimise-lit");
/** The window, as the eye names it: `Optimise {period}`. */
const period = (c: HTMLElement) => eye(c)!.getAttribute("aria-label")!.replace(/^Optimise /, "");
const backlogTab = (c: HTMLElement) => within(slot(c, "start")).getByRole("tab", { name: /^Backlog/ });
/** How many jobs the Backlog tab counts. */
const backlogCount = (c: HTMLElement) => Number(backlogTab(c).textContent!.replace(/^Backlog\s*/, ""));
const commits = async () => (await h.history(events.planEventJobs)).commits.map(commit => commit.mutation);
/** Waits for a run's answer to land — e3 runs the optimiser's function for it, which takes its time. */
const landed = (c: HTMLElement, n: number) => waitFor(() => expect(added(c)).toHaveLength(n), { timeout: 10_000 });
/** Waits for a banner of a kind — the answer's, once e3 has given it. */
const said = (c: HTMLElement, kind: string) => waitFor(() => expect(banner(c, kind)).not.toBeNull(), { timeout: 10_000 });
/** Mounts the example and waits for the kinds' first read: the eye is enabled once the window is read. */
async function mounted() {
    const view = await h.mount(opt.planOptimise);
    await waitFor(() => expect(eye(view.container)!.disabled).toBe(false), { timeout: 10_000 });
    return view;
}

describe("the eye in the Plan", () => {
    test("R6 — the eye shows for a Plan with an optimiser, named for the window, immediately before the history item", async () => {
        const { container } = await mounted();
        expect([eye(container)!.getAttribute("aria-label")!.startsWith("Optimise "), eye(container)!.hasAttribute("data-running")]).toEqual([true, false]);
        const items = [...slot(container, "toolbar").querySelectorAll("[data-toolbar-item]")].map(el => el.getAttribute("data-toolbar-item"));
        expect(items.indexOf("history") - items.indexOf("optimise")).toBe(1);
    });

    test("R1, R2, R24 — one call over the window and the backlog, the presses beside them; the lock while it is out", async () => {
        const { container } = await mounted();
        const at = period(container);
        const backlog = backlogCount(container);
        expect(backlog).toBeGreaterThan(0);
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        expect([eye(container)!.hasAttribute("data-running"), eye(container)!.getAttribute("aria-label")]).toEqual([true, "Stop optimising"]);
        expect([line(container).getAttribute("data-loading-line"), line(container).querySelector("[data-line-text]")!.textContent]).toEqual(["busy", `Optimising ${at}`]);
        for (const name of [editingMessages.undo(), editingMessages.redo(), editingMessages.discard(), editingMessages.apply()]) {
            expect(history(container, name).getAttribute("aria-disabled")).toBe("true");
        }
        expect(calls.requests()).toHaveLength(1);
        const asked = calls.requests()[0]!;
        expect([asked.run, asked.resources.presses.size > 0, asked.from.getTime(), asked.to.getTime()])
            .toEqual([1n, true, new Date("2026-10-05T00:00:00Z").getTime(), new Date("2026-11-02T00:00:00Z").getTime()]);
        expect([...asked.events.job.values()].filter(job => job.start.type === "none")).toHaveLength(backlog);
        hold.release();
        await landed(container, backlog);
        expect([eye(container)!.hasAttribute("data-running"), line(container).hasAttribute("data-idle")]).toEqual([false, true]);
    });

    test("R7–R9, R11 — the result lands as one edit: the backlog placed and marked, the banner and the legend; the counts flash; one Undo reverts it, Redo replays it without the banner, Save commits it as one patch", async () => {
        const { container } = await mounted();
        const backlog = backlogCount(container);
        const deployed = await commits();
        await press(eye(container));
        await landed(container, backlog);
        const at = period(container);
        const asked = calls.requests()[0]!;
        const waiting = [...asked.events.job].filter(([, job]) => job.start.type === "none").map(([key]) => key);
        expect([...added(container)].every(el => el.getAttribute("title")!.startsWith("Added by Elara · run #1") && el.getAttribute("data-fill") === "own")).toBe(true);
        expect(words(banner(container, "done")!)).toEqual([`Elara optimised ${at}`, `${backlog} changes: ${backlog} added. Undo or apply them like any edit.`]);
        expect([lit(container), container.querySelector("[data-slot=footer] [data-optimise-legend]")?.textContent]).toEqual([true, "Elara change"]);
        // The backlog is empty, its count flashing in the tab and in the footer.
        expect(backlogCount(container)).toBe(0);
        expect([slot(container, "start").querySelector("[data-tab-count][data-opn]"), container.querySelector('[data-plan-count="backlog"][data-opn]')].map(el => el !== null)).toEqual([true, true]);
        // One step: one Undo takes the whole run back, and ends its highlight and its banner.
        await press(history(container, editingMessages.undo()));
        expect([added(container).length, lit(container), backlogCount(container)]).toEqual([0, false, backlog]);
        await waitFor(() => expect(container.querySelector("[data-optimise-banner]:not([data-leaving])")).toBeNull());
        // Redo re-inserts it and replays the landing, without the banner — the Undo's may still be collapsing.
        await press(history(container, editingMessages.redo()));
        await landed(container, backlog);
        await waitFor(() => expect(lit(container)).toBe(true));
        expect(container.querySelector('[data-optimise-banner="done"]:not([data-leaving])')).toBeNull();
        // Save commits the run with everything else, as one patch; nothing is marked once nothing is pending.
        await press(history(container, editingMessages.apply()));
        await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]), { timeout: 10_000 });
        await waitFor(() => expect(container.querySelectorAll("[data-plan-body] [data-op]")).toHaveLength(0));
        const jobs = await h.read(events.planEventJobs);
        expect(waiting.every(key => jobs.get(key)!.start.type === "some" && jobs.get(key)!.press.type === "some")).toBe(true);
        expect([lit(container), container.querySelector("[data-optimise-banner]")]).toEqual([false, null]);
    });

    /** Selects the first job the canvas draws, as a click on its bar does, and waits for the inspector to show it: its bar. */
    async function selectFirstJob(c: HTMLElement): Promise<HTMLElement> {
        const first = c.querySelector<HTMLElement>("[data-plan-body] [data-run]")!;
        await press(first);
        await waitFor(() => expect(slot(c, "end").querySelector('[data-plan-inspector="event"]')).not.toBeNull());
        return first;
    }
    /** A job's bar on the canvas, by its element's key. */
    const barOf = (c: HTMLElement, key: string) => c.querySelector(`[data-plan-body] [data-run=${JSON.stringify(key)}]`);
    /** The inspector's edits: the form, Duplicate and Delete, in one fieldset. */
    const edits = (c: HTMLElement) => slot(c, "end").querySelector<HTMLFieldSetElement>("[data-inspector-edits]")!;

    test("R2 — while the call is out Delete takes nothing: the selected job stays, before the run lands and after", async () => {
        const { container } = await mounted();
        const backlog = backlogCount(container);
        const job = await selectFirstJob(container);
        const key = job.getAttribute("data-run")!;
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        await act(async () => { fireEvent.keyDown(job, { key: "Delete" }); });
        await settle();
        expect(barOf(container, key)).not.toBeNull();
        hold.release();
        await landed(container, backlog);
        expect(barOf(container, key)).not.toBeNull();
    });

    test("R2 — while the call is out the inspector's edits are off: its form, Duplicate and Delete take nothing until the run lands", async () => {
        const { container } = await mounted();
        await selectFirstJob(container);
        expect(edits(container).disabled).toBe(false);
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        expect(edits(container).disabled).toBe(true);
        hold.release();
        await waitFor(() => expect(eye(container)!.hasAttribute("data-running")).toBe(false), { timeout: 10_000 });
        await waitFor(() => expect(edits(container).disabled).toBe(false));
    });

    test("R3 — Stop cancels the call: the footer says so, a late answer is ignored, and nothing is recorded", async () => {
        const { container } = await mounted();
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        await press(eye(container));
        expect([eye(container)!.hasAttribute("data-running"), line(container).getAttribute("data-loading-line"), line(container).querySelector("[data-line-text]")!.textContent])
            .toEqual([false, "note", "Stopped · nothing changed"]);
        hold.release();
        await settle();
        expect([calls.requests().length, added(container).length, container.querySelector("[data-optimise-banner]")]).toEqual([1, 0, null]);
        expect((history(container, editingMessages.apply()) as HTMLButtonElement).disabled).toBe(true);
    });

    test("R10 — a result that changes nothing is said so, the eye blinking; a failed call is an alert until the next run", async () => {
        const { container } = await mounted();
        const backlog = backlogCount(container);
        await press(eye(container));
        await landed(container, backlog);
        // The drafts are the next run's input (O5): with every job placed, the optimiser changes nothing.
        await press(eye(container));
        await said(container, "none");
        expect(words(banner(container, "none")!)).toEqual(["No changes", `Elara found nothing to improve in ${period(container)}.`]);
        expect([banner(container, "none")!.querySelector("[role=status]") !== null, eye(container)!.hasAttribute("data-blink"), calls.requests().length]).toEqual([true, true, 2]);
        expect(added(container)).toHaveLength(backlog);
        const restore = calls.fail();
        await press(eye(container));
        await said(container, "fail");
        expect(words(banner(container, "fail")!)).toEqual([`Couldn't optimise ${period(container)}`, "Nothing changed. Run it again from the eye."]);
        expect([banner(container, "fail")!.querySelector("[role=alert]") !== null, added(container).length]).toEqual([true, backlog]);
        restore();
    });

    test("R24 — a window no request carries whole leaves the eye disabled: past the cap of jobs in it, no run is sent the backlog to place over jobs it was never shown (#1039)", async () => {
        const { container } = await mounted();
        // Another planner's jobs fill the window past the cap: ten thousand and one more, on the first press, in its first week.
        const jobs = new Map(await h.read(events.planEventJobs));
        for (let i = 0; i < 10_001; i++) {
            const start = new Date(Date.UTC(2026, 9, 5, 6) + (i % 120) * 3_600_000);
            jobs.set(`J-${90_000 + i}`, {
                title: `Filler ${i}`, start: some(start), end: some(new Date(start.getTime() + 3_600_000)), press: some("a1"),
                state: variant("confirmed", null), sheets: 8000.0, customer: "Filler", stock: variant("coated", null), due: none,
            });
        }
        await h.patch(events.planEventJobs, jobs);
        await settle();
        expect(eye(container)!.disabled).toBe(true);
        await press(eye(container));
        expect(calls.requests()).toEqual([]);
    });
});

/** The print works' jobs' record, as a request names it. */
const JOBS = `records.${events.planPrintJobs.name}`;
/** The print works' shifts' record, as a request names it. */
const SHIFTS = `records.${events.planPrintShifts.name}`;
const maybeTime = printFor(OptionType(DateTimeType));
const time = printFor(DateTimeType);

/**
 * The print works' jobs on its presses, read a window at a time through their source's interval index (#1344) — the
 * window's jobs and the backlog through it, a job by its key through the record's own entries — and the print works'
 * optimiser beside them: what a run's request waits on lands in many settles.
 */
const windowed = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(Record.bind(events.planPrintPresses, []));
    const jobs = $.const(Record.bind(events.planPrintJobs, [events.planPrintJobsPatch]));
    const jobEntries = $.const(Data.bindPaged(events.planPrintJobs));
    const slice = $.const(Slice.bindRecords("optimise.windowed", {
        job: { source: Data.bindPaged(events.planPrintJobs, { indexes: [events.planPrintJobsByTime] }), fields: { start: { label: "Dates" } }, range: "start" },
    }));
    const optimise = $.const(Func.bind(opt.placeJobs));
    return Plan({
        axis: Plan.axis({ window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") }, resolution: "day", now: new Date("2026-10-14T09:00:00Z") }),
        slice: { slice }, optimise,
        resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                entries: jobEntries,
            }),
        },
        library: [Plan.library.backlog()],
    });
}))) };

/**
 * A record's window from a day: one batch of some fifty-five key searches through its interval index (#1351), the first
 * from that day — the day as the index files a start, `some` of it where the start is an Option.
 */
const windowOver = (dataset: string, index: string, start: (day: Date) => string) => (day: Date) => (request: E3Request): boolean => {
    if (request.kind !== "find" || request.dataset !== dataset || request.query.get("index") !== index || request.searches.length <= 50) return false;
    const first = request.searches[0];
    return first !== undefined && "from" in first && first.from?.at(-1) === start(day);
};
/** The jobs' window from a day: their start an Option, which a job waiting in the backlog holds none of. */
const windowFrom = windowOver(JOBS, events.planPrintJobsByTime.name, (day) => maybeTime(some(day)));
/** The shifts' window from a day. */
const shiftsFrom = windowOver(SHIFTS, events.planPrintShiftsByTime.name, time);
/** A job's row, read by its key: the key sought among the record's own entries. */
const jobByKey = (request: E3Request): boolean => request.kind === "find" && request.dataset === JOBS && request.query.get("index") === null
    && request.searches.some((search) => "key" in search);
/** A job's row, read on its own: a one-row page of the record's own entries, at the row its key was found at. */
const jobRowPage = (request: E3Request): boolean => request.kind === "page" && request.dataset === JOBS && request.query.get("index") === null
    && request.query.get("limit") === "1";
/** One job's row read by its key: its key sought, or its one-row page — each a request of its own, a job at a time. */
const readsJobRow = (request: E3Request): boolean => jobByKey(request) || jobRowPage(request);
/** A batch of the jobs' searches through their interval index: a window of them, read whole. */
const windowSearches = (request: E3Request): boolean => request.kind === "find" && request.dataset === JOBS
    && request.query.get("index") === events.planPrintJobsByTime.name;
/** The requests made of the jobs' record since the request log held `from`. */
const jobsSince = (from: number): E3Request[] => h.requests().slice(from).filter((request) => request.dataset === JOBS);
/** The toolbar's step to the next day. */
const nextDay = (c: HTMLElement) => toolbar(c).getByRole("button", { name: "Next day" });

describe("what the eye waits on, read in a component of its own (#1343)", () => {
    test("R24 — over jobs read a window at a time, the eye waits for the rows the canvas reads over its range, which hold each job's row, and reads none by its key: its own reads landing re-run its reader alone, never the canvas or the frame, which draw again as the eye can be used", async () => {
        const { container } = await h.mount(windowed);
        await waitFor(() => expect(eye(container)!.disabled).toBe(false), { timeout: 10_000 });
        // The next day's reads: the rows' window over the range the canvas reads — the plan window and a day either
        // side — held until the end, and the eye's count of the plan window's jobs, let land first; any job's row read
        // by its key held, so one asked is counted rather than run on.
        const rowsWindow = h.e3.hold(windowFrom(new Date("2026-10-04T00:00:00Z")));
        const eyeWindow = h.e3.hold(windowFrom(new Date("2026-10-06T00:00:00Z")));
        const jobRow = h.e3.hold(readsJobRow);
        let canvas = 0;
        let frame = 0;
        setPlanRootRenderProbe(() => { canvas += 1; });
        setPlanFrameRenderProbe(() => { frame += 1; });
        try {
            await press(nextDay(container));
            expect([rowsWindow.held, eyeWindow.held, jobRow.held, eye(container)!.disabled]).toEqual([1, 1, 0, true]);
            // The plan window's jobs land: the eye waits on for the rows' window, reading no job's row by its key, and
            // nothing else draws again.
            canvas = 0;
            frame = 0;
            await act(async () => { eyeWindow.release(); });
            await settle();
            expect([canvas, frame, jobRow.held, eye(container)!.disabled]).toEqual([0, 0, 0, true]);
            // The rows' window lands: every job's row is held there, and the eye can be used — the canvas draws it so.
            await act(async () => { rowsWindow.release(); });
            await settle();
            expect([eye(container)!.disabled, jobRow.held]).toEqual([false, 0]);
            expect(canvas).toBeGreaterThan(0);
        } finally {
            setPlanRootRenderProbe(undefined);
            setPlanFrameRenderProbe(undefined);
        }
    });

    test("R24 — over more jobs in the plan window than the paging runtime keeps windows, with the rows' window held, the next day's reads ask e3 the two windows' searches and nothing of any one job, the eye disabled; once the window lands the eye can be used, and the request a click makes carries every job as e3 holds it, built from one read of the jobs' rows over the range — never one a job — and reading none by its key", async () => {
        const { container } = await h.mount(windowed);
        await waitFor(() => expect(eye(container)!.disabled).toBe(false), { timeout: 10_000 });
        // Read a job at a time, past the windows the runtime keeps each row read evicted one read before it, which the
        // next pass read again: the reads never settled while the rows' window was on its way. Any job's row read by its
        // key is held, so one asked is counted rather than run on.
        const rowsWindow = h.e3.hold(windowFrom(new Date("2026-10-04T00:00:00Z")));
        const jobRow = h.e3.hold(readsJobRow);
        const stepped = h.requests().length;
        await press(nextDay(container));
        const asked = jobsSince(stepped);
        // The rows' window over the range the canvas reads, held, and the plan window's: bounded whatever the jobs.
        expect([asked.filter(readsJobRow).length, jobRow.held, asked.filter(windowSearches).length, asked.length, rowsWindow.held, eye(container)!.disabled])
            .toEqual([0, 0, 2, 2, 1, true]);
        // The rows' window lands: each job's row is held there, and the eye can be used, nothing more asked.
        const landing = h.requests().length;
        await act(async () => { rowsWindow.release(); });
        await settle();
        expect([eye(container)!.disabled, jobsSince(landing).filter(readsJobRow).length]).toEqual([false, 0]);
        // A click's request carries the plan window's jobs and the backlog — more than the windows the runtime keeps — each
        // row read where the canvas read it: none by its key.
        const call = calls.hold();
        const clicked = h.requests().length;
        const reads: string[] = [];
        setPlanOptimiseProbe({ readRows: (kind) => { reads.push(kind); } });
        try {
            await press(eye(container));
            await call.holding;
        } finally {
            setPlanOptimiseProbe(undefined);
        }
        const request = calls.requests()[0]!;
        expect([request.events.job.size > MAX_RETAINED_WINDOWS, [...request.events.job.values()].filter((job) => job.start.type === "none").length,
            jobsSince(clicked).filter(readsJobRow).length]).toEqual([true, 8, 0]);
        // Built from one read of the jobs' rows over the range, whatever the number of jobs — never one a job, which read
        // them all again each time — and each job the request carries is the job e3 holds.
        expect(reads).toEqual(["job"]);
        const held = await h.read(events.planPrintJobs);
        const sameJob = equalFor(events.PrintJob);
        expect([...request.events.job].filter(([key, job]) => !sameJob(job, held.get(key)!)).map(([key]) => key)).toEqual([]);
        call.release();
        await waitFor(() => expect(eye(container)!.hasAttribute("data-running")).toBe(false), { timeout: 10_000 });
    });

    test("R24, #1398 — a rows' window that fails is said on the footer's line, `Couldn't read print job events`, with Retry — never the toolbar's chip — the eye disabled and its reads settled, no job's row read by its key and nothing asked again; Retry asks e3 again at once, and once the read lands the eye can be used", async () => {
        const { container } = await h.mount(windowed);
        await waitFor(() => expect(eye(container)!.disabled).toBe(false), { timeout: 10_000 });
        const failing = windowFrom(new Date("2026-10-04T00:00:00Z"));
        const restore = h.e3.fail(failing);
        const jobRow = h.e3.hold(readsJobRow);
        try {
            const stepped = h.requests().length;
            await press(nextDay(container));
            // Said once: on the footer's one line, in the jobs' words, why in its title, with Retry — never a status.
            expect([line(container).hasAttribute("data-failed"), line(container).querySelector("[data-line-text]")?.textContent,
                line(container).querySelector("[data-line-retry]") !== null]).toEqual([true, "Couldn't read print job events", true]);
            expect(line(container).getAttribute("title")).toContain(JOBS);
            expect(slot(container, "toolbar").querySelector('[data-plan-diagnostics="source"]')).toBeNull();
            expect([eye(container)!.disabled, jobRow.held, jobsSince(stepped).filter(readsJobRow).length]).toEqual([true, 0, 0]);
            // Nothing is asked again of the jobs while the window stands failed.
            const settled = h.requests().length;
            await settle();
            expect([jobsSince(settled).length, eye(container)!.disabled]).toEqual([0, true]);
            // e3 answers again, and Retry asks it at once — inside the gap a read alone waits after a failure.
            restore();
            const asked = h.requests().filter(failing).length;
            await act(async () => { fireEvent.click(line(container).querySelector("[data-line-retry]")!); });
            expect(h.requests().filter(failing).length).toBeGreaterThan(asked);
            // The read lands: the line goes quiet, and the eye can be used — no job's row read by its key meanwhile.
            await settle();
            await waitFor(() => expect(eye(container)!.disabled).toBe(false), { timeout: 10_000 });
            expect([line(container).hasAttribute("data-idle"), jobsSince(settled).filter(readsJobRow).length]).toEqual([true, 0]);
        } finally {
            restore();
        }
    });
});

/**
 * The print works' jobs on its presses and its crews' shifts on its crews, each kind read a window at a time through
 * its source's interval index, and no optimiser: one failed read of the event kinds' rows, and the kind it is of.
 */
const twoKinds = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(Record.bind(events.planPrintPresses, []));
    const crews = $.const(Record.bind(events.planPrintCrews, []));
    const jobs = $.const(Record.bind(events.planPrintJobs, [events.planPrintJobsPatch]));
    const shifts = $.const(Record.bind(events.planPrintShifts, [events.planPrintShiftsPatch]));
    const jobEntries = $.const(Data.bindPaged(events.planPrintJobs));
    const shiftEntries = $.const(Data.bindPaged(events.planPrintShifts));
    const slice = $.const(Slice.bindRecords("optimise.two-kinds", {
        job: { source: Data.bindPaged(events.planPrintJobs, { indexes: [events.planPrintJobsByTime] }), fields: { start: { label: "Dates" } }, range: "start" },
        shift: { source: Data.bindPaged(events.planPrintShifts, { indexes: [events.planPrintShiftsByTime] }), fields: { start: { label: "Dates" } }, range: "start" },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") }, resolution: "day", now: new Date("2026-10-14T09:00:00Z") }),
        slice: { slice },
        resources: {
            presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }),
            crews: Schedule.resources(crews.read(), { name: "Crews", icon: "user-group", label: (c) => c.name }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                entries: jobEntries,
            }),
            shift: Schedule.events(shifts, {
                name: "Crew shift", icon: "user-clock", draw: "cards", title: "title", start: "start", end: "end",
                resource: { field: "crew", of: "crews" }, state: "state",
                entries: shiftEntries,
            }),
        },
    });
}))) };

describe("an event kind's window that fails, on the footer's line (#1398)", () => {
    test("beside another kind, the line names the kind whose window failed — `Couldn't read crew shift events`, never the jobs — with Retry, which asks e3 again at once; once the shifts land the line goes quiet", async () => {
        const { container } = await h.mount(twoKinds);
        await settle();
        expect(line(container).hasAttribute("data-idle")).toBe(true);
        // The shifts' window over the range the canvas reads after a step to the next day: refused.
        const failing = shiftsFrom(new Date("2026-10-04T00:00:00Z"));
        const restore = h.e3.fail(failing);
        try {
            await press(nextDay(container));
            expect([line(container).hasAttribute("data-failed"), line(container).querySelector("[data-line-text]")?.textContent])
                .toEqual([true, "Couldn't read crew shift events"]);
            expect(line(container).getAttribute("title")).toContain(SHIFTS);
            expect(slot(container, "toolbar").querySelector('[data-plan-diagnostics="source"]')).toBeNull();
            // e3 answers again, and Retry asks it for the shifts at once.
            restore();
            const asked = h.requests().filter(failing).length;
            await act(async () => { fireEvent.click(line(container).querySelector("[data-line-retry]")!); });
            expect(h.requests().filter(failing).length).toBeGreaterThan(asked);
            await settle();
            await waitFor(() => expect(line(container).hasAttribute("data-idle")).toBe(true), { timeout: 10_000 });
        } finally {
            restore();
        }
    });
});
