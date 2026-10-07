/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Sheet>` over one entry's groups with LOOSE rows between them (#846,
 * #1216): the week's entries are `Sheet.Types.Entry(Package, "tasks")`, each a
 * work package with its tasks or a task of no package, as `sheetLoose`
 * declares them. A loose task is a plain row numbered in the packages'
 * sequence, Details shows it as a row — the sheet given the inspector pane —
 * Alt+Insert beside it adds another with a minted id, and a grip moves it, or
 * a package with its tasks, between the entries; one Save commits each to
 * the record.
 */

import { test, expect } from "vitest";
import { act, fireEvent, within } from "@testing-library/react";
import { East, decodeBeast2For, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { announced, layOut, pointAt, stubScrollIntoView } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { WORKSPACE, sheetHarness, mount, mountPayload, settle, slot } from "./harness.test-utils.js";

const harness = sheetHarness();
stubScrollIntoView();

type Work = ValueTypeOf<typeof ex.sheetLooseWork.type>;
const entryEqual = equalFor(ex.LooseEntry);

/** The week's work as `sheetLoose` declares it, given the inspector pane: Details for a loose task, and the batch's Issues. */
const inspected = East.compile(East.function([], SheetPayloadType, ($) => {
    const work = $.let(Record.bind(ex.sheetLooseWork, [ex.sheetLooseWorkPatch]));
    const newTask = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(ex.LooseTask), () => Sheet.patch(ex.LooseTask, { qty: none, notes: "" })));
    const newPackage = $.const(East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(ex.LoosePackage), () => Sheet.patch(ex.LoosePackage, { tasks: [] })));
    return Sheet.Payload({
        record: work,
        entry: { key: "2026-W42", rows: "entries", id: "id" },
        group: Sheet.group(ex.LoosePackage, "tasks", { title: "name", noun: { singular: "package", plural: "packages" } }),
        name: "loose",
        columns: {
            task:  Sheet.column.text(ex.LooseTask, { header: "Task", width: "240px" }),
            qty:   Sheet.column.quantity(ex.LooseTask, { header: "Qty", width: "96px" }),
            notes: Sheet.column.text(ex.LooseTask, { header: "Notes", width: "260px" }),
        },
        newRow: newTask,
        newGroup: newPackage,
        inspector: true,
    });
}), getRegisteredPlatformImplementations());

/** The record as it stands — what its patch door last wrote. */
function readWork(): Work {
    const bytes = harness.cache.read(WORKSPACE, [variant("field", "records"), variant("field", ex.sheetLooseWork.name)]);
    if (bytes === undefined) throw new Error("the record has not loaded");
    return decodeBeast2For(ex.sheetLooseWork.type)(bytes);
}
/** The week's entries, each its id, as the record holds them. */
const entryIds = () => readWork().get("2026-W42")!.entries.map((entry) => entry.value.id);

const main = (c: HTMLElement) => slot(c, "main")!;
/** The sheet as it reads: each band's title, `# …`, and each row's task, in order — never a blank row. */
const sheetText = (c: HTMLElement) => [...main(c).querySelectorAll<HTMLElement>('[data-slot="row"]:not([data-blank])')]
    .map((row) => (row.hasAttribute("data-band-row") ? `# ${row.querySelector('[data-slot="groupTitle"]')!.textContent}` : row.querySelector('[data-key="task"]')!.textContent));
