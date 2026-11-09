/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A new row's key another Save took meanwhile (#1583): a piece drafted under
 * the key the Record's `newKey` makes next, and another session's Save adding
 * its own piece under that key first. Where the Record made the key, its piece
 * goes on under the next key it makes — both pieces saved, nothing to choose —
 * and the status line says so, once; a key it does not know as its own leaves
 * the two pieces a conflict to choose between. Over the Record's examples
 * deployed to e3 itself, each test a workspace of its own.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, SetType, StringType, equalFor, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/record/record";
import { conflictCards, reloadPage } from "../e3-web-mount.test-utils.js";
import { settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record": ex }, frame: 2000 });
const pieceEqual = equalFor(ex.Piece);
const printPieces = printFor(ex.recordPieces.type);

/** The piece this page drafts: a bookshelf for the study, whole. */
const BOOKSHELF: ValueTypeOf<typeof ex.Piece> = { name: "Bookshelf", room: "Study", bench: 1n, finish: variant("bare", null) };
/** The piece another session adds meanwhile, under the same key. */
const PANTRY: ValueTypeOf<typeof ex.Piece> = { name: "Pantry shelf", room: "Kitchen", bench: 2n, finish: variant("stain", "Oak") };

/** The joinery's pieces, a new one keyed after the record's own — J-104 after J-103 — and drafted whole: the bookshelf. */
const piecesNumbered = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const pieces = $.let(Record.bind(ex.recordPieces));
    const newKey = $.const(East.function([SetType(StringType)], StringType, (_$2, taken) => East.str`J-${taken.size().add(101n)}`));
    const newRow = $.const(East.function([Record.Types.NewRow], Record.Types.Patch(ex.Piece), () => Record.patch(ex.Piece, BOOKSHELF)));
    return Record({
        record: pieces,
        title: "Joinery",
        noun: { singular: "piece", plural: "pieces" },
        columns: {
            name: Record.column.title(ex.Piece, { header: "Piece" }),
            room: Record.column.text(ex.Piece, { header: "Room" }),
        },
        newKey,
        newRow,
        name: "piecesNumbered",
    });
})));

/** The grid's rows, by their keys, in order. */
const ids = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-record] [data-slot="row"]')].map((row) => row.getAttribute("data-row-id"));
/** The toolbar's region. */
const toolbar = (container: HTMLElement) => slot(container, "toolbar")!;
/** The status line's words. */
const status = (container: HTMLElement) => toolbar(container).querySelector('[data-slot="status"]')?.textContent;
/** A button of the history bar, by its name. */
const history = (container: HTMLElement, name: string) => within(toolbar(container)).getByRole("button", { name }) as HTMLButtonElement;
/** The session's banners, by their kind. */
const banners = (container: HTMLElement) => [...container.querySelectorAll("[data-session-banner]")].map((banner) => banner.getAttribute("data-session-banner"));

/** Add, pressed, and what it leads to settled. */
async function add(container: HTMLElement) {
    const button = toolbar(container).querySelector<HTMLButtonElement>('[data-record-action="add"]')!;
    fireEvent.mouseDown(button, { button: 0 });
    fireEvent.click(button);
    await settle();
}

/** The record as another session leaves it: its own piece added under J-104. */
const theirs = (now: ValueTypeOf<typeof ex.recordPieces.type>) => {
    now.set("J-104", PANTRY);
    return now;
};

describe("a new row's key another Save took (#1583)", () => {
    test("a piece under a key the Record made goes on under the next it makes: both pieces saved, nothing to choose, and the status line says so, once — mounted again before the Save, the Record still knows the key as its own", async () => {
        const first = await h.mount({ fn: piecesNumbered }, { storageKey: "record-renumber" });
        await add(first.container);
        expect(ids(first.container)).toEqual(["J-101", "J-102", "J-103", "J-104"]);
        // Away and back: the draft is the session's still, and its key the Record's own.
        first.unmount();
        const { container, unmount } = await h.mount({ fn: piecesNumbered }, { storageKey: "record-renumber" });
        expect(ids(container)).toEqual(["J-101", "J-102", "J-103", "J-104"]);
        // Another session adds its own J-104 just as Save goes.
        await h.race(ex.recordPieces, () => { fireEvent.click(history(container, editingMessages.apply())); }, theirs);
        await waitFor(() => expect(status(container)).toBe("J-104 was taken by another save — the new piece is J-105"));
        const pieces = await h.read(ex.recordPieces);
        expect([...pieces.keys()]).toEqual(["J-101", "J-102", "J-103", "J-104", "J-105"]);
        expect([pieceEqual(pieces.get("J-104")!, PANTRY), pieceEqual(pieces.get("J-105")!, BOOKSHELF)], printPieces(pieces)).toEqual([true, true]);
        expect(ids(container)).toEqual(["J-101", "J-102", "J-103", "J-104", "J-105"]);
        expect(banners(container)).toEqual([]);
        // Said once: mounted again, the line has nothing more to say of it.
        unmount();
        const again = await h.mount({ fn: piecesNumbered }, { storageKey: "record-renumber" });
        expect(status(again.container)).toBe("");
    });

    test("a piece under a key the Record does not know as its own — a draft the tab kept through a reload — and the other's under the same key are a conflict to choose between, as before", async () => {
        const first = await h.mount({ fn: piecesNumbered }, { storageKey: "record-renumber-reload" });
        await add(first.container);
        // The page reloads: the tab keeps the draft, and the keys the Record made go with the page.
        reloadPage();
        const { container } = await h.mount({ fn: piecesNumbered }, { storageKey: "record-renumber-reload" });
        await waitFor(() => expect(ids(container)).toEqual(["J-101", "J-102", "J-103", "J-104"]));
        await h.race(ex.recordPieces, () => { fireEvent.click(history(container, editingMessages.apply())); }, theirs);
        await waitFor(() => expect(banners(container)).toEqual(["conflicts"]));
        const [card, ...more] = await conflictCards(container);
        expect(more).toEqual([]);
        expect([card!.item, card!.yours, card!.theirs]).toEqual([
            "Bookshelf", "Yours, Name: Bookshelf · Room: Study · Bench: 1 · …",
            "Theirs, Name: Pantry shelf · Room: Kitchen · Bench: 2 · …, Changed since this edit began — last changed by another session",
        ]);
        const pieces = await h.read(ex.recordPieces);
        expect([...pieces.keys()]).toEqual(["J-101", "J-102", "J-103", "J-104"]);
        expect(pieceEqual(pieces.get("J-104")!, PANTRY), printPieces(pieces)).toBe(true);
    });
});
