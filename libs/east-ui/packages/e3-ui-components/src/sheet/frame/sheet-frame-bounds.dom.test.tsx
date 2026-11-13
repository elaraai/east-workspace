/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A number outside its field's bounds (#1585), over the machines' upkeep on e3
 * itself: an app's write leaves the beam saw's hours under their least, 0. The
 * stored row's cell wears the warn wash a field still missing wears, saying
 * the bound, its Details say it once, in the field's help line, as a warning,
 * and Issues lists it as a warning, holding no Save; once the row is changed,
 * the issue is the row's own, as a field still missing is, Save waits, and the
 * help line is an error. On a phone, the cell's stepper says it in its help
 * line in the same tones, as Details does.
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

/** What Details' field says of its bound: the part of its help line said in a tone, and that tone — never a line of its own. */
const said = (c: HTMLElement, key: string) => {
    const field = slot(c, "end")!.querySelector(`[role='tabpanel']:not([hidden]) [data-field="${key}"]`);
    expect(field?.querySelector("[data-scope=field][data-part=error-text]") ?? null).toBeNull();
    const toned = field?.querySelector("[data-scope=field][data-part=helper-text] [data-breach]");
    return toned === null || toned === undefined ? undefined : [toned.textContent, toned.getAttribute("data-breach")];
};
/** Opens one of the inspector's tabs, by its name. */
async function openTab(c: HTMLElement, name: RegExp) {
    await act(async () => { fireEvent.click(within(slot(c, "end")!).getByRole("tab", { name })); });
    await settle();
}

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

test("a stored number under its least wears the warn wash, Details say it once as a warning, and Issues lists it as a warning, holding no Save; changed, the issue is the row's own, Save waits and Details say it as an error (#1585)", async () => {
    const machines = await h.read(ex.sheetMachineUpkeep);
    machines.set("S101", { ...machines.get("S101")!, hours: -10n });
    await h.patch(ex.sheetMachineUpkeep, machines);
    const { container } = await h.mount(ex.sheetUpkeep, { storageKey: "bounds" });
    const hours = () => cell(container, "S101", "hours");
    expect([hours().hasAttribute("data-bounds"), hours().getAttribute("title")]).toEqual([true, "at least 0"]);
    expect(cell(container, "E201", "hours").hasAttribute("data-bounds")).toBe(false);
    // Its Details: said once, in the field's help line, as a warning.
    fireEvent.mouseDown(cell(container, "S101", "name"), { button: 0 });
    await settle();
    expect(said(container, "hours")).toEqual(["run since new · at least 0 h · step 10", "warn"]);
    // Another machine changed: the stored one holds no Save, and Issues lists it as a warning.
    await typeInto(cell(container, "E201", "name"), "Edge bander, two");
    expect([saveWaits(container), inspector(container)]).toEqual([false, ["Details", "Issues 1"]]);
    await openTab(container, /^Issues/);
    expect(listed(container)).toEqual([["S101 · Hours", "at least 0", "warning"]]);
    // The beam saw changed: its hours are its own issue, as a field still missing is, Save waits, and its Details say it
    // as an error.
    await typeInto(cell(container, "S101", "name"), "Beam saw, east");
    expect([saveWaits(container), inspector(container)]).toEqual([true, ["Details", "Issues 1"]]);
    expect(listed(container)).toEqual([["S101 · Hours", "at least 0", "incomplete"]]);
    expect(hours().hasAttribute("data-bounds")).toBe(true);
    await openTab(container, /^Details/);
    expect(said(container, "hours")).toEqual(["run since new · at least 0 h · step 10", "error"]);
});

test("on a phone, the stepper of a stored number under its least says the bound once, in its help line, as a warning, as Details does — an error once its row is changed; another's help line takes no tone (#1585)", async () => {
    const machines = await h.read(ex.sheetMachineUpkeep);
    machines.set("S101", { ...machines.get("S101")!, hours: -10n });
    await h.patch(ex.sheetMachineUpkeep, machines);
    const restore = touchFrame(390);
    try {
        const { container } = await h.mount(ex.sheetUpkeep, { storageKey: "bounds-phone" });
        const editor = () => slot(container, "main")!.querySelector<HTMLElement>("[data-sheet-cell-editor]");
        /** The stepper's help line, its tone, and whether its field is invalid. */
        const stepper = () => {
            const help = editor()?.querySelector("[data-cell-help]");
            return [help?.textContent, help?.getAttribute("data-breach") ?? null, editor()?.querySelector("[data-cell-input]")?.getAttribute("aria-invalid") ?? null];
        };
        fireEvent.mouseDown(cell(container, "S101", "hours"), { button: 0 });
        await settle();
        expect(editor()?.getAttribute("data-sheet-cell-editor")).toBe("hours");
        expect([stepper(), editor()?.querySelectorAll("[data-cell-help]").length]).toEqual([["at least 0 · run since new", "warn", null], 1]);
        // Typed, still under its least: the row changed, it holds Save — an error, the field invalid.
        await act(async () => { fireEvent.input(editor()!.querySelector("[data-cell-input]")!, { target: { value: "-5" } }); });
        await settle();
        expect([saveWaits(container), stepper()]).toEqual([true, ["at least 0 · run since new", "error", "true"]]);
        fireEvent.mouseDown(cell(container, "E201", "hours"), { button: 0 });
        await settle();
        expect([editor()?.getAttribute("data-sheet-cell-editor"), stepper()]).toEqual(["hours", ["at least 0 · run since new", null, null]]);
    } finally { restore(); }
});
