/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The toolbar says one thing at a time through a Save: while a Save is out, and
 * while the session reads back the batch e3 has written, the history bar says
 * so — its words, and Save busy with the live dot (#1573) — and the status line
 * waits; once it is read back, Save rests and the status line says what the
 * Save sent (AD4). Over the Record's examples deployed to e3 itself.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, SetType, StringType, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/record/record";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record": ex }, frame: 2000 });

/** The piece Add drafts: a bookshelf for the study, whole. */
const BOOKSHELF: ValueTypeOf<typeof ex.Piece> = { name: "Bookshelf", room: "Study", bench: 1n, finish: variant("bare", null) };

/** The joinery's pieces, a new one keyed after the record's own and drafted whole: the bookshelf. */
const pieces = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const record = $.let(Record.bind(ex.recordPieces));
    const newKey = $.const(East.function([SetType(StringType)], StringType, (_$2, taken) => East.str`J-${taken.size().add(101n)}`));
    const newRow = $.const(East.function([Record.Types.NewRow], Record.Types.Patch(ex.Piece), () => Record.patch(ex.Piece, BOOKSHELF)));
    return Record({
        record,
        title: "Joinery",
        noun: { singular: "piece", plural: "pieces" },
        columns: {
            name: Record.column.title(ex.Piece, { header: "Piece" }),
            room: Record.column.text(ex.Piece, { header: "Room" }),
        },
        newKey,
        newRow,
        name: "piecesSaved",
    });
})));

/** The toolbar's region. */
const toolbar = (container: HTMLElement) => slot(container, "toolbar")!;
/** The status line's words. */
const status = (container: HTMLElement) => toolbar(container).querySelector('[data-slot="status"]')?.textContent;
/** What the history bar says a Save is doing; `undefined` while it says nothing. */
const saying = (container: HTMLElement) => toolbar(container).querySelector('[data-slot="history"] [role="status"]')?.textContent;
/** A button of the history bar, by its name. */
const history = (container: HTMLElement, name: string) => within(toolbar(container)).getByRole("button", { name }) as HTMLButtonElement;
/** Whether Save shows a Save at work: busy, the live dot in its place. */
const busy = (container: HTMLElement) => {
    const save = history(container, editingMessages.apply());
    return save.getAttribute("aria-busy") === "true" && save.querySelector("[data-history-live]") !== null;
};

describe("the toolbar through a Save", () => {
    test("while the Save is out and the batch e3 wrote is read back, the history bar says so and Save is busy, and the status line waits; read back, Save rests and the status line says what the Save sent (AD4)", async () => {
        const { container } = await h.mount({ fn: pieces }, { storageKey: "record-saved" });
        const add = toolbar(container).querySelector<HTMLButtonElement>('[data-record-action="add"]')!;
        fireEvent.mouseDown(add, { button: 0 });
        fireEvent.click(add);
        await settle();
        expect(status(container)).toBe("Added a piece");
        // Save: e3 writes the batch, its answer held on the way back; then what reads the record after it, held.
        const answer = h.e3.holdAnswers((request) => request.kind === "mutate" && request.record === ex.recordPieces.name);
        await act(async () => { fireEvent.click(history(container, editingMessages.apply())); });
        await answer.holding;
        expect([saying(container), busy(container), status(container)]).toEqual([editingMessages.historyStatus({ status: "applying" }), true, ""]);
        const reading = h.e3.hold((request) => request.kind === "status" || (request.kind !== "mutate" && request.dataset === `records.${ex.recordPieces.name}`));
        await act(async () => { answer.release(); });
        await reading.holding;
        // Written, and read back: the history bar alone says so.
        await waitFor(() => expect(saying(container)).toBe(editingMessages.historyStatus({ status: "reconciling" })));
        expect([busy(container), status(container)]).toEqual([true, ""]);
        await act(async () => { reading.release(); });
        await settle();
        await waitFor(() => expect(status(container)).toBe("Applied 1 new piece"));
        expect([saying(container), busy(container)]).toEqual([undefined, false]);
        expect([...(await h.read(ex.recordPieces)).keys()]).toEqual(["J-101", "J-102", "J-103", "J-104"]);
    });
});
