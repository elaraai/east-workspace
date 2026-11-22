/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Optimise in the Calendar (#1409, #1417, east-workspace#1622; `Optimise
 * Spec.md` §9) on e3: the shop's optimiser is the example's own `e3.function`,
 * called by name on e3 once per run. The eye shows only with an optimiser
 * (R6); a click sends one call — the window, the kind of period it is, the
 * run's number and the rail's narrowing, and no row (R1, R24): the function
 * reads the jobs itself, the Calendar's unsaved edits laid over them as drafts
 * — and while it is out the eye runs, the footer counts, the history is locked
 * and nothing drags (R2); the answer's patch lands as one edit
 * (R7, R8): the backlog scheduled, each new event marked and named for the
 * run, the banner saying what changed, the Backlog count flashing — and one
 * Undo reverts it all, Redo replays the landing without the banner, Save
 * commits it with everything else (R9, R11). Stop and a period change ignore
 * a late answer (R3, R4); nothing to change and a failed call say so (R10).
 * What it does with any answer — one that inserts, updates and deletes, one
 * that replaces the whole Dict, one that moves a job out of the week, another
 * page's save while the call is out, a key another page takes, a job whose
 * title builds its key (east-workspace#1709, ruling 14), and the run's mark on
 * a job a person then retitles (ruling 16) — is the builders' shared cases
 * (`optimise-cases.test-utils.ts`), over the week's jobs. A job
 * of the week the rail narrows out, which the Calendar holds none of, is read
 * by its key before an answer that changes it lands (rule 8).
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, East, OptionType, StringType, diffFor, equalFor, none, printFor, some, variant } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { Calendar, Data, Func, Record } from "@elaraai/e3-ui";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import * as opt from "@elaraai/e3-ui/examples/calendar/optimise";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { readsRow } from "../e3-web.test-utils.js";
import { fitCalls } from "../shared/func/fit-calls.test-utils.js";
import { optimiseCases, typeInInspector } from "../shared/func/optimise-cases.test-utils.js";
import { eventKey } from "./model.js";
import "./index.js";

const h = e3Harness({ "calendar/calendar": ex, "calendar/optimise": opt }, { main: "data-calendar-main" });
const calls = fitCalls(h, { request: Calendar.Types.OptimiseRequest, result: opt.CalendarOptimiseResult });

async function press(node: Element | null) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
const eye = (c: HTMLElement) => c.querySelector<HTMLButtonElement>("[data-optimise-button]");
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const history = (c: HTMLElement, name: string) => toolbar(c).getByRole("button", { name });
const added = (c: HTMLElement) => c.querySelectorAll<HTMLElement>('[data-calendar-event][data-op="add"]');
/** Waits for a run's answer to land — e3 runs the optimiser's function for it, which takes its time. */
const landed = (c: HTMLElement, n: number) => waitFor(() => expect(added(c)).toHaveLength(n), { timeout: 10_000 });
/** Waits for a banner of a kind — the answer's, once e3 has given it. */
const said = (c: HTMLElement, kind: string) => waitFor(() => expect(banner(c, kind)).not.toBeNull(), { timeout: 10_000 });
const banner = (c: HTMLElement, kind: string) => c.querySelector<HTMLElement>(`[data-optimise-banner="${kind}"]`);
const words = (el: HTMLElement) => [el.querySelector("[data-banner-title]")!.textContent, el.querySelector("[data-banner-body]")!.textContent];
const line = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-calendar-footer] [data-footer-line]")!;
const lit = (c: HTMLElement) => c.querySelector("[data-calendar-frame]")!.hasAttribute("data-optimise-lit");
/** The window, as the eye names it: `Optimise {period}`. */
const period = (c: HTMLElement) => eye(c)!.getAttribute("aria-label")!.replace(/^Optimise /, "");
const commits = async () => (await h.history(ex.calendarJobs)).commits.map(commit => commit.mutation);

describe("the eye in the Calendar", () => {
    test("R6 — the eye shows for a Calendar with an optimiser, named for the window; a Calendar without one has none", async () => {
        const plain = await h.mount(ex.calendarOperations);
        expect(eye(plain.container)).toBeNull();
        plain.unmount();
        const { container } = await h.mount(opt.calendarOptimise);
        expect([eye(container)!.getAttribute("aria-label")!.startsWith("Optimise "), eye(container)!.disabled, eye(container)!.hasAttribute("data-running")]).toEqual([true, false, false]);
        // Immediately before the history item.
        const items = [...slot(container, "toolbar").querySelectorAll("[data-toolbar-item]")].map(el => el.getAttribute("data-toolbar-item"));
        expect(items.indexOf("history") - items.indexOf("optimise")).toBe(1);
    });

    test("R1, R2, R24 — one call asking the window, its kind, the run's number and the rail's narrowing, and no row; the lock while it is out", async () => {
        const { container } = await h.mount(opt.calendarOptimise);
        const at = period(container);
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        expect([eye(container)!.hasAttribute("data-running"), eye(container)!.getAttribute("aria-label")]).toEqual([true, "Stop optimising"]);
        expect([line(container).getAttribute("data-loading-line"), line(container).querySelector("[data-line-text]")!.textContent]).toEqual(["busy", `Optimising ${at}`]);
        for (const name of [editingMessages.undo(), editingMessages.redo(), editingMessages.discard(), editingMessages.apply()]) {
            expect(history(container, name).getAttribute("aria-disabled")).toBe("true");
        }
        expect(container.querySelector("[data-draggable]")).toBeNull();
        expect(calls.requests()).toHaveLength(1);
        const asked = calls.requests()[0]!;
        // The request names the period and carries no row: its fields are the window, its kind, the run and the narrowing.
        expect(Object.keys(asked).sort()).toEqual(["from", "period", "run", "slice", "to"]);
        expect([asked.run, asked.period.type, asked.slice.size]).toEqual([1n, "week", 0]);
        expect([asked.from.getTime(), asked.to.getTime()]).toEqual([new Date("2026-09-28T00:00:00Z").getTime(), new Date("2026-10-05T00:00:00Z").getTime()]);
        hold.release();
        await landed(container, 4);
        expect([eye(container)!.hasAttribute("data-running"), line(container).hasAttribute("data-idle")]).toEqual([false, true]);
        expect(container.querySelector("[data-draggable]")).not.toBeNull();
    });

    test("R7–R9, R11 — the result lands as one edit: the backlog scheduled and marked, the banner and the legend for the highlight; one Undo reverts it, Redo replays it without the banner, Save commits it as one patch", async () => {
        const { container } = await h.mount(opt.calendarOptimise);
        const deployed = await commits();
        await press(eye(container));
        await landed(container, 4);
        const at = period(container);
        expect([...added(container)].every(el => el.getAttribute("title")!.startsWith("Added by Elara · run #1"))).toBe(true);
        expect(words(banner(container, "done")!)).toEqual([`Elara optimised ${at}`, "4 changes: 4 added. Undo or apply them like any edit."]);
        expect([lit(container), container.querySelector("[data-calendar-footer] [data-optimise-legend]")?.textContent]).toEqual([true, "Elara change"]);
        // The Backlog is empty, its count flashing; the day heads the run filled flash too.
        expect(within(slot(container, "start")).getByRole("tab", { name: /^Backlog/ }).textContent).toBe("Backlog 0");
        expect(slot(container, "start").querySelector("[data-tab-count][data-opn]")).not.toBeNull();
        expect(container.querySelectorAll("[data-calendar-day-count][data-opn]").length).toBeGreaterThan(0);
        // One step: one Undo takes the whole run back, and ends its highlight and its banner.
        await press(history(container, editingMessages.undo()));
        expect([added(container).length, lit(container)]).toEqual([0, false]);
        expect(within(slot(container, "start")).getByRole("tab", { name: /^Backlog/ }).textContent).toBe("Backlog 4");
        await waitFor(() => expect(container.querySelector("[data-optimise-banner]:not([data-leaving])")).toBeNull());
        // Redo re-inserts it and replays the landing, without the banner — the Undo's may still be collapsing.
        await press(history(container, editingMessages.redo()));
        await landed(container, 4);
        await waitFor(() => expect(lit(container)).toBe(true));
        expect(container.querySelector('[data-optimise-banner="done"]:not([data-leaving])')).toBeNull();
        // Save commits the run with everything else, as one patch; nothing is marked once nothing is pending.
        await press(history(container, editingMessages.apply()));
        await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]));
        await waitFor(() => expect(container.querySelectorAll("[data-op]")).toHaveLength(0));
        const jobs = await h.read(ex.calendarJobs);
        expect(["backlog1", "backlog2", "backlog3", "backlog4"].every(key => jobs.get(key)!.start.type === "some")).toBe(true);
        expect([lit(container), container.querySelector("[data-optimise-banner]")]).toEqual([false, null]);
    });

    test("R3 — Stop cancels the call: the footer says so, a late answer is ignored, and nothing is recorded", async () => {
        const { container } = await h.mount(opt.calendarOptimise);
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

    test("R4 — a change of period stops the run as Stop does", async () => {
        const { container } = await h.mount(opt.calendarOptimise);
        const hold = calls.hold();
        await press(eye(container));
        await hold.holding;
        await press(toolbar(container).getByRole("button", { name: /^Next (day|week|month)$/ }));
        expect([eye(container)!.hasAttribute("data-running"), line(container).getAttribute("data-loading-line")]).toEqual([false, "note"]);
        hold.release();
        await settle();
        expect([calls.requests().length, container.querySelectorAll("[data-op]").length]).toEqual([1, 0]);
    });

    test("R10 — a result that changes nothing is said so, the eye blinking; a failed call is an alert until the next run", async () => {
        const { container } = await h.mount(opt.calendarOptimise);
        await press(eye(container));
        await landed(container, 4);
        // The drafts are the next run's input (O5), sent with the call and laid over the jobs as the function reads them
        // (east-workspace#1622): with every job scheduled there, the optimiser changes nothing.
        // The blink lasts 560ms, which a slow machine can spend before the banner is read: what it did is watched.
        let blinked = false;
        const watching = new MutationObserver(() => { blinked ||= eye(container)!.hasAttribute("data-blink"); });
        watching.observe(container, { subtree: true, attributes: true, attributeFilter: ["data-blink"] });
        await press(eye(container));
        await said(container, "none");
        watching.disconnect();
        expect(words(banner(container, "none")!)).toEqual(["No changes", `Elara found nothing to improve in ${period(container)}.`]);
        expect([banner(container, "none")!.querySelector("[role=status]") !== null, blinked, calls.requests().length]).toEqual([true, true, 2]);
        expect(added(container)).toHaveLength(4);
        const restore = calls.fail();
        await press(eye(container));
        await said(container, "fail");
        expect(words(banner(container, "fail")!)).toEqual([`Couldn't optimise ${period(container)}`, "Nothing changed. Run it again from the eye."]);
        expect([banner(container, "fail")!.querySelector("[role=alert]") !== null, added(container).length]).toEqual([true, 4]);
        restore();
    });
});

