/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * THE Sheet state machine (`Sheet Spec.md` §6.1) — every piece of interaction
 * state in one pure reducer: the selection ring and range, the edit buffer,
 * hover, the footer message. No React, no DOM, no East calls: what a
 * transition needs to know about the sheet (row and column counts, which
 * cells are editable, how a buffer parses, the candidates) arrives as a
 * {@link SheetMachineCtx} with the event, and everything that touches data
 * or the host leaves as an effect the component runs.
 *
 * The suggestion lifecycle (P4), the link editor's halves and chip selection
 * (P3) and the lens / tabs (P5) extend this file; the rungs they add to the
 * esc and Tab ladders are marked where they slot in.
 *
 * Non-negotiable transition rules (unit-tested as a table in
 * `sheet-state.test.ts`):
 *
 * - **Esc ladder**, one rung per press: editor → range.
 * - **Commit directions** — Tab right, ⇧Tab left, ⏎ / ↓ down (↓ on the last
 *   row appends unless a lens is active or the source is unexhausted), ↑ /
 *   blur stay; an unparseable value never commits — the editor stays open
 *   with the neg ring, and a blur discards it.
 * - **A printable key seeds a fresh edit**; ⏎ / F2 edit with the value
 *   selected; esc cancels.
 * - **Whole rows selected + ⌫ deletes the records**; ⌫ on cells clears them
 *   (never a stamped column — the component skips those).
 *
 * @packageDocumentation
 */

import { ghostFor, ghostWord, resolveFor } from "./candidates.js";
import type { SheetKind } from "./model.js";
import type { ParseOutcome } from "./parse/index.js";
import type { SheetCellValue } from "./values.js";

/** A cell position in the sheet's ROW space (bands are not rows). */
export interface CellRef {
    r: number;
    c: number;
}

/** The open editor. */
export interface EditBuffer {
    r: number;
    c: number;
    /** The typed text. */
    val: string;
    /** The neg ring — the last commit attempt was unrecognised. */
    err: boolean;
    /** The armed candidate (`-1` = nothing armed — an empty buffer offers a menu, arms nothing). */
    hi: number;
    /** Opened by a printable key — caret at the end, nothing selected. */
    seeded: boolean;
}

/** All ephemeral UI state — one object, one reducer. */
export interface SheetUiState {
    /** The ring. */
    sel: CellRef;
    /** The range's far corner, when a range is active. */
    selEnd: CellRef | null;
    /** The open editor. */
    edit: EditBuffer | null;
    /** The hovered cell (the ✓ take button's home, P4). */
    hover: CellRef | null;
    /** The footer's `aria-live` line. */
    msg: string;
    /** Rows appended past the padding with ↓ on the last row. */
    appended: number;
}

/** A commit direction — where the ring goes after a commit. */
export type CommitDir = "right" | "left" | "down" | "stay" | "blur" | "cancel";

/** Every interaction the surface can report. */
export type SheetEvent =
    | { t: "cell.down"; r: number; c: number; shift: boolean }
    | { t: "cell.dbl"; r: number; c: number }
    | { t: "cell.enter"; r: number; c: number; dragging: boolean }
    | { t: "row.pick"; r: number; shift: boolean }
    | { t: "key"; key: string; shift: boolean; meta: boolean; alt: boolean }
    | { t: "editor.change"; val: string }
    | { t: "editor.key"; key: string; shift: boolean; meta: boolean; alt: boolean; atEnd: boolean }
    | { t: "editor.blur" }
    | { t: "strip.pick"; label: string; i: number }
    /** The controlled `selection` prop moved the ring — no `emit.select` echo. */
    | { t: "select.set"; r: number; c: number }
    /** The rows changed underneath (a new value, a landed window): clamp. */
    | { t: "rows.changed" }
    | { t: "msg"; msg: string }
    | { t: "clipboard.copy" }
    | { t: "clipboard.paste"; text: string };

