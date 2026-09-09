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
 * The suggestion lifecycle (P4) and the lens / tabs (P5) extend this file;
 * the rungs they add to the esc and Tab ladders are marked where they slot
 * in. The link editor (B§4.4) lives here too: its two halves, the buffer
 * that resolves to chips on `,` / ⏎ / a hop, the chip selection.
 *
 * Non-negotiable transition rules (unit-tested as a table in
 * `sheet-state.test.ts`):
 *
 * - **Esc ladder**, one rung per press: editor → chip selection → range.
 * - **Tab ladder** (B§4.4): the inline ghost or armed candidate → one
 *   predicted chip → hop From → To (a locked half is skipped) → commit right.
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
import { memberLabel, type SheetKind } from "./model.js";
import type { ParseOutcome } from "./parse/index.js";
import type { LinkCandidate } from "./link/predict.js";
import type { LinkHalves } from "./link/sides.js";
import { ARROW } from "./link/grammar.js";
import type { SheetCellValue, SheetMemberValue } from "./values.js";

/** The two halves' members. */
export type LinkGroups = [SheetMemberValue[], SheetMemberValue[]];

/** The link editor's own state — the two halves, the caret's half, the chip selection. */
export interface LinkEdit {
    /** Which half the caret is in: 0 = From, 1 = To. */
    side: 0 | 1;
    /** The resolved members of each half. */
    groups: LinkGroups;
    /** Whole-chip selection over the flat member list (From then To). */
    chipSel: { anchor: number; focus: number } | null;
    /** Bumps when the caret hops halves — the editor refocuses the active half. */
    hop: number;
}

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
    /** The link editor's state — present on a link / set column. */
    link?: LinkEdit;
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
    | { t: "strip.pick"; label: string; i: number; members?: SheetMemberValue[] }
    /** A click in a link editor's half moves the caret there (the buffer resolves first). */
    | { t: "half.down"; side: 0 | 1 }
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
    /** The link editor's context for a link / set column (`undefined` on every other kind). */
    linkAt?: (r: number, c: number) => LinkEditCtx | undefined;
}

