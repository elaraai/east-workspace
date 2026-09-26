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
 * group ({@link LineGroup}). An open line's SUB ROWS (#844) hang under it
 * as `subRow` items, outside the row space. Under a lens the groups and
 * their lines narrow the way flat rows do: hits keep their numbers, context
 * shows either side, the rest collapse into gaps.
 *
 * Pure: no React, no DOM. The interaction state lives in `sheet-state.ts`;
 * the data lives in the component (local rows over the decoded value).
 *
 * @packageDocumentation
 */

import { none, variant } from "@elaraai/east";
import { formatDatePattern } from "../../charts/spec/index.js";
import type { Formatters, TickFormatOpt } from "../../format/index.js";
import { getSomeorUndefined } from "../../utils.js";
import type {
    SheetCellValue, SheetColumnValue, SheetContextValue, SheetCustomKindValue, SheetGroupValue, SheetLineValue, SheetLinkValue, SheetMemberValue,
    SheetNounValue, SheetRegisterMemberValue, SheetRootValue, SheetRowValue, SheetSubRowValue,
} from "./values.js";
import type { LensGap } from "./lens.js";
import type { SheetWords } from "./words.js";
import { blankRowId } from "./sheet-types.js";
import { DATE_DISPLAY_PATTERN, isWhenLevel, type WhenLevel } from "./parse/date.js";

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
    /** An enum, lookup or link column's options rule (#844): the member keys a row is OFFERED (`undefined` = the whole register). Typed text still resolves against the whole register. */
    options: ((ctx: SheetContextValue) => readonly string[] | undefined) | undefined;
    /** A date column's level (#844): how deep a row's date is read and typed, read off the row's cells. */
    level: ((cells: ReadonlyMap<string, SheetCellValue>) => WhenLevel) | undefined;
    /** A date column's actual (#844): the key of the unrendered cell holding when the work really happened. */
    actual: string | undefined;
    /** The key of the unrendered cell whose text is this column's detail — the hover and the strip (#844). */
    detailCell: string | undefined;
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

/** A wire options rule as the renderer calls it — the offered keys, or `undefined` for the whole register. */
function optionsRule(rule: { type: "some"; value: (ctx: SheetContextValue) => { type: string; value: unknown } } | { type: "none" }): SheetColumnMeta["options"] {
    if (rule.type !== "some") return undefined;
    const fn = rule.value;
    return (ctx) => {
        const out = fn(ctx);
        return out.type === "some" ? (out.value as readonly string[]) : undefined;
    };
}

/** A level rule as the renderer calls it — the level named in the row's rule cell, `day` when it names none. */
function levelRule(key: string | undefined): SheetColumnMeta["level"] {
    if (key === undefined) return undefined;
    return (cells) => {
        const c = cells.get(key);
        return c !== undefined && c.type === "String" && isWhenLevel(c.value) ? c.value : "day";
    };
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
            options: undefined,
            level: undefined,
            actual: undefined,
            detailCell: getSomeorUndefined(col.detailCell),
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
                meta.level = levelRule(getSomeorUndefined(kind.value.level));
                meta.actual = getSomeorUndefined(kind.value.actual);
                break;
            case "quantity":
                meta.uom = getSomeorUndefined(kind.value.uom);
                meta.format = getSomeorUndefined(kind.value.format);
                break;
            case "lookup":
            case "enum":
            case "link":
                meta.register = kind.value.register;
                meta.options = optionsRule(kind.value.options);
                break;
            case "reference":
            case "set":
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

/** The lens-record key a line's sub rows answer a search under (#844), reserved as {@link TITLE_KEY} is. */
export const SUB_ROWS_KEY = "$subRows";

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

/** The wire key a line that the source does not hold yet carries — never a source index. */
export const NEW_LINE_KEY = "+";

// The lens on a grouped sheet works on LINES. Reveals are integer positions,
// so a line gets one of its own, above every group position and consecutive
// within its group: `LINE_BASE + group × LINE_SPAN + line`. A gap's controls
// enumerate the range between two of them.

/** The first line position — above every group position. */
export const LINE_BASE = 1_000_000;
/** The line positions one group spans. */
export const LINE_SPAN = 1_000;
/** A line's position in the reveal space. */
export const linePosition = (groupPosition: number, lineIndex: number): number => LINE_BASE + groupPosition * LINE_SPAN + lineIndex;
/** Whether a position names a line (else a group or a flat row). */
export const isLinePosition = (p: number): boolean => p >= LINE_BASE;
/** A line position's 1-based line number within its group. */
export const lineNumberOf = (p: number): number => ((p - LINE_BASE) % LINE_SPAN) + 1;

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
    /** The field holding the lines — an `Array`, so a line's address is its position. */
    linesField: string;
    /** The band's cells by the line column key they sit under (the title under {@link TITLE_KEY}). */
    cells: ReadonlyMap<string, SheetColumnMeta>;
    /** How many leading columns the title spans — up to three, stopping before the first column with a band cell. */
    titleSpan: number;
    /** The host's word for a group (#844); `undefined` when it names none — the sheet's words say their own (#861). */
    noun: SheetNounValue | undefined;
    /** Whether rows of the line type stand between the groups (#846) — a LOOSE row: a wire row with no band. */
    loose: boolean;
}