/** Side effects, returned as data — never performed in the reducer. */
export type SheetEffect =
    /** Write one cell (`null` = blank) — the component turns it into a commit or an insert. */
    | { t: "write"; r: number; c: number; cell: SheetCellValue | null; text: string }
    /** Clear a block of cells (stamped columns skipped by the component). */
    | { t: "clear"; r0: number; r1: number; c0: number; c1: number }
    /** Delete whole rows. */
    | { t: "delete.rows"; r0: number; r1: number }
    /** Copy a block. */
    | { t: "copy"; r0: number; r1: number; c0: number; c1: number }
    /** Paste text at a cell. */
    | { t: "paste"; r: number; c: number; text: string }
    | { t: "focus.sheet" }
    | { t: "focus.editor"; selectAll: boolean }
    /** The ring moved — `onSelect`. */
    | { t: "emit.select"; r: number; c: number }
    /** Bring a row into view. */
    | { t: "scroll.to"; r: number }
    /** Re-ask the copilot after the kind's latency (P4). */
    | { t: "schedule.suggest"; latency: "instant" | "idle" };

/** What a transition may ask about the sheet — supplied with each event. */
export interface SheetMachineCtx {
    /** Rows in row space (real + blank). */
    rowCount: number;
    /** Declared columns. */
    colCount: number;
    /** A lens narrows the sheet — ↓ on the last row must not append. */
    lensActive: boolean;
    /** The inline arm, or an exhausted paged source — ↓ on the last row may append. */
    canAppend: boolean;
    /** Whether the cell may be edited (column editable, not stamped, sheet not read-only, row not owned where that matters). */
    editableAt: (r: number, c: number) => boolean;
    /** The column kind. */
    kindAt: (c: number) => SheetKind;
    /** Parse a buffer for a cell. */
    parse: (r: number, c: number, text: string) => ParseOutcome;
    /** The candidates for a buffer (the entry menu when empty). */
    candidates: (r: number, c: number, text: string) => string[];
    /** The armed candidate for a buffer, if any. */
    candidateAt: (r: number, c: number, text: string, hi: number) => string | undefined;
    /** The cell's edit form. */
    editTextAt: (r: number, c: number) => string;
}

/** The register kinds — where ⌥ cycles candidates and Tab takes the ghost. */
function isRegisterKind(kind: SheetKind): boolean {
    return kind === "lookup" || kind === "reference" || kind === "enum";
}

/** The initial UI state. */
export function initialSheetState(sel: CellRef = { r: 0, c: 0 }): SheetUiState {
    return { sel, selEnd: null, edit: null, hover: null, msg: "", appended: 0 };
}

/** One transition's result. */
export interface Transition {
    state: SheetUiState;
    effects: SheetEffect[];
}

function same(a: CellRef, b: CellRef | null): boolean {
    return b !== null && a.r === b.r && a.c === b.c;
}

/** The selection rectangle. */
export function selectionRect(s: Pick<SheetUiState, "sel" | "selEnd">): { r0: number; r1: number; c0: number; c1: number } {
    const e = s.selEnd ?? s.sel;
    return {
        r0: Math.min(s.sel.r, e.r), r1: Math.max(s.sel.r, e.r),
        c0: Math.min(s.sel.c, e.c), c1: Math.max(s.sel.c, e.c),
    };
}

/** A range spanning every column is a row selection. */
export function wholeRows(s: Pick<SheetUiState, "sel" | "selEnd">, colCount: number): { r0: number; r1: number } | null {
    if (s.selEnd === null) return null;
    const r = selectionRect(s);
    return r.c0 === 0 && r.c1 === colCount - 1 ? { r0: r.r0, r1: r.r1 } : null;
}

/** Clamp a cell to the sheet. */
function clamp(ref: CellRef, ctx: SheetMachineCtx): CellRef {
    return {
        r: Math.max(0, Math.min(Math.max(0, ctx.rowCount - 1), ref.r)),
        c: Math.max(0, Math.min(Math.max(0, ctx.colCount - 1), ref.c)),
    };
}