describe("the period a run is asked of (rule 1)", () => {
    const instant = printFor(DateTimeType);
    test("each view's request names the window in view and its kind: the week, the day and the month of the Calendar layout — a month's grid its whole weeks — a day on Resources whatever its period, and the Timeline's month itself", async () => {
        const { container } = await h.mount(opt.calendarOptimise);
        const view = (name: string) => press(toolbar(container).getByRole("radio", { name }));
        /** A run's request from the view as it stands: its call held on its way, its question read, and the run stopped. */
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
        // The week of Thu 1 Oct 2026, from its Monday.
        expect(await asked()).toEqual(["week", "2026-09-28T00:00:00.000", "2026-10-05T00:00:00.000"]);
        await view("Day");
        expect(await asked()).toEqual(["day", "2026-10-01T00:00:00.000", "2026-10-02T00:00:00.000"]);
        // The month's grid shows whole weeks, the days of September and November among them: the window is what it shows.
        await view("Month");
        expect(await asked()).toEqual(["month", "2026-09-28T00:00:00.000", "2026-11-02T00:00:00.000"]);
        // Resources shows a day, whatever period the Calendar layout holds.
        await view("Resources");
        expect(await asked()).toEqual(["day", "2026-10-01T00:00:00.000", "2026-10-02T00:00:00.000"]);
        // The Timeline shows the period itself: October.
        await view("Timeline");
        expect(await asked()).toEqual(["month", "2026-10-01T00:00:00.000", "2026-11-01T00:00:00.000"]);
    });
});

