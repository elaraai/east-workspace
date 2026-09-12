/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * THE Sheet state machine (`Sheet Spec.md` §6.1) — every piece of interaction
 * state in one pure reducer: the selection ring and range, the edit buffer,
 * hover, the footer message, the copilot's pending suggestions. No React, no
 * DOM, no East calls: what a transition needs to know about the sheet (row
 * and column counts, which cells are editable, how a buffer parses, the
 * candidates) arrives as a {@link SheetMachineCtx} with the event, and
 * everything that touches data or the host leaves as an effect the component
 * runs.
 *
 * The vocabulary lives in `sheet-types.ts`; the link editor's transitions in
 * `sheet-link-state.ts`; the copilot's in `sheet-suggest-state.ts`; the lens's
 * and the view tabs' in `sheet-lens-state.ts`.
 *
 * Non-negotiable transition rules (unit-tested as a table in
 * `sheet-state.test.ts`):
 *
 * - **Esc ladder**, one rung per press: editor → chip selection → a selected
 *   proposal → the row fill (rows stay) → every suggestion → range → a dirty
 *   tab reverts → a clean tab returns to the sheet.
 * - **The slice owns the query**: the reducer never stores it; a narrowing
 *   change resets the reveals; a tab switch is a `slice.write` effect; tabs
 *   never own rows.
 * - **Tab ladder** (B§4.4 / B§6): the inline ghost or armed candidate → one
 *   predicted chip → hop From → To (a locked half is skipped) → commit right;
 *   with fills pending and no editor: arm the next target, then write it and
 *   arm the following; rows pending: take the next.
 * - **Commit directions** — Tab right, ⇧Tab left, ⏎ / ↓ down (↓ on the last
 *   row appends unless a lens is active or the source is unexhausted), ↑ /
 *   blur stay; an unparseable value never commits — the editor stays open
 *   with the neg ring, and a blur discards it.
 * - **A printable key seeds a fresh edit**; ⏎ / F2 edit with the value
 *   selected (⏎ takes a pending suggestion first); esc cancels.
 * - **Whole rows selected + ⌫ deletes the records**; ⌫ on cells clears them
 *   (never a stamped column — the component skips those); ⌫ on the armed
 *   fill or the selected proposal rejects it and remembers.
 * - **Grouped rows (#740)**: arrows land on a band like a row; Space or the
 *   chevron folds it; the band's gutter selects the group's lines; a click,
 *   ⏎ or a printable key on the `+ plan` ghost band opens its title — the
 *   commit creates the group.
 *
 * @packageDocumentation
 */

import { ghostFor, ghostWord, resolveFor } from "./candidates.js";
import type { SheetKind } from "./model.js";
import {
    same, clamp, selectionRect, wholeRows, initialSheetState,
    type CellRef, type CommitDir, type EditBuffer, type LinkGroups, type SheetEffect, type SheetEvent, type SheetMachineCtx, type SheetUiState, type Transition,
} from "./sheet-types.js";
import { linkStartSide, withBuffer, linkChange, linkKey, switchSide } from "./sheet-link-state.js";
import {
    suggestKey, escSuggest, fillRow, takeFill, takeProposals, rejectProposal, applyReady, applyLanded, rekeySuggest, clearSuggest, afterRowsChanged,
} from "./sheet-suggest-state.js";
import {
    setContext, bandReveal, narrowed, switchTab, createTab, closeTab, updateTab, revertTab,
    renameStart, renameChange, renameCommit, renameCancel, reorderTab, escTabs, searchKey,
} from "./sheet-lens-state.js";
import type { SheetCellValue } from "./values.js";

export * from "./sheet-types.js";
export { nextTargetOf, fillOrder, anchorRow } from "./sheet-suggest-state.js";
export { withBuffer } from "./sheet-link-state.js";

/** The register kinds — where ⌥ cycles candidates and Tab takes the ghost. */
function isRegisterKind(kind: SheetKind): boolean {
    return kind === "lookup" || kind === "reference" || kind === "enum";
}

/**
 * Move the ring to `to`, dropping the range; reports the move. A keyboard
 * move scrolls the row into view; a pointer move never does — the cell is
 * under the pointer already, and moving the sheet under a held button would
 * read as a drag.
 */
function moveTo(s: SheetUiState, to: CellRef, ctx: SheetMachineCtx, effects: SheetEffect[], scroll = true): SheetUiState {
    const next = clamp(to, ctx);
    if (same(next, s.sel) && s.selEnd === null) return s;
    effects.push({ t: "emit.select", r: next.r, c: next.c });
    if (scroll) effects.push({ t: "scroll.to", r: next.r });
    return { ...s, sel: next, selEnd: null };
}

/** The column one step left or right of a cell — past the whole span of a band's title (#740). */
function stepColumn(r: number, c: number, dir: 1 | -1, ctx: SheetMachineCtx): number {
    const span = ctx.spanAt?.(r, c);
    if (span === undefined) return c + dir;
    return dir > 0 ? span.c1 + 1 : span.c0 - 1;
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
    return { state: { ...moved, edit, selEnd: null, armed: null, gsel: null }, effects };
}

/** The text a register-kind commit takes: the armed candidate when a ghost or an explicit pick applies. */
export function commitText(edit: EditBuffer, ctx: SheetMachineCtx): string {
    if (!isRegisterKind(ctx.kindAt(edit.r, edit.c))) return edit.val;
    const cand = ctx.candidateAt(edit.r, edit.c, edit.val, edit.hi);
    if (cand !== undefined && edit.val.trim() !== "" && (ghostFor(edit.val, cand) !== "" || edit.hi > 0)) return cand;
    return edit.val;
}

/**
 * The cell the open editor would commit — what the copilot runs against
 * (`null` = a blank, `undefined` = unrecognised, nothing to run against).
 */
export function provisionalCell(edit: EditBuffer, ctx: SheetMachineCtx): SheetCellValue | null | undefined {
    if (edit.link !== undefined) {
        const linkCtx = ctx.linkAt?.(edit.r, edit.c);
        if (linkCtx === undefined) return undefined;
        return linkCtx.cell(withBuffer(edit, linkCtx));
    }
    const out = ctx.parse(edit.r, edit.c, commitText(edit, ctx));
    if (out.kind === "unrecognised") return undefined;
    return out.kind === "cell" ? out.cell : null;
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
        let next: SheetUiState = { ...s, edit: null, armed: null };
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
    let next: SheetUiState = { ...s, edit: null, armed: null };
    if (dir !== "blur") effects.push({ t: "focus.sheet" });
    next = moveAfterCommit(next, dir, ctx, effects);
    return { state: next, effects };
}

/** Where the ring goes after a commit. */
function moveAfterCommit(s: SheetUiState, dir: CommitDir, ctx: SheetMachineCtx, effects: SheetEffect[]): SheetUiState {
    switch (dir) {
        case "right": return moveTo(s, { r: s.sel.r, c: stepColumn(s.sel.r, s.sel.c, 1, ctx) }, ctx, effects);
        case "left": return moveTo(s, { r: s.sel.r, c: stepColumn(s.sel.r, s.sel.c, -1, ctx) }, ctx, effects);
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

/** Fold or open the group whose band sits at `r` (#740); the ring lands on the band. */
function toggleFold(s: SheetUiState, r: number, ctx: SheetMachineCtx): Transition {
    const g = ctx.groupAt?.(r);
    if (g === undefined) return { state: s, effects: [] };
    const folds = new Map(s.lens.folds);
    folds.set(g.id, !g.folded);
    const effects: SheetEffect[] = [];
    const moved = moveTo(s, { r, c: s.sel.c }, ctx, effects, false);
    return { state: { ...moved, lens: { ...moved.lens, folds }, msg: g.folded ? "Opened the plan" : "Folded the plan — Space or the chevron opens it" }, effects };
}

/** The sheet's keyboard (B§6) — no editor open. */
function sheetKey(s: SheetUiState, e: Extract<SheetEvent, { t: "key" }>, ctx: SheetMachineCtx): Transition {
    // ⌘/ and ⌘F focus the rail's search (B§6) — whatever the sheet holds.
    if (e.meta && (e.key === "/" || e.key === "f")) return { state: s, effects: [{ t: "focus.search" }] };
    if (ctx.rowCount === 0 || ctx.colCount === 0) return { state: s, effects: [] };
    const effects: SheetEffect[] = [];
    // A band folds on Space; the ghost band opens its title on ⏎ or a printable key (#740).
    const rowKind = ctx.rowKindAt?.(s.sel.r);
    if (rowKind === "group" && e.key === " " && !e.meta && !e.alt) return toggleFold(s, s.sel.r, ctx);
    if (rowKind === "groupBlank" && (e.key === "Enter" || e.key === "F2" || (e.key.length === 1 && !e.meta && !e.alt))) {
        return startEdit(s, s.sel.r, 0, e.key.length === 1 ? e.key : undefined, ctx);
    }
    const dropPick = (t: Transition): Transition => (t.state.gsel === null ? t : { ...t, state: { ...t.state, gsel: null } });
    const move = (dr: number, dc: number): Transition => {
        const base = e.shift && s.selEnd !== null ? s.selEnd : s.sel;
        const c = dc === 0 ? base.c : stepColumn(base.r, base.c, dc > 0 ? 1 : -1, ctx);
        if (e.shift) {
            const selEnd = clamp({ r: base.r + dr, c }, ctx);
            return dropPick({ state: { ...s, selEnd }, effects });
        }
        if (dr === 1) return dropPick({ state: moveDown(s, ctx, effects), effects });
        return dropPick({ state: moveTo(s, { r: base.r + dr, c }, ctx, effects), effects });
    };
    switch (e.key) {
        case "ArrowDown": return move(1, 0);
        case "ArrowUp": return move(-1, 0);
        case "ArrowLeft": return move(0, -1);
        case "ArrowRight": return move(0, 1);
        case "Tab": {
            const taken = suggestKey(s, e, ctx);
            if (taken !== null) return taken;
            return { state: moveTo(s, { r: s.sel.r, c: stepColumn(s.sel.r, s.sel.c, e.shift ? -1 : 1, ctx) }, ctx, effects), effects };
        }
        case "Enter": {
            const taken = suggestKey(s, e, ctx);
            if (taken !== null) return taken;
            if (e.meta) return { state: s, effects };
            return startEdit(s, s.sel.r, s.sel.c, undefined, ctx);
        }
        case "F2":
            return startEdit(s, s.sel.r, s.sel.c, undefined, ctx);
        case "Escape": {
            const dropped = escSuggest(s);
            if (dropped !== null) return dropped;
            if (s.selEnd !== null) return { state: { ...s, selEnd: null }, effects };
            const rung = escTabs(s, ctx);
            return rung ?? { state: s, effects };
        }
        case "Backspace":
        case "Delete": {
            const rejected = suggestKey(s, e, ctx);
            if (rejected !== null) return rejected;
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

/** The editor's keyboard — the link editor's keys first, then the scalar cells'. */
function editorKey(s: SheetUiState, e: Extract<SheetEvent, { t: "editor.key" }>, ctx: SheetMachineCtx): Transition {
    const edit = s.edit;
    if (edit === null) return { state: s, effects: [] };
    if (e.key === "Enter" && e.meta) {
        // ⌘⏎ — commit in place, then take the row fill (B§6).
        const committed = commitEdit(s, "stay", ctx);
        if (committed.state.edit !== null) return committed;
        const filled = fillRow(committed.state, ctx);
        return { state: filled.state, effects: [...committed.effects, ...filled.effects] };
    }
    if (edit.link !== undefined) return linkKey(s, e, ctx, commitEdit);
    const kind = ctx.kindAt(edit.r, edit.c);
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
    if (e.key === "Enter") return commitEdit(s, "down", ctx);
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
                return { state: { ...closed.state, selEnd: clamp({ r: e.r, c: e.c }, ctx), gsel: null }, effects };
            }
            // A click on the `+ plan` ghost band opens its title — the commit creates the group (#740, G6).
            if (ctx.rowKindAt?.(e.r) === "groupBlank") {
                const opened = startEdit(closed.state, e.r, 0, undefined, ctx);
                return { state: opened.state.gsel === null ? opened.state : { ...opened.state, gsel: null }, effects: [...effects, ...opened.effects] };
            }
            const moved = moveTo(closed.state, { r: e.r, c: e.c }, ctx, effects, false);
            effects.push({ t: "focus.sheet" });
            return { state: moved.gsel === null ? moved : { ...moved, gsel: null }, effects };
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
            if (e.shift) return { state: { ...closed.state, selEnd: clamp({ r: e.r, c: last }, ctx), gsel: null }, effects };
            // A band's gutter selects the group's lines (#740, G7); an empty or folded group selects the band itself.
            const group = ctx.rowKindAt?.(e.r) === "group" ? ctx.groupAt?.(e.r) : undefined;
            const r0 = group?.lines !== undefined ? group.lines.r0 : e.r;
            const r1 = group?.lines !== undefined ? group.lines.r1 : e.r;
            effects.push({ t: "emit.select", r: r0, c: 0 }, { t: "focus.sheet" });
            return { state: { ...closed.state, sel: clamp({ r: r0, c: 0 }, ctx), selEnd: clamp({ r: r1, c: last }, ctx), gsel: null }, effects };
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
            const clamped = same(sel, s.sel) && (selEnd === null ? s.selEnd === null : same(selEnd, s.selEnd)) && edit === s.edit
                ? s
                : { ...s, sel, selEnd, edit };
            return { state: afterRowsChanged(clamped, ctx), effects: [] };
        }
        case "msg":
            return s.msg === e.msg ? { state: s, effects: [] } : { state: { ...s, msg: e.msg }, effects: [] };
        case "clipboard.copy": {
            if (s.edit !== null) return { state: s, effects: [] };
            return { state: s, effects: [{ t: "copy", ...selectionRect(s) }] };
        }
        case "clipboard.paste": {
            if (s.edit !== null) return { state: s, effects: [] };
            return { state: { ...s, sugg: null, armed: null, gsel: null }, effects: [{ t: "paste", r: s.sel.r, c: s.sel.c, text: e.text }] };
        }
        // ── The copilot ───────────────────────────────────────────────────
        case "suggest.ready":
            return applyReady(s, ctx, e.anchorId, e.sugg);
        case "suggest.landed":
            return applyLanded(s, e);
        case "suggest.rekey":
            return { state: rekeySuggest(s, e.from, e.to), effects: [] };
        case "suggest.clear":
            return { state: clearSuggest(s), effects: [] };
        case "fill.take":
            return takeFill(s, ctx, e.key);
        case "fill.row":
            return fillRow(s, ctx);
        case "proposal.pick": {
            const closed = s.edit !== null ? commitEdit(s, "stay", ctx) : { state: s, effects: [] as SheetEffect[] };
            if (closed.state.sugg === null || e.i < 0 || e.i >= closed.state.sugg.rows.length) return closed;
            closed.effects.push({ t: "focus.sheet" });
            return { state: { ...closed.state, gsel: e.i, selEnd: null, armed: null }, effects: closed.effects };
        }
        case "proposal.take":
            return takeProposals(s, ctx, e.i);
        case "proposal.reject":
            return rejectProposal(s, ctx, e.i);
        // ── The lens and the tabs (B§8) ────────────────────────────────────
        case "lens.context":
            return { state: setContext(s, e.context), effects: [] };
        case "band.reveal":
            return { state: bandReveal(s, e), effects: [] };
        case "lens.narrowed":
            return narrowed(s, ctx);
        case "tab.switch":
        case "tab.create":
        case "tab.close": {
            // A tab gesture commits an open editor in place first.
            const closed = s.edit !== null ? commitEdit(s, "stay", ctx) : { state: s, effects: [] as SheetEffect[] };
            const t = e.t === "tab.switch" ? switchTab(closed.state, ctx, e.id)
                : e.t === "tab.create" ? createTab(closed.state, ctx)
                    : closeTab(closed.state, ctx, e.id);
            return { state: t.state, effects: [...closed.effects, ...t.effects] };
        }
        case "tab.open":
            return switchTab(s, ctx, e.id, false);
        case "tab.update":
            return updateTab(s, ctx);
        case "tab.revert":
            return revertTab(s, ctx);
        case "tab.rename.start":
            return { state: renameStart(s, ctx, e.id), effects: [] };
        case "tab.rename.change":
            return { state: renameChange(s, e.val), effects: [] };
        case "tab.rename.commit":
            return renameCommit(s, ctx);
        case "tab.rename.cancel":
            return { state: renameCancel(s), effects: [] };
        case "tab.reorder":
            return reorderTab(s, ctx, e.id, e.to);
        case "search.key":
            return searchKey(s, ctx, e.key) ?? { state: s, effects: [] };
        // ── Grouped rows (#740) ───────────────────────────────────────────
        case "fold.toggle": {
            const closed = s.edit !== null ? commitEdit(s, "stay", ctx) : { state: s, effects: [] as SheetEffect[] };
            const t = toggleFold(closed.state, e.r, ctx);
            return { state: t.state, effects: [...closed.effects, ...t.effects] };
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

/** The initial store — `active` is the initial view tab, if the sheet opens on one. */
export function initialSheetStore(sel?: CellRef, active: string | null = null): SheetStore {
    return { ui: initialSheetState(sel, active), fx: [], fxSeq: 0 };
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