/** Move the ring to `to`, dropping the range; reports the move. */
function moveTo(s: SheetUiState, to: CellRef, ctx: SheetMachineCtx, effects: SheetEffect[]): SheetUiState {
    const next = clamp(to, ctx);
    if (same(next, s.sel) && s.selEnd === null) return s;
    effects.push({ t: "emit.select", r: next.r, c: next.c }, { t: "scroll.to", r: next.r });
    return { ...s, sel: next, selEnd: null };
}

/** Open the editor on a cell — `seed` is a printable key that starts a fresh edit. */
function startEdit(s: SheetUiState, r: number, c: number, seed: string | undefined, ctx: SheetMachineCtx): Transition {
    if (r < 0 || r >= ctx.rowCount || c < 0 || c >= ctx.colCount) return { state: s, effects: [] };
    if (!ctx.editableAt(r, c)) return { state: s, effects: [] };
    const effects: SheetEffect[] = [];
    const moved = moveTo(s, { r, c }, ctx, effects);
    const val = seed ?? ctx.editTextAt(r, c);
    const edit: EditBuffer = { r, c, val, err: false, hi: seed !== undefined && seed.trim() !== "" ? 0 : -1, seeded: seed !== undefined };
    effects.push({ t: "focus.editor", selectAll: seed === undefined });
    effects.push({ t: "schedule.suggest", latency: "idle" });
    return { state: { ...moved, edit, selEnd: null }, effects };
}

/** The text a register-kind commit takes: the armed candidate when a ghost or an explicit pick applies. */
function commitText(edit: EditBuffer, ctx: SheetMachineCtx): string {
    if (!isRegisterKind(ctx.kindAt(edit.c))) return edit.val;
    const cand = ctx.candidateAt(edit.r, edit.c, edit.val, edit.hi);
    if (cand !== undefined && edit.val.trim() !== "" && (ghostFor(edit.val, cand) !== "" || edit.hi > 0)) return cand;
    return edit.val;
}

/** Commit the open editor in a direction. */
function commitEdit(s: SheetUiState, dir: CommitDir, ctx: SheetMachineCtx): Transition {
    const edit = s.edit;
    if (edit === null) return { state: s, effects: [] };
    if (dir === "cancel") return { state: { ...s, edit: null }, effects: [{ t: "focus.sheet" }] };
    if (edit.r >= ctx.rowCount) return { state: { ...s, edit: null }, effects: [] };
    const text = commitText(edit, ctx);
    const outcome = ctx.parse(edit.r, edit.c, text);
    if (outcome.kind === "unrecognised") {
        // A blur discards; anything else keeps the editor open with the neg ring.
        if (dir === "blur") return { state: { ...s, edit: null }, effects: [] };
        return { state: { ...s, edit: { ...edit, err: true } }, effects: [{ t: "focus.editor", selectAll: false }] };
    }
    const effects: SheetEffect[] = [
        { t: "write", r: edit.r, c: edit.c, cell: outcome.kind === "cell" ? outcome.cell : null, text },
    ];
    let next: SheetUiState = { ...s, edit: null };
    if (dir !== "blur") effects.push({ t: "focus.sheet" });
    next = moveAfterCommit(next, dir, ctx, effects);
    return { state: next, effects };
}

/** Where the ring goes after a commit. */
function moveAfterCommit(s: SheetUiState, dir: CommitDir, ctx: SheetMachineCtx, effects: SheetEffect[]): SheetUiState {
    switch (dir) {
        case "right": return moveTo(s, { r: s.sel.r, c: s.sel.c + 1 }, ctx, effects);
        case "left": return moveTo(s, { r: s.sel.r, c: s.sel.c - 1 }, ctx, effects);
        case "down": return moveDown(s, ctx, effects);
        default: return s;
    }
}

