/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { ArrayType, DictType, East, IntegerType, StringType, StructType, variant } from "@elaraai/east";
import { Paged, Sheet, State, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { initializeStore, StateImpl } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { EastChakraSheet } from "./index.js";
import { sheetJournal } from "./journal.test-utils.js";
import type { SheetRootValue } from "./values.js";

beforeEach(() => initializeStore(new UIStore()));
afterEach(cleanup);
const Row = StructType({ id: StringType, task: StringType, qty: IntegerType, hidden: StringType });
function program(insertRows = true, removeRows = true) {
    return East.function([], UIComponentType, ($) => {
        const data = $.const(State.bind([ArrayType(Row)], "insertion-rows", [
            { id: "a", task: "First", qty: 1n, hidden: "keep a" },
            { id: "b", task: "Second", qty: 2n, hidden: "keep b" },
        ]));
        return Sheet.Root(data, { task: Sheet.column.text(Row), qty: Sheet.column.integer(Row) }, {
            id: "id", onUpdate: data.write, blanks: 2n, edits: { insertRows, removeRows },
            newRow: East.function([Sheet.Types.NewRow], Sheet.Types.Patch(Row), () => Sheet.patch(Row, { qty: 3n, hidden: "constructor" })),
        });
    }).toIR().compile(StateImpl);
}
function unwrap(value: ReturnType<ReturnType<typeof program>>): SheetRootValue {
    if (value.type !== "Sheet") throw new Error("Expected Sheet"); return value.value;
}
function mount(root: SheetRootValue) {
    const component = (value: SheetRootValue) => <ChakraProvider value={system}><EastChakraSheet value={value} storageKey="insertion" /></ChakraProvider>;
    const ui = render(component(root));
    const rows = () => [...ui.container.querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]')];
    const input = () => ui.container.querySelector<HTMLInputElement>('[data-slot="editorInput"]')!;
    const flush = () => act(async () => { await Promise.resolve(); });
    const press = async (element: Element) => { fireEvent.click(element); await flush(); };
    const finish = async (text: string) => { fireEvent.input(input(), { target: { value: text } }); fireEvent.keyDown(input(), { key: "Enter" }); await flush(); };
    /** Hover the seam above a row: its row chip shows in the sheet's one insertion layer. */
    const insertAbove = (row: Element) => {
        fireEvent.mouseEnter(row.querySelector('[data-slot="insertPoint"]')!);
        return ui.container.querySelector('[data-slot="insertLayer"] [data-slot="insertRow"]')!;
    };
    return { ...ui, rows, input, flush, press, finish, insertAbove, refresh: (value: SheetRootValue) => ui.rerender(component(value)) };
}

test("insertion before the first row emits one draft gesture, applies in order and preserves constructor and hidden fields", async () => {
    const view = program();
    const ui = mount(unwrap(view()));
    await ui.press(ui.insertAbove(ui.rows()[0]!));
    expect(ui.rows()).toHaveLength(3);
    expect(ui.rows()[0]!.hasAttribute("data-draft")).toBe(true);
    expect(ui.input().closest('[data-row-id]')).toBe(ui.rows()[0]);
    expect(ui.rows()[0]!.querySelector('[data-key="qty"]')!.textContent).toBe("3");
    await ui.finish("Inserted");
    await ui.press(ui.getByRole("button", { name: "Apply changes" }));
    const saved = unwrap(view());
    if (saved.rows.type !== "inline" || saved.editing.snapshot.type !== "some") throw new Error("Expected inline");
    expect(saved.rows.value.map(row => row.cells.get("task"))).toEqual([variant("String", "Inserted"), variant("String", "First"), variant("String", "Second")]);
    ui.refresh(saved);
    expect((ui.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(ui.queryByRole("status")).toBeNull();
});

test("repeated insertion resolves against local identities and Undo restores each exact step", async () => {
    const journal = sheetJournal(unwrap(program()()));
    const ui = mount(journal.value);
    await ui.press(ui.insertAbove(ui.rows()[1]!));
    const first = ui.rows()[1]!.getAttribute("data-row-id")!;
    expect(journal.events).toHaveLength(1);
    expect(journal.events[0]!.origin.type).toBe("insert");
    expect(journal.events[0]!.draftChanges[0]!.place).toEqual(variant("some", variant("ordered", variant("before", "b"))));
    fireEvent.keyDown(ui.input(), { key: "Escape" }); await ui.flush();
    await ui.press(ui.insertAbove(ui.rows()[1]!));
    const second = ui.rows()[1]!.getAttribute("data-row-id")!;
    expect(journal.events).toHaveLength(2);
    expect(journal.events[1]!.draftChanges[0]!.place).toEqual(variant("some", variant("ordered", variant("before", first))));
    expect(ui.rows().map(row => row.getAttribute("data-row-id"))).toEqual(["a", second, first, "b"]);
    fireEvent.keyDown(ui.input(), { key: "Escape" }); await ui.flush();
    await ui.press(ui.getByRole("button", { name: "Undo" }));
    expect(ui.rows().map(row => row.getAttribute("data-row-id"))).toEqual(["a", first, "b"]);
    await ui.press(ui.getByRole("button", { name: "Undo" }));
    expect(ui.rows().map(row => row.getAttribute("data-row-id"))).toEqual(["a", "b"]);
    await ui.press(ui.getByRole("button", { name: "Redo" }));
    expect(journal.draft(first, Sheet.Types.Draft(Row)).hidden).toEqual(variant("value", "constructor"));
});

test("Alt+Insert and the selection strip share the ordinary insertion path", async () => {
    const ui = mount(unwrap(program()()));
    fireEvent.mouseDown(ui.rows()[0]!.querySelector('[data-key="task"]')!, { button: 0 });
    fireEvent.keyDown(ui.container.querySelector('[data-sheet-card]')!, { key: "Insert", altKey: true }); await ui.flush();
    expect(ui.input().closest('[data-row-id]')).toBe(ui.rows()[1]);
    fireEvent.keyDown(ui.input(), { key: "Escape" }); await ui.flush();
    await ui.press(ui.rows()[0]!.querySelector('[data-slot="checkbox"]')!);
    await ui.press(ui.getByRole("button", { name: "Insert above" }));
    expect(ui.input().closest('[data-row-id]')).toBe(ui.rows()[0]);
});

test("insertion disabled hides controls and blocks keyboard and paste extension while existing cells still edit", async () => {
    const journal = sheetJournal(unwrap(program(false, false)()));
    const ui = mount(journal.value);
    expect(ui.container.querySelector('[data-slot="insertPoint"]')).toBeNull();
    fireEvent.mouseDown(ui.rows()[1]!.querySelector('[data-key="task"]')!, { button: 0 });
    const card = ui.container.querySelector('[data-sheet-card]')!;
    fireEvent.keyDown(card, { key: "Insert", altKey: true }); await ui.flush();
    expect(journal.events).toHaveLength(0);
    fireEvent.paste(card, { clipboardData: { getData: () => "Changed\nCannot create" } }); await ui.flush();
    expect(ui.rows()).toHaveLength(2);
    expect(journal.events).toHaveLength(1);
    expect(journal.draft("b", Sheet.Types.Draft(Row)).task).toEqual(variant("value", "Changed"));
    await ui.press(ui.rows()[0]!.querySelector('[data-slot="checkbox"]')!);
    expect(ui.queryByRole("group", { name: "Row insertion" })).toBeNull();
    fireEvent.keyDown(card, { key: "Backspace" }); await ui.flush();
    expect(ui.rows()).toHaveLength(2);
    expect(journal.events).toHaveLength(1);
});

test("inserting while another editor is open commits that edit first without losing the insertion anchor", async () => {
    const journal = sheetJournal(unwrap(program()()));
    const ui = mount(journal.value);
    fireEvent.doubleClick(ui.rows()[0]!.querySelector('[data-key="task"]')!); await ui.flush();
    fireEvent.input(ui.input(), { target: { value: "Revised" } });
    await ui.press(ui.insertAbove(ui.rows()[1]!));
    expect(journal.events.map(event => event.origin.type)).toEqual(["typed", "insert"]);
    expect(journal.draft("a", Sheet.Types.Draft(Row)).task).toEqual(variant("value", "Revised"));
    expect(ui.rows()[2]!.getAttribute("data-row-id")).toBe("b");
    expect(ui.input().closest('[data-row-id]')).toBe(ui.rows()[1]);
});


test("a keyed source offers Add row, uses canonical key order and emits no ordered placement", async () => {
    const view = East.function([], UIComponentType, ($) => {
        const data = $.const(new Map([
            ["a", { id: "a", task: "First", qty: 1n, hidden: "keep a" }],
            ["z", { id: "z", task: "Last", qty: 2n, hidden: "keep z" }],
        ]), DictType(StringType, Row));
        return Sheet.Root(Paged.of("keyed-insertion", data), { task: Sheet.column.text(Row) }, {
            newRowId: East.function([], StringType, () => "0-new"),
        });
    }).toIR().compile(StateImpl);
    const journal = sheetJournal(unwrap(view()));
    const ui = mount(journal.value);
    await waitFor(() => expect(ui.rows()).toHaveLength(2));
    const add = ui.insertAbove(ui.rows()[1]!);
    expect(add.getAttribute("aria-label")).toBe("Add row");
    fireEvent.mouseEnter(add); await ui.flush();
    expect(ui.container.querySelector('[data-insert-preview]')).toBeNull();
    await ui.press(add);
    expect(ui.rows().map(row => row.getAttribute("data-row-id"))).toEqual(["0-new", "a", "z"]);
    expect(journal.events[0]!.draftChanges[0]!.place).toEqual(variant("some", variant("keyOrder", null)));
});
