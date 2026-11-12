/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Record beside another session's writes, on e3 itself (#1599): the crew
 * read a window at a time, a member's forklift level typed here, and then
 * another session's write of the same record heard by the page.
 *
 * - Of another field of that member: both stand, nothing is asked, and Save
 *   writes this session's field alone — the record then holds the two.
 * - Of the same field: one conflict to choose, the draft's value standing and
 *   Save waiting on it. Yours is what the record then holds; Theirs leaves
 *   nothing to save.
 * - Of another member: the grid shows it, nothing is asked, and Save writes
 *   what was typed here alone.
 * - That member removed: a conflict to choose, the member standing on the
 *   grid as drafted, ringed whole, the card reading what was typed against
 *   Removed. Taken as theirs, the row is gone and nothing is left to save;
 *   kept, the next Save puts the member back as drafted.
 * - A member removed here whom another session changed: a conflict to choose,
 *   the removal standing meanwhile. Kept, the next Save removes them; taken
 *   as theirs, the row is back as the other session left it.
 * - A member both remove: nothing to choose and nothing to save, and the row
 *   is never drawn again.
 *
 * The removals run the checks every builder runs
 * (`shared/remote-rows.test-utils.ts`), the grid's own reads held and let go
 * one at a time.
 * - The status line's note of a removal goes once the removal's conflict is
 *   chosen: taken as theirs, nothing it said is so any more.
 * - A member another session adds, and one it removes, that no draft touches:
 *   the grid shows it, nothing is asked, and Save writes what was typed here
 *   alone.
 * - A level typed here and saved, or a member removed here and saved, that
 *   another session puts back exactly before the grid reads the crew again:
 *   the check every builder runs (`putBackAfterSave`) — the Save is read back
 *   with the row as e3 holds it, never left saving.
 * - A Save that landed with no answer, whose row another session then put
 *   back exactly as it was — the level typed back, the removed member added
 *   again — and Retry: e3 answers the request it remembers with the state it
 *   holds now, where the row reads as it did before the Save. The Save is
 *   acknowledged with the row as e3 holds it, never waited on for a read that
 *   would show it: none ever would.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { Data, Record } from "@elaraai/e3-ui/internal";
import * as fx from "@elaraai/e3-ui/fixtures/sheet/sheet-keys";
import type { E3Request } from "../e3-web.test-utils.js";
import { conflictCards } from "../e3-web-mount.test-utils.js";
import { heardBeforeAnswer, putBackAfterSave, removedHere, removedOnBothSides, removedThere } from "../shared/remote-rows.test-utils.js";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "sheet/sheet-keys.fixtures": fx }, frame: 2000 });
/** The crew's record, as a request names it. */
const CREW = `records.${fx.numberedCrew.name}`;

type Member = ValueTypeOf<typeof fx.NumberedMember>;

/** The crew a window at a time (`Data.bindPaged`): each member's name, whether they are inducted, and their forklift level. */
const windowedCrew = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const members = $.let(Record.bind(fx.numberedCrew));
    const page = $.let(Data.bindPaged(fx.numberedCrew));
    return Record({
        record: members,
        window: page,
        title: "Crew",
        noun: { singular: "crew member", plural: "crew members" },
        // The crew come from the roster: this Record edits them, and adds none.
        edits: { insertRows: false },
        columns: {
            name: Record.column.title(fx.NumberedMember, { header: "Name" }),
            inducted: Record.column.toggle(fx.NumberedMember, { header: "Inducted", on: "yes", off: "no" }),
            forklift: Record.column.text(fx.NumberedMember, { header: "Forklift" }),
        },
        name: "remoteCrew",
    });
})));

