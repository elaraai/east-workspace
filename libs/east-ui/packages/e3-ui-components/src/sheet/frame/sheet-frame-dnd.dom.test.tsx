/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Sheet>`'s drag and drop (#1187, #1216, `Sheet Builder Spec.md` §9.8,
 * §10: SB38–SB40, SB44, SB45, SB61), through the page's drag layer and its
 * test utilities, over the in-memory stand-in records (`harness.test-utils`):
 * a template dropped on a seam, a group's start or end, or the blank tail; a
 * group template between the groups, and on a keyed record where its key
 * sorts; an author's card setting its cells on a row or a band; a row, a line
 * and a group moved by their grips, and committed by one Save; every refusal
 * the ghost says in red; ⏎ on a card; and one transaction per drop, undone in
 * one step.
 */

import { test, expect } from "vitest";
import { act, fireEvent, within } from "@testing-library/react";
import { ArrayType, East, decodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { announced, layOut, pointAt, stubScrollIntoView } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { WORKSPACE, sheetHarness, mount, mountPayload, settle, slot } from "./harness.test-utils.js";

const harness = sheetHarness();
stubScrollIntoView();

// ── The sheets ────────────────────────────────────────────────────────────

/** A week's rows in the planner's order, with a template to drop. */
const weekPayload = East.compile(East.function([], SheetPayloadType, ($) => {
    const plans = $.let(Record.bind(ex.sheetWeekPlans, [ex.sheetWeekPlansPatch]));
    return Sheet.Payload({
        record: plans, entry: { key: "2026-W42", rows: "rows", id: "id" }, name: "week",
        columns: { task: Sheet.column.text(ex.WeekRow, { header: "Task" }), qty: Sheet.column.quantity(ex.WeekRow, { header: "Qty" }) },
        templates: { rows: [{ key: "seal", name: "Seal the doors", values: Sheet.patch(ex.WeekRow, { task: "Seal the doors", start: none, qty: some(24.0) }) }] },
        library: [Sheet.library.rows()],
    });
}), getRegisteredPlatformImplementations());

/** The day's batches, where the sheet's `edits` add no line and no batch. */
const batchesAddingNothing = East.compile(East.function([], SheetPayloadType, ($) => {
    const days = $.let(Record.bind(ex.sheetBatchDays, [ex.sheetBatchDaysPatch]));
    const finishing = $.let([
        { task: "Sand", qty: none, parts: [], bookings: [] },
        { task: "Seal", qty: none, parts: [], bookings: [] },
    ], ArrayType(ex.BatchStep));
    return Sheet.Payload({
        record: days, entry: { key: "2026-10-12", rows: "batches", id: "id" }, name: "adding-nothing",
        group: Sheet.group(ex.Batch, "steps", { title: "name", noun: { singular: "batch", plural: "batches" } }),
        columns: { task: Sheet.column.text(ex.BatchStep, { header: "Step" }), qty: Sheet.column.quantity(ex.BatchStep, { header: "Qty" }) },
        templates: {
            groups: [{ key: "finishing", name: "Finishing batch", values: Sheet.patch(ex.Batch, { name: "Finishing", steps: finishing }) }],
            rows: [{ key: "sand", name: "Sand", values: Sheet.patch(ex.BatchStep, { task: "Sand", qty: none }) }],
        },
        library: [Sheet.library.rows()],
        edits: { insertRows: false, insertGroups: false },
    });
}), getRegisteredPlatformImplementations());

/** The day's batches, where the sheet's `edits` move a line only within its batch. */
const batchesMovingWithin = East.compile(East.function([], SheetPayloadType, ($) => {
    const days = $.let(Record.bind(ex.sheetBatchDays, [ex.sheetBatchDaysPatch]));
    return Sheet.Payload({
        record: days, entry: { key: "2026-10-12", rows: "batches", id: "id" }, name: "moving-within",
        group: Sheet.group(ex.Batch, "steps", { title: "name", noun: { singular: "batch", plural: "batches" } }),
        columns: { task: Sheet.column.text(ex.BatchStep, { header: "Step" }), qty: Sheet.column.quantity(ex.BatchStep, { header: "Qty" }) },
        library: [Sheet.library.rows()],
        edits: { moveRows: "within" },
    });
}), getRegisteredPlatformImplementations());

type Days = ValueTypeOf<typeof ex.sheetBatchDays.type>;
type Plans = ValueTypeOf<typeof ex.sheetWeekPlans.type>;
type Jobs = ValueTypeOf<typeof ex.sheetJobs.type>;
type Orders = ValueTypeOf<typeof ex.sheetWorkshopOrders.type>;

/** A record as it stands — what its patch door last wrote. */
function readRecord<T>(name: string, decode: (bytes: Uint8Array) => T): T {
    const bytes = harness.cache.read(WORKSPACE, [variant("field", "records"), variant("field", name)]);
    if (bytes === undefined) throw new Error(`the record ${name} has not loaded`);
    return decode(bytes);
}
const readDays = (): Days => readRecord(ex.sheetBatchDays.name, decodeBeast2For(ex.sheetBatchDays.type));
const readPlans = (): Plans => readRecord(ex.sheetWeekPlans.name, decodeBeast2For(ex.sheetWeekPlans.type));
const readJobs = (): Jobs => readRecord(ex.sheetJobs.name, decodeBeast2For(ex.sheetJobs.type));
const readOrders = (): Orders => readRecord(ex.sheetWorkshopOrders.name, decodeBeast2For(ex.sheetWorkshopOrders.type));

// ── Reading the sheet ─────────────────────────────────────────────────────

const main = (c: HTMLElement) => slot(c, "main")!;
const pane = (c: HTMLElement) => slot(c, "start")!;
/** The sheet as it reads: each band's title, `# …`, and each row's text under a column, in order — never a blank row. */
const sheetText = (c: HTMLElement, key = "task") => [...main(c).querySelectorAll<HTMLElement>('[data-slot="row"]:not([data-blank])')]
    .map((row) => (row.hasAttribute("data-band-row") ? `# ${row.querySelector('[data-slot="groupTitle"]')!.textContent}` : row.querySelector(`[data-key="${key}"]`)!.textContent));
