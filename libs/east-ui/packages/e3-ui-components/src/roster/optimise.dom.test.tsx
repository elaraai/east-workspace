/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Optimise in the Roster (#1409, #1421, east-workspace#1622; `Optimise
 * Spec.md` §9) on e3: the warehouse's optimiser is the example's own
 * `e3.function`, called by name on e3 once per run. The eye shows only with an
 * optimiser, as tall as the toolbar's other controls, between the issues item
 * and the history item, and only where the period in view can be optimised —
 * never over a period that takes no edit, a month holding a published week
 * among them (R6); a click sends one call — the period in view, its kind, the
 * run's number and the rail's narrowing, and no row (R1, R23): the function
 * reads the duties, the targets and the staff itself, the Roster's unsaved
 * edits laid over them as drafts — and while it is out the eye runs, the
 * footer counts, the history is locked, nothing drags and every control of the
 * week stays in place, inert (R2); the answer's patch lands as one edit (R7,
 * R8): every slot short of its heads filled, each new duty marked and named
 * for the run on the Shifts chips and the People tiles alike, the banner
 * saying what changed, the changed people's hours and the issues item flashing
 * — and one Undo reverts it all, Redo replays the landing without the banner,
 * Save commits it with everything else (R9, R11). Stop and a week change
 * ignore a late answer (R3, R4); nothing to change and a failed call say so
 * (R10). Below 480px the eye is in the toolbar still, and the landing is on
 * the cards (R27); at a phone's toolbar floor it is the View's entry — named
 * for the week, a run and its Stop from there, and on while a week's reads are
 * in flight, which it waits on none of (ruled 27 Oct 2026, "Into the View
 * menu"). What it does with any answer — one that inserts, updates and
 * deletes, one that replaces the whole Dict, one that moves a duty out of the
 * week, another page's save while the call is out, a key another page takes —
 * is the builders' shared cases (`optimise-cases.test-utils.ts`), over the
 * week's duties.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, decodeBeast2For, diffFor, encodeBeast2For, printFor, some, variant } from "@elaraai/east";
import { editingMessages, optimiseMessages } from "@elaraai/east-ui-components";
import { Roster } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import * as opt from "@elaraai/e3-ui/examples/roster/optimise";
import type { E3Request } from "../e3-web.test-utils.js";
import { fitCalls } from "../shared/func/fit-calls.test-utils.js";
import { optimiseCases } from "../shared/func/optimise-cases.test-utils.js";
import { START, act, at, history, rosterHarness, settle, slot, toolbarAtFloor, weekDuties, width } from "./harness.test-utils.js";

const h = rosterHarness({ "roster/optimise": opt });
const calls = fitCalls(h, { request: Roster.Types.OptimiseRequest(), result: Roster.Types.OptimiseResult(opt.WarehouseDuties) });
/** The warehouse's optimiser, by its `e3.function` name: the calls the eye makes, apart from any fit's. */
const RUN = "rota_optimise";
const DAY = 86_400_000;

async function press(node: Element | null) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
const eye = (c: HTMLElement) => c.querySelector<HTMLButtonElement>("[data-optimise-button]");
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const marked = (c: HTMLElement, op: string) => c.querySelectorAll<HTMLElement>(`[data-roster-assignment][data-op="${op}"]`);
/** Waits for a banner of a kind — the answer's, once e3 has given it. */
const said = (c: HTMLElement, kind: string) => waitFor(() => expect(banner(c, kind)).not.toBeNull(), { timeout: 10_000 });
const banner = (c: HTMLElement, kind: string) => c.querySelector<HTMLElement>(`[data-optimise-banner="${kind}"]`);
const words = (el: HTMLElement) => [el.querySelector("[data-banner-title]")!.textContent, el.querySelector("[data-banner-body]")!.textContent];
const line = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-roster-footer] [data-footer-line]")!;
/**
 * Every state the footer's line takes from now on — `idle` with none — watched as the DOM moves: a note that shows and
 * goes again (2.5 s) while a view's rows mount on a slow machine is still seen.
 */
function lineStates(c: HTMLElement): { seen: Set<string>; stop: () => void } {
    const seen = new Set<string>();
    const note = () => seen.add(line(c)?.getAttribute("data-loading-line") ?? "idle");
    const observer = new MutationObserver(note);
    observer.observe(c, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-loading-line"] });
    note();
    return { seen, stop: () => observer.disconnect() };
}
/**
 * Whether the eye blinks from now on, watched as the DOM moves: its one blink (560 ms) is still seen when the answer's
 * banner lands after it has gone again on a slow machine — an attribute that came and went before the observer heard
 * of it by the old value its removal leaves.
 */
function blinks(c: HTMLElement): { seen: () => boolean; stop: () => void } {
    let seen = false;
    const note = (records: readonly MutationRecord[] = []) => {
        if (eye(c)?.hasAttribute("data-blink") === true || records.some(record => record.oldValue !== null)) seen = true;
    };
    const observer = new MutationObserver(note);
    observer.observe(c, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-blink"], attributeOldValue: true });
    note();
    return { seen: () => seen, stop: () => observer.disconnect() };
}
/**
 * Whether a landing draws what `holds` looks for, watched from now on as the DOM moves: the highlight lasts 8 s from the
 * landing, which a slow machine can spend before the test looks, so what it draws is looked at as it lands.
 */
function lands(c: HTMLElement, holds: () => boolean): { seen: () => boolean; stop: () => void } {
    let seen = false;
    const note = () => { if (holds()) seen = true; };
    const observer = new MutationObserver(note);
    observer.observe(c, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-optimise-lit", "data-opn", "data-op"] });
    note();
    return { seen: () => seen, stop: () => observer.disconnect() };
}
const lit =(c: HTMLElement) => c.querySelector("[data-roster-frame]")!.hasAttribute("data-optimise-lit");
/** The week, as the eye names it: `Optimise W10`. */
const period = (c: HTMLElement) => eye(c)!.getAttribute("aria-label")!.replace(/^Optimise /, "");
/** What a week not read yet waits on: a page, a key search, or runs or rows by key, of the duties or of the weeks. */
const WEEK_READS = new Set(["page", "find", "runs", "rows"]);
const weekRead = (request: E3Request) => WEEK_READS.has(request.kind)
    && (request.dataset === `records.${ex.rosterDuties.name}` || request.dataset === `records.${ex.rosterWeeks.name}`);
/** Presses a key on the board, as the frame hears it: `]` steps the week. */
async function key(c: HTMLElement, k: string) { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: k }); }); await settle(); }
/** Opens the toolbar's View, and finds the eye's entry in it, as it is drawn at each look. */
async function viewEntry(c: HTMLElement): Promise<() => HTMLButtonElement> {
    await press(toolbar(c).getByRole("button", { name: "View" }));
    const view = within(document.body).getByRole("dialog");
    const entry = () => view.querySelector<HTMLButtonElement>("[data-optimise-entry]")!;
    expect(entry()).not.toBeNull();
    return entry;
}
const commits = async () => (await h.history(ex.rosterDuties)).commits.map(commit => commit.mutation);
/** The Roster with its optimiser, its week read: the eye is enabled once the week's duties have landed. */
async function mounted() {
    const { container } = await h.mount(opt.rosterOptimise);
    await waitFor(() => expect(eye(container)?.disabled).toBe(false), { timeout: 10_000 });
    return container;
}
/** The duties the latest answer added — the rows its patch inserts — by key, each with the day of the week it falls on. */
function added(): Map<string, number> {
    const asked = calls.requests(RUN).at(-1)!, answered = calls.answers(RUN).at(-1)!.duties;
    const out = new Map<string, number>();
    if (answered.type !== "patch") return out;
    for (const [key, change] of answered.value) {
        if (change.type === "insert") out.set(key, Math.floor((change.value.start.getTime() - asked.from.getTime()) / DAY));
    }
    return out;
}
/** The Shifts layout on a day of the week: its chips are every duty of the day's slots. */
async function shiftsDay(c: HTMLElement, day: number) {
    await press(toolbar(c).getByRole("radio", { name: "Shifts" }));
    await press(within(toolbar(c).getByRole("radiogroup", { name: "Day of week" })).getAllByRole("radio")[day]!);
}
/** A run landed over the week: its answer in, and its banner up. */
async function landed(c: HTMLElement) {
    await press(eye(c));
    await said(c, "done");
    const adds = added();
    expect(adds.size).toBeGreaterThan(0);
    // The day with the most new duties: where the Shifts chips are counted.
    const byDay = new Map<number, number>();
    for (const day of adds.values()) byDay.set(day, (byDay.get(day) ?? 0) + 1);
    const day = [...byDay].sort((a, b) => b[1] - a[1])[0]![0];
    return { adds, day, onDay: byDay.get(day)! };
}

describe("the eye in the Roster", () => {
    test("R6 — the eye shows for a Roster with an optimiser, named for the week, at the toolbar's size with a 14px mark, between the issues item and the history item; a Roster without one has none", async () => {
        const plain = await h.mount(ex.rosterWarehouse);
        expect(eye(plain.container)).toBeNull();
        plain.unmount();
        const container = await mounted();
        expect([eye(container)!.getAttribute("aria-label")!.startsWith("Optimise W"), eye(container)!.hasAttribute("data-running"), eye(container)!.getAttribute("data-size"),
            eye(container)!.querySelector('[data-eye-size="14"]') !== null]).toEqual([true, false, "toolbar", true]);
        const items = [...slot(container, "toolbar").querySelectorAll("[data-toolbar-item]")].map(el => el.getAttribute("data-toolbar-item"));
        expect(items.indexOf("history") - items.indexOf("optimise")).toBe(1);
        expect(items.indexOf("optimise")).toBeGreaterThan(items.indexOf("roster.issues"));
    });

    test("R6 — a month holding a published week lists no eye: a run plans every week in view, and a published one takes no change; Week lists it again, and a run out as Month opens stops", async () => {
        const container = await mounted();
        const week = period(container);
        const hold = calls.hold(RUN);
        await press(eye(container));
        await hold.holding;
        // The run stops as Month opens, and the footer says so — a note that may have gone again by the time the month's
        // rows have mounted: what the line said along the way is what is checked.
        const states = lineStates(container);
        await press(toolbar(container).getByRole("radio", { name: "Month" }));
        await waitFor(() => expect(eye(container)).toBeNull());
        states.stop();
        expect(states.seen.has("note")).toBe(true);
        hold.release();
        await settle();
        expect([calls.requests(RUN).length, container.querySelectorAll("[data-op]").length]).toEqual([1, 0]);
        // The week's column opens it in Week again (#1406, P3): the eye is listed again — Month's own Week radio may
        // open an earlier, published week of the month, which lists none.
        await press([...container.querySelectorAll<HTMLElement>("[data-roster-week-column]")].find(column => column.textContent?.includes(week) === true) ?? null);
        await waitFor(() => expect(eye(container)?.disabled).toBe(false), { timeout: 10_000 });
    });

    test("R1, R2, R23 — one call asking the week, its kind, the run's number and the rail's narrowing, and no row; the lock while it is out", async () => {
        const container = await mounted();
        await press(toolbar(container).getByRole("radio", { name: "People" }));
        const week = period(container);
        const hold = calls.hold(RUN);
        await press(eye(container));
        await hold.holding;
        expect([eye(container)!.hasAttribute("data-running"), eye(container)!.getAttribute("aria-label")]).toEqual([true, "Stop optimising"]);
        expect([line(container).getAttribute("data-loading-line"), line(container).querySelector("[data-line-text]")!.textContent]).toEqual(["busy", `Optimising ${week}`]);
        for (const name of [editingMessages.undo(), editingMessages.redo(), editingMessages.discard(), editingMessages.apply()]) {
            expect(history(container, name).getAttribute("aria-disabled")).toBe("true");
        }
        expect(container.querySelector("[data-draggable]")).toBeNull();
        // The week's controls stay in place, inert (R2): a day off keeps its `+ Assign`, disabled and saying why, never the
        // `Off` of a week with no edit.
        const assigns = () => [...container.querySelectorAll<HTMLButtonElement>("[data-roster-assign]")];
        expect(assigns().length).toBeGreaterThan(0);
        expect(assigns().every(button => button.disabled && button.title === `Elara is optimising ${week}`)).toBe(true);
        expect([...container.querySelectorAll("[data-roster-person-day]")].some(cell => cell.textContent === "Off")).toBe(false);
        expect(calls.requests(RUN)).toHaveLength(1);
        const asked = calls.requests(RUN)[0]!;
        // The request names the week and carries no row: no duty, no target, nothing of the staff or the configuration.
        expect(Object.keys(asked).sort()).toEqual(["from", "period", "run", "slice", "to"]);
        expect([asked.run, asked.from.getTime(), asked.to.getTime(), asked.period.type])
            .toEqual([1n, START.getTime(), at("2028-03-12T00:00:00").getTime(), "week"]);
        hold.release();
        await said(container, "done");
        expect([eye(container)!.hasAttribute("data-running"), line(container).hasAttribute("data-idle")]).toEqual([false, true]);
        expect(container.querySelector("[data-draggable]")).not.toBeNull();
        expect(assigns().every(button => !button.disabled && button.title === "")).toBe(true);
    });

    test("R7–R9, R11, R23 — the result lands as one edit: the open slots filled and marked on the Shifts chips and the People tiles alike, the banner and the legend for the highlight, the hours and the issues item flashing; one Undo reverts it, Redo replays it without the banner, Save commits it as one patch", async () => {
        const container = await mounted();
        const deployed = await commits();
        const { adds, day, onDay } = await landed(container);
        const week = period(container);
        expect(words(banner(container, "done")!)).toEqual([`Elara optimised ${week}`, `${adds.size} changes: ${adds.size} added. Undo or apply them like any edit.`]);
        expect([lit(container), container.querySelector("[data-roster-footer] [data-optimise-legend]")?.textContent]).toEqual([true, "Elara change"]);
        expect(container.querySelector("[data-roster-issues][data-opn]")).not.toBeNull();
        // The Shifts chips of the day the run filled most: each new duty's, marked and named for the run, its own fill kept.
        await shiftsDay(container, day);
        const chips = marked(container, "add");
        expect(chips).toHaveLength(onDay);
        expect([...chips].every(el => el.getAttribute("data-layout") === "shifts" && el.getAttribute("data-fill") === "own" && el.getAttribute("title")!.startsWith("Added by Elara · run #1 · "))).toBe(true);
        // Its person's week in People: the tile marked alike — the duty selected first, so its person's row is brought
        // into view.
        const [id] = [...adds].find(([, d]) => d === day)!;
        await press(container.querySelector(`[data-roster-assignment="${id}"]`));
        await press(toolbar(container).getByRole("radio", { name: "People" }));
        // Its person's row may stand below the rows the grid has mounted: scrolled to, as a reader would.
        const tileOf = () => container.querySelector<HTMLElement>(`[data-roster-tile][data-roster-assignment="${id}"]`);
        const scroller = container.querySelector<HTMLElement>("[data-virtual-rows]")!;
        for (let i = 1; i <= 40 && tileOf() === null; i++) { await act(async () => { scroller.scrollTop = i * 3 * 36; fireEvent.scroll(scroller); }); await settle(); }
        const tile = await waitFor(() => { const el = tileOf(); expect(el).not.toBeNull(); return el!; });
        expect([tile.getAttribute("data-op"), tile.getAttribute("data-fill"), tile.getAttribute("title")!.startsWith("Added by Elara · run #1 · ")]).toEqual(["add", "own", true]);
        // One step: one Undo takes the whole run back, and ends its highlight and its banner.
        await press(history(container, editingMessages.undo()));
        expect([container.querySelectorAll("[data-op]").length, lit(container)]).toEqual([0, false]);
        await waitFor(() => expect(container.querySelector("[data-optimise-banner]:not([data-leaving])")).toBeNull());
        // Redo re-inserts it and replays the landing, without the banner — the Undo's may still be collapsing: lit, its
        // person's hours flashing in their row, in view now. The way to the row took the first landing's 8 s on a slow
        // machine; this one is watched as it lands.
        const relit = lands(container, () => lit(container) && (tileOf()?.closest("[data-roster-person-row]")?.querySelector("[data-roster-week-hours][data-opn]") ?? null) !== null);
        await press(history(container, editingMessages.redo()));
        await waitFor(() => expect(container.querySelector(`[data-roster-tile][data-roster-assignment="${id}"][data-op="add"]`)).not.toBeNull(), { timeout: 10_000 });
        await waitFor(() => expect(relit.seen()).toBe(true));
        relit.stop();
        expect(container.querySelector('[data-optimise-banner="done"]:not([data-leaving])')).toBeNull();
        // Save commits the run with everything else, as one patch; nothing is marked once nothing is pending.
        await press(history(container, editingMessages.apply()));
        await waitFor(async () => expect(await commits()).toEqual(["patch", ...deployed]));
        await waitFor(() => expect(container.querySelectorAll("[data-op]")).toHaveLength(0));
        const duties = await h.read(ex.rosterDuties);
        expect([...adds.keys()].every(key => duties.has(key))).toBe(true);
        expect([lit(container), container.querySelector("[data-optimise-banner]")]).toEqual([false, null]);
    });

    test("R3 — Stop cancels the call: the footer says so, a late answer is ignored, and nothing is recorded", async () => {
        const container = await mounted();
        const hold = calls.hold(RUN);
        await press(eye(container));
        await hold.holding;
        await press(eye(container));
        expect([eye(container)!.hasAttribute("data-running"), line(container).getAttribute("data-loading-line"), line(container).querySelector("[data-line-text]")!.textContent])
            .toEqual([false, "note", "Stopped · nothing changed"]);
        hold.release();
        await settle();
        expect([calls.requests(RUN).length, container.querySelectorAll("[data-op]").length, container.querySelector("[data-optimise-banner]")]).toEqual([1, 0, null]);
        expect((history(container, editingMessages.apply()) as HTMLButtonElement).disabled).toBe(true);
    });

    test("R4 — a step to another week stops the run as Stop does", async () => {
        const container = await mounted();
        const hold = calls.hold(RUN);
        await press(eye(container));
        await hold.holding;
        await press(toolbar(container).getByRole("button", { name: "Next week" }));
        expect([eye(container)!.hasAttribute("data-running"), line(container).getAttribute("data-loading-line")]).toEqual([false, "note"]);
        hold.release();
        await settle();
        expect([calls.requests(RUN).length, container.querySelectorAll("[data-op]").length]).toEqual([1, 0]);
    });

    test("R10 — a result that changes nothing is said so, the eye blinking; a failed call is an alert until the next run", async () => {
        const container = await mounted();
        const { adds } = await landed(container);
        // The drafts are the next run's input (O5): with every slot filled, the optimiser changes nothing. The eye's one
        // blink is watched from the press on: on a slow machine the banner can land after it has gone again.
        const blink = blinks(container);
        await press(eye(container));
        await said(container, "none");
        blink.stop();
        expect(words(banner(container, "none")!)).toEqual(["No changes", `Elara found nothing to improve in ${period(container)}.`]);
        expect([banner(container, "none")!.querySelector("[role=status]") !== null, blink.seen(), calls.requests(RUN).length]).toEqual([true, true, 2]);
        const restore = calls.fail(RUN);
        await press(eye(container));
        await said(container, "fail");
        expect(words(banner(container, "fail")!)).toEqual([`Couldn't optimise ${period(container)}`, "Nothing changed. Run it again from the eye."]);
        expect([banner(container, "fail")!.querySelector("[role=alert]") !== null, calls.requests(RUN).length, adds.size > 0]).toEqual([true, 3, true]);
        restore();
    });

    test("R27 — below 480px the eye is in the toolbar still, and the landing is on the day's cards", async () => {
        const container = await mounted();
        const { day, onDay } = await landed(container);
        await shiftsDay(container, day);
        await width(400);
        await waitFor(() => expect(container.querySelector("[data-roster-agenda]")).not.toBeNull());
        expect(eye(container)).not.toBeNull();
        const cards = () => container.querySelectorAll<HTMLElement>('[data-roster-card][data-op="add"]');
        expect(cards()).toHaveLength(onDay);
        expect([cards()[0]!.getAttribute("title"), cards()[0]!.getAttribute("data-fill")]).toEqual(["Added by Elara · run #1", "own"]);
        // The highlight over them, as a landing replayed here lights it: it lasts 8 s from the landing, which a slow
        // machine can spend narrowing the page, so it is watched as the Redo lands it.
        await press(history(container, editingMessages.undo()));
        const relit = lands(container, () => lit(container) && cards().length === onDay);
        await press(history(container, editingMessages.redo()));
        await waitFor(() => expect(relit.seen()).toBe(true));
        relit.stop();
    });

    test("R27 — at a phone's toolbar floor the eye is the View's entry, never out of the toolbar: named for the week, a run and its Stop from there, and on while a week's reads are in flight — it waits on none of them (ruled 27 Oct 2026, \"Into the View menu\")", async () => {
        const container = await mounted();
        const week = period(container);
        await toolbarAtFloor();
        // No eye in the row — the history's Save is — and the View lists it in its place.
        expect([eye(container), history(container, editingMessages.apply()) !== null]).toEqual([null, true]);
        const entry = await viewEntry(container);
        expect([entry().getAttribute("aria-label"), entry().textContent, entry().disabled]).toEqual([`Optimise ${week}`, `Optimise ${week}`, false]);
        // A run from it: one call over the week, the footer's line saying so, the entry its Stop.
        const hold = calls.hold(RUN);
        await press(entry());
        await hold.holding;
        expect([line(container).getAttribute("data-loading-line"), line(container).querySelector("[data-line-text]")!.textContent]).toEqual(["busy", `Optimising ${week}`]);
        expect([entry().getAttribute("aria-label"), entry().textContent, entry().hasAttribute("data-running")]).toEqual(["Stop optimising", "Stop optimising", true]);
        // Stop from it: the run over, the line saying so, a late answer ignored and nothing recorded.
        await press(entry());
        expect([entry().getAttribute("aria-label"), line(container).getAttribute("data-loading-line")]).toEqual([`Optimise ${week}`, "note"]);
        hold.release();
        await settle();
        expect([calls.requests(RUN).length, container.querySelectorAll("[data-op]").length, container.querySelector("[data-optimise-banner]")]).toEqual([1, 0, null]);
        await act(async () => { fireEvent.keyDown(within(document.body).getByRole("dialog"), { key: "Escape" }); });
        await settle();
        // Two weeks on, the second's reads held — the first read ahead: the entry is on still, named for that week. The
        // request carries no row, so a run waits on none of the week's reads (east-workspace#1622).
        const held = h.e3.hold(weekRead);
        await key(container, "]");
        await key(container, "]");
        const on = await viewEntry(container);
        expect([on().disabled, on().getAttribute("aria-label")?.startsWith("Optimise W"), on().querySelector("[data-entry-reason]")]).toEqual([false, true, null]);
        await act(async () => { held.release(); });
        await settle();
    });
});