/** The Record's rows, in order. */
const rows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-record] [data-slot="row"]')];
/** A row's cell under a column. */
const cellOf = (row: HTMLElement, key: string) => row.querySelector<HTMLElement>(`[data-slot="cell"][data-key="${key}"]`);
/** What the Record draws of each member: their key, whether they are inducted, and their forklift level. */
const look = (c: HTMLElement) => rows(c).map((row) => [row.getAttribute("data-row-id"), cellOf(row, "inducted")?.textContent, cellOf(row, "forklift")?.textContent]);
/** The grid: what takes the keys and the pastes. */
const grid = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-record] [role="grid"]')!;
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar")!);
const saveButton = (c: HTMLElement) => toolbar(c).getByRole<HTMLButtonElement>("button", { name: editingMessages.apply() });
const discardButton = (c: HTMLElement) => toolbar(c).getByRole<HTMLButtonElement>("button", { name: editingMessages.discard() });
/** Whether a button of the history bar is off: disabled, or waiting with the focus kept. */
const off = (button: HTMLButtonElement) => button.disabled || button.getAttribute("aria-disabled") === "true";
/** The status line's words. */
const status = (c: HTMLElement) => slot(c, "toolbar")!.querySelector('[data-slot="status"]')?.textContent;

/** The crew mounted, as e3 holds them to begin with. */
async function mounted(storageKey: string): Promise<HTMLElement> {
    const { container: c } = await h.mount({ fn: windowedCrew }, { storageKey });
    await waitFor(() => expect(look(c)).toEqual([["2", "yes", "2"], ["9", "no", "0"], ["10", "yes", "1"]]));
    return c;
}

/** A forklift level typed over a member's, as a paste types it: a draft. */
async function type(c: HTMLElement, id: string, level: string): Promise<void> {
    const cell = cellOf(rows(c).find((row) => row.getAttribute("data-row-id") === id)!, "forklift")!;
    fireEvent.mouseDown(cell, { button: 0 });
    await act(async () => { fireEvent.paste(grid(c), { clipboardData: { getData: () => level } }); });
    await settle();
}

/** A row by its key; `undefined` where the grid draws none. */
const rowOf = (c: HTMLElement, id: string) => rows(c).find((row) => row.getAttribute("data-row-id") === id);
/** The members the grid draws, by their keys. */
const drawn = (c: HTMLElement) => rows(c).map((row) => row.getAttribute("data-row-id"));

/** A press on an element, the primary button, and what it leads to settled. */
async function press(el: Element): Promise<void> {
    fireEvent.mouseDown(el, { button: 0 });
    fireEvent.click(el);
    await settle();
}

/** A member removed here, as a person does it: their row ticked, then Delete. */
async function remove(c: HTMLElement, id: string): Promise<void> {
    await press(rowOf(c, id)!.querySelector<HTMLElement>('[role="checkbox"]')!);
    await press(slot(c, "toolbar")!.querySelector<HTMLButtonElement>('[data-record-action="delete"]')!);
}

/** Another session's write: the crew as it leaves them, from the crew as e3 holds them now. */
async function theirs(change: (crew: Map<bigint, Member>) => void): Promise<void> {
    const crew = new Map(await h.read(fx.numberedCrew));
    change(crew);
    await h.patch(fx.numberedCrew, crew);
    await settle();
}

/** Presses Save and waits until nothing is left to save. */
async function save(c: HTMLElement): Promise<void> {
    await act(async () => { fireEvent.click(saveButton(c)); });
    await settle();
    await waitFor(() => expect(discardButton(c).disabled).toBe(true), { timeout: 5_000 });
    await settle();
}

test("another session's change of another field of a member edited here stands beside the edit: nothing is asked, and Save writes the field typed here alone", async () => {
    const c = await mounted("record-remote-beside");
    await type(c, "2", "5");
    expect(look(c)[0]).toEqual(["2", "yes", "5"]);
    // Their induction lapses, by another session: no part of what was typed here.
    await theirs((crew) => { crew.set(2n, { ...crew.get(2n)!, inducted: false }); });
    await waitFor(() => expect(look(c)[0]).toEqual(["2", "no", "5"]));
    expect(c.querySelector("[data-conflicts]"), "nothing to choose").toBeNull();
    expect(off(saveButton(c))).toBe(false);
    await save(c);
    // The record holds the two: a Save of the whole row as it stood here would have put the induction back.
    expect((await h.read(fx.numberedCrew)).get(2n)).toEqual({ name: "A. Morgan", inducted: false, forklift: "5" });
    expect(look(c)[0]).toEqual(["2", "no", "5"]);
});