/**
 * Decode the wire group declaration.
 *
 * @param group - The wire group declaration
 * @param columns - The line columns
 * @param titleHeader - The sheet's word for the band title's column (#861)
 * @returns The band's cells, the title span and the host's noun
 */
export function indexGroup(group: SheetGroupValue, columns: SheetColumnIndex, titleHeader: string): SheetGroupIndex {
    const cells = new Map<string, SheetColumnMeta>();
    for (const cell of group.cells) {
        const meta = indexColumns([{
            key: cell.key, header: cell.key === TITLE_KEY ? titleHeader : columns.byKey.get(cell.key)?.header ?? cell.key,
            sub: none, width: none, kind: cell.kind, dataType: cell.dataType, payloadType: cell.payloadType, editable: cell.editable, fill: [], detailCell: none,
        }]).list[0]!;
        cells.set(cell.key, meta);
    }
    let firstCell = columns.list.length;
    columns.list.forEach((c, i) => { if (i < firstCell && cells.has(c.key)) firstCell = i; });
    return { linesField: group.lines, cells, titleSpan: Math.max(1, Math.min(3, columns.list.length, firstCell)), noun: getSomeorUndefined(group.noun), loose: group.loose };
}

/**
 * Whether a grouped sheet's row is a LOOSE row between the groups (#846): a
 * row of the line type, with its own cells and no band.
 *
 * @param row - A grouped sheet's wire row
 * @returns `true` for a loose row, `false` for a group
 */
export function isLooseRow(row: SheetRowValue): boolean {
    return row.band.type === "none";
}

/**
 * `n group(s)` in the host's noun, in the sheet's words — the count in the
 * app's locale (#850, #861).
 *
 * @param n - The count
 * @param noun - The host's word for a group
 * @param words - The sheet's words
 * @returns The phrase
 */
export function countNoun(n: number, noun: SheetNounValue, words: SheetWords): string {
    return words.m.countNoun({ n, count: words.number(n), noun: noun.singular, nouns: noun.plural });
}

// A line's pseudo row is built once per group row and wire key, so its
// identity is stable across body builds (the check cache, the row memo).
const lineRows = new WeakMap<SheetRowValue, Map<string, SheetRowValue>>();

/** A line as a wire row — its group's id and key in the id, the group's `owned`, the line's cells and sub rows. */
export function lineRowOf(group: SheetRowValue, line: SheetLineValue): SheetRowValue {
    let byKey = lineRows.get(group);
    if (byKey === undefined) { byKey = new Map(); lineRows.set(group, byKey); }
    const known = byKey.get(line.key);
    if (known !== undefined && known.cells === line.cells && known.subRows === line.subRows) return known;
    const row: SheetRowValue = { id: lineId(group.id, line.key), owned: group.owned, cells: line.cells, lines: [], band: none, subRows: line.subRows };
    byKey.set(line.key, row);
    return row;
}

/** The pseudo rows of a group's lines, in order. */
export function lineRowsOf(group: SheetRowValue): SheetRowValue[] {
    return group.lines.map((l) => lineRowOf(group, l));
}

/** A group row with one line's cells replaced (by wire key), or appended when the key is not among its lines; the line keeps its sub rows. */
export function withLine(group: SheetRowValue, key: string, cells: ReadonlyMap<string, SheetCellValue>): SheetRowValue {
    const lines = group.lines.map((l) => (l.key === key ? { ...l, cells: cells as Map<string, SheetCellValue> } : l));
    if (!group.lines.some((l) => l.key === key)) lines.push({ key, cells: cells as Map<string, SheetCellValue>, subRows: [] });
    return { ...group, lines };
}