/**
 * The shop's jobs through a rail narrowed to the first press's, with the shop's optimiser: the Calendar reads the week's
 * jobs on that press alone, and holds none of another machine's.
 */
const narrowed = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const machines = $.let(Record.bind(ex.calendarMachines, []));
    const jobs = $.let(Record.bind(ex.calendarJobs, ["patch"]));
    const entries = $.let(Data.bindPaged(ex.calendarJobs));
    const slice = $.let(Slice.bindRecords("test.calendarOptimiseNarrowed", {
        job: {
            source: Data.bindPaged(ex.calendarJobs, { indexes: ["calendar_jobs_by_time", "calendar_jobs_by_machine_time"] }),
            fields: { machine: { label: "Machine", hints: ["press1", "press2", "lathe1", "lathe2", null] }, start: { label: "Dates" } }, range: "start",
            initial: { machine: ["press1"] },
        },
    }));
    const optimise = $.let(Func.bind(opt.scheduleBacklog));
    return Calendar({
        view: { period: "week", date: new Date("2026-10-01T00:00:00Z") }, now: new Date("2026-10-01T10:15:00Z"), slice: { slice }, optimise,
        resources: { machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: (row) => row.name }) },
        events: {
            job: Calendar.events(jobs, {
                name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" }, entries,
                backlog: { duration: (row) => variant("hours", row.hours), due: (row) => row.due },
            }),
        },
    });
}))) };