test("another session's change of the very field edited here is one conflict to choose: the draft's value stands, Save waits, and Yours is what the record then holds", async () => {
    const c = await mounted("record-remote-over-yours");
    await type(c, "2", "5");
    await theirs((crew) => { crew.set(2n, { ...crew.get(2n)!, forklift: "3" }); });
    await waitFor(() => expect(c.querySelector("[data-conflicts]")).not.toBeNull());
    // The draft's value stands on the grid until a person chooses, and Save waits on the choice.
    expect(look(c)[0]).toEqual(["2", "yes", "5"]);
    expect(off(saveButton(c))).toBe(true);
    const [card, ...more] = await conflictCards(c);
    expect(more).toEqual([]);
    expect([card!.yours, card!.theirs]).toEqual(["Yours, 5", "Theirs, 3, Changed since you started editing · was 2"]);
    await act(async () => { fireEvent.click(card!.radio("draft")); });
    await settle();
    expect(off(saveButton(c))).toBe(false);
    await save(c);
    expect((await h.read(fx.numberedCrew)).get(2n)).toEqual({ name: "A. Morgan", inducted: true, forklift: "5" });
    expect(look(c)[0]).toEqual(["2", "yes", "5"]);
});

test("taken as theirs, a conflict's field reads the other session's value and nothing is left to save", async () => {
    const c = await mounted("record-remote-over-theirs");
    await type(c, "2", "5");
    await theirs((crew) => { crew.set(2n, { ...crew.get(2n)!, forklift: "3" }); });
    await waitFor(() => expect(c.querySelector("[data-conflicts]")).not.toBeNull());
    const [card] = await conflictCards(c);
    await act(async () => { fireEvent.click(card!.radio("source")); });
    await settle();
    await waitFor(() => expect(look(c)[0]).toEqual(["2", "yes", "3"]));
    await waitFor(() => expect(discardButton(c).disabled, "nothing is left to save").toBe(true));
    expect((await h.read(fx.numberedCrew)).get(2n)).toEqual({ name: "A. Morgan", inducted: true, forklift: "3" });
});

test("a level in conflict typed back to what it was makes no choice, and writes nothing over the other session's: their level shows, nothing is left to save, and the conflict is settled as theirs", async () => {
    // Left as typed, the grid read no conflict — the level as both began — and Save was on: it wrote 2 over the other
    // session's 3, which the person here had never been asked about.
    const c = await mounted("record-remote-typed-back");
    await type(c, "2", "5");
    await theirs((crew) => { crew.set(2n, { ...crew.get(2n)!, forklift: "3" }); });
    await waitFor(() => expect(c.querySelector("[data-conflicts]")).not.toBeNull());
    expect([look(c)[0], off(saveButton(c))]).toEqual([["2", "yes", "5"], true]);
    await type(c, "2", "2");
    await waitFor(() => expect(look(c)[0]).toEqual(["2", "yes", "3"]));
    await waitFor(() => expect(discardButton(c).disabled, "nothing is left to save").toBe(true));
    expect(off(saveButton(c))).toBe(true);
    expect((await h.read(fx.numberedCrew)).get(2n)).toEqual({ name: "A. Morgan", inducted: true, forklift: "3" });
});

test("a member edited here whom another session removed, the edit typed back, is gone as they left the crew: no choice made, and nobody put back", async () => {
    // Left as typed, the member stood on the grid as they had been — a row of the session's own, which Save added
    // again: the other session's removal undone, with nothing asked.
    const c = await mounted("record-remote-typed-back-removed");
    await type(c, "2", "5");
    await theirs((crew) => { crew.delete(2n); });
    await waitFor(() => expect(c.querySelector("[data-conflicts]")).not.toBeNull());
    await type(c, "2", "2");
    await waitFor(() => expect(drawn(c)).toEqual(["9", "10"]));
    await waitFor(() => expect(discardButton(c).disabled, "nothing is left to save").toBe(true));
    expect((await h.read(fx.numberedCrew)).has(2n)).toBe(false);
});