/** A group row without the lines at the given wire keys. */
export function withoutLines(group: SheetRowValue, keys: ReadonlySet<string>): SheetRowValue {
    return { ...group, lines: group.lines.filter((l) => !keys.has(l.key)) };
}

/** A line's ADDRESS in an edit event — its position among its group's lines. */
export function lineAddress(index: number): string {
    return String(index);
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

/** A link member's text — the grammar's print form (B§4.1), what copy, search and the editor's buffer use. */
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

/** What a member's CHIP prints — its label, but a counted member as its kind alone: the count rides beside it ({@link memberChipCount}). */
export function memberChipLabel(m: SheetMemberValue): string {
    return m.type === "counted" ? m.value.key : memberLabel(m);
}

/** A counted member's count, drawn as its chip's meta; `undefined` for every other member. */
export function memberChipCount(m: SheetMemberValue): string | undefined {
    return m.type === "counted" ? String(m.value.n) : undefined;
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

/**
 * A quantity's display text — through the declared format, in the viewer's
 * language (#852): `1,234.5`, `1.234,5` in German.
 *
 * @param n - The number
 * @param format - The column's declared format; `undefined` for a plain grouped number
 * @param words - The viewer's formatters
 * @returns The text; empty for a non-finite number
 */
export function formatQuantity(n: number, format: TickFormatOpt, words: Formatters): string {
    if (!Number.isFinite(n)) return "";
    return words.value(n, format);
}

/** A date's display text — the author's pattern, else `17 Nov 26`; East's own printer either way. */
export function formatDateCell(d: Date, pattern: string | undefined): string {
    return formatDatePattern(pattern !== undefined && pattern !== "" ? pattern : DATE_DISPLAY_PATTERN, d);
}

/**
 * A cell's display text by kind (the read-only rendering). A link cell prints
 * through the grammar; a custom kind through its compiled `print`; a quantity
 * or integer in the viewer's language (#852) — the language its edit box
 * reads back.
 *
 * @param cell - The cell
 * @param meta - Its column
 * @param words - The viewer's formatters
 * @returns The text
 */
export function cellText(cell: SheetCellValue | undefined, meta: SheetColumnMeta, words: Formatters): string {
    if (cell === undefined || cell.type === "Null") return "";
    if (cell.type === "Invalid") return cell.value;
    switch (meta.kind) {
        case "custom":
            if (meta.customPrint !== undefined) {
                try { return meta.customPrint(cell); } catch (err) { console.error(`[Sheet] custom print failed on column "${meta.key}":`, err); }
            }
            return rawCellText(cell);
        case "date":
            return cell.type === "DateTime" ? formatDateCell(cell.value, meta.dateFormat) : rawCellText(cell);
        case "quantity":
            return cell.type === "Float" ? formatQuantity(cell.value, meta.format, words)
                : cell.type === "Integer" ? formatQuantity(Number(cell.value), meta.format, words) : rawCellText(cell);
        case "integer":
            return cell.type === "Integer" ? formatQuantity(Number(cell.value), undefined, words)
                : cell.type === "Float" ? formatQuantity(cell.value, undefined, words) : rawCellText(cell);
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
        case "Invalid":
        case "String": return cell.value;
        case "DateTime": return formatDatePattern(DATE_DISPLAY_PATTERN, cell.value);
        case "Link": return printLinkText(cell.value);
    }
    return "";
}

/** A sub row's printed text — its lead, detail and id, what a search matches it by. */
export function subRowText(s: SheetSubRowValue): string {
    return [s.code, s.name, ...s.chips, ...s.facets.map((f) => `${f.label} ${f.value}`), s.id].filter((t) => t !== "").join(" ");
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

/** A resident window of a paged source whose read failed (#853) — one band where its rows would be. */
export interface SheetWindowFailure {
    /** The window. */
    w: number;
    /** Its first and last source element (inclusive). */
    from: number;
    to: number;
    /** Its height — the ledger's slot for it, so the rows that replace it take the same space. */
    px: number;
    /** Why its read failed. */
    error: string;
}

/** A failed window, and the row it sits before (`rows.length`: after the last). */
export interface PlacedFailure {
    failure: SheetWindowFailure;
    at: number;
}

/** A contiguous run of rows between failed windows: `[start, end)`, and the source position of `start`. */
export interface RowSegment {
    start: number;
    end: number;
    position: number;
}

/**
 * Where a paged run's failed windows sit among the rows on screen, and each
 * row's position (#853). The rows are the source's resident rows with the
 * local layer applied: a row the source served keeps its place relative to
 * the failed windows (by its source position), a row the planner added
 * follows the row before it. A position counts the rows before it — a row
 * removed locally renumbers the rows after it, as it always has — and every
 * element of a failed window before it: those rows exist, they could not be
 * read.
 *
 * @param rows - The rows on screen, in order
 * @param rowsOffset - The position of the run's first element
 * @param failures - The failed windows, ascending
 * @param sourcePosition - A row's source position, by id — `undefined` for a row the source did not serve
 * @returns Each row's position, where each failed window sits, and the contiguous segments between them
 */
export function layoutRun(
    rows: readonly SheetRowValue[],
    rowsOffset: number,
    failures: readonly SheetWindowFailure[],
    sourcePosition: (id: string) => number | undefined,
): { positions: number[]; failures: PlacedFailure[]; segments: RowSegment[] } {
    const positions = new Array<number>(rows.length);
    const placed: PlacedFailure[] = [];
    let next = 0;
    let skipped = 0;
    rows.forEach((row, i) => {
        const at = sourcePosition(row.id);
        while (at !== undefined && next < failures.length && at > failures[next]!.to) {
            const failure = failures[next++]!;
            placed.push({ failure, at: i });
            skipped += failure.to - failure.from + 1;
        }
        positions[i] = rowsOffset + i + skipped;
    });
    for (; next < failures.length; next++) placed.push({ failure: failures[next]!, at: rows.length });
    const segments: RowSegment[] = [];
    let start = 0;
    for (const { at } of placed) {
        if (at > start) segments.push({ start, end: at, position: positions[start]! });
        start = Math.max(start, at);
    }
    if (start < rows.length || segments.length === 0) segments.push({ start, end: rows.length, position: positions[start] ?? rowsOffset + rows.length + skipped });
    return { positions, failures: placed, segments };
}

/**
 * The segment a row sits in — the contiguous run an author's context sees
 * around it (#853), so `rowsOffset + index` stays each of its rows' position.
 * A row past the end (a blank row, an append) is in the last one.
 *
 * @param segments - The run's segments ({@link layoutRun})
 * @param i - The row's index
 * @returns Its segment
 */
export function segmentOf(segments: readonly RowSegment[], i: number): RowSegment {
    return segments.find((s) => i >= s.start && i < s.end) ?? segments[segments.length - 1]!;
}

/** The lens over one run of rows (B§8): which are hits, which show, and the hidden runs between them. */
export interface LensSlice {
    hits: readonly boolean[];
    visible: readonly boolean[];
    gaps: readonly LensGap[];
    /** A grouped sheet: each group's per-line hits. */
    lineHits?: readonly (readonly boolean[])[] | undefined;
    /** A grouped sheet: each group's per-line visibility (hits, their context, reveals; every line under a matched title). */
    lineVisible?: readonly (readonly boolean[])[] | undefined;
    /** A grouped sheet: each group's hidden runs between its visible lines, keyed and positioned in the line space. */
    lineGaps?: readonly (readonly LensGap[])[] | undefined;
    /** A grouped sheet: per group, per line, which of its sub rows the search answers through — a line hit only through them shows them. */
    lineSubRowHits?: readonly (readonly (readonly boolean[])[])[] | undefined;
}

/** One body item — a real row (a line, when tagged with its group), a line's sub row, a blank padding row (a group's blank line, when tagged), a group's band, a paged band, a lens gap, or a proposal. */
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
        /** A LOOSE row's index among the resident loose rows (#846) — a grouped sheet's row that belongs to no group. */
        loose?: number | undefined;
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
    /**
     * One SUB ROW under an open line (#844): full width under the line, none
     * of the columns, outside the row space like a band — the ring never
     * lands on it.
     */
    | {
        kind: "subRow";
        /** Its line's GROUP position, as the line's item has it. */
        position: number;
        /** The line it hangs under. */
        group: LineGroup;
        /** The line's synthetic id — the key its sub rows open under. */
        lineId: string;
        subRow: SheetSubRowValue;
        /** Its index under the line, and how many the line has. */
        index: number;
        count: number;
        /** A lens hit through this sub row's own text. */
        hit: boolean;
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
    }
    | { kind: "band"; band: SheetBand }
    /** A resident window whose read failed (#853): its band, where its rows would be, with the reason and a Retry. */
    | { kind: "failed"; failure: SheetWindowFailure }
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
    /** Each row's position when the run has failed windows in it (#853, {@link layoutRun}); else `rowsOffset + i`. */
    positions?: readonly number[] | undefined;
    /** The failed windows, each drawn as a band before the row it sits before (#853). */
    failures?: readonly PlacedFailure[] | undefined;
    /** Padding rows below the last real one (a grouped sheet: `> 0` ⇒ each open group ends with a blank line). */
    blanks: number;
    /** Whether blanks may show — the inline arm, or a paged source that is exhausted. */
    exhausted: boolean;
    /** The source's total element count, once known (positions past the resident run). */
    total: number | undefined;
    head: SheetBand | undefined;
    tail: SheetBand | undefined;
    /** The lens over resident rows (a grouped sheet: over the groups, with per-line hits). */
    lens?: LensSlice | undefined;
    /** Whether each group is folded, and whether a line's sub rows were opened or closed by hand (`undefined` = never touched: closed, unless the lens hit the line through them). */
    grouped?: { foldedOf: (row: SheetRowValue) => boolean; subRowsOpen?: ((lineId: string) => boolean | undefined) | undefined } | undefined;
}

/** Each failed window placed before row `i`, as body items (#853). */
function failuresAt(input: SheetBodyInput, i: number, out: SheetBodyItem[]): void {
    for (const p of input.failures ?? []) if (p.at === i) out.push({ kind: "failed", failure: p.failure });
}

/**
 * The body items, in order: head band · real rows (a failed window's band
 * where its rows would be, #853) · tail band · blanks. Under a lens the real
 * rows the narrowing hides collapse into gaps and the blank tail is not
 * shown — a lens narrows the sheet, it never invites the next row (B§8). A
 * grouped sheet builds bands with their lines ({@link buildGroupedBody}).
 */
export function buildBody(input: SheetBodyInput): SheetBodyItem[] {
    if (input.grouped !== undefined) return buildGroupedBody(input, input.grouped);
    const out: SheetBodyItem[] = [];
    if (input.head !== undefined) out.push({ kind: "band", band: input.head });
    const lens = input.lens;
    let inGap = false;
    input.rows.forEach((row, i) => {
        failuresAt(input, i, out);
        const position = input.positions?.[i] ?? input.rowsOffset + i;
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
    failuresAt(input, input.rows.length, out);
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
 * unless folded — its lines, each open line's sub rows, and one blank line;
 * a LOOSE row between the groups (#846) is a plain row of its own. Under a
 * lens the groups and loose rows the narrowing hides collapse into gaps (as
 * flat rows do); inside a shown group the lens works on its LINES: a hit
 * keeps its number, its context and anything revealed show, and the rest
 * collapse into gaps with the controls a flat sheet has. The blank line is
 * not shown under a lens (a lens never invites the next row).
 */
function buildGroupedBody(input: SheetBodyInput, grouped: NonNullable<SheetBodyInput["grouped"]>): SheetBodyItem[] {
    const out: SheetBodyItem[] = [];
    if (input.head !== undefined) out.push({ kind: "band", band: input.head });
    const lens = input.lens;
    let inGap = false;
    // Each loose row's index among the resident loose rows, the hidden ones counted.
    let looseAt = 0;
    input.rows.forEach((row, i) => {
        failuresAt(input, i, out);
        const position = input.positions?.[i] ?? input.rowsOffset + i;
        const loose = isLooseRow(row) ? looseAt++ : undefined;
        if (lens !== undefined && !lens.visible[i]) {
            if (!inGap) {
                const gap = lens.gaps.find((g) => g.from === position);
                if (gap !== undefined) out.push({ kind: "gap", gap });
                inGap = true;
            }
            return;
        }
        inGap = false;
        groupItems(row, i, position, lens, grouped, input.blanks, out, loose);
    });
    failuresAt(input, input.rows.length, out);
    if (input.tail !== undefined) out.push({ kind: "band", band: input.tail });
    return out;
}

/**
 * One shown group's items: its band, then — unless folded — its lines, each
 * open line's sub rows, and its blank line (not under a lens); a loose row
 * (#846) is one plain row. The body and the paged driver's window heights
 * both come from here (#855).
 */
function groupItems(
    row: SheetRowValue,
    i: number,
    position: number,
    lens: LensSlice | undefined,
    grouped: NonNullable<SheetBodyInput["grouped"]>,
    blanks: number,
    out: SheetBodyItem[],
    loose?: number,
): void {
    if (isLooseRow(row)) {
        out.push({ kind: "real", position, residentIndex: i, row, hit: lens !== undefined && lens.hits[i] === true, loose: loose ?? 0 });
        return;
    }
    const folded = grouped.foldedOf(row);
    out.push({ kind: "group", position, residentIndex: i, row, folded, count: row.lines.length });
    if (folded) return;
    const lineHits = lens?.lineHits?.[i];
    const lineVisible = lens?.lineVisible?.[i];
    const lineGaps = lens?.lineGaps?.[i];
    let lineGap = false;
    row.lines.forEach((line, j) => {
        if (lineVisible !== undefined && !lineVisible[j]) {
            if (!lineGap) {
                const p = linePosition(position, j);
                const gap = lineGaps?.find((g) => g.from === p);
                if (gap !== undefined) out.push({ kind: "gap", gap });
                lineGap = true;
            }
            return;
        }
        lineGap = false;
        const lg: LineGroup = { row, key: line.key, index: j, number: j + 1 };
        out.push({ kind: "real", position, residentIndex: i, row: lineRowOf(row, line), hit: lineHits?.[j] === true, group: lg });
        // An open line's sub rows hang under it: opened by hand, or by the lens when the line hit only through them.
        const subRows = line.subRows;
        if (subRows.length === 0) return;
        const id = lineId(row.id, line.key);
        const subRowHits = lens?.lineSubRowHits?.[i]?.[j];
        const open = grouped.subRowsOpen?.(id) ?? subRowHits?.some(Boolean) === true;
        if (!open) return;
        subRows.forEach((subRow, k) => out.push({ kind: "subRow", position, group: lg, lineId: id, subRow, index: k, count: subRows.length, hit: subRowHits?.[k] === true }));
    });
    if (blanks > 0 && lens === undefined) {
        out.push({ kind: "blank", position, blankIndex: 0, group: { row, key: "", index: row.lines.length, number: row.lines.length + 1 } });
    }
}

/** The heights a sheet draws its items at (#855): a row's, a group band's and a sub row's least height. */
export interface SheetGeometry {
    rowPx: number;
    bandPx: number;
    subRowPx: number;
}

/**
 * A body item's least height (#855): what the rows are estimated at until
 * they are measured, and what the paged driver sizes a window by.
 *
 * @param item - The body item
 * @param g - The sheet's geometry
 * @returns Its height in px
 */
export function itemPx(item: SheetBodyItem, g: SheetGeometry): number {
    switch (item.kind) {
        case "gap": return BAND_MIN_PX;
        case "group": return g.bandPx;
        case "subRow": return g.subRowPx;
        case "failed": return Math.max(BAND_MIN_PX, item.failure.px);
        case "band": return Math.max(BAND_MIN_PX, item.band.px);
        default: return g.rowPx;
    }
}

/**
 * What one source row draws, in px (#855): the least height of the items the
 * body builds for it, with no lens. A flat row — or a loose row between the
 * groups (#846) — is one row; a group is its band and, unless folded, its
 * lines, their open sub rows and its blank line when the sheet draws one. The
 * paged driver sizes a window by it, so an unloaded band is as tall as its
 * rows will be.
 *
 * @param row - A source row
 * @param g - The sheet's geometry
 * @param grouped - A grouped sheet's folds and open sub rows (`undefined` on a flat sheet)
 * @param blanks - The grouped sheet's blank lines per group (`0` when it draws none)
 * @returns Its height in px
 */
export function drawnPx(row: SheetRowValue, g: SheetGeometry, grouped: SheetBodyInput["grouped"], blanks: number): number {
    if (grouped === undefined) return g.rowPx;
    const items: SheetBodyItem[] = [];
    groupItems(row, 0, 0, undefined, grouped, blanks, items);
    let px = 0;
    for (const it of items) px += itemPx(it, g);
    return px;
}

/**
 * The body with the copilot's proposed rows spliced in under their anchor
 * (B§5.2): dashed-topped hatched rows with real row numbers, excluded from
 * the row space like bands. Under a line anchor they number on within the
 * group, after the line's open sub rows.
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
    let at = anchorBodyIndex;
    const anchorId = anchor.kind === "real" ? anchor.row.id : undefined;
    while (anchorId !== undefined) {
        const next = body[at + 1];
        if (next?.kind !== "subRow" || next.lineId !== anchorId) break;
        at++;
    }
    const out = body.slice(0, at + 1);
    rows.forEach((p, i) => out.push({ kind: "proposal", index: i, anchorR, position: anchor.position + 1 + i, number: anchorNumber + 1 + i, grouped: anchor.group !== undefined, cells: p.cells, meta: p.meta }));
    return out.concat(body.slice(at + 1));
}

/** Whether a body item occupies the ROW space (paged bands, gaps, sub rows and proposals do not; group summaries do). */
export function isRowSpace(item: SheetBodyItem): boolean {
    return item.kind === "real" || item.kind === "blank" || item.kind === "group";
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

/** A mounted body item's box on the screen (px). */
export interface ItemBox {
    top: number;
    bottom: number;
}

/**
 * What sticks under the column header, read off the MOUNTED rows rather than
 * estimated offsets, so rows that grew (wrapped chips, a sub row's wrapped
 * detail) never skew it:
 *
 * - the BAND of the group the row under the header belongs to, once that band
 *   has scrolled under the header (#740, G1) — never a folded group's, which
 *   has no lines under the header to stand for, nor over a loose row (#846),
 *   which belongs to no group;
 * - under that band, the open LINE the row under the band belongs to, once
 *   the line's own row has scrolled under the band — its sub rows scroll
 *   under it, and as its last sub row leaves, the line is pushed up with it.
 *
 * An item within a pixel of an edge counts as clear of it, so a row brought
 * to sit exactly under the band stops sticking.
 *
 * @param body - The body items
 * @param boxes - The mounted items' boxes, by body index
 * @param headerBottom - The header's bottom edge, on the boxes' scale
 * @param bandPx - The sticking band's height
 * @param rowPx - A line's height when its own row is not mounted
 * @returns The sticking band's body index; the sticking line's, and the top it sits at
 */
export function stickyRows(
    body: readonly SheetBodyItem[],
    boxes: ReadonlyMap<number, ItemBox>,
    headerBottom: number,
    bandPx: number,
    rowPx: number,
): { band: number | undefined; line: { index: number; top: number } | undefined } {
    const at = (y: number): number | undefined => {
        for (const [i, b] of boxes) if (b.top <= y && y < b.bottom) return i;
        return undefined;
    };
    const u = at(headerBottom + 1);
    let band: number | undefined;
    for (let i = u ?? -1; i >= 0; i--) {
        const it = body[i]!;
        if (it.kind === "group") {
            if (!it.folded && (boxes.get(i)?.top ?? -Infinity) <= headerBottom - 1) band = i;
            break;
        }
        if (it.kind === "band" || it.kind === "failed") break;
        if (it.kind === "real" && it.loose !== undefined) break;
    }
    const group = band !== undefined ? body[band] : undefined;
    if (group?.kind !== "group") return { band, line: undefined };
    const zone = headerBottom + bandPx;
    const v = at(zone + 1);
    if (v === undefined) return { band, line: undefined };
    let l = v;
    while (l > 0 && body[l]!.kind === "subRow") l--;
    const line = body[l]!;
    const opens = (k: number): boolean => { const s = body[k]; return s?.kind === "subRow" && line.kind === "real" && s.lineId === line.row.id; };
    if (line.kind !== "real" || line.group?.row.id !== group.row.id || !opens(l + 1)) return { band, line: undefined };
    const own = boxes.get(l);
    if (own !== undefined && own.top > zone - 1) return { band, line: undefined };
    let last = l + 1;
    while (opens(last + 1)) last++;
    const height = own !== undefined ? own.bottom - own.top : rowPx;
    const end = boxes.get(last)?.bottom ?? Infinity;
    return { band, line: { index: l, top: zone + Math.min(0, end - zone - height) } };
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
