/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Record's grid (#1531, `Record - DX Proposal.md`): the frame (FR1), the
 * rows and the header in the Table's anatomy (GR1, HD1–HD3), the select
 * column (SL1), the empty state (EM1), the states (ST4–ST9), the pointer
 * (P1–P6) and the keys (K1–K6) — the Sheet's grid drawing the Record's rows,
 * header and select column through its host (decision 8) — its cells
 * (#1532, C1–C11), the grid on a phone (#1536): the title pinned, the
 * Sheet's pager over the other columns, no select column — and its chrome
 * (#1533): the toolbar and its fold, Add, Delete and the history's steps in
 * the status line (FR2–FR7, AD1–AD7), the strip's words (SP1–SP7) and the
 * footer (FT1, FT2) — and its inspector (#1534): Details by column group, the
 * one-line field, the facts, Duplicate and Delete, the stats with no row, and
 * the Issues tab (IN2–IN9) — and the app's part (#1527): a refusal of its
 * `ready` listed and reachable (#1525), and a new row's fields its `newRow`
 * gives (#1526) — and a cycle over a variant (`Record Columns From Data - DX
 * Proposal.md` §2.3): its steps in their order, in the grid and Details, and
 * Apply writing the case — and columns from data (§5.2, §5.3, #1559): their
 * cells read at the Record's day over a row's entry or its draft, an edit
 * written over the field, two columns on one field chaining in one gesture,
 * Save's difference of each field, a conflict ringing the member's cell it
 * falls on, the data moving under them and the day turning — and marks and
 * locks (§4, §5.3, #1560): a note and a lock drawn in a cell, a plain
 * column's mark over its row, a lock refusing every gesture
 * and lifting as the draft it reads changes — but standing while that draft
 * isn't whole, and over a row whose marks can't be read — and a clear refused
 * where a cell's value isn't an option — and columns from data in the side panel
 * (§4, #1561): each member a line in its group's section, the field they
 * write no field of its own, a locked line read only with its lock's words,
 * and a line's edit drafting as the grid's does — over the Record's examples
 * deployed to e3 itself, each test a workspace of its own.
 */

import { describe, expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArrayType, DateTimeType, East, IntegerType, OptionType, StringType, StructType, equalFor, none, printFor, some, variant } from "@elaraai/east";
import { Reactive, RecordSlicesChromeType, Slice, UIComponentType, recordSlicesChrome } from "@elaraai/east-ui/internal";
import { editingMessages, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Record, Sheet } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/record/record";
import { reloadPage, width } from "../e3-web-mount.test-utils.js";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
import { boundFrame, frameScrolls, offsetOf, overlaidFrame, touchFrame } from "../sheet/frame.test-utils.js";
import { offering } from "../shared/schedule/keys.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record": ex }, frame: 2000 });
const stringEqual = equalFor(StringType);
const print = printFor(StringType);

/** The grid's rows, in order. */
const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-record] [data-slot="row"]')];
/** A row's cell under a column. */
const cellAt = (container: HTMLElement, r: number, key: string) => rows(container)[r]!.querySelector<HTMLElement>(`[data-slot="cell"][data-key="${key}"]`)!;
/** The grid: what takes the keys. */
const grid = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-record] [role="grid"]')!;
/** The active cell: the ring's. */
const active = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-record] [data-active]");
/** The editor open in a cell, if one is. */
const editor = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-record] [data-slot="editor"]');
/** A part of a cell: its chip, its pips, its avatar. */
const part = (cell: HTMLElement, name: string) => cell.querySelector<HTMLElement>(`[data-slot="${name}"]`);
/** The inspector pane. */
const pane = (container: HTMLElement) => slot(container, "end")!;
/** The Record's Details for a row, in the inspector's open tab. */
const details = (container: HTMLElement) => pane(container).querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) [data-record-details="row"]');
/** The row Details shows, by its key. */
const inspected = (container: HTMLElement) => details(container)?.getAttribute("data-record-entry");
/** The toolbar's region. */
const toolbar = (container: HTMLElement) => slot(container, "toolbar")!;
/** The status line's words. */
const status = (container: HTMLElement) => toolbar(container).querySelector('[data-slot="status"]')?.textContent;
/** Add or Delete, where the toolbar draws it. */
const action = (container: HTMLElement, part: "add" | "delete") => toolbar(container).querySelector<HTMLButtonElement>(`[data-record-action="${part}"]`);
/** A button of the history bar, by its name. */
const history = (container: HTMLElement, name: string) => within(toolbar(container)).getByRole("button", { name }) as HTMLButtonElement;
/** A row's box in the select column. */
const tick = (container: HTMLElement, r: number) => rows(container)[r]!.querySelector<HTMLElement>('[role="checkbox"]')!;
/** The rows ticked, by their keys. */
const ticked = (container: HTMLElement) => rows(container).filter((row) => row.hasAttribute("data-ticked")).map((row) => row.getAttribute("data-row-id"));
/** The row Add drafted: the one whose empty fields say they are required. */
const drafted = (container: HTMLElement) => rows(container).find((row) => row.querySelector("[data-required]") !== null)!;
/** A row's cell under a column, the row given. */
const cellOf = (row: HTMLElement, key: string) => row.querySelector<HTMLElement>(`[data-slot="cell"][data-key="${key}"]`)!;

/** The Record's strip as it reads — its label, its words and its keys — or `undefined` where it draws the Sheet's, or none. */
function stripSays(container: HTMLElement): string[] | undefined {
    const strip = container.querySelector<HTMLElement>("[data-record] [data-record-strip]");
    if (strip === null) return undefined;
    return ["stripLabel", "stripText", "stripKeys"].map((name) => strip.querySelector(`[data-slot="${name}"]`)?.textContent ?? "");
}

/** A press on an element, the primary button, and what it leads to settled. */
async function press(el: Element, init: { shiftKey?: boolean } = {}) {
    fireEvent.mouseDown(el, { button: 0, ...init });
    fireEvent.click(el, init);
    await settle();
}

/** The pointer come to rest on a cell, and what it leads to settled. */
async function hover(el: Element) {
    fireEvent.mouseEnter(el);
    await settle();
}

/** A key on the grid, and what it leads to settled. */
async function key(container: HTMLElement, k: string, init: { shiftKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) {
    fireEvent.keyDown(grid(container), { key: k, ...init });
    await settle();
}

/** A mounted Record once its rows are in: a record read through its slice is paged in. */
async function withRows<T extends { container: HTMLElement }>(ui: T): Promise<T> {
    await waitFor(() => expect(rows(ui.container).length).toBeGreaterThan(0));
    await settle();
    return ui;
}

describe("the grid in the Table's anatomy", () => {
    test("in the frame's main: rows and header row 36 tall, the select column first, no gutter, and no ring until a press or a key (FR1, GR1, HD2, SL1)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-anatomy" });
        expect(slot(container, "main")!.querySelector("[data-record]")).not.toBeNull();
        expect(rows(container)).toHaveLength(3);
        for (const row of rows(container)) {
            expect(row.style.height).toBe("36px");
            expect(row.style.gridTemplateColumns.startsWith("46px ")).toBe(true);
        }
        const header = container.querySelector<HTMLElement>('[data-record] [data-slot="headerRow"]')!;
        expect(header.style.height).toBe("36px");
        expect([...header.querySelectorAll('[data-slot="headerCell"]')].map((cell) => cell.textContent)).toEqual(["Name", "Inducted", "Forklift"]);
        // Each header cell says its whole label on hover; nothing sorts.
        expect(header.querySelector('[data-key="forklift"]')!.getAttribute("title")).toBe("Forklift");
        // No gutter: no row numbers, no seams.
        expect(container.querySelector('[data-slot="gutter"]')).toBeNull();
        expect(container.querySelector('[data-slot="insertPoint"]')).toBeNull();
        // No ring: nothing active, and the grid names no active cell.
        expect(active(container)).toBeNull();
        expect(grid(container).hasAttribute("aria-activedescendant")).toBe(false);
        expect(grid(container).getAttribute("aria-colcount")).toBe("4");
    });

    test("the column groups' row: each group's label over its columns, the columns before, between and after them unlabelled, an unlabelled group drawing neither label nor rule (HD1)", async () => {
        const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-groups" });
        const segments = [...container.querySelectorAll<HTMLElement>('[data-record] [data-slot="groupSeg"]')];
        // The select column, Name and Role · Shifts · Weekends · Overtime's unlabelled group · Days since and Last updated.
        expect(segments.map((segment) => segment.style.gridColumn)).toEqual(["span 3", "span 3", "span 2", "span 1", "span 2"]);
        expect(segments.map((segment) => segment.textContent)).toEqual(["", "Shifts", "Weekends", "", ""]);
        expect(segments.map((segment) => segment.querySelector("[data-unlabelled]") !== null)).toEqual([true, false, false, true, true]);
    });

    test("a read-only Record has no select column, and its rows and cells take no hover (ST9)", async () => {
        const { container } = await withRows(await h.mount(ex.recordSkillsReadOnly, { storageKey: "record-read-only" }));
        expect(container.querySelector("[data-record] [data-pick]")).toBeNull();
        expect(container.querySelector("[data-record] [data-tick]")).toBeNull();
        const row = rows(container)[0]!;
        // The first track is the name's own, 156 wide.
        expect(row.style.gridTemplateColumns.startsWith("156px ")).toBe(true);
        expect(row.hasAttribute("data-still")).toBe(true);
        expect(cellAt(container, 0, "intake").hasAttribute("data-steps")).toBe(false);
        expect(grid(container).getAttribute("aria-colcount")).toBe("14");
        // A press steps nothing.
        const was = cellAt(container, 0, "intake").textContent;
        await press(cellAt(container, 0, "intake"));
        expect(cellAt(container, 0, "intake").textContent).toBe(was);
    });
});

/** The pinned title, 150 wide, then a slot of a 390 frame's other 240 for each of the shift preferences' nine other columns: two in view. */
const PHONE_TRACKS = `150px ${Array(9).fill("120px").join(" ")}`;

describe("on a phone", () => {
    test("the title is pinned at the left and the other columns are a window of slots, with no select column — no box, no track, no tick-all (FR1, SL1)", async () => {
        const restore = touchFrame(390);
        try {
            const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-phone" });
            expect(grid(container).hasAttribute("data-phone")).toBe(true);
            expect(grid(container).hasAttribute("data-pin")).toBe(true);
            for (const row of rows(container)) expect(row.style.gridTemplateColumns).toBe(PHONE_TRACKS);
            const header = container.querySelector<HTMLElement>('[data-record] [data-slot="headerRow"]')!;
            expect(header.style.gridTemplateColumns).toBe(PHONE_TRACKS);
            expect([...header.querySelectorAll<HTMLElement>("[data-pinned]")].map((cell) => cell.getAttribute("data-key"))).toEqual(["name"]);
            expect(rows(container).map((_row, r) => cellAt(container, r, "name").hasAttribute("data-pinned"))).toEqual([true, true, true]);
            expect(cellAt(container, 0, "role").hasAttribute("data-pinned")).toBe(false);
            expect(container.querySelector("[data-record] [data-pick]")).toBeNull();
            expect(container.querySelector("[data-record] [data-tick]")).toBeNull();
            expect(grid(container).getAttribute("aria-colcount")).toBe("10");
            expect(cellAt(container, 0, "name").getAttribute("aria-colindex")).toBe("1");
        } finally {
            restore();
        }
    });

    test("one column beside the pinned title takes the window's whole width, never half of it with an empty slot after, and has no pager (SH1.4)", async () => {
        const restore = touchFrame(390);
        try {
            const { container } = await h.mount(ex.recordFinishes, { storageKey: "record-phone-one-column" });
            // The pinned piece, 150 wide, then the room in all of a 390 frame's other 240.
            for (const row of rows(container)) expect(row.style.gridTemplateColumns).toBe("150px 240px");
            expect(container.querySelector<HTMLElement>('[data-record] [data-slot="headerRow"]')!.style.gridTemplateColumns).toBe("150px 240px");
            expect(container.querySelector('[data-record] [data-slot="pager"]')).toBeNull();
        } finally {
            restore();
        }
    });

    test("the Sheet's pager steps the window a column past the pinned title — ‹ ›, and ← → on the grid — the ring where it is, and stops at the ends (SH1, SH8.1)", async () => {
        const restore = touchFrame(390);
        const restoreScroll = frameScrolls();
        try {
            const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-phone-pager" });
            const pager = container.querySelector<HTMLElement>('[data-record] [data-slot="pager"]')!;
            const shown = () => pager.querySelector('[data-slot="pagerReadout"] b')!.textContent;
            const step = (name: "pagerPrevious" | "pagerNext") => pager.querySelector<HTMLElement>(`[data-slot="${name}"]`)!;
            const frame = grid(container).querySelector<HTMLElement>('[data-virtual-rows="bounded"]')!;
            expect(shown()).toBe("1–2");
            expect(step("pagerPrevious").getAttribute("aria-disabled")).toBe("true");
            // The ring on a Role, which steps nothing.
            await press(cellAt(container, 0, "role"));
            const ring = active(container);
            expect(ring).toBe(cellAt(container, 0, "role"));
            await press(step("pagerNext"));
            expect([frame.scrollLeft, shown()]).toEqual([120, "2–3"]);
            await key(container, "ArrowRight");
            expect([frame.scrollLeft, shown()]).toEqual([240, "3–4"]);
            await key(container, "ArrowLeft");
            expect([frame.scrollLeft, shown()]).toEqual([120, "2–3"]);
            expect(active(container)).toBe(ring);
            // Six steps more bring the window to the last two columns, and neither › nor → goes past them.
            for (let i = 0; i < 6; i++) await press(step("pagerNext"));
            expect([frame.scrollLeft, shown()]).toEqual([840, "8–9"]);
            expect(step("pagerNext").getAttribute("aria-disabled")).toBe("true");
            await key(container, "ArrowRight");
            expect(frame.scrollLeft).toBe(840);
            expect(active(container)).toBe(ring);
        } finally {
            restoreScroll();
            restore();
        }
    });

    test("the column groups' row lies over the window: the pinned title's segment its own, drawing nothing, then each group over its columns' slots (HD1)", async () => {
        const restore = touchFrame(390);
        try {
            const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-phone-groups" });
            const head = container.querySelector<HTMLElement>('[data-record] [data-slot="head"]')!;
            const groupRow = head.querySelector<HTMLElement>('[data-slot="groupRow"]')!;
            expect(groupRow.style.gridTemplateColumns).toBe(PHONE_TRACKS);
            const segments = [...groupRow.querySelectorAll<HTMLElement>('[data-slot="groupSeg"]')];
            // Name, pinned · Role · Shifts · Weekends · Overtime's unlabelled group · Days since and Last updated.
            expect(segments.map((segment) => segment.style.gridColumn)).toEqual(["span 1", "span 1", "span 3", "span 2", "span 1", "span 2"]);
            expect(segments.map((segment) => segment.textContent)).toEqual(["", "", "Shifts", "Weekends", "", ""]);
            expect(segments.map((segment) => segment.hasAttribute("data-pinned"))).toEqual([true, false, false, false, false, false]);
            // Where a label holds as the window pages: past the pinned column.
            expect(head.hasAttribute("data-phone")).toBe(true);
            expect(head.style.getPropertyValue("--record-pin")).toBe("150px");
        } finally {
            restore();
        }
    });

    test("a group's label is cut to its columns in view as the window pages: Ashgrove's two projects, then the one left, then none, as Bellmoor's comes in (HD1)", async () => {
        const restore = touchFrame(390);
        const restoreScroll = frameScrolls();
        try {
            const { container } = await h.mount(ex.recordHoursByProject, { storageKey: "record-phone-group-cut" });
            const next = container.querySelector<HTMLElement>('[data-record] [data-slot="pager"] [data-slot="pagerNext"]')!;
            // Each label's room: its group's columns in view, a slot of 120 each beside the pinned name.
            const room = () => [...container.querySelectorAll<HTMLElement>('[data-record] [data-slot="groupLabel"]')]
                .map((label) => [label.textContent, label.style.getPropertyValue("--record-group-shown")]);
            expect(room()).toEqual([["Ashgrove Joinery", "240px"], ["Bellmoor Interiors", "0px"]]);
            await press(next);
            expect(room()).toEqual([["Ashgrove Joinery", "120px"], ["Bellmoor Interiors", "120px"]]);
            await press(next);
            expect(room()).toEqual([["Ashgrove Joinery", "0px"], ["Bellmoor Interiors", "120px"]]);
        } finally {
            restoreScroll();
            restore();
        }
    });

    test("a row is picked by its title — the ring on it, and the drawer open on the Record's Details at touch size, named by its title, its facts after its fields and no field taking the keyboard unasked — and deleted there, one step Undo takes back (P4, IN2, IN6, IN7, SH12)", async () => {
        const restore = touchFrame(390, { builder: true });
        try {
            const { container } = await h.mount(ex.recordEveryKind, { storageKey: "record-phone-pick" });
            const ids = () => rows(container).map((row) => row.getAttribute("data-row-id"));
            expect(ids()).toEqual(["P-0401", "P-0408"]);
            await press(cellAt(container, 1, "name"));
            expect(active(container)).toBe(cellAt(container, 1, "name"));
            const drawer = await waitFor(() => {
                const open = container.querySelector<HTMLElement>("[data-frame-drawer][data-open]");
                expect(open).not.toBeNull();
                return open!;
            });
            const shown = await waitFor(() => {
                const record = drawer.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) [data-record-details="row"]');
                expect(record?.getAttribute("data-record-entry")).toBe("P-0408");
                return record!;
            });
            expect(shown.hasAttribute("data-phone")).toBe(true);
            expect(shown.querySelector("[data-inspector-id]")!.textContent).toBe("B. Ellis");
            expect(shown.querySelector("[data-record-facts]")).not.toBeNull();
            expect(shown.querySelector('[data-field="name"]')!.contains(document.activeElement)).toBe(false);
            await press(shown.querySelector('[data-inspector-action="delete"]')!);
            expect(ids()).toEqual(["P-0401"]);
            await key(container, "z", { metaKey: true });
            expect(ids()).toEqual(["P-0401", "P-0408"]);
        } finally {
            restore();
        }
    });

    test("a press on a cell of the Sheet's kinds edits it in the bottom container, its inspector's field at touch size, its edits while it stays open one step; a cycle steps where it is pressed and a title opens its Details, neither opening it (SH10, SH10.1, P2, P4)", async () => {
        const restore = touchFrame(390);
        try {
            const { container } = await h.mount(ex.recordEveryKind, { storageKey: "record-phone-cell-editor" });
            const cellEditor = () => container.querySelector<HTMLElement>("[data-record] [data-sheet-cell-editor]");
            // Shifts, a whole number: − · the field · +.
            await press(cellAt(container, 0, "shifts"));
            expect(cellEditor()?.getAttribute("data-sheet-cell-editor")).toBe("shifts");
            expect(cellEditor()!.querySelector("[data-cell-editor-eyebrow]")!.textContent).toBe("Shifts · row 1");
            const shifts = () => cellAt(container, 0, "shifts").textContent;
            const was = shifts();
            await press(cellEditor()!.querySelector('[data-cell-step="more"]')!);
            await press(cellEditor()!.querySelector('[data-cell-step="more"]')!);
            expect(shifts()).not.toBe(was);
            await press(history(container, editingMessages.undo()));
            expect(shifts()).toBe(was);
            // Notes, its form's own input.
            await press(cellAt(container, 0, "notes"));
            expect(cellEditor()?.getAttribute("data-sheet-cell-editor")).toBe("notes");
            expect(cellEditor()!.querySelector("[data-cell-form] input")).not.toBeNull();
            // Overtime, a cycle, steps: prefer → can't, and nothing opens.
            await press(cellAt(container, 0, "preference"));
            expect(cellEditor()).toBeNull();
            expect(part(cellAt(container, 0, "preference"), "chip")!.textContent).toBe("can't");
            await press(cellAt(container, 0, "name"));
            expect(cellEditor()).toBeNull();
        } finally {
            restore();
        }
    });

    test("a desktop's frame too narrow to pin the inspector is no phone's, though main beside the inspector's rail is as narrow as one: the grid keeps its select column and tick-all, so Delete takes only the rows it shows ticked", async () => {
        // A frame of 580: the inspector overlays main, which keeps 536 beside its rail.
        const restore = overlaidFrame(580, 536);
        try {
            const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-overlaid" });
            expect(container.querySelector("[data-builder-frame]")!.hasAttribute("data-phone")).toBe(false);
            expect(pane(container).getAttribute("data-pane-mode")).toBe("overlay");
            expect(grid(container).hasAttribute("data-phone")).toBe(false);
            for (const row of rows(container)) expect(row.style.gridTemplateColumns.startsWith("46px ")).toBe(true);
            expect(container.querySelector('[data-record] [data-tick] [role="checkbox"]')).not.toBeNull();
            await press(tick(container, 1));
            expect(ticked(container)).toEqual(["P-0415"]);
            expect(status(container)).toBe("1 selected of 3");
            expect(action(container, "delete")!.disabled).toBe(false);
        } finally {
            restore();
        }
    });
});

describe("the pointer", () => {
    test("a press puts the ring on the cell and selects its row; the inspector shows the row (P1, ST4, ST5)", async () => {
        const { container } = await h.mount(ex.recordEveryKind, { storageKey: "record-press" });
        await press(cellAt(container, 1, "notes"));
        expect(active(container)).toBe(cellAt(container, 1, "notes"));
        expect(rows(container)[1]!.hasAttribute("data-selected")).toBe(true);
        expect(rows(container)[0]!.hasAttribute("data-selected")).toBe(false);
        expect(grid(container).getAttribute("aria-activedescendant")).toBe(cellAt(container, 1, "notes").id);
        await waitFor(() => expect(inspected(container)).toBe("P-0408"));
    });

    test("a press on a cycle steps it — one draft, one undo step — ⇧ the one before, and never an editor; a toggle flips (P2, P3, ST6, ST7, K5)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-step" });
        const forklift = () => cellAt(container, 0, "forklift");
        expect(forklift().textContent).toBe("2");
        await press(forklift());
        expect(forklift().textContent).toBe("0");
        expect(forklift().hasAttribute("data-dirty")).toBe(true);
        expect(rows(container)[0]!.hasAttribute("data-draft")).toBe(true);
        expect(editor(container)).toBeNull();
        await press(forklift());
        expect(forklift().textContent).toBe("1");
        // ⇧ steps back: 1 → 0.
        await press(forklift(), { shiftKey: true });
        expect(forklift().textContent).toBe("0");
        // Each step one undo step.
        await key(container, "z", { metaKey: true });
        expect(forklift().textContent).toBe("1");
        await key(container, "z", { metaKey: true, shiftKey: true });
        expect(forklift().textContent).toBe("0");
        // Back to what the record holds, the cell is no longer a change.
        await press(forklift());
        await press(forklift());
        expect(forklift().textContent).toBe("2");
        expect(forklift().hasAttribute("data-dirty")).toBe(false);
        // A toggle flips, and back.
        const inducted = () => cellAt(container, 1, "inducted");
        const was = inducted().textContent;
        await press(inducted());
        expect(inducted().textContent).not.toBe(was);
        expect(inducted().hasAttribute("data-dirty")).toBe(true);
        await press(inducted());
        expect(inducted().textContent).toBe(was);
    });

    test("a press on a title puts the ring on it and opens the inspector on Details, never an editor in place (P4)", async () => {
        const { container } = await h.mount(ex.recordEveryKind, { storageKey: "record-title" });
        // The inspector on Issues, then collapsed.
        fireEvent.click(within(pane(container)).getByRole("tab", { name: /Issues/ }));
        await settle();
        fireEvent.click(within(pane(container)).getByRole("button", { name: "Collapse Inspector" }));
        await settle();
        expect(pane(container).hasAttribute("data-collapsed")).toBe(true);
        await press(cellAt(container, 1, "name"));
        expect(active(container)).toBe(cellAt(container, 1, "name"));
        expect(editor(container)).toBeNull();
        await waitFor(() => expect(pane(container).hasAttribute("data-collapsed")).toBe(false));
        expect(within(pane(container)).getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");
        await waitFor(() => expect(inspected(container)).toBe("P-0408"));
        // A double press opens no editor; nor do ⏎ and F2.
        fireEvent.doubleClick(cellAt(container, 1, "name"));
        await settle();
        await key(container, "Enter");
        await key(container, "F2");
        expect(editor(container)).toBeNull();
    });

    test("with no inspector a title edits in its cell, as a text does — a key opens its editor, ⏎ commits — and Add opens its editor in the new row, the keyboard in it (P4, AD1)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-title-in-place" });
        const name = () => cellAt(container, 1, "name");
        const openIn = (cell: () => HTMLElement) => waitFor(() => {
            const open = cell().querySelector<HTMLInputElement>('[data-slot="editorInput"]');
            expect(open).not.toBeNull();
            return open!;
        });
        await press(name());
        expect(active(container)).toBe(name());
        expect(editor(container)).toBeNull();
        await key(container, "R");
        const typed = await openIn(name);
        fireEvent.input(typed, { target: { value: "R. Ellis" } });
        await settle();
        fireEvent.keyDown(typed, { key: "Enter" });
        await settle();
        expect(part(name(), "titleCell")!.textContent).toBe("R. Ellis");
        expect(name().hasAttribute("data-dirty")).toBe(true);
        await press(action(container, "add")!);
        expect(status(container)).toBe("Added a crew member");
        const added = drafted(container);
        const input = await openIn(() => cellOf(added, "name"));
        await waitFor(() => expect(document.activeElement).toBe(input));
    });

    test("the select column ticks a row, and the header every row shown, or none once all are; a tick never moves the ring (P5, SL1, ST4)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-ticks" });
        const box = (r: number) => rows(container)[r]!.querySelector<HTMLElement>('[role="checkbox"]')!;
        const all = () => container.querySelector<HTMLElement>('[data-record] [data-tick] [role="checkbox"]')!;
        expect(all().getAttribute("aria-label")).toBe("Select all shown");
        expect(box(1).getAttribute("aria-label")).toBe("Select B. Ellis");
        await press(box(1));
        expect(rows(container)[1]!.hasAttribute("data-ticked")).toBe(true);
        expect(rows(container)[1]!.hasAttribute("data-selected")).toBe(true);
        expect(box(1).getAttribute("aria-checked")).toBe("true");
        expect(box(1).getAttribute("aria-label")).toBe("Deselect B. Ellis");
        expect(all().getAttribute("aria-checked")).toBe("mixed");
        // No ring was placed.
        expect(active(container)).toBeNull();
        await press(all());
        expect(rows(container).every((row) => row.hasAttribute("data-ticked"))).toBe(true);
        expect(all().getAttribute("aria-checked")).toBe("true");
        expect(all().getAttribute("aria-label")).toBe("Deselect all");
        await press(all());
        expect(rows(container).some((row) => row.hasAttribute("data-ticked"))).toBe(false);
        // With the ring placed, a tick leaves it where it is.
        await key(container, "ArrowDown");
        const ring = active(container);
        expect(ring).not.toBeNull();
        await press(box(2));
        expect(active(container)).toBe(ring);
        expect(rows(container)[2]!.hasAttribute("data-ticked")).toBe(true);
    });

    test("a press anywhere in the select column's cell ticks its row, and anywhere in the header's every row shown — not only on the box; the box once, the ring where it was (SL1)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-tick-cell" });
        const pick = (r: number) => rows(container)[r]!.querySelector<HTMLElement>("[data-pick]")!;
        const head = () => container.querySelector<HTMLElement>("[data-record] [data-tick]")!;
        await press(pick(1));
        expect(ticked(container)).toEqual(["C-002"]);
        expect(active(container)).toBeNull();
        await press(pick(1));
        expect(ticked(container)).toEqual([]);
        // A press on the box ticks once, not once for the box and again for its cell.
        await press(tick(container, 1));
        expect(ticked(container)).toEqual(["C-002"]);
        await press(head());
        expect(ticked(container)).toEqual(["C-001", "C-002", "C-003"]);
        await press(head());
        expect(ticked(container)).toEqual([]);
    });

    test("a narrowing the Record has not read whole — its rows read near the view — has no tick-all, only each row's box; read whole, it has (#1579, SL1)", async () => {
        const all = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-record] [data-tick] [role="checkbox"]');
        // Seven hundred people: the Record reads the first six hundred.
        const people = new Map(await h.read(ex.recordSkills));
        for (let i = 0; i < 695; i++) {
            people.set(`Q-${String(i).padStart(4, "0")}`, {
                name: `Q. Person ${i}`, role: "Operator", intake: "0", review: "0", dispatch: "0", handover: "0", scanner: "0", console: "0",
                reports: "0", auditing: "0", training: "0", planning: "0", updated: none,
            });
        }
        await h.patch(ex.recordSkills, people);
        const { container } = await withRows(await h.mount(ex.recordSkillsMatrix, { storageKey: "record-ticks-paged" }));
        expect(container.querySelector("[data-record] [data-tick]")).not.toBeNull();
        expect(all(container)).toBeNull();
        await press(tick(container, 0));
        expect(ticked(container)).toEqual([rows(container)[0]!.getAttribute("data-row-id")]);
        // Searched to B. Ellis alone: every row it shows read, and the tick-all its.
        await act(async () => { skillsRows().prefix("name", "B."); });
        await waitFor(() => expect(rows(container)).toHaveLength(1), { timeout: 10_000 });
        await waitFor(() => expect(all(container)?.getAttribute("aria-label")).toBe("Select all shown"));
    });

    test("a narrowing changed unticks every row: Delete never takes a row it hides (#1579)", async () => {
        const { container } = await withRows(await h.mount(ex.recordSkillsMatrix, { storageKey: "record-ticks-narrowed" }));
        await press(tick(container, 0));
        await press(tick(container, 1));
        expect(status(container)).toBe("2 selected of 5");
        await act(async () => { skillsRows().prefix("name", "B."); });
        await waitFor(() => expect(rows(container)).toHaveLength(1), { timeout: 10_000 });
        expect(ticked(container)).toEqual([]);
        expect(status(container)).toBe("");
        expect(action(container, "delete")!.disabled).toBe(true);
    });
});

/** The crew, its Forklift column's detail the person's name: what the strip says of a Forklift cell. */
const crewWithDetail = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const members = $.let(Record.bind(ex.recordCrew));
    const levels = $.let([{ key: "0", name: "Not trained" }, { key: "1", name: "Supervised" }, { key: "2", name: "Competent" }],
        ArrayType(StructType({ key: StringType, name: StringType })));
    return Record({
        record: members,
        registers: { levels: Record.register.members(levels, { kind: "level", key: (l) => l.key, label: (l) => l.key, meta: (l) => some(l.name) }) },
        columns: {
            name: Record.column.title(ex.Crew, { header: "Name" }),
            forklift: Record.column.cycle(ex.Crew, "levels", { header: "Forklift", detail: (c) => c.name }),
        },
        // No column sets a member's induction: this Record adds no one.
        edits: { insertRows: false },
        name: "crewWithDetail",
    });
})));

describe("the strip", () => {
    test("previews the cell the pointer rests on, and returns to the ring's once the pointer leaves the grid or a key moves the ring (P6)", async () => {
        const { container } = await h.mount({ fn: crewWithDetail }, { storageKey: "record-strip" });
        const strip = () => container.querySelector<HTMLElement>('[data-record] [data-slot="strip"]');
        const chips = () => [...(strip()?.querySelectorAll('[data-slot="stripChip"]') ?? [])].map((chip) => chip.textContent);
        fireEvent.mouseEnter(cellAt(container, 0, "forklift"));
        await settle();
        expect(strip()?.querySelector('[data-slot="stripLabel"]')?.textContent).toBe("FORKLIFT");
        expect(chips()).toEqual(["A. Morgan"]);
        fireEvent.mouseEnter(cellAt(container, 1, "forklift"));
        await settle();
        expect(chips()).toEqual(["B. Ellis"]);
        // No ring: leaving the grid, the strip says what a click on a cell does (SP1) — the Record has no title to lead with.
        fireEvent.mouseLeave(grid(container));
        await settle();
        expect(stripSays(container)).toEqual(["", "Click a cell to step it", "↑ ↓ ← → move"]);
        // The ring on C. Patel's: the pointer elsewhere previews it, and leaving returns the strip to the ring's.
        await press(cellAt(container, 2, "forklift"));
        expect(chips()).toEqual(["C. Patel"]);
        fireEvent.mouseEnter(cellAt(container, 0, "forklift"));
        await settle();
        expect(chips()).toEqual(["A. Morgan"]);
        fireEvent.mouseLeave(grid(container));
        await settle();
        expect(chips()).toEqual(["C. Patel"]);
        // A key's move lets the pointer's cell go.
        fireEvent.mouseEnter(cellAt(container, 0, "forklift"));
        await settle();
        await key(container, "ArrowUp");
        expect(chips()).toEqual(["B. Ellis"]);
    });

    test("over nothing, the title and what a click does; over a cycle its state, the row, where a click and a ⇧-click take it and what the record holds once a draft changed it; a toggle's two states; a title its key (SP1, SP2, SP3)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-strip-words" });
        expect(stripSays(container)).toEqual(["Crew", "Click a cell to step it", "↑ ↓ ← → move"]);
        await hover(cellAt(container, 0, "forklift"));
        expect(stripSays(container)).toEqual(["Forklift · 2", "A. Morgan · Competent · click → 0 · ⇧-click → 1", "space next · 0–2 set · ⌫ 0"]);
        await press(cellAt(container, 0, "forklift"));
        expect(stripSays(container)).toEqual(["Forklift · 0", "A. Morgan · Not trained · was 2 · click → 1 · ⇧-click → 2", "space next · 0–2 set · ⌫ 0"]);
        await hover(cellAt(container, 1, "inducted"));
        expect(stripSays(container)).toEqual(["Inducted · no", "B. Ellis · click → yes", "space flips"]);
        await press(cellAt(container, 1, "inducted"));
        expect(stripSays(container)).toEqual(["Inducted · yes", "B. Ellis · was no · click → no", "space flips"]);
        // No inspector: a title names its row, nowhere else to look, and edits where it is.
        await hover(cellAt(container, 2, "name"));
        expect(stripSays(container)).toEqual(["crew member · C-003", "C. Patel", "⏎ edit · ↑ ↓ ← → move"]);
    });

    test("with an inspector: a title a word of its row and where its details are; a boolean; a cycle its member's name; an age with no moment; an audit when, its verb and who, pending once a draft changes its row; any other kind its column and value (SP1, SP3–SP5, SP7)", async () => {
        const { container } = await h.mount(ex.recordEveryKind, { storageKey: "record-strip-kinds" });
        const says = async (r: number, k: string) => {
            await hover(cellAt(container, r, k));
            return stripSays(container);
        };
        expect(stripSays(container)).toEqual(["Operators", "Click a cell to step it · select a row to open it in the inspector", "↑ ↓ ← → move"]);
        // A word of the row's: the first column after the title that reads as words and holds some — B. Ellis has no notes.
        expect(await says(0, "name")).toEqual(["operator · P-0401", "A. Morgan · Prefers day shifts through March · details in the inspector", "↑ ↓ ← → move"]);
        expect(await says(1, "name")).toEqual(["operator · P-0408", "B. Ellis · On leave · details in the inspector", "↑ ↓ ← → move"]);
        expect(await says(0, "inducted")).toEqual(["Inducted · yes", "A. Morgan · click → no", "space flips"]);
        // No member's label is one key long: no key sets one at once.
        expect(await says(0, "preference")).toEqual(["Overtime · prefer", "A. Morgan · Prefers · click → can't · ⇧-click → can", "space next · ⌫ can"]);
        expect(await says(1, "days_since")).toEqual(["Days since · not confirmed", "Days since the last change · stale from 90", "↑ ↓ ← → move"]);
        expect(await says(0, "updated")).toEqual(["Last updated", "2026-09-18 09:12 · confirmed · M. Hale", "↑ ↓ ← → move"]);
        expect(await says(1, "updated")).toEqual(["Last updated", "—", "↑ ↓ ← → move"]);
        expect(await says(0, "notes")).toEqual(["Notes", "Prefers day shifts through March", "⏎ edit · ↑ ↓ ← → move"]);
        // The Gatehouse's badge: no person edits it.
        expect(await says(0, "badge")).toEqual(["Badge", "EXT-88213", "↑ ↓ ← → move"]);
        await press(cellAt(container, 0, "night"));
        expect(await says(0, "updated")).toEqual(["Last updated", "1 pending · applies with the history bar", "↑ ↓ ← → move"]);
    });

    test("an age: its count to the Record's clock and its threshold, or for how long its row is stale (SP4)", async () => {
        vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
        // The 18th of January where the browser is: A. Morgan's last change 89 days back, D. Novak's 250.
        vi.setSystemTime(new Date(2027, 0, 18, 10, 14));
        try {
            const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-strip-age" });
            await hover(cellAt(container, 0, "days_since"));
            expect(stripSays(container)).toEqual(["Days since · 89", "Days since the last change · stale from 90", "↑ ↓ ← → move"]);
            await hover(cellAt(container, 2, "days_since"));
            expect(stripSays(container)).toEqual(["Days since · 250", "Stale · no change for 250 days · threshold 90", "↑ ↓ ← → move"]);
        } finally {
            vi.useRealTimers();
        }
    });

    test("a new row's empty field: Apply waits for it, and how it is set — a click on a cycle, the inspector for any other — and ⌘Z takes the row back (SP6)", async () => {
        const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-strip-new" });
        await press(action(container, "add")!);
        await hover(cellOf(drafted(container), "days"));
        expect(stripSays(container)).toEqual(["Days", "Required · Apply waits for every field of a new person · click sets can", "⌘Z removes the row"]);
        await hover(cellOf(drafted(container), "name"));
        expect(stripSays(container)).toEqual(["Name", "Required · Apply waits for every field of a new person · set it in the inspector", "⌘Z removes the row"]);
    });

    test("a Record read only says where it is and no more: a row opens in the inspector, and a cycle steps nowhere (SP1, SP2)", async () => {
        const { container } = await withRows(await h.mount(ex.recordSkillsReadOnly, { storageKey: "record-strip-read-only" }));
        expect(stripSays(container)).toEqual(["Skills matrix", "Select a row to open it in the inspector", "↑ ↓ ← → move"]);
        await hover(cellAt(container, 0, "intake"));
        expect(stripSays(container)).toEqual(["Intake · 2", "A. Morgan · Competent", "↑ ↓ ← → move"]);
    });
});

/** The crew with no column for its induction, which the app's new member leaves unset: no person can set it, so an Add drafts no one. */
const crewUninducted = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const members = $.let(Record.bind(ex.recordCrew));
    const levels = $.let([{ key: "0", name: "Not trained" }, { key: "1", name: "Supervised" }, { key: "2", name: "Competent" }],
        ArrayType(StructType({ key: StringType, name: StringType })));
    const newRow = $.const(East.function([Record.Types.NewRow], Record.Types.Patch(ex.Crew), () => Record.patch(ex.Crew, { forklift: "0" })));
    return Record({
        record: members,
        title: "Crew",
        noun: { singular: "crew member", plural: "crew members" },
        registers: { levels: Record.register.members(levels, { kind: "level", key: (l) => l.key, label: (l) => l.key, meta: (l) => some(l.name) }) },
        columns: {
            name: Record.column.title(ex.Crew, { header: "Name" }),
            forklift: Record.column.cycle(ex.Crew, "levels", { header: "Forklift" }),
        },
        newRow,
        name: "crewUninducted",
    });
})));

describe("the toolbar", () => {
    test("the title and the record's count, the status line, Add and Delete, then the history bar — folding on the shared ladder: the count first, then Add and Delete to their icons, the history last (FR2–FR4, FR6, FR7)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-toolbar" });
        const row = toolbar(container).querySelector<HTMLElement>("[data-toolbar]")!;
        expect([...row.querySelectorAll("[data-toolbar-item]")].map((item) => item.getAttribute("data-toolbar-item"))).toEqual(["record-title", "record-status", "record-actions", "history"]);
        expect([row.querySelector('[data-slot="titleText"]')!.textContent, row.querySelector('[data-slot="titleCount"]')?.textContent]).toEqual(["Crew", "3"]);
        expect([action(container, "add")!.textContent, action(container, "add")!.disabled]).toEqual(["Add", false]);
        // Nothing ticked, nothing to delete.
        expect([action(container, "delete")!.textContent, action(container, "delete")!.disabled]).toEqual(["Delete", true]);
        // The status line: a live region always there, so each change of its words is heard.
        const line = row.querySelector('[data-slot="status"]')!;
        expect([line.getAttribute("role"), line.getAttribute("aria-live"), line.textContent]).toEqual(["status", "polite", ""]);
        expect(row.getAttribute("data-toolbar-ladder")).toBe("record-title>1 record-actions>1 history>1");
        // The row narrowing: each form as wide as it draws, the status line taking what the rest leave.
        const widths = new Map<string, readonly number[]>([["record-title", [200, 80]], ["record-actions", [240, 90]], ["history", [400, 160]]]);
        let room = 0;
        const measure = Element.prototype.getBoundingClientRect;
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
            const item = this.getAttribute("data-toolbar-item");
            const px = this.hasAttribute("data-toolbar") ? room : item === null ? undefined : widths.get(item)?.[Number(this.getAttribute("data-toolbar-form"))];
            return px === undefined ? measure.call(this) : { x: 0, y: 0, top: 0, left: 0, right: px, bottom: 28, width: px, height: 28, toJSON() {} } as DOMRect;
        });
        const narrowed = async (px: number) => {
            room = px;
            await width(900);
            return row.getAttribute("data-toolbar-state");
        };
        expect(await narrowed(800)).toBe("record-title=1/2;record-status=0/1;record-actions=0/2;history=0/2");
        expect(row.querySelector('[data-slot="titleCount"]')).toBeNull();
        expect(await narrowed(650)).toBe("record-title=1/2;record-status=0/1;record-actions=1/2;history=0/2");
        expect([action(container, "add")!.textContent, action(container, "add")!.getAttribute("aria-label")]).toEqual(["", "Add"]);
        expect(row.querySelector('[data-history-form="full"]')).not.toBeNull();
        expect(await narrowed(400)).toBe("record-title=1/2;record-status=0/1;record-actions=1/2;history=1/2");
        expect(row.querySelector('[data-history-form="buttons"]')).not.toBeNull();
    });

    test("on a phone: the title and its count, and Add as its icon at the row's end; no Delete; the history the second row, and the status line's words the footer's band (FR2, FR5)", async () => {
        const restore = touchFrame(390, { builder: true });
        try {
            const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-phone-toolbar" });
            expect([toolbar(container).querySelector('[data-slot="titleText"]')!.textContent, toolbar(container).querySelector('[data-slot="titleCount"]')?.textContent])
                .toEqual(["Shift preferences", "3"]);
            expect(toolbar(container).querySelector('[data-slot="status"]')).toBeNull();
            expect(action(container, "delete")).toBeNull();
            expect(slot(container, "sessionRow")!.querySelector('[data-history-form="phone"]')).not.toBeNull();
            const add = action(container, "add")!;
            expect([add.getAttribute("aria-label"), add.textContent]).toEqual(["Add a person", ""]);
            await press(add);
            expect(rows(container)).toHaveLength(4);
            expect(slot(container, "footer")!.querySelector('[data-slot="footerLive"]')!.textContent).toBe("Added a person");
        } finally {
            restore();
        }
    });
});

describe("Add, Delete and the history's steps, in the status line", () => {
    test("Add drafts a row, the ring on its title and the inspector open on its Details, and says so (AD1)", async () => {
        const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-add" });
        await press(action(container, "add")!);
        expect(rows(container)).toHaveLength(4);
        const added = drafted(container);
        expect(active(container)).toBe(cellOf(added, "name"));
        expect(status(container)).toBe("Added a person");
        await waitFor(() => expect(inspected(container)).toBe(added.getAttribute("data-row-id")));
    });

    test("Add brings the row it drafts into view wherever its key places it: placed first, over the rows the view had scrolled down to — and the next row placed there too (AD1)", async () => {
        // A frame two rows tall over the three people.
        const restoreFrame = boundFrame(72);
        const restoreScroll = frameScrolls();
        try {
            const { container } = await h.mount(ex.recordHoursByProject, { storageKey: "record-add-in-view" });
            const frame = grid(container).querySelector<HTMLElement>('[data-virtual-rows="bounded"]')!;
            const scrolledTo = async (top: number) => {
                frame.scrollTop = top;
                fireEvent.scroll(frame);
                await settle();
            };
            /** Whether the row with this key is wholly in the view. */
            const shown = (id: string) => {
                const at = offsetOf(rows(container).find((row) => row.getAttribute("data-row-id") === id)!);
                return at >= frame.scrollTop && at + 36 <= frame.scrollTop + 72;
            };
            // Each new row's key sorts before every row's: it is placed first.
            const keys = ["10000000-0000-4000-8000-000000000000", "00000000-0000-4000-8000-000000000000"];
            for (const [i, id] of keys.entries()) {
                await scrolledTo(36 * (i + 1));
                offering([id]);
                await press(action(container, "add")!);
                await waitFor(() => expect(inspected(container)).toBe(id));
                expect(rows(container)[0]!.getAttribute("data-row-id")).toBe(id);
                expect(shown(id)).toBe(true);
            }
        } finally {
            restoreScroll();
            restoreFrame();
        }
    });

    test("with a search standing, Add clears it, so the row it drafts shows among every row (AD1)", async () => {
        const { container } = await withRows(await h.mount(ex.recordSkillsMatrix, { storageKey: "record-add-search" }));
        await act(async () => { skillsRows().prefix("name", "B."); });
        await waitFor(() => expect(rows(container)).toHaveLength(1), { timeout: 10_000 });
        await press(action(container, "add")!);
        await waitFor(() => expect(rows(container)).toHaveLength(6), { timeout: 10_000 });
        expect(status(container)).toBe("Added a person");
    });

    test("an Add the app leaves a field empty that no person can set is refused, and the status line names the field (AD2)", async () => {
        const { container } = await h.mount({ fn: crewUninducted }, { storageKey: "record-cant-add" });
        await press(action(container, "add")!);
        expect(rows(container)).toHaveLength(3);
        expect(status(container)).toBe("Can't add a crew member — the app gives no Inducted");
    });

    test("Issues takes the ring to the first issue's field, its row open on Details, and the status line counts the empty fields (AD3)", async () => {
        const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-issues" });
        await press(action(container, "add")!);
        const added = drafted(container);
        // The ring elsewhere first.
        await press(cellAt(container, rows(container).indexOf(added) === 0 ? 1 : 0, "role"));
        await press(history(container, editingMessages.issues({ n: 8, count: "8" })));
        expect(status(container)).toBe("8 required fields empty");
        expect(active(container)).toBe(cellOf(added, "name"));
        await waitFor(() => expect(inspected(container)).toBe(added.getAttribute("data-row-id")));
    });

    test("Apply writes the drafts, and the status line says what it sent: the changes, the rows they change and the rows deleted (AD4)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-apply" });
        await press(cellAt(container, 0, "forklift"));
        await press(cellAt(container, 1, "inducted"));
        await press(tick(container, 2));
        await press(action(container, "delete")!);
        await press(history(container, editingMessages.apply()));
        await waitFor(() => expect(status(container)).toBe("Applied 2 changes to 2 crew members · deleted 1"));
        const crew = await h.read(ex.recordCrew);
        expect([...crew.keys()]).toEqual(["C-001", "C-002"]);
        expect([crew.get("C-001")!.forklift, crew.get("C-002")!.inducted]).toEqual(["0", true]);
    });

    test("the status line counts the rows ticked, of those shown; Delete takes them out as one draft, the ticks with them, and Undo restores them (FR5, AD5)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-delete" });
        const ids = () => rows(container).map((row) => row.getAttribute("data-row-id"));
        expect(status(container)).toBe("");
        await press(tick(container, 1));
        expect(status(container)).toBe("1 selected of 3");
        expect(action(container, "delete")!.disabled).toBe(false);
        await press(tick(container, 2));
        expect(status(container)).toBe("2 selected of 3");
        await press(action(container, "delete")!);
        expect(ids()).toEqual(["C-001"]);
        expect(status(container)).toBe("Deleted 2 crew members · Apply writes it, Undo restores");
        expect(ticked(container)).toEqual([]);
        expect(action(container, "delete")!.disabled).toBe(true);
        await press(history(container, editingMessages.undo()));
        expect(ids()).toEqual(["C-001", "C-002", "C-003"]);
        expect(status(container)).toBe("Restored 2 crew members");
    });

    test("Discard drops every draft and the ticks with them, and counts the changes it dropped (AD6)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-discard" });
        // Two steps of one field, and another row's field: two changes.
        await press(cellAt(container, 0, "forklift"));
        await press(cellAt(container, 0, "forklift"));
        await press(cellAt(container, 1, "inducted"));
        await press(tick(container, 2));
        await press(history(container, editingMessages.discard()));
        expect(status(container)).toBe("Discarded 2 changes");
        expect(cellAt(container, 0, "forklift").textContent).toBe("2");
        expect(ticked(container)).toEqual([]);
    });

    test("Undo and Redo each say the step they took — from the history bar or the keys — until the next gesture (AD7)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-undo" });
        await press(cellAt(container, 0, "forklift"));
        await press(history(container, editingMessages.undo()));
        expect(status(container)).toBe("Undid one change");
        expect(cellAt(container, 0, "forklift").textContent).toBe("2");
        await press(history(container, editingMessages.redo()));
        expect(status(container)).toBe("Redid one change");
        await key(container, "z", { metaKey: true });
        expect(status(container)).toBe("Undid one change");
        await press(cellAt(container, 1, "forklift"));
        expect(status(container)).toBe("");
    });
});

describe("the footer", () => {
    test("the rows shown of the record's, and the legend of the register every cycle names: each member's chip in its look, and its name (FT1, FT2)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-footer" });
        const footer = slot(container, "footer")!;
        const count = footer.querySelector('[data-slot="footerCount"]')!;
        expect(count.textContent).toMatch(/^3 of 3 crew members/);
        expect(count.querySelector("b")!.textContent).toBe("3");
        const legend = [...footer.querySelectorAll('[data-slot="legendItem"]')].map((item) => [
            item.querySelector('[data-slot="legendChip"]')?.getAttribute("data-look"), item.querySelector('[data-slot="legendChip"]')?.textContent,
            item.querySelector('[data-slot="legendName"]')?.textContent,
        ]);
        expect(legend).toEqual([["none", "0", "Not trained"], ["heat-2", "1", "Supervised"], ["heat-4", "2", "Competent"]]);
        expect(footer.querySelector('[data-slot="footerNote"]')).toBeNull();
    });

    test("the stale note counts the rows past the first age's threshold, to the Record's clock; a valence's legend chips in its tones (FT1, FT2)", async () => {
        vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
        vi.setSystemTime(new Date(2027, 0, 18, 10, 14));
        try {
            const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-footer-stale" });
            const footer = slot(container, "footer")!;
            expect(footer.querySelector('[data-slot="footerCount"]')!.textContent).toMatch(/^3 of 3 people/);
            // D. Novak's, from May.
            expect(footer.querySelector('[data-slot="footerNote"]')!.textContent).toBe("1 stale · no update in 90 days");
            const legend = [...footer.querySelectorAll('[data-slot="legendItem"]')].map((item) => [
                item.querySelector('[data-slot="legendChip"]')?.getAttribute("data-look"), item.querySelector('[data-slot="legendName"]')?.textContent,
            ]);
            expect(legend).toEqual([["none", "Can work"], ["success", "Prefers"], ["danger", "Can't work"]]);
        } finally {
            vi.useRealTimers();
        }
    });

    test("a new row is never stale: a copy of a stale row, which the grid draws with no age, counts in neither the stale note nor the Stale count with no row selected", async () => {
        vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
        vi.setSystemTime(new Date("2027-01-19T10:14:00Z"));
        try {
            const first = await h.mount(ex.recordShiftPreferences, { storageKey: "record-stale-new" });
            // D. Novak's, from May, copied: every field but the name hers.
            await press(cellAt(first.container, 2, "role"));
            await waitFor(() => expect(inspected(first.container)).toBe("P-0422"));
            await press(details(first.container)!.querySelector('[data-inspector-action="duplicate"]')!);
            await waitFor(() => expect(rows(first.container)).toHaveLength(4));
            expect(part(cellOf(drafted(first.container), "days_since"), "absent")!.textContent).toBe("not confirmed");
            expect(slot(first.container, "footer")!.querySelector('[data-slot="footerNote"]')!.textContent).toBe("1 stale · no update in 90 days");
            // Opened again in this tab, the copy kept and no row selected: four shown, one pending, one stale.
            reloadPage();
            const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-stale-new" });
            await waitFor(() => expect(rows(container)).toHaveLength(4));
            const nothing = openPanel(container).querySelector<HTMLElement>('[data-record-details="none"]')!;
            expect([...nothing.querySelectorAll("[data-count]")].map((stat) => [...stat.children].map((child) => child.textContent)))
                .toEqual([["4", "Shown"], ["1", "Pending"], ["1", "Stale"]]);
        } finally {
            vi.useRealTimers();
        }
    });

    test("the rail's narrowing: the rows it shows, of the record's (FT1)", async () => {
        const { container } = await withRows(await h.mount(ex.recordSkillsMatrix, { storageKey: "record-footer-narrowed" }));
        const count = () => slot(container, "footer")!.querySelector('[data-slot="footerCount"]')!.textContent;
        expect(count()).toMatch(/^5 of 5 people/);
        await act(async () => { skillsRows().prefix("name", "B."); });
        await waitFor(() => expect(rows(container)).toHaveLength(1), { timeout: 10_000 });
        expect(count()).toMatch(/^1 of 5 people/);
    });
});

describe("the keys", () => {
    test("with no ring, an arrow places it on the first row's first cell that edits in place; arrows move it, clamped, selecting the row (K1)", async () => {
        const { container } = await h.mount(ex.recordEveryKind, { storageKey: "record-arrows" });
        // A key that is no move does nothing yet.
        await key(container, "x");
        expect(active(container)).toBeNull();
        expect(editor(container)).toBeNull();
        // The title edits in the inspector and the badge is stamped: the first move lands on Notes.
        await key(container, "ArrowDown");
        expect(active(container)).toBe(cellAt(container, 0, "notes"));
        expect(rows(container)[0]!.hasAttribute("data-selected")).toBe(true);
        await key(container, "ArrowRight");
        expect(active(container)).toBe(cellAt(container, 0, "shifts"));
        await key(container, "ArrowDown");
        await key(container, "ArrowDown");
        expect(active(container)).toBe(cellAt(container, 1, "shifts"));
        expect(rows(container)[1]!.hasAttribute("data-selected")).toBe(true);
        expect(rows(container)[0]!.hasAttribute("data-selected")).toBe(false);
    });

    test("Space and ⏎ step a cycle, ⇧ back; ⌫ sets its first; a member's key sets it at once (K2, K3, K4)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-cycle-keys" });
        const forklift = () => cellAt(container, 0, "forklift");
        // With no inspector the title edits in place: the first move lands on it.
        await key(container, "ArrowDown");
        expect(active(container)).toBe(cellAt(container, 0, "name"));
        await key(container, "ArrowRight");
        await key(container, "ArrowRight");
        expect(active(container)).toBe(forklift());
        await key(container, " ");
        expect(forklift().textContent).toBe("0");
        await key(container, "Enter");
        expect(forklift().textContent).toBe("1");
        await key(container, " ", { shiftKey: true });
        expect(forklift().textContent).toBe("0");
        await key(container, "2");
        expect(forklift().textContent).toBe("2");
        await key(container, "Backspace");
        expect(forklift().textContent).toBe("0");
        expect(editor(container)).toBeNull();
    });

    test("a key on any other kind opens the Sheet's editor in place: ⏎ commits, esc discards (K6)", async () => {
        const { container } = await h.mount(ex.recordEveryKind, { storageKey: "record-editor" });
        const notes = () => cellAt(container, 1, "notes");
        const input = async () => {
            await waitFor(() => expect(notes().querySelector('[data-slot="editorInput"]')).not.toBeNull());
            return notes().querySelector<HTMLInputElement>('[data-slot="editorInput"]')!;
        };
        await press(notes());
        await key(container, "R");
        const typed = await input();
        fireEvent.input(typed, { target: { value: "Rotates monthly" } });
        await settle();
        fireEvent.keyDown(typed, { key: "Enter" });
        await settle();
        expect(notes().textContent).toBe("Rotates monthly");
        expect(notes().hasAttribute("data-dirty")).toBe(true);
        await key(container, "ArrowUp");
        await key(container, "ArrowDown");
        await key(container, "X");
        const discarded = await input();
        fireEvent.keyDown(discarded, { key: "Escape" });
        await settle();
        expect(editor(container)).toBeNull();
        expect(notes().textContent).toBe("Rotates monthly");
    });

    test("↓ and ⏎ on the last row leave the ring there: a Record adds a row by Add alone, and draws none under its rows (K1)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-last-row" });
        const last = () => cellAt(container, 2, "name");
        await press(last());
        await key(container, "ArrowDown");
        expect(rows(container)).toHaveLength(3);
        expect(active(container)).toBe(last());
        // A name typed in the last row's title, and ⏎: written, the ring where it was.
        await key(container, "R");
        const typed = await waitFor(() => {
            const open = last().querySelector<HTMLInputElement>('[data-slot="editorInput"]');
            expect(open).not.toBeNull();
            return open!;
        });
        fireEvent.input(typed, { target: { value: "R. Patel" } });
        await settle();
        fireEvent.keyDown(typed, { key: "Enter" });
        await settle();
        expect(part(last(), "titleCell")!.textContent).toBe("R. Patel");
        expect(rows(container)).toHaveLength(3);
        expect(container.querySelector('[data-record] [data-row="3"]')).toBeNull();
        expect(active(container)).toBe(last());
    });
});

describe("the cells", () => {
    test("a title is its name, its initials before it with avatar, its key on hover; a person their initials and label, or the dashed ring and the words for no one; a boolean its box; the Sheet's kinds the Sheet's (C1, C2, C3, C10, C11)", async () => {
        const { container } = await h.mount(ex.recordEveryKind, { storageKey: "record-cells-people" });
        const name = cellAt(container, 0, "name");
        expect(part(name, "avatar")!.textContent).toBe("AM");
        expect(part(name, "avatar")!.getAttribute("aria-hidden")).toBe("true");
        expect(part(name, "titleCell")!.textContent).toBe("A. Morgan");
        expect(name.getAttribute("title")).toBe("A. Morgan · P-0401");
        expect(part(cellAt(container, 1, "name"), "avatar")!.textContent).toBe("BE");
        const supervisor = cellAt(container, 0, "supervisor");
        expect(part(supervisor, "avatar")!.textContent).toBe("SP");
        expect(part(supervisor, "personLabel")!.textContent).toBe("S. Park");
        expect(supervisor.getAttribute("title")).toBe("S. Park");
        // No one: the dashed ring, which says so, and the words beside it.
        const nobody = cellAt(container, 1, "supervisor");
        expect(part(nobody, "avatar")).toBeNull();
        expect(within(nobody).getByRole("img", { name: "Unassigned" })).toBe(part(nobody, "nobody"));
        expect(part(nobody, "personLabel")!.textContent).toBe("Unassigned");
        expect(within(cellAt(container, 0, "inducted")).getByRole("checkbox", { name: "Inducted" }).getAttribute("aria-checked")).toBe("true");
        expect(within(cellAt(container, 1, "inducted")).getByRole("checkbox", { name: "Inducted" }).getAttribute("aria-checked")).toBe("false");
        // No moment and no change: the age's own words, whole on hover, and the audit's dash.
        expect(part(cellAt(container, 1, "days_since"), "absent")!.textContent).toBe("not confirmed");
        expect(cellAt(container, 1, "days_since").getAttribute("title")).toBe("not confirmed");
        expect(part(cellAt(container, 1, "updated"), "absent")!.textContent).toBe("—");
        // A Sheet kind is the Sheet's: a quantity, its constant unit after its value.
        expect(cellAt(container, 0, "hours").textContent).toBe("38.5hrs");
        expect(cellAt(container, 0, "notes").textContent).toBe("Prefers day shifts through March");
    });

    test("a scale's chips step up the heat ramp from an empty first, a toggle's on at its top, each column's chips its widest label wide; the hover names the state, and what the record holds while a draft changed it (C4, C5)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-cells-chips" });
        const chip = (r: number, k: string) => part(cellAt(container, r, k), "chip")!;
        const looks = (k: string) => rows(container).map((_row, r) => [chip(r, k).textContent, chip(r, k).getAttribute("data-look")]);
        expect(looks("forklift")).toEqual([["2", "heat-4"], ["0", "none"], ["1", "heat-2"]]);
        expect(looks("inducted")).toEqual([["yes", "heat-4"], ["no", "none"], ["yes", "heat-4"]]);
        expect(chip(0, "forklift").style.getPropertyValue("--record-chip-ch")).toBe("1");
        expect(chip(1, "inducted").style.getPropertyValue("--record-chip-ch")).toBe("3");
        // A level's hover is its name.
        expect(cellAt(container, 0, "forklift").getAttribute("title")).toBe("Forklift · Competent");
        await press(cellAt(container, 0, "forklift"));
        expect(looks("forklift")[0]).toEqual(["0", "none"]);
        expect(cellAt(container, 0, "forklift").getAttribute("title")).toBe("Forklift · Not trained · was 2");
        await press(cellAt(container, 1, "inducted"));
        expect(looks("inducted")[1]).toEqual(["yes", "heat-4"]);
        expect(cellAt(container, 1, "inducted").getAttribute("title")).toBe("Inducted · yes · was no");
    });

    test("a cycle over toned members is a chip in its tone's wash, a neutral member's none, its hover the member's name (C5)", async () => {
        const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-cells-valence" });
        const chip = (r: number, k: string) => part(cellAt(container, r, k), "chip")!;
        expect([chip(0, "days"), chip(0, "afternoon"), chip(1, "nights")].map((c) => [c.textContent, c.getAttribute("data-look")]))
            .toEqual([["prefer", "success"], ["can", "none"], ["can't", "danger"]]);
        expect(chip(0, "days").style.getPropertyValue("--record-chip-ch")).toBe("6");
        expect(cellAt(container, 1, "nights").getAttribute("title")).toBe("Nights · Can't work");
    });

    test("the mark look beside the chip: a scale's pips filled up to its member, a toggle's one pip, a valence's dot and word; the density control steps the rows (C6, GR1)", async () => {
        const { container } = await h.mount(ex.recordLooks, { storageKey: "record-cells-looks" });
        const pips = (r: number, k: string) => [...cellAt(container, r, k).querySelectorAll('[data-slot="pip"]')].map((pip) => pip.hasAttribute("data-on"));
        const chips = (k: string) => rows(container).map((_row, r) => part(cellAt(container, r, k), "chip")!.getAttribute("data-look"));
        // Scanner holds 1, 2 and 0: a pip for each level after the first.
        expect(rows(container).map((_row, r) => pips(r, "scanner"))).toEqual([[true, false], [true, true], [false, false]]);
        expect(within(cellAt(container, 0, "scanner")).getByRole("img").getAttribute("aria-label")).toBe("1");
        expect(chips("forklift")).toEqual(["heat-4", "none", "heat-2"]);
        // Weekends holds yes, no and yes: one pip, filled for yes.
        expect(rows(container).map((_row, r) => pips(r, "weekends"))).toEqual([[true], [false], [true]]);
        expect(within(cellAt(container, 1, "weekends")).getByRole("img").getAttribute("aria-label")).toBe("no");
        expect(chips("nights")).toEqual(["none", "heat-4", "heat-4"]);
        // Evenings: the member's tone in its dot, then its label.
        const marks = rows(container).map((_row, r) => part(cellAt(container, r, "evenings"), "mark")!);
        expect(marks.map((mark) => [mark.getAttribute("data-tone"), part(mark, "markWord")!.textContent]))
            .toEqual([["neutral", "can"], ["danger", "can't"], ["success", "prefer"]]);
        expect(chips("days")).toEqual(["success", "none", "danger"]);
        expect(cellAt(container, 2, "evenings").getAttribute("title")).toBe("Evenings · Prefers");
        // The density control: condensed rows, and the header row with them.
        expect(rows(container)[0]!.style.height).toBe("36px");
        await press(within(container).getByRole("radio", { name: "CONDENSED" }));
        await waitFor(() => expect(rows(container)[0]!.style.height).toBe("28px"));
        expect(container.querySelector<HTMLElement>('[data-record] [data-slot="headerRow"]')!.style.height).toBe("28px");
    });

    // A minute before midnight on the 18th of January where the viewer is, behind UTC and ahead of it: A. Morgan's last
    // change, at 10:15 UTC on the 21st of October, is 89 days back until the minute turns — at the viewer's midnight, never
    // at the change's time of day, nor at UTC's.
    for (const [zone, minuteBefore] of [["America/Los_Angeles", Date.UTC(2027, 0, 19, 7, 59)], ["Pacific/Kiritimati", Date.UTC(2027, 0, 18, 9, 59)]] as const) {
        test(`an age counts days from its moment's date to the viewer's own day, warning from its threshold, and turns over at the viewer's midnight: in ${zone} (C7, #1584)`, async () => {
            vi.stubEnv("TZ", zone);
            vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
            vi.setSystemTime(minuteBefore);
            try {
                const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-cells-age" });
                const age = (r: number) => cellAt(container, r, "days_since");
                expect(part(age(0), "age")!.textContent).toBe("89");
                expect(part(age(0), "age")!.hasAttribute("data-stale")).toBe(false);
                expect(part(age(0), "staleDot")).toBeNull();
                expect(age(0).getAttribute("title")).toBe("89 days");
                // D. Novak's, from May: long past the threshold.
                expect(part(age(2), "age")!.textContent).toBe("250");
                expect(part(age(2), "age")!.hasAttribute("data-stale")).toBe(true);
                expect(within(age(2)).getByRole("img", { name: "Stale" })).toBe(part(age(2), "staleDot"));
                expect(age(2).getAttribute("title")).toBe("Stale · 250 days · threshold 90");
                // The minute turns, and with it the viewer's day: ninety days, and stale.
                await act(async () => { vi.advanceTimersByTime(60_000); });
                await settle();
                expect(part(age(0), "age")!.textContent).toBe("90");
                expect(part(age(0), "age")!.hasAttribute("data-stale")).toBe(true);
                expect(within(age(0)).getByRole("img", { name: "Stale" })).toBe(part(age(0), "staleDot"));
                expect(age(0).getAttribute("title")).toBe("Stale · 90 days · threshold 90");
            } finally {
                vi.useRealTimers();
                vi.unstubAllEnvs();
            }
        });
    }

    test("an audit is its date, in blame mode its verb and who, the whole change on hover; while the row's drafts change its fields it reads Pending and counts them, a field set back counting none (C8, C9)", async () => {
        const { container } = await h.mount(ex.recordEveryKind, { storageKey: "record-cells-audit" });
        const audit = () => cellAt(container, 0, "updated");
        expect(part(audit(), "auditDate")!.textContent).toBe("2026-09-18");
        expect(part(audit(), "auditMeta")!.textContent).toBe("confirmed · M. Hale");
        expect(audit().getAttribute("title")).toBe("2026-09-18 09:12 · confirmed · M. Hale");
        await press(cellAt(container, 0, "night"));
        expect(part(audit(), "auditDate")).toBeNull();
        expect(part(audit(), "pending")!.textContent).toBe("Pending");
        expect(part(audit(), "pendingMeta")!.textContent).toBe("1 change");
        expect(audit().getAttribute("title")).toBe("1 pending");
        await press(cellAt(container, 0, "inducted"));
        expect(part(audit(), "pendingMeta")!.textContent).toBe("2 changes");
        // Each set back to what the record holds: the change as it was.
        await press(cellAt(container, 0, "inducted"));
        await press(cellAt(container, 0, "night"));
        expect(part(audit(), "pending")).toBeNull();
        expect(part(audit(), "auditDate")!.textContent).toBe("2026-09-18");
    });

    test("in date mode an audit is its date alone, and pending its count alone; a new row has no age and no audit until the record holds it (C8, C9, AD2)", async () => {
        const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-cells-audit-date" });
        const audit = () => cellAt(container, 0, "updated");
        expect(part(audit(), "auditDate")!.textContent).toBe("2026-10-21");
        expect(part(audit(), "auditMeta")).toBeNull();
        expect(audit().getAttribute("title")).toBe("2026-10-21 10:15 · changed · K. Lund");
        await press(cellAt(container, 0, "days"));
        expect(part(audit(), "pendingMeta")!.textContent).toBe("1");
        expect(audit().getAttribute("title")).toBe("1 pending");
        await key(container, "Insert", { altKey: true });
        await waitFor(() => expect(rows(container)).toHaveLength(4));
        const added = rows(container).find((row) => row.querySelector("[data-required]") !== null)!;
        expect(added.querySelector('[data-key="days_since"] [data-slot="absent"]')!.textContent).toBe("not confirmed");
        expect(added.querySelector('[data-key="updated"] [data-slot="absent"]')!.textContent).toBe("—");
        expect(added.querySelector('[data-slot="pending"]')).toBeNull();
    });
});

