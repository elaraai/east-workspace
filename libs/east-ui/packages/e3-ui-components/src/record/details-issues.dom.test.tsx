/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A field an issue names says the issue's words under it (ruled 13 Nov 2026),
 * over the joinery's pieces on e3 itself: a piece's copy starts with no name,
 * so its Details list the issue over the form — `Piece`, and what is wrong —
 * and the Piece field, washed (IN3), says the same words under it: where the
 * keyboard is, whatever of the issues over a long form is in view. Named, the
 * issue goes, and the field says nothing.
 */

import { expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { East } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/record/record";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record": ex }, frame: 2000 });

/** The joinery's pieces, with their Details. */
const piecesDetailed = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const pieces = $.let(Record.bind(ex.recordPieces));
    return Record({
        record: pieces,
        title: "Joinery",
        noun: { singular: "piece", plural: "pieces" },
        columns: {
            name: Record.column.title(ex.Piece, { header: "Piece" }),
            room: Record.column.text(ex.Piece, { header: "Room" }),
            bench: Record.column.integer(ex.Piece, { header: "Bench" }),
        },
        inspector: true,
        name: "piecesDetailed",
    });
})));

/** A piece's cell, by its key and the column's. */
const cell = (c: HTMLElement, id: string, key: string) =>
    c.querySelector<HTMLElement>(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`)!;
/** The row's Details. */
const details = (c: HTMLElement) => slot(c, "end")!.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) [data-record-details="row"]')!;
/** Details' field, by its key. */
const field = (c: HTMLElement, key: string) => details(c).querySelector<HTMLElement>(`[data-field="${key}"]`)!;
/** The issues Details lists over its form: each the field it names, and what it says. */
const listed = (c: HTMLElement) => [...details(c).querySelectorAll<HTMLElement>("[data-inspector-issues] [data-kind]")]
    .map((said) => [said.previousElementSibling?.textContent ?? null, said.textContent]);
/** The fields Details washes: those its issues name. */
const washed = (c: HTMLElement) => [...details(c).querySelectorAll("[data-field][data-issue]")].map((el) => el.getAttribute("data-field"));

test("a copy's name, still missing: Details lists the issue over its form, and the Piece field, washed, says the issue's words under it; named, the issue goes and the field says nothing", async () => {
    const { container } = await h.mount({ fn: piecesDetailed }, { storageKey: "record-details-issues" });
    // The hall door, the ring placed on its room: Details shows it, no field washed.
    await act(async () => { fireEvent.mouseDown(cell(container, "J-101", "room"), { button: 0 }); });
    await settle();
    expect([listed(container), washed(container)]).toEqual([[], []]);
    // Its copy: a piece with no name yet, its Details shown in the hall door's place.
    await act(async () => { fireEvent.click(details(container).querySelector("[data-inspector-action='duplicate']")!); });
    await settle();
    // The Sheet's words for a field still missing.
    const said = "Required";
    expect(listed(container)).toEqual([["Piece", said]]);
    expect([washed(container), field(container, "name").querySelector("[data-field-issue]")?.textContent]).toEqual([["name"], said]);
    // Named: nothing is missing, and the field says nothing.
    const user = userEvent.setup();
    const box = within(field(container, "name")).getByRole("textbox");
    await user.type(box, "Hall door, spare");
    await user.type(box, "{Enter}");
    await settle();
    expect([listed(container), washed(container), field(container, "name").querySelector("[data-field-issue]")]).toEqual([[], [], null]);
});