describe("a job the Calendar does not hold (rule 8)", () => {
    test("behind a rail narrowed to one machine, an answer that changes another machine's job of the week has it read by its key, then lands as one edit; the request carries the narrowing, and Save commits the change", async () => {
        const { container } = await h.mount(narrowed);
        await waitFor(() => expect(container.querySelector('[data-calendar-event]')).not.toBeNull(), { timeout: 10_000 });
        // The pump housings, on the first lathe: no event of the board.
        expect([...container.querySelectorAll("[data-calendar-event]")].some(el => el.textContent?.includes("Pump housings"))).toBe(false);
        const text = printFor(StringType);
        const before = await h.read(ex.calendarJobs);
        const deployed = await commits();
        const moved = { ...before.get("job2")!, start: some(new Date("2026-10-02T08:00:00Z")), end: some(new Date("2026-10-02T13:00:00Z")) };
        calls.answer({ events: { job: diffFor(opt.CalendarJobs)(before, new Map([...before, ["job2", moved]])) } });
        const read = h.requests("rows", `records.${ex.calendarJobs.name}`).length;
        await press(eye(container));
        await said(container, "done");
        const asked = calls.requests()[0]!;
        expect([...asked.slice.get("job")!].filter(([field]) => field === "machine").map(([field, by]) => [field, by.type, by.value])).toEqual([["machine", "values", [printFor(OptionType(StringType))(some("press1"))]]]);
        // Read by its key, in one read, between the answer and its landing.
        expect(h.requests("rows", `records.${ex.calendarJobs.name}`).slice(read).filter(request => readsRow(request, text("job2")))).toHaveLength(1);
        expect(words(banner(container, "done")!)[1]).toBe("1 change: 1 changed. Undo or apply them like any edit.");
        await press(history(container, editingMessages.apply()));
        await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]), { timeout: 10_000 });
        expect(equalFor(ex.CalendarJob)((await h.read(ex.calendarJobs)).get("job2")!, moved)).toBe(true);
    });
});

/**
 * The shop's jobs with its optimiser, each keyed by the key its title builds (`key`, east-workspace#1709), and the
 * inspector a person renames a job in.
 */
const keyedJobs = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const machines = $.let(Record.bind(ex.calendarMachines, []));
    const jobs = $.let(Record.bind(ex.calendarJobs));
    const optimise = $.let(Func.bind(opt.scheduleBacklog));
    return Calendar({
        inspector: true,
        view: { period: "week", date: new Date("2026-10-01T00:00:00Z") }, now: opt.SHOP_NOW, optimise,
        resources: { machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: (row) => row.name }) },
        events: {
            job: Calendar.events(jobs, {
                name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
                backlog: { duration: (row) => variant("hours", row.hours), due: (row) => row.due }, key: (row) => row.title,
            }),
        },
    });
}))) };
/** A job's event on the board, by its key. */
const jobEvent = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-calendar-event=${JSON.stringify(eventKey({ kind: "job", key }))}]`);

// The week in view, Mon 28 Sep – Sun 4 Oct 2026: its jobs, and one the optimiser adds.
optimiseCases<typeof ex.CalendarJob>({
    builder: "the Calendar", h,
    mounted: async () => (await h.mount(opt.calendarOptimise)).container,
    record: ex.calendarJobs,
    answer: (patch) => { calls.answer({ events: { job: patch as never } }); },
    add: ["elara-gear-blanks", {
        title: "Gear blanks", start: some(new Date("2026-10-02T13:00:00Z")), end: some(new Date("2026-10-02T15:00:00Z")), machine: some("lathe1"),
        status: variant("planned", null), hours: 2.0, customer: "Alder Works", due: none,
    }],
    // Bearing collars, an hour later on its lathe.
    change: ["job4", (job) => ({ ...job, start: some(new Date("2026-10-02T10:00:00Z")), end: some(new Date("2026-10-02T13:00:00Z")) })],
    remove: "job3",
    other: ["job2", (job) => ({ ...job, customer: "Birch Engineering · north works" })],
    // The Monday after the week in view.
    outside: { to: (job) => ({ ...job, start: some(new Date("2026-10-12T09:00:00Z")), end: some(new Date("2026-10-12T12:00:00Z")) }), named: "Bearing collars" },
    // A job the answer gives a new title stands under it; one given another job's key is refused.
    keyed: {
        mounted: async () => (await h.mount(keyedJobs)).container,
        move: ["job4", (job) => ({ ...job, title: "Collars" }), "Collars"],
        taken: [(job) => ({ ...job, title: "job2" }), 'Another production is keyed "job2" already'],
        op: (c, key) => jobEvent(c, key)?.getAttribute("data-op") ?? undefined,
        another: "job2",
        drawn: (c, key) => jobEvent(c, key) !== null,
        // The job's title typed in the inspector.
        rename: (c, key, to) => typeInInspector(c, jobEvent(c, key), "title", to),
    },
});