/** The skills matrix's rail, as a test writes it: the same source under the Record's key. */
const skillsRail = East.compile(East.function([], RecordSlicesChromeType, ($) => $.return(recordSlicesChrome({ slice: Slice.bindRecords("record.skills", {
    rows: {
        source: Data.bindPaged(ex.recordSkills, { indexes: ["record_skills_by_name", "record_skills_by_role"] }),
        label: "People",
        fields: { name: { label: "Name" }, role: { label: "Role", hints: ["Operator", "Contractor", "Team lead"] } },
        search: ["name", "role"],
    },
}) }))), getRegisteredPlatformImplementations());
/** The rail's rows source, bound. */
const skillsRows = () => skillsRail().slice.parts.find((part) => stringEqual(part.source, "rows"))!.slice;

describe("the states", () => {
    test("a new row is a draft, and each of its empty cells a person must fill is washed and says so (ST7, ST8)", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-new" });
        await key(container, "ArrowDown");
        await key(container, "Insert", { altKey: true });
        await waitFor(() => expect(rows(container)).toHaveLength(4));
        const added = rows(container).find((row) => row.querySelector("[data-required]") !== null)!;
        expect(added.hasAttribute("data-draft")).toBe(true);
        const name = added.querySelector<HTMLElement>('[data-key="name"]')!;
        expect(name.hasAttribute("data-required")).toBe(true);
        expect(name.getAttribute("title")).toBe("Name · required");
        expect(drawn(name)).toBe("");
    });

    test("a new row's option is no field it lacks: the rota's supervisor is neither washed nor said to be required (ST8, SP6)", async () => {
        const { container } = await h.mount(ex.recordLooks, { storageKey: "record-new-option" });
        await press(action(container, "add")!);
        const added = drafted(container);
        expect([...added.querySelectorAll("[data-required]")].map((cell) => cell.getAttribute("data-key")))
            .toEqual(["name", "inducted", "nights", "weekends", "forklift", "scanner", "days", "evenings"]);
        // The rota has no inspector: Add opened the title's editor in its cell, which esc closes.
        const title = await waitFor(() => {
            const open = cellOf(added, "name").querySelector<HTMLInputElement>('[data-slot="editorInput"]');
            expect(open).not.toBeNull();
            return open!;
        });
        fireEvent.keyDown(title, { key: "Escape" });
        await settle();
        await hover(cellOf(added, "supervisor"));
        expect(stripSays(container)).toEqual(["Supervisor", "—", "⏎ edit · ↑ ↓ ← → move"]);
    });

    test("a new row's field that columns from data write starts empty: only its name is washed, and Apply writes it with no hours (ST8)", async () => {
        const { container } = await h.mount(ex.recordHoursByProject, { storageKey: "record-new-from-data" });
        await press(action(container, "add")!);
        const added = drafted(container);
        expect([...added.querySelectorAll("[data-required]")].map((cell) => cell.getAttribute("data-key"))).toEqual(["name"]);
        await waitFor(() => expect(inspected(container)).toBe(added.getAttribute("data-row-id")));
        const user = userEvent.setup();
        await user.type(within(detailsField(container, "name")).getByRole("textbox"), "D. Quinn{Enter}");
        await settle();
        await press(history(container, editingMessages.apply()));
        await waitFor(() => expect(status(container)).toBe("Applied 1 new person"));
        const quinn = [...(await h.read(ex.recordHours)).values()].find((person) => stringEqual(person.name, "D. Quinn"));
        expect(quinn !== undefined && hoursEqual(quinn.hours, new Map())).toBe(true);
    });

    test("the narrowing leaving no row to show: the empty state says so, and clears the search — else the filters (EM1)", async () => {
        const { container } = await withRows(await h.mount(ex.recordSkillsMatrix, { storageKey: "record-empty" }));
        const empty = () => container.querySelector<HTMLElement>('[data-record] [data-slot="empty"]');
        expect(empty()).toBeNull();
        await act(async () => { skillsRows().prefix("name", "zzzz"); });
        await waitFor(() => expect(empty()).not.toBeNull(), { timeout: 10_000 });
        expect(rows(container)).toEqual([]);
        expect(empty()!.textContent).toContain("No people match the search");
        expect(empty()!.textContent).toContain("Clear the search →");
        await act(async () => { fireEvent.click(empty()!.querySelector('[data-slot="emptyClear"]')!); });
        await waitFor(() => expect(rows(container).length).toBeGreaterThan(0), { timeout: 10_000 });
        expect(empty()).toBeNull();
        // A role no one holds: the filters.
        await act(async () => { skillsRows().choose("role", [print("Nobody")]); });
        await waitFor(() => expect(empty()).not.toBeNull(), { timeout: 10_000 });
        expect(empty()!.textContent).toContain("No people match the filters");
        await act(async () => { fireEvent.click(empty()!.querySelector('[data-slot="emptyClear"]')!); });
        await waitFor(() => expect(rows(container).length).toBeGreaterThan(0), { timeout: 10_000 });
        expect(skillsRows().read().where.size).toBe(0);
    });

    test("a conflict not yet chosen is marked where it is: a field another Save changed under the draft rings its cell, and a row another Save deleted under its draft rings whole", async () => {
        const { container } = await h.mount(ex.recordBasic, { storageKey: "record-conflicts" });
        const rowOf = (id: string) => rows(container).find((row) => row.getAttribute("data-row-id") === id)!;
        // A. Morgan's forklift stepped and B. Ellis inducted here; another Save lands first, moving her forklift and deleting him.
        await press(cellAt(container, 0, "forklift"));
        await press(cellAt(container, 1, "inducted"));
        await h.race(ex.recordCrew, () => fireEvent.click(history(container, editingMessages.apply())), (crew) => {
            const next = new Map(crew);
            next.set("C-001", { ...crew.get("C-001")!, forklift: "1" });
            next.delete("C-002");
            return next;
        });
        await waitFor(() => expect(cellOf(rowOf("C-001"), "forklift").hasAttribute("data-conflict")).toBe(true));
        expect([rowOf("C-001").hasAttribute("data-conflict"), cellOf(rowOf("C-001"), "inducted").hasAttribute("data-conflict")]).toEqual([false, false]);
        expect(rowOf("C-002").hasAttribute("data-conflict")).toBe(true);
    });

    test("a cell's issue is read out as its description: text no column reads, typed in a cell", async () => {
        const { container } = await h.mount({ fn: operatorsOnNights }, { storageKey: "record-issue-described" });
        expect(cellAt(container, 1, "hours").hasAttribute("aria-describedby")).toBe(false);
        await typeInto(container, 1, "hours", "lots");
        const hours = cellAt(container, 1, "hours");
        expect([hours.getAttribute("aria-invalid"), describedBy(hours)]).toEqual(["true", "Invalid input: lots"]);
    });

    test("a new row is marked incomplete, and each of its empty cells a person must fill reads out that it is required", async () => {
        const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-new-incomplete" });
        expect(rows(container).some((row) => row.hasAttribute("data-incomplete"))).toBe(false);
        await press(action(container, "add")!);
        const added = drafted(container);
        expect(added.hasAttribute("data-incomplete")).toBe(true);
        expect(describedBy(cellOf(added, "name"))).toBe("Required");
    });
});

