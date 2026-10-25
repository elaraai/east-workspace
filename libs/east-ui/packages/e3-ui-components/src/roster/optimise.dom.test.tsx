/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Optimise in the Roster (#1409, #1421; `Optimise Spec.md` §9) on e3: the
 * warehouse's optimiser is the example's own `e3.function`, called by name on
 * e3 once per run. The eye shows only with an optimiser, as tall as the
 * toolbar's other controls, between the issues item and the history item, and
 * only where the week can be optimised — never in Month (R6); a click sends
 * one call over the week — its duties by key, its targets by slot and the
 * complete staff (R1, R23) — and while it is out the eye runs, the footer
 * counts, the history is locked, nothing drags and every control of the week
 * stays in place, inert (R2); the result lands as
 * one edit (R7, R8): every slot short of its heads filled, each new duty
 * marked and named for the run on the Shifts chips and the People tiles
 * alike, the banner saying what changed, the changed people's hours and the
 * issues item flashing — and one Undo reverts it all, Redo replays the
 * landing without the banner, Save commits it with everything else (R9, R11).
 * Stop and a week change ignore a late answer (R3, R4); nothing to change and
 * a failed call say so (R10). Below 480px the eye is in the toolbar still,
 * and the landing is on the cards (R27).
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import { Roster } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import * as opt from "@elaraai/e3-ui/examples/roster/optimise";
import { fitCalls } from "../shared/func/fit-calls.test-utils.js";
import { START, act, at, history, rosterHarness, settle, slot, weekDuties, width } from "./harness.test-utils.js";

const h = rosterHarness({ "roster/optimise": opt });
const calls = fitCalls(h, { request: Roster.Types.OptimiseRequest(ex.WarehouseDuty), result: Roster.Types.OptimiseResult(ex.WarehouseDuty) });
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
const lit = (c: HTMLElement) => c.querySelector("[data-roster-frame]")!.hasAttribute("data-optimise-lit");
/** The week, as the eye names it: `Optimise W10`. */
const period = (c: HTMLElement) => eye(c)!.getAttribute("aria-label")!.replace(/^Optimise /, "");
const commits = async () => (await h.history(ex.rosterDuties)).commits.map(commit => commit.mutation);
/** The Roster with its optimiser, its week read: the eye is enabled once the week's duties have landed. */
async function mounted() {
    const { container } = await h.mount(opt.rosterOptimise);
    await waitFor(() => expect(eye(container)?.disabled).toBe(false), { timeout: 10_000 });
    return container;
}
/** The duties the latest answer added, by key, each with the day of the week it falls on. */
function added(): Map<string, number> {
    const asked = calls.requests(RUN).at(-1)!, answered = calls.answers(RUN).at(-1)!;
    return new Map([...answered.duties].filter(([key]) => !asked.duties.has(key)).map(([key, duty]) => [key, Math.floor((duty.start.getTime() - asked.from.getTime()) / DAY)] as const));
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

    test("R6 — a month in view lists no eye: a run is one week's; Week lists it again, and a run out as Month opens stops", async () => {
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

    test("R1, R2, R23 — one call over the week: its duties by key, its targets by slot and the complete staff; the lock while it is out", async () => {
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
        const stored = weekDuties(await h.read(ex.rosterDuties), START);
        expect([asked.run, asked.from.getTime(), asked.to.getTime(), asked.duties.size, asked.requirements.size > 0, asked.context.people.size > 0, asked.context.shifts.length > 0])
            .toEqual([1n, START.getTime(), at("2028-03-12T00:00:00").getTime(), stored.size, true, true, true]);
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
        // Its person's week in People: the tile marked alike, and their hours flashing — the duty selected first, so its
        // person's row is brought into view.
        const [id] = [...adds].find(([, d]) => d === day)!;
        await press(container.querySelector(`[data-roster-assignment="${id}"]`));
        await press(toolbar(container).getByRole("radio", { name: "People" }));
        // Its person's row may stand below the rows the grid has mounted: scrolled to, as a reader would.
        const tileOf = () => container.querySelector<HTMLElement>(`[data-roster-tile][data-roster-assignment="${id}"]`);
        const scroller = container.querySelector<HTMLElement>("[data-virtual-rows]")!;
        for (let i = 1; i <= 40 && tileOf() === null; i++) { await act(async () => { scroller.scrollTop = i * 3 * 36; fireEvent.scroll(scroller); }); await settle(); }
        const tile = await waitFor(() => { const el = tileOf(); expect(el).not.toBeNull(); return el!; });
        expect([tile.getAttribute("data-op"), tile.getAttribute("data-fill"), tile.getAttribute("title")!.startsWith("Added by Elara · run #1 · ")]).toEqual(["add", "own", true]);
        expect(tile.closest("[data-roster-person-row]")!.querySelector("[data-roster-week-hours][data-opn]")).not.toBeNull();
        // One step: one Undo takes the whole run back, and ends its highlight and its banner.
        await press(history(container, editingMessages.undo()));
        expect([container.querySelectorAll("[data-op]").length, lit(container)]).toEqual([0, false]);
        await waitFor(() => expect(container.querySelector("[data-optimise-banner]:not([data-leaving])")).toBeNull());
        // Redo re-inserts it and replays the landing, without the banner — the Undo's may still be collapsing.
        await press(history(container, editingMessages.redo()));
        await waitFor(() => expect(container.querySelector(`[data-roster-tile][data-roster-assignment="${id}"][data-op="add"]`)).not.toBeNull(), { timeout: 10_000 });
        await waitFor(() => expect(lit(container)).toBe(true));
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
        // The drafts are the next run's input (O5): with every slot filled, the optimiser changes nothing.
        await press(eye(container));
        await said(container, "none");
        expect(words(banner(container, "none")!)).toEqual(["No changes", `Elara found nothing to improve in ${period(container)}.`]);
        expect([banner(container, "none")!.querySelector("[role=status]") !== null, eye(container)!.hasAttribute("data-blink"), calls.requests(RUN).length]).toEqual([true, true, 2]);
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
        const cards = container.querySelectorAll<HTMLElement>('[data-roster-card][data-op="add"]');
        expect(cards).toHaveLength(onDay);
        expect([cards[0]!.getAttribute("title"), cards[0]!.getAttribute("data-fill"), lit(container)]).toEqual(["Added by Elara · run #1", "own", true]);
    });
});