describe("the period a run is asked of (rule 1)", () => {
    const instant = printFor(DateTimeType);
    test("each view's request names the period it shows and its kind: the week in week view, the day in Shifts' day view, and in month view the month — its whole weeks, of a month every week of which takes an edit", async () => {
        const container = await mounted();
        /** A run's request from the view as it stands: its call held on its way, its question read, and the run stopped. */
        const asked = async () => {
            await waitFor(() => expect(eye(container)?.disabled).toBe(false), { timeout: 10_000 });
            const hold = calls.hold(RUN);
            await press(eye(container));
            await hold.holding;
            const request = calls.requests(RUN).at(-1)!;
            await press(eye(container));
            hold.release();
            await settle();
            return [request.period.type, instant(request.from), instant(request.to)];
        };
        expect(await asked()).toEqual(["week", "2028-03-05T00:00:00.000", "2028-03-12T00:00:00.000"]);
        // Tuesday, in Shifts' day view.
        await shiftsDay(container, 2);
        await press(toolbar(container).getByRole("radio", { name: "Day" }));
        expect(await asked()).toEqual(["day", "2028-03-07T00:00:00.000", "2028-03-08T00:00:00.000"]);
        // March holds the week before, published: no eye. April's weeks are all open.
        await press(toolbar(container).getByRole("radio", { name: "Week" }));
        await press(toolbar(container).getByRole("radio", { name: "People" }));
        await press(toolbar(container).getByRole("radio", { name: "Month" }));
        await waitFor(() => expect(eye(container)).toBeNull());
        // April, as the month view shows it: the weeks that hold a day of it, Sun 26 Mar to Sat 6 May.
        await key(container, "]");
        expect(await asked()).toEqual(["month", "2028-03-26T00:00:00.000", "2028-05-07T00:00:00.000"]);
    });
});

