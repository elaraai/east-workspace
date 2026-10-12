/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A record read whole (#1182, SB13–SB14): its entries are the rows, in key
 * order, a keyed inline source. A new row takes its key from `newRowId` and
 * sits where its key sorts, at the key's own type; nothing is placed by
 * position; a removal is a delete by key; and readiness holds a new row's
 * missing field against Save. Every root built by the e3-ui factory a
 * record's rows reach the sheet through, in the Sheet's payload, and
 * COMPILED; its `onApply` is a spy over the batch the record would be handed. The
 * Sheet is mounted in its frame (#1216).
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { DictType, East, IntegerType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { Sheet, SheetPayloadType, createSheetRootWith } from "@elaraai/e3-ui/internal";
import { system, UIStore, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { EastChakraSheet, type SheetValue } from "./frame/index.js";
import { boundFrame } from "./frame.test-utils.js";
import { sheetJournal } from "./journal.test-utils.js";

let restoreFrame: () => void = () => {};
beforeEach(() => { initializeStore(new UIStore()); restoreFrame = boundFrame(2000); });
afterEach(() => { cleanup(); restoreFrame(); });

const JobType = StructType({ task: StringType, qty: IntegerType });
const COLUMNS = {
    task: Sheet.column.text(JobType, { header: "Task" }),
    qty: Sheet.column.integer(JobType, { header: "Qty" }),
};

/** Fixtures at MODULE scope: East bodies never call host helpers. */
const BY_TEXT = new SortedMap([["J-0003", { task: "Edge banding", qty: 12n }], ["J-0001", { task: "Panel cutting", qty: 48n }]], compareFor(StringType));
const BY_NUMBER = new SortedMap([[10n, { task: "Spray finish", qty: 2n }], [9n, { task: "Assembly", qty: 1n }]], compareFor(IntegerType));

/** The record's `onApply`, as `Record.onApply(record, { keyed: true })` types it — the spy below stands in for it. */
const APPLY_TEXT = East.asyncFunction([Editing.Types.ChangeSet(JobType, StringType)], Editing.Types.ApplyResult,
    (_$, _batch) => East.value(variant("applied", { revision: none }), Editing.Types.ApplyResult));
const APPLY_NUMBER = East.asyncFunction([Editing.Types.ChangeSet(JobType, IntegerType)], Editing.Types.ApplyResult,
    (_$, _batch) => East.value(variant("applied", { revision: none }), Editing.Types.ApplyResult));

// Each Sheet holds its root alone: no pane, no record's history to read.
/** The jobs keyed by text, a new row's key `J-0002`. */
const textSheet = East.compile(East.function([], SheetPayloadType, ($) => {
    const jobs = $.const(BY_TEXT, DictType(StringType, JobType));
    const next = $.const(East.function([], StringType, (_$) => "J-0002"));
    const sheet = $.const(createSheetRootWith(jobs, COLUMNS, { newRowId: next, blanks: 2n }, { keyOrdered: true, applyKeyed: APPLY_TEXT }));
    return East.value({ sheet, templates: [], library: [], inspector: none, history: none, missing: none, name: none }, SheetPayloadType);
}), getRegisteredPlatformImplementations());
/** The jobs keyed by text, a new row's key minted by the renderer. */
const mintedSheet = East.compile(East.function([], SheetPayloadType, ($) => {
    const jobs = $.const(BY_TEXT, DictType(StringType, JobType));
    const sheet = $.const(createSheetRootWith(jobs, COLUMNS, { blanks: 2n }, { keyOrdered: true, applyKeyed: APPLY_TEXT }));
    return East.value({ sheet, templates: [], library: [], inspector: none, history: none, missing: none, name: none }, SheetPayloadType);
}), getRegisteredPlatformImplementations());
/** The jobs keyed by number, a new row's key `11`. */
const numberSheet = East.compile(East.function([], SheetPayloadType, ($) => {
    const jobs = $.const(BY_NUMBER, DictType(IntegerType, JobType));
    const next = $.const(East.function([], StringType, (_$) => "11"));
    const sheet = $.const(createSheetRootWith(jobs, COLUMNS, { newRowId: next, blanks: 2n }, { keyOrdered: true, applyKeyed: APPLY_NUMBER }));
    return East.value({ sheet, templates: [], library: [], inspector: none, history: none, missing: none, name: none }, SheetPayloadType);
}), getRegisteredPlatformImplementations());

const decodeBatch = decodeBeast2For(Editing.Types.ChangeSet(JobType, StringType));
type Batch = ValueTypeOf<ReturnType<typeof Editing.Types.ChangeSet<typeof JobType, typeof StringType>>>;

/** A sheet whose `onApply` records the batches it is handed. */
function withApplySpy(sheet: SheetValue) {
    const batches: Batch[] = [];
    const root = sheet.sheet;
    const value: SheetValue = { ...sheet, sheet: { ...root, editing: { ...root.editing, onApply: some(variant("async", async (bytes: Uint8Array) => {
        batches.push(decodeBatch(bytes));
        return variant("applied", { revision: none });
    })) } } };
    return { value, batches };
}

function mount(value: SheetValue) {
    const ui = render(<ChakraProvider value={system}><EastChakraSheet value={value} storageKey="sheet-keyed-inline" /></ChakraProvider>);
    const ids = () => [...ui.container.querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]')].map((row) => row.getAttribute("data-row-id"));
    const blankCell = (key: string) => ui.container.querySelector<HTMLElement>(`[data-slot="row"][data-blank] [data-key="${key}"]`)!;
    const cellOf = (id: string, key: string) => ui.container.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-key="${key}"]`)!;
    const card = () => ui.container.querySelector<HTMLElement>("[data-sheet-card]")!;
    const flush = () => act(async () => { await Promise.resolve(); });
    const paste = async (cell: HTMLElement, text: string) => {
        fireEvent.mouseDown(cell, { button: 0 });
        await act(async () => { fireEvent.paste(card(), { clipboardData: { getData: () => text } }); });
    };
    const press = async (name: string) => {
        const button = ui.getByRole("button", { name });
        await act(async () => { fireEvent.mouseDown(button, { button: 0 }); fireEvent.click(button); });
    };
    return { ...ui, ids, blankCell, cellOf, card, flush, paste, press };
}

test("the entries sit in key order, and a new row takes newRowId's key and sits where it sorts, by key", async () => {
    const journal = sheetJournal(textSheet());
    const ui = mount(journal.value);
    expect(ui.ids()).toEqual(["J-0001", "J-0003"]);
    await ui.paste(ui.blankCell("task"), "Sanding\t6");
    expect(ui.ids()).toEqual(["J-0001", "J-0002", "J-0003"]);
    expect(ui.cellOf("J-0002", "task").textContent).toBe("Sanding");
    expect(journal.events[0]!.draftChanges[0]!.place).toEqual(some(variant("keyOrder", null)));
});

test("without newRowId a new row's key is minted, and the row sits where that key sorts", async () => {
    const journal = sheetJournal(mintedSheet());
    const ui = mount(journal.value);
    await ui.paste(ui.blankCell("task"), "Sanding\t6");
    const ids = ui.ids();
    expect(ids).toHaveLength(3);
    const minted = ids.find((id) => id !== "J-0001" && id !== "J-0003")!;
    expect(minted.startsWith("sheet-")).toBe(true);
    // "sheet-…" sorts after "J-…": the new row is last because its key is.
    expect(ids).toEqual(["J-0001", "J-0003", minted]);
    expect(journal.events[0]!.draftChanges[0]!.id).toBe(minted);
});

test("a record keyed by number keeps 9 before 10, and a new 11 after them — the key's own order, not its text's", async () => {
    const ui = mount(withApplySpy(numberSheet()).value);
    expect(ui.ids()).toEqual(["9", "10"]);
    await ui.paste(ui.blankCell("task"), "Wrapping\t4");
    expect(ui.ids()).toEqual(["9", "10", "11"]);
});

test("nothing is placed by position: a seam offers Add row, and the new row sits by its key", async () => {
    const journal = sheetJournal(textSheet());
    const ui = mount(journal.value);
    fireEvent.mouseEnter(ui.container.querySelector('[data-row-id="J-0003"] [data-slot="insertPoint"]')!);
    const add = ui.container.querySelector<HTMLElement>('[data-slot="insertLayer"] [data-slot="insertRow"]')!;
    expect(add.getAttribute("aria-label")).toBe("Add row");
    fireEvent.click(add); await ui.flush();
    expect(ui.ids()).toEqual(["J-0001", "J-0002", "J-0003"]);
    expect(journal.events[0]!.draftChanges[0]!.place).toEqual(some(variant("keyOrder", null)));
});

test("a removal is a delete by key, handed over on Save in the session's keyed batch", async () => {
    const { value, batches } = withApplySpy(textSheet());
    const ui = mount(value);
    fireEvent.mouseDown(ui.cellOf("J-0003", "task"), { button: 0 });
    fireEvent.click(ui.container.querySelector('[data-row-id="J-0003"] [data-slot="checkbox"]')!); await ui.flush();
    fireEvent.keyDown(ui.card(), { key: "Backspace" }); await ui.flush();
    expect(ui.ids()).toEqual(["J-0001"]);
    await ui.press("Save");
    expect(batches).toHaveLength(1);
    const change = batches[0]!.changes[0]!;
    expect(batches[0]!.changes.map((c) => c.id)).toEqual(["J-0003"]);
    if (change.patch.type !== "replace") throw new Error(`expected the row replaced by nothing, got ${change.patch.type}`);
    expect(change.patch.value.after).toEqual(none);
    expect(batches[0]!.base.type).toBe("snapshot");
});

test("readiness: a new row missing a required field holds Save back until it is filled", async () => {
    const ui = mount(withApplySpy(textSheet()).value);
    await ui.paste(ui.blankCell("task"), "Sanding");
    expect((ui.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(ui.getByRole("button", { name: "1 issue" })).toBeTruthy();
    await ui.paste(ui.cellOf("J-0002", "qty"), "6");
    expect((ui.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
});
