/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Sheet>` on a touch screen (#1215, #1216): a frame too narrow for the
 * touch gutter beside the first column folds it — each row's actions in one
 * 44 px row-actions button. A tap lists what the gutter offers there, the
 * row's decisions and its inserts, each one transaction Undo takes back; a
 * drag on the button moves the row, as its grip does. A fine pointer, or a
 * frame wide enough, keeps today's gutter.
 */

import { afterEach, test, expect } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { layOut, pointAt, stubScrollIntoView } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { act, sheetHarness, mount, settle, slot } from "./harness.test-utils.js";
import { touchFrame } from "../frame.test-utils.js";

sheetHarness();
stubScrollIntoView();

// A touch screen's frame. The batches' first column, Step, is 240 px: beside
// the 254 px touch gutter, a frame under 494 px folds it.
let restoreFrame: () => void = () => {};
const onTouch = (width: number) => { restoreFrame = touchFrame(width); };
const offTouch = () => { restoreFrame(); restoreFrame = () => {}; };
afterEach(offTouch);

const main = (c: HTMLElement) => slot(c, "main")!;
const card = (c: HTMLElement) => main(c).querySelector<HTMLElement>("[data-sheet-card]")!;
/** The sheet as it reads: each band's title, `# …`, and each row's task, in order — never a blank row. */
const sheetText = (c: HTMLElement) => [...main(c).querySelectorAll<HTMLElement>('[data-slot="row"]:not([data-blank])')]
    .map((row) => (row.hasAttribute("data-band-row") ? `# ${row.querySelector('[data-slot="groupTitle"]')!.textContent}` : row.querySelector('[data-key="task"]')!.textContent));
/** A group's band, by its id. */
const bandOf = (c: HTMLElement, id: string) => main(c).querySelector<HTMLElement>(`[data-slot="row"][data-band-row][data-row-id="${id}"]`)!;
/** A group's lines, in order. */
const linesOf = (c: HTMLElement, id: string) => [...main(c).querySelectorAll<HTMLElement>(`[data-slot="row"][data-group-id="${id}"]:not([data-blank])`)];
/** A group's lines as their tasks read — a new line's still blank, `""` (its cell says only that a value is required). */
const tasksOf = (c: HTMLElement, id: string) => linesOf(c, id).map((line) => {
    const cell = line.querySelector<HTMLElement>('[data-key="task"]')!;
    return cell.hasAttribute("data-blank") ? "" : cell.textContent;
});
/** A row's row-actions button. */
const actionsOf = (row: HTMLElement) => row.querySelector<HTMLElement>('[data-slot="rowActions"]');
/** The open menu's items, as they read. */
const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);

/** Taps a row's row-actions button: its menu opens. */
async function openActions(row: HTMLElement) {
    await act(async () => { fireEvent.click(actionsOf(row)!); });
    await settle();
}

/** Picks an item of the open menu as a pointer does — pressed on it, then its click — and closes an editor it opened. */
async function pick(c: HTMLElement, name: string) {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent === name);
    if (item === undefined) throw new Error(`no menu item ${name}`);
    await act(async () => { fireEvent.pointerDown(item); });
    await act(async () => { fireEvent.click(item); });
    await settle();
    const input = main(c).querySelector<HTMLElement>('[data-slot="editorInput"]');
    if (input !== null) {
        fireEvent.keyDown(input, { key: "Escape" });
        await settle();
    }
}

/** Clicks a history button in the toolbar, as a pointer does. */
async function history(c: HTMLElement, name: "Undo" | "Redo") {
    const button = within(slot(c, "toolbar")!).getByRole("button", { name });
    await act(async () => { fireEvent.mouseDown(button, { button: 0 }); fireEvent.click(button); });
    await settle();
}

// ── Dragging: a row laid out under the pointer, its halves the seams ─────
const BOX = { left: 0, top: 100, width: 900, height: 40 };
const halfY = (half: "top" | "bottom") => (half === "top" ? 105 : 135);
function pickUp(el: HTMLElement) {
    pointAt(null);
    act(() => { fireEvent.pointerDown(el, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 }); });
    act(() => { fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 6 }); });
}
function restOn(row: HTMLElement, half: "top" | "bottom") {
    layOut(new Map([[row, BOX]]));
    act(() => { fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 400, clientY: halfY(half) }); });
}
async function release(half: "top" | "bottom") {
    act(() => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 400, clientY: halfY(half) }); });
    await settle();
}
/** What the ghost says, and whether it says why not. */
const caption = () => {
    const el = document.querySelector("[data-drag-caption]");
    return el === null ? null : { text: el.textContent, refused: el.hasAttribute("data-refused") };
};

