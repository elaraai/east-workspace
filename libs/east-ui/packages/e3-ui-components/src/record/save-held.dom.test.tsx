/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Record through a Save whose reads come back late — the checks every
 * builder runs (`shared/save-held.test-utils.ts`), over a record read a window
 * at a time, with a lock a column's `mark` reads from each row: a member's
 * edit stays drawn, its lock with it, from the press of Save until its window
 * is read again; a Save never stops the editing — another member edited while
 * the pages are read again is taken at once, and the next Save writes them;
 * and no lock lifts meanwhile, each read over the entry its row was read with
 * (#1599). And the app's own page evaluated again meanwhile — a State it
 * reads moving — takes nothing off the grid: the rows stand, their marks all
 * read afresh, and stay editable.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, East, NullType, OptionType, StringType, none, some, variant } from "@elaraai/east";
import { Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { StateImpl, editingMessages } from "@elaraai/east-ui-components";
import { Data, Record } from "@elaraai/e3-ui/internal";
import * as fx from "@elaraai/e3-ui/fixtures/sheet/sheet-keys";
import { editedThroughReload, redrawnThroughReload, savedThroughReload } from "../shared/save-held.test-utils.js";
import { evaluatesAgain } from "../e3-web-mount.test-utils.js";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "sheet/sheet-keys.fixtures": fx }, frame: 2000 });
evaluatesAgain();

/** The crew's record, as its dataset's requests name it. */
const CREW = `records.${fx.numberedCrew.name}`;
/** What a column's `mark` returns. */
const Mark = OptionType(Record.Types.Mark);

/** The crew a window at a time (`Data.bindPaged`): a member not inducted is locked out of the forklift. */
const windowedCrew = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const members = $.let(Record.bind(fx.numberedCrew));
    const page = $.let(Data.bindPaged(fx.numberedCrew));
    const notInducted = $.const(East.function([fx.NumberedMember, DateTimeType], Mark, ($2, member) => {
        $2.if(member.inducted, ($3) => { $3.return(none); });
        return some(variant("lock", "Not inducted"));
    }));
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
            forklift: Record.column.text(fx.NumberedMember, { header: "Forklift", mark: notInducted }),
        },
        name: "windowedCrew",
    });
})));

/** Where the forklift column's header is kept: a State the app writes. */
const HEADING = "record-save-held-heading";

/** The same crew, the forklift column headed by what the app's State holds: a write to it draws the Record from a new value. */
const headedCrew = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const members = $.let(Record.bind(fx.numberedCrew));
    const page = $.let(Data.bindPaged(fx.numberedCrew));
    const heading = $.let(State.bind([StringType], HEADING, "Forklift"));
    const notInducted = $.const(East.function([fx.NumberedMember, DateTimeType], Mark, ($2, member) => {
        $2.if(member.inducted, ($3) => { $3.return(none); });
        return some(variant("lock", "Not inducted"));
    }));
    return Record({
        record: members,
        window: page,
        title: "Crew",
        noun: { singular: "crew member", plural: "crew members" },
        edits: { insertRows: false },
        columns: {
            name: Record.column.title(fx.NumberedMember, { header: "Name" }),
            inducted: Record.column.toggle(fx.NumberedMember, { header: "Inducted", on: "yes", off: "no" }),
            forklift: Record.column.text(fx.NumberedMember, { header: heading.read(), mark: notInducted }),
        },
        name: "headedCrew",
    });
})));

/** The app renames the forklift column. */
const rename = East.function([StringType], NullType, ($, to) => {
    const heading = $.const(State.bind([StringType], HEADING, "Forklift"));
    $(heading.write(to));
}).toIR().compile(StateImpl);

/** Where the app keeps the word its forklift column's detail begins with. */
const NOTE = "record-save-held-note";

/** The same crew, each forklift cell's detail beginning with a word the app's State holds: a write to it reads every row another way. */
const notedCrew = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const members = $.let(Record.bind(fx.numberedCrew));
    const page = $.let(Data.bindPaged(fx.numberedCrew));
    const note = $.let(State.bind([StringType], NOTE, "level"));
    // Read here, as the app's block is evaluated: the word is among what each row is read with.
    const word = $.let(note.read());
    return Record({
        record: members,
        window: page,
        title: "Crew",
        noun: { singular: "crew member", plural: "crew members" },
        edits: { insertRows: false },
        columns: {
            name: Record.column.title(fx.NumberedMember, { header: "Name" }),
            inducted: Record.column.toggle(fx.NumberedMember, { header: "Inducted", on: "yes", off: "no" }),
            forklift: Record.column.text(fx.NumberedMember, { header: "Forklift", detail: (member) => East.str`${word} ${member.forklift}` }),
        },
        name: "notedCrew",
    });
})));

