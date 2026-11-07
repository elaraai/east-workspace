/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A new row's key over records keyed by number (#1549), on e3 itself: a
 * workshop's jobs and crew (`sheet-keys.fixtures.ts`). With no `newKey`, an
 * Integer key is one past the largest — of the keys the sheet has taken and,
 * reading the record a window at a time, of the last it holds — by the keys'
 * numbers, never their texts, whose largest, "9", is taken. Each new row is
 * Saved, and e3 holds it under its key.
 *
 * - **The Sheet** over the jobs, read whole and a window at a time: a row
 *   typed in a blank row is job 11.
 * - **The Record** over the crew: Add drafts crew member 11.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArrayType, East, IntegerType, SortedMap, StringType, StructType, compareFor, equalFor, some } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { Data, Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import * as fx from "@elaraai/e3-ui/fixtures/sheet/sheet-keys";
import { act, settle, sheetHarness, slot } from "./frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "../record/index.js";

const h = sheetHarness({ modules: { "sheet/sheet-keys.fixtures": fx }, frame: 2000 });
const compareNumber = compareFor(IntegerType);
const SAVE = editingMessages.apply();

const COLUMNS = {
    task: Sheet.column.text(fx.NumberedJob, { header: "Task" }),
    qty: Sheet.column.integer(fx.NumberedJob, { header: "Qty" }),
};

/** The jobs read whole: their entries the rows, in key order. */
const wholeJobs = East.function([], SheetPayloadType, ($) => {
    const jobs = $.let(Record.bind(fx.numberedJobs, ["patch"]));
    return Sheet.Payload({ record: jobs, name: "wholeJobs", columns: COLUMNS });
});

/** The jobs a window at a time: `Data.bindPaged` over the same record. */
const windowedJobs = East.function([], SheetPayloadType, ($) => {
    const jobs = $.let(Record.bind(fx.numberedJobs, ["patch"]));
    const page = $.let(Data.bindPaged(fx.numberedJobs));
    return Sheet.Payload({ record: jobs, window: page, name: "windowedJobs", columns: COLUMNS });
});

/** The crew, the app's new member uninducted and untrained: what Add drafts, the name the person's to fill. */
const crew = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const members = $.let(Record.bind(fx.numberedCrew));
    const levels = $.let([{ key: "0", name: "Not trained" }, { key: "1", name: "Supervised" }, { key: "2", name: "Competent" }],
        ArrayType(StructType({ key: StringType, name: StringType })));
    const newRow = $.const(East.function([Record.Types.NewRow], Record.Types.Patch(fx.NumberedMember), () => Record.patch(fx.NumberedMember, { inducted: false, forklift: "0" })));
    return Record({
        record: members,
        title: "Crew",
        noun: { singular: "crew member", plural: "crew members" },
        registers: { levels: Record.register.members(levels, { kind: "level", key: (l) => l.key, label: (l) => l.key, meta: (l) => some(l.name) }) },
        columns: {
            name: Record.column.title(fx.NumberedMember, { header: "Name" }),
            inducted: Record.column.toggle(fx.NumberedMember, { header: "Inducted", on: "yes", off: "no" }),
            forklift: Record.column.cycle(fx.NumberedMember, "levels", { header: "Forklift", scale: true }),
        },
        inspector: true,
        newRow,
        name: "numberedCrew",
    });
})));

/** The jobs once job 11 is Saved. */
const JOBS_SAVED = new SortedMap([
    [9n, { task: "Assembly", qty: 1n }],
    [10n, { task: "Spray finish", qty: 2n }],
    [11n, { task: "Sanding", qty: 6n }],
], compareNumber);

/** The crew once crew member 11 is Saved. */
const CREW_SAVED = new SortedMap([
    [2n, { name: "A. Morgan", inducted: true, forklift: "2" }],
    [9n, { name: "B. Ellis", inducted: false, forklift: "0" }],
    [10n, { name: "C. Patel", inducted: true, forklift: "1" }],
    [11n, { name: "D. Quinn", inducted: false, forklift: "0" }],
], compareNumber);

