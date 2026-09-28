/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { ArrayType, East, IntegerType, StringType, StructType, decodeBeast2For, some, variant } from "@elaraai/east";
import { Sheet, SheetReadyBatchType, State, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { StateImpl, initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { EastChakraSheet } from "./index.js";
import { sheetJournal } from "./journal.test-utils.js";
import type { SheetRootValue } from "./values.js";

const Row = StructType({ id: StringType, qty: IntegerType, hidden: StringType });
const program = East.function([], UIComponentType, ($) => {
    const data = $.const(State.bind([ArrayType(Row)], "sheet-history-dom", [{ id: "a", qty: 1n, hidden: "preserve" }]));
    return Sheet.Root(data, { qty: Sheet.column.integer(Row, { header: "Quantity" }) }, { id: "id", onUpdate: data.write });
}).toIR().compile(StateImpl);
const view = (): SheetRootValue => {
    const value = program();
    if (value.type !== "Sheet") throw new Error("Expected Sheet");
    return value.value;
};
const quantity = () => {
    const root = view();
    if (root.rows.type !== "inline") throw new Error("Expected inline rows");
    return root.rows.value[0]!.cells.get("qty")!.value;
};
function mount(root = view()) {
    const component = (value: SheetRootValue) => <ChakraProvider value={system}><EastChakraSheet value={value} storageKey="history-dom" /></ChakraProvider>;
    const utils = render(component(root));
    const cell = () => utils.container.querySelector('[data-slot="row"] [data-key="qty"]')!;
    const input = () => utils.container.querySelector('[data-slot="editorInput"]')!;
    const flush = () => act(async () => { await Promise.resolve(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    const edit = async (text: string) => {
        fireEvent.doubleClick(cell());
        await flush();
        fireEvent.input(input(), { target: { value: text } });
        await flush();
    };
    const press = async (name: string) => {
        const button = utils.getByRole("button", { name });
        await act(async () => {
            fireEvent.mouseDown(button, { button: 0 });
            fireEvent.click(button);
        });
    };
    return { ...utils, cell, input, edit, press, refresh: () => utils.rerender(component(view())) };
}

beforeEach(() => initializeStore(new UIStore()));
afterEach(cleanup);

test("Apply commits the open editor before writing the checked batch; applied Undo stages its inverse", async () => {
    const ui = mount();
    await ui.edit("9");
    expect(quantity()).toBe(1n);
    expect((ui.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(false);
    await ui.press("Apply changes");
    expect(quantity()).toBe(9n);
    ui.refresh();
    expect((ui.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(ui.queryByRole("status")).toBeNull();
    await ui.press("Undo");
    expect(ui.cell().textContent).toBe("1");
    expect(quantity()).toBe(9n);
    await ui.press("Apply changes");
    expect(quantity()).toBe(1n);
    ui.refresh();
    expect((ui.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(ui.queryByRole("status")).toBeNull();
});

test("Undo first commits an open editor, then undoes that gesture; Redo restores it without writing", async () => {
    const ui = mount();
    await ui.edit("7");
    await ui.press("Undo");
    expect(ui.input()).toBeNull();
    expect(ui.cell().textContent).toBe("1");
    expect(quantity()).toBe(1n);
    await ui.press("Redo");
    expect(ui.cell().textContent).toBe("7");
    expect(quantity()).toBe(1n);
});

test("an acknowledgement lost after persistence freezes mutations and retries the identical request", async () => {
    const root = view();
    if (root.editing.onApply.type !== "some") throw new Error("Expected writer");
    const apply = root.editing.onApply.value.value;
    const requests: Uint8Array[] = [];
    const ui = mount({ ...root, editing: { ...root.editing, onApply: some(variant("async", async bytes => {
        requests.push(bytes.slice());
        const result = await apply(bytes);
        if (requests.length === 1) throw new Error("Acknowledgement lost");
        return result;
    })) } });
    await ui.edit("8");
    await ui.press("Apply changes");
    expect(quantity()).toBe(8n);
    expect(ui.getByRole("alert").textContent).toBe("Acknowledgement lost");
    expect((ui.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
    expect((ui.getByRole("button", { name: "Discard" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.doubleClick(ui.cell());
    expect(ui.input()).toBeNull();
    await ui.press("Retry request");
    expect(ui.queryByRole("alert")?.textContent).toBeUndefined();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    ui.refresh();
    expect((ui.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(ui.queryByRole("status")).toBeNull();
});

test("a missing required field blocks Apply and the issue button focuses its cell", async () => {
    const ui = mount();
    await ui.edit("");
    await ui.press("Apply changes");
    expect(quantity()).toBe(1n);
    expect((ui.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
    await ui.press("1 issue");
    expect(ui.cell().hasAttribute("data-selected")).toBe(true);
    expect(ui.container.querySelector('[data-slot="footerMessage"]')!.textContent).toMatch(/qty/);
    expect(document.activeElement).toBe(ui.container.querySelector("[data-sheet-card]"));
});


test("invalid pasted integers stay visible, block the whole batch, and undo as one gesture", async () => {
    const ui = mount();
    fireEvent.mouseDown(ui.cell(), { button: 0 });
    await act(async () => {
        fireEvent.paste(ui.container.querySelector("[data-sheet-card]")!, {
            clipboardData: { getData: () => "1.5" },
        });
    });
    expect(ui.cell().getAttribute("aria-invalid")).toBe("true");
    expect(ui.cell().querySelector('[data-slot="cellText"]')!.textContent).toBe("1.5");
    expect(quantity()).toBe(1n);
    expect((ui.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.getElementById(ui.cell().getAttribute("aria-describedby")!)!.textContent).toContain("1.5");
    await ui.press("Undo");
    expect(ui.cell().textContent).toBe("1");
    expect(ui.cell().hasAttribute("aria-invalid")).toBe(false);
    expect(quantity()).toBe(1n);
    await ui.press("Redo");
    expect(ui.cell().getAttribute("aria-invalid")).toBe("true");
    expect(quantity()).toBe(1n);
});


test("discarding a never-applied row emits one patch, preserves missing fields through Undo, and never writes the source", async () => {
    const journal = sheetJournal(view());
    const ui = mount(journal.value);
    const blank = ui.container.querySelector('[data-slot="row"][data-blank] [data-key="qty"]')!;
    fireEvent.mouseDown(blank, { button: 0 });
    await act(async () => { fireEvent.paste(ui.container.querySelector("[data-sheet-card]")!, { clipboardData: { getData: () => "9" } }); });
    const draftRow = () => ui.container.querySelector('[data-slot="row"][data-draft]');
    expect(draftRow()?.hasAttribute("data-incomplete")).toBe(true);
    expect(ui.container.querySelector('[data-row-id="a"] [data-slot="discardDraft"]')).toBeNull();
    expect(journal.events).toHaveLength(1);
    const id = draftRow()!.getAttribute("data-row-id")!;
    const draft = journal.drafts.get(id);
    await ui.press("Discard new row");
    expect(draftRow()).toBeNull();
    expect(journal.events).toHaveLength(2);
    expect(journal.events[1]!.origin.type).toBe("discard");
    expect(journal.drafts.has(id)).toBe(false);
    expect(quantity()).toBe(1n);
    await ui.press("Undo");
    expect(draftRow()?.hasAttribute("data-incomplete")).toBe(true);
    expect(journal.drafts.get(id)).toEqual(draft);
    expect((ui.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
    await ui.press("Redo");
    expect(draftRow()).toBeNull();
    expect(quantity()).toBe(1n);
});

test("discarding a new row first commits another row's open editor as a separate undoable gesture", async () => {
    const journal = sheetJournal(view());
    const ui = mount(journal.value);
    fireEvent.mouseDown(ui.container.querySelector('[data-slot="row"][data-blank] [data-key="qty"]')!, { button: 0 });
    await act(async () => { fireEvent.paste(ui.container.querySelector("[data-sheet-card]")!, { clipboardData: { getData: () => "9" } }); });
    await ui.edit("7");
    await ui.press("Discard new row");
    expect(ui.input()).toBeNull();
    expect(ui.cell().textContent).toBe("7");
    expect(journal.events).toHaveLength(3);
    expect(journal.events[2]!.origin.type).toBe("discard");
    expect(ui.queryByRole("button", { name: "Discard new row" })).toBeNull();
    expect(quantity()).toBe(1n);
    await ui.press("Undo");
    expect(ui.getByRole("button", { name: "Discard new row" })).toBeTruthy();
    expect(ui.cell().textContent).toBe("7");
    await ui.press("Undo");
    expect(ui.cell().textContent).toBe("1");
    expect(ui.getByRole("button", { name: "Discard new row" })).toBeTruthy();
});


test("an author rule marks the affected row, blocks Apply, focuses its issue and clears on Undo", async () => {
    const root = view();
    const batchOf = decodeBeast2For(SheetReadyBatchType);
    const ui = mount({ ...root, editing: { ...root.editing, readyRow: some(blob => {
        const batch = batchOf(blob);
        return batch.checks.map((check) => {
            const qty = batch.rows[Number(check.index)]!.cells.get("qty");
            return qty?.type === "Integer" && qty.value <= 0n
                ? variant("incomplete", [{ field: "qty", message: "Quantity needs approval" }]) : variant("ready", null);
        });
    }) } });
    await ui.edit("0");
    await ui.press("Apply changes");
    expect(quantity()).toBe(1n);
    expect((ui.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(ui.cell().closest('[data-slot="row"]')!.hasAttribute("data-incomplete")).toBe(true);
    expect(ui.cell().getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(ui.cell().getAttribute("aria-describedby")!)!.textContent).toContain("Quantity needs approval");
    await ui.press("1 issue");
    expect(ui.cell().hasAttribute("data-selected")).toBe(true);
    await ui.press("Undo");
    expect(ui.cell().hasAttribute("aria-invalid")).toBe(false);
    expect(quantity()).toBe(1n);
});
