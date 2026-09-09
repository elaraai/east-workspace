/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The state machine's transition table (Sheet Spec §6.1, §5 rows 13–14):
 * the esc ladder, the commit directions, the unrecognised value that never
 * commits, the printable seed, whole-row deletion.
 */

import { describe, test, expect } from "vitest";
import { sheetReducer, initialSheetState, sheetStoreReducer, initialSheetStore, type SheetMachineCtx, type SheetUiState, type SheetEvent, type SheetEffect } from "./sheet-state.js";
import type { SheetCellValue } from "./values.js";

const cell = (type: string, value: unknown): SheetCellValue => ({ type, value } as SheetCellValue);

/** A 4 × 3 sheet: text · date · stamped; `bad` never parses; row 3 is blank. */
function ctxOf(over: Partial<SheetMachineCtx> = {}): SheetMachineCtx {
    return {
        rowCount: 4,
        colCount: 3,
        lensActive: false,
        canAppend: true,
        editableAt: (_r, c) => c !== 2,
        kindAt: (c) => (c === 0 ? "lookup" : c === 1 ? "date" : "stamped"),
        parse: (_r, _c, text) => text.trim() === "" ? { kind: "blank" } : text === "bad" ? { kind: "unrecognised" } : { kind: "cell", cell: cell("String", text) },
        candidates: (_r, _c, text) => (text.startsWith("tr") ? ["Transfer", "Transfer - Annex"] : []),
        candidateAt: (_r, _c, text, hi) => (text.startsWith("tr") ? (hi > 0 ? "Transfer - Annex" : "Transfer") : undefined),
        editTextAt: (r, c) => `v${r}${c}`,
        ...over,
    };
}

const key = (k: string, mods: Partial<{ shift: boolean; meta: boolean; alt: boolean }> = {}): SheetEvent =>
    ({ t: "key", key: k, shift: false, meta: false, alt: false, ...mods });
const ekey = (k: string, mods: Partial<{ shift: boolean; meta: boolean; alt: boolean; atEnd: boolean }> = {}): SheetEvent =>
    ({ t: "editor.key", key: k, shift: false, meta: false, alt: false, atEnd: true, ...mods });

function run(s: SheetUiState, events: SheetEvent[], ctx = ctxOf()): { state: SheetUiState; effects: SheetEffect[] } {
    let state = s;
    const effects: SheetEffect[] = [];
    for (const e of events) {
        const t = sheetReducer(state, e, ctx);
        state = t.state;
        effects.push(...t.effects);
    }
    return { state, effects };
}

describe("movement", () => {
    test("arrows move the ring and report; shift extends a range", () => {
        const { state, effects } = run(initialSheetState(), [key("ArrowDown"), key("ArrowRight"), key("ArrowRight", { shift: true })]);
        expect(state.sel).toEqual({ r: 1, c: 1 });
        expect(state.selEnd).toEqual({ r: 1, c: 2 });
        expect(effects.filter((e) => e.t === "emit.select")).toHaveLength(2);
    });

    test("↓ on the last row appends — unless a lens is active or the source is unexhausted", () => {
        const at = initialSheetState({ r: 3, c: 0 });
        expect(run(at, [key("ArrowDown")]).state).toMatchObject({ sel: { r: 4, c: 0 }, appended: 1 });
        expect(run(at, [key("ArrowDown")], ctxOf({ lensActive: true })).state.sel).toEqual({ r: 3, c: 0 });
        expect(run(at, [key("ArrowDown")], ctxOf({ canAppend: false })).state.sel).toEqual({ r: 3, c: 0 });
    });

    test("esc clears a range — one rung per press", () => {
        const { state } = run(initialSheetState(), [key("ArrowRight", { shift: true }), key("Escape")]);
        expect(state.selEnd).toBeNull();
    });
});

