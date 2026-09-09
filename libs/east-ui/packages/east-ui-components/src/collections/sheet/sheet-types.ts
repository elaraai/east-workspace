/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The state machine's vocabulary (`Sheet Spec.md` §6.1): the UI state, the
 * events the surface reports, the effects a transition returns as data, and
 * the context a transition may ask about the sheet. The transitions live in
 * `sheet-state.ts` (the core), `sheet-link-state.ts` (the link editor) and
 * `sheet-suggest-state.ts` (the copilot); every module imports its types from
 * here so none imports another's functions.
 *
 * @packageDocumentation
 */

import type { SheetKind } from "./model.js";
import type { ParseOutcome } from "./parse/index.js";
import type { LinkCandidate } from "./link/predict.js";
import type { LinkHalves } from "./link/sides.js";
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

/** A cell position in the sheet's ROW space (bands and proposal rows are not rows). */
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

/** One pending fill — the cell the copilot proposes for a blank cell, with its provenance (B§5.1). */
export interface PendingFill {
    cell: SheetCellValue;
    /** The provenance line the strip prints. */
    meta: string;
    /** The provider's position in the column's list — an earlier async provider that lands replaces a later one's fill. */
    index: number;
}

/** One proposed row — the cells a patch set, with its provenance (B§5.2). */
export interface PendingRow {
    cells: ReadonlyMap<string, SheetCellValue>;
    meta: string;
}

/** The copilot's pending suggestions for one anchor row (B§5). */
export interface Suggestions {
    /** The anchor row — a real row's id, or a blank row's synthetic id ({@link blankRowId}). */
    anchorId: string;
    /** Pending fills by column key. */
    fill: ReadonlyMap<string, PendingFill>;
    /** Proposed rows below the anchor, at most `ahead`. */
    rows: readonly PendingRow[];
    /** Providers still in flight — a column key, or `"rows"` for a proposer. */
    pending: readonly string[];
}

/** What the planner rejected — remembered for the session so it is not offered again (B§5.2). */
export interface Rejections {
    /** `${anchorId}|${key}` — a fill dismissed on a row. */
    fills: ReadonlySet<string>;
    /** `${driverKey}>${driverKey}` — a proposed follower rejected after a driver value. */
    follows: ReadonlySet<string>;
}

/** All ephemeral UI state — one object, one reducer. */
export interface SheetUiState {
    /** The ring. */
    sel: CellRef;
    /** The range's far corner, when a range is active. */
    selEnd: CellRef | null;
    /** The open editor. */
    edit: EditBuffer | null;
    /** The hovered cell (the ✓ take button's home). */
    hover: CellRef | null;
    /** The footer's `aria-live` line. */
    msg: string;
    /** Rows appended past the padding with ↓ on the last row. */
    appended: number;
    /** The copilot's pending suggestions. */
    sugg: Suggestions | null;
    /** The fill the planner armed with Tab — the next target while it is pending. */
    armed: CellRef | null;
    /** The selected proposal row (its index under the anchor). */
    gsel: number | null;
    /** The session's rejection memory. */
    rejected: Rejections;
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
    | { t: "clipboard.paste"; text: string }
    /** The copilot runner's result for an anchor (`null` = nothing to suggest). */
    | { t: "suggest.ready"; anchorId: string; sugg: Suggestions | null }
    /** An async provider settled: a fill for a column (`null` = it yielded nothing), or a proposer's rows. */
    | { t: "suggest.landed"; anchorId: string; key: string; fill?: PendingFill | null; rows?: PendingRow[] }
    /** The anchor became a real row (a blank row's first write): the suggestions follow its new id. */
    | { t: "suggest.rekey"; from: string; to: string }
    /** Every suggestion dropped (a new source). */
    | { t: "suggest.clear" }
    /** ✓ on a fill, or its strip chip. */
    | { t: "fill.take"; key: string }
    /** The gutter's → button: fill the whole row. */
    | { t: "fill.row" }
    /** A click on a proposal row selects it. */
    | { t: "proposal.pick"; i: number }
    /** ✓ on a proposal row — takes the row fill and the proposals up to it. */
    | { t: "proposal.take"; i: number }
    /** × on a proposal row — rejects it and remembers the pairing. */
    | { t: "proposal.reject"; i: number };

/** Where an edit came from (the wire `SheetSourceType` tags). */
export type EditSource = "typed" | "pasted" | "fill" | "row" | "pattern";

/** Side effects, returned as data — never performed in the reducer. */
export type SheetEffect =
    /** Write one cell (`null` = blank) — the component turns it into a commit or an insert. */
    | { t: "write"; r: number; c: number; cell: SheetCellValue | null; text: string }
    /** Write several cells of one row — a fill taken (`fill`) or the whole row filled (`row`). */
    | { t: "write.many"; r: number; writes: readonly { c: number; cell: SheetCellValue }[]; source: EditSource }
    /** Insert proposed rows after the anchor, in order; `rest` re-anchors on the last one inserted. */
    | { t: "insert.rows"; anchorR: number; rows: readonly PendingRow[]; rest: readonly PendingRow[] }
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
    /** Re-ask the copilot for the edited row after the kind's latency (`instant` = 150 ms). */
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
    /** The row-space index of a row id — a real row's, or a blank row's synthetic id (`undefined` when not resident). */
    rowOf?: (id: string) => number | undefined;
    /** The id at a row-space index — a real row's, or a blank row's synthetic id. */
    idAt?: (r: number) => string | undefined;
    /** The column index of a key. */
    columnOf?: (key: string) => number | undefined;
    /** The driver member key a row resolves to. */
    driverKeyAt?: (r: number) => string | undefined;
    /** The driver column's key — a proposal's driver value sits under it. */
    driverColumn?: string | undefined;
    /** The 1-based row number at a row-space index (the footer's messages). */
    numberAt?: (r: number) => number;
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
    /** The predicted members for a half — the column's pending fill minus what the cell holds. */
    predicted: (side: 0 | 1, groups: LinkGroups, typed: string) => SheetMemberValue[];
    /** The cell for the halves — `null` when both are empty. */
    cell: (groups: LinkGroups) => SheetCellValue | null;
    /** The driver member's name, for the hop-into-a-locked-half message. */
    driverName: string;
}

/** One transition's result. */
export interface Transition {
    state: SheetUiState;
    effects: SheetEffect[];
}

/** The empty rejection memory. */
export const NO_REJECTIONS: Rejections = { fills: new Set(), follows: new Set() };

/** The initial UI state. */
export function initialSheetState(sel: CellRef = { r: 0, c: 0 }): SheetUiState {
    return { sel, selEnd: null, edit: null, hover: null, msg: "", appended: 0, sugg: null, armed: null, gsel: null, rejected: NO_REJECTIONS };
}

/** Whether two cell refs name the same cell. */
export function same(a: CellRef, b: CellRef | null): boolean {
    return b !== null && a.r === b.r && a.c === b.c;
}

/** Clamp a cell to the sheet. */
export function clamp(ref: CellRef, ctx: SheetMachineCtx): CellRef {
    return {
        r: Math.max(0, Math.min(Math.max(0, ctx.rowCount - 1), ref.r)),
        c: Math.max(0, Math.min(Math.max(0, ctx.colCount - 1), ref.c)),
    };
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

/** The synthetic id of a blank padding row at a sheet position — the copilot's anchor before the row is real. */
export function blankRowId(position: number): string {
    return ` blank:${position}`;
}

/** Whether an id names a blank padding row. */
export function isBlankRowId(id: string): boolean {
    return id.startsWith(" blank:");
}
