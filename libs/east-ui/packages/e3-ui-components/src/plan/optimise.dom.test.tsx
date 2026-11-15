/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Optimise in the Plan (#1409, #1419, east-workspace#1622; `Optimise Spec.md`
 * §9, R24) on e3: the print works' optimiser is the example's own
 * `e3.function`, called by name on e3 once per run. The eye shows only with an
 * optimiser (R6); a click sends one call — the plan window, the unit its axis
 * is zoomed to, the run's number and the rail's narrowing, and no row (R1):
 * the function reads the jobs itself, the Plan's unsaved edits laid over them
 * as drafts — and while it is out the eye runs, the footer counts and the
 * history is locked (R2); the answer's patch lands as one edit (R7, R8): the
 * backlog placed on the presses, each new bar marked and named for the run,
 * the banner saying what changed, the Backlog count and the footer's `in
 * backlog` flashing — and one Undo reverts it all, Redo replays the landing
 * without the banner, Save commits it with everything else (R9, R11). Stop
 * ignores a late answer (R3); nothing to change and a failed call say so
 * (R10). The eye waits on nothing the canvas reads (rule 6): over jobs read a
 * window at a time it is on before their rows land, a click asks e3 nothing of
 * the jobs for its request, and a window past the cap of jobs runs as any
 * other. A landing over jobs read a window at a time lands as ever. Beside
 * another kind, a window that fails is said on the footer's line in that
 * kind's words (#1398). What it does with any answer — one that inserts,
 * updates and deletes, one that replaces the whole Dict, one that moves a job
 * out of the window, another page's save while the call is out, a key another
 * page takes — is the builders' shared cases (`optimise-cases.test-utils.ts`),
 * over the window's jobs. A job of the window the rail narrows out, which the
 * Plan holds none of, is read by its key before an answer that changes it
 * lands (rule 8).
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, DictType, East, OptionType, StringType, diffFor, equalFor, none, printFor, some, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { Data, Func, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as events from "@elaraai/e3-ui/examples/plan/plan-events";
import * as opt from "@elaraai/e3-ui/examples/plan/optimise";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { readsRow, type E3Request } from "../e3-web.test-utils.js";
import { fitCalls } from "../shared/func/fit-calls.test-utils.js";
import { optimiseCases } from "../shared/func/optimise-cases.test-utils.js";
import "./index.js";

/**
 * The print works' optimiser over its jobs read a window at a time (`windowed`, below): the example's, over the record
 * that page edits — each job of the backlog placed on its press, or the press free soonest, from when it is free. A
 * function reads the record its page edits: one that read another would answer a patch of rows the Plan holds none of.
 */
const placePrintJobs = e3.function("plan_test_place_print_jobs", {
    inputs: [e3.index(events.planPrintJobs.indexes.plan_print_jobs_by_time), events.planPrintJobs, events.planPrintPresses],
    drafts: [events.planPrintJobs],
    args: [Plan.Types.OptimiseRequest],
    output: opt.PlanOptimiseResult,
}, ($, jobsByTime, jobs, presses, request) => {
    const free = $.let(new Map(), DictType(StringType, DateTimeType));
    $.for(presses, ($2, _press, key) => { $2(free.insert(key, request.from)); });
    jobsByTime.overlapping({ from: request.from, to: request.to }).each($, ($2, _carried, key) => {
        const job = $2.const(jobs.get(key));
        $2.match(job.press, { some: ($3, press) => {
            $3.match(job.end, { some: ($4, end) => {
                $4.if(free.has(press).and(() => East.less(free.get(press), end)), ($5) => { $5(free.insertOrUpdate(press, end, (_$6, _held, later) => later)); });
            } });
        } });
    });
    const backlog = $.const(jobsByTime.unset().collect($));
    const before = $.let(new Map(), opt.PrintJobs);
    const after = $.let(new Map(), opt.PrintJobs);
    $.for(backlog, ($2, _carried, key) => {
        const job = $2.const(jobs.get(key));
        const soonest = $2.const(free.toArray(($3, at, press) => ({ press, at })).sort(($3, slot) => slot.at).get(0n).press);
        const press = $2.const(job.press.match({
            some: ($3, named) => free.has(named).ifElse(() => named, () => soonest),
            none: ($3) => soonest,
        }));
        const start = $2.const(free.get(press));
        const end = $2.const(start.addMinutes(East.Float.roundHalf(job.sheets.divide(8000.0).multiply(60.0))));
        // Within the window it was asked of: a job that would end past it stays waiting.
        $2.if(East.lessEqual(end, request.to), ($3) => {
            $3(before.insert(key, job));
            $3(after.insert(key, {
                title: job.title, start: some(start), end: some(end), press: some(press), state: job.state,
                sheets: job.sheets, customer: job.customer, stock: job.stock, due: job.due,
            }));
            $3(free.insertOrUpdate(press, end, (_$4, _held, later) => later));
        });
    });
    return { events: { job: East.diff(before, after) } };
});

const h = e3Harness({ "plan/plan-events": events, "plan/optimise": opt, "plan/optimise-windowed": { placePrintJobs } }, { main: "data-plan-body" });
const calls = fitCalls(h, { request: Plan.Types.OptimiseRequest, result: opt.PlanOptimiseResult });

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
/** Mounts the example and waits for the kinds' first read: the Backlog counts its jobs. The eye waits on none of it. */
async function mounted() {
    const view = await h.mount(opt.planOptimise);
    expect(eye(view.container)!.disabled).toBe(false);
    await waitFor(() => expect(backlogCount(view.container)).toBeGreaterThan(0), { timeout: 10_000 });
    return view;
}
/** The keys of the jobs waiting in the backlog, as the record holds them. */
const waitingJobs = async () => [...await h.read(events.planEventJobs)].filter(([, job]) => job.start.type === "none").map(([key]) => key);

describe("the eye in the Plan", () => {
    test("R6 — the eye shows for a Plan with an optimiser, named for the window, immediately before the history item", async () => {
        const { container } = await mounted();
        expect([eye(container)!.getAttribute("aria-label")!.startsWith("Optimise "), eye(container)!.hasAttribute("data-running")]).toEqual([true, false]);
        const items = [...slot(container, "toolbar").querySelectorAll("[data-toolbar-item]")].map(el => el.getAttribute("data-toolbar-item"));
        expect(items.indexOf("history") - items.indexOf("optimise")).toBe(1);
    });

    test("R1, R2 — one call asking the window, the unit the axis is zoomed to, the run's number and the rail's narrowing, and no row; the lock while it is out", async () => {
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
        // The request carries no row: its fields are the window, the axis's unit, the run and the narrowing.
        expect(Object.keys(asked).sort()).toEqual(["from", "period", "run", "slice", "to"]);
        expect([asked.run, asked.from.getTime(), asked.to.getTime()])
            .toEqual([1n, new Date("2026-10-05T00:00:00Z").getTime(), new Date("2026-11-02T00:00:00Z").getTime()]);
        expect(["day", "week", "month", "quarter", "year"]).toContain(asked.period.type);
        hold.release();
        await landed(container, backlog);
        expect([eye(container)!.hasAttribute("data-running"), line(container).hasAttribute("data-idle")]).toEqual([false, true]);
    });

    test("R7–R9, R11 — the result lands as one edit: the backlog placed and marked, the banner and the legend; the counts flash; one Undo reverts it, Redo replays it without the banner, Save commits it as one patch", async () => {
        const { container } = await mounted();
        const backlog = backlogCount(container);
        const deployed = await commits();
        const waiting = await waitingJobs();
        expect(waiting).toHaveLength(backlog);
        await press(eye(container));
        await landed(container, backlog);
        const at = period(container);
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
        // The blink lasts 560ms, which a slow machine can spend before the banner is read: what it did is watched.
        let blinked = false;
        const watching = new MutationObserver(() => { blinked ||= eye(container)!.hasAttribute("data-blink"); });
        watching.observe(container, { subtree: true, attributes: true, attributeFilter: ["data-blink"] });
        await press(eye(container));
        await said(container, "none");
        watching.disconnect();
        expect(words(banner(container, "none")!)).toEqual(["No changes", `Elara found nothing to improve in ${period(container)}.`]);
        expect([banner(container, "none")!.querySelector("[role=status]") !== null, blinked, calls.requests().length]).toEqual([true, true, 2]);
        expect(added(container)).toHaveLength(backlog);
        const restore = calls.fail();
        await press(eye(container));
        await said(container, "fail");
        expect(words(banner(container, "fail")!)).toEqual([`Couldn't optimise ${period(container)}`, "Nothing changed. Run it again from the eye."]);
        expect([banner(container, "fail")!.querySelector("[role=alert]") !== null, added(container).length]).toEqual([true, backlog]);
        restore();
    });

    test("rule 6 — past the cap of jobs in the window, none of which the canvas reads, the eye is on and a run is sent as any other: the function reads the jobs itself (#1039)", async () => {
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
        expect(eye(container)!.disabled).toBe(false);
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        expect([calls.requests().length, eye(container)!.hasAttribute("data-running")]).toEqual([1, true]);
        // Stopped: the run was sent, which is what the cap no longer keeps from happening.
        await press(eye(container));
        hold.release();
        await settle();
        expect(eye(container)!.hasAttribute("data-running")).toBe(false);
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
    const jobs = $.const(Record.bind(events.planPrintJobs, ["patch"]));
    const jobEntries = $.const(Data.bindPaged(events.planPrintJobs));
    const slice = $.const(Slice.bindRecords("optimise.windowed", {
        job: { source: Data.bindPaged(events.planPrintJobs, { indexes: ["plan_print_jobs_by_time"] }), fields: { start: { label: "Dates" } }, range: "start" },
    }));
    const optimise = $.const(Func.bind(placePrintJobs));
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
const windowFrom = windowOver(JOBS, "plan_print_jobs_by_time", (day) => maybeTime(some(day)));
/** The shifts' window from a day. */
const shiftsFrom = windowOver(SHIFTS, "plan_print_shifts_by_time", time);
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
    && request.query.get("index") === "plan_print_jobs_by_time";
/** The requests made of the jobs' record since the request log held `from`. */
const jobsSince = (from: number): E3Request[] => h.requests().slice(from).filter((request) => request.dataset === JOBS);
/** The toolbar's step to the next day. */
const nextDay = (c: HTMLElement) => toolbar(c).getByRole("button", { name: "Next day" });

/**
 * The print works' jobs, read a window at a time behind their rail, on a canvas that zooms — the day, the week, the
 * month and the quarter — with the print works' optimiser. A Plan zooms through its rail, which keeps the resolution.
 */
const zooming = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(Record.bind(events.planPrintPresses, []));
    const jobs = $.const(Record.bind(events.planPrintJobs, ["patch"]));
    const jobEntries = $.const(Data.bindPaged(events.planPrintJobs));
    const slice = $.const(Slice.bindRecords("optimise.zooming", {
        job: { source: Data.bindPaged(events.planPrintJobs, { indexes: ["plan_print_jobs_by_time"] }), fields: { start: { label: "Dates" } }, range: "start" },
    }));
    const optimise = $.const(Func.bind(placePrintJobs));
    return Plan({
        axis: Plan.axis({
            window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
            resolution: "day", resolutions: ["day", "week", "month", "quarter"], now: new Date("2026-10-14T09:00:00Z"),
        }),
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

describe("the period a run is asked of (rule 1)", () => {
    const instant = printFor(DateTimeType);
    test("each zoom's request names the plan window in view and the unit the axis is zoomed to: the day, the week, the month and the quarter", async () => {
        const { container } = await h.mount(zooming);
        /** Zooms the canvas to a resolution through the toolbar's segment, as a planner does. */
        const zoomTo = async (resolution: "day" | "week" | "month" | "quarter") => {
            const seg = container.querySelector<HTMLElement>("[data-plan-seg='resolution']")!;
            await press([...seg.querySelectorAll<HTMLElement>("[role='radio']")][["day", "week", "month", "quarter"].indexOf(resolution)]!);
        };
        /** A run's request from the canvas as it stands: its call held on its way, its question read, and the run stopped. */
        const asked = async () => {
            const hold = calls.hold();
            await press(eye(container));
            await hold.holding;
            const request = calls.requests().at(-1)!;
            await press(eye(container));
            hold.release();
            await settle();
            return [request.period.type, instant(request.from), instant(request.to)];
        };
        // The window the app gave, in days and in weeks: four weeks from Mon 5 Oct.
        expect(await asked()).toEqual(["day", "2026-10-05T00:00:00.000", "2026-11-02T00:00:00.000"]);
        await zoomTo("week");
        expect(await asked()).toEqual(["week", "2026-10-05T00:00:00.000", "2026-11-02T00:00:00.000"]);
        // Zoomed out, the window is whole units of the axis: the months it touches, then their quarter.
        await zoomTo("month");
        expect(await asked()).toEqual(["month", "2026-10-01T00:00:00.000", "2026-12-01T00:00:00.000"]);
        await zoomTo("quarter");
        expect(await asked()).toEqual(["quarter", "2026-10-01T00:00:00.000", "2027-01-01T00:00:00.000"]);
    });
});

describe("the eye waits on nothing the canvas reads (rule 6)", () => {
    test("over jobs read a window at a time, the eye is on while the next day's window is still on its way, and a click asks e3 nothing of the jobs for its request: the call alone", async () => {
        const { container } = await h.mount(windowed);
        await waitFor(() => expect(backlogCount(container)).toBeGreaterThan(0), { timeout: 10_000 });
        // The next day's reads: the rows' window over the range the canvas reads, held — the canvas waits for it.
        const rowsWindow = h.e3.hold(windowFrom(new Date("2026-10-04T00:00:00Z")));
        const hold = calls.hold();
        try {
            await press(nextDay(container));
            await waitFor(() => expect(rowsWindow.held).toBeGreaterThan(0));
            // The eye waits for none of it.
            expect(eye(container)!.disabled).toBe(false);
            const clicked = h.requests().length;
            await press(eye(container));
            await hold.holding;
            // The click asked e3 for its call, and nothing of the jobs: no row is read for a request that carries none.
            expect([calls.requests().length, jobsSince(clicked).filter(readsJobRow).length, jobsSince(clicked).filter(windowSearches).length]).toEqual([1, 0, 0]);
            const asked = calls.requests()[0]!;
            expect(Object.keys(asked).sort()).toEqual(["from", "period", "run", "slice", "to"]);
            // The narrowing is the rail's: the jobs' source's, which holds the window the canvas wrote into it.
            expect([...asked.slice.keys()]).toEqual(["job"]);
            await press(eye(container));
        } finally {
            hold.release();
            rowsWindow.release();
        }
        await settle();
    });
});

describe("the landing, over jobs read a window at a time (#1343)", () => {
    test("a landing over jobs read a window at a time lands as ever: each bar the run placed marked for it, the banner counting them, the backlog's count flashing", async () => {
        const { container } = await h.mount(windowed);
        await waitFor(() => expect(backlogCount(container)).toBeGreaterThan(1), { timeout: 10_000 });
        // The run places every job of the backlog: more changes than one.
        const placed = backlogCount(container);
        await press(eye(container));
        await landed(container, placed);
        expect([...added(container)].every((el) => el.getAttribute("title")!.startsWith("Added by Elara · run #1"))).toBe(true);
        expect(words(banner(container, "done")!)[1]).toBe(`${placed} changes: ${placed} added. Undo or apply them like any edit.`);
        expect(container.querySelector('[data-plan-count="backlog"][data-opn]')).not.toBeNull();
    });
});

/**
 * The print works' jobs read a window at a time behind a rail narrowed to the coated stock, with the print works'
 * optimiser: the Plan reads the window's coated jobs alone, and holds none on another stock.
 */
const coated = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(Record.bind(events.planPrintPresses, []));
    const jobs = $.const(Record.bind(events.planPrintJobs, ["patch"]));
    const jobEntries = $.const(Data.bindPaged(events.planPrintJobs));
    const slice = $.const(Slice.bindRecords("optimise.coated", {
        job: {
            source: Data.bindPaged(events.planPrintJobs, { indexes: ["plan_print_jobs_by_time", "plan_print_jobs_by_stock_time"] }),
            fields: { stock: { label: "Stock" }, start: { label: "Dates" } }, range: "start", initial: { stock: ["coated"] },
        },
    }));
    const optimise = $.const(Func.bind(placePrintJobs));
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

describe("a job the Plan does not hold (rule 8)", () => {
    test("behind a rail narrowed to one stock, an answer that changes a job of the window on another has it read by its key, then lands as one edit; the request carries the narrowing, and Save commits the change", async () => {
        const { container } = await h.mount(coated);
        await waitFor(() => expect(container.querySelectorAll("[data-plan-body] [data-run]").length).toBeGreaterThan(0), { timeout: 10_000 });
        // The course handbook, on uncoated stock: no bar of the canvas.
        expect([...container.querySelectorAll("[data-plan-body] [data-run]")].some((el) => el.textContent?.includes("Course handbook"))).toBe(false);
        const text = printFor(StringType);
        const before = await h.read(events.planPrintJobs);
        const deployed = (await h.history(events.planPrintJobs)).commits.map((commit) => commit.mutation);
        const moved = { ...before.get("J-1004")!, start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T18:00:00Z")) };
        calls.answer({ events: { job: diffFor(opt.PrintJobs)(before, new Map([...before, ["J-1004", moved]])) } });
        const read = h.requests("rows", JOBS).length;
        await press(eye(container));
        await said(container, "done");
        const asked = calls.requests().at(-1)!;
        expect([...asked.slice.get("job")!].filter(([field]) => field === "stock").map(([field, by]) => [field, by.type, by.value]))
            .toEqual([["stock", "values", [printFor(events.PrintJob.fields.stock)(variant("coated", null))]]]);
        // Read by its key, in one read, between the answer and its landing.
        expect(h.requests("rows", JOBS).slice(read).filter((request) => readsRow(request, text("J-1004")))).toHaveLength(1);
        expect(words(banner(container, "done")!)[1]).toBe("1 change: 1 changed. Undo or apply them like any edit.");
        await press(history(container, editingMessages.apply()));
        await waitFor(async () => expect((await h.history(events.planPrintJobs)).commits.map((commit) => commit.mutation)).toEqual(["patch", ...deployed]), { timeout: 10_000 });
        expect(equalFor(events.PrintJob)((await h.read(events.planPrintJobs)).get("J-1004")!, moved)).toBe(true);
    });
});

/**
 * The print works' jobs on its presses and its crews' shifts on its crews, each kind read a window at a time through
 * its source's interval index, and no optimiser: one failed read of the event kinds' rows, and the kind it is of.
 */
const twoKinds = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.const(Record.bind(events.planPrintPresses, []));
    const crews = $.const(Record.bind(events.planPrintCrews, []));
    const jobs = $.const(Record.bind(events.planPrintJobs, ["patch"]));
    const shifts = $.const(Record.bind(events.planPrintShifts, ["patch"]));
    const jobEntries = $.const(Data.bindPaged(events.planPrintJobs));
    const shiftEntries = $.const(Data.bindPaged(events.planPrintShifts));
    const slice = $.const(Slice.bindRecords("optimise.two-kinds", {
        job: { source: Data.bindPaged(events.planPrintJobs, { indexes: ["plan_print_jobs_by_time"] }), fields: { start: { label: "Dates" } }, range: "start" },
        shift: { source: Data.bindPaged(events.planPrintShifts, { indexes: ["plan_print_shifts_by_time"] }), fields: { start: { label: "Dates" } }, range: "start" },
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

// The plan window in view, 5 Oct – 2 Nov 2026: its jobs, and one the optimiser adds.
optimiseCases<typeof events.PrintJob>({
    builder: "the Plan", h,
    mounted: async () => (await mounted()).container,
    record: events.planEventJobs,
    answer: (patch) => { calls.answer({ events: { job: patch as never } }); },
    add: ["J-3013", {
        title: "Menu cards", start: some(new Date("2026-10-12T06:00:00Z")), end: some(new Date("2026-10-12T10:00:00Z")), press: some("a3"),
        state: variant("confirmed", null), sheets: 32000.0, customer: "Copperleaf Cafe", stock: variant("board", null), due: none,
    }],
    // Store flyers, a day later on its press.
    change: ["J-3005", (job) => ({ ...job, start: some(new Date("2026-10-16T06:00:00Z")), end: some(new Date("2026-10-16T16:00:00Z")) })],
    remove: "J-3006",
    other: ["J-3002", (job) => ({ ...job, customer: "Elmway College · print room" })],
    // The week after the window.
    outside: { to: (job) => ({ ...job, start: some(new Date("2026-11-09T06:00:00Z")), end: some(new Date("2026-11-09T16:00:00Z")) }), named: "Store flyers" },
});