/** ↓ — the last row appends when the sheet allows it (never under a lens). */
function moveDown(s: SheetUiState, ctx: SheetMachineCtx, effects: SheetEffect[]): SheetUiState {
    if (s.sel.r + 1 >= ctx.rowCount) {
        if (ctx.canAppend && !ctx.lensActive) {
            const sel = { r: s.sel.r + 1, c: s.sel.c };
            effects.push({ t: "emit.select", r: sel.r, c: sel.c }, { t: "scroll.to", r: sel.r });
            return { ...s, sel, selEnd: null, appended: s.appended + 1 };
        }
        return s.selEnd === null ? s : { ...s, selEnd: null };
    }
    return moveTo(s, { r: s.sel.r + 1, c: s.sel.c }, ctx, effects);
}

/** The sheet's keyboard (B§6) — no editor open. */
function sheetKey(s: SheetUiState, e: Extract<SheetEvent, { t: "key" }>, ctx: SheetMachineCtx): Transition {
    if (ctx.rowCount === 0 || ctx.colCount === 0) return { state: s, effects: [] };
    const effects: SheetEffect[] = [];
    const move = (dr: number, dc: number): Transition => {
        const base = e.shift && s.selEnd !== null ? s.selEnd : s.sel;
        if (e.shift) {
            const selEnd = clamp({ r: base.r + dr, c: base.c + dc }, ctx);
            return { state: { ...s, selEnd }, effects };
        }
        if (dr === 1) return { state: moveDown(s, ctx, effects), effects };
        return { state: moveTo(s, { r: base.r + dr, c: base.c + dc }, ctx, effects), effects };
    };
    switch (e.key) {
        case "ArrowDown": return move(1, 0);
        case "ArrowUp": return move(-1, 0);
        case "ArrowLeft": return move(0, -1);
        case "ArrowRight": return move(0, 1);
        case "Tab":
            // (P4 slots here: fills pending → arm / write the next target; rows pending → take.)
            return { state: moveTo(s, { r: s.sel.r, c: s.sel.c + (e.shift ? -1 : 1) }, ctx, effects), effects };
        case "Enter":
            if (e.meta) return { state: s, effects };   // ⌘⏎ / ⌘⇧⏎ — the row fill (P4)
            // (P4: a pending suggestion is taken before an edit opens.)
            return startEdit(s, s.sel.r, s.sel.c, undefined, ctx);
        case "F2":
            return startEdit(s, s.sel.r, s.sel.c, undefined, ctx);
        case "Escape":
            // The esc ladder (P4 rungs: row fill → every suggestion) ends at the range.
            return { state: s.selEnd === null ? s : { ...s, selEnd: null }, effects };
        case "Backspace":
        case "Delete": {
            const wr = wholeRows(s, ctx.colCount);
            if (wr !== null || e.meta) {
                const { r0, r1 } = wr ?? selectionRect(s);
                effects.push({ t: "delete.rows", r0, r1 });
                return { state: { ...s, sel: clamp({ r: r0, c: s.sel.c }, ctx), selEnd: null }, effects };
            }
            const rect = selectionRect(s);
            effects.push({ t: "clear", ...rect });
            return { state: s, effects };
        }
        default:
            if (e.key.length === 1 && !e.meta && !e.alt) return startEdit(s, s.sel.r, s.sel.c, e.key, ctx);
            return { state: s, effects };
    }
}

