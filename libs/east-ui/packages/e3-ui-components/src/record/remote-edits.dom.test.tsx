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
import { removedHere, removedOnBothSides, removedThere } from "../shared/remote-rows.test-utils.js";
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