/** The app changes the word. */
const renote = East.function([StringType], NullType, ($, to) => {
    const note = $.const(State.bind([StringType], NOTE, "level"));
    $(note.write(to));
}).toIR().compile(StateImpl);

/** The Record's rows, in order. */
const rows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-record] [data-slot="row"]')];
/** A row's cell under a column. */
const cellOf = (row: HTMLElement, key: string) => row.querySelector<HTMLElement>(`[data-slot="cell"][data-key="${key}"]`);
/** The cell of the member keyed `id` under a column. */
const cellAt = (c: HTMLElement, id: string, key: string) => cellOf(rows(c).find((row) => row.getAttribute("data-row-id") === id)!, key)!;
/** What the Record draws of each member: their key, whether they are inducted, and whether the forklift is locked to them. */
const look = (c: HTMLElement) => rows(c).map((row) => [row.getAttribute("data-row-id"), cellOf(row, "inducted")?.textContent, cellOf(row, "forklift")?.hasAttribute("data-locked")]);

/** A press on a cell — the primary button — and what it leads to settled. */
async function press(cell: Element) {
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.click(cell);
    await settle();
}

test("a member's edit, and the lock it brings, stay drawn while their window is read again after the Save, and once it is — no other member's lock lifting meanwhile", async () => {
    const { container: c } = await h.mount({ fn: windowedCrew }, { storageKey: "record-save-held" });
    await waitFor(() => expect(look(c)).toEqual([["2", "yes", false], ["9", "no", true], ["10", "yes", false]]));
    // A. Morgan's induction lapses: a draft, which locks the forklift to them.
    await press(cellAt(c, "2", "inducted"));
    expect(look(c)).toEqual([["2", "no", true], ["9", "no", true], ["10", "yes", false]]);
    await savedThroughReload({
        e3: h.e3,
        container: c,
        // The window's pages, which the Save's own confirmation, by key, is none of.
        reads: (request) => request.dataset === CREW && request.kind === "page",
        look: () => look(c),
    });
    expect((await h.read(fx.numberedCrew)).get(2n)).toEqual({ name: "A. Morgan", inducted: false, forklift: "2" });
});

test.each([
    ["a Save never stops the editing: another member's induction lapsed while the window is read again after a Save is taken at once — the lock with it — stays as the pages land, and the next Save writes it", editedThroughReload, "record-save-again"],
    ["the page evaluated again while the window is read again after a Save takes no member off the grid, and lifts no lock: another member's induction lapsed meanwhile is taken at once, stays as the page is evaluated again and the pages land, and the next Save writes it", redrawnThroughReload, "record-save-redrawn"],
])("%s", async (_name, through, storageKey) => {
    const { container: c } = await h.mount({ fn: windowedCrew }, { storageKey });
    await waitFor(() => expect(look(c)).toEqual([["2", "yes", false], ["9", "no", true], ["10", "yes", false]]));
    await press(cellAt(c, "2", "inducted"));
    expect(look(c)).toEqual([["2", "no", true], ["9", "no", true], ["10", "yes", false]]);
    await through({
        e3: h.e3,
        container: c,
        reads: (request) => request.dataset === CREW && request.kind === "page",
        look: () => look(c),
        // C. Patel, whom the Save did not hold: their original is the grid's own row of them.
        again: [
            () => { fireEvent.mouseDown(cellAt(c, "10", "inducted"), { button: 0 }); },
            () => { fireEvent.click(cellAt(c, "10", "inducted")); },
        ],
    });
    expect(look(c)).toEqual([["2", "no", true], ["9", "no", true], ["10", "no", true]]);
    const crew = await h.read(fx.numberedCrew);
    expect([crew.get(2n)!.inducted, crew.get(10n)!.inducted]).toEqual([false, false]);
});