/** The editor's keyboard — scalar cells (the link editor's keys land in P3). */
function editorKey(s: SheetUiState, e: Extract<SheetEvent, { t: "editor.key" }>, ctx: SheetMachineCtx): Transition {
    const edit = s.edit;
    if (edit === null) return { state: s, effects: [] };
    const kind = ctx.kindAt(edit.c);
    if (e.key === "Escape") return commitEdit(s, "cancel", ctx);
    if (isRegisterKind(kind) && e.alt && (e.key === "]" || e.key === "[" || e.key === "ArrowDown" || e.key === "ArrowUp")) {
        const n = ctx.candidates(edit.r, edit.c, edit.val).length;
        if (n > 0) {
            const cur = edit.hi < 0 ? (edit.val.trim() === "" ? -1 : 0) : edit.hi;
            const back = e.key === "[" || e.key === "ArrowUp";
            const hi = cur < 0 ? 0 : (cur + (back ? -1 : 1) + n) % n;
            return { state: { ...s, edit: { ...edit, hi } }, effects: [{ t: "schedule.suggest", latency: "instant" }] };
        }
        return { state: s, effects: [] };
    }
    if (e.key === "Enter") {
        if (e.meta) return commitEdit(s, "stay", ctx);   // ⌘⏎ — commit; the row fill rides in P4
        return commitEdit(s, "down", ctx);
    }
    if (e.key === "Tab") {
        if (!e.shift && isRegisterKind(kind)) {
            const cand = ctx.candidateAt(edit.r, edit.c, edit.val, edit.hi);
            const ghost = ghostFor(edit.val, cand);
            const resolve = resolveFor(edit.val, cand);
            if (ghost !== "" || resolve !== "") {
                return {
                    state: { ...s, edit: { ...edit, val: ghost !== "" ? edit.val + ghost : resolve, err: false } },
                    effects: [{ t: "schedule.suggest", latency: "instant" }],
                };
            }
        }
        return commitEdit(s, e.shift ? "left" : "right", ctx);
    }
    if (e.key === "ArrowDown") return commitEdit(s, "down", ctx);
    if (e.key === "ArrowUp") return commitEdit(s, "stay", ctx);
    if (e.key === "ArrowRight" && e.atEnd && isRegisterKind(kind)) {
        const cand = ctx.candidateAt(edit.r, edit.c, edit.val, edit.hi);
        const ghost = ghostFor(edit.val, cand);
        if (ghost !== "") {
            const take = e.meta ? ghost : ghostWord(ghost);
            return { state: { ...s, edit: { ...edit, val: edit.val + take } }, effects: [] };
        }
    }
    return { state: s, effects: [] };
}

/**
 * The pure transition function: `(state, event, ctx) → { state, effects }`.
 *
 * @param s - The current UI state
 * @param e - The interaction event
 * @param ctx - What the transition may ask about the sheet
 * @returns The next state plus the effects the component must run
 */