test("another session's change of another member is drawn beside the edit made here: nothing is asked, and Save writes what was typed here alone", async () => {
    const c = await mounted("record-remote-elsewhere");
    await type(c, "2", "5");
    await theirs((crew) => { crew.set(10n, { ...crew.get(10n)!, forklift: "4" }); });
    await waitFor(() => expect(look(c)).toEqual([["2", "yes", "5"], ["9", "no", "0"], ["10", "yes", "4"]]));
    expect(c.querySelector("[data-conflicts]")).toBeNull();
    expect(off(saveButton(c))).toBe(false);
    await save(c);
    const crew = await h.read(fx.numberedCrew);
    expect([crew.get(2n)!.forklift, crew.get(10n)!.forklift]).toEqual(["5", "4"]);
});

test("a member edited here whom another session removes is a conflict to choose: taken as theirs, the row is gone and nothing is left to save", async () => {
    const c = await mounted("record-remote-removed");
    await type(c, "2", "5");
    await theirs((crew) => { crew.delete(2n); });
    await waitFor(() => expect(c.querySelector("[data-conflicts]")).not.toBeNull());
    expect(off(saveButton(c))).toBe(true);
    const [card, ...more] = await conflictCards(c);
    expect(more).toEqual([]);
    await act(async () => { fireEvent.click(card!.radio("source")); });
    await settle();
    await waitFor(() => expect(look(c).map(([id]) => id)).toEqual(["9", "10"]));
    await waitFor(() => expect(discardButton(c).disabled, "nothing is left to save").toBe(true));
    expect((await h.read(fx.numberedCrew)).has(2n)).toBe(false);
});


test("a member edited here whom another session removes stands on the grid as drafted until a person chooses, ringed whole, the card reading what was typed against Removed; kept, the next Save puts the member back as drafted", async () => {
    const c = await mounted("record-remote-removed-kept");
    await type(c, "2", "5");
    await theirs((crew) => { crew.delete(2n); });
    await waitFor(() => expect(c.querySelector("[data-conflicts]")).not.toBeNull());
    // The member stands as drafted, ringed whole; the others as e3 holds them.
    expect(look(c)).toEqual([["2", "yes", "5"], ["9", "no", "0"], ["10", "yes", "1"]]);
    expect(rowOf(c, "2")!.hasAttribute("data-conflict")).toBe(true);
    expect(off(saveButton(c))).toBe(true);
    const [card, ...more] = await conflictCards(c);
    expect(more).toEqual([]);
    expect([card!.yours, card!.theirs]).toEqual(["Yours, Forklift: 5", "Theirs, Removed, Changed since you started editing · was Forklift: 2"]);
    await act(async () => { fireEvent.click(card!.radio("draft")); });
    await settle();
    expect(off(saveButton(c))).toBe(false);
    await save(c);
    // Back in the record, every field as the grid showed it: the level typed here, the rest as they were.
    expect((await h.read(fx.numberedCrew)).get(2n)).toEqual({ name: "A. Morgan", inducted: true, forklift: "5" });
    expect(look(c)).toEqual([["2", "yes", "5"], ["9", "no", "0"], ["10", "yes", "1"]]);
});

/** What the shared checks of a row removed or added by another session take of the Record, over member 2. */
const member = (c: HTMLElement) => ({
    e3: h.e3, container: c,
    // The grid's own reads of the crew: its window's pages, never the reads a session makes by key.
    reads: (request: E3Request) => request.dataset === CREW && request.kind === "page",
    drawn: () => rowOf(c, "2") !== undefined,
    theirRemoval: () => theirs((crew) => { crew.delete(2n); }),
    held: async () => (await h.read(fx.numberedCrew)).has(2n),
    name: "A. Morgan",
});

test.each([["kept, the next Save puts them back as drafted", "draft"], ["let go, the row leaves and nothing is left to save", "source"]] as const)(
    "a member changed here whom another session removes stands as drafted while the grid's window is read again, a conflict to choose: %s", async (_ends, choice) => {
        const c = await mounted(`record-remote-removed-there-${choice}`);
        await removedThere({ ...member(c), change: () => type(c, "2", "5"), look: () => look(c).find(([id]) => id === "2") }, choice);
    });