/** A flat row, by its id. */
const rowById = (c: HTMLElement, id: string) => main(c).querySelector<HTMLElement>(`[data-slot="row"][data-row-id="${id}"]`)!;
/** A group's band, by its id. */
const bandOf = (c: HTMLElement, id: string) => main(c).querySelector<HTMLElement>(`[data-slot="row"][data-band-row][data-row-id="${id}"]`)!;
/** A group's lines, in order. */
const linesOf = (c: HTMLElement, id: string) => [...main(c).querySelectorAll<HTMLElement>(`[data-slot="row"][data-group-id="${id}"]:not([data-blank])`)];
/** A group's blank line. */
const groupEndOf = (c: HTMLElement, id: string) => main(c).querySelector<HTMLElement>(`[data-slot="row"][data-group-id="${id}"][data-blank]`)!;
/** A flat sheet's blank tail: its first blank row. */
const tailOf = (c: HTMLElement) => main(c).querySelector<HTMLElement>('[data-slot="row"][data-blank]:not([data-group-id])')!;
/** The row the ring is on. */
const ringRow = (c: HTMLElement) => main(c).querySelector('[data-slot="ring"]')?.closest<HTMLElement>('[data-slot="row"]') ?? null;
/** The rows whose drafts differ from what the record holds. */
const drafted = (c: HTMLElement) => main(c).querySelectorAll('[data-slot="row"][data-draft]').length;
/** A row's grip. */
const gripOf = (row: HTMLElement) => row.querySelector<HTMLElement>('[data-slot="rowGrip"]');
/** A library card of the open tab, by its key. */
const cardOf = (c: HTMLElement, key: string) => {
    const card = pane(c).querySelector<HTMLElement>(`[role="tabpanel"]:not([hidden]) [data-library-item="${key}"]`);
    if (card === null) throw new Error(`no card ${key}`);
    return card;
};
/** The footer's message line. */
const footerMessage = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-slot="footerMessage"]')?.textContent ?? "";

