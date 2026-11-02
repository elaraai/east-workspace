/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Sheet's action column (#1475–#1477, `Sheet Action Column - Behaviour
 * Spec.md`), over e3-ui's action examples on e3 itself
 * (`harness.test-utils.tsx`): each cell draws its state, its summary and the
 * controls of what its row is offered — `start`, else its state's `next` —
 * off while the column's `blocked` says so; a button is taken at once, a
 * choice opens its Menu, a form its Popover of the inspector's own fields;
 * every action is one transaction — its case, the cells its `updates` sets on
 * the row and on its group's band — undone in one step, and saved through the
 * record's patch door; ⏎ takes the first case; typing, a paste and ⌫ never
 * change an action cell; a read-only sheet shows the state alone.
 */

import { test, expect } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { some, variant } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet-actions";
import { act, sheetHarness, settle, slot } from "./harness.test-utils.js";
import { touchFrame } from "../frame.test-utils.js";

const h = sheetHarness({ modules: { "sheet/sheet-actions": ex } });

/** A flat row's action cell, by the row's key and the column's. */
const cellOf = (container: HTMLElement, id: string, key: string) =>
    slot(container, "main")!.querySelector<HTMLElement>(`[data-slot="row"][data-row-id="${id}"] [data-key="${key}"]`)!;
/** A line's action cell, by its group, its key and the column's. */
const lineCell = (container: HTMLElement, group: string, line: string, key: string) =>
    slot(container, "main")!.querySelector<HTMLElement>(`[data-slot="row"][data-group-id="${group}"][data-line="${line}"] [data-key="${key}"]`)!;
/** A band's cell, by its group and the column's. */
const bandCell = (container: HTMLElement, group: string, key: string) =>
    slot(container, "main")!.querySelector<HTMLElement>(`[data-band-row][data-row-id="${group}"] [data-key="${key}"]`)!;
const card = (container: HTMLElement) => slot(container, "main")!.querySelector<HTMLElement>("[data-sheet-card]")!;
const stateOf = (cell: HTMLElement) => cell.querySelector('[data-slot="actionState"]')?.getAttribute("data-case") ?? undefined;
const nextOf = (cell: HTMLElement) => cell.querySelector<HTMLButtonElement>('[data-slot="actionNext"]');

/** Picks an item of the open Menu as a pointer does — pressed on it, then its click. */
async function pick(item: Element) {
    await act(async () => { fireEvent.pointerDown(item); });
    await act(async () => { fireEvent.click(item); });
    await settle();
}

/** Presses a control as a pointer does, and lets what it starts settle. */
async function press(el: Element) {
    await act(async () => { fireEvent.mouseDown(el, { button: 0 }); fireEvent.click(el); });
    await settle();
}

test("each cell draws its state, its summary, and the first case its row is offered — start with nothing taken, else its state's next (S3–S10)", async () => {
    const { container } = await h.mount(ex.sheetActionsBasic);
    const notStarted = cellOf(container, "J-0003", "state");
    expect(notStarted.querySelector('[data-slot="actionAbsent"]')?.textContent).toBe("not started");
    expect(nextOf(notStarted)?.textContent).toBe("Start");
    const started = cellOf(container, "J-0002", "state");
    expect(stateOf(started)).toBe("started");
    expect(started.querySelector('[data-slot="actionState"]')?.textContent).toBe("Started");
    expect(nextOf(started)?.textContent).toBe("Finish");
    // A final state offers nothing: no next half, no ▾ part.
    const finished = cellOf(container, "J-0001", "state");
    expect(stateOf(finished)).toBe("finished");
    expect(nextOf(finished)).toBeNull();
    expect(finished.querySelector('[data-slot="actionMore"]')).toBeNull();
});

test("a button is taken at once as one transaction: the cell redraws in its new state, one Undo puts it back, and Save commits it (P2, T1, T2)", async () => {
    const { container } = await h.mount(ex.sheetActionsBasic);
    await press(nextOf(cellOf(container, "J-0003", "state"))!);
    expect(stateOf(cellOf(container, "J-0003", "state"))).toBe("started");
    expect(nextOf(cellOf(container, "J-0003", "state"))?.textContent).toBe("Finish");
    // The ring is on the action cell (T2).
    expect(cellOf(container, "J-0003", "state").getAttribute("data-selected")).toBe("");
    const toolbar = within(slot(container, "toolbar")!);
    await press(toolbar.getByRole("button", { name: "Undo" }));
    expect(stateOf(cellOf(container, "J-0003", "state"))).toBeUndefined();
    await press(toolbar.getByRole("button", { name: "Redo" }));
    expect(stateOf(cellOf(container, "J-0003", "state"))).toBe("started");
    await press(toolbar.getByRole("button", { name: "Save" }));
    const jobs = await h.read(ex.sheetActionJobs);
    expect(jobs.get("J-0003")!.state).toEqual(some(variant("started", null)));
});

test("⏎ with the ring on an action cell takes its first case; typing, a paste and ⌫ never change it (K2, T7)", async () => {
    const { container } = await h.mount(ex.sheetActionsBasic);
    const cell = cellOf(container, "J-0002", "state");
    fireEvent.mouseDown(cell, { button: 0 });
    await settle();
    // A printable key opens no editor on it.
    fireEvent.keyDown(card(container), { key: "x" });
    await settle();
    expect(document.querySelector('[data-slot="editorInput"]')).toBeNull();
    // ⌫ clears no action cell.
    fireEvent.keyDown(card(container), { key: "Backspace" });
    await settle();
    expect(stateOf(cellOf(container, "J-0002", "state"))).toBe("started");
    // A paste writes nothing there.
    await act(async () => { fireEvent.paste(card(container), { clipboardData: { getData: () => "finished" } }); });
    await settle();
    expect(stateOf(cellOf(container, "J-0002", "state"))).toBe("started");
    fireEvent.keyDown(card(container), { key: "Enter" });
    await settle();
    expect(stateOf(cellOf(container, "J-0002", "state"))).toBe("finished");
});

test("a read-only sheet shows each state alone, with no control to take (T9)", async () => {
    const { container } = await h.mount(ex.sheetActionsReadOnly);
    const started = cellOf(container, "J-0002", "state");
    expect(stateOf(started)).toBe("started");
    expect(nextOf(started)).toBeNull();
    expect(nextOf(cellOf(container, "J-0003", "state"))).toBeNull();
});

test("a step waits for the one before it: its controls are off, and it says why (blocked, ST2)", async () => {
    const { container } = await h.mount(ex.sheetActionsWorkOrders);
    // WO-1042's step 30 waits for step 20, which is started, not finished.
    const waiting = lineCell(container, "WO-1042", "2", "action");
    const next = nextOf(waiting);
    expect(next).not.toBeNull();
    expect(next!.disabled).toBe(true);
    expect(next!.title).not.toBe("");
});

test("Hold ▾ opens a Menu of the reasons; a pick holds the step and writes the order's status on its band, one transaction (P3, M5, M8, T1)", async () => {
    const { container } = await h.mount(ex.sheetActionsWorkOrders);
    const step = lineCell(container, "WO-1042", "1", "action");
    // Step 20 is started: Complete first, the rest behind ▾.
    expect(nextOf(step)?.textContent).toBe("Complete");
    await press(step.querySelector('[data-slot="actionMore"]')!);
    const menu = document.querySelector<HTMLElement>("[data-sheet-action-menu]")!;
    expect(menu).not.toBeNull();
    const reason = within(menu).getByRole("menuitem", { name: "Machine down" });
    await pick(reason);
    expect(document.querySelector("[data-sheet-action-menu]")).toBeNull();
    expect(stateOf(lineCell(container, "WO-1042", "1", "action"))).toBe("held");
    expect(bandCell(container, "WO-1042", "action")?.textContent).toContain("on_hold");
    await press(within(slot(container, "toolbar")!).getByRole("button", { name: "Undo" }));
    expect(stateOf(lineCell(container, "WO-1042", "1", "action"))).toBe("started");
    expect(bandCell(container, "WO-1042", "action")?.textContent).toContain("in_progress");
});

test("Report… opens a Popover of its form; ⏎ takes it, the step reported and its Good set (P4, F9, T1)", async () => {
    const { container } = await h.mount(ex.sheetActionsWorkOrders);
    const step = lineCell(container, "WO-1042", "1", "action");
    await press(step.querySelector('[data-slot="actionMore"]')!);
    await pick(within(document.querySelector<HTMLElement>("[data-sheet-action-menu]")!).getByRole("menuitem", { name: /Report…/ }));
    await settle();
    const form = document.querySelector<HTMLElement>("[data-sheet-action-form]")!;
    expect(form).not.toBeNull();
    // The form opens on the step's Good so far (F10), its number field focused; typed a key at a time, as the shared
    // number input reads each key back into its box.
    const input = form.querySelector<HTMLInputElement>("input")!;
    const user = userEvent.setup();
    await user.clear(input);
    await settle();
    for (const key of "12") { await user.type(input, key); await settle(); }
    await user.keyboard("{Enter}");
    await settle();
    expect(document.querySelector("[data-sheet-action-form]")).toBeNull();
    expect(stateOf(lineCell(container, "WO-1042", "1", "action"))).toBe("reported");
    expect(lineCell(container, "WO-1042", "1", "good").textContent).toContain("12");
});

/** The docked strip's label and its line. */
const strip = (container: HTMLElement) => ({
    label: slot(container, "main")!.querySelector('[data-slot="stripLabel"]')?.textContent,
    text: slot(container, "main")!.querySelector('[data-slot="stripChip"]')?.textContent,
});
/** Waits out the strip's dwell (P8). */
const dwell = () => act(async () => { await new Promise<void>((resolve) => { setTimeout(resolve, 200); }); });

test("the ring on an action cell says its state and what it offers in the strip; a control the pointer rests on previews what it would write (R2, R3, P8)", async () => {
    const { container } = await h.mount(ex.sheetActionsTickets);
    fireEvent.mouseDown(cellOf(container, "T-301", "action"), { button: 0 });
    await settle();
    expect(strip(container).label).toBe("Action · Spindle noise");
    expect(strip(container).text).toContain("offers Acknowledge, Defer…, Hand over, Close");
    fireEvent.mouseEnter(nextOf(cellOf(container, "T-302", "action"))!);
    await dwell();
    expect(strip(container).label).toBe("Acknowledge · Coolant leak");
    expect(strip(container).text).toBe("Sets nothing beside the action");
    fireEvent.mouseLeave(nextOf(cellOf(container, "T-302", "action"))!);
    await dwell();
    expect(strip(container).label).toBe("Action · Spindle noise");
});

test("a range down the action column takes a case on every row of it, as one transaction one Undo takes back (T8)", async () => {
    const { container } = await h.mount(ex.sheetActionsTickets);
    fireEvent.mouseDown(cellOf(container, "T-301", "action"), { button: 0 });
    fireEvent.mouseDown(cellOf(container, "T-302", "action"), { button: 0, shiftKey: true });
    await settle();
    await press(cellOf(container, "T-301", "action").querySelector('[data-slot="actionMore"]')!);
    await pick(within(document.querySelector<HTMLElement>("[data-sheet-action-menu]")!).getByRole("menuitem", { name: /Close/ }));
    expect(stateOf(cellOf(container, "T-301", "action"))).toBe("closed");
    expect(stateOf(cellOf(container, "T-302", "action"))).toBe("closed");
    await press(within(slot(container, "toolbar")!).getByRole("button", { name: "Undo" }));
    expect(stateOf(cellOf(container, "T-301", "action"))).toBeUndefined();
    expect(stateOf(cellOf(container, "T-302", "action"))).toBe("acknowledged");
});

test("in auto mode an action is saved as it is taken: its dot's echo runs until e3 has the commit, then the tint clears (T5, N2)", async () => {
    const { container } = await h.mount(ex.sheetActionsTickets);
    const saving = h.e3.hold((request) => request.kind === "mutate");
    await press(nextOf(cellOf(container, "T-301", "action"))!);
    await act(async () => { await saving.holding; });
    await settle();
    const dot = () => cellOf(container, "T-301", "action").querySelector('[data-slot="actionDot"]');
    expect(dot()?.getAttribute("data-live")).toBe("");
    saving.release();
    await settle();
    await act(async () => { await h.e3.idle(); });
    await settle();
    expect(dot()?.getAttribute("data-live")).toBeNull();
    const tickets = await h.read(ex.sheetTickets);
    expect(tickets.get("T-301")!.action).toEqual(some(variant("acknowledged", null)));
});

test("a taken action's words tint as a draft until Save (ST3, ST6)", async () => {
    const { container } = await h.mount(ex.sheetActionsBasic);
    const state = () => cellOf(container, "J-0003", "state").querySelector('[data-slot="actionState"]');
    expect(cellOf(container, "J-0002", "state").querySelector('[data-slot="actionState"]')?.getAttribute("data-dirty")).toBeNull();
    await press(nextOf(cellOf(container, "J-0003", "state"))!);
    expect(state()?.getAttribute("data-dirty")).toBe("");
    await press(within(slot(container, "toolbar")!).getByRole("button", { name: "Save" }));
    await act(async () => { await h.e3.idle(); });
    await settle();
    expect(state()?.getAttribute("data-dirty")).toBeNull();
});

/** The phone's action bar, as the docked strip's place holds it. */
const bar = (container: HTMLElement) => slot(container, "main")!.querySelector<HTMLElement>("[data-sheet-action-bar]");

test("on a phone each cell shows its state alone, and the selected row's actions are the docked bar's: the first full width, its consequence under them; taking one returns the bar to the new offer (X4–X6, X8)", async () => {
    const restore = touchFrame(390);
    try {
        const { container } = await h.mount(ex.sheetActionsBasic);
        expect(nextOf(cellOf(container, "J-0003", "state"))).toBeNull();
        expect(bar(container)).toBeNull();
        fireEvent.mouseDown(cellOf(container, "J-0003", "task"), { button: 0 });
        await settle();
        const buttons = bar(container)!;
        expect(buttons.getAttribute("data-sheet-action-bar")).toBe("buttons");
        expect(buttons.querySelector("[data-bar-state]")?.textContent).toBe("not started");
        const first = buttons.querySelector<HTMLElement>('[data-bar-take][data-first]')!;
        expect(first.textContent).toBe("Start");
        expect(buttons.querySelector("[data-bar-consequence]")?.textContent).toBe("Sets nothing beside the action");
        await press(first);
        expect(stateOf(cellOf(container, "J-0003", "state"))).toBe("started");
        expect(bar(container)!.querySelector('[data-bar-take][data-first]')?.textContent).toBe("Finish");
    } finally { restore(); }
});

test("on a phone a choice opens inside the bar, never floating: ← back, its reasons as rows; a pick takes it (X7, X13)", async () => {
    const restore = touchFrame(390);
    try {
        const { container } = await h.mount(ex.sheetActionsWorkOrders);
        fireEvent.mouseDown(lineCell(container, "WO-1042", "1", "action"), { button: 0 });
        await settle();
        await press(bar(container)!.querySelector('[data-bar-take="held"]')!);
        const choice = bar(container)!;
        expect(choice.getAttribute("data-sheet-action-bar")).toBe("choice");
        expect(document.querySelector("[data-sheet-action-menu]")).toBeNull();
        expect(choice.querySelector("[data-bar-back]")).not.toBeNull();
        await press(choice.querySelector('[data-bar-choice="machine_down"]')!);
        expect(stateOf(lineCell(container, "WO-1042", "1", "action"))).toBe("held");
        expect(bar(container)!.getAttribute("data-sheet-action-bar")).toBe("buttons");
    } finally { restore(); }
});