test.each([["kept, the next Save removes them", "draft"], ["let go, the row is back as the other session left it", "source"]] as const)(
    "a member removed here whom another session changed stays off the grid while its window is read again, a conflict to choose: %s", async (_ends, choice) => {
        const c = await mounted(`record-remote-removed-here-${choice}`);
        await removedHere({
            ...member(c), remove: () => remove(c, "2"),
            theirChange: () => theirs((crew) => { crew.set(2n, { ...crew.get(2n)!, forklift: "3" }); }),
        }, choice);
        if (choice === "source") expect(look(c)[0]).toEqual(["2", "yes", "3"]);
    });

test("the status line's note of a removal stands while its conflict waits, and goes once it is chosen — taken as theirs, the member is back and nothing it said is so", async () => {
    const c = await mounted("record-remote-removed-note");
    await remove(c, "2");
    const note = "Deleted 1 crew member · Apply writes it, Undo restores";
    expect(status(c)).toBe(note);
    await theirs((crew) => { crew.set(2n, { ...crew.get(2n)!, forklift: "3" }); });
    await waitFor(() => expect(c.querySelector("[data-conflicts]")).not.toBeNull());
    // The removal stands until a person chooses: so does what the line says of it.
    expect(status(c)).toBe(note);
    const [card] = await conflictCards(c);
    await act(async () => { fireEvent.click(card!.radio("source")); });
    await settle();
    await waitFor(() => expect(look(c)[0]).toEqual(["2", "yes", "3"]));
    expect(status(c)).not.toContain("Deleted");
    expect(discardButton(c).disabled, "nothing is left to save").toBe(true);
});

test("a member removed here and by another session is nothing to choose and nothing to save, and the grid never draws them again — nor while its window, standing from before the other session's write, is read again", async () => {
    const c = await mounted("record-remote-removed-both");
    await removedOnBothSides({ ...member(c), remove: () => remove(c, "2") });
    expect(drawn(c)).toEqual(["9", "10"]);
});

test("a member another session adds while another is edited here is drawn in key order: nothing is asked, and Save writes what was typed here alone", async () => {
    const c = await mounted("record-remote-added");
    await type(c, "2", "5");
    await theirs((crew) => { crew.set(11n, { name: "D. Reyes", inducted: false, forklift: "0" }); });
    await waitFor(() => expect(look(c)).toEqual([["2", "yes", "5"], ["9", "no", "0"], ["10", "yes", "1"], ["11", "no", "0"]]));
    expect(c.querySelector("[data-conflicts]")).toBeNull();
    expect(off(saveButton(c))).toBe(false);
    await save(c);
    const crew = await h.read(fx.numberedCrew);
    expect([crew.get(2n)!.forklift, crew.get(11n)]).toEqual(["5", { name: "D. Reyes", inducted: false, forklift: "0" }]);
});

test("a member another session removes while another is edited here leaves the grid: nothing is asked, and Save writes what was typed here alone", async () => {
    const c = await mounted("record-remote-removed-elsewhere");
    await type(c, "2", "5");
    await theirs((crew) => { crew.delete(9n); });
    await waitFor(() => expect(look(c)).toEqual([["2", "yes", "5"], ["10", "yes", "1"]]));
    expect(c.querySelector("[data-conflicts]")).toBeNull();
    expect(off(saveButton(c))).toBe(false);
    await save(c);
    const crew = await h.read(fx.numberedCrew);
    expect([crew.get(2n)!.forklift, crew.has(9n)]).toEqual(["5", false]);
});

/**
 * Save, with e3's every answer to it lost on its way back: the write commits, the client asks again under the same id
 * until it gives up, and the session is left with a write of unknown outcome — Save turned into Retry.
 */
async function saveWithNoAnswer(c: HTMLElement): Promise<void> {
    const losing = h.e3.fail((request) => request.kind === "mutate" && request.record === fx.numberedCrew.name, "lost");
    await act(async () => { fireEvent.click(saveButton(c)); });
    await waitFor(() => expect(toolbar(c).queryByRole("button", { name: editingMessages.retryRequest() })).not.toBeNull(), { timeout: 15_000 });
    losing();
    await settle();
}

