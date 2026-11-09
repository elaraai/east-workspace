/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * An edit in Details its cell refuses (#1585): the field shows what the row
 * holds again, the reason under it, as the status line says it, and the row
 * takes no draft. Over the Record's operators deployed to e3 itself, each
 * one's notes read as a column from data of one member, a String a clear can't
 * leave empty.
 */

import { expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTimeType, East, StringType, StructType } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/record/record";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record": ex }, frame: 2000 });

/** An operator's notes as the struct the Note column reads: one field, a String, never empty. */
const Note = StructType({ note: StringType });
const noteOf = East.function([StringType, DateTimeType], Note, (_$, notes, _day) => ({ note: notes }));
const withNote = East.function([StringType, Note, DateTimeType], StringType, (_$, _notes, next, _day) => next.note);

/** The operators, each one's notes a column from data of one member: Note. */
const operatorNotes = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const operators = $.let(Record.bind(ex.recordOperators));
    return Record({
        record: operators,
        title: "Operators",
        noun: { singular: "operator", plural: "operators" },
        // The operators come from the Gatehouse: this Record edits them, and adds none.
        edits: { insertRows: false },
        columns: {
            name: Record.column.title(ex.Operator, { header: "Name" }),
            notes: Record.column.text(ex.Operator, { each: { note: "Note" }, read: noteOf, write: withNote }),
        },
        inspector: true,
        name: "operatorNotes",
    });
})));

/** A row's cell, by the row's key and the column's. */
const cell = (container: HTMLElement, id: string, key: string) =>
    container.querySelector<HTMLElement>(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`)!;
/** Details' field, by its key. */
const field = (container: HTMLElement, key: string) =>
    slot(container, "end")!.querySelector<HTMLElement>(`[role="tabpanel"]:not([hidden]) [data-record-details="row"] [data-field="${key}"]`)!;
/** The status line's words. */
const status = (container: HTMLElement) => slot(container, "toolbar")!.querySelector('[data-slot="status"]')?.textContent;

test("a Note cleared in Details, which its column can't leave empty: the box shows the note the row holds again, the reason under it as the status line says it, and the row takes no draft (#1585)", async () => {
    const { container } = await h.mount({ fn: operatorNotes }, { storageKey: "record-details-refused" });
    // A. Morgan's row, the ring placed on her name: Details shows it.
    await act(async () => { fireEvent.mouseDown(cell(container, "P-0401", "name"), { button: 0 }); });
    await settle();
    const box = () => within(field(container, "notes:note")).getByRole("textbox") as HTMLInputElement;
    expect(box().value).toBe("Prefers day shifts through March");
    const user = userEvent.setup();
    await user.clear(box());
    await user.type(box(), "{Enter}");
    await settle();
    expect(box().value).toBe("Prefers day shifts through March");
    expect(field(container, "notes:note").querySelector("[data-scope=field][data-part=error-text]")?.textContent).toBe("Note can't be left empty");
    expect(status(container)).toBe("Note can't be left empty — the edit was not kept");
    expect(cell(container, "P-0401", "notes:note").textContent).toBe("Prefers day shifts through March");
    expect(cell(container, "P-0401", "name").closest('[data-slot="row"]')!.hasAttribute("data-draft")).toBe(false);
});
