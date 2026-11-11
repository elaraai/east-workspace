/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Record's conflicts example (`recordConflicts`) on e3 itself (#1599):
 * each of its buttons saves what it says of someone else — every forklift
 * level a step down, A. Morgan removed, a member added under the next key —
 * and the crew's Record meets each as the example's page says.
 *
 * - A level stepped here, then their removal of that member: a conflict of
 *   the whole row, the member standing as drafted and ringed, the card naming
 *   them and reading the level stepped against Removed; kept, the next Save
 *   puts the member back as drafted.
 * - A member deleted here, then their save: the same conflict the other way
 *   about, the card naming the member though the grid draws them no more;
 *   taken as theirs, the member is back as they left them and the status line
 *   says nothing more of the deletion.
 * - A member deleted here and by them: nothing to choose, nothing to save.
 * - A member added here — not yet inducted, not trained, their name typed —
 *   under the key their addition takes: theirs heard, the one added here goes
 *   on under the next key, the status line saying so, and Save keeps both.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/record/record";
import { conflictCards } from "../e3-web-mount.test-utils.js";
import { settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record": ex }, frame: 2000 });

/** The Record's rows, in order. */
const rows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-record] [data-slot="row"]')];
/** The members the grid draws, by their keys. */
const ids = (c: HTMLElement) => rows(c).map((row) => row.getAttribute("data-row-id"));
/** A member's row, by their key. */
const rowOf = (c: HTMLElement, id: string) => rows(c).find((row) => row.getAttribute("data-row-id") === id)!;
/** A row's cell under a column. */
const cellOf = (row: HTMLElement, key: string) => row.querySelector<HTMLElement>(`[data-slot="cell"][data-key="${key}"]`)!;
/** The grid: what takes the keys. */
const grid = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-record] [role="grid"]')!;
const toolbar = (c: HTMLElement) => slot(c, "toolbar")!;
/** The status line's words. */
const status = (c: HTMLElement) => toolbar(c).querySelector('[data-slot="status"]')?.textContent;
/** A button of the history bar, by its name. */
const history = (c: HTMLElement, name: string) => within(toolbar(c)).getByRole<HTMLButtonElement>("button", { name });
/** The Record's own Add or Delete. */
const action = (c: HTMLElement, part: "add" | "delete") => toolbar(c).querySelector<HTMLButtonElement>(`[data-record-action="${part}"]`)!;
/** One of the example's buttons, each saving what it says of someone else. */
const someoneElse = (c: HTMLElement, name: string) => within(c).getByRole("button", { name });
/** The crew as e3 holds them now. */
const crew = () => h.read(ex.recordConflictCrew);

/** A press on an element, the primary button, and what it leads to settled. */
async function press(el: Element): Promise<void> {
    fireEvent.mouseDown(el, { button: 0 });
    fireEvent.click(el);
    await settle();
}

/** A member deleted here, as a person does it: their row ticked, then Delete. */
async function remove(c: HTMLElement, id: string): Promise<void> {
    await press(rowOf(c, id).querySelector<HTMLElement>('[role="checkbox"]')!);
    await press(action(c, "delete"));
}

/** Presses Save and waits until nothing is left to save. */
async function save(c: HTMLElement): Promise<void> {
    await press(history(c, editingMessages.apply()));
    await waitFor(() => expect(history(c, editingMessages.discard()).disabled).toBe(true), { timeout: 5_000 });
    await settle();
}

test("recordConflicts: a level stepped here, then Someone else removes A. Morgan, is a conflict of the whole row — the member standing as drafted, ringed, the card naming them and reading the level stepped against Removed; kept, Save puts them back as drafted", async () => {
    const { container: c } = await h.mount(ex.recordConflicts, { storageKey: "record-conflicts-removed-there" });
    // Competent steps round to Not trained.
    await press(cellOf(rowOf(c, "C-001"), "forklift"));
    const stepped = cellOf(rowOf(c, "C-001"), "forklift").textContent;
    await press(someoneElse(c, "Someone else removes A. Morgan"));
    await waitFor(() => expect(c.querySelector("[data-conflicts]")).not.toBeNull());
    expect((await crew()).has("C-001")).toBe(false);
    expect([ids(c), rowOf(c, "C-001").hasAttribute("data-conflict"), cellOf(rowOf(c, "C-001"), "forklift").textContent]).toEqual([["C-001", "C-002", "C-003"], true, stepped]);
    const [card, ...more] = await conflictCards(c);
    expect(more).toEqual([]);
    expect([card!.item, card!.yours, card!.theirs]).toEqual(["A. Morgan", "Yours, Forklift: 0", "Theirs, Removed, Changed since you started editing · was Forklift: 2"]);
    await press(card!.radio("draft"));
    await save(c);
    expect((await crew()).get("C-001")).toEqual({ name: "A. Morgan", inducted: true, forklift: "0" });
    expect(ids(c)).toEqual(["C-001", "C-002", "C-003"]);
});