/** Retry pressed, and the Record at rest: nothing left to save, no Save out and none still read back, nothing to ask again or to choose. */
async function retriedToRest(c: HTMLElement): Promise<void> {
    await press(toolbar(c).getByRole("button", { name: editingMessages.retryRequest() }));
    await waitFor(() => expect([discardButton(c).disabled, saveButton(c).getAttribute("aria-busy")], "nothing is left to save, and no Save is out").toEqual([true, null]), { timeout: 10_000 });
    await settle();
    expect([
        toolbar(c).queryByRole("button", { name: editingMessages.retryRequest() }),
        toolbar(c).queryByRole("button", { name: editingMessages.retryRefresh() }),
        saveButton(c).getAttribute("aria-busy"),
        c.querySelector("[data-conflicts]"),
    ]).toEqual([null, null, null, null]);
}

test("a level typed here is saved and no answer comes; another session types it back as it was; Retry — the Save is acknowledged at the state e3 answers with, where the level reads as it did before the Save: never waited on, nothing asked, nothing left to save", async () => {
    const c = await mounted("record-remote-unanswered-put-back");
    await type(c, "2", "5");
    await saveWithNoAnswer(c);
    // It landed: e3 holds the level, and the Record does not know.
    expect((await h.read(fx.numberedCrew)).get(2n)!.forklift).toBe("5");
    await theirs((crew) => { crew.set(2n, { ...crew.get(2n)!, forklift: "2" }); });
    const commits = (await h.history(fx.numberedCrew)).commits.length;
    await retriedToRest(c);
    expect([look(c)[0], (await h.read(fx.numberedCrew)).get(2n)!.forklift]).toEqual([["2", "yes", "2"], "2"]);
    // Answered, never applied again: the Retry committed nothing.
    expect((await h.history(fx.numberedCrew)).commits.length).toBe(commits);
});

test("a member removed here is saved and no answer comes; another session adds them back as they were; Retry — the Save is acknowledged with the member there, as e3 holds the crew: never waited on, and never removed again", async () => {
    const c = await mounted("record-remote-unanswered-added-back");
    const member = (await h.read(fx.numberedCrew)).get(9n)!;
    await remove(c, "9");
    await saveWithNoAnswer(c);
    expect((await h.read(fx.numberedCrew)).has(9n)).toBe(false);
    await theirs((crew) => { crew.set(9n, member); });
    const commits = (await h.history(fx.numberedCrew)).commits.length;
    await retriedToRest(c);
    expect([drawn(c), (await h.read(fx.numberedCrew)).get(9n)]).toEqual([["2", "9", "10"], member]);
    expect((await h.history(fx.numberedCrew)).commits.length).toBe(commits);
});

/** What the shared check takes of the crew read a window at a time: what the grid draws, what e3 holds, and a Save followed by a write that puts the crew back. */
async function putBack(c: HTMLElement) {
    const before = await h.read(fx.numberedCrew);
    return {
        container: c,
        look: () => look(c),
        held: async () => [...(await h.read(fx.numberedCrew))],
        savedThenPutBack: (save: () => void) => h.followed(fx.numberedCrew, save, () => before),
    };
}

test("a level typed here and saved, typed back by another session before the grid reads the crew again, is read back with the level as it was: the Save never left saving, nothing asked, nothing left to save", async () => {
    const c = await mounted("record-remote-put-back-level");
    await putBackAfterSave({ ...await putBack(c), change: () => type(c, "9", "2") });
});

test("a member removed here and saved, added back by another session exactly as they were before the grid reads the crew again, stands on the grid as e3 holds them: the Save never left saving, and the member never removed again", async () => {
    const c = await mounted("record-remote-put-back-removed");
    await putBackAfterSave({ ...await putBack(c), change: () => remove(c, "9") });
});

test("a Save whose answer comes after the grid has heard of another session's later change of another member never takes the grid back to the crew as the Save left them: their change stays drawn, beside the level saved here", async () => {
    const c = await mounted("record-remote-late-answer");
    const levelOf = (id: string) => look(c).find(([key]) => key === id)?.[2];
    // Every answer e3 gives the grid's reads of the crew, from here.
    const reads = h.e3.answers((request: E3Request) => request.kind !== "mutate" && request.dataset === CREW);
    await heardBeforeAnswer({
        container: c,
        change: () => type(c, "9", "2"),
        mine: () => levelOf("9"),
        theirs: () => levelOf("10"),
        refused: () => reads.filter((answer) => answer.status >= 400).length,
        // Another session sets member 10's level once the Save here has committed.
        savedThenHeard: (save) => h.late(fx.numberedCrew, save, (crew) => { const next = new Map(crew); next.set(10n, { ...next.get(10n)!, forklift: "2" }); return next as typeof crew; }),
    });
    const held = await h.read(fx.numberedCrew);
    expect([held.get(9n)!.forklift, held.get(10n)!.forklift]).toEqual(["2", "2"]);
});

