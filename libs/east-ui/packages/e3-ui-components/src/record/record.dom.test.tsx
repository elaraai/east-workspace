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
 * header and select column through its host (decision 8) — and its cells
 * (#1532, C1–C11), over the Record's examples deployed to e3 itself, each
 * test a workspace of its own.
 */

import { describe, expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { ArrayType, East, StringType, StructType, equalFor, printFor, some } from "@elaraai/east";
import { Reactive, RecordSlicesChromeType, Slice, UIComponentType, recordSlicesChrome } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/record/record";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
import { touchFrame } from "../sheet/frame.test-utils.js";
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

/** A press on an element, the primary button, and what it leads to settled. */
async function press(el: Element, init: { shiftKey?: boolean } = {}) {
    fireEvent.mouseDown(el, { button: 0, ...init });
    fireEvent.click(el, init);
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

    test("a narrow frame keeps the Record's grid — its select column and its columns at their widths, scrolling sideways — never the Sheet's phone frame (FR1)", async () => {
        const restore = touchFrame(480);
        try {
            const { container } = await h.mount(ex.recordBasic, { storageKey: "record-narrow" });
            expect(grid(container).hasAttribute("data-phone")).toBe(false);
            expect(container.querySelector('[data-slot="pager"]')).toBeNull();
            expect(rows(container)[0]!.style.gridTemplateColumns).toBe("46px 160px 80px minmax(72px, 1fr)");
            const header = container.querySelector<HTMLElement>('[data-record] [data-slot="headerRow"]')!;
            expect(header.style.gridTemplateColumns).toBe("46px 160px 80px minmax(72px, 1fr)");
            expect([...header.querySelectorAll('[data-slot="headerCell"]')].map((cell) => cell.textContent)).toEqual(["Name", "Inducted", "Forklift"]);
            expect(cellAt(container, 0, "name").textContent).toBe("A. Morgan");
        } finally {
            restore();
        }
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
        // No ring: leaving the grid leaves nothing to show.
        fireEvent.mouseLeave(grid(container));
        await settle();
        expect(strip()).toBeNull();
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