describe("editing", () => {
    test("a printable key seeds a fresh edit; ⏎ and F2 open with the value selected", () => {
        const seeded = run(initialSheetState(), [key("x")]);
        expect(seeded.state.edit).toMatchObject({ r: 0, c: 0, val: "x", seeded: true, hi: 0 });
        expect(seeded.effects).toContainEqual({ t: "focus.editor", selectAll: false });
        const opened = run(initialSheetState(), [key("Enter")]);
        expect(opened.state.edit).toMatchObject({ val: "v00", seeded: false, hi: -1 });
        expect(opened.effects).toContainEqual({ t: "focus.editor", selectAll: true });
        expect(run(initialSheetState(), [key("F2")]).state.edit).not.toBeNull();
    });

    test("a stamped column never opens", () => {
        expect(run(initialSheetState({ r: 0, c: 2 }), [key("Enter")]).state.edit).toBeNull();
        expect(run(initialSheetState({ r: 0, c: 2 }), [key("x")]).state.edit).toBeNull();
    });

    test("commit directions: ⏎ / ↓ down, ⇥ right, ⇧⇥ left, ↑ stay, blur stay", () => {
        const open = run(initialSheetState({ r: 1, c: 1 }), [key("x")]).state;
        const after = (e: SheetEvent) => run(open, [e]);
        expect(after(ekey("Enter")).state.sel).toEqual({ r: 2, c: 1 });
        expect(after(ekey("ArrowDown")).state.sel).toEqual({ r: 2, c: 1 });
        expect(after(ekey("Tab")).state.sel).toEqual({ r: 1, c: 2 });
        expect(after(ekey("Tab", { shift: true })).state.sel).toEqual({ r: 1, c: 0 });
        expect(after(ekey("ArrowUp")).state.sel).toEqual({ r: 1, c: 1 });
        const blur = after({ t: "editor.blur" });
        expect(blur.state.sel).toEqual({ r: 1, c: 1 });
        expect(blur.state.edit).toBeNull();
        for (const t of [after(ekey("Enter")), blur]) {
            expect(t.effects).toContainEqual({ t: "write", r: 1, c: 1, cell: cell("String", "x"), text: "x" });
        }
    });

    test("an unparseable value never commits — the editor stays with the neg ring; a blur discards it", () => {
        const open = run(initialSheetState(), [key("b"), { t: "editor.change", val: "bad" }]).state;
        const stuck = run(open, [ekey("Enter")]);
        expect(stuck.state.edit).toMatchObject({ val: "bad", err: true });
        expect(stuck.effects.some((e) => e.t === "write")).toBe(false);
        const dropped = run(open, [{ t: "editor.blur" }]);
        expect(dropped.state.edit).toBeNull();
        expect(dropped.effects.some((e) => e.t === "write")).toBe(false);
    });

    test("esc cancels and refocuses the sheet; an empty buffer commits a blank", () => {
        const open = run(initialSheetState(), [key("x")]).state;
        const cancelled = run(open, [ekey("Escape")]);
        expect(cancelled.state.edit).toBeNull();
        expect(cancelled.effects).toContainEqual({ t: "focus.sheet" });
        const blank = run(open, [{ t: "editor.change", val: "" }, ekey("Enter")]);
        expect(blank.effects).toContainEqual({ t: "write", r: 0, c: 0, cell: null, text: "" });
    });

    test("⇥ takes the ghost before it commits; ⌥] cycles the armed candidate", () => {
        const open = run(initialSheetState(), [key("t"), { t: "editor.change", val: "tr" }]).state;
        // The ghost's suffix joins the typed prefix as typed; the commit's parse resolves the case.
        const took = run(open, [ekey("Tab")]);
        expect(took.state.edit).toMatchObject({ val: "transfer" });
        const cycled = run(open, [ekey("]", { alt: true })]);
        expect(cycled.state.edit).toMatchObject({ hi: 1 });
        // A commit with the second candidate armed writes it.
        const committed = run(cycled.state, [ekey("Enter")]);
        expect(committed.effects).toContainEqual({ t: "write", r: 0, c: 0, cell: cell("String", "Transfer - Annex"), text: "Transfer - Annex" });
    });

    test("a click elsewhere commits in place and moves; a strip pick replaces the buffer", () => {
        const open = run(initialSheetState(), [key("x")]).state;
        const clicked = run(open, [{ t: "cell.down", r: 2, c: 1, shift: false }]);
        expect(clicked.state.edit).toBeNull();
        expect(clicked.state.sel).toEqual({ r: 2, c: 1 });
        expect(clicked.effects).toContainEqual({ t: "write", r: 0, c: 0, cell: cell("String", "x"), text: "x" });
        const picked = run(open, [{ t: "strip.pick", label: "Transfer", i: 0 }]);
        expect(picked.state.edit).toMatchObject({ val: "Transfer", hi: 0 });
    });
});

describe("rows", () => {
    test("whole rows selected + ⌫ deletes them; ⌫ on cells clears; ⌘⌫ deletes the rect's rows", () => {
        const picked = run(initialSheetState(), [{ t: "row.pick", r: 1, shift: false }, { t: "row.pick", r: 2, shift: true }]);
        expect(picked.state.sel).toEqual({ r: 1, c: 0 });
        expect(picked.state.selEnd).toEqual({ r: 2, c: 2 });
        const deleted = run(picked.state, [key("Backspace")]);
        expect(deleted.effects).toContainEqual({ t: "delete.rows", r0: 1, r1: 2 });
        expect(deleted.state.selEnd).toBeNull();
        const cleared = run(initialSheetState(), [key("ArrowRight", { shift: true }), key("Delete")]);
        expect(cleared.effects).toContainEqual({ t: "clear", r0: 0, r1: 0, c0: 0, c1: 1 });
        const meta = run(initialSheetState({ r: 2, c: 1 }), [key("Delete", { meta: true })]);
        expect(meta.effects).toContainEqual({ t: "delete.rows", r0: 2, r1: 2 });
    });

    test("a controlled move follows without an echo; a shrink clamps the ring and drops a stranded editor", () => {
        const set = run(initialSheetState(), [{ t: "select.set", r: 2, c: 1 }]);
        expect(set.state.sel).toEqual({ r: 2, c: 1 });
        expect(set.effects.some((e) => e.t === "emit.select")).toBe(false);
        const open = run(initialSheetState({ r: 3, c: 0 }), [key("x")]).state;
        const shrunk = run(open, [{ t: "rows.changed" }], ctxOf({ rowCount: 2 }));
        expect(shrunk.state.sel).toEqual({ r: 1, c: 0 });
        expect(shrunk.state.edit).toBeNull();
    });
});

describe("the store", () => {
    test("effects ride the returned store and bump the sequence; a no-op keeps identity", () => {
        const ctx = ctxOf();
        const s0 = initialSheetStore();
        const s1 = sheetStoreReducer(s0, { t: "event", e: key("ArrowDown"), ctx });
        expect(s1.fxSeq).toBe(1);
        expect(s1.fx.map((e) => e.t)).toEqual(["emit.select", "scroll.to"]);
        const s2 = sheetStoreReducer(s1, { t: "event", e: key("Escape"), ctx });
        expect(s2).toBe(s1);
        const s3 = sheetStoreReducer(s2, { t: "patch", patch: { msg: "hi" } });
        expect(s3.ui.msg).toBe("hi");
        expect(s3.fxSeq).toBe(1);
    });
});