describe("a duty across the week's edge, for an optimiser that does not take the edges (rule 11)", () => {
    const Duties = ex.rosterDuties.type;
    const copy = (rows: ReadonlyMap<string, unknown>) => decodeBeast2For(Duties)(encodeBeast2For(Duties)(rows as never));
    const diff = diffFor(Duties);
    test("an answer that changes a night duty starting before the week and ending in it — which the Roster places in the week before, beyond the one it holds — is refused as outside the week asked, never as a week not available to edit; one that adds such a duty is refused alike, never as beyond the weeks either side", async () => {
        // Another page's night duty, the 22:00 shift from Sat 4 Mar to Sun 5 Mar 06:00: it overlaps the week in view, Sun 5
        // – Sat 11 Mar, and the Roster places it on its shift's day, Saturday, in the week before — which a run that does
        // not take the edges holds none of.
        const stored = copy(await h.read(ex.rosterDuties));
        const night = { ...stored.get("s11")!, shift: "night", start: at("2028-03-04T22:00:00"), end: at("2028-03-05T06:00:00") };
        const theirs = copy(stored);
        theirs.set("night", night);
        await h.patch(ex.rosterDuties, theirs);
        const container = await mounted();
        const week = period(container);
        const refused = [optimiseMessages.fail({ period: week }),
            optimiseMessages.refusedDetail({ reason: optimiseMessages.refusedOutside({ row: "a duty starting Sat, Mar 4, 2028", period: week }) })];
        // Its task changed.
        const changed = copy(theirs);
        changed.set("night", { ...night, task: some("unload") });
        calls.answer({ duties: diff(theirs, changed) as never }, RUN);
        await press(eye(container));
        await said(container, "fail");
        expect(words(banner(container, "fail")!)).toEqual(refused);
        // Another like it added, under a key of the function's.
        const added = copy(theirs);
        added.set("elara-night", { ...night, who: variant("staff", "dbracken") });
        calls.answer({ duties: diff(theirs, added) as never }, RUN);
        await press(eye(container));
        // The second run's own banner: the first's went as the run started.
        await waitFor(() => expect(calls.answers(RUN)).toHaveLength(2), { timeout: 10_000 });
        const second = () => container.querySelector<HTMLElement>('[data-optimise-banner="fail"]:not([data-leaving])');
        await waitFor(() => expect(second()).not.toBeNull(), { timeout: 10_000 });
        expect(words(second()!)).toEqual(refused);
        expect([container.querySelectorAll("[data-op]").length, (history(container, editingMessages.apply()) as HTMLButtonElement).disabled]).toEqual([0, true]);
    });
});

// The week in view, Sun 5 – Sat 11 Mar 2028: its duties, and one the optimiser adds — a Tuesday early in Inbound, another's copied.
optimiseCases<typeof ex.WarehouseDuty>({
    builder: "the Roster", h,
    mounted,
    record: ex.rosterDuties,
    answer: (patch) => { calls.answer({ duties: patch as never }, RUN); },
    add: ["elara-tue-early", (duties) => ({ ...duties.get("s12")!, who: variant("staff", "dbracken") })],
    // Monday's early in Inbound, on the unload in place of the putaway.
    change: ["s11", (duty) => ({ ...duty, task: some("unload") })],
    remove: "s13",
    other: ["s5", (duty) => ({ ...duty, note: "Swapped by the day lead" })],
    // The same shift a week on: the refusal names the duty as it stands in the week in view.
    outside: { to: (duty) => ({ ...duty, start: new Date(duty.start.getTime() + 7 * DAY), end: new Date(duty.end.getTime() + 7 * DAY) }), named: "R. Birch · Mon Mar 6 Early · Inbound",
        // A duty of a week the Roster holds none of is named by its start.
        standing: "a duty starting Mon, Mar 13, 2028" },
});
