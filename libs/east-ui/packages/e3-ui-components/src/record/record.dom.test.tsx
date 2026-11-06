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
 * footer (FT1, FT2) — over the Record's examples deployed to e3 itself, each
 * test a workspace of its own.
 */

import { describe, expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { ArrayType, East, StringType, StructType, equalFor, printFor, some } from "@elaraai/east";
import { Reactive, RecordSlicesChromeType, Slice, UIComponentType, recordSlicesChrome } from "@elaraai/east-ui/internal";
import { editingMessages, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/record/record";
import { width } from "../e3-web-mount.test-utils.js";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
import { frameScrolls, touchFrame } from "../sheet/frame.test-utils.js";
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
/** The row Details shows, by its key. */
const inspected = (container: HTMLElement) => pane(container).querySelector('[role="tabpanel"]:not([hidden]) [data-inspector-id]')?.textContent;
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

    test("a row is picked by its title — the ring on it, and the inspector's view open on its Details — and deleted there, one step Undo takes back (P4, IN7)", async () => {
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
            await waitFor(() => expect(drawer.querySelector('[role="tabpanel"]:not([hidden]) [data-inspector-id]')?.textContent).toBe("P-0408"));
            await press(drawer.querySelector('[data-inspector-action="delete"]')!);
            expect(ids()).toEqual(["P-0401"]);
            await key(container, "z", { metaKey: true });
            expect(ids()).toEqual(["P-0401", "P-0408"]);
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
        // No inspector: a title names its row, and nowhere else to look.
        await hover(cellAt(container, 2, "name"));
        expect(stripSays(container)).toEqual(["crew member · C-003", "C. Patel", "↑ ↓ ← → move"]);
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
        vi.setSystemTime(new Date("2027-01-19T10:14:00Z"));
        try {
            const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-strip-age" });
            await hover(cellAt(container, 0, "days_since"));
            expect(stripSays(container)).toEqual(["Days since · 89", "Days since the last change · stale from 90", "↑ ↓ ← → move"]);
            await hover(cellAt(container, 2, "days_since"));
            expect(stripSays(container)).toEqual(["Days since · 251", "Stale · no change for 251 days · threshold 90", "↑ ↓ ← → move"]);
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
        vi.setSystemTime(new Date("2027-01-19T10:14:00Z"));
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
        await key(container, "ArrowDown");
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

    test("an age counts whole days to the Record's clock, warning from its threshold, and moves as the clock crosses a day (C7)", async () => {
        // A minute before A. Morgan's last change is ninety days old: the clock's next read falls on the turn.
        vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
        vi.setSystemTime(new Date("2027-01-19T10:14:00Z"));
        try {
            const { container } = await h.mount(ex.recordShiftPreferences, { storageKey: "record-cells-age" });
            const age = (r: number) => cellAt(container, r, "days_since");
            expect(part(age(0), "age")!.textContent).toBe("89");
            expect(part(age(0), "age")!.hasAttribute("data-stale")).toBe(false);
            expect(part(age(0), "staleDot")).toBeNull();
            expect(age(0).getAttribute("title")).toBe("89 days");
            // D. Novak's, from May: long past the threshold.
            expect(part(age(2), "age")!.textContent).toBe("251");
            expect(part(age(2), "age")!.hasAttribute("data-stale")).toBe(true);
            expect(within(age(2)).getByRole("img", { name: "Stale" })).toBe(part(age(2), "staleDot"));
            expect(age(2).getAttribute("title")).toBe("Stale · 251 days · threshold 90");
            // The minute turns, and nothing else changes: ninety days, and stale.
            await act(async () => { vi.advanceTimersByTime(60_000); });
            await settle();
            expect(part(age(0), "age")!.textContent).toBe("90");
            expect(part(age(0), "age")!.hasAttribute("data-stale")).toBe(true);
            expect(within(age(0)).getByRole("img", { name: "Stale" })).toBe(part(age(0), "staleDot"));
            expect(age(0).getAttribute("title")).toBe("Stale · 90 days · threshold 90");
        } finally {
            vi.useRealTimers();
        }
    });

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
        expect(name.textContent).toBe("");
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
});