/** What a cell's description reads: the text of what its `aria-describedby` names. */
const describedBy = (cell: HTMLElement) => document.getElementById(cell.getAttribute("aria-describedby") ?? "")?.textContent;
/** What a cell draws: its text but its description's, which is read out and never drawn. */
const drawn = (cell: HTMLElement) => [...cell.childNodes].filter((node) => !(node instanceof Element && node.id === cell.getAttribute("aria-describedby")))
    .map((node) => node.textContent).join("");

/** A field of the row's Details, by its key. */
const detailsField = (container: HTMLElement, key: string) => details(container)!.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
/** A one-line field's radios. */
const radiosOf = (field: HTMLElement) => within(field).getAllByRole("radio") as HTMLInputElement[];
/** Which of a one-line field's radios are checked. */
const checkedOf = (field: HTMLElement) => radiosOf(field).map((radio) => radio.checked);
/** A one-line field's choices, as they read. */
const choicesOf = (field: HTMLElement) => [...field.querySelectorAll("[data-scope=radio-group][data-part=item-text]")].map((text) => text.textContent);
/** An inspector tab, by its name. */
const inspectorTab = (container: HTMLElement, name: string | RegExp) => within(pane(container)).getByRole("tab", { name });
/** The inspector's open tab's panel. */
const openPanel = (container: HTMLElement) => pane(container).querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
/** The chip in the head of the row's Details, beside its title: its state and its words, or `undefined` for none. */
const chipOf = (container: HTMLElement) => {
    const chip = details(container)!.querySelector<HTMLElement>("[data-inspector-id] + * > [data-state]");
    return chip === null ? undefined : [chip.getAttribute("data-state"), chip.textContent];
};
/** A shift preference's fields, as Details draws them: the title and the role, then the cycles, column by column. */
const PREFERENCE_FIELDS = ["name", "role", "days", "afternoon", "nights", "sat", "sun", "overtime"];

