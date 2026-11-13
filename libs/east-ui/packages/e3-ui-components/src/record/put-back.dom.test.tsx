/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Save over a record read whole, whose every part another session puts
 * back exactly as it was before the page reads the record again, on e3
 * itself (#1599): the check every builder runs
 * (`shared/remote-rows.test-utils.ts`' `putBackAfterSave`), over the crew.
 *
 * The record then holds the bytes it held before the Save, under the hash it
 * had: nothing it holds tells a read made after the Save from one made
 * before. The Record's runtime knows when it read (`record-runtime.ts`'
 * `settledOf`): the Save is read back at what the page holds of the record
 * once a poll started since the Save was answered has found it the record's.
 * Left to what the crew's rows show, the Save waited for good — Save and
 * Discard off, until the page was reloaded.
 *
 * - A forklift level stepped here and saved, stepped back by another session.
 * - An induction ticked here and saved, unticked by another session.
 * - A member added here and saved, removed again by another session: they
 *   are gone, and never added again.
 * - A member removed here and saved, added back by another session exactly as
 *   they were: they stand on the grid, and are never removed again.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/record/record";
import { putBackAfterSave } from "../shared/remote-rows.test-utils.js";
import { settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record": ex }, frame: 2000 });

/** The Record's rows, in order. */
const rows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-record] [data-slot="row"]')];
/** A member's row, by their key; `undefined` where the grid draws none. */
const rowOf = (c: HTMLElement, id: string) => rows(c).find((row) => row.getAttribute("data-row-id") === id);
/** A row's cell under a column. */
const cellOf = (row: HTMLElement, key: string) => row.querySelector<HTMLElement>(`[data-slot="cell"][data-key="${key}"]`)!;
/** What the grid draws of each member: their key, and what each of their cells says. */
const look = (c: HTMLElement) => rows(c).map((row) => [row.getAttribute("data-row-id"), ...["name", "inducted", "forklift"].map((key) => cellOf(row, key).textContent)]);
/** The grid: what takes the keys. */
const grid = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-record] [role="grid"]')!;
const toolbar = (c: HTMLElement) => slot(c, "toolbar")!;
/** The crew as e3 holds them now. */
const crew = () => h.read(ex.recordConflictCrew);

/** A press on an element, the primary button, and what it leads to settled. */
async function press(el: Element): Promise<void> {
    fireEvent.mouseDown(el, { button: 0 });
    fireEvent.click(el);
    await settle();
}

/** A member's name typed, as a person types it: the ring on the name, its editor opened by the first key, Tab to commit. */
async function name(c: HTMLElement, id: string, text: string): Promise<void> {
    await press(cellOf(rowOf(c, id)!, "name"));
    fireEvent.keyDown(grid(c), { key: text[0]! });
    await settle();
    const input = await waitFor(() => {
        const open = cellOf(rowOf(c, id)!, "name").querySelector<HTMLInputElement>('[data-slot="editorInput"]');
        expect(open).not.toBeNull();
        return open!;
    });
    fireEvent.input(input, { target: { value: text } });
    await settle();
    fireEvent.keyDown(input, { key: "Tab" });
    await settle();
}

/** What the shared check takes of the Record: the crew as the grid draws them and as e3 holds them, and a Save followed by a write that puts the crew back. */
async function crewCheck(c: HTMLElement) {
    // The crew as they stand before the change: what the other session's write leaves them as.
    const before = await crew();
    return {
        container: c,
        look: () => look(c),
        held: async () => [...(await crew())],
        savedThenPutBack: (save: () => void) => h.followed(ex.recordConflictCrew, save, () => before),
    };
}

test("recordConflicts: a level stepped here and saved, stepped back by another session before the page reads the crew again, is read back with the level as it was — the Save never left saving, nothing asked, nothing left to save", async () => {
    const { container: c } = await h.mount(ex.recordConflicts, { storageKey: "record-put-back-level" });
    await putBackAfterSave({ ...await crewCheck(c), change: () => press(cellOf(rowOf(c, "C-002")!, "forklift")) });
});

test("recordConflicts: an induction ticked here and saved, unticked by another session before the page reads the crew again, is read back unticked — the Save never left saving, nothing asked, nothing left to save", async () => {
    const { container: c } = await h.mount(ex.recordConflicts, { storageKey: "record-put-back-ticked" });
    await putBackAfterSave({ ...await crewCheck(c), change: () => press(cellOf(rowOf(c, "C-002")!, "inducted")) });
});

test("recordConflicts: a member added here and saved, removed again by another session before the page reads the crew again, is gone as e3 holds the crew — the Save never left saving, and the member never added again", async () => {
    const { container: c } = await h.mount(ex.recordConflicts, { storageKey: "record-put-back-added" });
    const commits = (await h.history(ex.recordConflictCrew)).commits.length;
    await putBackAfterSave({
        ...await crewCheck(c),
        change: [() => press(toolbar(c).querySelector<HTMLButtonElement>('[data-record-action="add"]')!), () => name(c, "C-004", "E. Novak")],
    });
    // The Save, and the other session's removal: nothing more.
    expect((await h.history(ex.recordConflictCrew)).commits.length).toBe(commits + 2);
});

test("recordConflicts: a member removed here and saved, added back by another session exactly as they were before the page reads the crew again, stands on the grid as e3 holds them — the Save never left saving, and the member never removed again", async () => {
    const { container: c } = await h.mount(ex.recordConflicts, { storageKey: "record-put-back-removed" });
    const commits = (await h.history(ex.recordConflictCrew)).commits.length;
    await putBackAfterSave({
        ...await crewCheck(c),
        // Their row ticked, then Delete.
        change: [() => press(rowOf(c, "C-003")!.querySelector<HTMLElement>('[role="checkbox"]')!), () => press(toolbar(c).querySelector<HTMLButtonElement>('[data-record-action="delete"]')!)],
    });
    expect((await h.history(ex.recordConflictCrew)).commits.length).toBe(commits + 2);
});
