/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Sheet>`'s inspector pane (#1188, #1216, `Sheet Builder Spec.md` §5.3,
 * §9.9, SB46–SB53, SB58), over the Sheet's examples and their seeded records
 * (`harness.test-utils.tsx`) — a sheet given the pane: its two tabs, Issues
 * counted, and its rail;
 * nothing selected — the counts, the last commit and who made it, the hints;
 * one row — its number and id, each field by its column's kind, an edit one
 * transaction through its cell, tinted and Pending; a line — a field with no
 * column read only by its hint, a link's cell with Edit in sheet, and the
 * copilot asked again; a band — its own fields, its lines, its issue, Add line
 * and Delete; several rows — a column set across them as one step; the batch's
 * issues, each going to its cell; and the author's own Details for a complete
 * row — the form while the row is missing a field, and its update one step:
 * a column's field through its cell, a read-only column's left as it is, a
 * field with no column on the draft.
 */

import { test, expect } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArrayType, East, FloatType, FunctionType, NullType, OptionType, StringType, decodeBeast2For, equalFor, none, some, variant } from "@elaraai/east";
import { Button, UIComponentType } from "@elaraai/east-ui/internal";
import { Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import { formatters, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { WORKSPACE, act, sheetHarness, mount, mountPayload, settle, slot, tabs } from "./harness.test-utils.js";

const harness = sheetHarness();
const WORDS = formatters("en-US");
const JOBS = ex.sheetJobs;
const stringEqual = equalFor(StringType);
// A select scrolls its open listbox to the chosen option; jsdom does not scroll.
Element.prototype.scrollTo ??= function scrollTo() { /* jsdom lays nothing out */ };

/** The jobs as `sheetBasic` declares them, given the inspector pane. */
const jobsPayload = East.compile(East.function([], SheetPayloadType, ($) => {
    const jobs = $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch]));
    return Sheet.Payload({ record: jobs, name: "jobs", inspector: true, columns: {
        task:  Sheet.column.text(ex.SheetJob, { header: "Task", width: "240px" }),
        start: Sheet.column.date(ex.SheetJob, { header: "Start", width: "96px" }),
        qty:   Sheet.column.quantity(ex.SheetJob, { header: "Qty", width: "96px" }),
    } });
}), getRegisteredPlatformImplementations());

/**
 * The jobs with an author's inspector of one button: pressed, the row
 * goes back renamed, its start cleared and its quantity doubled — the task
 * through its column, the start under a read-only column, the quantity with
 * no column at all.
 */
const doublingPayload = East.compile(East.function([], SheetPayloadType, ($) => {
    const jobs = $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch]));
    const inspector = $.const(East.function([ex.SheetJob, FunctionType([ex.SheetJob], NullType)], UIComponentType, ($2, row, update) => {
        const double = $2.const(East.function([], NullType, ($3) => {
            const qty = $3.let(row.qty.match({ none: () => 0.0, some: (_$, q) => q }));
            const edited = $3.const({ task: East.str`${row.task}, twice`, start: none, qty: some(qty.multiply(2.0)) }, ex.SheetJob);
            $3(update(edited));
        }));
        return Button.Root("Double it", { onClick: double });
    }));
    return Sheet.Payload({ record: jobs, name: "doubling", inspector, columns: {
        task:  Sheet.column.text(ex.SheetJob, { header: "Task" }),
        start: Sheet.column.date(ex.SheetJob, { header: "Start", editable: false }),
    } });
}), getRegisteredPlatformImplementations());

/**
 * The orders, their operations' activity and notes each picked from one
 * register of words — the activity narrowed by its options rule to two of
 * them, the notes offered every one.
 */
const selectsPayload = East.compile(East.function([], SheetPayloadType, ($) => {
    const orders = $.let(Record.bind(ex.sheetWorkshopOrders, [ex.sheetWorkshopOrdersPatch]));
    const words = $.let(["Panel cutting", "Edge banding", "Assembly", "Oak veneered board"], ArrayType(StringType));
    const firstTwo = $.const(East.function([Sheet.Types.DraftContext(ex.WorkshopOrder, "ops")], OptionType(ArrayType(StringType)), ($2, _ctx) => {
        const two = $2.const(some(["Panel cutting", "Edge banding"]), OptionType(ArrayType(StringType)));
        return two;
    }));
    return Sheet.Payload({ record: orders, name: "selects", inspector: true,
        group: Sheet.group(ex.WorkshopOrder, "ops", { title: "name" }),
        registers: { words: Sheet.register.members(words, { kind: "word", key: (w) => w, label: (w) => w }) },
        columns: {
            activity: Sheet.column.enum(ex.WorkshopOperation, "words", { header: "Activity", options: firstTwo }),
            notes:    Sheet.column.enum(ex.WorkshopOperation, "words", { header: "Notes" }),
        } });
}), getRegisteredPlatformImplementations());

/**
 * The jobs with a task read through a custom column, whose parse marks what
 * it reads with a `!`, and the quantity under a `value` projection showing it
 * doubled — the field read only, the cell what it shows.
 */
const customPayload = East.compile(East.function([], SheetPayloadType, ($) => {
    const jobs = $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch]));
    const parse = $.const(East.function([StringType, Sheet.Types.DraftContext(ex.SheetJob)], OptionType(StringType), (_$2, text, _ctx) => some(East.str`${text.trim()}!`)));
    const print = $.const(East.function([StringType], StringType, (_$2, task) => task));
    return Sheet.Payload({ record: jobs, name: "custom", inspector: true, columns: {
        task: Sheet.column.custom(ex.SheetJob, { header: "Task", accepts: "a task", parse, print }),
        qty:  Sheet.column.quantity(ex.SheetJob, { header: "Qty × 2", value: (r) => r.qty.match({
            none: () => East.value(none, OptionType(FloatType)),
            some: (_$2, q) => East.value(some(q.multiply(2.0)), OptionType(FloatType)),
        }) }),
    } });
}), getRegisteredPlatformImplementations());

/** A record as it stands — what its patch door last wrote. */
function readRecord<T extends typeof JOBS | typeof ex.sheetWorkshopOrders>(record: T) {
    const bytes = harness.cache.read(WORKSPACE, [variant("field", "records"), variant("field", record.name)]);
    if (bytes === undefined) throw new Error("the record has not loaded");
    return decodeBeast2For(record.type)(bytes) as ReturnType<ReturnType<typeof decodeBeast2For<T["type"]>>>;
}
/** The jobs record as it stands. */
const readJobs = () => readRecord(JOBS);

/** A select field's choices, as its open listbox offers them; then closed again. */
async function choices(c: HTMLElement, key: string): Promise<string[]> {
    const trigger = field(c, key).querySelector<HTMLElement>("[data-scope=select][data-part=trigger]")!;
    await act(async () => { fireEvent.click(trigger); });
    // The listbox the trigger opens — a select closed earlier keeps its own in the page.
    const listbox = document.getElementById(trigger.getAttribute("aria-controls") ?? "")!;
    expect(listbox.getAttribute("role")).toBe("listbox");
    const offered = within(listbox).getAllByRole("option").map((o) => o.textContent ?? "");
    await act(async () => { fireEvent.keyDown(listbox, { key: "Escape" }); });
    await settle();
    return offered;
}

/** The grid's own elements — never a sticky band's or line's copy, which is hidden from assistive tech. */
const live = <T extends Element>(els: Iterable<T>): T[] => [...els].filter((el) => el.closest('[aria-hidden="true"]') === null);
/** The inspector pane. */
const pane = (c: HTMLElement) => slot(c, "end")!;
/** The inspector's open tab's panel. */
const panel = (c: HTMLElement) => pane(c).querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
/** What Details shows: a row, a line, a band, several rows, or nothing. */
const showing = (c: HTMLElement) => panel(c).querySelector<HTMLElement>("[data-sheet-inspector]")?.getAttribute("data-sheet-inspector");
/** Details' head: what is selected, and its id. */
const head = (c: HTMLElement) => [panel(c).querySelector("[data-inspector-what]")?.textContent, panel(c).querySelector("[data-inspector-id]")?.textContent];
/** A field of Details' form, by its key. */
const field = (c: HTMLElement, key: string) => panel(c).querySelector<HTMLElement>(`[data-field="${key}"]`)!;
/** Details' fields in order, each its key and its editor. */
const editors = (c: HTMLElement) => [...panel(c).querySelectorAll<HTMLElement>("[data-field]")].map((el) => `${el.getAttribute("data-field")}:${el.getAttribute("data-editor")}`);
/** A field's text box. */
const box = (c: HTMLElement, key: string) => within(field(c, key)).getByRole("textbox") as HTMLInputElement;
/** The grid's rows as it mounts them — a grouped sheet's lines and blank lines — never a band. */
const rows = (c: HTMLElement) => live(slot(c, "main")!.querySelectorAll<HTMLElement>('[data-slot="row"]')).filter((row) => row.querySelector('[data-slot="groupSummary"]') === null);
/** A cell of the grid's rows, by its row and its column. */
const cell = (c: HTMLElement, row: number, key: string) => rows(c)[row]!.querySelector<HTMLElement>(`[data-slot="cell"][data-key="${key}"]`)!;
/** What a cell reads: its value, without the issue it is described by. */
function reads(el: HTMLElement): string {
    const issue = el.getAttribute("aria-describedby");
    return [...el.childNodes].filter((n) => !(n instanceof HTMLElement && issue !== null && n.id === issue)).map((n) => n.textContent ?? "").join("");
}
/** The cells of a column, in order, by what they read. */
const column = (c: HTMLElement, key: string) => rows(c).map((row) => reads(row.querySelector<HTMLElement>(`[data-slot="cell"][data-key="${key}"]`)!));
/** The bands the grid mounts, each its band's words. */
const bands = (c: HTMLElement) => live(slot(c, "main")!.querySelectorAll<HTMLElement>('[data-slot="groupSummary"]')).map((band) => band.textContent ?? "");
/** A band's cell under a column, by the band's place among those mounted. */
const bandCell = (c: HTMLElement, i: number, key: string) =>
    live(slot(c, "main")!.querySelectorAll<HTMLElement>(`[data-slot="groupSummary"] [data-slot="cell"][data-key="${key}"]`))[i]!;
/** The grid. */
const grid = (c: HTMLElement) => slot(c, "main")!.querySelector<HTMLElement>('[role="grid"]')!;
/** The column of the cell the ring is on. */
const ringKey = (c: HTMLElement) => document.getElementById(grid(c).getAttribute("aria-activedescendant") ?? "")?.closest("[data-key]")?.getAttribute("data-key");

/** Puts the ring on a cell, as a press does. */
async function select(el: HTMLElement) {
    fireEvent.mouseDown(el, { button: 0 });
    await settle();
}

/** Presses a button: down, then click. */
async function press(button: Element) {
    fireEvent.mouseDown(button, { button: 0 });
    fireEvent.click(button);
    await settle();
}

/** Undoes the last step, from the frame's toolbar. */
const undo = (c: HTMLElement) => press(within(slot(c, "toolbar")!).getByRole("button", { name: "Undo" }));

/** Types a field's new text and commits it with ⏎. */
async function retype(c: HTMLElement, key: string, text: string) {
    const user = userEvent.setup();
    await user.clear(box(c, key));
    if (text !== "") await user.type(box(c, key), text);
    await user.type(box(c, key), "{Enter}");
    await settle();
}

test("the inspector has two tabs, Details and Issues, Issues with its count; collapsed, a rail with its icon, the issue count and the selected row (SB46)", async () => {
    const { container } = mountPayload(jobsPayload());
    await settle();
    expect(tabs(pane(container))).toEqual(["Details", "Issues 0"]);
    await select(cell(container, 0, "task"));
    // A required field emptied: one issue in the batch.
    await retype(container, "task", "");
    expect(tabs(pane(container))).toEqual(["Details", "Issues 1"]);
    fireEvent.click(within(pane(container)).getByRole("button", { name: "Collapse Inspector" }));
    await settle();
    expect(pane(container).hasAttribute("data-collapsed")).toBe(true);
    const detail = pane(container).querySelector<HTMLElement>("[data-dock-detail]")!;
    expect(detail.textContent).toBe("row 1");
    const rail = detail.parentElement!;
    expect(rail.querySelector('svg[data-icon="sliders"]')).not.toBeNull();
    expect(within(rail).getByText("1")).toBeTruthy();
});

test("with nothing selected, Details counts the rows, the pending drafts and the issues, says the last commit and who made it, and gives three hints (SB51)", async () => {
    const { container } = mountPayload(jobsPayload());
    await settle();
    // The blank row after the last job: no row to show.
    await select(cell(container, 4, "task"));
    expect(showing(container)).toBe("none");
    const counts = [...panel(container).querySelectorAll("[data-count]")].map((el) => [el.getAttribute("data-count"), el.textContent]);
    expect(counts).toEqual([["rows", "4rows"], ["pending", "0pending"], ["issues", "0issues"]]);
    // The stand-in records commit at the epoch, as "memory".
    expect(panel(container).querySelector("[data-inspector-commit]")!.textContent).toBe(`saved ${WORDS.dateTime(new Date(0))} by memory`);
    expect([...panel(container).querySelectorAll("li")].map((li) => li.textContent)).toEqual([
        "Click a cell to see its row's every field here",
        "Click a row number to select it — shift-click to select several",
        "Changes stay drafts until Save; the history item undoes each one",
    ]);
    // A draft counts as pending.
    await select(cell(container, 1, "task"));
    await retype(container, "task", "Edge banding, both edges");
    await select(cell(container, 4, "task"));
    expect([...panel(container).querySelectorAll("[data-count]")].map((el) => el.textContent)).toEqual(["4rows", "1pending", "0issues"]);
});

test("one row: its number and id, each field by its column's kind; an edit is one transaction through its cell, tinted and Pending, and Undo takes it back (SB47, SB52)", async () => {
    const { container } = mountPayload(jobsPayload());
    await settle();
    await select(cell(container, 0, "task"));
    expect(showing(container)).toBe("row");
    expect(head(container)).toEqual(["row 1", "J-0001"]);
    expect(editors(container)).toEqual(["task:text", "start:datetime", "qty:number"]);
    expect(box(container, "task").value).toBe("Panel cutting");
    // A date column with no level is read at a day: its date alone.
    expect(within(field(container, "start")).getAllByRole("spinbutton")).toHaveLength(3);
    expect(panel(container).querySelector("[data-state]")).toBeNull();

    await retype(container, "task", "Panel cutting, oak");
    expect(cell(container, 0, "task").textContent).toBe("Panel cutting, oak");
    expect(panel(container).querySelector("[data-state]")!.textContent).toBe("Pending");
    expect(field(container, "task").hasAttribute("data-dirty")).toBe(true);
    // One step: Undo takes it back, cell and draft.
    await undo(container);
    expect(cell(container, 0, "task").textContent).toBe("Panel cutting");
    expect(panel(container).querySelector("[data-state]")).toBeNull();
    expect(field(container, "task").hasAttribute("data-dirty")).toBe(false);

    // Duplicate: a copy of the job under a key of its own, where its key sorts — after the four.
    await press(within(panel(container)).getByRole("button", { name: "Duplicate" }));
    expect(column(container, "task").slice(0, 5)).toEqual(["Panel cutting", "Edge banding", "CNC routing", "Spray finish", "Panel cutting"]);
    await select(cell(container, 4, "task"));
    expect(panel(container).querySelector("[data-state]")!.textContent).toBe("New");
    expect(box(container, "task").value).toBe("Panel cutting");
    await undo(container);
    expect(column(container, "task")[4]).toBe("");
});

test("each selection its own form: what was typed for one line and not yet committed never lands on the next, though both hold the same value", async () => {
    const { container } = mount(ex.sheetWorkshop);
    await settle();
    // Two operations with no notes: neither a blank line.
    const empty = rows(container).flatMap((row, i) => (!row.hasAttribute("data-blank") && reads(cell(container, i, "notes")) === "" ? [i] : []));
    const [one, other] = [empty[0]!, empty[1]!];
    await select(cell(container, one, "notes"));
    const first = head(container)[0];
    const user = userEvent.setup();
    await user.type(box(container, "notes"), "Hand-finished");
    // The ring moves to the other line while the text waits for its commit; then the focus leaves.
    fireEvent.mouseDown(cell(container, other, "notes"), { button: 0 });
    await settle();
    expect(showing(container)).toBe("line");
    expect(head(container)[0]).not.toBe(first);
    fireEvent.focusOut(document.activeElement ?? document.body);
    await settle();
    expect([reads(cell(container, one, "notes")), reads(cell(container, other, "notes"))]).toEqual(["", ""]);
    expect(box(container, "notes").value).toBe("");
});

test("a custom column's text is read by its own parse, as typing in its cell is; a `value` projection's field shows the cell, read only (§5.3)", async () => {
    const { container } = mountPayload(customPayload());
    await settle();
    await select(cell(container, 0, "task"));
    expect(editors(container)).toEqual(["task:text", "start:datetime", "qty:readonly"]);
    expect(box(container, "task").value).toBe("Panel cutting");
    // The projection's cell — the quantity doubled — not the field's 48.
    expect(box(container, "qty").value).toBe(WORDS.number(96));
    await retype(container, "task", "Sanding");
    expect(cell(container, 0, "task").textContent).toBe("Sanding!");
    expect(box(container, "task").value).toBe("Sanding!");
});

test("a line: a field with no column read only by its hint, a quantity in its activity's unit, a select's members with their meta, a link's cell with Edit in sheet (SB47, SB48)", async () => {
    const { container } = mount(ex.sheetWorkshop);
    await settle();
    await select(cell(container, 0, "notes"));
    expect(showing(container)).toBe("line");
    expect(head(container)).toEqual(["line 1 of WO-2201 · Kitchen, oak", "WO-2201"]);
    // The hinted field first, then the operation's in declared order.
    expect(editors(container)).toEqual([
        "created_by:readonly", "activity:reference", "start:datetime", "end:datetime", "qty:number", "machines:custom", "notes:text",
    ]);
    expect(box(container, "created_by").value).toBe("planner");
    expect(field(container, "activity").querySelector("[data-scope=select][data-part=trigger]")!.textContent).toBe("Panel cutting · panels");
    // The column's second line, then the unit.
    expect(field(container, "qty").querySelector("[data-part=helper-text]")!.textContent).toBe("unit per activity · in panels");
    // The link's halves as the grid draws them.
    const link = field(container, "machines").querySelector<HTMLElement>('[data-inspector-link="machines"]')!;
    // Each member resolved: its code, and its family.
    expect([...link.querySelectorAll('[data-slot="chip"]')].map((chip) => chip.textContent)).toEqual(["S101beam saw", "E201edge bander"]);
    // A press puts the focus on the button, as a browser's does; Edit in sheet hands it to the grid.
    const edit = within(link).getByRole("button", { name: "Edit in sheet" });
    edit.focus();
    expect(document.activeElement).toBe(edit);
    await press(edit);
    expect(document.activeElement).toBe(grid(container));
    expect(ringKey(container)).toBe("machines");
});

test("an edit asks the copilot again when its column is a trigger: a start set in the inspector, the end's fill shows (SB52)", async () => {
    const { container } = mount(ex.sheetWorkshop);
    await settle();
    // The ash wardrobes' edge banding: no start, no end.
    const line = column(container, "activity").map((text, i) => [text, i] as const).filter(([text]) => text === "Edge banding")[1]![1];
    expect(head(container)).not.toEqual(["line 2 of WO-2202 · Wardrobes, ash", "WO-2202"]);
    await select(cell(container, line, "notes"));
    expect(head(container)).toEqual(["line 2 of WO-2202 · Wardrobes, ash", "WO-2202"]);
    expect(cell(container, line, "end").hasAttribute("data-blank")).toBe(true);
    expect(cell(container, line, "end").hasAttribute("data-proposed")).toBe(false);
    await press(within(field(container, "start")).getByRole("button", { name: "Set" }));
    expect(cell(container, line, "start").hasAttribute("data-blank")).toBe(false);
    // The end the activity's day after it: offered, not yet taken.
    expect(cell(container, line, "end").hasAttribute("data-blank")).toBe(true);
    expect(cell(container, line, "end").hasAttribute("data-proposed")).toBe(true);
});

test("a band: the group's own fields, its line count and its issues, then Add line, Duplicate and Delete with its lines (SB49)", async () => {
    const { container } = mount(ex.sheetWorkshop);
    await settle();
    await select(bandCell(container, 0, "end"));
    expect(showing(container)).toBe("band");
    expect(head(container)).toEqual(["order 1", "WO-2201"]);
    expect(panel(container).querySelector("[data-inspector-lines]")!.textContent).toBe("5 lines");
    expect(editors(container)).toEqual(["name:text", "customer:text", "due:datetime", "status:reference"]);
    expect(box(container, "customer").value).toBe("Quillfeather Interiors");
    expect(field(container, "status").querySelector("[data-scope=select][data-part=trigger]")!.textContent).toBe("RELEASED");
    expect([...panel(container).querySelectorAll("[data-inspector-action]")].map((b) => b.textContent))
        .toEqual(["Add line", "Duplicate with its lines", "Delete with its lines"]);

    // The customer, which no cell shows, is the draft's: emptied, the order's check refuses it.
    await retype(container, "customer", "");
    expect([...panel(container).querySelectorAll("[data-inspector-issues] [data-kind]")].map((el) => el.textContent)).toEqual(["Name the customer"]);
    expect(tabs(pane(container))).toEqual(["Details", "Issues 1"]);
    // The order's issue is the band's: a line of it shows none.
    await select(cell(container, 1, "notes"));
    expect(showing(container)).toBe("line");
    expect(panel(container).querySelector("[data-inspector-issues]")).toBeNull();
    await select(bandCell(container, 0, "end"));
    await retype(container, "customer", "Quillfeather Interiors");

    // Add line: a new line at the end of the order, selected.
    await press(within(panel(container)).getByRole("button", { name: "Add line" }));
    expect(showing(container)).toBe("line");
    expect(head(container)[0]).toBe("line 6 of WO-2201 · Kitchen, oak");
    expect(panel(container).querySelector("[data-state]")!.textContent).toBe("New");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await settle();

    // Delete with its lines: the order leaves the sheet.
    expect(bands(container).some((words) => words.includes("WO-2202 · Wardrobes, ash"))).toBe(true);
    await select(bandCell(container, 1, "end"));
    expect(head(container)).toEqual(["order 2", "WO-2202"]);
    await press(within(panel(container)).getByRole("button", { name: "Delete with its lines" }));
    expect(bands(container).some((words) => words.includes("WO-2202"))).toBe(false);
});

test("a band's Duplicate copies the order with its lines, under a key of its own, as one step Save commits (SB49)", async () => {
    const { container, getByRole } = mount(ex.sheetWorkshop);
    await settle();
    await select(bandCell(container, 0, "end"));
    await press(within(panel(container)).getByRole("button", { name: "Duplicate with its lines" }));
    await press(getByRole("button", { name: "Save" }));
    const orders = readRecord(ex.sheetWorkshopOrders);
    expect(orders.size).toBe(7);
    const kitchen = orders.get("WO-2201")!;
    const copies = [...orders].filter(([key, order]) => !stringEqual(key, "WO-2201") && equalFor(ex.WorkshopOrder)(order, kitchen));
    expect(copies).toHaveLength(1);
});

test("a select offers its register's members as its column's options rule offers them at the row — each field its own (§5.3)", async () => {
    const { container } = mountPayload(selectsPayload());
    await settle();
    await select(cell(container, 0, "notes"));
    expect(head(container)[0]).toBe("line 1 of WO-2201 · Kitchen, oak");
    // The fields with no column by their type — a link's two halves, member lists, read only.
    expect(editors(container)).toEqual([
        "activity:reference", "start:datetime", "end:datetime", "qty:number", "machines.from:readonly", "machines.to:readonly", "notes:reference", "created_by:text",
    ]);
    expect(await choices(container, "activity")).toEqual(["Panel cutting", "Edge banding"]);
    expect(await choices(container, "notes")).toEqual(["Panel cutting", "Edge banding", "Assembly", "Oak veneered board"]);
});

test("several rows: their count, a column set across them as one step, cleared, and deleted (SB50)", async () => {
    const { container } = mountPayload(jobsPayload());
    await settle();
    const gutters = () => live(slot(container, "main")!.querySelectorAll<HTMLElement>('[data-slot="row"] [data-slot="gutter"]'));
    fireEvent.mouseDown(gutters()[0]!, { button: 0 });
    fireEvent.mouseDown(gutters()[2]!, { button: 0, shiftKey: true });
    await settle();
    expect(showing(container)).toBe("several");
    expect(panel(container).querySelector("[data-inspector-several]")!.textContent).toBe("3 rows selected");
    // The column, Task by default, and its value.
    expect(editors(container)).toEqual(["$column:select", "task:text"]);
    await retype(container, "task", "Sanding");
    expect(column(container, "task").slice(0, 4)).toEqual(["Sanding", "Sanding", "Sanding", "Spray finish"]);
    // One step: one Undo takes back all three.
    await undo(container);
    expect(column(container, "task").slice(0, 4)).toEqual(["Panel cutting", "Edge banding", "CNC routing", "Spray finish"]);

    await press(within(panel(container)).getByRole("button", { name: "Clear Task" }));
    expect(column(container, "task").slice(0, 4)).toEqual(["", "", "", "Spray finish"]);
    expect([0, 1, 2].map((row) => cell(container, row, "task").hasAttribute("data-blank"))).toEqual([true, true, true]);
    await undo(container);
    await press(within(panel(container)).getByRole("button", { name: "Delete" }));
    expect(column(container, "task")[0]).toBe("Spray finish");
});

test("Issues lists every issue of the batch by row, and a click puts the ring on its cell (SB53)", async () => {
    const { container } = mountPayload(jobsPayload());
    await settle();
    // No issues yet: the empty state.
    fireEvent.click(within(pane(container)).getByRole("tab", { name: /Issues/ }));
    await settle();
    expect(panel(container).querySelector("[data-inspector-no-issues]")!.textContent).toBe("No issuesEvery draft is complete — nothing stands in the way of Save.");
    fireEvent.click(within(pane(container)).getByRole("tab", { name: "Details" }));
    await settle();
    for (const row of [0, 1]) {
        await select(cell(container, row, "task"));
        await retype(container, "task", "");
    }
    // The row's own: its field, and what is wrong with it.
    expect([...panel(container).querySelectorAll("[data-inspector-issues] > div:not(:first-child)")].map((el) => el.textContent)).toEqual(["TaskA value is required"]);
    // An unreadable quantity typed in the grid: the draft holds the text, refused.
    fireEvent.doubleClick(cell(container, 2, "qty"));
    await settle();
    const editor = slot(container, "main")!.querySelector('[data-slot="editorInput"]')!;
    fireEvent.input(editor, { target: { value: "zz" } });
    await settle();
    fireEvent.keyDown(editor, { key: "Enter" });
    await settle();
    fireEvent.click(within(pane(container)).getByRole("tab", { name: "Issues 3" }));
    await settle();
    const items = [...panel(container).querySelectorAll<HTMLElement>("[data-inspector-issue]")];
    expect(items.map((item) => item.textContent)).toEqual([
        "J-0001 · TaskA value is required", "J-0002 · TaskA value is required", "J-0003 · QtyInvalid input: zz",
    ]);
    // A field missing is the draft still incomplete; a field unreadable, refused.
    expect(items.map((item) => item.querySelector("[data-kind]")!.getAttribute("data-kind"))).toEqual(["incomplete", "incomplete", "invalid"]);
    await select(cell(container, 3, "qty"));
    expect(ringKey(container)).toBe("qty");
    fireEvent.click(items[1]!);
    await settle();
    expect(ringKey(container)).toBe("task");
    expect(cell(container, 1, "task").closest("[data-slot=row]")!.contains(document.getElementById(grid(container).getAttribute("aria-activedescendant")!))).toBe(true);
});

test("the author's inspector: a complete row shows it in place of the form; a row missing a field shows the form until it is complete (SB58)", async () => {
    const { container } = mount(ex.sheetWeeks);
    await settle();
    await select(cell(container, 0, "task"));
    const fields = () => panel(container).querySelector<HTMLElement>("[data-inspector-fields]")!;
    expect(fields().getAttribute("data-inspector-fields")).toBe("custom");
    expect(fields().textContent).toContain("Cut the kitchen carcasses");
    expect(within(fields()).getByRole("slider").getAttribute("aria-valuenow")).toBe("48");

    // Its task emptied in the grid: the row is incomplete, and the form shows.
    grid(container).focus();
    fireEvent.keyDown(grid(container), { key: "Backspace" });
    await settle();
    expect(cell(container, 0, "task").hasAttribute("data-blank")).toBe(true);
    expect(fields().getAttribute("data-inspector-fields")).toBe("form");
    // Every field by its column's kind — the stamped code read only — and the two no column shows by their types.
    expect(editors(container)).toEqual([
        "task:text", "start:datetime", "qty:number", "setups:number", "site:reference", "status:reference",
        "code:readonly", "level:select", "started:datetime", "machines:custom",
    ]);
    // Complete again, the author's own returns.
    await retype(container, "task", "Cut the kitchen carcasses");
    expect(fields().getAttribute("data-inspector-fields")).toBe("custom");
});

test("the author's update is one transaction: a column's field through its cell, a read-only column's left as it is, a field with no column on the draft (SB58)", async () => {
    const { container, getByRole } = mountPayload(doublingPayload());
    await settle();
    await select(cell(container, 0, "task"));
    const double = within(panel(container)).getByRole("button", { name: "Double it" });
    await press(double);
    expect(cell(container, 0, "task").textContent).toBe("Panel cutting, twice");
    // The start's column is read only: the start stays.
    expect(cell(container, 0, "start").hasAttribute("data-blank")).toBe(false);
    expect(panel(container).querySelector("[data-state]")!.textContent).toBe("Pending");
    // One step: one Undo takes back the task and the quantity together.
    await undo(container);
    expect(cell(container, 0, "task").textContent).toBe("Panel cutting");
    expect(panel(container).querySelector("[data-state]")).toBeNull();

    await press(within(panel(container)).getByRole("button", { name: "Double it" }));
    await press(getByRole("button", { name: "Save" }));
    const job = readJobs().get("J-0001")!;
    expect(job.task).toBe("Panel cutting, twice");
    expect(equalFor(ex.SheetJob.fields.qty)(job.qty, some(96.0))).toBe(true);
    expect(equalFor(ex.SheetJob.fields.start)(job.start, some(new Date("2026-10-12T00:00:00Z")))).toBe(true);
});