describe("the inspector", () => {
    test("Details: the head names the row and its title, and counts the fields its drafts change; the fields in column order, each column group a section under its label, an unlabelled one's Other, and the audit no field (IN2, IN4)", async () => {
        const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-details" });
        await press(cellAt(container, 0, "role"));
        await waitFor(() => expect(inspected(container)).toBe("P-0401"));
        expect(details(container)!.querySelector("[data-inspector-what]")!.textContent).toBe("row 1");
        expect(details(container)!.querySelector("[data-inspector-id]")!.textContent).toBe("A. Morgan");
        expect(chipOf(container)).toBeUndefined();
        expect([...details(container)!.querySelectorAll("[data-field]")].map((field) => field.getAttribute("data-field"))).toEqual(PREFERENCE_FIELDS);
        const sections = [...details(container)!.querySelectorAll<HTMLElement>("[data-field-group]")];
        expect(sections.map((section) => [section.getAttribute("data-field-group"), [...section.querySelectorAll("[data-field]")].map((field) => field.getAttribute("data-field"))]))
            .toEqual([["Shifts", ["days", "afternoon", "nights"]], ["Weekends", ["sat", "sun"]], ["Other", ["overtime"]]]);
        // Two of its cycles stepped in the grid, one twice: two fields its drafts change.
        await press(cellAt(container, 0, "days"));
        await press(cellAt(container, 0, "days"));
        await press(cellAt(container, 0, "sat"));
        expect(chipOf(container)).toEqual(["pending", "2 pending"]);
    });

    test("a cycle, a toggle and a boolean are each one line of radios, the held one checked and the label whole in its tooltip; a Record that adds no row offers Delete alone (IN5, IN7)", async () => {
        const { container } = await h.mount(ex.recordEveryKind, { storageKey: "record-details-lines" });
        await press(cellAt(container, 0, "notes"));
        await waitFor(() => expect(inspected(container)).toBe("P-0401"));
        const lines = ["inducted", "night", "preference"].map((key) => detailsField(container, key));
        expect(lines.map((field) => field.getAttribute("data-layout"))).toEqual(["line", "line", "line"]);
        expect(lines.map((field) => field.getAttribute("title"))).toEqual(["Inducted", "Nights", "Overtime"]);
        expect(lines.map(choicesOf)).toEqual([["Yes", "No"], ["yes", "no"], ["can", "prefer", "can't"]]);
        expect(lines.map(checkedOf)).toEqual([[true, false], [false, true], [false, true, false]]);
        // Every other kind its column's own.
        expect(detailsField(container, "notes").getAttribute("data-layout")).toBeNull();
        // The Gatehouse's operators: no Duplicate.
        expect([...details(container)!.querySelectorAll("[data-inspector-action]")].map((button) => button.getAttribute("data-inspector-action"))).toEqual(["delete"]);
    });

    test("a Record read only prints the member each line holds, and offers no Duplicate or Delete (IN5, IN7, ST9)", async () => {
        const { container } = await withRows(await h.mount(ex.recordSkillsReadOnly, { storageKey: "record-details-read-only" }));
        await press(cellAt(container, 0, "role"));
        await waitFor(() => expect(inspected(container)).toBe("P-0401"));
        expect(detailsField(container, "intake").querySelector("[data-field-value]")!.textContent).toBe("2");
        expect(detailsField(container, "intake").querySelector("[data-scope=radio-group]")).toBeNull();
        expect(details(container)!.querySelector("[data-inspector-actions]")).toBeNull();
    });

    test("a cycle field drafts as its grid cell does — the cell and the field changed, one step of the history — and Undo and Redo take both (IN5)", async () => {
        const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-details-cycle" });
        await press(cellAt(container, 1, "role"));
        await waitFor(() => expect(inspected(container)).toBe("P-0415"));
        // C. Patel can't work nights; Details says can.
        expect(checkedOf(detailsField(container, "nights"))).toEqual([false, false, true]);
        fireEvent.click(radiosOf(detailsField(container, "nights"))[0]!);
        await settle();
        expect(part(cellAt(container, 1, "nights"), "chip")!.textContent).toBe("can");
        expect(cellAt(container, 1, "nights").hasAttribute("data-dirty")).toBe(true);
        expect(rows(container)[1]!.hasAttribute("data-draft")).toBe(true);
        expect(detailsField(container, "nights").hasAttribute("data-dirty")).toBe(true);
        expect(chipOf(container)).toEqual(["pending", "1 pending"]);
        await press(history(container, editingMessages.undo()));
        expect(part(cellAt(container, 1, "nights"), "chip")!.textContent).toBe("can't");
        expect(cellAt(container, 1, "nights").hasAttribute("data-dirty")).toBe(false);
        expect(checkedOf(detailsField(container, "nights"))).toEqual([false, false, true]);
        expect(detailsField(container, "nights").hasAttribute("data-dirty")).toBe(false);
        expect(chipOf(container)).toBeUndefined();
        await press(history(container, editingMessages.redo()));
        expect(checkedOf(detailsField(container, "nights"))).toEqual([true, false, false]);
        expect(part(cellAt(container, 1, "nights"), "chip")!.textContent).toBe("can");
        // And the cell's own step is the field's: can → prefer.
        await press(cellAt(container, 1, "nights"));
        expect(checkedOf(detailsField(container, "nights"))).toEqual([false, true, false]);
    });

    test("the facts last, read only: the audit's when, verb and who, and the age's count, warning once stale — none for a row the record does not hold yet (IN6)", async () => {
        vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
        vi.setSystemTime(new Date(2027, 0, 18, 10, 14));
        try {
            const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-details-facts" });
            const facts = () => [...details(container)!.querySelectorAll<HTMLElement>("[data-record-fact]")].map((fact) => {
                const input = fact.querySelector<HTMLInputElement>("input")!;
                return [fact.querySelector("[data-field-key]")!.textContent, input.getAttribute("aria-label"), input.value, input.readOnly, input.hasAttribute("data-stale")];
            });
            await press(cellAt(container, 0, "role"));
            await waitFor(() => expect(inspected(container)).toBe("P-0401"));
            expect(facts()).toEqual([
                ["days_since", "Days since", "89", true, false],
                ["updated", "Last updated", "2026-10-21 10:15 · changed · K. Lund", true, false],
            ]);
            // D. Novak's, from May: stale.
            await press(cellAt(container, 2, "role"));
            await waitFor(() => expect(inspected(container)).toBe("P-0422"));
            expect(facts()[0]).toEqual(["days_since", "Days since", "250", true, true]);
            await press(action(container, "add")!);
            await waitFor(() => expect(inspected(container)).toBe(drafted(container).getAttribute("data-row-id")));
            expect(details(container)!.querySelector("[data-record-facts]")).toBeNull();
            expect(chipOf(container)).toEqual(["new", "New"]);
        } finally {
            vi.useRealTimers();
        }
    });

    test("with no row selected: the rows shown, the drafts pending and the rows stale, then where a row's fields show (IN8)", async () => {
        vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
        vi.setSystemTime(new Date(2027, 0, 18, 10, 14));
        try {
            const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-details-none" });
            const nothing = openPanel(container).querySelector<HTMLElement>('[data-record-details="none"]')!;
            expect([...nothing.querySelectorAll("[data-count]")].map((stat) => [...stat.children].map((child) => child.textContent)))
                .toEqual([["3", "Shown"], ["0", "Pending"], ["1", "Stale"]]);
            expect(nothing.querySelector("[data-record-hint]")!.textContent).toBe("Select a row to see its fields here.");
        } finally {
            vi.useRealTimers();
        }
    });

    test("a press on a title opens its Details with the keyboard in the title's field, as Add does (P4, AD1)", async () => {
        const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-details-title" });
        await press(cellAt(container, 1, "name"));
        await waitFor(() => expect(inspected(container)).toBe("P-0415"));
        await waitFor(() => expect(document.activeElement).toBe(within(detailsField(container, "name")).getByRole("textbox")));
        await press(action(container, "add")!);
        const added = drafted(container);
        await waitFor(() => expect(inspected(container)).toBe(added.getAttribute("data-row-id")));
        await waitFor(() => expect(document.activeElement).toBe(within(detailsField(container, "name")).getByRole("textbox")));
        expect(details(container)!.querySelector("[data-inspector-id]")!.textContent).toBe("—");
    });

    test("Duplicate drafts a copy, in its key's place, its title empty: the ring on it, its Details open with the keyboard in its title, and the status line says so; Undo takes it back (IN7)", async () => {
        const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-duplicate" });
        const held = ["P-0401", "P-0415", "P-0422"];
        await press(cellAt(container, 1, "role"));
        await waitFor(() => expect(inspected(container)).toBe("P-0415"));
        await press(details(container)!.querySelector('[data-inspector-action="duplicate"]')!);
        await waitFor(() => expect(rows(container)).toHaveLength(4));
        const copy = rows(container).find((row) => !held.includes(row.getAttribute("data-row-id")!))!;
        expect(copy.hasAttribute("data-draft")).toBe(true);
        expect([drawn(cellOf(copy, "name")), cellOf(copy, "name").hasAttribute("data-required")]).toEqual(["", true]);
        // Every other field C. Patel's.
        expect(["days", "afternoon", "nights", "sat", "sun", "overtime"].map((key) => part(cellOf(copy, key), "chip")!.textContent))
            .toEqual(["can", "prefer", "can't", "prefer", "can't", "can"]);
        expect(status(container)).toBe("Duplicated C. Patel");
        await waitFor(() => expect(inspected(container)).toBe(copy.getAttribute("data-row-id")));
        expect(active(container)).toBe(cellOf(copy, "name"));
        await waitFor(() => expect(document.activeElement).toBe(within(detailsField(container, "name")).getByRole("textbox")));
        expect(chipOf(container)).toEqual(["new", "New"]);
        await press(history(container, editingMessages.undo()));
        expect(rows(container).map((row) => row.getAttribute("data-row-id"))).toEqual(held);
    });

    test("Delete takes the row out as one draft, unticking it, and Undo restores it (IN7)", async () => {
        const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-details-delete" });
        const ids = () => rows(container).map((row) => row.getAttribute("data-row-id"));
        await press(tick(container, 0));
        await press(cellAt(container, 0, "role"));
        await waitFor(() => expect(inspected(container)).toBe("P-0401"));
        await press(details(container)!.querySelector('[data-inspector-action="delete"]')!);
        expect(ids()).toEqual(["P-0415", "P-0422"]);
        expect(ticked(container)).toEqual([]);
        expect(status(container)).toBe("Deleted 1 person · Apply writes it, Undo restores");
        await press(history(container, editingMessages.undo()));
        expect(ids()).toEqual(["P-0401", "P-0415", "P-0422"]);
    });

    test("Issues lists every refusal holding Apply by its row's title — a new row with none, as new — and its field; a click selects the row, opens Details and rings the field, the keyboard in it; No issues only once nothing holds Apply (IN3, IN9)", async () => {
        const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-issues-tab" });
        const toIssues = async () => {
            fireEvent.click(inspectorTab(container, /^Issues/));
            await settle();
        };
        await toIssues();
        expect(openPanel(container).querySelector("[data-inspector-no-issues]")!.textContent).toContain("No issues");
        await press(action(container, "add")!);
        const added = drafted(container);
        // The ring elsewhere, and the Issues tab again: a new row's every empty field, and never No issues.
        await press(cellAt(container, rows(container).indexOf(added) === 0 ? 1 : 0, "role"));
        await toIssues();
        expect(openPanel(container).querySelector("[data-inspector-no-issues]")).toBeNull();
        const lines = () => [...openPanel(container).querySelectorAll<HTMLElement>("[data-inspector-issue]")];
        const labels = ["Name", "Role", "Days", "Afternoon", "Nights", "Sat", "Sun", "Overtime"];
        expect(lines().map((line) => line.firstElementChild!.textContent).sort()).toEqual(labels.map((label) => `New person · ${label}`).sort());
        await press(lines().find((line) => line.firstElementChild!.textContent === "New person · Nights")!);
        expect(active(container)).toBe(cellOf(added, "nights"));
        await waitFor(() => expect(inspectorTab(container, "Details").getAttribute("aria-selected")).toBe("true"));
        await waitFor(() => expect(inspected(container)).toBe(added.getAttribute("data-row-id")));
        // Its issues over its form (IN3), each field they name washed — and the keyboard in Nights.
        expect(details(container)!.querySelector("[data-inspector-issues]")!.firstElementChild!.textContent).toBe("8 issues");
        expect([...details(container)!.querySelectorAll("[data-field][data-issue]")].map((field) => field.getAttribute("data-field"))).toEqual(PREFERENCE_FIELDS);
        await waitFor(() => expect(detailsField(container, "nights").contains(document.activeElement)).toBe(true));
        // A field set, its issue gone from the form and the tab.
        fireEvent.click(radiosOf(detailsField(container, "nights"))[0]!);
        await settle();
        expect(detailsField(container, "nights").hasAttribute("data-issue")).toBe(false);
        await toIssues();
        expect(lines()).toHaveLength(7);
        // The row taken back: nothing holds Apply, and the tab says so.
        await press(history(container, editingMessages.undo()));
        await press(history(container, editingMessages.undo()));
        expect(rows(container)).toHaveLength(3);
        expect(openPanel(container).querySelector("[data-inspector-no-issues]")).not.toBeNull();
    });
});

