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
 * Pure: no React, no DOM. The interaction state lives in `sheet-state.ts`;
 * the data lives in the component (local rows over the decoded value).
 *
 * @packageDocumentation
 */

import { variant } from "@elaraai/east";
import { formatDatePattern } from "../../charts/spec/index.js";
import { formatTick, type TickFormatOpt } from "../../typography/numeric/format-tick.js";
import { getSomeorUndefined } from "../../utils.js";
import type {
    SheetCellValue, SheetColumnValue, SheetCustomKindValue, SheetLinkValue, SheetMemberValue, SheetRegisterMemberValue,
    SheetRootValue, SheetRowValue,
} from "./values.js";
import type { LensGap } from "./lens.js";
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

/** One body item — a real row, a blank padding row, a paged band, a lens gap, or a proposal. */
export type SheetBodyItem =
    | {
        kind: "real";
        /** The row's source position (0-based) — its row number minus one. */
        position: number;
        /** Index among the RESIDENT real rows (the wire context's `rowIndex`). */
        residentIndex: number;
        row: SheetRowValue;
        /** A lens hit — the brand row number (B§8). */
        hit: boolean;
    }
    /** A run of rows the lens hides (B§8) — 22 px, a dashed rule, the `n hidden` pill with its controls. */
    | { kind: "gap"; gap: LensGap }
    | {
        kind: "blank";
        /** The sheet position the blank would take (0-based). */
        position: number;
        /** Which blank this is (0-based). */
        blankIndex: number;
    }
    | { kind: "band"; band: SheetBand }
    | {
        kind: "proposal";
        /** The proposal's index under its anchor. */
        index: number;
        /** The row-space index of the anchor row. */
        anchorR: number;
        /** The sheet position the row would take (0-based) — its number minus one. */
        position: number;
        cells: ReadonlyMap<string, SheetCellValue>;
        meta: string;
    };

/** What the body is built from. */
export interface SheetBodyInput {
    /** The resident real rows, in sheet order. */
    rows: readonly SheetRowValue[];
    /** The source offset of `rows[0]` (`0` on the inline arm). */
    rowsOffset: number;
    /** Padding rows below the last real one. */
    blanks: number;
    /** Whether blanks may show — the inline arm, or a paged source that is exhausted. */
    exhausted: boolean;
    /** The source's total element count, once known (positions past the resident run). */
    total: number | undefined;
    head: SheetBand | undefined;
    tail: SheetBand | undefined;
    /** The lens over the resident rows (B§8): which are hits, which show, and the hidden runs between them. Absent ⇒ the sheet is whole. */
    lens?: { hits: readonly boolean[]; visible: readonly boolean[]; gaps: readonly LensGap[] } | undefined;
}

/**
 * The body items, in order: head band · real rows · tail band · blanks.
 * Under a lens the real rows the narrowing hides collapse into gaps and
 * the blank tail is not shown — a lens narrows the sheet, it never invites
 * the next row (B§8).
 */
export function buildBody(input: SheetBodyInput): SheetBodyItem[] {
    const out: SheetBodyItem[] = [];
    if (input.head !== undefined) out.push({ kind: "band", band: input.head });
    const lens = input.lens;
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
 * The body with the copilot's proposed rows spliced in under their anchor
 * (B§5.2): dashed-topped hatched rows with real row numbers, excluded from
 * the row space like bands.
 */
export function withProposals(
    body: readonly SheetBodyItem[],
    anchorBodyIndex: number,
    rows: readonly { cells: ReadonlyMap<string, SheetCellValue>; meta: string }[],
): SheetBodyItem[] {
    if (rows.length === 0 || anchorBodyIndex < 0 || anchorBodyIndex >= body.length) return body as SheetBodyItem[];
    const anchor = body[anchorBodyIndex]!;
    if (anchor.kind === "band" || anchor.kind === "gap") return body as SheetBodyItem[];
    let r = 0;
    for (let i = 0; i <= anchorBodyIndex; i++) if (isRowSpace(body[i]!)) r++;
    const anchorR = r - 1;
    const out = body.slice(0, anchorBodyIndex + 1);
    rows.forEach((p, i) => out.push({ kind: "proposal", index: i, anchorR, position: anchor.position + 1 + i, cells: p.cells, meta: p.meta }));
    return out.concat(body.slice(anchorBodyIndex + 1));
}

/** Whether a body item occupies the ROW space (bands, gaps and proposals do not). */
export function isRowSpace(item: SheetBodyItem): boolean {
    return item.kind === "real" || item.kind === "blank";
}

/** The body index of the real row with `id`, if resident. */
export function bodyIndexOfId(body: readonly SheetBodyItem[], id: string): number {
    return body.findIndex((it) => it.kind === "real" && it.row.id === id);
}

/** The last REAL row's id, if any — what an insert at the end lands after. */
export function lastRealId(body: readonly SheetBodyItem[]): string | undefined {
    for (let i = body.length - 1; i >= 0; i--) {
        const it = body[i]!;
        if (it.kind === "real") return it.row.id;
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