/** What the link editor asks about its cell — built by the component per render. */
export interface LinkEditCtx {
    /** The halves the row's driver makes live, and their lock tags. */
    halves: LinkHalves;
    /** The cell's current members. */
    initial: LinkGroups;
    /** The candidates for a buffer, members already in the cell excluded. */
    candidates: (text: string, groups: LinkGroups) => LinkCandidate[];
    /** The armed candidate. */
    candidateAt: (text: string, hi: number, groups: LinkGroups) => LinkCandidate | undefined;
    /** What a buffer resolves to — the armed candidate when it completes the text, else the grammar. */
    resolve: (text: string, cand: LinkCandidate | undefined) => SheetMemberValue[];
    /** The predicted members for a half (P4 — empty until the runner lands). */
    predicted: (side: 0 | 1, groups: LinkGroups, typed: string) => SheetMemberValue[];
    /** The cell for the halves — `null` when both are empty. */
    cell: (groups: LinkGroups) => SheetCellValue | null;
    /** The driver member's name, for the hop-into-a-locked-half message. */
    driverName: string;
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
    const linkCtx = ctx.linkAt?.(r, c);
    const val = linkCtx !== undefined ? seed ?? "" : seed ?? ctx.editTextAt(r, c);
    const edit: EditBuffer = { r, c, val, err: false, hi: seed !== undefined && seed.trim() !== "" ? 0 : -1, seeded: seed !== undefined };
    if (linkCtx !== undefined) {
        // Existing content becomes chips; a seed replaces it (the spreadsheet convention).
        const groups: LinkGroups = seed !== undefined ? [[], []] : [[...linkCtx.initial[0]], [...linkCtx.initial[1]]];
        edit.link = { side: linkStartSide(linkCtx.halves, groups), groups, chipSel: null, hop: 0 };
    }
    effects.push({ t: "focus.editor", selectAll: seed === undefined && linkCtx === undefined });
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
    if (edit.link !== undefined) {
        // The buffer resolves into the active half (the ghost taken); the cell is
        // the two halves. Typed entry is never blocked, so a link always commits.
        const linkCtx = ctx.linkAt?.(edit.r, edit.c);
        if (linkCtx === undefined) return { state: { ...s, edit: null }, effects: [{ t: "focus.sheet" }] };
        const groups = withBuffer(edit, linkCtx);
        const effects: SheetEffect[] = [{ t: "write", r: edit.r, c: edit.c, cell: linkCtx.cell(groups), text: "" }];
        let next: SheetUiState = { ...s, edit: null };
        if (dir !== "blur") effects.push({ t: "focus.sheet" });
        next = moveAfterCommit(next, dir, ctx, effects);
        return { state: next, effects };
    }
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

// ── The link editor (B§4.4) ───────────────────────────────────────────────

/** The half the caret opens in: the first live half still empty, else the destination. */
function linkStartSide(halves: LinkHalves, groups: LinkGroups): 0 | 1 {
    if (halves.from.live && groups[0].length === 0) return 0;
    if (halves.to.live && groups[1].length === 0) return 1;
    return halves.to.live ? 1 : 0;
}

/** The halves with the buffer resolved into the active one. */
function withBuffer(edit: EditBuffer, linkCtx: LinkEditCtx): LinkGroups {
    const link = edit.link!;
    const groups: LinkGroups = [[...link.groups[0]], [...link.groups[1]]];
    if (edit.val.trim() === "") return groups;
    const cand = linkCtx.candidateAt(edit.val, edit.hi, link.groups);
    groups[link.side] = groups[link.side].concat(linkCtx.resolve(edit.val, cand));
    return groups;
}

/** Hop the caret to a half — the buffer resolves into the half it leaves. */
function switchSide(s: SheetUiState, side: 0 | 1, ctx: SheetMachineCtx): Transition {
    const edit = s.edit;
    if (edit === null || edit.link === undefined || edit.link.side === side) return { state: s, effects: [] };
    const linkCtx = ctx.linkAt?.(edit.r, edit.c);
    if (linkCtx === undefined) return { state: s, effects: [] };
    const groups = withBuffer(edit, linkCtx);
    return {
        state: { ...s, edit: { ...edit, val: "", hi: -1, err: false, link: { ...edit.link, side, groups, chipSel: null, hop: edit.link.hop + 1 } } },
        effects: [{ t: "focus.editor", selectAll: false }, { t: "schedule.suggest", latency: "idle" }],
    };
}

/** The flat chip list's range under the chip selection. */
function chipRange(link: LinkEdit): { lo: number; hi: number } {
    if (link.chipSel === null) return { lo: -1, hi: -2 };
    return { lo: Math.min(link.chipSel.anchor, link.chipSel.focus), hi: Math.max(link.chipSel.anchor, link.chipSel.focus) };
}

/** The link editor's typing: `,` resolves the buffer, an arrow hops From → To (dropped in To). */
function linkChange(s: SheetUiState, val: string, ctx: SheetMachineCtx): Transition {
    const edit = s.edit!;
    const link = edit.link!;
    if (!val.includes(",") && !ARROW.test(val)) {
        return { state: { ...s, edit: { ...edit, val, err: false, hi: val.trim() === "" ? -1 : 0, link: { ...link, chipSel: null } } }, effects: [{ t: "schedule.suggest", latency: "idle" }] };
    }
    const linkCtx = ctx.linkAt?.(edit.r, edit.c);
    if (linkCtx === undefined) return { state: s, effects: [] };
    const groups: LinkGroups = [[...link.groups[0]], [...link.groups[1]]];
    let side = link.side;
    let buf = "";
    let warn = "";
    const push = (b: string) => {
        const t = b.trim().replace(/-+$/, "").trim();
        if (t === "") return;
        // The armed candidate completes the buffer (the ghost the planner saw); else the grammar.
        groups[side] = groups[side].concat(linkCtx.resolve(t, linkCtx.candidateAt(t, -1, groups)));
    };
    // An arrow typed in the From half hops to the To half; in the To half it is
    // dropped. Hopping into a locked half is allowed but flagged — the text is kept.
    const route = () => {
        push(buf);
        buf = "";
        if (side === 0) {
            side = 1;
            if (!linkCtx.halves.to.live) warn = `${linkCtx.driverName} has no destination — kept, but flagged`;
        }
    };
    for (let i = 0; i < val.length; i++) {
        const ch = val[i]!;
        if (ch === ",") { push(buf); buf = ""; continue; }
        if (ch === ">" || ch === "→") { route(); continue; }
        if (ch === "-" && val[i + 1] === ">") continue;   // `->`: the hyphen buffered before the arrow
        if ((ch === "-" || ch === "–") && /\s$/.test(buf) && /^\s/.test(val.slice(i + 1))) { route(); i++; continue; }
        buf += ch;
    }
    const hopped = side !== link.side;
    const effects: SheetEffect[] = [{ t: "schedule.suggest", latency: "idle" }];
    if (hopped) effects.push({ t: "focus.editor", selectAll: false });
    const rest = buf.replace(/^\s+/, "");
    return {
        state: {
            ...s,
            msg: warn !== "" ? warn : s.msg,
            edit: { ...edit, val: rest, err: false, hi: rest.trim() === "" ? -1 : 0, link: { ...link, side, groups, chipSel: null, hop: hopped ? link.hop + 1 : link.hop } },
        },
        effects,
    };
}

/** The link editor's keys (B§4.4). */
function linkKey(s: SheetUiState, e: Extract<SheetEvent, { t: "editor.key" }>, ctx: SheetMachineCtx): Transition {
    const edit = s.edit!;
    const link = edit.link!;
    const linkCtx = ctx.linkAt?.(edit.r, edit.c);
    if (linkCtx === undefined) return commitEdit(s, "cancel", ctx);
    const setLink = (patch: Partial<LinkEdit>, more: Partial<EditBuffer> = {}, effects: SheetEffect[] = []): Transition =>
        ({ state: { ...s, edit: { ...edit, ...more, link: { ...link, ...patch } } }, effects });
    const flat = [...link.groups[0], ...link.groups[1]];
    if (e.key === "Escape") {
        if (link.chipSel !== null) return setLink({ chipSel: null });
        return commitEdit(s, "cancel", ctx);
    }
    if (e.alt && (e.key === "]" || e.key === "[" || e.key === "ArrowDown" || e.key === "ArrowUp")) {
        const n = linkCtx.candidates(edit.val, link.groups).length;
        if (n === 0) return { state: s, effects: [] };
        const cur = edit.hi < 0 ? (edit.val.trim() === "" ? -1 : 0) : edit.hi;
        const back = e.key === "[" || e.key === "ArrowUp";
        return { state: { ...s, edit: { ...edit, hi: cur < 0 ? 0 : (cur + (back ? -1 : 1) + n) % n } }, effects: [{ t: "schedule.suggest", latency: "instant" }] };
    }
    if (e.key === "Enter") {
        if (e.meta) return commitEdit(s, "stay", ctx);
        if (edit.val.trim() !== "") {
            // With text: resolve to chips, stay.
            const groups = withBuffer(edit, linkCtx);
            return setLink({ groups, chipSel: null }, { val: "", hi: -1, err: false }, [{ t: "schedule.suggest", latency: "idle" }]);
        }
        return commitEdit(s, "down", ctx);
    }
    if (e.key === "Tab") {
        if (!e.shift && edit.val.trim() !== "") {
            // 1 · the inline ghost or the armed candidate.
            const cand = linkCtx.candidateAt(edit.val, edit.hi, link.groups);
            if (cand !== undefined && cand.label.toLowerCase() !== edit.val.trim().toLowerCase()) {
                return { state: { ...s, edit: { ...edit, val: cand.label, hi: 0 } }, effects: [{ t: "schedule.suggest", latency: "instant" }] };
            }
        }
        if (!e.shift && edit.val.trim() === "") {
            // 2 · one predicted chip.
            const rest = linkCtx.predicted(link.side, link.groups, edit.val);
            if (rest.length > 0) {
                const groups: LinkGroups = [[...link.groups[0]], [...link.groups[1]]];
                groups[link.side] = groups[link.side].concat([rest[0]!]);
                return setLink({ groups });
            }
        }
        // 3 · the divider, before the cell — a locked half is skipped.
        if (!e.shift && link.side === 0 && linkCtx.halves.to.live) return switchSide(s, 1, ctx);
        if (e.shift && link.side === 1 && linkCtx.halves.from.live) return switchSide(s, 0, ctx);
        // 4 · commit.
        return commitEdit(s, e.shift ? "left" : "right", ctx);
    }
    // ⇧← / ⇧→ select whole chips — the unit of a collection cell is the member.
    if (e.shift && (e.key === "ArrowLeft" || e.key === "ArrowRight") && flat.length > 0) {
        const cs = link.chipSel;
        if (e.key === "ArrowLeft" && (cs !== null || edit.val === "")) {
            const next = cs !== null ? { anchor: cs.anchor, focus: Math.max(0, cs.focus - 1) } : { anchor: flat.length - 1, focus: flat.length - 1 };
            return setLink({ chipSel: next });
        }
        if (e.key === "ArrowRight" && cs !== null) {
            const f = cs.focus + 1;
            return setLink({ chipSel: f > flat.length - 1 ? null : { anchor: cs.anchor, focus: f } });
        }
    }
    if (link.chipSel !== null && (e.key === "Backspace" || e.key === "Delete")) {
        const { lo, hi } = chipRange(link);
        let i = 0;
        const groups = link.groups.map((g) => g.filter(() => { const n = i++; return n < lo || n > hi; })) as LinkGroups;
        return { state: { ...s, msg: `${hi - lo + 1} member${hi - lo === 0 ? "" : "s"} removed`, edit: { ...edit, link: { ...link, groups, chipSel: null } } }, effects: [] };
    }
    if (link.chipSel !== null && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return setLink({ chipSel: null });
    if (e.key === "Backspace" && edit.val === "") {
        // Pop the active half's last chip back into the buffer; an empty To crosses back to From.
        if (link.groups[link.side].length > 0) {
            const groups: LinkGroups = [[...link.groups[0]], [...link.groups[1]]];
            const tok = groups[link.side].pop()!;
            return setLink({ groups, chipSel: null }, { val: memberLabel(tok), hi: 0 });
        }
        if (link.side === 1) return switchSide(s, 0, ctx);
        return { state: s, effects: [] };
    }
    if (e.key === "ArrowRight" && e.atEnd && edit.val.trim() !== "") {
        const cand = linkCtx.candidateAt(edit.val, edit.hi, link.groups);
        const ghost = cand !== undefined && cand.label.toLowerCase().startsWith(edit.val.trim().toLowerCase()) ? cand.label.slice(edit.val.trim().length) : "";
        if (ghost !== "") {
            const take = e.meta ? ghost : ghostWord(ghost);
            return { state: { ...s, edit: { ...edit, val: edit.val + take } }, effects: [] };
        }
    }
    if (e.meta && e.key === "ArrowRight" && edit.val.trim() === "") {
        // The whole predicted remainder of the half in one press.
        const rest = linkCtx.predicted(link.side, link.groups, edit.val);
        if (rest.length > 0) {
            const groups: LinkGroups = [[...link.groups[0]], [...link.groups[1]]];
            groups[link.side] = groups[link.side].concat(rest);
            return { state: { ...s, msg: `Took ${rest.length} predicted member${rest.length === 1 ? "" : "s"}`, edit: { ...edit, link: { ...link, groups } } }, effects: [] };
        }
    }
    // Plain arrows at the edge of an empty buffer cross the divider.
    if (e.key === "ArrowRight" && edit.val === "" && !e.meta && link.side === 0 && linkCtx.halves.to.live) return switchSide(s, 1, ctx);
    if (e.key === "ArrowLeft" && edit.val === "" && link.chipSel === null && link.side === 1) return switchSide(s, 0, ctx);
    return { state: s, effects: [] };
}

/** The editor's keyboard — the link editor's keys first, then the scalar cells'. */
function editorKey(s: SheetUiState, e: Extract<SheetEvent, { t: "editor.key" }>, ctx: SheetMachineCtx): Transition {
    const edit = s.edit;
    if (edit === null) return { state: s, effects: [] };
    if (edit.link !== undefined) return linkKey(s, e, ctx);
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
            if (s.edit.link !== undefined) return linkChange(s, e.val, ctx);
            const hi = e.val.trim() === "" ? -1 : 0;
            return { state: { ...s, edit: { ...s.edit, val: e.val, err: false, hi } }, effects: [{ t: "schedule.suggest", latency: "idle" }] };
        }
        case "editor.key":
            return editorKey(s, e, ctx);
        case "editor.blur":
            return commitEdit(s, "blur", ctx);
        case "strip.pick": {
            if (s.edit === null) return { state: s, effects: [] };
            if (s.edit.link !== undefined) {
                // A link chip adds its members to the active half; the buffer clears.
                const link = s.edit.link;
                const members = e.members ?? [];
                if (members.length === 0) return { state: s, effects: [] };
                const groups: LinkGroups = [[...link.groups[0]], [...link.groups[1]]];
                groups[link.side] = groups[link.side].concat(members);
                return {
                    state: { ...s, msg: `Added ${members.length} member${members.length === 1 ? "" : "s"}`, edit: { ...s.edit, val: "", hi: -1, err: false, link: { ...link, groups, chipSel: null } } },
                    effects: [{ t: "focus.editor", selectAll: false }, { t: "schedule.suggest", latency: "instant" }],
                };
            }
            return {
                state: { ...s, edit: { ...s.edit, val: e.label, hi: e.i, err: false } },
                effects: [{ t: "focus.editor", selectAll: false }, { t: "schedule.suggest", latency: "instant" }],
            };
        }
        case "half.down": {
            if (s.edit === null || s.edit.link === undefined) return { state: s, effects: [] };
            if (s.edit.link.side === e.side) return { state: s, effects: [{ t: "focus.editor", selectAll: false }] };
            return switchSide(s, e.side, ctx);
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