/** The skills matrix's people, the app's `ready` refusing a contractor rated above 0 at Planning (#1525). */
const skillsReady = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const people = $.let(Record.bind(ex.recordSkills));
    const levels = $.let([{ key: "0", name: "Not trained" }, { key: "1", name: "Supervised" }, { key: "2", name: "Competent" }],
        ArrayType(StructType({ key: StringType, name: StringType })));
    const roles = $.let(["Operator", "Contractor", "Team lead"], ArrayType(StringType));
    const ready = $.const(East.function([Record.Types.Draft(ex.Skills), Record.Types.DraftContext(ex.Skills)], Record.Types.Readiness, ($, row) => {
        const contractor = $.const(row.role.match({ value: (_$2, role) => role.equals("Contractor") }, () => false));
        const plans = $.const(row.planning.match({ value: (_$2, level) => level.equals("0").not() }, () => false));
        $.if(contractor.and(() => plans), ($) => {
            $.return(East.value(variant("invalid", [{ field: "planning", message: "A contractor can't plan" }]), Record.Types.Readiness));
        });
        return East.value(variant("ready", null), Record.Types.Readiness);
    }));
    return Record({
        record: people,
        title: "Skills matrix",
        noun: { singular: "person", plural: "people" },
        registers: {
            levels: Record.register.members(levels, { kind: "level", key: (l) => l.key, label: (l) => l.key, meta: (l) => some(l.name) }),
            roles: Record.register.members(roles, { kind: "role", key: (r) => r, label: (r) => r }),
        },
        columns: {
            name: Record.column.title(ex.Skills, { header: "Name" }),
            role: Record.column.reference(ex.Skills, "roles", { header: "Role" }),
            planning: Record.column.cycle(ex.Skills, "levels", { header: "Planning", scale: true }),
        },
        inspector: true,
        ready: { row: ready },
        name: "skillsReady",
    });
})));

