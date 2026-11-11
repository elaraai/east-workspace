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
 * (#1599).
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { DateTimeType, East, OptionType, none, some, variant } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Record } from "@elaraai/e3-ui/internal";
import * as fx from "@elaraai/e3-ui/fixtures/sheet/sheet-keys";
import { editedThroughReload, savedThroughReload } from "../shared/save-held.test-utils.js";
import { settle, sheetHarness } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "sheet/sheet-keys.fixtures": fx }, frame: 2000 });

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

test("a Save never stops the editing: another member's induction lapsed while the window is read again after a Save is taken at once — the lock with it — stays as the pages land, and the next Save writes it", async () => {
    const { container: c } = await h.mount({ fn: windowedCrew }, { storageKey: "record-save-again" });
    await waitFor(() => expect(look(c)).toEqual([["2", "yes", false], ["9", "no", true], ["10", "yes", false]]));
    await press(cellAt(c, "2", "inducted"));
    expect(look(c)).toEqual([["2", "no", true], ["9", "no", true], ["10", "yes", false]]);
    await editedThroughReload({
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
