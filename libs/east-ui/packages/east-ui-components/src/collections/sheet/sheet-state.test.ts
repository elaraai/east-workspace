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
        candidates: (_r, _c, text) => (text.startsWith("ma") ? ["Machining", "Machining - Roughing"] : []),
        candidateAt: (_r, _c, text, hi) => (text.startsWith("ma") ? (hi > 0 ? "Machining - Roughing" : "Machining") : undefined),
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
        const open = run(initialSheetState(), [key("m"), { t: "editor.change", val: "ma" }]).state;
        // The ghost's suffix joins the typed prefix as typed; the commit's parse resolves the case.
        const took = run(open, [ekey("Tab")]);
        expect(took.state.edit).toMatchObject({ val: "machining" });
        const cycled = run(open, [ekey("]", { alt: true })]);
        expect(cycled.state.edit).toMatchObject({ hi: 1 });
        // A commit with the second candidate armed writes it.
        const committed = run(cycled.state, [ekey("Enter")]);
        expect(committed.effects).toContainEqual({ t: "write", r: 0, c: 0, cell: cell("String", "Machining - Roughing"), text: "Machining - Roughing" });
    });

    test("a click elsewhere commits in place and moves; a strip pick replaces the buffer", () => {
        const open = run(initialSheetState(), [key("x")]).state;
        const clicked = run(open, [{ t: "cell.down", r: 2, c: 1, shift: false }]);
        expect(clicked.state.edit).toBeNull();
        expect(clicked.state.sel).toEqual({ r: 2, c: 1 });
        expect(clicked.effects).toContainEqual({ t: "write", r: 0, c: 0, cell: cell("String", "x"), text: "x" });
        const picked = run(open, [{ t: "strip.pick", label: "Machining", i: 0 }]);
        expect(picked.state.edit).toMatchObject({ val: "Machining", hi: 0 });
    });

    test("a click never scrolls — the cell is under the pointer; a keyboard move does", () => {
        const clicked = run(initialSheetState(), [{ t: "cell.down", r: 2, c: 1, shift: false }]);
        expect(clicked.effects.map((e) => e.t)).toEqual(["emit.select", "focus.sheet"]);
        expect(run(initialSheetState(), [key("ArrowDown")]).effects.map((e) => e.t)).toEqual(["emit.select", "scroll.to"]);
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

// ── The link editor (B§4.4 — Sheet Spec §5 row 7) ─────────────────────────

import type { LinkEditCtx, LinkGroups } from "./sheet-state.js";
import type { LinkCandidate } from "./link/predict.js";
import type { SheetMemberValue } from "./values.js";

const id = (key: string): SheetMemberValue => ({ type: "identified", value: { key } }) as SheetMemberValue;
const txt = (s: string): SheetMemberValue => ({ type: "text", value: s }) as SheetMemberValue;
const KEYS = ["M2140", "M2141", "M2145", "M7301"];

/** A link column at c = 0 over four machine codes, with the driver's sides. */
function linkCtxOf(sides: "both" | "from" | "to" | "in", initial: LinkGroups = [[], []]): SheetMachineCtx {
    const halves = {
        from: { live: sides === "both" || sides === "from", lock: sides === "both" || sides === "from" ? "" : sides === "in" ? "in place" : "external" },
        to: { live: sides !== "from", lock: sides !== "from" ? "" : "external" },
        isIn: sides === "in",
        sides,
    };
    const candidates = (text: string, groups: LinkGroups): LinkCandidate[] => {
        const used = new Set([...groups[0], ...groups[1]].map((m) => (m.type === "identified" ? (m.value as { key: string }).key : "")));
        const t = text.trim().toLowerCase();
        if (t === "") return [];
        return KEYS.filter((k) => !used.has(k) && k.toLowerCase().startsWith(t)).map((k) => ({ label: k, meta: "", members: [id(k)] }));
    };
    const resolve = (text: string, cand: LinkCandidate | undefined): SheetMemberValue[] => {
        if (cand !== undefined && cand.label.toLowerCase().startsWith(text.trim().toLowerCase())) return cand.members;
        return text.split(",").map((x) => x.trim()).filter((x) => x !== "").map((x) => (KEYS.includes(x.toUpperCase()) ? id(x.toUpperCase()) : txt(x)));
    };
    const link: LinkEditCtx = {
        halves,
        initial,
        candidates,
        candidateAt: (text, hi, groups) => { const l = candidates(text, groups); return l.length === 0 ? undefined : l[Math.min(Math.max(hi, 0), l.length - 1)]; },
        resolve,
        predicted: () => [],
        cell: (groups) => (groups[0].length + groups[1].length === 0 ? null : cell("Link", { from: groups[0], to: groups[1] })),
        driverName: "Machining",
    };
    return ctxOf({
        colCount: 2,
        kindAt: (c) => (c === 0 ? "link" : "text"),
        linkAt: (_r, c) => (c === 0 ? link : undefined),
    });
}

const labels = (g: readonly SheetMemberValue[]) => g.map((m) => (m.type === "identified" ? (m.value as { key: string }).key : m.type === "text" ? `~${m.value as string}` : m.type));

describe("the link editor", () => {
    test("opens with the cell's chips, the caret in the first live empty half; a seed replaces the content", () => {
        const ctx = linkCtxOf("both", [[id("M2140")], []]);
        const opened = run(initialSheetState(), [key("Enter")], ctx);
        expect(opened.state.edit?.link).toMatchObject({ side: 1, chipSel: null });
        expect(labels(opened.state.edit!.link!.groups[0])).toEqual(["M2140"]);
        expect(opened.effects).toContainEqual({ t: "focus.editor", selectAll: false });
        const seeded = run(initialSheetState(), [key("m")], ctx);
        expect(seeded.state.edit?.link?.groups).toEqual([[], []]);
        expect(seeded.state.edit?.link?.side).toBe(0);
        // A destination-only driver opens in To; an in-place one too.
        expect(run(initialSheetState(), [key("Enter")], linkCtxOf("to")).state.edit?.link?.side).toBe(1);
        expect(run(initialSheetState(), [key("Enter")], linkCtxOf("in")).state.edit?.link?.side).toBe(1);
    });

    test("`,` resolves the buffer; `>` hops From → To; in To an arrow is dropped; hopping into a locked half flags", () => {
        const ctx = linkCtxOf("both");
        const typed = run(initialSheetState(), [key("m"), { t: "editor.change", val: "m2140, m7301 > m21" }], ctx);
        const link = typed.state.edit!.link!;
        expect(labels(link.groups[0])).toEqual(["M2140", "M7301"]);
        expect(link.side).toBe(1);
        expect(typed.state.edit!.val).toBe("m21");
        expect(link.hop).toBe(1);
        expect(typed.effects.filter((e) => e.t === "focus.editor")).toHaveLength(2);   // the seed, then the hop
        const arrowInTo = run(typed.state, [{ t: "editor.change", val: "m21 > " }], ctx);
        expect(arrowInTo.state.edit!.link!.side).toBe(1);
        expect(labels(arrowInTo.state.edit!.link!.groups[1])).toEqual(["M2141"]);   // `m21` resolved to its top FREE candidate — M2140 is already in From
        const locked = run(initialSheetState(), [key("m"), { t: "editor.change", val: "M2140 >" }], linkCtxOf("from"));
        expect(locked.state.edit!.link!.side).toBe(1);
        expect(locked.state.msg).toMatch(/has no destination — kept, but flagged/);
    });

    test("⇥ ladder: the armed candidate → a hop (a locked half skipped) → commit right", () => {
        const ctx = linkCtxOf("both");
        const open = run(initialSheetState(), [key("m"), { t: "editor.change", val: "m21" }], ctx).state;
        const took = run(open, [ekey("Tab")], ctx);
        expect(took.state.edit!.val).toBe("M2140");
        const hopped = run(took.state, [ekey("Tab")], ctx);
        expect(hopped.state.edit!.link!.side).toBe(1);
        expect(labels(hopped.state.edit!.link!.groups[0])).toEqual(["M2140"]);
        expect(hopped.state.edit!.val).toBe("");
        const committed = run(hopped.state, [{ t: "editor.change", val: "M7301" }, ekey("Tab")], ctx);
        expect(committed.state.edit).toBeNull();
        expect(committed.state.sel).toEqual({ r: 0, c: 1 });
        expect(committed.effects).toContainEqual({ t: "write", r: 0, c: 0, cell: cell("Link", { from: [id("M2140")], to: [id("M7301")] }), text: "" });
        // From-only driver: Tab in From commits right instead of hopping into the locked To.
        const fromOnly = run(initialSheetState(), [key("M"), { t: "editor.change", val: "M2140" }, ekey("Tab")], linkCtxOf("from"));
        expect(fromOnly.state.edit).toBeNull();
        expect(fromOnly.state.sel.c).toBe(1);
        // ⇧⇥ in To hops back to From.
        const back = run(hopped.state, [ekey("Tab", { shift: true })], ctx);
        expect(back.state.edit!.link!.side).toBe(0);
    });

    test("⏎ with text resolves and stays; ⏎ empty commits down; esc cancels; blur commits", () => {
        const ctx = linkCtxOf("both");
        const open = run(initialSheetState(), [key("m"), { t: "editor.change", val: "m2140, mystery" }], ctx).state;
        const resolved = run(open, [ekey("Enter")], ctx);
        expect(labels(resolved.state.edit!.link!.groups[0])).toEqual(["M2140", "~mystery"]);
        expect(resolved.state.edit!.val).toBe("");
        const down = run(resolved.state, [ekey("Enter")], ctx);
        expect(down.state.edit).toBeNull();
        expect(down.state.sel).toEqual({ r: 1, c: 0 });
        expect(down.effects.some((e) => e.t === "write")).toBe(true);
        expect(run(resolved.state, [ekey("Escape")], ctx).state.edit).toBeNull();
        const blurred = run(resolved.state, [{ t: "editor.blur" }], ctx);
        expect(blurred.state.edit).toBeNull();
        expect(blurred.effects).toContainEqual({ t: "write", r: 0, c: 0, cell: cell("Link", { from: [id("M2140"), txt("mystery")], to: [] }), text: "" });
    });

    test("⌫ pops the last chip back into the buffer, then crosses back to From; an empty link commits a blank", () => {
        const ctx = linkCtxOf("both", [[id("M2140")], [id("M7301")]]);
        const open = run(initialSheetState(), [key("Enter")], ctx).state;   // opens in To (the first live EMPTY half is none ⇒ destination)
        expect(open.edit!.link!.side).toBe(1);
        const popped = run(open, [ekey("Backspace")], ctx);
        expect(popped.state.edit!.val).toBe("M7301");
        expect(popped.state.edit!.link!.groups[1]).toEqual([]);
        const crossed = run(popped.state, [{ t: "editor.change", val: "" }, ekey("Backspace")], ctx);
        expect(crossed.state.edit!.link!.side).toBe(0);
        const emptied = run(crossed.state, [ekey("Backspace"), { t: "editor.change", val: "" }, ekey("Enter")], ctx);
        expect(emptied.effects).toContainEqual({ t: "write", r: 0, c: 0, cell: null, text: "" });
    });

    test("⇧← / ⇧→ select whole chips; ⌫ removes them; esc drops the selection first", () => {
        const ctx = linkCtxOf("both", [[id("M2140"), id("M2141")], [id("M7301")]]);
        const open = run(initialSheetState(), [key("Enter")], ctx).state;
        const one = run(open, [ekey("ArrowLeft", { shift: true })], ctx);
        expect(one.state.edit!.link!.chipSel).toEqual({ anchor: 2, focus: 2 });
        const two = run(one.state, [ekey("ArrowLeft", { shift: true })], ctx);
        expect(two.state.edit!.link!.chipSel).toEqual({ anchor: 2, focus: 1 });
        const dropped = run(two.state, [ekey("Escape")], ctx);
        expect(dropped.state.edit!.link!.chipSel).toBeNull();
        expect(dropped.state.edit).not.toBeNull();
        const removed = run(two.state, [ekey("Backspace")], ctx);
        expect(labels(removed.state.edit!.link!.groups[0])).toEqual(["M2140"]);
        expect(removed.state.edit!.link!.groups[1]).toEqual([]);
        expect(removed.state.msg).toBe("2 members removed");
        const shrunk = run(one.state, [ekey("ArrowRight", { shift: true })], ctx);
        expect(shrunk.state.edit!.link!.chipSel).toBeNull();
    });

    test("arrows at the edge of an empty buffer cross the divider; a click in a half moves the caret; a strip chip adds members", () => {
        const ctx = linkCtxOf("both");
        const open = run(initialSheetState(), [key("Enter")], ctx).state;
        expect(open.edit!.link!.side).toBe(0);
        const right = run(open, [ekey("ArrowRight")], ctx);
        expect(right.state.edit!.link!.side).toBe(1);
        const left = run(right.state, [ekey("ArrowLeft")], ctx);
        expect(left.state.edit!.link!.side).toBe(0);
        const clicked = run(left.state, [{ t: "half.down", side: 1 }], ctx);
        expect(clicked.state.edit!.link!.side).toBe(1);
        expect(clicked.effects).toContainEqual({ t: "focus.editor", selectAll: false });
        const picked = run(clicked.state, [{ t: "strip.pick", label: "M2145", i: -1, members: [id("M2145")] }], ctx);
        expect(labels(picked.state.edit!.link!.groups[1])).toEqual(["M2145"]);
        expect(picked.state.edit!.val).toBe("");
        // → at the end of the buffer takes one ghost word.
        const ghosted = run(picked.state, [{ t: "editor.change", val: "m7" }, ekey("ArrowRight", { atEnd: true })], ctx);
        expect(ghosted.state.edit!.val).toBe("m7301");
    });
});

// ── The copilot (B§5 / B§6 — Sheet Spec §5 rows 10–13) ────────────────────

import type { PendingFill, PendingRow, Suggestions } from "./sheet-state.js";

/** Three real rows a · b · c and a blank at position 3; columns activity (the driver) · start · qty. */
function suggestCtxOf(over: Partial<SheetMachineCtx> = {}): SheetMachineCtx {
    const ids: Record<string, number> = { a: 0, b: 1, c: 2, " blank:3": 3 };
    const cols: Record<string, number> = { activity: 0, start: 1, qty: 2 };
    return ctxOf({
        colCount: 3,
        kindAt: (c) => (c === 0 ? "lookup" : c === 1 ? "date" : "quantity"),
        editableAt: () => true,
        rowOf: (id) => ids[id],
        idAt: (r) => ["a", "b", "c", " blank:3"][r],
        columnOf: (k) => cols[k],
        driverKeyAt: (r) => (r === 1 ? "Machining" : undefined),
        driverColumn: "activity",
        numberAt: (r) => r + 1,
        ...over,
    });
}
const fillOf = (c: SheetCellValue, meta = "", index = 0): PendingFill => ({ cell: c, meta, index });
const suggOn = (anchorId: string, fill: Record<string, PendingFill>, rows: PendingRow[] = [], pending: string[] = []): Suggestions =>
    ({ anchorId, fill: new Map(Object.entries(fill)), rows, pending });
const proposal = (activity: string, meta = "pattern"): PendingRow => ({ cells: new Map([["activity", cell("String", activity)]]), meta });
const START = fillOf(cell("DateTime", new Date("2026-02-23T00:00:00Z")), "week after a");
const QTY = fillOf(cell("Float", 1200), "like a", 1);

describe("the copilot", () => {
    test("the runner's result lands for an anchor on the sheet; ⇥ arms the next target, ⇥ again writes it and arms the following; ⇧⇥ walks back", () => {
        const ctx = suggestCtxOf();
        const at = initialSheetState({ r: 1, c: 0 });
        const ready = run(at, [{ t: "suggest.ready", anchorId: "b", sugg: suggOn("b", { start: START, qty: QTY }) }], ctx);
        expect(ready.state.sugg?.fill.size).toBe(2);
        // A result for an anchor that left the sheet is ignored.
        expect(run(at, [{ t: "suggest.ready", anchorId: "zzz", sugg: suggOn("zzz", { start: START }) }], ctx).state.sugg).toBeNull();
        const armed = run(ready.state, [key("Tab")], ctx);
        expect(armed.state.sel).toEqual({ r: 1, c: 1 });
        expect(armed.state.armed).toEqual({ r: 1, c: 1 });
        expect(armed.effects.some((e) => e.t === "write.many")).toBe(false);
        const took = run(armed.state, [key("Tab")], ctx);
        expect(took.effects).toContainEqual({ t: "write.many", r: 1, writes: [{ c: 1, cell: START.cell }], source: "fill" });
        expect(took.state.msg).toBe("Took start — week after a");
        expect(took.state.sel).toEqual({ r: 1, c: 2 });
        expect(took.state.armed).toEqual({ r: 1, c: 2 });
        expect(took.state.sugg?.fill.has("start")).toBe(false);
        const last = run(took.state, [key("Tab")], ctx);
        expect(last.effects).toContainEqual({ t: "write.many", r: 1, writes: [{ c: 2, cell: QTY.cell }], source: "fill" });
        expect(last.state.sugg).toBeNull();
        expect(last.state.armed).toBeNull();
        // ⇧⇥ arms the last fill first.
        expect(run(ready.state, [key("Tab", { shift: true })], ctx).state.armed).toEqual({ r: 1, c: 2 });
        // A strip chip or the ✓ button takes a named fill.
        const clicked = run(ready.state, [{ t: "fill.take", key: "qty" }], ctx);
        expect(clicked.effects).toContainEqual({ t: "write.many", r: 1, writes: [{ c: 2, cell: QTY.cell }], source: "fill" });
    });

    test("⏎ takes the row fill, then the first proposal; ⌘⏎ fills the row; ⌘⇧⏎ takes everything; the gutter's → fills the row", () => {
        const ctx = suggestCtxOf();
        const at = initialSheetState({ r: 1, c: 0 });
        const both = run(at, [{ t: "suggest.ready", anchorId: "b", sugg: suggOn("b", { start: START, qty: QTY }, [proposal("Painting"), proposal("Packaging")]) }], ctx).state;
        const filled = run(both, [key("Enter")], ctx);
        expect(filled.effects).toContainEqual({ t: "write.many", r: 1, writes: [{ c: 1, cell: START.cell }, { c: 2, cell: QTY.cell }], source: "row" });
        expect(filled.state.msg).toBe("Filled 2 cells on row 2");
        expect(filled.state.sugg?.rows).toHaveLength(2);
        expect(filled.state.edit).toBeNull();
        const took = run(filled.state, [key("Enter")], ctx);
        expect(took.effects).toContainEqual({ t: "insert.rows", anchorR: 1, rows: [proposal("Painting")], rest: [proposal("Packaging")] });
        expect(took.state.msg).toBe("Took Painting — next one suggested below");
        expect(took.state.sugg).toBeNull();
        // With nothing pending ⏎ edits.
        expect(run(took.state, [key("Enter")], ctx).state.edit).not.toBeNull();
        expect(run(both, [key("Enter", { meta: true })], ctx).effects.map((e) => e.t)).toEqual(["write.many"]);
        const all = run(both, [key("Enter", { meta: true, shift: true })], ctx);
        expect(all.effects.map((e) => e.t)).toEqual(["write.many", "insert.rows"]);
        expect((all.effects[1] as { rows: PendingRow[]; rest: PendingRow[] }).rows).toHaveLength(2);
        expect((all.effects[1] as { rest: PendingRow[] }).rest).toEqual([]);
        expect(run(both, [{ t: "fill.row" }], ctx).effects[0]).toMatchObject({ t: "write.many", source: "row" });
        // Rows only: ⇥ takes the next one.
        const rowsOnly = run(at, [{ t: "suggest.ready", anchorId: "b", sugg: suggOn("b", {}, [proposal("Painting")]) }], ctx).state;
        expect(run(rowsOnly, [key("Tab")], ctx).effects[0]).toMatchObject({ t: "insert.rows", rows: [proposal("Painting")], rest: [] });
    });

    test("the esc ladder: a selected proposal → the row fill (rows stay) → every suggestion → the range", () => {
        const ctx = suggestCtxOf();
        const at = { ...initialSheetState({ r: 1, c: 0 }), selEnd: { r: 1, c: 2 } };
        const both = run(at, [{ t: "suggest.ready", anchorId: "b", sugg: suggOn("b", { start: START }, [proposal("Painting"), proposal("Packaging")]) }], ctx).state;
        const picked = run(both, [{ t: "proposal.pick", i: 1 }], ctx);
        expect(picked.state.gsel).toBe(1);
        expect(picked.effects).toContainEqual({ t: "focus.sheet" });
        const one = run(picked.state, [key("Escape")], ctx);
        expect(one.state.gsel).toBeNull();
        expect(one.state.msg).toBe("Deselected — esc again dismisses every suggestion");
        const two = run(one.state, [key("Escape")], ctx);
        expect(two.state.sugg?.fill.size).toBe(0);
        expect(two.state.sugg?.rows).toHaveLength(2);
        expect(two.state.msg).toBe("Row fill dismissed — esc again for the suggested rows");
        const three = run(two.state, [key("Escape")], ctx);
        expect(three.state.sugg).toBeNull();
        expect(three.state.selEnd).toBeNull();
        // Arrows drop the proposal selection; a click on a cell too.
        expect(run(picked.state, [key("ArrowDown")], ctx).state.gsel).toBeNull();
        expect(run(picked.state, [{ t: "cell.down", r: 0, c: 0, shift: false }], ctx).state.gsel).toBeNull();
    });

    test("⌫ rejects the armed fill and remembers it per row and key; ⌫ rejects the selected proposal and remembers the pairing", () => {
        const ctx = suggestCtxOf();
        const at = initialSheetState({ r: 1, c: 0 });
        const both = run(at, [{ t: "suggest.ready", anchorId: "b", sugg: suggOn("b", { start: START, qty: QTY }, [proposal("Painting")]) }], ctx).state;
        const armed = run(both, [key("Tab")], ctx).state;
        const dismissed = run(armed, [key("Backspace")], ctx);
        expect(dismissed.effects.some((e) => e.t === "clear" || e.t === "write.many")).toBe(false);
        expect(dismissed.state.rejected.fills.has("b|start")).toBe(true);
        expect(dismissed.state.sugg?.fill.has("start")).toBe(false);
        expect(dismissed.state.armed).toBeNull();
        expect(dismissed.state.msg).toBe("Dismissed — start will not be suggested again on this row");
        // ⌫ with nothing armed clears the cells as before.
        expect(run(both, [key("Backspace")], ctx).effects).toContainEqual({ t: "clear", r0: 1, r1: 1, c0: 0, c1: 0 });
        const picked = run(both, [{ t: "proposal.pick", i: 0 }], ctx).state;
        const rejected = run(picked, [key("Delete")], ctx);
        expect(rejected.state.rejected.follows.has("Machining>Painting")).toBe(true);
        expect(rejected.state.sugg?.rows).toEqual([]);
        expect(rejected.state.gsel).toBeNull();
        expect(rejected.state.msg).toBe("Rejected — Painting will not be suggested after Machining again");
        // The × button on a proposal row does the same without a selection.
        expect(run(both, [{ t: "proposal.reject", i: 0 }], ctx).state.rejected.follows.has("Machining>Painting")).toBe(true);
    });

    test("an async settlement merges by anchor and key — an earlier provider outranks, a stale anchor is ignored, a dismissed fill stays dismissed; a rekey follows a blank anchor; a vanished anchor drops everything", () => {
        const ctx = suggestCtxOf();
        const at = initialSheetState({ r: 1, c: 0 });
        const pending = run(at, [{ t: "suggest.ready", anchorId: "b", sugg: suggOn("b", { qty: QTY }, [], ["qty", "rows"]) }], ctx).state;
        const earlier = fillOf(cell("Float", 1), "the model", 0);
        const landed = run(pending, [{ t: "suggest.landed", anchorId: "b", key: "qty", fill: earlier }], ctx);
        expect(landed.state.sugg?.fill.get("qty")).toEqual(earlier);
        expect(landed.state.sugg?.pending).toEqual(["rows"]);
        const laterOne = run(pending, [{ t: "suggest.landed", anchorId: "b", key: "qty", fill: fillOf(cell("Float", 9), "late", 5) }], ctx);
        expect(laterOne.state.sugg?.fill.get("qty")).toEqual(QTY);
        expect(run(pending, [{ t: "suggest.landed", anchorId: "zzz", key: "qty", fill: earlier }], ctx).state).toBe(pending);
        expect(run(pending, [{ t: "suggest.landed", anchorId: "b", key: "notes", fill: earlier }], ctx).state).toBe(pending);
        const rows = run(landed.state, [{ t: "suggest.landed", anchorId: "b", key: "rows", rows: [proposal("Painting", "model")] }], ctx);
        expect(rows.state.sugg?.rows).toEqual([proposal("Painting", "model")]);
        expect(rows.state.sugg?.pending).toEqual([]);
        // A settlement that yields nothing just clears the pending chip; everything gone ⇒ no suggestions.
        const bare = run(at, [{ t: "suggest.ready", anchorId: "b", sugg: suggOn("b", {}, [], ["qty"]) }, { t: "suggest.landed", anchorId: "b", key: "qty", fill: null }], ctx);
        expect(bare.state.sugg).toBeNull();
        // Dismissed stays dismissed.
        const dismissedFirst = { ...pending, rejected: { fills: new Set(["b|qty"]), follows: new Set<string>() } };
        expect(run(dismissedFirst, [{ t: "suggest.landed", anchorId: "b", key: "qty", fill: earlier }], ctx).state.sugg?.fill.get("qty")).toEqual(QTY);
        // A blank anchor becomes real: the suggestions follow its id.
        const blank = run(initialSheetState({ r: 3, c: 0 }), [{ t: "suggest.ready", anchorId: " blank:3", sugg: suggOn(" blank:3", { start: START }) }], ctx).state;
        expect(run(blank, [{ t: "suggest.rekey", from: " blank:3", to: "d" }], ctx).state.sugg?.anchorId).toBe("d");
        // The anchor leaves the sheet: the suggestions go with it.
        const gone = run(landed.state, [{ t: "rows.changed" }], suggestCtxOf({ rowOf: () => undefined }));
        expect(gone.state.sugg).toBeNull();
        expect(run(at, [{ t: "suggest.ready", anchorId: "b", sugg: suggOn("b", { qty: QTY }) }, { t: "suggest.clear" }], ctx).state.sugg).toBeNull();
    });

    test("typing keeps the suggestions but drops the armed target; a commit re-asks nothing itself (the component does); a paste drops them", () => {
        const ctx = suggestCtxOf();
        const at = initialSheetState({ r: 1, c: 0 });
        const armed = run(at, [{ t: "suggest.ready", anchorId: "b", sugg: suggOn("b", { start: START }) }, key("Tab")], ctx).state;
        const typing = run(armed, [key("x")], ctx);
        expect(typing.state.sugg?.fill.size).toBe(1);
        expect(typing.state.armed).toBeNull();
        expect(typing.effects).toContainEqual({ t: "schedule.suggest", latency: "idle" });
        // ⌘⏎ in the editor commits in place and takes the row fill.
        const filled = run(typing.state, [ekey("Enter", { meta: true })], ctx);
        expect(filled.effects.map((e) => e.t)).toEqual(["write", "focus.sheet", "write.many"]);
        expect(filled.state.edit).toBeNull();
        expect(run(armed, [{ t: "clipboard.paste", text: "a\tb" }], ctx).state.sugg).toBeNull();
    });
});

// ── The lens and the view tabs (B§8 — Sheet Spec §5 rows 16–17) ─────────────

import { none, some } from "@elaraai/east";
import type { SliceStateValue } from "./sheet-state.js";
import type { SheetViewValue } from "./values.js";

const narrowingOf = (search: string | undefined): SliceStateValue => ({
    range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
    breakdown: none, search: search === undefined ? none : some(search), visible: none, selectedIndex: none, resolution: none,
} as SliceStateValue);
const EMPTY = narrowingOf(undefined);
const PAINT = narrowingOf("paint");
const LATHE = narrowingOf("lathe");
const view = (id: string, name: string, narrowing: SliceStateValue, context = 0n, reveals: bigint[] = []): SheetViewValue => ({ id, name, narrowing, context, reveals });
const VIEWS = [view("paint", "PAINT", PAINT, 1n, [4n]), view("lathe", "LATHE", LATHE)];

/** A sheet on the PAINT tab, the slice at `narrowing`, the views as given. */
function lensCtxOf(narrowing: SliceStateValue, views: readonly SheetViewValue[] = VIEWS, dirty = false, over: Partial<SheetMachineCtx> = {}): SheetMachineCtx {
    return ctxOf({ rowCount: 6, lensActive: true, views, narrowing, emptyNarrowing: EMPTY, dirty, ...over });
}
const onPaint = (): SheetUiState => ({ ...initialSheetState({ r: 3, c: 1 }, "paint"), lens: { context: 1, reveals: new Set([4, 5]), steps: new Map([["a_b:top", 2]]) } });
const viewsOf = (t: { effects: SheetEffect[] }): SheetViewValue[] | undefined => (t.effects.find((e) => e.t === "emit.views") as { views: SheetViewValue[] } | undefined)?.views;
const written = (t: { effects: SheetEffect[] }): SliceStateValue | undefined => (t.effects.find((e) => e.t === "slice.write") as { state: SliceStateValue } | undefined)?.state;

describe("the lens", () => {
    test("band controls reveal positions as a merged set and escalate; the context switch and a narrowing change reset them", () => {
        const ctx = lensCtxOf(PAINT);
        const one = run(initialSheetState(), [{ t: "band.reveal", key: "g", from: 10, to: 19, where: "top" }], ctx);
        expect([...one.state.lens.reveals]).toEqual([10]);
        expect(one.state.lens.steps.get("g:top")).toBe(1);
        const three = run(one.state, [{ t: "band.reveal", key: "g", from: 11, to: 19, where: "top" }], ctx);
        expect([...three.state.lens.reveals]).toEqual([10, 11, 12, 13]);
        const other = run(three.state, [{ t: "band.reveal", key: "h", from: 30, to: 31, where: "all" }], ctx);
        expect([...other.state.lens.reveals]).toEqual([10, 11, 12, 13, 30, 31]);
        const switched = run(other.state, [{ t: "lens.context", context: 3 }], ctx);
        expect(switched.state.lens).toEqual({ context: 3, reveals: new Set(), steps: new Map() });
        const ranged = { ...other.state, sel: { r: 4, c: 2 }, selEnd: { r: 5, c: 2 } };
        const narrowed = run(ranged, [{ t: "lens.narrowed" }], ctx);
        expect(narrowed.state.lens.reveals.size).toBe(0);
        expect(narrowed.state.lens.context).toBe(0);
        expect(narrowed.state.sel).toEqual({ r: 0, c: 2 });
        expect(narrowed.state.selEnd).toBeNull();
        expect(narrowed.effects).toContainEqual({ t: "emit.select", r: 0, c: 2 });
        // ⌘/ and ⌘F focus the rail's search whatever the sheet holds.
        expect(run(initialSheetState(), [key("/", { meta: true })], ctx).effects).toEqual([{ t: "focus.search" }]);
        expect(run(initialSheetState(), [key("f", { meta: true })], ctx).effects).toEqual([{ t: "focus.search" }]);
    });
});

describe("the view tabs", () => {
    test("switching persists the leaving tab's context and reveals (never an unsaved query), writes the target's narrowing and restores its lens; the whole sheet writes the empty narrowing", () => {
        // On PAINT with an unsaved query (the slice holds LATHE) and a lens of ±1 with two reveals.
        const ctx = lensCtxOf(LATHE, VIEWS, true);
        const t = run(onPaint(), [{ t: "tab.switch", id: "lathe" }], ctx);
        expect(t.state.tabs.active).toBe("lathe");
        expect(t.state.lens).toEqual({ context: 0, reveals: new Set(), steps: new Map() });
        expect(t.state.sel).toEqual({ r: 0, c: 1 });
        const views = viewsOf(t)!;
        expect(views[0]).toEqual(view("paint", "PAINT", PAINT, 1n, [4n, 5n]));   // context + reveals persisted; the narrowing kept
        expect(written(t)).toBe(LATHE);
        expect(t.effects.map((e) => e.t)).toEqual(["emit.views", "slice.write", "emit.select", "focus.sheet"]);
        // Back to the whole sheet: the empty narrowing, no lens; nothing to persist when nothing moved.
        const whole = run({ ...t.state, sel: { r: 0, c: 1 } }, [{ t: "tab.switch", id: null }], lensCtxOf(LATHE, views));
        expect(whole.state.tabs.active).toBeNull();
        expect(written(whole)).toBe(EMPTY);
        expect(viewsOf(whole)).toBeUndefined();
        // Opening a view (the initial `activeView`) never persists the tab it leaves.
        const opened = run(initialSheetState({ r: 0, c: 0 }, "paint"), [{ t: "tab.open", id: "paint" }], lensCtxOf(EMPTY));
        expect(viewsOf(opened)).toBeUndefined();
        expect(opened.state.lens).toEqual({ context: 1, reveals: new Set([4]), steps: new Map() });
        expect(written(opened)).toBe(PAINT);
        // An unknown tab is ignored.
        expect(run(onPaint(), [{ t: "tab.switch", id: "zzz" }], ctx).state).toEqual(onPaint());
    });

    test("+ TAB snapshots the narrowing, the context and the reveals, named from the query or `view n`; the new tab is active", () => {
        const t = run(onPaint(), [{ t: "tab.create" }], lensCtxOf(LATHE));
        const views = viewsOf(t)!;
        expect(views).toHaveLength(3);
        expect(views[2]).toEqual(view("view-1", "lathe", LATHE, 1n, [4n, 5n]));
        expect(t.state.tabs.active).toBe("view-1");
        expect(t.state.tabs.seq).toBe(2);
        expect(t.state.msg).toMatch(/Saved tab "lathe" — a live view/);
        // No query: `view n`; an id already taken moves on.
        const taken = [...VIEWS, view("view-1", "x", EMPTY)];
        const blank = run(initialSheetState(), [{ t: "tab.create" }], lensCtxOf(EMPTY, taken));
        expect(viewsOf(blank)!.at(-1)).toEqual(view("view-2", "view 2", EMPTY));
        expect(blank.state.msg).toMatch(/no filter/);
        // Without a slice there is nothing to snapshot.
        expect(run(initialSheetState(), [{ t: "tab.create" }]).effects).toEqual([]);
    });

    test("closing the active tab falls back to the sheet with its narrowing cleared; closing another just drops it", () => {
        const active = run(onPaint(), [{ t: "tab.close", id: "paint" }], lensCtxOf(PAINT));
        expect(active.state.tabs.active).toBeNull();
        expect(viewsOf(active)!.map((v) => v.id)).toEqual(["lathe"]);
        expect(written(active)).toBe(EMPTY);
        expect(active.state.msg).toBe('Closed "PAINT" — back to the whole sheet');
        const other = run(onPaint(), [{ t: "tab.close", id: "lathe" }], lensCtxOf(PAINT));
        expect(other.state.tabs.active).toBe("paint");
        expect(viewsOf(other)!.map((v) => v.id)).toEqual(["paint"]);
        expect(written(other)).toBeUndefined();
    });

    test("⏎ in the search updates a dirty tab; esc reverts it; esc on a clean tab returns to the sheet; esc on the sheet clears the search; the sheet's own esc reaches the tabs after the range", () => {
        const dirty = lensCtxOf(LATHE, VIEWS, true);
        const updated = run(onPaint(), [{ t: "search.key", key: "Enter" }], dirty);
        expect(viewsOf(updated)![0]).toEqual(view("paint", "PAINT", LATHE, 1n, [4n, 5n]));
        expect(updated.effects.map((e) => e.t)).toEqual(["emit.views", "focus.sheet"]);
        expect(updated.state.msg).toBe('Tab "PAINT" now saves this search');
        const reverted = run(onPaint(), [{ t: "search.key", key: "Escape" }], dirty);
        expect(written(reverted)).toBe(PAINT);
        expect(reverted.state.lens).toEqual({ context: 1, reveals: new Set([4]), steps: new Map() });
        expect(reverted.state.msg).toBe("Reverted to the tab's saved search");
        const clean = run(onPaint(), [{ t: "search.key", key: "Escape" }], lensCtxOf(PAINT));
        expect(clean.state.tabs.active).toBeNull();
        expect(written(clean)).toBe(EMPTY);
        const sheet = run(initialSheetState(), [{ t: "search.key", key: "Escape" }], lensCtxOf(LATHE));
        expect(written(sheet)).toEqual({ ...LATHE, search: none });
        expect(run(initialSheetState(), [{ t: "search.key", key: "Enter" }], lensCtxOf(EMPTY)).effects).toEqual([{ t: "focus.sheet" }]);
        // The sheet's esc: the range first, then the dirty tab, then the clean tab.
        const ranged = { ...onPaint(), selEnd: { r: 4, c: 1 } };
        const one = run(ranged, [key("Escape")], dirty);
        expect(one.state.selEnd).toBeNull();
        expect(written(one)).toBeUndefined();
        const two = run(one.state, [key("Escape")], dirty);
        expect(written(two)).toBe(PAINT);
        const three = run(two.state, [key("Escape")], lensCtxOf(PAINT));
        expect(three.state.tabs.active).toBeNull();
    });

    test("a double click renames — ⏎ commits a non-empty name, esc cancels; a drop reorders", () => {
        const ctx = lensCtxOf(PAINT);
        const started = run(onPaint(), [{ t: "tab.rename.start", id: "lathe" }, { t: "tab.rename.change", val: "  turning  " }], ctx);
        expect(started.state.tabs).toMatchObject({ renaming: "lathe", renameVal: "  turning  " });
        const committed = run(started.state, [{ t: "tab.rename.commit" }], ctx);
        expect(viewsOf(committed)![1]!.name).toBe("turning");
        expect(committed.state.tabs.renaming).toBeNull();
        const emptied = run(started.state, [{ t: "tab.rename.change", val: " " }, { t: "tab.rename.commit" }], ctx);
        expect(viewsOf(emptied)).toBeUndefined();
        const cancelled = run(started.state, [{ t: "tab.rename.cancel" }], ctx);
        expect(cancelled.state.tabs.renaming).toBeNull();
        expect(viewsOf(run(onPaint(), [{ t: "tab.reorder", id: "lathe", to: 0 }], ctx))!.map((v) => v.id)).toEqual(["lathe", "paint"]);
        expect(viewsOf(run(onPaint(), [{ t: "tab.reorder", id: "paint", to: 2 }], ctx))!.map((v) => v.id)).toEqual(["lathe", "paint"]);
        expect(run(onPaint(), [{ t: "tab.reorder", id: "paint", to: 0 }], ctx).effects).toEqual([]);
    });
});
