/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Save whose answer never comes, on e3 itself (#1599). e3 answers a request
 * again only while it is the record's last write: its ref names the key of
 * its last mutation alone. So a Save that landed, its answer lost, is answered
 * as it was when asked again at once — and refused once another session has
 * written, since the rows no longer hold what its changes began from. The
 * editing session never takes that refusal at its word
 * (east-ui-components' `EditSession.unconfirmed`): each row is judged by what
 * e3 holds of it.
 *
 * - A member added here, saved, the answer lost; another session's write;
 *   Retry. Taken at its word, the refusal read the member e3 held as another
 *   write's under the session's key: the member was given the next key and
 *   saved twice. They are in the crew once, and nothing is asked.
 * - A level stepped here, saved, the answer lost, and stepped back by Undo;
 *   another session's write; Retry. Taken at its word, the Undo read as no
 *   change at all and the level stayed as the lost Save left it. It is a
 *   change still to save, and the next Save puts the level back.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/record/record";
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
/** A button of the history bar, by its name. */
const history = (c: HTMLElement, name: string) => within(toolbar(c)).getByRole<HTMLButtonElement>("button", { name });
/** The Record's own Add. */
const add = (c: HTMLElement) => toolbar(c).querySelector<HTMLButtonElement>('[data-record-action="add"]')!;
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

/** A member's name typed, as a person types it: the ring on the name, its editor opened by the first key, Tab to commit. */
async function name(c: HTMLElement, id: string, text: string): Promise<void> {
    await press(cellOf(rowOf(c, id), "name"));
    fireEvent.keyDown(grid(c), { key: text[0]! });
    await settle();
    const input = await waitFor(() => {
        const open = cellOf(rowOf(c, id), "name").querySelector<HTMLInputElement>('[data-slot="editorInput"]');
        expect(open).not.toBeNull();
        return open!;
    });
    fireEvent.input(input, { target: { value: text } });
    await settle();
    fireEvent.keyDown(input, { key: "Tab" });
    await settle();
}

/**
 * Save, with e3's every answer to it lost on its way back: the write commits, the client asks again under the same id
 * until it gives up, and the session is left with a write of unknown outcome — Save turned into Retry.
 */
async function saveWithNoAnswer(c: HTMLElement): Promise<void> {
    const losing = h.e3.fail((request) => request.kind === "mutate" && request.record === ex.recordConflictCrew.name, "lost");
    fireEvent.mouseDown(history(c, editingMessages.apply()), { button: 0 });
    fireEvent.click(history(c, editingMessages.apply()));
    await waitFor(() => expect(within(toolbar(c)).queryByRole("button", { name: "Retry request" })).not.toBeNull(), { timeout: 15_000 });
    losing();
    await settle();
}

test("recordConflicts: a member added here is saved and no answer comes; Someone else removes A. Morgan; Retry — e3 refuses the request it has forgotten, and the member is in the crew once, under the key they were added under, with nothing asked and nothing left to save", async () => {
    const { container: c } = await h.mount(ex.recordConflicts, { storageKey: "record-unanswered-added" });
    await press(add(c));
    await name(c, "C-004", "E. Novak");
    await saveWithNoAnswer(c);
    // It landed: e3 holds the member, and the Record does not know.
    expect((await crew()).get("C-004")).toEqual({ name: "E. Novak", inducted: false, forklift: "0" });
    // The record's last write is another session's now: e3 answers the first request as its own no more.
    await press(someoneElse(c, "Someone else removes A. Morgan"));
    await press(history(c, "Retry request"));
    await waitFor(() => expect(history(c, editingMessages.discard()).disabled, "nothing is left to save").toBe(true), { timeout: 10_000 });
    await settle();
    expect([c.querySelector("[data-conflicts]"), ids(c)]).toEqual([null, ["C-002", "C-003", "C-004"]]);
    const held = await crew();
    expect([[...held.keys()], held.get("C-004")]).toEqual([["C-002", "C-003", "C-004"], { name: "E. Novak", inducted: false, forklift: "0" }]);
});

test("recordConflicts: a level stepped here is saved and no answer comes, then stepped back by Undo; Someone else removes A. Morgan; Retry — the Undo is a change still to save, nothing is asked, and Save puts the level back", async () => {
    const { container: c } = await h.mount(ex.recordConflicts, { storageKey: "record-unanswered-undone" });
    const began = (await crew()).get("C-002")!.forklift;
    await press(cellOf(rowOf(c, "C-002"), "forklift"));
    await saveWithNoAnswer(c);
    const landed = (await crew()).get("C-002")!.forklift;
    expect(landed).not.toBe(began);
    await press(history(c, "Undo"));
    await press(someoneElse(c, "Someone else removes A. Morgan"));
    await press(history(c, "Retry request"));
    // Refused, and judged by what e3 holds: the level is there as the lost Save left it, so the Undo is a change from that.
    await waitFor(() => expect(history(c, editingMessages.apply()).disabled, "the Undo is there to save").toBe(false), { timeout: 10_000 });
    await settle();
    expect([c.querySelector("[data-conflicts]"), (await crew()).get("C-002")!.forklift]).toEqual([null, landed]);
    await press(history(c, editingMessages.apply()));
    await waitFor(() => expect(history(c, editingMessages.discard()).disabled, "nothing is left to save").toBe(true), { timeout: 10_000 });
    expect((await crew()).get("C-002")!.forklift).toBe(began);
});
