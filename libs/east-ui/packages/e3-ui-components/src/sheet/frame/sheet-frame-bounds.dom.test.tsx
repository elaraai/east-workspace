/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A number outside its field's bounds (#1585), over the machines' upkeep on e3
 * itself: an app's write leaves the beam saw's hours under their least, 0. The
 * stored row's cell wears the warn wash a field still missing wears, saying
 * the bound, and Issues lists it as a warning, holding no Save; once the row is
 * changed, the issue is the row's own, as a field still missing is, and Save
 * waits. On a phone, the cell's stepper says the bound under it, as Details does.
 */

import { expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { act, sheetHarness, settle, slot, tabs } from "./harness.test-utils.js";
import { touchFrame } from "../frame.test-utils.js";

const h = sheetHarness();

/** A machine's cell, by the machine's code and the column's key. */
const cell = (c: HTMLElement, id: string, key: string) =>
    slot(c, "main")!.querySelector<HTMLElement>(`[data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`)!;
/** Whether Save waits: its button takes no press. */
const saveWaits = (c: HTMLElement) => within(slot(c, "toolbar")!).getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled;
/** The inspector's tabs, as they read. */
const inspector = (c: HTMLElement) => tabs(slot(c, "end")!);
/** The Issues tab's entries: where each is, what it says, and its kind. */
const listed = (c: HTMLElement) => [...slot(c, "end")!.querySelectorAll<HTMLElement>("[data-inspector-issue]")].map((issue) => {
    const message = issue.querySelector<HTMLElement>("[data-kind]")!;
    return [issue.firstElementChild?.textContent, message.textContent, message.getAttribute("data-kind")];
});

/** Types a cell's new text in the row's editor, committed with ⏎. */
async function typeInto(target: Element, text: string) {
    fireEvent.doubleClick(target);
    await settle();
    const input = document.querySelector('[data-slot="editorInput"]')!;
    fireEvent.input(input, { target: { value: text } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
}

test("a stored number under its least wears the warn wash, and Issues lists it as a warning, holding no Save; changed, the issue is the row's own and Save waits (#1585)", async () => {
    const machines = await h.read(ex.sheetMachineUpkeep);
    machines.set("S101", { ...machines.get("S101")!, hours: -10n });
    await h.patch(ex.sheetMachineUpkeep, machines);
    const { container } = await h.mount(ex.sheetUpkeep, { storageKey: "bounds" });
    const hours = () => cell(container, "S101", "hours");
    expect([hours().hasAttribute("data-bounds"), hours().getAttribute("title")]).toEqual([true, "at least 0"]);
    expect(cell(container, "E201", "hours").hasAttribute("data-bounds")).toBe(false);
    // Another machine changed: the stored one holds no Save, and Issues lists it as a warning.
    await typeInto(cell(container, "E201", "name"), "Edge bander, two");
    expect([saveWaits(container), inspector(container)]).toEqual([false, ["Details", "Issues 1"]]);
    await act(async () => { fireEvent.click(within(slot(container, "end")!).getByRole("tab", { name: "Issues 1" })); });
    await settle();
    expect(listed(container)).toEqual([["S101 · Hours", "at least 0", "warning"]]);
    // The beam saw changed: its hours are its own issue, as a field still missing is, and Save waits.
    await typeInto(cell(container, "S101", "name"), "Beam saw, east");
    expect([saveWaits(container), inspector(container)]).toEqual([true, ["Details", "Issues 1"]]);
    expect(listed(container)).toEqual([["S101 · Hours", "at least 0", "incomplete"]]);
    expect(hours().hasAttribute("data-bounds")).toBe(true);
});

test("on a phone, the stepper of a stored number under its least says the bound under it, as Details does; another's says nothing (#1585)", async () => {
    const machines = await h.read(ex.sheetMachineUpkeep);
    machines.set("S101", { ...machines.get("S101")!, hours: -10n });
    await h.patch(ex.sheetMachineUpkeep, machines);
    const restore = touchFrame(390);
    try {
        const { container } = await h.mount(ex.sheetUpkeep, { storageKey: "bounds-phone" });
        const editor = () => slot(container, "main")!.querySelector<HTMLElement>("[data-sheet-cell-editor]");
        fireEvent.mouseDown(cell(container, "S101", "hours"), { button: 0 });
        await settle();
        expect([editor()?.getAttribute("data-sheet-cell-editor"), editor()?.querySelector("[data-cell-error]")?.textContent]).toEqual(["hours", "at least 0"]);
        fireEvent.mouseDown(cell(container, "E201", "hours"), { button: 0 });
        await settle();
        expect([editor()?.getAttribute("data-sheet-cell-editor"), editor()?.querySelector("[data-cell-error]") ?? null]).toEqual(["hours", null]);
    } finally { restore(); }
});