/** Opens a library tab, by its name. */
async function openTab(c: HTMLElement, name: string) {
    const tab = [...pane(c).querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no library tab ${name}`);
    fireEvent.click(tab);
    await settle();
}

/** Clicks a history button in the toolbar, as a pointer does. */
async function history(c: HTMLElement, name: "Undo" | "Redo" | "Save") {
    const button = within(slot(c, "toolbar")!).getByRole("button", { name });
    await act(async () => { fireEvent.mouseDown(button, { button: 0 }); fireEvent.click(button); });
    await settle();
}

// ── Dragging ──────────────────────────────────────────────────────────────

/** Where a row lies while a drag rests on it, and the heights of its top and bottom halves. */
const BOX = { left: 0, top: 100, width: 900, height: 40 };
const TOP = 105;
const BOTTOM = 135;

/** Picks an element up with the mouse: pressed, and carried past the 4px a drag starts after (SB38). */
function pickUp(el: HTMLElement) {
    pointAt(null);
    act(() => { fireEvent.pointerDown(el, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 }); });
    act(() => { fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 6 }); });
}

/** Rests the drag on a row's top or bottom half — or, `null`, over nothing. */
function restOn(row: HTMLElement | null, half: "top" | "bottom" = "bottom") {
    if (row === null) pointAt(null);
    else layOut(new Map([[row, BOX]]));
    act(() => { fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 400, clientY: half === "top" ? TOP : BOTTOM }); });
}

/** Drops where the drag rests, and lets the sheet settle. */
async function release(half: "top" | "bottom" = "bottom") {
    act(() => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 400, clientY: half === "top" ? TOP : BOTTOM }); });
    await settle();
}

/** What the ghost says: its caption, and whether it says why not — `null` while the ghost goes alone. */
const caption = () => {
    const el = document.querySelector("[data-drag-caption]");
    return el === null ? null : { text: el.textContent, refused: el.hasAttribute("data-refused") };
};

// ── Templates (SB38, SB39, SB40) ──────────────────────────────────────────

test("a row template dropped on a seam inserts its row there, selected, as one transaction: the ghost says where, the seam it lands on lights, and one Undo takes it back (SB38, SB39)", async () => {
    const { container } = mountPayload(weekPayload(), { drag: true });
    await settle();
    const before = ["Cut the kitchen carcasses", "Band the carcass edges", "Route the door panels"];
    expect(sheetText(container)).toEqual(before);
    pickUp(cardOf(container, "seal"));
    // Picked up, over nothing: the ghost alone.
    expect(caption()).toBeNull();
    const second = rowById(container, "w42-2");
    restOn(second, "bottom");
    expect(caption()).toEqual({ text: "after row 2", refused: false });
    expect(second.hasAttribute("data-drop-active")).toBe(true);
    expect([second.getAttribute("data-drop-at"), second.getAttribute("data-drop-seam")]).toEqual(["seam", "bottom"]);
    // The first row's top half: the seam above it — the mark moves with the drag.
    const first = rowById(container, "w42-1");
    restOn(first, "top");
    expect(caption()).toEqual({ text: "before row 1", refused: false });
    expect(first.getAttribute("data-drop-seam")).toBe("top");
    expect(second.hasAttribute("data-drop-seam")).toBe(false);
    // The blank tail: the sheet's end.
    restOn(tailOf(container), "top");
    expect(caption()).toEqual({ text: "at the end", refused: false });
    restOn(second, "bottom");
    await release();
    expect(sheetText(container)).toEqual(["Cut the kitchen carcasses", "Band the carcass edges", "Seal the doors", "Route the door panels"]);
    expect(sheetText(container, "qty")[2]).toBe("24");
    expect(announced()).toBe("Seal the doors was dropped on the gap after row 2.");
    // Selected, its editor closed; the drag's marks gone.
    expect(ringRow(container)?.querySelector('[data-key="task"]')?.textContent).toBe("Seal the doors");
    expect(document.querySelector('[data-slot="editorInput"]')).toBeNull();
    expect(main(container).querySelector("[data-drop-seam], [data-drop-at]")).toBeNull();
    // A draft — the record holds none of it — and one transaction: one Undo takes it back whole.
    expect(drafted(container)).toBe(1);
    expect(readPlans().get("2026-W42")!.rows.map((row) => row.task)).toEqual(before);
    await history(container, "Undo");
    expect(sheetText(container)).toEqual(before);
    expect(drafted(container)).toBe(0);
});

test("on a grouped sheet a row template lands as a line of the group under the pointer — beside a line, at a band's start, at a group's end — and a group template between the groups; one Save commits them (SB39, SB40)", async () => {
    const { container } = mount(ex.sheetBatches, { drag: true });
    await settle();
    const before = [
        "# Doors, oak", "Cut doors", "Band doors", "Spray doors",
        "# Carcasses, birch", "Cut carcasses", "Drill carcasses",
        "# Shelves, ash", "Cut shelves", "Sand shelves",
    ];
    expect(sheetText(container)).toEqual(before);
    // Beside a line: before the second of the first batch.
    pickUp(cardOf(container, "sand"));
    restOn(linesOf(container, "B-101")[1]!, "top");
    expect(caption()).toEqual({ text: "before line 2 of Doors, oak", refused: false });
    await release("top");
    expect(linesOf(container, "B-101").map((line) => line.querySelector('[data-key="task"]')!.textContent)).toEqual(["Cut doors", "Sand", "Band doors", "Spray doors"]);
    // On a band, whatever its half: the group's start.
    pickUp(cardOf(container, "seal"));
    restOn(bandOf(container, "B-102"), "top");
    expect(caption()).toEqual({ text: "at the start of batch 2", refused: false });
    expect(bandOf(container, "B-102").getAttribute("data-drop-seam")).toBe("bottom");
    await release("top");
    expect(linesOf(container, "B-102").map((line) => line.querySelector('[data-key="task"]')!.textContent)).toEqual(["Seal", "Cut carcasses", "Drill carcasses"]);
    // On a group's blank line: its end.
    pickUp(cardOf(container, "seal"));
    restOn(groupEndOf(container, "B-103"), "bottom");
    expect(caption()).toEqual({ text: "at the end of batch 3", refused: false });
    await release();
    expect(linesOf(container, "B-103").map((line) => line.querySelector('[data-key="task"]')!.textContent)).toEqual(["Cut shelves", "Sand shelves", "Seal"]);
    // A group template between the groups: on a band's top half, before its group — the seam above the band lights.
    pickUp(cardOf(container, "finishing"));
    restOn(bandOf(container, "B-102"), "top");
    expect(caption()).toEqual({ text: "before batch 2", refused: false });
    expect(bandOf(container, "B-102").getAttribute("data-drop-seam")).toBe("top");
    // On a group's last line, the nearer seam: after the group.
    restOn(linesOf(container, "B-103")[2]!, "bottom");
    expect(caption()).toEqual({ text: "after batch 3", refused: false });
    restOn(bandOf(container, "B-102"), "top");
    await release("top");
    // The rows the frame shows: the first batch and the new one before the second.
    expect(sheetText(container).slice(0, 10)).toEqual([
        "# Doors, oak", "Cut doors", "Sand", "Band doors", "Spray doors",
        "# Finishing", "Sand", "Seal", "Spray",
        "# Carcasses, birch",
    ]);
    // Four drops, four transactions: undone a step at a time, and redone.
    for (let i = 0; i < 4; i++) await history(container, "Undo");
    expect(sheetText(container)).toEqual(before);
    for (let i = 0; i < 4; i++) await history(container, "Redo");
    // One Save commits them all: the day as the drops left it.
    await history(container, "Save");
    expect(readDays().get("2026-10-12")!.batches.map((batch) => [batch.name, batch.steps.map((step) => step.task)])).toEqual([
        ["Doors, oak", ["Cut doors", "Sand", "Band doors", "Spray doors"]],
        ["Finishing", ["Sand", "Seal", "Spray"]],
        ["Carcasses, birch", ["Seal", "Cut carcasses", "Drill carcasses"]],
        ["Shelves, ash", ["Cut shelves", "Sand shelves", "Seal"]],
    ]);
    expect(drafted(container)).toBe(0);
});

test("on a keyed record a new group sits where its key sorts — the ghost says so — while a line still lands where it is dropped (SB14, SB39, SB40)", async () => {
    const { container } = mount(ex.sheetWorkshop, { drag: true });
    await settle();
    // A line lands beside the line it is dropped on, in its group.
    pickUp(cardOf(container, "edge"));
    restOn(linesOf(container, "WO-2201")[1]!, "top");
    expect(caption()).toEqual({ text: "before line 2 of WO-2201 · Kitchen, oak", refused: false });
    await release("top");
    expect(linesOf(container, "WO-2201").map((line) => line.querySelector('[data-key="activity"]')!.textContent))
        .toEqual(["Panel cutting", "Edge banding", "Edge banding", "CNC routing", "Assembly", "Spray finish"]);
    // A group: wherever it is dropped, a new order in key order — no seam lights.
    pickUp(cardOf(container, "kitchen"));
    restOn(bandOf(container, "WO-2202"), "top");
    expect(caption()).toEqual({ text: "a new order · in key order", refused: false });
    expect(main(container).querySelector("[data-drop-seam]")).toBeNull();
    await release("top");
    // Its minted key sorts after the order numbers: the seventh order, selected — the inspector shows it, with the template's four lines.
    const inspector = within(slot(container, "end")!);
    expect(inspector.getByText("order 7")).toBeTruthy();
    expect(inspector.getByText("4 lines")).toBeTruthy();
    expect(announced()).toBe("Kitchen order was dropped on a new order, in key order.");
});

test("a template is refused, red, where the sheet's edits add no row or no group — and dropping there changes nothing (SB39, SB40)", async () => {
    const { container } = mountPayload(batchesAddingNothing(), { drag: true });
    await settle();
    const before = sheetText(container);
    pickUp(cardOf(container, "sand"));
    const line = linesOf(container, "B-101")[0]!;
    restOn(line, "bottom");
    expect(caption()).toEqual({ text: "No new lines here", refused: true });
    expect(line.hasAttribute("data-drop-invalid")).toBe(true);
    expect(line.hasAttribute("data-drop-active")).toBe(false);
    await release();
    expect(sheetText(container)).toEqual(before);
    expect(announced()).toBe("Sand was not dropped.");
    pickUp(cardOf(container, "finishing"));
    restOn(bandOf(container, "B-102"), "top");
    expect(caption()).toEqual({ text: "No new batches here", refused: true });
    await release("top");
    expect(sheetText(container)).toEqual(before);
    expect(drafted(container)).toBe(0);
});

// ── An author's cards (SB61) ──────────────────────────────────────────────

test("an author's card sets the fields its drop patch sets on the row it lands on, as one transaction, the row selected on the field; anywhere but a row it is refused (SB61)", async () => {
    const { container } = mount(ex.sheetLibrary, { drag: true });
    await settle();
    await openTab(container, "Tasks");
    pickUp(cardOf(container, "Sanding"));
    const third = rowById(container, "J-0003");
    restOn(third, "top");
    expect(caption()).toEqual({ text: "→ row 3", refused: false });
    expect(third.getAttribute("data-drop-at")).toBe("row");
    // The blank tail is no row: refused, red.
    restOn(tailOf(container), "top");
    expect(caption()).toEqual({ text: "Drop onto a row", refused: true });
    expect(tailOf(container).hasAttribute("data-drop-invalid")).toBe(true);
    restOn(third, "bottom");
    await release();
    expect(sheetText(container)).toEqual(["Panel cutting", "Edge banding", "Sanding", "Spray finish"]);
    expect(announced()).toBe("Sanding was dropped on row 3.");
    const ring = main(container).querySelector('[data-slot="ring"]')!.closest<HTMLElement>('[data-slot="cell"]')!;
    expect([ring.closest('[data-slot="row"]')!.getAttribute("data-row-id"), ring.getAttribute("data-key")]).toEqual(["J-0003", "task"]);
    expect(drafted(container)).toBe(1);
    expect(readJobs().get("J-0003")!.task).toBe("CNC routing");
    await history(container, "Undo");
    expect(sheetText(container)).toEqual(["Panel cutting", "Edge banding", "CNC routing", "Spray finish"]);
    // Dropped on the tail, nothing.
    pickUp(cardOf(container, "Sanding"));
    restOn(tailOf(container), "top");
    await release("top");
    expect(sheetText(container)).toEqual(["Panel cutting", "Edge banding", "CNC routing", "Spray finish"]);
    expect(drafted(container)).toBe(0);
});

test("a card whose patch is over the group type lands on a band, setting the group's field as one transaction; on a line it is refused (SB61)", async () => {
    const { container } = mount(ex.sheetWorkshop, { drag: true });
    await settle();
    await openTab(container, "Statuses");
    pickUp(cardOf(container, "RELEASED"));
    restOn(linesOf(container, "WO-2202")[0]!, "bottom");
    expect(caption()).toEqual({ text: "Drop onto a band", refused: true });
    restOn(bandOf(container, "WO-2202"), "bottom");
    expect(caption()).toEqual({ text: "→ order 2", refused: false });
    expect(bandOf(container, "WO-2202").getAttribute("data-drop-at")).toBe("row");
    await release();
    expect(announced()).toBe("RELEASED was dropped on order 2.");
    expect(bandOf(container, "WO-2202").hasAttribute("data-draft")).toBe(true);
    // Its Save commits the order's status.
    await history(container, "Save");
    expect(readOrders().get("WO-2202")!.status).toBe("RELEASED");
});

// ── Moves (SB44) ──────────────────────────────────────────────────────────

test("a grip moves a step within its batch or into another, and a whole batch to another seam — each one transaction — and one Save commits them all (SB44)", async () => {
    const { container } = mount(ex.sheetBatches, { drag: true });
    await settle();
    const before = sheetText(container);
    // Every line and every band carries a grip; a blank line does not.
    expect(gripOf(linesOf(container, "B-101")[0]!)).not.toBeNull();
    expect(gripOf(bandOf(container, "B-101"))).not.toBeNull();
    expect(gripOf(groupEndOf(container, "B-101"))).toBeNull();
    // Within its batch: the third step before the first.
    pickUp(gripOf(linesOf(container, "B-101")[2]!)!);
    restOn(linesOf(container, "B-101")[0]!, "top");
    expect(caption()).toEqual({ text: "before line 1 of Doors, oak", refused: false });
    // Where it already stands, nothing moves — the ghost still says where.
    restOn(linesOf(container, "B-101")[1]!, "bottom");
    expect(caption()).toEqual({ text: "after line 2 of Doors, oak", refused: false });
    restOn(linesOf(container, "B-101")[0]!, "top");
    await release("top");
    expect(sheetText(container).slice(0, 4)).toEqual(["# Doors, oak", "Spray doors", "Cut doors", "Band doors"]);
    expect(announced()).toBe("Line 3 of Doors, oak was dropped on the gap before line 1 of Doors, oak.");
    // Into another batch: the second batch's last step, onto the third's band — its start.
    pickUp(gripOf(linesOf(container, "B-102")[1]!)!);
    restOn(bandOf(container, "B-103"), "bottom");
    expect(caption()).toEqual({ text: "at the start of batch 3", refused: false });
    await release();
    expect(sheetText(container).slice(4)).toEqual(["# Carcasses, birch", "Cut carcasses", "# Shelves, ash", "Drill carcasses", "Cut shelves", "Sand shelves"]);
    // A whole batch: the third before the first — with its lines.
    pickUp(gripOf(bandOf(container, "B-103"))!);
    restOn(bandOf(container, "B-101"), "top");
    expect(caption()).toEqual({ text: "before batch 1", refused: false });
    await release("top");
    expect(announced()).toBe("Shelves, ash was dropped on the gap before batch 1.");
    // The sheet, whole: the rows the move put above the view's top are drawn — the frame cannot scroll down to
    // keep the old first row in place, and stays at its top (#1213). The moved batch is selected.
    expect(sheetText(container)).toEqual([
        "# Shelves, ash", "Drill carcasses", "Cut shelves", "Sand shelves",
        "# Doors, oak", "Spray doors", "Cut doors", "Band doors",
        "# Carcasses, birch", "Cut carcasses",
    ]);
    expect(within(slot(container, "end")!).getByText("batch 1")).toBeTruthy();
    expect(within(slot(container, "end")!).getByText("3 lines")).toBeTruthy();
    // Three moves, three transactions: undone a step at a time, and redone.
    for (let i = 0; i < 3; i++) await history(container, "Undo");
    expect(sheetText(container)).toEqual(before);
    for (let i = 0; i < 3; i++) await history(container, "Redo");
    // Save carries every placement in one commit: the day as the moves left it.
    await history(container, "Save");
    const day = readDays().get("2026-10-12")!;
    expect(day.batches.map((batch) => [batch.id, batch.steps.map((step) => step.task)])).toEqual([
        ["B-103", ["Drill carcasses", "Cut shelves", "Sand shelves"]],
        ["B-101", ["Spray doors", "Cut doors", "Band doors"]],
        ["B-102", ["Cut carcasses"]],
    ]);
    expect(drafted(container)).toBe(0);
});

test("a flat row moves by its grip to another seam, or the end, in the planner's order (SB44)", async () => {
    const { container } = mountPayload(weekPayload(), { drag: true });
    await settle();
    pickUp(gripOf(rowById(container, "w42-1"))!);
    restOn(tailOf(container), "top");
    expect(caption()).toEqual({ text: "at the end", refused: false });
    await release("top");
    expect(sheetText(container)).toEqual(["Band the carcass edges", "Route the door panels", "Cut the kitchen carcasses"]);
    pickUp(gripOf(rowById(container, "w42-3"))!);
    restOn(rowById(container, "w42-2"), "top");
    expect(caption()).toEqual({ text: "before row 1", refused: false });
    await release("top");
    expect(sheetText(container)).toEqual(["Route the door panels", "Band the carcass edges", "Cut the kitchen carcasses"]);
    await history(container, "Save");
    expect(readPlans().get("2026-W42")!.rows.map((row) => row.id)).toEqual(["w42-3", "w42-2", "w42-1"]);
});

test("a move is refused, red, where the sheet's edits keep the lines in their groups; a keyed record's rows and groups have no grip (SB44)", async () => {
    const narrowed = mountPayload(batchesMovingWithin(), { drag: true });
    await settle();
    const c = narrowed.container;
    const before = sheetText(c);
    pickUp(gripOf(linesOf(c, "B-101")[0]!)!);
    restOn(linesOf(c, "B-102")[0]!, "bottom");
    expect(caption()).toEqual({ text: "Lines move only within batch 1", refused: true });
    await release();
    expect(sheetText(c)).toEqual(before);
    narrowed.unmount();
    // Jobs in key order: no row moves.
    const jobs = mount(ex.sheetBasic, { drag: true });
    await settle();
    expect(main(jobs.container).querySelector('[data-slot="rowGrip"]')).toBeNull();
    jobs.unmount();
    // Orders in key order: lines move, orders do not.
    const workshop = mount(ex.sheetWorkshop, { drag: true });
    await settle();
    expect(gripOf(linesOf(workshop.container, "WO-2201")[0]!)).not.toBeNull();
    expect(gripOf(bandOf(workshop.container, "WO-2201"))).toBeNull();
});

// ── ⏎ on a card (SB45) ────────────────────────────────────────────────────

test("⏎ on a template inserts it below the ring's row, as a drop there would; on an author's card it sets its fields on the ring's row; refused, the footer says why (SB45)", async () => {
    const week = mountPayload(weekPayload(), { drag: true });
    await settle();
    // The ring on the first row; ⏎ on the template's card.
    fireEvent.mouseDown(rowById(week.container, "w42-1").querySelector('[data-key="task"]')!, { button: 0 });
    await settle();
    const seal = cardOf(week.container, "seal");
    seal.focus();
    fireEvent.keyDown(seal, { key: "Enter", code: "Enter" });
    await settle();
    expect(sheetText(week.container)).toEqual(["Cut the kitchen carcasses", "Seal the doors", "Band the carcass edges", "Route the door panels"]);
    expect(ringRow(week.container)?.querySelector('[data-key="task"]')?.textContent).toBe("Seal the doors");
    // Never picked up: the card is not carried.
    expect(seal.hasAttribute("data-dragging")).toBe(false);
    week.unmount();
    // An author's card: its fields on the ring's row.
    const library = mount(ex.sheetLibrary, { drag: true });
    await settle();
    fireEvent.mouseDown(rowById(library.container, "J-0002").querySelector('[data-key="qty"]')!, { button: 0 });
    await settle();
    await openTab(library.container, "Tasks");
    fireEvent.keyDown(cardOf(library.container, "Sanding"), { key: "Enter", code: "Enter" });
    await settle();
    expect(sheetText(library.container)).toEqual(["Panel cutting", "Sanding", "CNC routing", "Spray finish"]);
    library.unmount();
    // A status on a line: refused, and the footer says why.
    const workshop = mount(ex.sheetWorkshop, { drag: true });
    await settle();
    fireEvent.mouseDown(linesOf(workshop.container, "WO-2202")[0]!.querySelector('[data-key="notes"]')!, { button: 0 });
    await settle();
    await openTab(workshop.container, "Statuses");
    fireEvent.keyDown(cardOf(workshop.container, "RELEASED"), { key: "Enter", code: "Enter" });
    await settle();
    expect(footerMessage(workshop.container)).toBe("Drop onto a band");
    expect(drafted(workshop.container)).toBe(0);
});