/** The crew in an inspector, the app's new member uninducted and untrained: what Add and Duplicate draft (#1526). */
const crewNewRow = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const members = $.let(Record.bind(ex.recordCrew));
    const levels = $.let([{ key: "0", name: "Not trained" }, { key: "1", name: "Supervised" }, { key: "2", name: "Competent" }],
        ArrayType(StructType({ key: StringType, name: StringType })));
    const newRow = $.const(East.function([Record.Types.NewRow], Record.Types.Patch(ex.Crew), () => Record.patch(ex.Crew, { inducted: false, forklift: "0" })));
    return Record({
        record: members,
        title: "Crew",
        noun: { singular: "crew member", plural: "crew members" },
        registers: { levels: Record.register.members(levels, { kind: "level", key: (l) => l.key, label: (l) => l.key, meta: (l) => some(l.name) }) },
        columns: {
            name: Record.column.title(ex.Crew, { header: "Name" }),
            inducted: Record.column.toggle(ex.Crew, { header: "Inducted", on: "yes", off: "no" }),
            forklift: Record.column.cycle(ex.Crew, "levels", { header: "Forklift", scale: true }),
        },
        inspector: true,
        newRow,
        name: "crewNewRow",
    });
})));

describe("the app's part (#1527)", () => {
    test("a refusal of the app's `ready` holds Apply: Issues takes the ring to its field, Details shows it over the form with the field ringed, the Issues tab lists it, and setting the field back clears it (#1525, AD3, IN3, IN9)", async () => {
        const { container } = await h.mount({ fn: skillsReady }, { storageKey: "record-ready" });
        const apply = () => history(container, editingMessages.apply());
        // B. Ellis, an operator, rated 1 at Planning: no refusal. C. Patel, a contractor, the same: refused.
        await press(cellAt(container, 1, "planning"));
        expect(apply().disabled).toBe(false);
        expect(cellAt(container, 2, "planning").textContent).toBe("0");
        await press(cellAt(container, 2, "planning"));
        expect(drawn(cellAt(container, 2, "planning"))).toBe("1");
        expect(apply().disabled).toBe(true);
        // The ring elsewhere, then the history bar's Issues: C. Patel's Planning, open on Details.
        await press(cellAt(container, 0, "role"));
        await press(history(container, editingMessages.issues({ n: 1, count: "1" })));
        expect(status(container)).toBe("1 issue holds Apply");
        expect(active(container)).toBe(cellAt(container, 2, "planning"));
        await waitFor(() => expect(inspected(container)).toBe("P-0415"));
        const issues = details(container)!.querySelector<HTMLElement>("[data-inspector-issues]")!;
        expect(issues.firstElementChild!.textContent).toBe("1 issue");
        expect([...issues.querySelectorAll("[data-kind]")].map((text) => [text.previousElementSibling?.textContent, text.textContent]))
            .toEqual([["Planning", "A contractor can't plan"]]);
        expect([...details(container)!.querySelectorAll("[data-field][data-issue]")].map((field) => field.getAttribute("data-field"))).toEqual(["planning"]);
        await waitFor(() => expect(detailsField(container, "planning").contains(document.activeElement)).toBe(true));
        // The Issues tab: the row by its title, the field, and the app's words.
        fireEvent.click(inspectorTab(container, /^Issues/));
        await settle();
        const lines = () => [...openPanel(container).querySelectorAll<HTMLElement>("[data-inspector-issue]")];
        expect(lines().map((line) => [line.firstElementChild!.textContent, line.querySelector("[data-kind]")!.textContent])).toEqual([["C. Patel · Planning", "A contractor can't plan"]]);
        // Planning back to 0: the refusal gone from the tab, and Apply takes B. Ellis's change.
        await press(lines()[0]!);
        fireEvent.click(radiosOf(detailsField(container, "planning"))[0]!);
        await settle();
        expect(cellAt(container, 2, "planning").textContent).toBe("0");
        expect(detailsField(container, "planning").hasAttribute("data-issue")).toBe(false);
        expect(apply().disabled).toBe(false);
        fireEvent.click(inspectorTab(container, /^Issues/));
        await settle();
        expect(openPanel(container).querySelector("[data-inspector-no-issues]")).not.toBeNull();
    });

    test("a new row takes the app's `newRow`: Add drafts its values, only the title is the person's to fill, and Apply writes them; Duplicate drafts the source's values over them, the title empty (#1526, AD2, IN7)", async () => {
        const { container } = await h.mount({ fn: crewNewRow }, { storageKey: "record-new-row" });
        await press(action(container, "add")!);
        const added = drafted(container);
        expect([part(cellOf(added, "inducted"), "chip")!.textContent, part(cellOf(added, "forklift"), "chip")!.textContent]).toEqual(["no", "0"]);
        expect([...added.querySelectorAll("[data-required]")].map((cell) => cell.getAttribute("data-key"))).toEqual(["name"]);
        // The name typed in Details, and nothing else.
        await waitFor(() => expect(inspected(container)).toBe(added.getAttribute("data-row-id")));
        const user = userEvent.setup();
        await user.type(within(detailsField(container, "name")).getByRole("textbox"), "D. Quinn{Enter}");
        await settle();
        expect(cellOf(added, "name").textContent).toBe("D. Quinn");
        await press(history(container, editingMessages.apply()));
        await waitFor(() => expect(status(container)).toBe("Applied 1 new crew member"));
        const crew = await h.read(ex.recordCrew);
        const quinn = [...crew.values()].find((member) => stringEqual(member.name, "D. Quinn"));
        expect(quinn === undefined ? undefined : [quinn.inducted, quinn.forklift]).toEqual([false, "0"]);
        // Duplicate: B. Ellis's values over the app's, the name empty.
        const ellis = rows(container).findIndex((row) => stringEqual(row.getAttribute("data-row-id") ?? "", "C-002"));
        await press(cellAt(container, ellis, "name"));
        await waitFor(() => expect(inspected(container)).toBe("C-002"));
        await press(details(container)!.querySelector('[data-inspector-action="duplicate"]')!);
        const copy = drafted(container);
        expect(copy.getAttribute("data-row-id")).not.toBe("C-002");
        expect([drawn(cellOf(copy, "name")), part(cellOf(copy, "inducted"), "chip")!.textContent, part(cellOf(copy, "forklift"), "chip")!.textContent])
            .toEqual(["", "no", "0"]);
        expect(status(container)).toBe("Duplicated B. Ellis");
    });
});

describe("a cycle over a variant", () => {
    test("steps through its cases in the order its steps give, not East's, in the grid, the legend and Details' one line, each step a chip in its tone; Apply writes the case", async () => {
        const { container } = await h.mount(ex.recordOrderStatus, { storageKey: "record-steps" });
        const chip = (r: number) => part(cellAt(container, r, "status"), "chip")!;
        expect(rows(container).map((_row, r) => [chip(r).textContent, chip(r).getAttribute("data-look")]))
            .toEqual([["Received", "none"], ["Packed", "info"], ["Shipped", "success"]]);
        // The legend: the steps in their order, each its chip alone — a step with no meta has no name to add to its label.
        const legend = [...slot(container, "footer")!.querySelectorAll('[data-slot="legendItem"]')].map((item) => [
            item.querySelector('[data-slot="legendChip"]')?.textContent, item.querySelector('[data-slot="legendName"]')?.textContent,
        ]);
        expect(legend).toEqual([["Received", undefined], ["Picked", undefined], ["Packed", undefined], ["Shipped", undefined]]);
        // Received, then each step after it, and back to the first; ⇧ the one before.
        const stepped: (string | null)[] = [];
        for (let i = 0; i < 4; i++) {
            await press(cellAt(container, 0, "status"));
            stepped.push(chip(0).textContent);
        }
        expect(stepped).toEqual(["Picked", "Packed", "Shipped", "Received"]);
        expect(cellAt(container, 0, "status").hasAttribute("data-dirty")).toBe(false);
        await press(cellAt(container, 0, "status"), { shiftKey: true });
        expect(chip(0).textContent).toBe("Shipped");
        await press(cellAt(container, 0, "status"), { shiftKey: true });
        expect(chip(0).textContent).toBe("Packed");
        expect(editor(container)).toBeNull();
        // Details offers the steps as one line, in their order, Bellmoor's packed checked; a radio drafts as the cell does.
        await press(cellAt(container, 1, "customer"));
        await waitFor(() => expect(inspected(container)).toBe("SO-1042"));
        const line = detailsField(container, "status");
        expect([line.getAttribute("data-layout"), line.getAttribute("title")]).toEqual(["line", "Status"]);
        expect(choicesOf(line)).toEqual(["Received", "Picked", "Packed", "Shipped"]);
        expect(checkedOf(line)).toEqual([false, false, true, false]);
        fireEvent.click(radiosOf(line)[3]!);
        await settle();
        expect(chip(1).textContent).toBe("Shipped");
        expect(cellAt(container, 1, "status").hasAttribute("data-dirty")).toBe(true);
        await press(history(container, editingMessages.apply()));
        await waitFor(() => expect(status(container)).toBe("Applied 2 changes to 2 orders"));
        const orders = await h.read(ex.recordOrders);
        const statusEqual = equalFor(ex.Status);
        expect([...orders].map(([id, order]) => [id, statusEqual(order.status, variant("packed", null)), statusEqual(order.status, variant("shipped", null))]))
            .toEqual([["SO-1041", true, false], ["SO-1042", false, true], ["SO-1043", false, true]]);
    });
});

/** A person's hours, as the record holds them. */
const Hours = ex.Person.fields.hours;
const hoursEqual = equalFor(Hours);
const printHours = printFor(Hours);

/** The hours by project, and by client over the same field: two columns from data writing one field. */
const hoursByClient = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const staff = $.let(Record.bind(ex.recordHours));
    const clientRows = $.let(Data.bind(ex.recordClients));
    const projectRows = $.let(Data.bind(ex.recordProjects));
    return Record({
        record: staff,
        title: "Hours",
        noun: { singular: "person", plural: "people" },
        registers: {
            clients: Record.register.members(clientRows.read(), { kind: "client", key: (_c, code) => code, label: (c) => c.name }),
            projects: Record.register.members(projectRows.read(), { kind: "project", key: (_p, code) => code, label: (p) => p.name }),
        },
        columns: {
            name: Record.column.title(ex.Person, { header: "Name" }),
            hours: Record.column.quantity(ex.Person, { each: "projects", unit: "hrs" }),
            byClient: Record.column.quantity(ex.Person, { each: "clients", field: "hours", unit: "hrs" }),
        },
        name: "hoursByClient",
    });
})));

/** The roster's heads today, read at the Record's day: the column turns over with its clock. */
const rosterToday = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const shifts = $.let(Record.bind(ex.recordRoster));
    const days = $.let(["today"], ArrayType(StringType));
    return Record({
        record: shifts,
        title: "Roster",
        noun: { singular: "shift", plural: "shifts" },
        registers: { days: Record.register.members(days, { kind: "day", key: (d) => d, label: () => "Today" }) },
        columns: {
            name: Record.column.title(ex.Shift, { header: "Shift" }),
            today: Record.column.integer(ex.Shift, {
                each: "days", field: "week", editable: false,
                read: East.function([ex.Week, StringType, DateTimeType], IntegerType, ($2, week, _day, day) => {
                    // ISO's days: Monday is 1, Sunday 7.
                    const weekday = $2.const(day.getDayOfWeek());
                    $2.if(weekday.equal(1n), ($3) => { $3.return(week.mon); });
                    $2.if(weekday.equal(2n), ($3) => { $3.return(week.tue); });
                    $2.if(weekday.equal(3n), ($3) => { $3.return(week.wed); });
                    $2.if(weekday.equal(4n), ($3) => { $3.return(week.thu); });
                    $2.if(weekday.equal(5n), ($3) => { $3.return(week.fri); });
                    $2.if(weekday.equal(6n), ($3) => { $3.return(week.sat); });
                    return week.sun;
                }),
            }),
        },
        // Today's heads are read only, and no other column sets a week: this Record adds no shift.
        edits: { insertRows: false },
        name: "rosterToday",
    });
})));

/** The hours by project under a title made from data — each project's code, read only — before the person's own name. */
const hoursCodedByProject = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const staff = $.let(Record.bind(ex.recordHours));
    const projectRows = $.let(Data.bind(ex.recordProjects));
    return Record({
        record: staff,
        title: "Hours",
        noun: { singular: "person", plural: "people" },
        registers: { projects: Record.register.members(projectRows.read(), { kind: "project", key: (_p, code) => code, label: (p) => p.name }) },
        columns: {
            code: Record.column.title(ex.Person, {
                each: "projects", field: "hours", editable: false,
                read: East.function([Hours, StringType, DateTimeType], StringType, (_$2, _hours, project) => project),
            }),
            name: Record.column.title(ex.Person, { header: "Name" }),
            hours: Record.column.quantity(ex.Person, { each: "projects", unit: "hrs" }),
        },
        inspector: true,
        name: "hoursCodedByProject",
    });
})));

/** The hours by project, the app's `ready` refusing A. Morgan's: her kitchen fit-out's cell, by its column key, and her week, by the field the columns write. */
const hoursReady = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const staff = $.let(Record.bind(ex.recordHours));
    const projectRows = $.let(Data.bind(ex.recordProjects));
    const ready = $.const(East.function([Record.Types.Draft(ex.Person), Record.Types.DraftContext(ex.Person)], Record.Types.Readiness, ($2, row) => {
        const morgan = $2.const(row.name.match({ value: (_$3, name) => name.equals("A. Morgan") }, () => false));
        $2.if(morgan, ($3) => {
            $3.return(East.value(variant("invalid", [
                { field: "hours:P-100", message: "The kitchen fit-out is closed to new hours" },
                { field: "hours", message: "The week waits for the lead's sign-off" },
            ]), Record.Types.Readiness));
        });
        return East.value(variant("ready", null), Record.Types.Readiness);
    }));
    return Record({
        record: staff,
        title: "Hours",
        noun: { singular: "person", plural: "people" },
        registers: { projects: Record.register.members(projectRows.read(), { kind: "project", key: (_p, code) => code, label: (p) => p.name }) },
        columns: {
            name: Record.column.title(ex.Person, { header: "Name" }),
            hours: Record.column.quantity(ex.Person, { each: "projects", unit: "hrs" }),
        },
        inspector: true,
        ready: { row: ready },
        name: "hoursReady",
    });
})));

/** A value typed into a cell: the ring on it, its editor opened by the first key, the text in it and Tab — ⏎ on the last row would add one under it. */
async function typeInto(container: HTMLElement, r: number, column: string, text: string) {
    await press(cellAt(container, r, column));
    await key(container, text[0]!);
    const input = await waitFor(() => {
        const open = cellAt(container, r, column).querySelector<HTMLInputElement>('[data-slot="editorInput"]');
        expect(open).not.toBeNull();
        return open!;
    });
    fireEvent.input(input, { target: { value: text } });
    await settle();
    fireEvent.keyDown(input, { key: "Tab" });
    await settle();
}

/** A cell cleared: the ring on it, and ⌫. */
async function clear(container: HTMLElement, r: number, column: string) {
    await press(cellAt(container, r, column));
    await key(container, "Backspace");
}