export function sheetReducer(s: SheetUiState, e: SheetEvent, ctx: SheetMachineCtx): Transition {
    switch (e.t) {
        case "cell.down": {
            // A click commits an open editor in place first.
            const closed = s.edit !== null ? commitEdit(s, "stay", ctx) : { state: s, effects: [] as SheetEffect[] };
            const effects = closed.effects;
            if (e.shift) {
                return { state: { ...closed.state, selEnd: clamp({ r: e.r, c: e.c }, ctx) }, effects };
            }
            const moved = moveTo(closed.state, { r: e.r, c: e.c }, ctx, effects);
            effects.push({ t: "focus.sheet" });
            return { state: moved, effects };
        }
        case "cell.dbl":
            return startEdit(s, e.r, e.c, undefined, ctx);
        case "cell.enter": {
            if (e.dragging) return { state: { ...s, selEnd: clamp({ r: e.r, c: e.c }, ctx) }, effects: [] };
            if (s.hover !== null && s.hover.r === e.r && s.hover.c === e.c) return { state: s, effects: [] };
            return { state: { ...s, hover: { r: e.r, c: e.c } }, effects: [] };
        }
        case "row.pick": {
            const closed = s.edit !== null ? commitEdit(s, "stay", ctx) : { state: s, effects: [] as SheetEffect[] };
            const effects = closed.effects;
            const last = Math.max(0, ctx.colCount - 1);
            if (e.shift) return { state: { ...closed.state, selEnd: clamp({ r: e.r, c: last }, ctx) }, effects };
            effects.push({ t: "emit.select", r: e.r, c: 0 }, { t: "focus.sheet" });
            return { state: { ...closed.state, sel: clamp({ r: e.r, c: 0 }, ctx), selEnd: clamp({ r: e.r, c: last }, ctx) }, effects };
        }
        case "key":
            if (s.edit !== null) return { state: s, effects: [] };
            return sheetKey(s, e, ctx);
        case "editor.change": {
            if (s.edit === null) return { state: s, effects: [] };
            const hi = e.val.trim() === "" ? -1 : 0;
            return { state: { ...s, edit: { ...s.edit, val: e.val, err: false, hi } }, effects: [{ t: "schedule.suggest", latency: "idle" }] };
        }
        case "editor.key":
            return editorKey(s, e, ctx);
        case "editor.blur":
            return commitEdit(s, "blur", ctx);
        case "strip.pick": {
            if (s.edit === null) return { state: s, effects: [] };
            return {
                state: { ...s, edit: { ...s.edit, val: e.label, hi: e.i, err: false } },
                effects: [{ t: "focus.editor", selectAll: false }, { t: "schedule.suggest", latency: "instant" }],
            };
        }
        case "select.set": {
            // The host moved the ring: commit an open editor in place, follow, scroll — no echo.
            const closed = s.edit !== null ? commitEdit(s, "stay", ctx) : { state: s, effects: [] as SheetEffect[] };
            const sel = clamp({ r: e.r, c: e.c }, ctx);
            if (same(sel, closed.state.sel) && closed.state.selEnd === null) return closed;
            closed.effects.push({ t: "scroll.to", r: sel.r });
            return { state: { ...closed.state, sel, selEnd: null }, effects: closed.effects };
        }
        case "rows.changed": {
            const sel = clamp(s.sel, ctx);
            const selEnd = s.selEnd !== null ? clamp(s.selEnd, ctx) : null;
            const edit = s.edit !== null && s.edit.r < ctx.rowCount && s.edit.c < ctx.colCount ? s.edit : null;
            if (same(sel, s.sel) && (selEnd === null ? s.selEnd === null : same(selEnd, s.selEnd)) && edit === s.edit) {
                return { state: s, effects: [] };
            }
            return { state: { ...s, sel, selEnd, edit }, effects: [] };
        }
        case "msg":
            return s.msg === e.msg ? { state: s, effects: [] } : { state: { ...s, msg: e.msg }, effects: [] };
        case "clipboard.copy": {
            if (s.edit !== null) return { state: s, effects: [] };
            return { state: s, effects: [{ t: "copy", ...selectionRect(s) }] };
        }
        case "clipboard.paste": {
            if (s.edit !== null) return { state: s, effects: [] };
            return { state: s, effects: [{ t: "paste", r: s.sel.r, c: s.sel.c, text: e.text }] };
        }
    }
}

// ── The component-facing store (the Plan #610 pattern) ─────────────────────

/** The one `useReducer` store: UI state + the effect batch. */
export interface SheetStore {
    ui: SheetUiState;
    /** The latest effectful event's batch — replaced per such event. */
    fx: readonly SheetEffect[];
    /** Bumps when an event yields effects; the component's drain gates on it. */
    fxSeq: number;
}

/** Everything the store reducer handles. */
export type SheetAction =
    | { t: "event"; e: SheetEvent; ctx: SheetMachineCtx }
    /** A direct UI patch from the component (the range after a paste, a message). */
    | { t: "patch"; patch: Partial<SheetUiState> };

/** The initial store. */
export function initialSheetStore(sel?: CellRef): SheetStore {
    return { ui: initialSheetState(sel), fx: [], fxSeq: 0 };
}

/**
 * The store transition — pure: StrictMode double-invokes reducers, so the
 * effect batch rides the returned store and is run by the component's
 * seq-gated drain, never from inside a reducer.
 */
export function sheetStoreReducer(store: SheetStore, a: SheetAction): SheetStore {
    switch (a.t) {
        case "event": {
            const { state, effects } = sheetReducer(store.ui, a.e, a.ctx);
            if (state === store.ui && effects.length === 0) return store;
            return effects.length === 0
                ? { ...store, ui: state }
                : { ...store, ui: state, fx: effects, fxSeq: store.fxSeq + 1 };
        }
        case "patch":
            return { ...store, ui: { ...store.ui, ...a.patch } };
    }
}
