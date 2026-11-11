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
 * - That member removed: a conflict to choose; taken as theirs, the row is
 *   gone and nothing is left to save.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { Data, Record } from "@elaraai/e3-ui/internal";
import * as fx from "@elaraai/e3-ui/fixtures/sheet/sheet-keys";
import { conflictCards } from "../e3-web-mount.test-utils.js";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "sheet/sheet-keys.fixtures": fx }, frame: 2000 });

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