describe("columns from data, read and written at the day", () => {
    test("a Dict field with no functions: each cell its member's entry, blank where it has none; an edit sets the entry, one step Undo takes back", async () => {
        const { container } = await h.mount(ex.recordHoursByProject, { storageKey: "record-data-dict" });
        const logged = (r: number) => ["hours:P-100", "hours:P-101", "hours:P-200", "hours:P-900"].map((k) => cellAt(container, r, k).textContent);
        expect([logged(0), logged(1), logged(2)]).toEqual([["12.5hrs", "", "4hrs", ""], ["", "30hrs", "", "6hrs"], ["", "", "", ""]]);
        await typeInto(container, 2, "hours:P-101", "7");
        expect(logged(2)).toEqual(["", "7hrs", "", ""]);
        expect(cellAt(container, 2, "hours:P-101").hasAttribute("data-dirty")).toBe(true);
        expect(rows(container)[2]!.hasAttribute("data-draft")).toBe(true);
        await press(history(container, editingMessages.undo()));
        expect(logged(2)).toEqual(["", "", "", ""]);
        expect(rows(container)[2]!.hasAttribute("data-draft")).toBe(false);
    });

    test("a struct's fields: an edit writes the struct, its other fields as they were", async () => {
        const { container } = await h.mount(ex.recordRosterByDay, { storageKey: "record-data-struct" });
        expect(rows(container).map((_row, r) => cellAt(container, r, "week:mon").textContent)).toEqual(["4", "3", "2"]);
        await typeInto(container, 0, "week:mon", "5");
        expect(cellAt(container, 0, "week:mon").textContent).toBe("5");
        expect([cellAt(container, 0, "week:mon").hasAttribute("data-dirty"), cellAt(container, 0, "week:tue").hasAttribute("data-dirty")]).toEqual([true, false]);
        await press(history(container, editingMessages.apply()));
        await waitFor(() => expect(status(container)).toBe("Applied 1 change to 1 shift"));
        const roster = await h.read(ex.recordRoster);
        const early = roster.get("S-1")!.week;
        expect(equalFor(ex.Week)(early, { mon: 5n, tue: 4n, wed: 4n, thu: 4n, fri: 4n, sat: 2n, sun: 0n }), printFor(ex.Week)(early)).toBe(true);
    });

    test("two columns writing one field chain in one gesture — a paste across both, one step Undo takes back and Redo brings again — and Apply writes both", async () => {
        const { container } = await h.mount({ fn: hoursByClient }, { storageKey: "record-data-chain" });
        const pasted = () => [cellAt(container, 2, "hours:P-900").textContent, cellAt(container, 2, "byClient:C-01").textContent];
        await press(cellAt(container, 2, "hours:P-900"));
        await act(async () => { fireEvent.paste(grid(container), { clipboardData: { getData: () => "1\t2" } }); });
        await settle();
        expect(pasted()).toEqual(["1hrs", "2hrs"]);
        await press(history(container, editingMessages.undo()));
        expect(pasted()).toEqual(["", ""]);
        await press(history(container, editingMessages.redo()));
        expect(pasted()).toEqual(["1hrs", "2hrs"]);
        await press(history(container, editingMessages.apply()));
        await waitFor(() => expect(status(container)).toBe("Applied 1 change to 1 person"));
        const patel = (await h.read(ex.recordHours)).get("H-03")!.hours;
        expect(hoursEqual(patel, new Map([["C-01", 2], ["P-900", 1]])), printHours(patel)).toBe(true);
    });

    test("Save sends each field's difference — an entry set where there was none, one changed and one cleared — and a field an edit leaves where it began sends nothing", async () => {
        const { container } = await h.mount(ex.recordHoursByProject, { storageKey: "record-data-save" });
        await typeInto(container, 1, "hours:P-200", "8");
        await typeInto(container, 0, "hours:P-100", "10");
        await clear(container, 0, "hours:P-200");
        // C. Patel's shop front, set and cleared again: her hours as the record holds them.
        await typeInto(container, 2, "hours:P-200", "3");
        await clear(container, 2, "hours:P-200");
        expect(rows(container).map((row) => row.hasAttribute("data-draft"))).toEqual([true, true, false]);
        await press(history(container, editingMessages.apply()));
        await waitFor(() => expect(status(container)).toBe("Applied 2 changes to 2 people"));
        const hours = await h.read(ex.recordHours);
        const held = ["H-01", "H-02", "H-03"].map((id) => hours.get(id)!.hours);
        const expected = [new Map([["P-100", 10]]), new Map([["P-101", 30], ["P-200", 8], ["P-900", 6]]), new Map<string, number>()];
        expect(held.map((logged, i) => hoursEqual(logged, expected[i]!)), held.map((logged) => printHours(logged)).join(" · ")).toEqual([true, true, true]);
    });

    test("the data moving: a member added becomes a column, one moved changes group and one retired loses its column — a row still naming it keeping its entry through a Save", async () => {
        const { container } = await h.mount(ex.recordHoursByProject, { storageKey: "record-data-moves" });
        const keys = () => [...container.querySelectorAll<HTMLElement>('[data-record] [data-slot="headerCell"]')].map((cell) => cell.getAttribute("data-key"));
        const groups = () => [...container.querySelectorAll<HTMLElement>('[data-record] [data-slot="groupSeg"]')].map((segment) => [segment.style.gridColumn, segment.textContent]);
        expect(keys()).toEqual(["name", "hours:P-100", "hours:P-101", "hours:P-200", "hours:P-900"]);
        expect(groups()).toEqual([["span 2", ""], ["span 2", "Ashgrove Joinery"], ["span 1", "Bellmoor Interiors"], ["span 1", ""]]);
        // The stair rebuild moves to Bellmoor, a site office comes in for Corran, and training is retired.
        await h.patch(ex.recordProjects, new Map([
            ["P-100", { name: "Kitchen fit-out", client: "C-01" }],
            ["P-101", { name: "Stair rebuild", client: "C-02" }],
            ["P-200", { name: "Shop front", client: "C-02" }],
            ["P-300", { name: "Site office", client: "C-03" }],
        ]));
        await waitFor(() => expect(keys()).toEqual(["name", "hours:P-100", "hours:P-101", "hours:P-200", "hours:P-300"]));
        expect(groups()).toEqual([["span 2", ""], ["span 1", "Ashgrove Joinery"], ["span 2", "Bellmoor Interiors"], ["span 1", "Corran Builders"]]);
        await typeInto(container, 1, "hours:P-101", "31");
        await press(history(container, editingMessages.apply()));
        await waitFor(() => expect(status(container)).toBe("Applied 1 change to 1 person"));
        const ellis = (await h.read(ex.recordHours)).get("H-02")!.hours;
        expect(hoursEqual(ellis, new Map([["P-101", 31], ["P-900", 6]])), printHours(ellis)).toBe(true);
    });

    test("a column read at the day turns over with the Record's clock: a Sunday's heads, then Monday's", async () => {
        // A Sunday, a minute before midnight where the browser is: the clock's next read falls on the turn.
        vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
        vi.setSystemTime(new Date(2026, 10, 8, 23, 59, 0));
        try {
            const { container } = await h.mount({ fn: rosterToday }, { storageKey: "record-data-day" });
            const today = () => rows(container).map((_row, r) => cellAt(container, r, "today:today").textContent);
            expect(today()).toEqual(["0", "0", "2"]);
            await act(async () => { vi.advanceTimersByTime(60_000); });
            await settle();
            expect(today()).toEqual(["4", "3", "2"]);
        } finally {
            vi.useRealTimers();
        }
    });

    test("a title made from data is no row's title: the person's own name names the row — its box and its Details' head — and Add puts the ring on it", async () => {
        const { container } = await h.mount({ fn: hoursCodedByProject }, { storageKey: "record-data-title" });
        // Each project's code first, then the name.
        expect(cellAt(container, 0, "code:P-100").textContent).toBe("P-100");
        expect(tick(container, 0).getAttribute("aria-label")).toBe("Select A. Morgan");
        await press(cellAt(container, 0, "name"));
        await waitFor(() => expect(inspected(container)).toBe("H-01"));
        expect(details(container)!.querySelector("[data-inspector-id]")!.textContent).toBe("A. Morgan");
        await press(action(container, "add")!);
        expect(active(container)).toBe(cellOf(drafted(container), "name"));
    });

    test("a conflict not yet chosen rings the cell of the member it falls on: a project's hours another Save changed under the draft, and none of the field's other projects, nor the row", async () => {
        const { container } = await h.mount(ex.recordHoursByProject, { storageKey: "record-data-conflict" });
        // A. Morgan's kitchen hours typed here; another Save lands first, moving them.
        await typeInto(container, 0, "hours:P-100", "10");
        await h.race(ex.recordHours, () => fireEvent.click(history(container, editingMessages.apply())), (staff) => {
            const next = new Map(staff);
            const morgan = staff.get("H-01")!;
            next.set("H-01", { ...morgan, hours: new Map(morgan.hours).set("P-100", 11) });
            return next;
        });
        await waitFor(() => expect(cellAt(container, 0, "hours:P-100").hasAttribute("data-conflict")).toBe(true));
        expect(["hours:P-101", "hours:P-200", "hours:P-900"].map((k) => cellAt(container, 0, k).hasAttribute("data-conflict"))).toEqual([false, false, false]);
        expect(rows(container)[0]!.hasAttribute("data-conflict")).toBe(false);
    });

    test("a conflict not yet chosen in a struct the columns from data write rings the field it falls on: Monday's heads, and not Tuesday's", async () => {
        const { container } = await h.mount(ex.recordRosterByDay, { storageKey: "record-data-conflict-struct" });
        await typeInto(container, 0, "week:mon", "5");
        await h.race(ex.recordRoster, () => fireEvent.click(history(container, editingMessages.apply())), (roster) => {
            const next = new Map(roster);
            const early = roster.get("S-1")!;
            next.set("S-1", { ...early, week: { ...early.week, mon: 6n } });
            return next;
        });
        await waitFor(() => expect(cellAt(container, 0, "week:mon").hasAttribute("data-conflict")).toBe(true));
        expect(cellAt(container, 0, "week:tue").hasAttribute("data-conflict")).toBe(false);
    });

    test("a refusal of the app's `ready` naming a member's cell by its column key marks that cell as any cell's issue does — read out as its description, its Details line ringed, and Details and the Issues tab naming it by its member — and one naming the field the columns write holds Apply and marks no cell", async () => {
        const { container } = await h.mount({ fn: hoursReady }, { storageKey: "record-data-ready" });
        const projects = ["hours:P-100", "hours:P-101", "hours:P-200", "hours:P-900"];
        await typeInto(container, 0, "hours:P-100", "14");
        // The kitchen fit-out's cell alone is invalid, its issue read out; no cell is the week's.
        expect(["name", ...projects].map((k) => cellAt(container, 0, k).getAttribute("aria-invalid"))).toEqual([null, "true", null, null, null]);
        expect(describedBy(cellAt(container, 0, "hours:P-100"))).toBe("The kitchen fit-out is closed to new hours");
        expect(history(container, editingMessages.apply()).disabled).toBe(true);
        // The ring on B. Ellis's row, then the history bar's Issues: both hold Apply, and the first takes the ring to the kitchen fit-out.
        await press(cellAt(container, 1, "hours:P-101"));
        await press(history(container, editingMessages.issues({ n: 2, count: "2" })));
        expect(status(container)).toBe("2 issues hold Apply");
        expect(active(container)).toBe(cellAt(container, 0, "hours:P-100"));
        await waitFor(() => expect(inspected(container)).toBe("H-01"));
        const issues = details(container)!.querySelector<HTMLElement>("[data-inspector-issues]")!;
        expect([...issues.querySelectorAll("[data-kind]")].map((text) => [text.previousElementSibling?.textContent, text.textContent]))
            .toEqual([["Kitchen fit-out", "The kitchen fit-out is closed to new hours"], ["hours", "The week waits for the lead's sign-off"]]);
        expect([...details(container)!.querySelectorAll("[data-field][data-issue]")].map((field) => field.getAttribute("data-field"))).toEqual(["hours:P-100"]);
        await waitFor(() => expect(detailsField(container, "hours:P-100").contains(document.activeElement)).toBe(true));
        fireEvent.click(inspectorTab(container, /^Issues/));
        await settle();
        expect([...openPanel(container).querySelectorAll<HTMLElement>("[data-inspector-issue]")].map((line) => [line.firstElementChild!.textContent, line.querySelector("[data-kind]")!.textContent]))
            .toEqual([["A. Morgan · Kitchen fit-out", "The kitchen fit-out is closed to new hours"], ["A. Morgan · hours", "The week waits for the lead's sign-off"]]);
    });
});

/** What a column's `mark` returns. */
const Mark = OptionType(Record.Types.Mark);
/** What a notes column's fill provider returns. */
const NotesFill = OptionType(Sheet.Types.Fill(StringType));

/** The hours by project, the training booked centrally locked and the shop front's noted; the lead's name noted, a plain column's mark over its row. */
const hoursMarked = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const staff = $.let(Record.bind(ex.recordHours));
    const projectRows = $.let(Data.bind(ex.recordProjects));
    return Record({
        record: staff,
        title: "Hours",
        noun: { singular: "person", plural: "people" },
        registers: { projects: Record.register.members(projectRows.read(), { kind: "project", key: (_p, code) => code, label: (p) => p.name }) },
        columns: {
            name: Record.column.title(ex.Person, {
                header: "Name",
                mark: East.function([ex.Person, DateTimeType], Mark, ($2, person) => {
                    $2.if(person.name.equal("A. Morgan"), ($3) => { $3.return(some(variant("note", "Lead"))); });
                    return none;
                }),
            }),
            hours: Record.column.quantity(ex.Person, {
                each: "projects", unit: "hrs",
                mark: East.function([Hours, StringType, DateTimeType], Mark, ($2, _hours, project) => {
                    $2.if(project.equal("P-900"), ($3) => { $3.return(some(variant("lock", "Booked centrally"))); });
                    $2.if(project.equal("P-200"), ($3) => { $3.return(some(variant("note", "Estimate"))); });
                    return none;
                }),
            }),
        },
        inspector: true,
        name: "hoursMarked",
    });
})));

/** The operators, one on nights locked out of her notes, shifts and overtime; empty notes filled with the rota's words. */
const operatorsOnNights = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const operators = $.let(Record.bind(ex.recordOperators));
    const choices = $.let(["can", "prefer", "cannot"], ArrayType(StringType));
    const onNights = $.const(East.function([ex.Operator, DateTimeType], Mark, ($2, operator) => {
        $2.if(operator.night, ($3) => { $3.return(some(variant("lock", "On nights"))); });
        return none;
    }));
    const covering = $.const(East.function([Record.Types.DraftContext(ex.Operator)], NotesFill, () => East.value(some({ value: "Covering nights", meta: "the rota" }), NotesFill)));
    return Record({
        record: operators,
        title: "Operators",
        noun: { singular: "operator", plural: "operators" },
        // The operators come from the Gatehouse: this Record edits them, and adds none.
        edits: { insertRows: false },
        registers: { choices: Record.register.members(choices, { kind: "choice", key: (c) => c, label: (c) => c }) },
        columns: {
            name: Record.column.title(ex.Operator, { header: "Name" }),
            notes: Record.column.text(ex.Operator, { header: "Notes", fill: [covering], mark: onNights }),
            shifts: Record.column.integer(ex.Operator, { header: "Shifts", mark: onNights }),
            hours: Record.column.quantity(ex.Operator, { header: "Hours", unit: "hrs" }),
            night: Record.column.toggle(ex.Operator, { header: "Nights", on: "yes", off: "no" }),
            preference: Record.column.cycle(ex.Operator, "choices", { header: "Overtime", mark: onNights }),
        },
        inspector: true,
        name: "operatorsOnNights",
    });
})));

/** The operators, their marks failing over A. Morgan's row — the app's code can't finish them — and B. Ellis on nights. */
const operatorsUnread = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const operators = $.let(Record.bind(ex.recordOperators));
    const choices = $.let(["can", "prefer", "cannot"], ArrayType(StringType));
    const onNights = $.const(East.function([ex.Operator, DateTimeType], Mark, ($2, operator) => {
        $2.if(operator.name.equal("A. Morgan"), ($3) => { $3.error("The rota is offline"); });
        $2.if(operator.night, ($3) => { $3.return(some(variant("lock", "On nights"))); });
        return none;
    }));
    return Record({
        record: operators,
        title: "Operators",
        noun: { singular: "operator", plural: "operators" },
        // No column sets an operator's notes or hours: this Record adds none.
        edits: { insertRows: false },
        registers: { choices: Record.register.members(choices, { kind: "choice", key: (c) => c, label: (c) => c }) },
        columns: {
            name: Record.column.title(ex.Operator, { header: "Name" }),
            shifts: Record.column.integer(ex.Operator, { header: "Shifts", mark: onNights }),
            preference: Record.column.cycle(ex.Operator, "choices", { header: "Overtime", mark: onNights }),
        },
        name: "operatorsUnread",
    });
})));