test("on a coarse pointer a frame one pixel short of the touch gutter beside the first column folds it — one row-actions button a row, named as its grip is, no actions column and no seam; exactly enough room, or a fine pointer, keeps today's gutter", async () => {
    onTouch(493);
    const narrow = mount(ex.sheetBatches, { drag: true });
    await settle();
    let c = narrow.container;
    expect(card(c).getAttribute("data-gutter")).toBe("folded");
    expect(card(c).style.getPropertyValue("--sheet-gutter")).toBe("108px");
    expect(linesOf(c, "B-101")[0]!.style.gridTemplateColumns.split(" ")[0]).toBe("108px");
    expect(actionsOf(linesOf(c, "B-101")[0]!)!.getAttribute("aria-label")).toBe("Actions — line 1 of Doors, oak");
    expect(actionsOf(bandOf(c, "B-101"))!.getAttribute("aria-label")).toBe("Actions — batch 1");
    // The button is the row's grip too — one that waits for travel, so a tap stays a tap — and takes no tab stop.
    expect(actionsOf(linesOf(c, "B-101")[0]!)!.getAttribute("data-drag-grip")).toBe("tap");
    expect(actionsOf(linesOf(c, "B-101")[0]!)!.hasAttribute("tabindex")).toBe(false);
    expect(main(c).querySelector('[data-slot="fillSlot"], [data-slot="rowGrip"], [data-slot="insertPoint"]')).toBeNull();
    narrow.unmount();
    offTouch();

    onTouch(494);
    const wide = mount(ex.sheetBatches, { drag: true });
    await settle();
    c = wide.container;
    expect(card(c).hasAttribute("data-gutter")).toBe(false);
    expect(card(c).style.getPropertyValue("--sheet-gutter")).toBe("254px");
    expect(main(c).querySelector('[data-slot="rowActions"]')).toBeNull();
    expect(main(c).querySelector('[data-slot="rowGrip"]')).not.toBeNull();
    wide.unmount();
    offTouch();

    const fine = mount(ex.sheetBatches, { drag: true });
    await settle();
    c = fine.container;
    expect(card(c).hasAttribute("data-gutter")).toBe(false);
    expect(card(c).style.getPropertyValue("--sheet-gutter")).toBe("128px");
    expect(main(c).querySelector('[data-slot="rowActions"]')).toBeNull();
});

test("a line's menu inserts a line above or below it and a band's a new batch after its group — each one transaction Undo takes back; a new row's and a new batch's menus discard them, as their × does", async () => {
    onTouch(400);
    const { container } = mount(ex.sheetBatches, { drag: true });
    await settle();
    const before = sheetText(container);
    // A line: its inserts, in the insertion strip's words.
    await openActions(linesOf(container, "B-101")[0]!);
    expect(menuItems()).toEqual(["Insert above", "Insert below", "New batch"]);
    await pick(container, "Insert below");
    expect(tasksOf(container, "B-101")).toEqual(["Cut doors", "", "Band doors", "Spray doors"]);
    await history(container, "Undo");
    expect(sheetText(container)).toEqual(before);
    await openActions(linesOf(container, "B-101")[1]!);
    await pick(container, "Insert above");
    expect(tasksOf(container, "B-101")).toEqual(["Cut doors", "", "Band doors", "Spray doors"]);
    // The new line is a draft the record has never held: its menu leads with its discard.
    const added = linesOf(container, "B-101")[1]!;
    await openActions(added);
    expect(menuItems()).toEqual(["Discard new row", "Insert above", "Insert below", "New batch"]);
    await pick(container, "Discard new row");
    expect(sheetText(container)).toEqual(before);
    await history(container, "Undo");
    expect(linesOf(container, "B-101")).toHaveLength(4);
    await history(container, "Undo");
    expect(sheetText(container)).toEqual(before);
    // A band: a new batch after its group, and its own menu discards it.
    await openActions(bandOf(container, "B-101"));
    expect(menuItems()).toEqual(["Insert above", "Insert below", "New batch"]);
    await pick(container, "New batch");
    const bands = () => [...main(container).querySelectorAll<HTMLElement>('[data-slot="row"][data-band-row]')];
    expect(bands()).toHaveLength(4);
    const fresh = bands()[1]!;
    expect(fresh.hasAttribute("data-draft")).toBe(true);
    await openActions(fresh);
    expect(menuItems()).toEqual(["Discard new batch", "Insert above", "Insert below", "New batch"]);
    await pick(container, "Discard new batch");
    expect(sheetText(container)).toEqual(before);
    await history(container, "Undo");
    expect(bands()).toHaveLength(4);
    await history(container, "Undo");
    expect(sheetText(container)).toEqual(before);
});

test("a drag on a line's row-actions button moves the line, as its grip does — one transaction, and no menu opens", async () => {
    onTouch(400);
    const { container } = mount(ex.sheetBatches, { drag: true });
    await settle();
    const before = sheetText(container);
    pickUp(actionsOf(linesOf(container, "B-101")[2]!)!);
    restOn(linesOf(container, "B-101")[0]!, "top");
    expect(caption()).toEqual({ text: "before line 1 of Doors, oak", refused: false });
    await release("top");
    expect(sheetText(container).slice(0, 4)).toEqual(["# Doors, oak", "Spray doors", "Cut doors", "Band doors"]);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await history(container, "Undo");
    expect(sheetText(container)).toEqual(before);
});
