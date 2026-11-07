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
 * `sheet-link-state.ts`; the copilot's in `sheet-suggest-state.ts`; the view
 * tabs' in `sheet-tabs-state.ts`.
 *
 * Non-negotiable transition rules (unit-tested as a table in
 * `sheet-state.test.ts`):
 *
 * - **Esc ladder**, one rung per press: editor → chip selection → a selected
 *   proposal → the row fill (rows stay) → every suggestion → range → a dirty
 *   tab reverts → a clean tab returns to the sheet.
 * - **The slice owns the query**: the reducer never stores it; a narrowing
 *   change returns the ring to the top; a tab switch is a `slice.write`
 *   effect; tabs never own rows.
 * - **Tab ladder** (B§4.4 / B§6): the inline ghost or armed candidate → one
 *   predicted chip → hop From → To (a locked half is skipped) → commit right;
 *   with fills pending and no editor: arm the next target, then write it and
 *   arm the following; rows pending: take the next.
 * - **Commit directions** — Tab right, ⇧Tab left, ⏎ / ↓ down (↓ on the last
 *   row appends unless a lens is active or the source is unexhausted), ↑ /
 *   blur stay; an unparseable value becomes an invalid draft carrying the
 *   original input, so it remains visible and undoable after leaving the cell.
 * - **The key map (#860)** — Home / End go to the row's first or last column
 *   and ⌘Home / ⌘End to the sheet's first or last cell (the last row that is
 *   not blank padding); PageUp / PageDown move a page of rows; ⇧ stretches a
 *   range instead. On a paged sheet ↓ past the last resident row, ↑ above the
 *   first, a page past either (#1398, CL10) and ⌘Home / ⌘End toward an end
 *   not yet resident ask the component for the window there (`seek.step`,
 *   `seek.edge`) — the ring lands once it arrives.
 * - **An unchanged buffer writes nothing** (#852): an editor closed on the
 *   text it opened with commits no write — nor takes a ghost when it was
 *   never touched — so opening a cell and pressing ⏎ never changes it.
 * - **A register member is typed in the words its cell shows** (#1536): the
 *   editor opens on its label; a member a gesture chooses — the cell's own as
 *   it opens, a menu option, a strip chip, a candidate ⇥ or ⌘→ takes —
 *   commits as itself, by its key, so two members who show one label are told
 *   apart; typed words commit to the member they name whole, else the best
 *   candidate. Back on the cell's own member, nothing is written.
 * - **A printable key seeds a fresh edit**; ⏎ / F2 edit with the value
 *   selected (⏎ takes a pending suggestion first); esc cancels.
 * - **Whole rows selected + ⌫ deletes the records**; ⌫ on cells clears them
 *   (never a stamped column — the component skips those); ⌫ on the armed
 *   fill or the selected proposal rejects it and remembers.
 * - **Cells that step in place (#1531)** — a Record's cycle, toggle and
 *   boolean: a press, Space or ⏎ takes the next state (⇧ the one before),
 *   ⌫ a cycle's first and a member's key sets it; none opens an editor. A
 *   cell that edits out of place — a Record's title — opens through the host
 *   on a press, ⏎ or F2. A grid a host draws opens with no ring: a press
 *   places it, or the first move key, on the first row's first cell that
 *   edits in place.
 * - **Grouped rows (#740)**: arrows land on a band like a row; Space or the
 *   chevron folds it; the summary gutter selects its children. Insertion
 *   uses explicit controls. A lens over a grouped sheet narrows its groups,
 *   the records (#1349). A line with SUB ROWS takes Space the way a band
 *   does: they show or hide (⇧Space: every line of the group); the ring
 *   never lands on a sub row.
 *
 * @packageDocumentation
 */

import { StringType, equalFor, variant } from "@elaraai/east";
import { ghostFor, ghostWord, resolveFor } from "./candidates.js";
import type { SheetKind } from "./model.js";
import {
    same, clamp, selectionRect, wholeRows, initialSheetState,
    type CellRef, type CommitDir, type EditBuffer, type LinkGroups, type SheetEffect, type SheetEvent, type SheetMachineCtx, type SheetNotice, type SheetUiState, type Transition,
} from "./sheet-types.js";
import { linkStartSide, withBuffer, linkChange, linkKey, switchSide } from "./sheet-link-state.js";
import {
    suggestKey, escSuggest, fillRow, takeFill, takeProposals, rejectProposal, applyReady, applyLanded, rekeySuggest, clearSuggest, afterRowsChanged,
} from "./sheet-suggest-state.js";
import {
    narrowed, switchTab, createTab, closeTab, updateTab, revertTab,
    renameStart, renameChange, renameCommit, renameCancel, reorderTab, escTabs, searchKey,
} from "./sheet-tabs-state.js";
import type { SheetCellValue } from "./values.js";

export * from "./sheet-types.js";
export { nextTargetOf, fillOrder, anchorRow } from "./sheet-suggest-state.js";
export { withBuffer } from "./sheet-link-state.js";

const stringEqual = equalFor(StringType);

/** The register kinds — where ⌥ cycles candidates and Tab takes the ghost. */
function isRegisterKind(kind: SheetKind): boolean {
    return kind === "lookup" || kind === "reference" || kind === "enum" || kind === "person";
}

/**
 * The buffer once a gesture has chosen a register member (#1536): the words
 * it shows typed, the member armed among their candidates — what the strip,
 * the menu and the badge show — and its key what the commit writes.
 */
function withPick(edit: EditBuffer, val: string, key: string, ctx: SheetMachineCtx): EditBuffer {
    const hi = ctx.candidates(edit.r, edit.c, val).findIndex((cand) => stringEqual(cand.key, key));
    return { ...edit, val, err: false, hi, pick: key };
}

/**
 * Move the ring to `to`, dropping the range, and place it where none was
 * (#1531); reports the move. A keyboard move scrolls the row into view; a
 * pointer move never does — the cell is under the pointer already, and moving
 * the sheet under a held button would read as a drag. Where the strip
 * previews the cell under the pointer, a keyboard move lets the hover go, so
 * the strip follows the ring.
 */
function moveTo(s: SheetUiState, to: CellRef, ctx: SheetMachineCtx, effects: SheetEffect[], scroll = true): SheetUiState {
    const next = clamp(to, ctx);
    if (!s.ringless && same(next, s.sel) && s.selEnd === null) return s;
    effects.push({ t: "emit.select", r: next.r, c: next.c });
    if (scroll) effects.push({ t: "scroll.to", r: next.r });
    const hover = scroll && ctx.previewsHover === true ? null : s.hover;
    return { ...s, sel: next, selEnd: null, ringless: false, hover };
}

/** Where the first move key places the ring when none is placed (#1531): the first row's first cell that edits in place, else its first. */
function firstPlace(ctx: SheetMachineCtx): CellRef {
    for (let c = 0; c < ctx.colCount; c++) {
        if (ctx.editableAt(0, c) && ctx.opensAt?.(0, c) !== true) return { r: 0, c };
    }
    return { r: 0, c: 0 };
}

/** The keys that move the ring — what places it when none is placed (#1531). */
const MOVE_KEYS: ReadonlySet<string> = new Set(["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "PageDown", "PageUp", "Tab"]);

/** The column one step left or right of a cell — past the whole span of a band's title (#740). */
function stepColumn(r: number, c: number, dir: 1 | -1, ctx: SheetMachineCtx): number {
    const span = ctx.spanAt?.(r, c);
    if (span === undefined) return c + dir;
    return dir > 0 ? span.c1 + 1 : span.c0 - 1;
}

/** Open the editor on a cell — `seed` is a printable key that starts a fresh edit. */
function startEdit(s: SheetUiState, r: number, c: number, seed: string | undefined, ctx: SheetMachineCtx): Transition {
    if (r < 0 || r >= ctx.rowCount || c < 0 || c >= ctx.colCount) return { state: s, effects: [] };
    // A cell that steps in place, or edits out of place, never opens an editor (#1531).
    if (!ctx.editableAt(r, c) || ctx.stepAt?.(r, c, 1) !== undefined || ctx.opensAt?.(r, c) === true) return { state: s, effects: [] };
    const effects: SheetEffect[] = [];
    const moved = moveTo(s, { r, c }, ctx, effects);
    const linkCtx = ctx.linkAt?.(r, c);
    const val = linkCtx !== undefined ? seed ?? "" : seed ?? ctx.editTextAt(r, c);
    const opened: EditBuffer = {
        r, c, val, err: false, hi: seed !== undefined && seed.trim() !== "" ? 0 : -1, seeded: seed !== undefined,
        opened: seed === undefined && linkCtx === undefined ? val : undefined,
    };
    // Opened on the cell's own register member, the editor holds that member — the one of two who share its words.
    const own = seed === undefined && linkCtx === undefined ? ctx.memberAt?.(r, c) : undefined;
    const edit = own !== undefined ? withPick(opened, val, own, ctx) : opened;
    if (linkCtx !== undefined) {
        // Existing content becomes chips; a seed replaces it (the spreadsheet convention).
        const groups: LinkGroups = seed !== undefined ? [[], []] : [[...linkCtx.initial[0]], [...linkCtx.initial[1]]];
        edit.link = { side: linkStartSide(linkCtx.halves, groups), groups, chipSel: null, hop: 0 };
    }
    effects.push({ t: "focus.editor", selectAll: seed === undefined && linkCtx === undefined });
    effects.push({ t: "schedule.suggest", latency: "idle" });
    return { state: { ...moved, edit, selEnd: null, armed: null, gsel: null }, effects };
}

/**
 * The text a register-kind commit takes: the member a gesture chose, by its
 * key; else the armed candidate's key when a ghost or a stepped candidate
 * applies; else the words typed, which the parse resolves (#1536).
 */
export function commitText(edit: EditBuffer, ctx: SheetMachineCtx): string {
    if (!isRegisterKind(ctx.kindAt(edit.r, edit.c))) return edit.val;
    if (edit.pick !== undefined) return edit.pick;
    const cand = ctx.candidateAt(edit.r, edit.c, edit.val, edit.hi);
    if (cand !== undefined && edit.val.trim() !== "" && (ghostFor(edit.val, cand.label) !== "" || edit.hi > 0)) return cand.key;
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
    if (out.kind === "unrecognised") return variant("Invalid", edit.val);
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
    const effects: SheetEffect[] = [];
    // Closed on the text it opened with, nothing changed and nothing is
    // written (#852): re-reading a cell's own edit form could still change
    // it — the quantity grammar rounds to a whole number. An untouched
    // editor (its buffer as it opened, no candidate cycled) never takes a
    // ghost it was not asked for either. Holding a chosen member, it is
    // unchanged while that member is the cell's own (#1536).
    const own = edit.pick !== undefined ? ctx.memberAt?.(edit.r, edit.c) : undefined;
    const unchanged = edit.opened !== undefined && (edit.pick !== undefined
        ? own !== undefined && stringEqual(edit.pick, own)
        : text === edit.opened || (edit.val === edit.opened && edit.hi < 0));
    if (!unchanged) {
        const outcome = ctx.parse(edit.r, edit.c, text);
        effects.push({ t: "write", r: edit.r, c: edit.c, cell: outcome.kind === "cell" ? outcome.cell : outcome.kind === "unrecognised" ? variant("Invalid", text) : null, text });
    }
    let next: SheetUiState = { ...s, edit: null, armed: null };
    if (dir !== "blur") effects.push({ t: "focus.sheet" });
    next = moveAfterCommit(next, dir, ctx, effects);
    return { state: next, effects };
}

/** Commit the active editor and an accepted suggestion through one write per row. */
function acceptSuggestion(s: SheetUiState, ctx: SheetMachineCtx, take: (state: SheetUiState) => Transition): Transition {
    const committed = commitEdit(s, "stay", ctx);
    const accepted = take(committed.state);
    const pending = [...committed.effects, ...accepted.effects];
    const combinedRows = new Set(pending.filter(effect => effect.t === "write.many").map(effect => effect.r));
    const effects: SheetEffect[] = [];
    for (const effect of pending) {
        if (effect.t === "write" && combinedRows.has(effect.r)) continue;
        if (effect.t !== "write.many") { effects.push(effect); continue; }
        const writes = new Map<number, SheetCellValue>();
        for (const previous of committed.effects) {
            if (previous.t === "write" && previous.r === effect.r) writes.set(previous.c, previous.cell ?? variant("Null", null));
        }
        for (const write of effect.writes) writes.set(write.c, write.cell);
        effects.push({ ...effect, writes: [...writes].map(([c, cell]) => ({ c, cell })) });
    }
    return { state: accepted.state, effects };
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

/**
 * ↓ — the last row appends when the sheet allows it (never under a lens); on
 * a paged sheet whose source goes on past it, the ring steps onto the next
 * window's first row once it lands (#860).
 */
function moveDown(s: SheetUiState, ctx: SheetMachineCtx, effects: SheetEffect[]): SheetUiState {
    if (s.sel.r + 1 >= ctx.rowCount) {
        if (ctx.canAppend && !ctx.lensActive) {
            const sel = { r: s.sel.r + 1, c: s.sel.c };
            effects.push({ t: "emit.select", r: sel.r, c: sel.c }, { t: "scroll.to", r: sel.r });
            return { ...s, sel, selEnd: null, appended: s.appended + 1 };
        }
        if (ctx.edges?.atEnd === false) effects.push({ t: "seek.step", dir: 1, c: s.sel.c });
        return s.selEnd === null ? s : { ...s, selEnd: null };
    }
    return moveTo(s, { r: s.sel.r + 1, c: s.sel.c }, ctx, effects);
}

/** The last row that is not blank padding — where ⌘End lands (#860); the first row on a sheet of blanks. */
function lastFilledRow(ctx: SheetMachineCtx): number {
    let r = ctx.rowCount - 1;
    while (r > 0 && ctx.rowKindAt?.(r) === "blank") r--;
    return Math.max(0, r);
}

/** Fold or open the group whose band sits at `r` (#740); the ring lands on the band. */
function toggleFold(s: SheetUiState, r: number, ctx: SheetMachineCtx): Transition {
    const g = ctx.groupAt?.(r);
    if (g === undefined) return { state: s, effects: [] };
    const folds = new Map(s.folds);
    folds.set(g.id, !g.folded);
    const effects: SheetEffect[] = [];
    const moved = moveTo(s, { r, c: s.sel.c }, ctx, effects, false);
    return { state: { ...moved, folds, msg: { id: g.folded ? "groupOpened" : "groupFolded", noun: ctx.groupNoun?.singular } }, effects };
}

/**
 * What the ring re-finds once the body has re-formed: its group — the band
 * it is on, else the nearest band above (a line's) — or a loose row itself
 * (#846), which belongs to no group and stays where it is.
 */
function refindOfRing(r: number, ctx: SheetMachineCtx): string | undefined {
    if (ctx.looseAt?.(r) === true) return ctx.idAt?.(r);
    for (let k = r; k >= 0; k--) {
        if (ctx.rowKindAt?.(k) === "group") return ctx.groupAt?.(k)?.id;
    }
    return undefined;
}

/**
 * Fold or open EVERY group (the header's corner, ⌥ on a chevron, ⇧Space on a
 * band). The groups a lens hides fold too, so the state means the same once
 * the search clears. The ring stays with its group — or its loose row
 * (#846): the body re-forms under it, so it is re-found by id once the rows
 * have settled.
 */
function foldAll(s: SheetUiState, folded: boolean, ctx: SheetMachineCtx): Transition {
    const ids = ctx.groupIds ?? [];
    if (ids.length === 0) return { state: s, effects: [] };
    const folds = new Map(s.folds);
    for (const id of ids) folds.set(id, folded);
    const effects: SheetEffect[] = [];
    const refind = refindOfRing(s.sel.r, ctx);
    if (refind !== undefined) effects.push({ t: "select.id", id: refind, c: s.sel.c });
    const msg: SheetNotice = { id: folded ? "groupsFolded" : "groupsOpened", n: ids.length, noun: ctx.groupNoun?.singular, nouns: ctx.groupNoun?.plural };
    return { state: { ...s, selEnd: null, gsel: null, folds, msg }, effects };
}

/**
 * Show or hide the sub rows under the line at `r` (its chevron, Space);
 * `all` takes every line of its group the way this one goes. A hand's choice
 * is a fold override, so it persists with the view like a group's.
 */
function toggleSubRows(s: SheetUiState, r: number, all: boolean, ctx: SheetMachineCtx): Transition {
    const st = ctx.lineSubRowsAt?.(r);
    if (st === undefined) return { state: s, effects: [] };
    const open = !st.open;
    const folds = new Map(s.folds);
    const ids = all ? st.group : [st.id];
    for (const id of ids) folds.set(id, !open);
    const effects: SheetEffect[] = [];
    const moved = moveTo(s, { r, c: s.sel.c }, ctx, effects, false);
    const n = all ? ids.length : st.count;
    const noun = ctx.groupNoun?.singular;
    const msg: SheetNotice = all
        ? open ? { id: "subRowsShownAll", n, noun } : { id: "subRowsHidAll", noun }
        : open ? { id: "subRowsShown", n } : { id: "subRowsHid" };
    return { state: { ...moved, folds, msg }, effects };
}

/** The sheet's keyboard (B§6) — no editor open. */
function sheetKey(s: SheetUiState, e: Extract<SheetEvent, { t: "key" }>, ctx: SheetMachineCtx): Transition {
    // ⌘/ and ⌘F focus the rail's search (B§6) — whatever the sheet holds.
    if (e.meta && (e.key === "/" || e.key === "f")) return { state: s, effects: [{ t: "focus.search" }] };
    if (ctx.rowCount === 0 || ctx.colCount === 0) return { state: s, effects: [] };
    const effects: SheetEffect[] = [];
    // No ring placed (#1531): a move key places it on the first row's first cell that edits in place; esc climbs its
    // ladder as ever; every other key waits for a ring.
    if (s.ringless && e.key !== "Escape") {
        if (!MOVE_KEYS.has(e.key)) return { state: s, effects };
        return { state: moveTo(s, firstPlace(ctx), ctx, effects), effects };
    }
    // A summary folds on Space; ⇧Space folds or opens every group the way this one goes.
    const rowKind = ctx.rowKindAt?.(s.sel.r);
    if (rowKind === "group" && e.key === " " && !e.meta && !e.alt) {
        if (!e.shift) return toggleFold(s, s.sel.r, ctx);
        const g = ctx.groupAt?.(s.sel.r);
        return g === undefined ? { state: s, effects: [] } : foldAll(s, !g.folded, ctx);
    }
    // A line with sub rows: Space shows or hides them, ⇧Space every line's in the group (a line without them still takes Space as a keystroke).
    if (rowKind === "row" && e.key === " " && !e.meta && !e.alt && ctx.lineSubRowsAt?.(s.sel.r) !== undefined) {
        return toggleSubRows(s, s.sel.r, e.shift, ctx);
    }
    // A cell that steps in place (#1531): Space or ⏎ takes its next state (⇧ the one before), ⌫ a cycle's first, and a
    // key that names a member sets it — none opens an editor, and a read-only cell takes none of them.
    const stepAt = ctx.stepAt;
    if (stepAt !== undefined && (s.selEnd === null || same(s.selEnd, s.sel)) && !e.meta && !e.alt && stepAt(s.sel.r, s.sel.c, 1) !== undefined) {
        const { r, c } = s.sel;
        const write = (cell: SheetCellValue | undefined): Transition => ({ state: s, effects: ctx.editableAt(r, c) && cell !== undefined ? [{ t: "write", r, c, cell, text: "" }] : [] });
        if (e.key === " " || e.key === "Enter") return write(stepAt(r, c, e.shift ? -1 : 1));
        if (e.key === "Backspace" || e.key === "Delete") return write(stepAt(r, c, "first"));
        if (e.key.length === 1) return write(ctx.keyAt?.(r, c, e.key));
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
        // ↑ above the first resident row, the source going on above it (#860).
        if (dr === -1 && base.r === 0 && ctx.edges?.atStart === false) {
            effects.push({ t: "seek.step", dir: -1, c: base.c });
            return dropPick({ state: s.selEnd === null ? s : { ...s, selEnd: null }, effects });
        }
        return dropPick({ state: moveTo(s, { r: base.r + dr, c }, ctx, effects), effects });
    };
    /** Move — or, with ⇧, stretch the range — to a cell (#860). */
    const moveOrExtend = (to: CellRef): Transition => {
        if (e.shift) return dropPick({ state: { ...s, selEnd: clamp(to, ctx) }, effects });
        return dropPick({ state: moveTo(s, to, ctx, effects), effects });
    };
    /** ⏎ or F2: the editor opens on the ring's cell — or the host opens a cell that edits out of place (#1531). */
    const editRing = (): Transition => (ctx.opensAt?.(s.sel.r, s.sel.c) === true
        ? { state: s, effects: [{ t: "open", r: s.sel.r, c: s.sel.c }] }
        : startEdit(s, s.sel.r, s.sel.c, undefined, ctx));
    switch (e.key) {
        case "ArrowDown": return move(1, 0);
        case "ArrowUp": return move(-1, 0);
        case "ArrowLeft": return move(0, -1);
        case "ArrowRight": return move(0, 1);
        case "Home":
        case "End": {
            const first = e.key === "Home";
            const c = first ? 0 : ctx.colCount - 1;
            if (!e.meta) return moveOrExtend({ r: (e.shift && s.selEnd !== null ? s.selEnd : s.sel).r, c });
            // ⌘Home / ⌘End: the sheet's first or last cell — on a paged sheet not
            // at that end, a jump there, the ring landing once it arrives.
            if (!e.shift && (first ? ctx.edges?.atStart : ctx.edges?.atEnd) === false) {
                effects.push({ t: "seek.edge", edge: first ? "first" : "last", c });
                return dropPick({ state: s.selEnd === null ? s : { ...s, selEnd: null }, effects });
            }
            return moveOrExtend({ r: first ? 0 : lastFilledRow(ctx), c });
        }
        case "PageDown":
        case "PageUp": {
            // A page of rows — the rows the frame shows — however they draw.
            const n = Math.max(1, Math.floor(ctx.pageRows?.() ?? 10));
            const base = e.shift && s.selEnd !== null ? s.selEnd : s.sel;
            const down = e.key === "PageDown";
            // A page past the resident rows of a paged sheet whose source goes on that way (#1398, CL10): the window a
            // page on is asked for, and the ring lands there once it is in — fetch, then move — never at the loaded edge.
            if (!e.shift && (down ? base.r + n >= ctx.rowCount && ctx.edges?.atEnd === false : base.r - n < 0 && ctx.edges?.atStart === false)) {
                effects.push({ t: "seek.step", dir: down ? 1 : -1, c: base.c, page: { from: base.r, rows: n } });
                return dropPick({ state: s.selEnd === null ? s : { ...s, selEnd: null }, effects });
            }
            return moveOrExtend({ r: base.r + (down ? n : -n), c: base.c });
        }
        case "Tab": {
            const taken = suggestKey(s, e, ctx);
            if (taken !== null) return taken;
            return { state: moveTo(s, { r: s.sel.r, c: stepColumn(s.sel.r, s.sel.c, e.shift ? -1 : 1, ctx) }, ctx, effects), effects };
        }
        case "Enter": {
            const taken = suggestKey(s, e, ctx);
            if (taken !== null) return taken;
            if (e.meta) return { state: s, effects };
            return editRing();
        }
        case "F2":
            return editRing();
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
        return acceptSuggestion(s, ctx, state => e.shift && state.sugg !== null
            ? takeProposals(state, ctx, state.sugg.rows.length - 1) : fillRow(state, ctx));
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
            // The candidate stepped to is what commits now, not a member chosen before.
            return { state: { ...s, edit: { ...edit, hi, pick: undefined } }, effects: [{ t: "schedule.suggest", latency: "instant" }] };
        }
        return { state: s, effects: [] };
    }
    if (e.key === "Enter") return commitEdit(s, "down", ctx);
    if (e.key === "Tab") {
        if (!e.shift && isRegisterKind(kind)) {
            const cand = ctx.candidateAt(edit.r, edit.c, edit.val, edit.hi);
            const ghost = ghostFor(edit.val, cand?.label);
            const resolve = resolveFor(edit.val, cand?.label);
            if (cand !== undefined && (ghost !== "" || resolve !== "")) {
                return {
                    state: { ...s, edit: withPick(edit, ghost !== "" ? edit.val + ghost : resolve, cand.key, ctx) },
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
        const ghost = ghostFor(edit.val, cand?.label);
        if (cand !== undefined && ghost !== "") {
            const take = e.meta ? ghost : ghostWord(ghost);
            // The whole ghost takes its candidate; a word of it is still typing.
            const next = take === ghost ? withPick(edit, edit.val + take, cand.key, ctx) : { ...edit, val: edit.val + take, pick: undefined };
            return { state: { ...s, edit: next }, effects: [] };
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
    // Tab, narrowing and search events run on a grouped sheet too: its lens
    // works on the groups, the records (#1349).
    switch (e.t) {
        case "cell.down": {
            // A click commits an open editor in place first.
            const closed = s.edit !== null ? commitEdit(s, "stay", ctx) : { state: s, effects: [] as SheetEffect[] };
            const effects = closed.effects;
            // A cell that steps in place (#1531): the press takes its next state, ⇧ the one before — never a range. With
            // no ring placed, a ⇧ press has no range to stretch, and places the ring as a press does.
            const stepped = ctx.stepAt?.(e.r, e.c, e.shift ? -1 : 1);
            if (e.shift && stepped === undefined && !closed.state.ringless) {
                return { state: { ...closed.state, selEnd: clamp({ r: e.r, c: e.c }, ctx), gsel: null }, effects };
            }
            const moved = moveTo(closed.state, { r: e.r, c: e.c }, ctx, effects, false);
            effects.push({ t: "focus.sheet" });
            if (stepped !== undefined && ctx.editableAt(e.r, e.c)) {
                // The editor's commit is its own undo step, the step another.
                if (s.edit !== null) effects.push({ t: "gesture.end" });
                effects.push({ t: "write", r: e.r, c: e.c, cell: stepped, text: "" });
            }
            // A cell that edits out of place opens where the host edits it (#1531).
            if (!e.shift && ctx.opensAt?.(e.r, e.c) === true) effects.push({ t: "open", r: e.r, c: e.c });
            return { state: moved.gsel === null ? moved : { ...moved, gsel: null }, effects };
        }
        case "cell.dbl":
            return startEdit(s, e.r, e.c, undefined, ctx);
        case "cell.enter": {
            if (e.dragging) return { state: { ...s, selEnd: clamp({ r: e.r, c: e.c }, ctx) }, effects: [] };
            if (s.hover !== null && s.hover.r === e.r && s.hover.c === e.c) return { state: s, effects: [] };
            return { state: { ...s, hover: { r: e.r, c: e.c } }, effects: [] };
        }
        case "cell.leave":
            return { state: s.hover === null ? s : { ...s, hover: null }, effects: [] };
        case "row.pick": {
            const closed = s.edit !== null ? commitEdit(s, "stay", ctx) : { state: s, effects: [] as SheetEffect[] };
            const effects = closed.effects;
            const last = Math.max(0, ctx.colCount - 1);
            if (e.shift && !closed.state.ringless) return { state: { ...closed.state, selEnd: clamp({ r: e.r, c: last }, ctx), gsel: null }, effects };
            // A band's gutter selects the group's lines (#740, G7); an empty or folded group selects the band itself.
            const group = ctx.rowKindAt?.(e.r) === "group" ? ctx.groupAt?.(e.r) : undefined;
            const r0 = group?.lines !== undefined ? group.lines.r0 : e.r;
            const r1 = group?.lines !== undefined ? group.lines.r1 : e.r;
            const selected = wholeRows(closed.state, ctx.colCount);
            if (selected !== null && selected.r0 === r0 && selected.r1 === r1) {
                effects.push({ t: "focus.sheet" });
                return { state: { ...closed.state, selEnd: null, gsel: null }, effects };
            }
            effects.push({ t: "emit.select", r: r0, c: 0 }, { t: "focus.sheet" });
            return { state: { ...closed.state, sel: clamp({ r: r0, c: 0 }, ctx), selEnd: clamp({ r: r1, c: last }, ctx), gsel: null, ringless: false }, effects };
        }
        case "key":
            if (s.edit !== null) return { state: s, effects: [] };
            return sheetKey(s, e, ctx);
        case "editor.change": {
            if (s.edit === null) return { state: s, effects: [] };
            if (s.edit.link !== undefined) return linkChange(s, e.val, ctx);
            const hi = e.val.trim() === "" ? -1 : 0;
            // Typing lets a chosen member go: the words typed are what commits now.
            return { state: { ...s, edit: { ...s.edit, val: e.val, err: false, hi, pick: undefined } }, effects: [{ t: "schedule.suggest", latency: "idle" }] };
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
                    state: { ...s, msg: { id: "membersAdded", n: members.length }, edit: { ...s.edit, val: "", hi: -1, err: false, link: { ...link, groups, chipSel: null } } },
                    effects: [{ t: "focus.editor", selectAll: false }, { t: "schedule.suggest", latency: "instant" }],
                };
            }
            // A candidate chip: its member, in the words it shows.
            return {
                state: { ...s, edit: e.key !== undefined ? withPick(s.edit, e.label, e.key, ctx) : { ...s.edit, val: e.label, hi: e.i, err: false } },
                effects: [{ t: "focus.editor", selectAll: false }, { t: "schedule.suggest", latency: "instant" }],
            };
        }
        case "editor.pick":
            // The combobox chose a member: its words in the buffer, the member itself what commits.
            if (s.edit === null || s.edit.link !== undefined) return { state: s, effects: [] };
            return { state: { ...s, edit: withPick(s.edit, e.label, e.key, ctx) }, effects: [{ t: "schedule.suggest", latency: "instant" }] };
        case "half.down": {
            if (s.edit === null || s.edit.link === undefined) return { state: s, effects: [] };
            if (s.edit.link.side === e.side) return { state: s, effects: [{ t: "focus.editor", selectAll: false }] };
            return switchSide(s, e.side, ctx);
        }
        case "select.move": {
            // A key's move landing once its window has (#860) — a key moves nothing while an editor is open.
            if (s.edit !== null) return { state: s, effects: [] };
            const effects: SheetEffect[] = [];
            const moved = moveTo(s, { r: e.r, c: e.c }, ctx, effects);
            return { state: moved.gsel === null ? moved : { ...moved, gsel: null }, effects };
        }
        case "select.set": {
            // The host moved the ring: commit an open editor in place, follow, scroll — no echo.
            const closed = s.edit !== null ? commitEdit(s, "stay", ctx) : { state: s, effects: [] as SheetEffect[] };
            const sel = clamp({ r: e.r, c: e.c }, ctx);
            if (!closed.state.ringless && same(sel, closed.state.sel) && closed.state.selEnd === null) return closed;
            closed.effects.push({ t: "scroll.to", r: sel.r });
            return { state: { ...closed.state, sel, selEnd: null, ringless: false }, effects: closed.effects };
        }
        case "rows.changed": {
            // Each place follows its row when the rows moved under it (#854);
            // one whose row left keeps its index, clamped — but not an open
            // editor: over the row now at that index its text would land on
            // that row. It closes, uncommitted, and the footer says why (#877).
            const follow = <T extends CellRef>(ref: T): T => {
                const r = e.moved?.(ref.r);
                return r === undefined || r === null || r === ref.r ? ref : { ...ref, r };
            };
            const editLeft = s.edit !== null && e.moved?.(s.edit.r) === null;
            const sel = clamp(follow(s.sel), ctx);
            const selEnd = s.selEnd !== null ? clamp(follow(s.selEnd), ctx) : null;
            const moved = s.edit !== null && !editLeft ? follow(s.edit) : null;
            const edit = moved !== null && moved.r < ctx.rowCount && moved.c < ctx.colCount ? moved : null;
            const hover = s.hover !== null ? follow(s.hover) : null;
            const armed = s.armed !== null ? follow(s.armed) : null;
            const msg: SheetNotice | null = editLeft ? { id: "rowLeft" } : s.msg;
            const clamped = same(sel, s.sel) && (selEnd === null ? s.selEnd === null : same(selEnd, s.selEnd)) && edit === s.edit && hover === s.hover && armed === s.armed && msg === s.msg
                ? s
                : { ...s, sel, selEnd, edit, hover, armed, msg };
            return { state: afterRowsChanged(clamped, ctx), effects: editLeft ? [{ t: "focus.sheet" }] : [] };
        }
        case "msg":
            return s.msg === e.msg ? { state: s, effects: [] } : { state: { ...s, msg: e.msg }, effects: [] };
        // With no ring placed there is nothing to copy, and nowhere to paste (#1531).
        case "clipboard.copy": {
            if (s.edit !== null || s.ringless) return { state: s, effects: [] };
            return { state: s, effects: [{ t: "copy", ...selectionRect(s) }] };
        }
        case "clipboard.paste": {
            if (s.edit !== null || s.ringless) return { state: s, effects: [] };
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
            return acceptSuggestion(s, ctx, state => takeFill(state, ctx, e.key));
        case "fill.row":
            return acceptSuggestion(s, ctx, state => fillRow(state, ctx));
        case "proposal.pick": {
            const closed = s.edit !== null ? commitEdit(s, "stay", ctx) : { state: s, effects: [] as SheetEffect[] };
            if (closed.state.sugg === null || e.i < 0 || e.i >= closed.state.sugg.rows.length) return closed;
            closed.effects.push({ t: "focus.sheet" });
            return { state: { ...closed.state, gsel: e.i, selEnd: null, armed: null }, effects: closed.effects };
        }
        case "proposal.take":
            return acceptSuggestion(s, ctx, state => takeProposals(state, ctx, e.i));
        case "proposal.reject":
            return rejectProposal(s, ctx, e.i);
        // ── The narrowing and the tabs (B§8) ───────────────────────────────
        case "narrowing.changed":
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
        case "tab.open": {
            const t = switchTab(s, ctx, e.id, false);
            // The folds the last session left on this tab (#857), newer than the view's own.
            return e.folds === undefined || t.state === s ? t : { ...t, state: { ...t.state, folds: e.folds } };
        }
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
            // ⌥ on the chevron: every group goes the way this one does.
            const g = e.all === true ? ctx.groupAt?.(e.r) : undefined;
            const t = g !== undefined ? foldAll(closed.state, !g.folded, ctx) : toggleFold(closed.state, e.r, ctx);
            return { state: t.state, effects: [...closed.effects, ...t.effects] };
        }
        case "fold.all": {
            const closed = s.edit !== null ? commitEdit(s, "stay", ctx) : { state: s, effects: [] as SheetEffect[] };
            const t = foldAll(closed.state, e.folded, ctx);
            return { state: t.state, effects: [...closed.effects, ...t.effects] };
        }
        case "subRows.toggle": {
            // A line's chevron: an open editor commits first, the ring lands on the line.
            const closed = s.edit !== null ? commitEdit(s, "stay", ctx) : { state: s, effects: [] as SheetEffect[] };
            const t = toggleSubRows(closed.state, e.r, e.all === true, ctx);
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

/**
 * The initial store — `active` is the initial view tab, if the sheet opens on one; `folds`, the fold overrides it opens
 * with (#857); `ringless`, whether it opens with no ring placed (#1531).
 */
export function initialSheetStore(sel?: CellRef, active: string | null = null, folds?: ReadonlyMap<string, boolean>, ringless = false): SheetStore {
    return { ui: initialSheetState(sel, active, folds, ringless), fx: [], fxSeq: 0 };
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
