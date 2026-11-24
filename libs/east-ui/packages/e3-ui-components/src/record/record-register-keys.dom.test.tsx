/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Registers keyed by number (east-workspace#1747), over the machines on their
 * lines on e3 itself (`recordMachinesByLine`), each test a workspace of its
 * own: a machine's line, its operator and its shift each show their member's
 * name and keep the member's number. The line's dropdown offers the lines'
 * names in the register's order; a pick, a pasted name and a pasted number each
 * write the line's number, and Save's patch carries the Integer, which the
 * Record mounted again reads back. A copied cell pastes back to the same line.
 * A person picked by name writes their badge number, cleared none; a click
 * steps the shift to the next one's number. A number no line has — the
 * sander's line 4 — shows as East prints it.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { ArrayType, IntegerType, equalFor, none, printFor, some } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/record/record-register-keys";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record-register-keys": ex }, frame: 2000 });
const machineEqual = equalFor(ex.Machine);
const printMachine = printFor(ex.Machine);
const Numbers = ArrayType(IntegerType);

/** A machine's cell, by its key and the column's. */
const cell = (c: HTMLElement, id: string, key: string) =>
    c.querySelector<HTMLElement>(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`)!;
/** What a machine's row shows: its line's words, its operator's and its shift's. */
const shown = (c: HTMLElement, id: string) => [
    cell(c, id, "line").textContent,
    cell(c, id, "operator").querySelector('[data-slot="personLabel"]')?.textContent,
    cell(c, id, "shift").querySelector('[data-slot="chip"]')?.textContent,
];
/** The grid: what takes the keys, the copies and the pastes. */
const grid = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-record] [role="grid"]')!;
/** Whether a machine's row holds a draft. */
const drafted = (c: HTMLElement, id: string) => c.querySelector(`[data-record] [data-slot="row"][data-row-id="${id}"]`)!.hasAttribute("data-draft");
/** A button of the history bar, by its name. */
const history = (c: HTMLElement, name: string) => within(slot(c, "toolbar")!).getByRole<HTMLButtonElement>("button", { name });
/** The strip's chips: the choices a cell being edited offers, in order. */
const offered = (c: HTMLElement) => [...c.querySelectorAll('[data-record] [data-slot="strip"] [data-slot="stripChip"]')].map((chip) => chip.textContent);

/** The ring on a machine's cell. */
async function ring(c: HTMLElement, id: string, key: string) {
    fireEvent.mouseDown(cell(c, id, key), { button: 0 });
    await settle();
}

/** Text pasted into a machine's cell, the ring on it first. */
async function paste(c: HTMLElement, id: string, key: string, text: string) {
    await ring(c, id, key);
    await act(async () => { fireEvent.paste(grid(c), { clipboardData: { getData: () => text } }); });
    await settle();
}

/** What a copy of a machine's cell puts on the clipboard, the ring on it first. */
async function copy(c: HTMLElement, id: string, key: string): Promise<string | undefined> {
    await ring(c, id, key);
    const set = new Map<string, string>();
    fireEvent.copy(grid(c), { clipboardData: { setData: (k: string, v: string) => set.set(k, v), getData: () => "" } });
    await settle();
    return set.get("text/plain");
}

/** The editor opened on a machine's cell by typing `first`, its buffer then set to `text`. */
async function typeInto(c: HTMLElement, id: string, key: string, first: string, text: string): Promise<HTMLInputElement> {
    await ring(c, id, key);
    fireEvent.keyDown(grid(c), { key: first });
    await settle();
    const input = await waitFor(() => {
        const open = cell(c, id, key).querySelector<HTMLInputElement>('[data-slot="editorInput"]');
        expect(open).not.toBeNull();
        return open!;
    });
    fireEvent.input(input, { target: { value: text } });
    await settle();
    return input;
}

/** Save, and the record as e3 then holds it. */
async function save(c: HTMLElement, id: string) {
    fireEvent.click(history(c, editingMessages.apply()));
    await waitFor(async () => expect(drafted(c, id)).toBe(false));
    return h.read(ex.recordMachines);
}

describe("registers keyed by number (#1747)", () => {
    test("each cell shows its member's name and keeps its number; no one on an Option is its column's words; a number no line has shows as East prints it", async () => {
        const { container } = await h.mount(ex.recordMachinesByLine, { storageKey: "register-keys-shown" });
        expect([shown(container, "M-10"), shown(container, "M-11"), shown(container, "M-20"), shown(container, "M-30")]).toEqual([
            ["Assembly", "A. Morgan", "Early"],
            ["Assembly", "No one", "Late"],
            ["Packing", "B. Ellis", "Early"],
            ["4", "C. Patel", "Night"],
        ]);
        // A member's key is what a cell holds and copies: the line's number, as East prints it.
        expect([await copy(container, "M-20", "line"), await copy(container, "M-30", "line")]).toEqual(["2", "4"]);
    });

    test("the line's dropdown offers the lines' names in the register's order; a pick writes the line's number, Save's patch carries the Integer, and the Record mounted again reads it back", async () => {
        const first = await h.mount(ex.recordMachinesByLine, { storageKey: "register-keys-pick" });
        const input = await typeInto(first.container, "M-11", "line", "P", "");
        expect(offered(first.container)).toEqual(["Assembly", "Packing", "Finishing"]);
        fireEvent.input(input, { target: { value: "Fin" } });
        await settle();
        fireEvent.keyDown(input, { key: "Enter" });
        await settle();
        expect([shown(first.container, "M-11")[0], drafted(first.container, "M-11")]).toEqual(["Finishing", true]);
        const saved = (await save(first.container, "M-11")).get("M-11")!;
        expect(machineEqual(saved, { name: "Press B", line: 3n, operator: none, shift: 2n }), printMachine(saved)).toBe(true);
        first.unmount();
        const { container } = await h.mount(ex.recordMachinesByLine, { storageKey: "register-keys-pick" });
        expect(shown(container, "M-11")[0]).toBe("Finishing");
    });

    test("a pasted name and a pasted number each pick their line, and a copied cell pastes back to the same line", async () => {
        const { container } = await h.mount(ex.recordMachinesByLine, { storageKey: "register-keys-paste" });
        await paste(container, "M-10", "line", "Finishing");
        await paste(container, "M-11", "line", "2");
        const copied = await copy(container, "M-10", "line");
        expect(copied).toBe("3");
        await paste(container, "M-20", "line", copied!);
        expect([shown(container, "M-10")[0], shown(container, "M-11")[0], shown(container, "M-20")[0]]).toEqual(["Finishing", "Packing", "Finishing"]);
        const saved = await save(container, "M-20");
        const lines = ["M-10", "M-11", "M-20"].map((id) => saved.get(id)!.line);
        expect(equalFor(Numbers)(lines, [3n, 2n, 3n]), printFor(Numbers)(lines)).toBe(true);
    });

    test("a person picked by name writes their badge number, and cleared, none; a click steps the shift to the next one's number", async () => {
        const { container } = await h.mount(ex.recordMachinesByLine, { storageKey: "register-keys-person" });
        await paste(container, "M-11", "operator", "C. Patel");
        await ring(container, "M-10", "operator");
        await act(async () => { fireEvent.keyDown(grid(container), { key: "Backspace" }); });
        await settle();
        fireEvent.mouseDown(cell(container, "M-20", "shift"), { button: 0 });
        fireEvent.click(cell(container, "M-20", "shift"));
        await settle();
        expect([shown(container, "M-10"), shown(container, "M-11"), shown(container, "M-20")]).toEqual([
            ["Assembly", "No one", "Early"],
            ["Assembly", "C. Patel", "Late"],
            ["Packing", "B. Ellis", "Late"],
        ]);
        const saved = await save(container, "M-20");
        for (const [id, machine] of [
            ["M-10", { name: "Press A", line: 1n, operator: none, shift: 1n }],
            ["M-11", { name: "Press B", line: 1n, operator: some(121n), shift: 2n }],
            ["M-20", { name: "Wrapper", line: 2n, operator: some(117n), shift: 2n }],
        ] as const) {
            const held = saved.get(id)!;
            expect(machineEqual(held, machine), `${id}: ${printMachine(held)}`).toBe(true);
        }
    });
});
