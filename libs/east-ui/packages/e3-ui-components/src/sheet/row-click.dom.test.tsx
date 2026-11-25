/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A click on a row (east-workspace#1727), as the grid reports it to the app's
 * `onRowClick`: a press and its release on a row's cell — on a row already
 * selected too — or on its number, the row by its id, a line's place among its
 * group's lines and the column clicked; a band's, its group's. A release is
 * judged where the press was: one there clicks whatever the press drew over the
 * cell by then, and a press and its release in one task, as a script sends
 * them, keep the press's own effects beside the click. And every press that is
 * none: a double click's second, ⇧, a drag across the cells, a release
 * elsewhere or never heard — the window losing the page, a move with no button
 * held — a pick of the row's box, an action cell's controls, a band's fold, a
 * line's sub rows' chevron, a blank padding row — and every key. A read-only
 * sheet's rows click as any. What the app hears with the row's key at its own
 * type is e3-ui's (`sheet-row-click.spec.ts`); here the spy hears the grid's
 * click itself. jsdom lays nothing out: a test that tells a release inside the
 * cell pressed from one outside it gives the cell its box.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { ArrayType, East, NullType, OptionType, StringType, StructType, VariantType, equalFor, none, printFor, some, variant } from "@elaraai/east";
import { Sheet, SheetPayloadType, SheetRowClickType } from "@elaraai/e3-ui/internal";
import { system, UIStore, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { EastChakraSheet, type SheetValue } from "./frame/index.js";
import { boundFrame, placeAt } from "./frame.test-utils.js";
import { sheetJournal } from "./journal.test-utils.js";
import type { SheetRowClickValue } from "./values.js";

// The frame tall enough that every row of these sheets is mounted.
let restoreFrame: () => void = () => {};
beforeEach(() => { localStorage.clear(); initializeStore(new UIStore()); restoreFrame = boundFrame(2000); });
afterEach(() => { cleanup(); restoreFrame(); });

// jsdom lacks the ResizeObserver the frame watches its width with.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

/** A job: its task, who owns it, and its state — an action column's variant. */
const JobState = VariantType({ started: NullType, finished: NullType });
const JobType = StructType({ id: StringType, task: StringType, owner: StringType, state: OptionType(JobState) });
const JOBS = [
    { id: "j0", task: "Cut", owner: "planner", state: none },
    { id: "j1", task: "Drill", owner: "planner", state: some(variant("started", null)) },
    { id: "j2", task: "Pack", owner: "erp", state: none },
];
const jobsOf = (readOnly: boolean) => East.function([], SheetPayloadType, ($) => {
    const jobs = $.const(JOBS, ArrayType(JobType));
    return Sheet.Payload({
        data: jobs,
        id: "id",
        blanks: 2,
        readOnly,
        columns: {
            task: Sheet.column.text(JobType, { header: "Task" }),
            owner: Sheet.column.text(JobType, { header: "Owner" }),
            state: Sheet.column.action(JobType, JobState, {
                header: "State",
                start: ["started"],
                cases: {
                    started: { label: "Start", state: "Started", tone: "info", next: ["finished"] },
                    finished: { label: "Finish", state: "Finished", tone: "success" },
                },
            }),
        },
    });
});

/** Two plans, each a group of lines; the first plan's second line with an operation as its sub row. */
const OpType = StructType({ code: StringType, name: StringType });
const LineType = StructType({ task: StringType, ops: ArrayType(OpType) });
const PlanType = StructType({ id: StringType, name: StringType, lines: ArrayType(LineType) });
const PLANS = [
    { id: "P0", name: "Plan 0", lines: [{ task: "Cut", ops: [] }, { task: "Fit", ops: [{ code: "FIT", name: "Fit the doors" }] }, { task: "Pack", ops: [] }] },
    { id: "P1", name: "Plan 1", lines: [{ task: "Sand", ops: [] }] },
];
const GROUPED = East.function([], SheetPayloadType, ($) => {
    const plans = $.const(PLANS, ArrayType(PlanType));
    return Sheet.Payload({
        data: plans,
        id: "id",
        columns: { task: Sheet.column.text(LineType, { header: "Task" }) },
        group: Sheet.group(PlanType, "lines", { title: "name" }),
        subRows: Sheet.subRows(LineType, { ops: (op) => Sheet.subRow({ code: op.code, name: op.name }) }),
    });
});

// Compiled once; each test gives its sheet an edit channel of its own (`sheetJournal`), so the sheet is writable.
const jobsSheet = East.compile(jobsOf(false), getRegisteredPlatformImplementations());
const readOnlySheet = East.compile(jobsOf(true), getRegisteredPlatformImplementations());
const groupedSheet = East.compile(GROUPED, getRegisteredPlatformImplementations());

const clicksEqual = equalFor(ArrayType(SheetRowClickType));
const printClicks = printFor(ArrayType(SheetRowClickType));

/** The click a row's cell reports: the row's id, a line's place, and the column; `column` undefined for the row's number. */
const clickOf = (rowId: string, column: string | undefined, index?: bigint): SheetRowClickValue =>
    ({ rowId, index: index === undefined ? none : some(index), column: column === undefined ? none : some(column) });

/** Mounts a sheet whose `onRowClick` keeps every click the grid reports. */
function mount(sheet: SheetValue) {
    const journal = sheetJournal(sheet);
    const heard: SheetRowClickValue[] = [];
    const value: SheetValue = {
        ...journal.value,
        sheet: { ...journal.value.sheet, onRowClick: some((click: SheetRowClickValue) => { heard.push(click); return null; }) } as SheetValue["sheet"],
    };
    const ui = render(
        <ChakraProvider value={system}>
            <EastChakraSheet value={value} storageKey="row-click-test" />
        </ChakraProvider>,
    );
    const card = ui.container.querySelector("[data-sheet-card]") as HTMLElement;
    /** A row — a flat row, or a band — by its id. */
    const row = (id: string) => card.querySelector<HTMLElement>(`[data-slot="row"][data-row-id="${id}"]`)!;
    /** A row's cell under a column. */
    const cell = (id: string, key: string) => row(id).querySelector<HTMLElement>(`[data-slot="cell"][data-key="${key}"]`)!;
    /** A line of a group, by its group and its place among the group's lines. */
    const line = (group: string, index: number) => card.querySelectorAll<HTMLElement>(`[data-slot="row"][data-group-id="${group}"][data-line]`)[index]!;
    /** The microtasks the grid calls the app in, and the renders they cause. */
    const flush = () => act(async () => { await new Promise<void>((r) => queueMicrotask(r)); await new Promise<void>((r) => queueMicrotask(r)); });
    /** A press of the primary button on an element and its release there, as a browser sends them: the `detail`th press of a run. */
    const click = async (el: Element, detail = 1, init: MouseEventInit = {}) => {
        fireEvent.mouseDown(el, { button: 0, detail, ...init });
        fireEvent.mouseUp(el, { button: 0, detail, ...init });
        fireEvent.click(el, { button: 0, detail, ...init });
        await flush();
    };
    /** What the app has heard, against what it should: the test names every click it heard. */
    const expectHeard = (expected: SheetRowClickValue[]) => expect(clicksEqual(heard, expected), printClicks(heard)).toBe(true);
    return { ...ui, card, row, cell, line, flush, click, expectHeard };
}

describe("a click on a row (east-workspace#1727)", () => {
    test("a press and its release on a row's cell report the row and the column, once; on the cell already ringed, again (RC1, RC2)", async () => {
        const m = mount(jobsSheet());
        await m.click(m.cell("j1", "task"));
        m.expectHeard([clickOf("j1", "task")]);
        await m.click(m.cell("j1", "task"));
        await m.click(m.cell("j2", "owner"));
        m.expectHeard([clickOf("j1", "task"), clickOf("j1", "task"), clickOf("j2", "owner")]);
    });

    test("a press on a row's number reports its row and no column (RC3); a pick of its box ticks it, and reports nothing", async () => {
        const m = mount(jobsSheet());
        await m.click(m.row("j0").querySelector('[data-slot="gutterNumber"]')!);
        m.expectHeard([clickOf("j0", undefined)]);
        await m.click(m.row("j2").querySelector('[data-slot="checkbox"]')!);
        expect(m.row("j2").hasAttribute("data-picked")).toBe(true);
        m.expectHeard([clickOf("j0", undefined)]);
    });

    test("a double click reports its first click alone, and opens the editor (RC5)", async () => {
        const m = mount(jobsSheet());
        const task = m.cell("j0", "task");
        await m.click(task, 1);
        await m.click(task, 2);
        fireEvent.doubleClick(task);
        await m.flush();
        expect(m.card.querySelector('[data-slot="editorInput"]')).not.toBeNull();
        m.expectHeard([clickOf("j0", "task")]);
    });

    test("⇧, a drag across the cells and a release elsewhere report nothing, nor a press whose release is never heard (RC6)", async () => {
        const m = mount(jobsSheet());
        await m.click(m.cell("j0", "task"));
        // ⇧ stretches the range.
        await m.click(m.cell("j2", "task"), 1, { shiftKey: true });
        // A drag into the next row's cell stretches the range too.
        fireEvent.mouseDown(m.cell("j1", "task"), { button: 0, detail: 1 });
        fireEvent.mouseMove(window, { buttons: 1 });
        fireEvent.mouseEnter(m.cell("j2", "task"));
        fireEvent.mouseUp(m.cell("j2", "task"), { button: 0 });
        await m.flush();
        // Pressed on one cell, released on another: below it, where the next row's cell lies.
        placeAt(m.cell("j1", "owner"), { left: 200, top: 32, width: 100, height: 32 });
        fireEvent.mouseDown(m.cell("j1", "owner"), { button: 0, detail: 1, clientX: 250, clientY: 48 });
        fireEvent.mouseUp(m.cell("j2", "owner"), { button: 0, clientX: 250, clientY: 80 });
        await m.flush();
        // Pressed, and the window losing the page before the release.
        fireEvent.mouseDown(m.cell("j1", "owner"), { button: 0, detail: 1 });
        fireEvent.blur(window);
        fireEvent.mouseUp(m.cell("j1", "owner"), { button: 0 });
        await m.flush();
        m.expectHeard([clickOf("j0", "task")]);
    });

    test("a release where the press was clicks its row, whatever the press drew over the cell by then — the release lands on that — and one away from the cell clicks nothing (RC6)", async () => {
        const m = mount(jobsSheet());
        const task = m.cell("j1", "task");
        placeAt(task, { left: 0, top: 32, width: 120, height: 32 });
        // What a press may draw over its cell — Details' scrim, a phone's bottom editor, a sticky line's row revealed in
        // its copy's place — takes the release.
        const over = document.body.appendChild(document.createElement("div"));
        try {
            fireEvent.mouseDown(task, { button: 0, detail: 1, clientX: 60, clientY: 48 });
            fireEvent.mouseUp(over, { button: 0, clientX: 60, clientY: 48 });
            await m.flush();
            m.expectHeard([clickOf("j1", "task")]);
            fireEvent.mouseDown(task, { button: 0, detail: 1, clientX: 60, clientY: 48 });
            fireEvent.mouseUp(over, { button: 0, clientX: 60, clientY: 200 });
            await m.flush();
            m.expectHeard([clickOf("j1", "task")]);
        } finally {
            over.remove();
        }
    });

    test("a press whose lift is never heard — a move with the button no longer held, mid-press — clicks nothing (RC6)", async () => {
        const m = mount(jobsSheet());
        fireEvent.mouseDown(m.cell("j1", "owner"), { button: 0, detail: 1 });
        fireEvent.mouseMove(window, { buttons: 0 });
        fireEvent.mouseUp(m.cell("j1", "owner"), { button: 0 });
        await m.flush();
        m.expectHeard([]);
    });

    test("a press and its release in one task, as a script sends them: the press's own effects run beside the click — its commit of the open editor, and the grid's focus (RC6)", async () => {
        const m = mount(jobsSheet());
        await m.click(m.cell("j0", "task"));
        fireEvent.keyDown(m.card, { key: "x" });
        await m.flush();
        expect(m.card.querySelector('[data-slot="editorInput"]')).not.toBeNull();
        await act(async () => {
            fireEvent.mouseDown(m.cell("j1", "owner"), { button: 0, detail: 1 });
            fireEvent.mouseUp(m.cell("j1", "owner"), { button: 0, detail: 1 });
        });
        await m.flush();
        expect(m.cell("j0", "task").textContent).toBe("x");
        expect(document.activeElement).toBe(m.card);
        m.expectHeard([clickOf("j0", "task"), clickOf("j1", "owner")]);
    });

    test("an action cell's controls take their own press, and report nothing; a press elsewhere in the cell clicks its row (RC9)", async () => {
        const m = mount(jobsSheet());
        const state = m.cell("j0", "state");
        await m.click(state.querySelector('[data-slot="actionNext"]')!);
        m.expectHeard([]);
        await m.click(state);
        m.expectHeard([clickOf("j0", "state")]);
    });

    test("no key clicks a row — the arrows, Tab, ⏎, Space, F2, esc (RC11)", async () => {
        const m = mount(jobsSheet());
        await m.click(m.cell("j0", "task"));
        for (const key of ["ArrowDown", "ArrowRight", "Tab", "Enter", "Escape", " ", "F2", "Escape"]) {
            fireEvent.keyDown(m.card, { key });
            await m.flush();
        }
        m.expectHeard([clickOf("j0", "task")]);
    });

    test("a blank padding row is no row: a press on it reports nothing (RC14)", async () => {
        const m = mount(jobsSheet());
        const blank = m.card.querySelector<HTMLElement>('[data-slot="row"][data-blank] [data-slot="cell"][data-key="task"]')!;
        await m.click(blank);
        m.expectHeard([]);
    });

    test("a read-only sheet's rows click as any (RC15)", async () => {
        const m = mount(readOnlySheet());
        await m.click(m.cell("j2", "owner"));
        m.expectHeard([clickOf("j2", "owner")]);
    });

    test("on a grouped sheet, a line reports its group's id and its place among the group's lines; a band, its group's id and none (RC4)", async () => {
        const m = mount(groupedSheet());
        await m.click(m.line("P0", 2).querySelector('[data-slot="cell"][data-key="task"]')!);
        await m.click(m.cell("P1", "$title"));
        await m.click(m.row("P1").querySelector('[data-slot="gutterNumber"]')!);
        m.expectHeard([clickOf("P0", "task", 2n), clickOf("P1", "$title"), clickOf("P1", undefined)]);
    });

    test("on a grouped sheet, a press that commits an editor open on a group's blank line clicks the line it pressed, and leaves the ring on it — the new line above moving both down", async () => {
        const m = mount(groupedSheet());
        // "x" typed into P0's blank line; P1's line 0 pressed and released: the commit adds P0's new line above it.
        await m.click(m.card.querySelector('[data-slot="row"][data-group-id="P0"][data-blank] [data-slot="cell"][data-key="task"]')!);
        fireEvent.keyDown(m.card, { key: "x" });
        await m.flush();
        await m.click(m.line("P1", 0).querySelector('[data-slot="cell"][data-key="task"]')!);
        expect(m.line("P0", 3).querySelector('[data-slot="cell"][data-key="task"]')?.textContent).toBe("x");
        m.expectHeard([clickOf("P1", "task", 0n)]);
        // The ring on the line pressed — where the band stands now, it would edit the band.
        const ringed = document.getElementById(m.card.getAttribute("aria-activedescendant") ?? "");
        expect(ringed !== null && m.line("P1", 0).contains(ringed)).toBe(true);
    });

    test("a press whose commit moves no row leaves the ring to the sheet's next write: ⏎ in a row typed at the end takes it onto the blank row under the new one", async () => {
        const m = mount(jobsSheet());
        const editor = () => m.card.querySelector<HTMLElement>('[data-slot="editorInput"]');
        // j0's task typed over with what it holds, and committed by a press on j1's: the write changes no cell, nor any row.
        await m.click(m.cell("j0", "task"));
        fireEvent.keyDown(m.card, { key: "C" });
        await m.flush();
        fireEvent.input(editor()!, { target: { value: "Cut" } });
        await m.flush();
        await m.click(m.cell("j1", "task"));
        expect([editor(), m.cell("j0", "task").textContent]).toEqual([null, "Cut"]);
        // "x" typed into the first blank row, and ⏎: the sheet's fourth row, the ring down onto the blank row under it.
        await m.click(m.card.querySelector('[data-slot="row"][data-blank] [data-slot="cell"][data-key="task"]')!);
        fireEvent.keyDown(m.card, { key: "x" });
        await m.flush();
        fireEvent.keyDown(editor()!, { key: "Enter" });
        await m.flush();
        const ringed = document.getElementById(m.card.getAttribute("aria-activedescendant") ?? "");
        const blank = m.card.querySelector('[data-slot="row"][data-blank]')!;
        expect([
            m.card.querySelectorAll('[data-slot="row"]:not([data-blank])').length,
            ringed !== null && blank.contains(ringed),
            ringed?.closest("[data-key]")?.getAttribute("data-key"),
        ]).toEqual([4, true, "task"]);
    });

    test("on a grouped sheet, a press on a band that commits an editor open on an earlier group's blank line clicks the band", async () => {
        const m = mount(groupedSheet());
        await m.click(m.card.querySelector('[data-slot="row"][data-group-id="P0"][data-blank] [data-slot="cell"][data-key="task"]')!);
        fireEvent.keyDown(m.card, { key: "y" });
        await m.flush();
        await m.click(m.cell("P1", "$title"));
        m.expectHeard([clickOf("P1", "$title")]);
    });

    test("a band's fold and a line's sub rows' chevron take their own press, and report nothing (RC10)", async () => {
        const m = mount(groupedSheet());
        await m.click(m.line("P0", 1).querySelector('[data-slot="subRowChevron"]')!);
        expect(m.card.querySelector('[data-slot="subRow"]')).not.toBeNull();
        await m.click(m.row("P1").querySelector('[data-slot="fold"]')!);
        expect(m.row("P1").hasAttribute("data-folded")).toBe(true);
        m.expectHeard([]);
    });
});