describe("marks and locks", () => {
    test("a note draws after the value, or in an empty cell in its place; a lock is the Tag after the value, or alone, its cell read only and taking no hover; the hover and the strip say both; a plain column's mark reads its row", async () => {
        const { container } = await h.mount({ fn: hoursMarked }, { storageKey: "record-marks" });
        const at = (r: number, k: string) => cellAt(container, r, k);
        // A plain column's mark, over its row: the lead's name noted, after it.
        expect([part(at(0, "name"), "note")?.textContent, part(at(0, "name"), "note")?.hasAttribute("data-alone")]).toEqual(["Lead", false]);
        expect(at(0, "name").getAttribute("title")).toBe("A. Morgan · H-01 · Lead");
        expect(part(at(1, "name"), "note")).toBeNull();
        // The shop front's hours noted: after A. Morgan's 4, and in B. Ellis's empty cell in its place.
        expect([at(0, "hours:P-200").textContent, part(at(0, "hours:P-200"), "note")!.hasAttribute("data-alone")]).toEqual(["4hrsEstimate", false]);
        expect([at(1, "hours:P-200").textContent, part(at(1, "hours:P-200"), "note")!.hasAttribute("data-alone")]).toEqual(["Estimate", true]);
        expect(at(1, "hours:P-200").getAttribute("title")).toBe("Estimate");
        // Training locked: the Tag after B. Ellis's 6, and alone in the others' empty cells.
        expect([at(1, "hours:P-900").textContent, part(at(1, "hours:P-900"), "lock")!.hasAttribute("data-alone")]).toEqual(["6hrsBooked centrally", false]);
        expect([at(0, "hours:P-900").textContent, part(at(0, "hours:P-900"), "lock")!.hasAttribute("data-alone")]).toEqual(["Booked centrally", true]);
        expect(at(1, "hours:P-900").getAttribute("title")).toBe("locked: Booked centrally");
        // Each locked cell read only and still; a cell no mark locks neither.
        expect(rows(container).map((_row, r) => [at(r, "hours:P-900").hasAttribute("data-locked"), at(r, "hours:P-900").hasAttribute("data-still"), at(r, "hours:P-900").getAttribute("aria-readonly")]))
            .toEqual([[true, true, "true"], [true, true, "true"], [true, true, "true"]]);
        expect([at(0, "hours:P-100").hasAttribute("data-locked"), at(0, "hours:P-100").hasAttribute("data-still"), at(0, "hours:P-100").getAttribute("aria-readonly")])
            .toEqual([false, false, null]);
        // The strip says the mark after the cell's value, and offers a locked cell no edit.
        await hover(at(1, "hours:P-900"));
        expect(stripSays(container)).toEqual(["Training", "6 · locked: Booked centrally", "↑ ↓ ← → move"]);
        await hover(at(0, "hours:P-200"));
        expect(stripSays(container)).toEqual(["Shop front", "4 · Estimate", "⏎ edit · ↑ ↓ ← → move"]);
    });

    test("a lock refuses every gesture — a step, typing, a clear, a paste and a fill — and lifts as the draft it reads changes", async () => {
        const { container } = await h.mount({ fn: operatorsOnNights }, { storageKey: "record-locks" });
        const at = (r: number, k: string) => cellAt(container, r, k);
        const locked = (r: number) => ["notes", "shifts", "preference"].map((k) => at(r, k).hasAttribute("data-locked"));
        // B. Ellis is on nights: her notes, shifts and overtime are locked, and her overtime steps nowhere.
        expect([locked(0), locked(1)]).toEqual([[false, false, false], [true, true, true]]);
        expect([at(0, "preference").hasAttribute("data-steps"), at(1, "preference").hasAttribute("data-steps")]).toEqual([true, false]);
        // A step: a press, and Space on the ring.
        await press(at(1, "preference"));
        await key(container, " ");
        expect(part(at(1, "preference"), "chip")!.textContent).toBe("can");
        // Typing: a key opens no editor; and a clear.
        await press(at(1, "shifts"));
        await key(container, "5");
        expect(editor(container)).toBeNull();
        await key(container, "Backspace");
        expect(at(1, "shifts").textContent).toBe("96On nights");
        // A paste down Shifts from A. Morgan's: hers takes it, B. Ellis's keeps its value.
        await press(at(0, "shifts"));
        await act(async () => { fireEvent.paste(grid(container), { clipboardData: { getData: () => "10\n20" } }); });
        await settle();
        expect([at(0, "shifts").textContent, at(1, "shifts").textContent]).toEqual(["10", "96On nights"]);
        expect(rows(container)[1]!.hasAttribute("data-draft")).toBe(false);
        // A fill: an edit on her row runs the fills, and ⌘⏎ takes none into her locked notes …
        await typeInto(container, 1, "hours", "14");
        await key(container, "Enter", { metaKey: true });
        expect(at(1, "notes").textContent).toBe("On nights");
        // … until she comes off nights: the lock lifts, and the next fill lands.
        await press(at(1, "night"));
        expect(locked(1)).toEqual([false, false, false]);
        await typeInto(container, 1, "hours", "15");
        await key(container, "Enter", { metaKey: true });
        expect(at(1, "notes").textContent).toBe("Covering nights");
    });

    test("a lock stands while the draft it reads isn't whole: text no column reads, typed in another of the row's cells, leaves its locks as they were", async () => {
        const { container } = await h.mount({ fn: operatorsOnNights }, { storageKey: "record-locks-unwhole" });
        const at = (r: number, k: string) => cellAt(container, r, k);
        const locked = (r: number) => ["notes", "shifts", "preference"].map((k) => at(r, k).hasAttribute("data-locked"));
        // B. Ellis's hours typed as words: her draft holds text no column reads, and her marks can't be read over it.
        await typeInto(container, 1, "hours", "lots");
        expect(rows(container)[1]!.hasAttribute("data-draft")).toBe(true);
        expect(at(1, "hours").textContent).toContain("lots");
        expect(locked(1)).toEqual([true, true, true]);
        // Locked still: her overtime steps nowhere, and a key opens no editor in her shifts.
        await press(at(1, "preference"));
        expect(part(at(1, "preference"), "chip")!.textContent).toBe("can");
        await press(at(1, "shifts"));
        await key(container, "5");
        expect(editor(container)).toBeNull();
    });

    test("a row whose marks can't be read keeps every marked cell locked, each saying it couldn't be read, and the console says why", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { container } = await h.mount({ fn: operatorsUnread }, { storageKey: "record-locks-unread" });
            const at = (r: number, k: string) => cellAt(container, r, k);
            // A. Morgan's marks fail: her shifts and overtime locked, saying so; B. Ellis's are read, and she is on nights.
            expect([0, 1].map((r) => ["shifts", "preference"].map((k) => at(r, k).hasAttribute("data-locked")))).toEqual([[true, true], [true, true]]);
            expect([at(0, "shifts").textContent, at(1, "shifts").textContent]).toEqual(["1,482Couldn't be read", "96On nights"]);
            expect(logged).toHaveBeenCalledWith("[Sheet] a column from data or a mark could not be read:", expect.anything());
            // Locked, her overtime steps nowhere.
            await press(at(0, "preference"));
            expect(part(at(0, "preference"), "chip")!.textContent).toBe("prefer");
        } finally {
            logged.mockRestore();
        }
    });

    test("a clear is refused where the cell's value isn't an option: ⌫, a blank pasted and an edit emptied each leave the roster's heads as they were", async () => {
        const { container } = await h.mount(ex.recordRosterByDay, { storageKey: "record-clear-refused" });
        const week = () => ["week:mon", "week:tue"].map((k) => cellAt(container, 0, k).textContent);
        await clear(container, 0, "week:mon");
        expect(week()).toEqual(["4", "4"]);
        await act(async () => { fireEvent.paste(grid(container), { clipboardData: { getData: () => "\t" } }); });
        await settle();
        expect(week()).toEqual(["4", "4"]);
        await key(container, "7");
        const input = await waitFor(() => {
            const open = cellAt(container, 0, "week:mon").querySelector<HTMLInputElement>('[data-slot="editorInput"]');
            expect(open).not.toBeNull();
            return open!;
        });
        fireEvent.input(input, { target: { value: "" } });
        await settle();
        fireEvent.keyDown(input, { key: "Tab" });
        await settle();
        expect(week()).toEqual(["4", "4"]);
        expect(rows(container)[0]!.hasAttribute("data-draft")).toBe(false);
    });

    test("each refusal says why in the status line: ⌫, a blank pasted and an edit emptied where the value is never empty, and text a column from data can't hold, pasted or typed", async () => {
        const { container } = await h.mount(ex.recordRosterByDay, { storageKey: "record-refusals-said" });
        const week = () => ["week:mon", "week:tue"].map((k) => cellAt(container, 0, k).textContent);
        const paste = async (text: string) => {
            await act(async () => { fireEvent.paste(grid(container), { clipboardData: { getData: () => text } }); });
            await settle();
        };
        await clear(container, 0, "week:mon");
        expect(status(container)).toBe("Nothing cleared — Mon can't be left empty");
        await paste("\t");
        expect(status(container)).toBe("Nothing pasted — Mon can't be left empty");
        // Text no day reads: a plain column keeps it, flagged, but a column from data keeps none.
        await paste("lots");
        expect([week(), status(container)]).toEqual([["4", "4"], "Nothing pasted — Mon can't hold \"lots\""]);
        // Across Mon and Tue: Mon takes its 5, and Tue is said kept.
        await paste("5\tlots");
        expect([week(), status(container)]).toEqual([["5", "4"], "Pasted 1×2 from clipboard · 1 skipped — Tue can't hold \"lots\""]);
        await typeInto(container, 0, "week:tue", "lots");
        expect([week(), status(container)]).toEqual([["5", "4"], "Tue can't hold \"lots\" — the edit was not kept"]);
        await press(cellAt(container, 0, "week:mon"));
        await key(container, "7");
        const input = await waitFor(() => {
            const open = cellAt(container, 0, "week:mon").querySelector<HTMLInputElement>('[data-slot="editorInput"]');
            expect(open).not.toBeNull();
            return open!;
        });
        fireEvent.input(input, { target: { value: "" } });
        await settle();
        fireEvent.keyDown(input, { key: "Tab" });
        await settle();
        expect([week(), status(container)]).toEqual([["5", "4"], "Mon can't be left empty — the edit was not kept"]);
    });

    test("a lock's refusal says its words, ⌫ and a paste alike, and a range ⌫ clears what it can and counts what it kept", async () => {
        const { container } = await h.mount({ fn: hoursMarked }, { storageKey: "record-refusals-locked" });
        const training = () => cellAt(container, 1, "hours:P-900").textContent;
        // B. Ellis's training: 6, booked centrally.
        await clear(container, 1, "hours:P-900");
        expect([training(), status(container)]).toEqual(["6hrsBooked centrally", "Nothing cleared — locked: Booked centrally"]);
        await act(async () => { fireEvent.paste(grid(container), { clipboardData: { getData: () => "7" } }); });
        await settle();
        expect([training(), status(container)]).toEqual(["6hrsBooked centrally", "Nothing pasted — locked: Booked centrally"]);
        // Her stair rebuild's 30 to her training: the 30 cleared, the training kept.
        await press(cellAt(container, 1, "hours:P-101"));
        await press(cellAt(container, 1, "hours:P-900"), { shiftKey: true });
        await key(container, "Backspace");
        expect([cellAt(container, 1, "hours:P-101").textContent, training()]).toEqual(["", "6hrsBooked centrally"]);
        expect(status(container)).toBe("Cleared 1 cell · 1 kept — locked: Booked centrally");
    });

    test("a cell its column holds read only says so as ⌫ leaves it", async () => {
        const { container } = await h.mount(ex.recordEveryKind, { storageKey: "record-refusals-read-only" });
        await clear(container, 0, "days_since");
        expect(status(container)).toBe("Nothing cleared — Days since is read only");
    });

    test("several rows set a column only where a cell takes it: a set a lock keeps from a row says why, and a column every row's mark locks is no input", async () => {
        const { container } = await h.mount({ fn: operatorsOnNights }, { storageKey: "record-bulk-locked" });
        const at = (r: number, k: string) => cellAt(container, r, k);
        const several = () => openPanel(container).querySelector<HTMLElement>('[data-sheet-inspector="several"]');
        const both = async () => {
            await press(at(0, "hours"));
            await press(at(1, "hours"), { shiftKey: true });
            await waitFor(() => expect(several()).not.toBeNull());
        };
        /** The bulk edit's column choice: a select over many columns, radios over a few. */
        const choice = () => several()!.querySelector<HTMLElement>('[data-field="$column"]')!;
        /** The select's options, its listbox open. */
        const options = async () => {
            const trigger = choice().querySelector<HTMLElement>("[data-scope=select][data-part=trigger]")!;
            await act(async () => { fireEvent.click(trigger); });
            return within(document.getElementById(trigger.getAttribute("aria-controls") ?? "")!).getAllByRole("option");
        };
        // B. Ellis is on nights, A. Morgan not: Shifts is offered, and Set sets A. Morgan's alone.
        await both();
        await press((await options()).find((option) => option.textContent === "Shifts")!);
        await press(several()!.querySelector('[data-field="shifts"] [data-field-set]')!);
        expect([at(0, "shifts").textContent, at(1, "shifts").textContent]).toEqual(["0", "96On nights"]);
        expect(status(container)).toBe("locked: On nights — the edit was not kept");
        // A. Morgan on nights too: no row takes Notes, Shifts or Overtime, and the range is offered none of them.
        await press(at(0, "night"));
        await both();
        expect(choicesOf(choice())).toEqual(["Name", "Hours", "Nights"]);
    });
});

/** The fields of an element of Details, by their keys, in order. */
const fieldKeys = (root: Element) => [...root.querySelectorAll("[data-field]")].map((field) => field.getAttribute("data-field"));
/** Details' sections: each one's label and its fields. */
const sectionsOf = (container: HTMLElement) => [...details(container)!.querySelectorAll<HTMLElement>("[data-field-group]")]
    .map((section) => [section.getAttribute("data-field-group"), fieldKeys(section)]);
/** A field's help line, as the shared Field draws it. */
const helpOf = (container: HTMLElement, key: string) => detailsField(container, key).querySelector("[data-part=helper-text]")?.textContent;
/** A read-only field's value, as it is printed. */
const printedOf = (container: HTMLElement, key: string) => (within(detailsField(container, key)).getByRole("textbox") as HTMLInputElement).value;

describe("columns from data in the side panel (#1561)", () => {
    test("each member a line in its column's place, in its group's section, labelled by its member and holding its cell — the field the columns write no field of its own", async () => {
        const { container } = await h.mount(ex.recordHoursByProject, { storageKey: "record-lines" });
        await press(cellAt(container, 0, "name"));
        await waitFor(() => expect(inspected(container)).toBe("H-01"));
        const projects = ["hours:P-100", "hours:P-101", "hours:P-200", "hours:P-900"];
        expect(fieldKeys(details(container)!)).toEqual(["name", ...projects]);
        expect(sectionsOf(container)).toEqual([
            ["Ashgrove Joinery", ["hours:P-100", "hours:P-101"]], ["Bellmoor Interiors", ["hours:P-200"]], ["Other", ["hours:P-900"]],
        ]);
        expect(projects.map((key) => detailsField(container, key).querySelector("label")!.textContent)).toEqual(["Kitchen fit-out", "Stair rebuild", "Shop front", "Training"]);
        // A. Morgan's kitchen and shop front hours, each a number in the column's unit; none on the stair rebuild, Set giving it one.
        expect(projects.map((key) => detailsField(container, key).getAttribute("data-editor"))).toEqual(["number", "number", "number", "number"]);
        expect(helpOf(container, "hours:P-100")).toBe("in hrs");
        expect((within(detailsField(container, "hours:P-101")).getByRole("textbox") as HTMLInputElement).placeholder).toBe("Not set");
        expect(within(detailsField(container, "hours:P-101")).getByRole("button", { name: "Set" })).toBeTruthy();
        expect(within(detailsField(container, "hours:P-200")).getByRole("button", { name: "Clear Shop front" })).toBeTruthy();
        expect(details(container)!.querySelector('[data-field="hours"]')).toBeNull();
    });

    test("a struct's fields: each a line under the column group that names them, the struct no field of its own, and a line whose value isn't an option no Clear", async () => {
        const { container } = await h.mount(ex.recordRosterByDay, { storageKey: "record-lines-struct" });
        await press(cellAt(container, 0, "name"));
        await waitFor(() => expect(inspected(container)).toBe("S-1"));
        const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => `week:${day}`);
        expect(fieldKeys(details(container)!)).toEqual(["name", ...days]);
        expect(sectionsOf(container)).toEqual([["Heads per day", days]]);
        expect(days.map((key) => detailsField(container, key).querySelector("label")!.textContent)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
        expect(within(details(container)!).queryByRole("button", { name: /^(Clear|Set)/ })).toBeNull();
    });

    test("an edit in a line drafts as the grid's cell does — the cell and the line changed, one step Undo takes back — and Apply writes the field's difference", async () => {
        const { container } = await h.mount(ex.recordHoursByProject, { storageKey: "record-lines-edit" });
        await press(cellAt(container, 0, "name"));
        await waitFor(() => expect(inspected(container)).toBe("H-01"));
        // The stair rebuild set, where A. Morgan logged none.
        await press(within(detailsField(container, "hours:P-101")).getByRole("button", { name: "Set" }));
        expect(cellAt(container, 0, "hours:P-101").textContent).toBe("0hrs");
        expect([cellAt(container, 0, "hours:P-101").hasAttribute("data-dirty"), detailsField(container, "hours:P-101").hasAttribute("data-dirty")]).toEqual([true, true]);
        expect(chipOf(container)).toEqual(["pending", "1 pending"]);
        await press(history(container, editingMessages.undo()));
        expect(cellAt(container, 0, "hours:P-101").textContent).toBe("");
        expect([cellAt(container, 0, "hours:P-101").hasAttribute("data-dirty"), detailsField(container, "hours:P-101").hasAttribute("data-dirty")]).toEqual([false, false]);
        // The kitchen's hours typed, a key at a time as the number input reads them, and the shop front's cleared.
        const user = userEvent.setup();
        const kitchen = within(detailsField(container, "hours:P-100")).getByRole("spinbutton");
        await user.clear(kitchen);
        for (const k of "10") {
            await user.type(kitchen, k);
            await settle();
        }
        await user.keyboard("{Enter}");
        await settle();
        expect(cellAt(container, 0, "hours:P-100").textContent).toBe("10hrs");
        await press(within(detailsField(container, "hours:P-200")).getByRole("button", { name: "Clear Shop front" }));
        expect(cellAt(container, 0, "hours:P-200").textContent).toBe("");
        await press(history(container, editingMessages.apply()));
        await waitFor(() => expect(status(container)).toBe("Applied 1 change to 1 person"));
        const morgan = (await h.read(ex.recordHours)).get("H-01")!.hours;
        expect(hoursEqual(morgan, new Map([["P-100", 10]])), printHours(morgan)).toBe(true);
    });

    test("a locked cell's line is read only, its lock's words its help; a note's words a line's help, before what the line says of its own (D1)", async () => {
        const { container } = await h.mount({ fn: hoursMarked }, { storageKey: "record-lines-marks" });
        await press(cellAt(container, 0, "name"));
        await waitFor(() => expect(inspected(container)).toBe("H-01"));
        // The lead's name noted; her training locked, logging none; her shop front's estimate noted, before its unit.
        expect(helpOf(container, "name")).toBe("Lead");
        expect([detailsField(container, "hours:P-900").getAttribute("data-editor"), printedOf(container, "hours:P-900"), helpOf(container, "hours:P-900")])
            .toEqual(["readonly", "—", "locked: Booked centrally"]);
        expect([detailsField(container, "hours:P-200").getAttribute("data-editor"), helpOf(container, "hours:P-200")]).toEqual(["number", "Estimate · in hrs"]);
        expect(helpOf(container, "hours:P-100")).toBe("in hrs");
        // B. Ellis's training: its 6 printed, read only.
        await press(cellAt(container, 1, "name"));
        await waitFor(() => expect(inspected(container)).toBe("H-02"));
        expect([detailsField(container, "hours:P-900").getAttribute("data-editor"), printedOf(container, "hours:P-900")]).toEqual(["readonly", "6"]);
        expect(within(detailsField(container, "hours:P-900")).queryByRole("button", { name: /^(Clear|Set)/ })).toBeNull();
    });

    test("a lock on a plain column reads its field only — a cycle's one line printing its choice, the lock's words under it — and lifts as the draft it reads changes (D1)", async () => {
        const { container } = await h.mount({ fn: operatorsOnNights }, { storageKey: "record-lines-lock-line" });
        // B. Ellis is on nights.
        await press(cellAt(container, 1, "name"));
        await waitFor(() => expect(inspected(container)).toBe(rows(container)[1]!.getAttribute("data-row-id")));
        const overtime = () => detailsField(container, "preference");
        expect([overtime().getAttribute("data-layout"), overtime().getAttribute("data-editor")]).toEqual(["line", "readonly"]);
        expect(overtime().querySelector("[data-field-value]")!.textContent).toBe("can");
        expect(overtime().querySelector("[data-field-help]")!.textContent).toBe("locked: On nights");
        expect(overtime().querySelector("[data-scope=radio-group]")).toBeNull();
        expect(["notes", "shifts"].map((key) => [detailsField(container, key).getAttribute("data-editor"), helpOf(container, key)]))
            .toEqual([["readonly", "locked: On nights"], ["readonly", "locked: On nights"]]);
        // Off nights, her Nights line's no: the lock lifts in Details as in the grid.
        fireEvent.click(radiosOf(detailsField(container, "night"))[1]!);
        await settle();
        expect(cellAt(container, 1, "preference").hasAttribute("data-locked")).toBe(false);
        expect(overtime().getAttribute("data-editor")).not.toBe("readonly");
        expect(checkedOf(overtime())).toEqual([true, false, false]);
        expect(overtime().querySelector("[data-field-help]")).toBeNull();
        expect(detailsField(container, "shifts").getAttribute("data-editor")).toBe("number");
    });
});
