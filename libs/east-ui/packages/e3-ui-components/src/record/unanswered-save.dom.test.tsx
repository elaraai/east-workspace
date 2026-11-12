/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Save whose answer never comes, on e3 itself (#1599). A record remembers
 * its last sixteen keyed requests: a Save that landed, its answer lost, is
 * answered when asked again — with its own commit and the state the record
 * holds now — whatever was written since, and never applied twice. So Retry
 * after another session's write is the record's own word that the Save landed:
 *
 * - A member added here, saved, the answer lost; another session's write;
 *   Retry. They are in the crew once, and nothing is asked.
 * - A level stepped here, saved, the answer lost, and stepped back by Undo;
 *   another session's write; Retry. The Undo is a change still to save, and
 *   the next Save puts the level back.
 * - A level stepped here, saved, the answer lost; another session's write to
 *   the same level; Retry. Nothing is asked: the level is the other session's,
 *   the Save having landed first, and nothing is left to save. Before a record
 *   remembered more than its last request, the Retry was refused, and the
 *   person asked to choose over a change they no longer had.
 *
 * (What the Save wrote put back exactly by another session, before Retry, is
 * `remote-edits.dom.test.tsx`'s, over the crew read a window at a time.)
 *
 * A request sixteen others have followed is forgotten: asked again it is
 * checked afresh, and refused, since the rows no longer hold what its changes
 * began from. The editing session never takes that refusal at its word
 * (east-ui-components' `EditSession.unconfirmed`): each row is judged by what
 * e3 holds of it. Taken at its word, the refusal read a member e3 held as
 * another write's under the session's key — the member was given the next key
 * and saved twice — and read an Undo as no change at all.
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
/** What a member's forklift cell says. */
const level = (c: HTMLElement, id: string) => cellOf(rowOf(c, id), "forklift").textContent;
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
    await waitFor(() => expect(within(toolbar(c)).queryByRole("button", { name: editingMessages.retryRequest() })).not.toBeNull(), { timeout: 15_000 });
    losing();
    await settle();
}

/** Another session's write: the crew as it leaves them, from the crew as e3 holds them now. */
async function theirs(change: (members: Awaited<ReturnType<typeof crew>>) => void, key?: string): Promise<void> {
    const members = await crew();
    change(members);
    await h.patch(ex.recordConflictCrew, members, key);
}

/**
 * Sixteen Saves of other sessions, each under a key of its own, each a change of C. Patel's induction — which they
 * leave as it was: as many keyed requests as a record remembers, so the one before them is forgotten.
 */
async function sixteenOthersSave(): Promise<void> {
    for (let i = 0; i < 16; i++) {
        await theirs((members) => {
            const patel = members.get("C-003")!;
            members.set("C-003", { ...patel, inducted: !patel.inducted });
        }, `another-session-${i}`);
    }
}

/** Retry pressed, and the Record at rest with nothing left to save: no request to ask again, no read back to ask again, nothing to choose. */
async function retriedToRest(c: HTMLElement): Promise<void> {
    await press(history(c, editingMessages.retryRequest()));
    // Save at rest: off, with no Save out and none still read back — Discard is off through both, so it alone says nothing.
    await waitFor(() => expect([history(c, editingMessages.discard()).disabled, history(c, editingMessages.apply()).getAttribute("aria-busy")], "nothing is left to save, and no Save is out").toEqual([true, null]), { timeout: 10_000 });
    await settle();
    expect([
        within(toolbar(c)).queryByRole("button", { name: editingMessages.retryRequest() }),
        within(toolbar(c)).queryByRole("button", { name: editingMessages.retryRefresh() }),
        history(c, editingMessages.apply()).getAttribute("aria-busy"),
        c.querySelector("[data-conflicts]"),
    ]).toEqual([null, null, null, null]);
}

test("recordConflicts: a member added here is saved and no answer comes; Someone else removes A. Morgan; Retry — e3 answers the request it remembers, and the member is in the crew once, under the key they were added under, with nothing asked and nothing left to save", async () => {
    const { container: c } = await h.mount(ex.recordConflicts, { storageKey: "record-unanswered-added" });
    await press(add(c));
    await name(c, "C-004", "E. Novak");
    await saveWithNoAnswer(c);
    // It landed: e3 holds the member, and the Record does not know.
    expect((await crew()).get("C-004")).toEqual({ name: "E. Novak", inducted: false, forklift: "0" });
    await press(someoneElse(c, "Someone else removes A. Morgan"));
    const commits = (await h.history(ex.recordConflictCrew)).commits.length;
    await retriedToRest(c);
    expect(ids(c)).toEqual(["C-002", "C-003", "C-004"]);
    const held = await crew();
    expect([[...held.keys()], held.get("C-004")]).toEqual([["C-002", "C-003", "C-004"], { name: "E. Novak", inducted: false, forklift: "0" }]);
    // Answered, never applied again: the Retry committed nothing.
    expect((await h.history(ex.recordConflictCrew)).commits.length).toBe(commits);
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
    await press(history(c, editingMessages.retryRequest()));
    // Answered: the level is there as the lost Save left it, so the Undo is a change from that.
    await waitFor(() => expect(history(c, editingMessages.apply()).disabled, "the Undo is there to save").toBe(false), { timeout: 10_000 });
    await settle();
    expect([c.querySelector("[data-conflicts]"), (await crew()).get("C-002")!.forklift]).toEqual([null, landed]);
    await press(history(c, editingMessages.apply()));
    await waitFor(() => expect(history(c, editingMessages.discard()).disabled, "nothing is left to save").toBe(true), { timeout: 10_000 });
    expect((await crew()).get("C-002")!.forklift).toBe(began);
});

test("recordConflicts: a level stepped here is saved and no answer comes; another session sets the same level; Retry — nothing is asked, the level is the other session's, and nothing is left to save", async () => {
    const { container: c } = await h.mount(ex.recordConflicts, { storageKey: "record-unanswered-overwritten" });
    // What a Competent member's cell says: A. Morgan's.
    const competent = level(c, "C-001");
    await press(cellOf(rowOf(c, "C-002"), "forklift"));
    await saveWithNoAnswer(c);
    const landed = (await crew()).get("C-002")!.forklift;
    expect(landed).not.toBe("2");
    // Another session, having read the level the lost Save left, sets it to Competent.
    await theirs((members) => { members.set("C-002", { ...members.get("C-002")!, forklift: "2" }); });
    await retriedToRest(c);
    expect([level(c, "C-002"), (await crew()).get("C-002")!.forklift]).toEqual([competent, "2"]);
});

test("recordConflicts: a member added here is saved and no answer comes; sixteen other Saves follow, and e3 has forgotten the request; Retry — refused, and judged by what e3 holds: the member is in the crew once, under the key they were added under, with nothing asked and nothing left to save", async () => {
    const { container: c } = await h.mount(ex.recordConflicts, { storageKey: "record-unanswered-forgotten-added" });
    await press(add(c));
    await name(c, "C-004", "E. Novak");
    await saveWithNoAnswer(c);
    expect((await crew()).get("C-004")).toEqual({ name: "E. Novak", inducted: false, forklift: "0" });
    await sixteenOthersSave();
    await retriedToRest(c);
    expect(ids(c)).toEqual(["C-001", "C-002", "C-003", "C-004"]);
    const held = await crew();
    expect([[...held.keys()], held.get("C-004")]).toEqual([["C-001", "C-002", "C-003", "C-004"], { name: "E. Novak", inducted: false, forklift: "0" }]);
}, 120_000);

test("recordConflicts: a level stepped here is saved and no answer comes, then stepped back by Undo; sixteen other Saves follow, and e3 has forgotten the request; Retry — refused, and judged by what e3 holds: the Undo is a change still to save, nothing is asked, and Save puts the level back", async () => {
    const { container: c } = await h.mount(ex.recordConflicts, { storageKey: "record-unanswered-forgotten-undone" });
    const began = (await crew()).get("C-002")!.forklift;
    await press(cellOf(rowOf(c, "C-002"), "forklift"));
    await saveWithNoAnswer(c);
    const landed = (await crew()).get("C-002")!.forklift;
    expect(landed).not.toBe(began);
    await press(history(c, "Undo"));
    await sixteenOthersSave();
    await press(history(c, editingMessages.retryRequest()));
    // Refused, and judged by what e3 holds: the level is there as the lost Save left it, so the Undo is a change from that.
    await waitFor(() => expect(history(c, editingMessages.apply()).disabled, "the Undo is there to save").toBe(false), { timeout: 10_000 });
    await settle();
    expect([c.querySelector("[data-conflicts]"), (await crew()).get("C-002")!.forklift]).toEqual([null, landed]);
    await press(history(c, editingMessages.apply()));
    await waitFor(() => expect(history(c, editingMessages.discard()).disabled, "nothing is left to save").toBe(true), { timeout: 10_000 });
    expect((await crew()).get("C-002")!.forklift).toBe(began);
}, 120_000);