/** The sheet's rows, by their ids, in order. */
const ids = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]')].map((row) => row.getAttribute("data-row-id"));
/** The first blank row's cell under a column. */
const blankCell = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-slot="row"][data-blank] [data-key="${key}"]`)!;

/** Pastes text at a cell, as a viewer's ⌘V does: the ring placed on it, then the paste on the card. */
async function paste(c: HTMLElement, cell: HTMLElement, text: string) {
    fireEvent.mouseDown(cell, { button: 0 });
    await act(async () => { fireEvent.paste(c.querySelector("[data-sheet-card]")!, { clipboardData: { getData: () => text } }); });
    await settle();
}

/** Presses a button: down, then click, and what it leads to settled. */
async function press(button: Element) {
    fireEvent.mouseDown(button, { button: 0 });
    fireEvent.click(button);
    await settle();
}

/** The Record's toolbar. */
const toolbar = (c: HTMLElement) => slot(c, "toolbar")!;
/** The Record's rows, in order. */
const recordRows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-record] [data-slot="row"]')];
/** The row Add drafted: the one whose empty fields say they are required. */
const drafted = (c: HTMLElement) => recordRows(c).find((row) => row.querySelector("[data-required]") !== null)!;
/** The Record's Details for a row, in the inspector's open tab. */
const details = (c: HTMLElement) => slot(c, "end")!.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) [data-record-details="row"]');

describe("the Sheet", () => {
    test("over the jobs read whole, a row typed in a blank row is job 11 — one past 10, never by the keys' texts — and Save writes it under 11", async () => {
        const { container, getByRole } = await h.mountPayload(wholeJobs, { storageKey: "sheet-keys-whole" });
        expect(ids(container)).toEqual(["9", "10"]);
        await paste(container, blankCell(container, "task"), "Sanding\t6");
        expect(ids(container)).toEqual(["9", "10", "11"]);
        await press(getByRole("button", { name: SAVE }));
        expect(equalFor(fx.numberedJobs.type)(await h.read(fx.numberedJobs), JOBS_SAVED)).toBe(true);
    });

    test("over the jobs a window at a time, the same: job 11, Saved under 11", async () => {
        const { container, getByRole } = await h.mountPayload(windowedJobs, { storageKey: "sheet-keys-window" });
        await waitFor(() => expect(ids(container)).toEqual(["9", "10"]));
        await paste(container, blankCell(container, "task"), "Sanding\t6");
        expect(ids(container)).toEqual(["9", "10", "11"]);
        await press(getByRole("button", { name: SAVE }));
        expect(equalFor(fx.numberedJobs.type)(await h.read(fx.numberedJobs), JOBS_SAVED)).toBe(true);
    });
});

describe("the Record", () => {
    test("over the crew, Add drafts crew member 11 — one past 10 — and Apply writes them under 11", async () => {
        const { container } = await h.mount({ fn: crew }, { storageKey: "record-keys" });
        await press(toolbar(container).querySelector('[data-record-action="add"]')!);
        expect(drafted(container).getAttribute("data-row-id")).toBe("11");
        await waitFor(() => expect(details(container)?.getAttribute("data-record-entry")).toBe("11"));
        const user = userEvent.setup();
        await user.type(within(details(container)!.querySelector<HTMLElement>('[data-field="name"]')!).getByRole("textbox"), "D. Quinn{Enter}");
        await settle();
        await press(within(toolbar(container)).getByRole("button", { name: SAVE }));
        await waitFor(() => expect(toolbar(container).querySelector('[data-slot="status"]')?.textContent).toBe("Applied 1 new crew member"));
        expect(equalFor(fx.numberedCrew.type)(await h.read(fx.numberedCrew), CREW_SAVED)).toBe(true);
    });
});