test("recordConflicts: A. Morgan deleted here, then Someone else saves, is the same conflict the other way about — the card naming them though the grid draws them no more; taken as theirs, they are back a level down and the status line says nothing more of the deletion", async () => {
    const { container: c } = await h.mount(ex.recordConflicts, { storageKey: "record-conflicts-removed-here" });
    await remove(c, "C-001");
    expect([ids(c), status(c)]).toEqual([["C-002", "C-003"], "Deleted 1 crew member · Apply writes it, Undo restores"]);
    await press(someoneElse(c, "Someone else saves"));
    await waitFor(() => expect(c.querySelector("[data-conflicts]")).not.toBeNull());
    expect(ids(c)).toEqual(["C-002", "C-003"]);
    const [card, ...more] = await conflictCards(c);
    expect(more).toEqual([]);
    expect([card!.item, card!.yours, card!.theirs]).toEqual(["A. Morgan", "Yours, Removed", "Theirs, Forklift: 1, Changed since you started editing · was Forklift: 2"]);
    await press(card!.radio("source"));
    await waitFor(() => expect(ids(c)).toEqual(["C-001", "C-002", "C-003"]));
    expect([status(c), history(c, editingMessages.discard()).disabled]).toEqual(["", true]);
    expect((await crew()).get("C-001")).toEqual({ name: "A. Morgan", inducted: true, forklift: "1" });
});

test("recordConflicts: A. Morgan deleted here and by Someone else is nothing to choose and nothing to save", async () => {
    const { container: c } = await h.mount(ex.recordConflicts, { storageKey: "record-conflicts-removed-both" });
    await remove(c, "C-001");
    await press(someoneElse(c, "Someone else removes A. Morgan"));
    await waitFor(() => expect(history(c, editingMessages.discard()).disabled, "nothing is left to save").toBe(true), { timeout: 5_000 });
    expect([c.querySelector("[data-conflicts]"), ids(c)]).toEqual([null, ["C-002", "C-003"]]);
    expect((await crew()).has("C-001")).toBe(false);
});

test("recordConflicts: a member added here takes the key Someone else adds a member under; theirs heard, the one added here goes on under the next key, the status line saying so — nothing to choose, and Save keeps both", async () => {
    const { container: c } = await h.mount(ex.recordConflicts, { storageKey: "record-conflicts-added-both" });
    await press(action(c, "add"));
    // Keyed as the crew's own are: the first C-00N none of them holds.
    expect(ids(c)).toEqual(["C-001", "C-002", "C-003", "C-004"]);
    // They join not yet inducted and not trained: named, nothing of them is left to fill in — the ring on the name, its
    // editor opened by the first key.
    await press(cellOf(rowOf(c, "C-004"), "name"));
    fireEvent.keyDown(grid(c), { key: "E" });
    await settle();
    const input = await waitFor(() => {
        const open = cellOf(rowOf(c, "C-004"), "name").querySelector<HTMLInputElement>('[data-slot="editorInput"]');
        expect(open).not.toBeNull();
        return open!;
    });
    fireEvent.input(input, { target: { value: "E. Novak" } });
    await settle();
    fireEvent.keyDown(input, { key: "Tab" });
    await settle();
    await press(someoneElse(c, "Someone else adds a member"));
    await waitFor(() => expect(status(c)).toBe("C-004 was taken by another save — the new crew member is C-005"));
    expect([c.querySelector("[data-conflicts]"), ids(c)]).toEqual([null, ["C-001", "C-002", "C-003", "C-004", "C-005"]]);
    await save(c);
    const held = await crew();
    expect([held.get("C-004"), held.get("C-005")]).toEqual([{ name: "D. Reyes", inducted: false, forklift: "0" }, { name: "E. Novak", inducted: false, forklift: "0" }]);
});
