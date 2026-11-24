/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A set cell's members edited whole (east-workspace#1741), over the Record's
 * every-kind example deployed to e3 itself: in the open editor each chip's ×
 * takes its member out, and Backspace with nothing typed picks the last member
 * and a second takes it — never back into the editor as words to delete; on a
 * phone the bottom container edits the cell in the form's tags editor, its
 * members as tags and the register's others suggested, each tag added or taken
 * away written as the grid writes the cell, one step while it stays open.
 */

import { describe, expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/record/record";
import { settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
import { touchFrame } from "../sheet/frame.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record": ex }, frame: 2000 });

/** Row `r`'s Certificates cell, a set. */
const certificates = (container: HTMLElement, r: number) =>
    container.querySelectorAll<HTMLElement>('[data-record] [data-slot="row"]')[r]!.querySelector<HTMLElement>('[data-slot="cell"][data-key="certificates"]')!;
/** The members an element's chips name, in order — a cell's at rest, or its open editor's. */
const named = (el: Element, picked = false) =>
    [...el.querySelectorAll(`[data-slot="chip"]${picked ? "[data-picked]" : ""} [data-slot="chipText"]`)].map((chip) => chip.textContent);
/** The editor open in a cell, if one is. */
const editorIn = (cell: HTMLElement) => cell.querySelector<HTMLElement>('[data-slot="editor"]');

/** The pointer pressed and let go on an element, and what it leads to settled. */
async function pressOn(el: Element) {
    fireEvent.mouseDown(el, { button: 0 });
    fireEvent.click(el);
    await settle();
}

/** A cell's editor opened, as ⏎ on its ring opens it, and its input once it is in. */
async function openEditor(container: HTMLElement, cell: () => HTMLElement): Promise<() => HTMLInputElement> {
    await pressOn(cell());
    fireEvent.keyDown(container.querySelector('[data-record] [role="grid"]')!, { key: "Enter" });
    await settle();
    const input = () => cell().querySelector<HTMLInputElement>('[data-slot="editorInput"]')!;
    await waitFor(() => expect(cell().querySelector('[data-slot="editorInput"]')).not.toBeNull());
    return input;
}

/** The history's Undo. */
const undoOf = (container: HTMLElement) => within(slot(container, "toolbar")!).getByRole("button", { name: editingMessages.undo() });

