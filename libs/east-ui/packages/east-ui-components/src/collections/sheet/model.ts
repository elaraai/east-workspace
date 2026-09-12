/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet model (`Sheet Spec.md` §6) — the decoded value turned into what
 * the renderer walks: the column index, the body (real rows in sheet order,
 * the paged arm's unloaded bands, the blank padding rows), the driver lookup
 * and the cell display helpers.
 *
 * On a GROUPED sheet (#740) the body is the groups' BANDS with their lines
 * under them: a line is a `real` item whose row is a pseudo wire row over
 * the line's cells (so every cell helper reads it as a row) tagged with its
 * group ({@link LineGroup}); each open group ends with one blank line; the
 * body ends with the `+ plan` ghost band.
 *
 * Pure: no React, no DOM. The interaction state lives in `sheet-state.ts`;
 * the data lives in the component (local rows over the decoded value).
 *
 * @packageDocumentation
 */

import { none, variant } from "@elaraai/east";
import { formatDatePattern } from "../../charts/spec/index.js";
import { formatTick, type TickFormatOpt } from "../../typography/numeric/format-tick.js";
import { getSomeorUndefined } from "../../utils.js";
import type {
    SheetCellValue, SheetColumnValue, SheetCustomKindValue, SheetGroupValue, SheetLineValue, SheetLinkValue, SheetMemberValue,
    SheetRegisterMemberValue, SheetRootValue, SheetRowValue,
} from "./values.js";
import type { LensGap } from "./lens.js";
import { blankRowId } from "./sheet-types.js";
import { DATE_DISPLAY_PATTERN } from "./parse/date.js";

// ── Columns ───────────────────────────────────────────────────────────────

/** The column kinds (the arms of `SheetColumnKindType`). */
export type SheetKind =
    | "text" | "date" | "quantity" | "integer" | "lookup" | "reference" | "enum"
    | "set" | "link" | "stamped" | "custom";

/** Default column widths per kind (px) when the author declares none. */
const DEFAULT_WIDTH: Record<SheetKind, number> = {
    text: 200, date: 96, quantity: 112, integer: 72, lookup: 200, reference: 120, enum: 124,
    set: 240, link: 352, stamped: 104, custom: 140,
};

/** The copilot latency class of a kind (B§3): deterministic kinds are instant. */
export function latencyOf(kind: SheetKind): "instant" | "idle" {
    switch (kind) {
        case "date": case "integer": case "lookup": case "reference": case "enum": return "instant";
        default: return "idle";
    }
}

/** One decoded column, flattened for the renderer. */
export interface SheetColumnMeta {
    /** The column key — the row field it sits on. */
    key: string;
    /** The header line. */
    header: string;
    /** The grey second header line. */
    sub: string | undefined;
    /** Track width in px. */
    width: number;
    /** The kind tag. */
    kind: SheetKind;
    /** Whether the sheet writes the column. */
    editable: boolean;
    /** The register the column resolves against (lookup · reference · enum · set · link). */
    register: string | undefined;
    /** A date column's base column (`4d` counts from it). */
    base: string | undefined;
    /** A date column's display pattern (East date tokens). */
    dateFormat: string | undefined;
    /** A quantity column's unit per driver key. */
    uom: ReadonlyMap<string, string> | undefined;
    /** A quantity column's display format. */
    format: TickFormatOpt;
    /** A stamped column's owner. */
    owner: string | undefined;
    /** A custom kind's "accepts" line. */
    accepts: string | undefined;
    /** A custom kind's compiled parse — typed text + the wire context → an optional cell. */
    customParse: SheetCustomKindValue["parse"] | undefined;
    /** A custom kind's compiled print. */
    customPrint: SheetCustomKindValue["print"] | undefined;
    /** The raw decoded column (the link kind's declaration rides here for P3). */
    raw: SheetColumnValue;
}

/** The column index — in declaration order, and by key. */
export interface SheetColumnIndex {
    list: readonly SheetColumnMeta[];
    byKey: ReadonlyMap<string, SheetColumnMeta>;
    /** Σ widths, for the body's min-width. */
    totalWidth: number;
}

/** Flatten the decoded columns. */
export function indexColumns(columns: readonly SheetColumnValue[]): SheetColumnIndex {
    const list = columns.map((col): SheetColumnMeta => {
        const kind = col.kind;
        const meta: SheetColumnMeta = {
            key: col.key,
            header: col.header,
            sub: getSomeorUndefined(col.sub),
            width: parseWidth(getSomeorUndefined(col.width)) ?? DEFAULT_WIDTH[kind.type],
            kind: kind.type,
            editable: col.editable,
            register: undefined,
            base: undefined,
            dateFormat: undefined,
            uom: undefined,
            format: undefined,
            owner: undefined,
            accepts: undefined,
            customParse: undefined,
            customPrint: undefined,
            raw: col,
        };
        // The kind's payload, by its arm — the decoded variant narrows on `type`.
        switch (kind.type) {
            case "date":
                meta.base = getSomeorUndefined(kind.value.base);
                meta.dateFormat = getSomeorUndefined(kind.value.format);
                break;
            case "quantity":
                meta.uom = getSomeorUndefined(kind.value.uom);
                meta.format = getSomeorUndefined(kind.value.format);
                break;
            case "lookup":
            case "reference":
            case "enum":
            case "set":
            case "link":
                meta.register = kind.value.register;
                break;
            case "stamped":
                meta.owner = getSomeorUndefined(kind.value.owner);
                break;
            case "custom":
                meta.accepts = kind.value.accepts;
                meta.customParse = kind.value.parse;
                meta.customPrint = kind.value.print;
                break;
            default:
                break;
        }
        return meta;
    });
    return {
        list,
        byKey: new Map(list.map((c) => [c.key, c])),
        totalWidth: list.reduce((sum, c) => sum + c.width, 0),
    };
}

/** A declared CSS width to px — a bare number or a `px` length; anything else falls back. */
export function parseWidth(raw: string | undefined): number | undefined {
    if (raw === undefined) return undefined;
    const m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/.exec(raw);
    return m ? Math.round(Number(m[1])) : undefined;
}

// ── Grouped rows (#740) ───────────────────────────────────────────────────

/** The cell key a group's title rides under — the wire's `SHEET_TITLE_CELL`. */
export const TITLE_KEY = "$title";

/** The separator inside a line's synthetic id — the group's id, then the line's wire key. */
export const LINE_ID_SEP = "\u001f";

/** A line's synthetic id — its group's id and its wire key. */
export function lineId(groupId: string, key: string): string {
    return `${groupId}${LINE_ID_SEP}${key}`;
}

/** The group id and line key a synthetic line id names, or `undefined` for a plain row id. */
export function parseLineId(id: string): { groupId: string; key: string } | undefined {
    const at = id.indexOf(LINE_ID_SEP);
    if (at < 0) return undefined;
    return { groupId: id.slice(0, at), key: id.slice(at + 1) };
}

/** The synthetic id of a group's blank line — the copilot's anchor before the line is real. */
export function blankLineId(groupId: string): string {
    return ` blank:g:${groupId}`;
}

/** The synthetic id of the `+ plan` ghost band. */
export const GHOST_BAND_ID = " blank:+";

/** The wire key a line that the source does not hold yet carries — never a source index. */
export const NEW_LINE_KEY = "+";

/** How a line item knows its group: the group's wire row, the line's wire key, its index among the group's wire lines, its 1-based number. */
export interface LineGroup {
    row: SheetRowValue;
    key: string;
    index: number;
    number: number;
}

/**
 * The band's cells and the title span, decoded from the wire group
 * declaration against the line columns.
 */
export interface SheetGroupIndex {
    /** The field holding the lines. */
    linesField: string;
    /** `Dict` lines — a line's address is its key, not its position. */
    keyed: boolean;
    /** The band's cells by the line column key they sit under (the title under {@link TITLE_KEY}). */
    cells: ReadonlyMap<string, SheetColumnMeta>;
    /** How many leading columns the title spans — up to three, stopping before the first column with a band cell. */
    titleSpan: number;
}

/** Decode the wire group declaration. */
export function indexGroup(group: SheetGroupValue, columns: SheetColumnIndex): SheetGroupIndex {
    const cells = new Map<string, SheetColumnMeta>();
    for (const cell of group.cells) {
        const meta = indexColumns([{
            key: cell.key, header: cell.key === TITLE_KEY ? "Title" : columns.byKey.get(cell.key)?.header ?? cell.key,
            sub: none, width: none, kind: cell.kind, dataType: cell.dataType, payloadType: cell.payloadType, editable: cell.editable, fill: [],
        }]).list[0]!;
        cells.set(cell.key, meta);
    }
    let firstCell = columns.list.length;
    columns.list.forEach((c, i) => { if (i < firstCell && cells.has(c.key)) firstCell = i; });
    return { linesField: group.lines, keyed: group.keyed, cells, titleSpan: Math.max(1, Math.min(3, columns.list.length, firstCell)) };
}

// A line's pseudo row is built once per group row and wire key, so its
// identity is stable across body builds (the check cache, the row memo).
const lineRows = new WeakMap<SheetRowValue, Map<string, SheetRowValue>>();

/** A line as a wire row — its group's id and key in the id, the group's `owned`, the line's cells. */
export function lineRowOf(group: SheetRowValue, line: SheetLineValue): SheetRowValue {
    let byKey = lineRows.get(group);
    if (byKey === undefined) { byKey = new Map(); lineRows.set(group, byKey); }
    const known = byKey.get(line.key);
    if (known !== undefined && known.cells === line.cells) return known;
    const row: SheetRowValue = { id: lineId(group.id, line.key), owned: group.owned, cells: line.cells, lines: [], band: none };
    byKey.set(line.key, row);
    return row;
}

/** The pseudo rows of a group's lines, in order. */
export function lineRowsOf(group: SheetRowValue): SheetRowValue[] {
    return group.lines.map((l) => lineRowOf(group, l));
}

/** A group row with one line's cells replaced (by wire key), or appended when the key is not among its lines. */
export function withLine(group: SheetRowValue, key: string, cells: ReadonlyMap<string, SheetCellValue>): SheetRowValue {
    const lines = group.lines.map((l) => (l.key === key ? { key, cells: cells as Map<string, SheetCellValue> } : l));
    if (!group.lines.some((l) => l.key === key)) lines.push({ key, cells: cells as Map<string, SheetCellValue> });
    return { ...group, lines };
}

/** A group row without the lines at the given wire keys. */
export function withoutLines(group: SheetRowValue, keys: ReadonlySet<string>): SheetRowValue {
    return { ...group, lines: group.lines.filter((l) => !keys.has(l.key)) };
}

/** A line's ADDRESS in an edit event — its position on `Array` lines, its key on `Dict` lines. */
export function lineAddress(keyed: boolean, key: string, index: number): string {
    return keyed ? key : String(index);
}

/** The positions a group's lines take in the lens — one stride per group, so reveals and gap keys stay per line. */
export const LINE_POSITION_STRIDE = 1 << 20;

/** A line's lens position. */
export function linePosition(groupPosition: number, index: number): number {
    return groupPosition * LINE_POSITION_STRIDE + index;
}

/** The line index a lens position names. */
export function lineIndexOfPosition(position: number): number {
    return position % LINE_POSITION_STRIDE;
}

/** The band's height per density (px). */
export function groupBandPx(size: "sm" | "md" | "lg"): number {
    return size === "sm" ? 32 : size === "lg" ? 46 : 40;
}

// ── Registers and the driver ───────────────────────────────────────────────

/** The registers by name, with each member indexed by key and by lower-cased alias. */
export interface SheetRegisterIndex {
    byName: ReadonlyMap<string, readonly SheetRegisterMemberValue[]>;
    /** Register name → lower-cased key or alias → member. */
    lookup: ReadonlyMap<string, ReadonlyMap<string, SheetRegisterMemberValue>>;
}

/** Index the decoded registers. */
export function indexRegisters(registers: ReadonlyMap<string, { members: readonly SheetRegisterMemberValue[] }>): SheetRegisterIndex {
    const byName = new Map<string, readonly SheetRegisterMemberValue[]>();
    const lookup = new Map<string, ReadonlyMap<string, SheetRegisterMemberValue>>();
    for (const [name, reg] of registers) {
        byName.set(name, reg.members);
        const idx = new Map<string, SheetRegisterMemberValue>();
        for (const m of reg.members) {
            const k = m.key.toLowerCase();
            if (!idx.has(k)) idx.set(k, m);
            for (const a of m.aliases) {
                const al = a.toLowerCase();
                if (!idx.has(al)) idx.set(al, m);
            }
        }
        lookup.set(name, idx);
    }
    return { byName, lookup };
}

/** The member a register resolves `text` to — by key or alias, case-insensitively. */
export function resolveMember(index: SheetRegisterIndex, register: string | undefined, text: string): SheetRegisterMemberValue | undefined {
    if (register === undefined) return undefined;
    return index.lookup.get(register)?.get(text.trim().toLowerCase());
}

/** The driver member key a row resolves to — its driver column's String cell. */
export function driverKeyOf(row: SheetRowValue | undefined, driverColumn: string | undefined): string | undefined {
    if (row === undefined || driverColumn === undefined) return undefined;
    const cell = row.cells.get(driverColumn);
    if (cell === undefined || cell.type !== "String") return undefined;
    return cell.value === "" ? undefined : cell.value;
}

// ── Cells ─────────────────────────────────────────────────────────────────

/** The blank cell. */
export const NULL_CELL: SheetCellValue = variant("Null", null);

/** The empty link — both halves empty. */
export const EMPTY_LINK: SheetLinkValue = { from: [], to: [] };

/** Whether a cell is blank (`Null`, an empty string, or an empty link). */
export function cellIsBlank(cell: SheetCellValue | undefined): boolean {
    if (cell === undefined) return true;
    switch (cell.type) {
        case "Null": return true;
        case "String": return cell.value === "";
        case "Link": return cell.value.from.length === 0 && cell.value.to.length === 0;
        default: return false;
    }
}

/** Whether a row is blank — every declared cell blank. */
export function rowIsBlank(row: SheetRowValue, columns: SheetColumnIndex): boolean {
    for (const c of columns.list) {
        if (!cellIsBlank(row.cells.get(c.key))) return false;
    }
    return true;
}

/** A link member's display label (the grammar's print form, B§4.1). */
export function memberLabel(m: SheetMemberValue): string {
    switch (m.type) {
        case "identified": return m.value.key;
        case "range": return `${m.value.from}-${m.value.to}`;
        case "counted": return `${m.value.n} × ${m.value.key}`;
        case "placeholder": return "TBC";
        case "text": return m.value;
    }
    return "";
}

/** Whether a member draws as a dashed chip (text · placeholder). */
export function memberIsDashed(m: SheetMemberValue): boolean {
    return m.type === "text" || m.type === "placeholder";
}

/** A link value's planner text — `a > b` · `b` · `a >` (B§4.2). */
export function printLinkText(link: SheetLinkValue): string {
    const a = link.from.map(memberLabel).join(", ");
    const b = link.to.map(memberLabel).join(", ");
    if (a !== "" && b !== "") return `${a} > ${b}`;
    if (a !== "") return `${a} >`;
    return b;
}

/** A quantity's display text — locale-grouped through the declared format. */
export function formatQuantity(n: number, format: TickFormatOpt): string {
    if (!Number.isFinite(n)) return "";
    return formatTick(n, format);
}

/** A date's display text — the author's pattern, else `17 Nov 26`; East's own printer either way. */
export function formatDateCell(d: Date, pattern: string | undefined): string {
    return formatDatePattern(pattern !== undefined && pattern !== "" ? pattern : DATE_DISPLAY_PATTERN, d);
}

/**
 * A cell's display text by kind (the read-only rendering). A link cell prints
 * through the grammar; a custom kind through its compiled `print`.
 */
export function cellText(cell: SheetCellValue | undefined, meta: SheetColumnMeta): string {
    if (cell === undefined || cell.type === "Null") return "";
    switch (meta.kind) {
        case "custom":
            if (meta.customPrint !== undefined) {
                try { return meta.customPrint(cell); } catch (err) { console.error(`[Sheet] custom print failed on column "${meta.key}":`, err); }
            }
            return rawCellText(cell);
        case "date":
            return cell.type === "DateTime" ? formatDateCell(cell.value, meta.dateFormat) : rawCellText(cell);
        case "quantity":
            return cell.type === "Float" ? formatQuantity(cell.value, meta.format)
                : cell.type === "Integer" ? formatQuantity(Number(cell.value), meta.format) : rawCellText(cell);
        case "integer":
            return cell.type === "Integer" ? formatQuantity(Number(cell.value), undefined)
                : cell.type === "Float" ? formatQuantity(cell.value, undefined) : rawCellText(cell);
        default:
            return rawCellText(cell);
    }
}

/** A cell's text by its own tag, kind-agnostic. */
export function rawCellText(cell: SheetCellValue): string {
    switch (cell.type) {
        case "Null": return "";
        case "Boolean": return String(cell.value);
        case "Integer": return String(cell.value);
        case "Float": return String(cell.value);
        case "String": return cell.value;
        case "DateTime": return formatDatePattern(DATE_DISPLAY_PATTERN, cell.value);
        case "Link": return printLinkText(cell.value);
    }
    return "";
}

// ── The body ──────────────────────────────────────────────────────────────

/** One unloaded run of a paged source, above or below the resident rows. */
export interface SheetBand {
    at: "head" | "tail";
    /** First source element covered (inclusive). */
    from: number;
    /** Last source element covered (inclusive). */
    to: number;
    /** The band's pixel height (the ledger's geometry). */
    px: number;
}

/** The lens over one run of rows (B§8): which are hits, which show, and the hidden runs between them. */
export interface LensSlice {
    hits: readonly boolean[];
    visible: readonly boolean[];
    gaps: readonly LensGap[];
}

/** A grouped sheet's lens (#740) — one slice per resident group, over its lines. */
export interface GroupedLens {
    groups: readonly LensSlice[];
}

/** Whether a lens is a grouped sheet's. */
function isGroupedLens(lens: LensSlice | GroupedLens): lens is GroupedLens {
    return (lens as Partial<GroupedLens>).groups !== undefined;
}

/** One body item — a real row (a line, when tagged with its group), a blank padding row (a group's blank line, when tagged), a group's band, the `+ plan` ghost band, a paged band, a lens gap, or a proposal. */
export type SheetBodyItem =
    | {
        kind: "real";
        /** The row's source position (0-based) — its row number minus one; a line: its GROUP's position. */
        position: number;
        /** Index among the RESIDENT real rows (the wire context's `rowIndex`); a line: its group's. */
        residentIndex: number;
        /** The wire row; a line: the pseudo row over the line's cells ({@link lineRowOf}). */
        row: SheetRowValue;
        /** A lens hit — the brand row number (B§8). */
        hit: boolean;
        /** A line's group (#740). */
        group?: LineGroup | undefined;
    }
    /** A run of rows the lens hides (B§8) — 22 px, a dashed rule, the `n hidden` pill with its controls. */
    | { kind: "gap"; gap: LensGap }
    | {
        kind: "blank";
        /** The sheet position the blank would take (0-based); a group's blank line: the group's position. */
        position: number;
        /** Which blank this is (0-based). */
        blankIndex: number;
        /** A group's blank line (#740) — `key` empty, `index` the line it would take. */
        group?: LineGroup | undefined;
    }
    /** A group's band (#740): the title, the eyebrow, the band cells, the fold. */
    | {
        kind: "group";
        position: number;
        residentIndex: number;
        row: SheetRowValue;
        folded: boolean;
        /** The group's line count. */
        count: number;
        /** Under a lens: how many of its lines are hits. */
        hits: number | undefined;
    }
    /** The `+ plan` ghost band (#740). */
    | { kind: "groupBlank"; position: number }
    | { kind: "band"; band: SheetBand }
    | {
        kind: "proposal";
        /** The proposal's index under its anchor. */
        index: number;
        /** The row-space index of the anchor row. */
        anchorR: number;
        /** The sheet position the row would take (0-based) — its number minus one. */
        position: number;
        /** The 1-based number it would take (a line: within its group). */
        number: number;
        /** Proposed under a line (#740) — it carries the group's extent rule. */
        grouped: boolean;
        cells: ReadonlyMap<string, SheetCellValue>;
        meta: string;
    };

/** What the body is built from. */
export interface SheetBodyInput {
    /** The resident real rows, in sheet order (a grouped sheet: the groups). */
    rows: readonly SheetRowValue[];
    /** The source offset of `rows[0]` (`0` on the inline arm). */
    rowsOffset: number;
    /** Padding rows below the last real one (a grouped sheet: `> 0` ⇒ each open group ends with a blank line and the sheet with the ghost band). */
    blanks: number;
    /** Whether blanks may show — the inline arm, or a paged source that is exhausted. */
    exhausted: boolean;
    /** The source's total element count, once known (positions past the resident run). */
    total: number | undefined;
    head: SheetBand | undefined;
    tail: SheetBand | undefined;
    /** The lens over the resident rows (B§8); a grouped sheet: one slice per resident group, over its lines. Absent ⇒ the sheet is whole. */
    lens?: LensSlice | GroupedLens | undefined;
    /** Grouped rows (#740): whether each group is folded, and whether the `+ plan` ghost band shows (the source is writable). */
    grouped?: { foldedOf: (row: SheetRowValue) => boolean; ghost: boolean } | undefined;
}

/**
 * The body items, in order: head band · real rows · tail band · blanks.
 * Under a lens the real rows the narrowing hides collapse into gaps and
 * the blank tail is not shown — a lens narrows the sheet, it never invites
 * the next row (B§8). A grouped sheet builds bands with their lines
 * ({@link buildGroupedBody}).
 */
export function buildBody(input: SheetBodyInput): SheetBodyItem[] {
    if (input.grouped !== undefined) return buildGroupedBody(input, input.grouped);
    const out: SheetBodyItem[] = [];
    if (input.head !== undefined) out.push({ kind: "band", band: input.head });
    const lens = input.lens !== undefined && !isGroupedLens(input.lens) ? input.lens : undefined;
    let inGap = false;
    input.rows.forEach((row, i) => {
        const position = input.rowsOffset + i;
        if (lens !== undefined && !lens.visible[i]) {
            if (!inGap) {
                const gap = lens.gaps.find((g) => g.from === position);
                if (gap !== undefined) out.push({ kind: "gap", gap });
                inGap = true;
            }
            return;
        }
        inGap = false;
        out.push({ kind: "real", position, residentIndex: i, row, hit: lens !== undefined && lens.hits[i] === true });
    });
    if (input.tail !== undefined) out.push({ kind: "band", band: input.tail });
    if (input.exhausted && lens === undefined) {
        const last = input.total ?? input.rowsOffset + input.rows.length;
        for (let i = 0; i < input.blanks; i++) {
            out.push({ kind: "blank", position: last + i, blankIndex: i });
        }
    }
    return out;
}

/**
 * A grouped sheet's body (#740): for each resident group its band, then —
 * unless folded — its lines (under a lens: the hits and their context, the
 * rest as gaps inside the group) and one blank line; a group with no hits
 * folds to its band. The `+ plan` ghost band ends an exhausted sheet.
 */
function buildGroupedBody(input: SheetBodyInput, grouped: NonNullable<SheetBodyInput["grouped"]>): SheetBodyItem[] {
    const out: SheetBodyItem[] = [];
    if (input.head !== undefined) out.push({ kind: "band", band: input.head });
    const lens = input.lens !== undefined && isGroupedLens(input.lens) ? input.lens.groups : undefined;
    input.rows.forEach((row, i) => {
        const position = input.rowsOffset + i;
        const slice = lens?.[i];
        const hits = slice !== undefined ? slice.hits.filter(Boolean).length : undefined;
        const folded = grouped.foldedOf(row) || (slice !== undefined && hits === 0);
        out.push({ kind: "group", position, residentIndex: i, row, folded, count: row.lines.length, hits });
        if (folded) return;
        let inGap = false;
        row.lines.forEach((line, j) => {
            if (slice !== undefined && !slice.visible[j]) {
                if (!inGap) {
                    const at = linePosition(position, j);
                    const gap = slice.gaps.find((g) => g.from === at);
                    if (gap !== undefined) out.push({ kind: "gap", gap });
                    inGap = true;
                }
                return;
            }
            inGap = false;
            out.push({
                kind: "real", position, residentIndex: i, row: lineRowOf(row, line),
                hit: slice !== undefined && slice.hits[j] === true,
                group: { row, key: line.key, index: j, number: j + 1 },
            });
        });
        if (input.blanks > 0 && lens === undefined) {
            out.push({ kind: "blank", position, blankIndex: 0, group: { row, key: "", index: row.lines.length, number: row.lines.length + 1 } });
        }
    });
    if (input.tail !== undefined) out.push({ kind: "band", band: input.tail });
    if (input.exhausted && lens === undefined && input.blanks > 0 && grouped.ghost) {
        out.push({ kind: "groupBlank", position: input.total ?? input.rowsOffset + input.rows.length });
    }
    return out;
}

/**
 * The body with the copilot's proposed rows spliced in under their anchor
 * (B§5.2): dashed-topped hatched rows with real row numbers, excluded from
 * the row space like bands. Under a line anchor they number on within the
 * group.
 */
export function withProposals(
    body: readonly SheetBodyItem[],
    anchorBodyIndex: number,
    rows: readonly { cells: ReadonlyMap<string, SheetCellValue>; meta: string }[],
): SheetBodyItem[] {
    if (rows.length === 0 || anchorBodyIndex < 0 || anchorBodyIndex >= body.length) return body as SheetBodyItem[];
    const anchor = body[anchorBodyIndex]!;
    if (anchor.kind !== "real" && anchor.kind !== "blank") return body as SheetBodyItem[];
    let r = 0;
    for (let i = 0; i <= anchorBodyIndex; i++) if (isRowSpace(body[i]!)) r++;
    const anchorR = r - 1;
    const anchorNumber = anchor.group !== undefined ? anchor.group.number : anchor.position + 1;
    const out = body.slice(0, anchorBodyIndex + 1);
    rows.forEach((p, i) => out.push({ kind: "proposal", index: i, anchorR, position: anchor.position + 1 + i, number: anchorNumber + 1 + i, grouped: anchor.group !== undefined, cells: p.cells, meta: p.meta }));
    return out.concat(body.slice(anchorBodyIndex + 1));
}

/** Whether a body item occupies the ROW space (paged bands, gaps and proposals do not; a group's band and the ghost band do). */
export function isRowSpace(item: SheetBodyItem): boolean {
    return item.kind === "real" || item.kind === "blank" || item.kind === "group" || item.kind === "groupBlank";
}

/** The body index of the real row (or the group band) with `id`, if resident. */
export function bodyIndexOfId(body: readonly SheetBodyItem[], id: string): number {
    return body.findIndex((it) => (it.kind === "real" || it.kind === "group") && it.row.id === id);
}

/** The synthetic id of a blank item — a padding row's by position, a group's blank line's by group. */
export function blankIdOf(item: Extract<SheetBodyItem, { kind: "blank" }>): string {
    return item.group !== undefined ? blankLineId(item.group.row.id) : blankRowId(item.position);
}

/** The last REAL row's id, if any — what an insert at the end lands after. */
export function lastRealId(body: readonly SheetBodyItem[]): string | undefined {
    for (let i = body.length - 1; i >= 0; i--) {
        const it = body[i]!;
        if (it.kind === "real") return it.row.id;
    }
    return undefined;
}

/** Each body item's top offset (px) from the first item's top, and the total height as the last entry. */
export function bodyOffsets(body: readonly SheetBodyItem[], sizeOf: (i: number) => number): number[] {
    const out = new Array<number>(body.length + 1);
    let y = 0;
    for (let i = 0; i < body.length; i++) {
        out[i] = y;
        y += sizeOf(i);
    }
    out[body.length] = y;
    return out;
}

/**
 * The band that sticks under the column header at a scroll offset (#740,
 * G1): the band of the group the item under the header belongs to, once
 * that band has started to scroll under the header; `undefined` when the
 * item under the header belongs to no group or its band is still in view.
 *
 * @param body - The body items
 * @param offsets - {@link bodyOffsets} over the same body
 * @param scrollTop - How far the rows have scrolled under the header (px)
 * @returns The body index of the sticking band
 */
export function stickyBandIndex(body: readonly SheetBodyItem[], offsets: readonly number[], scrollTop: number): number | undefined {
    if (scrollTop <= 0 || body.length === 0) return undefined;
    // The last item whose top is at or above the header's bottom edge.
    let lo = 0;
    let hi = body.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid]! <= scrollTop) lo = mid; else hi = mid - 1;
    }
    for (let i = lo; i >= 0; i--) {
        const it = body[i]!;
        if (it.kind === "group") return i === lo && offsets[i]! >= scrollTop ? undefined : i;
        if (it.kind === "band" || it.kind === "groupBlank") return undefined;
    }
    return undefined;
}

// ── Sizing ────────────────────────────────────────────────────────────────

/** The blank-padding default (B§7). */
export const DEFAULT_BLANKS = 18;

/** The gutter width default (px, the §7 sheet). */
export const DEFAULT_GUTTER_PX = 80;

/** The band height (px) of a paged source's unloaded run when the ledger has no better geometry. */
export const BAND_MIN_PX = 22;

/** The bottom padding below the last blank row (px). */
export const BOTTOM_PAD_PX = 120;

/** The decoded root's density → recipe size + row height. */
export function densityOf(value: SheetRootValue): "sm" | "md" | "lg" {
    const tag = getSomeorUndefined(value.density)?.type;
    return tag === "compact" || tag === "condensed" ? "sm" : tag === "comfortable" ? "lg" : "md";
}