test("the app's page evaluated again while the window is read again after a Save takes nothing off the grid: its rows stand, no lock lifts — each mark read over the entry its row was read with — and another member edited then is taken at once, the next Save writing them", async () => {
    const { container: c } = await h.mount({ fn: headedCrew }, { storageKey: "record-save-marks" });
    await waitFor(() => expect(look(c)).toEqual([["2", "yes", false], ["9", "no", true], ["10", "yes", false]]));
    const headers = () => [...c.querySelectorAll<HTMLElement>('[data-record] [role="columnheader"]')].map((header) => header.textContent);
    expect(headers()).toContain("Forklift");
    await press(cellAt(c, "2", "inducted"));
    const drafted = [["2", "no", true], ["9", "no", true], ["10", "yes", false]];
    const edited = [["2", "no", true], ["9", "no", true], ["10", "no", true]];
    expect(look(c)).toEqual(drafted);
    const held = h.e3.hold((request) => request.dataset === CREW && request.kind === "page");
    try {
        await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() })); });
        await waitFor(() => expect(held.held, "the Record reads what it saved again").toBeGreaterThan(0), { timeout: 5_000 });
        await settle();
        expect(look(c)).toEqual(drafted);
        // The app renames the column while the pages are on their way: the Record is drawn again, every mark read afresh.
        await act(async () => { rename("Forklift licence"); });
        await settle();
        await waitFor(() => expect(headers()).toContain("Forklift licence"));
        // Every member is there still; B. Ellis is not inducted still, and the forklift locked to them still.
        expect(look(c)).toEqual(drafted);
        // And a Save never stops the editing: C. Patel's induction lapses, at once, the lock with it.
        await press(cellAt(c, "10", "inducted"));
        expect(look(c)).toEqual(edited);
    } finally {
        await act(async () => { held.release(); });
    }
    await settle();
    expect(look(c)).toEqual(edited);
    // The first Save confirmed, the second edit is what is left to save: a press writes it.
    const save = () => within(slot(c, "toolbar")!).getByRole<HTMLButtonElement>("button", { name: editingMessages.apply() });
    await waitFor(() => expect(save().disabled).toBe(false), { timeout: 5_000 });
    await act(async () => { fireEvent.click(save()); });
    await settle();
    await waitFor(() => expect(within(slot(c, "toolbar")!).getByRole<HTMLButtonElement>("button", { name: editingMessages.discard() }).disabled).toBe(true), { timeout: 5_000 });
    expect(look(c)).toEqual(edited);
    const crew = await h.read(fx.numberedCrew);
    expect([crew.get(2n)!.inducted, crew.get(10n)!.inducted]).toEqual([false, false]);
});

test("a column read another way while the window is read again takes no row off the grid: the rows stand, retained — a press on one is not taken — until they are read again, and then they are read the new way and take an edit", async () => {
    const { container: c } = await h.mount({ fn: notedCrew }, { storageKey: "record-save-reread" });
    /** Each member's key and whether they are inducted. */
    const inducted = () => rows(c).map((row) => [row.getAttribute("data-row-id"), cellOf(row, "inducted")?.textContent]);
    /** What a member's forklift cell says on hover: its value and its detail. */
    const said = (id: string) => cellAt(c, id, "forklift").getAttribute("title");
    await waitFor(() => expect(inducted()).toEqual([["2", "yes"], ["9", "no"], ["10", "yes"]]));
    expect(said("2")).toContain("level 2");
    await press(cellAt(c, "2", "inducted"));
    const drafted = [["2", "no"], ["9", "no"], ["10", "yes"]];
    expect(inducted()).toEqual(drafted);
    const held = h.e3.hold((request) => request.dataset === CREW && request.kind === "page");
    try {
        await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() })); });
        await waitFor(() => expect(held.held, "the Record reads what it saved again").toBeGreaterThan(0), { timeout: 5_000 });
        await settle();
        expect(inducted()).toEqual(drafted);
        // The app's word changes while the pages are on their way: every row is read another way, and none has landed so.
        await act(async () => { renote("grade"); });
        await settle();
        // Every member is on the grid still, as the last reading drew them.
        expect(inducted()).toEqual(drafted);
        expect(said("2")).toContain("level 2");
        // Retained: they are the last reading's rows, and a press on one is not taken.
        await press(cellAt(c, "10", "inducted"));
        expect(inducted()).toEqual(drafted);
    } finally {
        await act(async () => { held.release(); });
    }
    await settle();
    // Read again: the same members, the new way — and an edit is taken.
    await waitFor(() => expect(said("2")).toContain("grade 2"));
    expect(inducted()).toEqual(drafted);
    await press(cellAt(c, "10", "inducted"));
    expect(inducted()).toEqual([["2", "no"], ["9", "no"], ["10", "no"]]);
});