describe("a set cell's members, edited whole (east-workspace#1741)", () => {
    test("in the open editor each chip's × takes its member out, the editor staying open on the rest; ⏎ writes what is left, and Undo puts it back", async () => {
        const { container } = await h.mount(ex.recordEveryKind, { storageKey: "set-cell-remove" });
        const cell = () => certificates(container, 0);
        expect(named(cell())).toEqual(["Forklift", "Confined space"]);
        const input = await openEditor(container, cell);
        expect(named(editorIn(cell())!)).toEqual(["Forklift", "Confined space"]);
        await pressOn(within(editorIn(cell())!).getByRole("button", { name: "Remove Forklift" }));
        expect(named(editorIn(cell())!)).toEqual(["Confined space"]);
        expect(document.activeElement).toBe(input());
        fireEvent.keyDown(input(), { key: "Enter" });
        await settle();
        expect(editorIn(cell())).toBeNull();
        expect(named(cell())).toEqual(["Confined space"]);
        await pressOn(undoOf(container));
        expect(named(cell())).toEqual(["Forklift", "Confined space"]);
    });

    test("Backspace with nothing typed picks the last member, and a second takes it out whole — never into the editor as words to delete", async () => {
        const { container } = await h.mount(ex.recordEveryKind, { storageKey: "set-cell-backspace" });
        const cell = () => certificates(container, 0);
        const input = await openEditor(container, cell);
        fireEvent.keyDown(input(), { key: "Backspace" });
        await settle();
        expect(named(editorIn(cell())!, true)).toEqual(["Confined space"]);
        expect(named(editorIn(cell())!)).toEqual(["Forklift", "Confined space"]);
        expect(input().value).toBe("");
        fireEvent.keyDown(input(), { key: "Backspace" });
        await settle();
        expect(named(editorIn(cell())!)).toEqual(["Forklift"]);
        expect(input().value).toBe("");
        fireEvent.keyDown(input(), { key: "Enter" });
        await settle();
        expect(named(cell())).toEqual(["Forklift"]);
    });

    test("a member typed then `,` is a chip, and the space typed after the comma is the separator's: nothing is left to type over, so one Backspace picks the member just added", async () => {
        const { container } = await h.mount(ex.recordEveryKind, { storageKey: "set-cell-separator" });
        const user = userEvent.setup();
        const cell = () => certificates(container, 0);
        const input = await openEditor(container, cell);
        await user.type(input(), "First aid, ", { skipClick: true });
        await settle();
        expect(named(editorIn(cell())!)).toEqual(["Forklift", "Confined space", "First aid"]);
        expect(input().value).toBe("");
        fireEvent.keyDown(input(), { key: "Backspace" });
        await settle();
        expect(named(editorIn(cell())!, true)).toEqual(["First aid"]);
    });

    test("on a phone the bottom container edits it in the form's tags editor: its members as tags, the register's others suggested; a tag added or taken away is written as the grid writes the cell, and both are one step (SH10, SH10.1)", async () => {
        const restore = touchFrame(390);
        try {
            const { container } = await h.mount(ex.recordEveryKind, { storageKey: "set-cell-phone" });
            const user = userEvent.setup();
            const cell = () => certificates(container, 0);
            await pressOn(cell());
            const editor = () => container.querySelector<HTMLElement>('[data-record] [data-sheet-cell-editor="certificates"] [data-cell-tags]');
            await waitFor(() => expect(editor()).not.toBeNull());
            const tags = () => [...editor()!.querySelectorAll("[data-scope=tags-input][data-part=item-text]")].map((tag) => tag.textContent);
            const suggested = () => [...editor()!.querySelectorAll("datalist option")].map((option) => option.getAttribute("value"));
            expect(tags()).toEqual(["Forklift", "Confined space"]);
            expect(suggested()).toEqual(["First aid", "Working at height"]);
            // Typed as in the cell: `first` is First aid, the candidate it starts.
            const input = editor()!.querySelector<HTMLInputElement>("[data-scope=tags-input][data-part=input]")!;
            await user.click(input);
            await user.type(input, "first{Enter}");
            await settle();
            await waitFor(() => expect(named(cell())).toEqual(["Forklift", "Confined space", "First aid"]));
            expect(tags()).toEqual(["Forklift", "Confined space", "First aid"]);
            expect(suggested()).toEqual(["Working at height"]);
            const forklift = [...editor()!.querySelectorAll("[data-scope=tags-input][data-part=item]")]
                .find((item) => item.querySelector("[data-part=item-text]")?.textContent === "Forklift")!;
            await act(async () => { fireEvent.click(forklift.querySelector("[data-part=item-delete-trigger]")!); });
            await settle();
            await waitFor(() => expect(named(cell())).toEqual(["Confined space", "First aid"]));
            expect(tags()).toEqual(["Confined space", "First aid"]);
            await pressOn(undoOf(container));
            expect(named(cell())).toEqual(["Forklift", "Confined space"]);
        } finally {
            restore();
        }
    });

    test("on a phone an empty set's tags editor holds no tag and suggests every member", async () => {
        const restore = touchFrame(390);
        try {
            const { container } = await h.mount(ex.recordEveryKind, { storageKey: "set-cell-phone-empty" });
            await pressOn(certificates(container, 1));
            const editor = () => container.querySelector<HTMLElement>('[data-record] [data-sheet-cell-editor="certificates"] [data-cell-tags]');
            await waitFor(() => expect(editor()).not.toBeNull());
            expect(editor()!.querySelectorAll("[data-scope=tags-input][data-part=item]")).toHaveLength(0);
            expect([...editor()!.querySelectorAll("datalist option")].map((option) => option.getAttribute("value")))
                .toEqual(["Forklift", "Confined space", "First aid", "Working at height"]);
        } finally {
            restore();
        }
    });
});