test("with a browser keeping what e3 marks to keep: a level typed back and saved — the crew as the grid first read them, a state the browser answers every read of itself — answered after the grid has heard of another session's later change, never takes the grid back to that state: their change stays drawn", async () => {
    // A browser keeps each read pinned to a state, as e3 marks it, and answers it again itself: e3 is never asked, and
    // refuses nothing. Put back at a state it holds the reads of, the grid drew the crew as they were then — the other
    // session's change gone — and stayed there until the crew next changed: the hash it had last heard was theirs.
    const kept = h.e3.browserCache();
    const c = await mounted("record-remote-late-answer-kept");
    const levelOf = (id: string) => look(c).find(([key]) => key === id)?.[2];
    // A level typed and saved, read back: the crew at another state.
    await type(c, "9", "2");
    await press(saveButton(c));
    await waitFor(() => expect([off(discardButton(c)), saveButton(c).getAttribute("aria-busy")]).toEqual([true, null]), { timeout: 10_000 });
    await settle();
    // Typed back and saved: the crew are as the grid first read them.
    const reads = h.e3.answers((request: E3Request) => request.kind !== "mutate" && request.dataset === CREW);
    await heardBeforeAnswer({
        container: c,
        change: () => type(c, "9", "0"),
        mine: () => levelOf("9"),
        theirs: () => levelOf("10"),
        refused: () => reads.filter((answer) => answer.status >= 400).length,
        // Another session sets member 10's level once the Save here has committed.
        savedThenHeard: (save) => h.late(fx.numberedCrew, save, (crew) => { const next = new Map(crew); next.set(10n, { ...next.get(10n)!, forklift: "2" }); return next as typeof crew; }),
    });
    const held = await h.read(fx.numberedCrew);
    expect([held.get(9n)!.forklift, held.get(10n)!.forklift]).toEqual(["0", "2"]);
    // The grid asked for no read the browser held: it was never back at a state it had read before.
    expect(kept.filter((request) => request.dataset === CREW).length).toBe(0);
});

test("with a browser keeping what e3 marks to keep: a level typed back and saved, and put back again by another session before the grid's next poll — the crew at the state the grid was last told of — never leaves the grid drawn as the Save left it: its next poll brings it to the crew as e3 holds them", async () => {
    // The Save's answer puts the grid at the state it committed: one the browser holds every read of, so e3 is asked
    // nothing and refuses nothing. The crew are by then back at the state before the Save — whose hash is the one the
    // grid was last told. Told a hash only where it differs from the last one told, the grid heard nothing more, and
    // drew the level as saved — which the crew no longer held — until they next changed.
    h.e3.browserCache();
    const c = await mounted("record-remote-kept-put-back");
    const levelOf = (id: string) => look(c).find(([key]) => key === id)?.[2];
    const readBack = () => waitFor(() => expect([off(discardButton(c)), saveButton(c).getAttribute("aria-busy")]).toEqual([true, null]), { timeout: 10_000 });
    // A level typed and saved, read back: the crew at another state.
    await type(c, "9", "2");
    await press(saveButton(c));
    await readBack();
    await settle();
    const before = await h.read(fx.numberedCrew);
    // Typed back and saved — the crew as the grid first read them — then put back by another session before the grid reads the crew again.
    await type(c, "9", "0");
    await h.followed(fx.numberedCrew, () => { fireEvent.click(saveButton(c)); }, () => before);
    await readBack();
    await h.poll();
    expect((await h.read(fx.numberedCrew)).get(9n)!.forklift).toBe("2");
    expect(levelOf("9"), "the grid draws the level as the crew hold it").toBe("2");
});

