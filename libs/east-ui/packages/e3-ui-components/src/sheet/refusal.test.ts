/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * What a refused gesture shows beside its words (east-workspace#1709): which of the Sheet's messages say a gesture was
 * refused, which row one was refused on — a row the gesture would have moved, by the refusal's turn — and that a
 * refusal's words go as the next gesture is taken.
 */

import { describe, expect, test } from "vitest";
import { noticeRefuses, refusedRowOf } from "./refusal.js";
import { initialSheetStore, sheetStoreReducer, type SheetNotice } from "./sheet-state.js";

/** Why a cell was left as it was: a mark locks it. */
const LOCKED = { why: "locked", words: "Shipped" } as const;

describe("what a refused gesture shows", () => {
    test("a message that a gesture was refused takes the danger tone: a key taken or not built, an edit, a clear or a drop refused, a row that cannot be added, a paste no cell took — and no other", () => {
        expect([
            noticeRefuses({ id: "keyRefused", what: "row", noun: undefined, why: { taken: "A-1" } }),
            noticeRefuses({ id: "keyRefused", what: "group", noun: "order", why: { failed: new Error("no key") } }),
            noticeRefuses({ id: "keyTaken", key: "7" }),
            noticeRefuses({ id: "keyFailed", reason: "no key" }),
            noticeRefuses({ id: "cantAdd", what: "row", noun: undefined, label: "Site" }),
            noticeRefuses({ id: "editRefused", word: LOCKED }),
            noticeRefuses({ id: "clearRefused", n: 1, cleared: 2, word: LOCKED }),
            noticeRefuses({ id: "pasted", rows: 1, cols: 1, skipped: 1, wrote: false }),
        ]).toEqual([true, true, true, true, true, true, true, true]);
        expect([
            noticeRefuses(null),
            noticeRefuses({ id: "newRow" }),
            noticeRefuses({ id: "pasted", rows: 2, cols: 2, skipped: 0 }),
            noticeRefuses({ id: "pasted", rows: 2, cols: 2, skipped: 1, wrote: true, refused: LOCKED }),
            noticeRefuses({ id: "deleted", n: 1, what: "rows", noun: undefined, nouns: undefined, again: false }),
            noticeRefuses({ id: "renumbered", from: "J-104", to: "J-105", n: 1 }),
        ]).toEqual([false, false, false, false, false, false]);
    });

    test("a row refused for its key is the one its message names — a row the sheet holds — on a turn that is the other of the refusal before; a row never added names none", () => {
        const taken = { id: "keyRefused", what: "row", noun: undefined, why: { taken: "A-1" } } as const;
        expect([
            refusedRowOf({ ...taken, row: "A-2", nth: 1 }),
            refusedRowOf({ ...taken, row: "A-2", nth: 2 }),
            refusedRowOf({ ...taken, row: "A-2", nth: 3 }),
            // A row keyed by the empty text is a row as any other.
            refusedRowOf({ ...taken, row: "", nth: 4 }),
        ]).toEqual([{ id: "A-2", turn: "1" }, { id: "A-2", turn: "0" }, { id: "A-2", turn: "1" }, { id: "", turn: "0" }]);
        expect([refusedRowOf({ ...taken, nth: 1 }), refusedRowOf({ id: "keyTaken", key: "A-1" }), refusedRowOf(null)]).toEqual([undefined, undefined, undefined]);
    });

    test("a gesture taken takes away the words of a refusal that stood as it began — never a message of another kind, nor words the gesture left itself", () => {
        const refusal: SheetNotice = { id: "keyRefused", what: "row", noun: undefined, why: { taken: "A-1" }, row: "A-2", nth: 1 };
        const said = (msg: SheetNotice | null) => sheetStoreReducer(initialSheetStore(), { t: "patch", patch: { msg } });
        // The refusal stood as the gesture began: its words go.
        expect(sheetStoreReducer(said(refusal), { t: "taken", stood: refusal }).ui.msg).toBeNull();
        // Words that say no refusal stand.
        const pasted: SheetNotice = { id: "pasted", rows: 1, cols: 1, skipped: 0 };
        expect(sheetStoreReducer(said(pasted), { t: "taken", stood: pasted }).ui.msg).toBe(pasted);
        // A refusal the gesture left itself — of part of it — is not the one that stood: it stays said.
        const own: SheetNotice = { id: "clearRefused", n: 1, cleared: 2, word: LOCKED };
        expect(sheetStoreReducer(said(own), { t: "taken", stood: refusal }).ui.msg).toBe(own);
        expect(sheetStoreReducer(said(own), { t: "taken", stood: null }).ui.msg).toBe(own);
        // No message, nothing to take away: the store is the one it was.
        const quiet = said(null);
        expect(sheetStoreReducer(quiet, { t: "taken", stood: null })).toBe(quiet);
    });
});