/** Each row as the gutter numbers it: its number, then what it is — a band's title, a line's or a loose row's task. */
const numbered = (c: HTMLElement) => [...main(c).querySelectorAll<HTMLElement>('[data-slot="row"]:not([data-blank])')]
    .map((row) => `${row.querySelector('[data-slot="gutter"]')!.textContent} ${row.hasAttribute("data-band-row") ? `# ${row.querySelector('[data-slot="groupTitle"]')!.textContent}` : row.querySelector('[data-key="task"]')!.textContent}`);
/** A loose row or a band, by its entry's id. */
const entryRow = (c: HTMLElement, id: string) => main(c).querySelector<HTMLElement>(`[data-slot="row"][data-row-id="${id}"]`)!;
/** A package's lines, in order. */
const linesOf = (c: HTMLElement, id: string) => [...main(c).querySelectorAll<HTMLElement>(`[data-slot="row"][data-group-id="${id}"]:not([data-blank])`)];
/** A row's grip. */
const gripOf = (row: HTMLElement) => row.querySelector<HTMLElement>('[data-slot="rowGrip"]')!;
/** The inspector's open panel. */
const panel = (c: HTMLElement) => slot(c, "end")!.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;

/** Clicks a history button in the toolbar, as a pointer does. */
async function history(c: HTMLElement, name: "Undo" | "Save") {
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

test("the week's entries in the planner's order: a loose task a plain row numbered in the packages' sequence, a package its band and its tasks; Details on a loose task is its own row, under the entry's id", async () => {
    const { container } = mountPayload(inspected());
    await settle();
    expect(numbered(container)).toEqual([
        "1 Check the drawings",
        "2 # Kitchen doors", "1 Cut door blanks", "2 Inspect the blanks",
        "3 Hand over to finishing",
        "4 # Door finishing", "1 Spray the doors",
    ]);
    // No library is listed: no start pane.
    expect(slot(container, "start")).toBeNull();
    fireEvent.mouseDown(entryRow(container, "brief").querySelector('[data-key="task"]')!, { button: 0 });
    await settle();
    expect(panel(container).querySelector("[data-sheet-inspector]")!.getAttribute("data-sheet-inspector")).toBe("row");
    expect([panel(container).querySelector("[data-inspector-what]")!.textContent, panel(container).querySelector("[data-inspector-id]")!.textContent])
        .toEqual(["row 1", "brief"]);
    expect([...panel(container).querySelectorAll("[data-field]")].map((el) => `${el.getAttribute("data-field")}:${el.getAttribute("data-editor")}`))
        .toEqual(["task:text", "qty:number", "notes:text"]);
});

test("Alt+Insert beside a loose task adds a loose task after it, its id minted; typed and saved, the record holds it as an entry in its place, in one commit", async () => {
    const { container } = mount(ex.sheetLoose);
    await settle();
    fireEvent.mouseDown(entryRow(container, "brief").querySelector('[data-key="task"]')!, { button: 0 });
    await settle();
    const grid = main(container).querySelector<HTMLElement>('[role="grid"]')!;
    grid.focus();
    fireEvent.keyDown(grid, { key: "Insert", altKey: true });
    await settle();
    // The new row is a loose row after the first, its task still to be typed — the rows after it renumbered.
    const added = main(container).querySelectorAll<HTMLElement>('[data-slot="row"]:not([data-blank])')[1]!;
    expect(added.hasAttribute("data-group-id")).toBe(false);
    const minted = added.getAttribute("data-row-id")!;
    expect(["brief", "doors", "handover", "finish", ""]).not.toContain(minted);
    expect(numbered(container).slice(2, 3)).toEqual(["3 # Kitchen doors"]);
    // Its task still missing, it is the batch's one issue.
    expect(within(slot(container, "toolbar")!).getByRole("button", { name: "1 issue" })).toBeTruthy();
    // Typed: the ring is on its task.
    fireEvent.keyDown(grid, { key: "M" });
    await settle();
    const input = main(container).querySelector<HTMLInputElement>('[data-slot="editorInput"]')!;
    fireEvent.input(input, { target: { value: "Measure the site" } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    expect(sheetText(container)[1]).toBe("Measure the site");
    expect(within(slot(container, "toolbar")!).getByRole("button", { name: "0 issues" })).toBeTruthy();
    await history(container, "Save");
    // An entry of its own, between the first and the first package — `newRow`'s defaults under what was typed.
    const entries = readWork().get("2026-W42")!.entries;
    expect(entries.map((entry) => entry.value.id)).toEqual(["brief", minted, "doors", "handover", "finish"]);
    expect(entryEqual(entries[1]!, variant("row", { id: minted, task: "Measure the site", qty: none, notes: "" }))).toBe(true);
    const { commits } = await harness.memory.history(WORKSPACE, ex.sheetLooseWork.name, undefined);
    expect(commits.map((c) => c.mutation)).toEqual(["patch", "$init"]);
    expect(main(container).querySelectorAll('[data-slot="row"][data-draft]').length).toBe(0);
});

test("Alt+Insert beside a package's task adds a task in the package, its id minted as a loose task's is — the field both are identified by; typed, it saves", async () => {
    const { container } = mount(ex.sheetLoose);
    await settle();
    fireEvent.mouseDown(linesOf(container, "doors")[0]!.querySelector('[data-key="task"]')!, { button: 0 });
    await settle();
    const grid = main(container).querySelector<HTMLElement>('[role="grid"]')!;
    grid.focus();
    fireEvent.keyDown(grid, { key: "Insert", altKey: true });
    await settle();
    expect(linesOf(container, "doors")).toHaveLength(3);
    fireEvent.keyDown(grid, { key: "S" });
    await settle();
    const input = main(container).querySelector<HTMLInputElement>('[data-slot="editorInput"]')!;
    fireEvent.input(input, { target: { value: "Sand the blanks" } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    expect(linesOf(container, "doors").map((line) => line.querySelector('[data-key="task"]')!.textContent))
        .toEqual(["Cut door blanks", "Sand the blanks", "Inspect the blanks"]);
    // Complete — its id minted — so Save is free to commit it.
    await history(container, "Save");
    const doors = readWork().get("2026-W42")!.entries[1]!;
    if (doors.type !== "group") throw new Error(`expected the package, got a ${doors.type}`);
    const minted = doors.value.tasks[1]!.id;
    expect(["", "doors-1", "doors-2", "brief", "handover"]).not.toContain(minted);
    expect(entryEqual(doors, variant("group", { id: "doors", name: "Kitchen doors", tasks: [
        { id: "doors-1", task: "Cut door blanks", qty: some(24.0), notes: "Oak veneered board" },
        { id: minted, task: "Sand the blanks", qty: none, notes: "" },
        { id: "doors-2", task: "Inspect the blanks", qty: some(4.0), notes: "Before finishing" },
    ] }))).toBe(true);
});

test("a loose task's grip moves it between the entries — over a package, to the seam before it — and a package's moves it with its tasks; a line stays in its package; one Save commits the order", async () => {
    const { container } = mount(ex.sheetLoose, { drag: true });
    await settle();
    // The loose task before the last: over the first package's band, either half, or one of its lines — the seam before the package.
    pickUp(gripOf(entryRow(container, "handover")));
    restOn(entryRow(container, "doors"), "top");
    expect(caption()).toEqual({ text: "before package 2", refused: false });
    restOn(entryRow(container, "doors"), "bottom");
    expect(caption()).toEqual({ text: "before package 2", refused: false });
    restOn(linesOf(container, "doors")[0]!, "top");
    expect(caption()).toEqual({ text: "before package 2", refused: false });
    // Beside another loose task, either side of it.
    restOn(entryRow(container, "brief"), "top");
    expect(caption()).toEqual({ text: "before row 1", refused: false });
    restOn(entryRow(container, "brief"), "bottom");
    expect(caption()).toEqual({ text: "after row 1", refused: false });
    restOn(entryRow(container, "doors"), "top");
    await release("top");
    expect(sheetText(container)).toEqual([
        "Check the drawings", "Hand over to finishing", "# Kitchen doors", "Cut door blanks", "Inspect the blanks", "# Door finishing", "Spray the doors",
    ]);
    expect(announced()).toBe("Row 3 was dropped on the gap before package 2.");
    // The last package, with its task, before the first loose task.
    pickUp(gripOf(entryRow(container, "finish")));
    restOn(entryRow(container, "brief"), "top");
    expect(caption()).toEqual({ text: "before row 1", refused: false });
    await release("top");
    expect(sheetText(container)).toEqual([
        "# Door finishing", "Spray the doors", "Check the drawings", "Hand over to finishing", "# Kitchen doors", "Cut door blanks", "Inspect the blanks",
    ]);
    // A line out of its package, onto a loose task's seam: refused, and nothing moves.
    pickUp(gripOf(linesOf(container, "doors")[1]!));
    restOn(entryRow(container, "handover"), "bottom");
    expect(caption()).toEqual({ text: "A line stays in a package", refused: true });
    await release("bottom");
    expect(announced()).toBe("Line 2 of Kitchen doors was not dropped.");
    expect(linesOf(container, "doors")).toHaveLength(2);
    // Two moves, one Save: the entries in their new order, the package's tasks with it.
    await history(container, "Save");
    expect(entryIds()).toEqual(["finish", "brief", "handover", "doors"]);
    // The package moved whole: as it was seeded, its task inside it.
    const seeded = ex.sheetLooseWork.default!.get("2026-W42")!.entries[3]!;
    expect(entryEqual(readWork().get("2026-W42")!.entries[0]!, seeded)).toBe(true);
});
