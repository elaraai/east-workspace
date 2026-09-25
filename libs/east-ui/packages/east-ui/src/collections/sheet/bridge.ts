/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The typed bridge (`Sheet Spec.md` §4.8) — factory internals, both arms.
 *
 * Everything the author writes is typed over the host's row `R` and the
 * driver's row `D`; everything on the wire is closed. This module joins the
 * two with compiled East functions that capture only data, bind handles and
 * the author's functions:
 *
 * - `projectRow` — `R` → the wire cells (the same projection the row source
 *   uses, so `encode` and `make` cannot disagree);
 * - `rowById` — the REAL source row by id: the captured collection or bind
 *   handle on the inline arm, the source's `page` at the row's offset on the
 *   paged arm. Built ONCE per sheet and shared by every wrapper;
 * - `draftDecode` — current cells over the existing field draft, preserving
 *   hidden values and retaining missing/invalid input without domain defaults;
 * - `bridgeCtx` — the wire context to `Sheet.Types.DraftContext(R, D)`;
 * - `bridgeReady` — a readiness batch to one `DraftContext` per check, its
 *   rows built once (#882);
 * - the wrappers — a fill provider, a proposer, an arity rule, a member
 *   check, an options rule, a custom kind's parse / print — each the
 *   author's typed function inside its closed wire twin;
 * - the rule cells and sub rows (#844) — a column's `level` / `actual` /
 *   `detail` accessors and the `subRows` mappers, each compiled once and
 *   called inside the row projection.
 *
 * On a GROUPED sheet (#740) the source row is the group `P` and the columns
 * are declared over the line `L` its lines field holds: `projectRow` /
 * `draftRow` / the patch run over `L`, `rowById` returns the group, and the
 * group half of the bridge ({@link SheetGroupBridge}) projects the group's
 * summary cells and ordered children. Internal child keys preserve identity
 * during local editing; the author's child arrays remain positional.
 *
 * The bridge is the one place a string ever names a field: inside the
 * factory, against the column list it has already validated.
 *
 * @packageDocumentation
 */

import {
    type BlockBuilder,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    East,
    Expr,
    ArrayType,
    AsyncFunctionType,
    BooleanType,
    DateTimeType,
    DictType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import {
    SheetCellType,
    SheetLinkType,
    SheetRowType,
    SheetLineType,
    SheetContextType,
    SheetReadyBatchType,
    SheetFillType,
    SheetProposalType,
    SheetProviderType,
    SheetProposerType,
    SheetCheckContextType,
    SheetCheckType,
    SheetCountedType,
    SheetHalfType,
    SheetContextTypeFor,
    SheetCheckContextTypeFor,
    SheetPatchTypeFor,
    SheetProposalTypeFor,
    SheetGroupContextTypeFor,
    SheetGroupCheckContextTypeFor,
    SheetDateLevelType,
    SheetSubRowType,
    SheetOptionsRuleType,
    sheetLinesOf,
    sheetRuleCell,
    type SheetColumnKindLiteral,
} from "./types.js";
import { resolveTag } from "../plan/builders.js";
import type { SheetSubRowsValue } from "./sub-rows.js";
import { SheetMembersType, SheetRegisterMembersType, parseLink, EMPTY_LINK } from "./link.js";
import { buildDraftRowDecoder, buildDraftGroupDecoder } from "./draft-bridge.js";
import { buildDraftContextBridge, buildDraftBase, buildReadyContexts } from "./context-bridge.js";
import { SheetDraftGroupTypeFor } from "./drafts.js";
import { SheetDraftTypeFor } from "./transactions.js";
import type { SheetAnyColumnConfig, SheetColumn } from "./columns.js";
import type { SheetGroupCell } from "./group.js";
import type { SheetDriverValue, SheetRegisterValue } from "./registers.js";

/** The wire cells dictionary type. */
export const SheetCellsType = DictType(StringType, SheetCellType);

/** The East type of an erased expression (`Expr.type` cannot infer through `ExprType<EastType>`). */
function typeOf(e: unknown): EastType {
    return Expr.type(e as Expr<EastType>) as EastType;
}

// ============================================================================
// Column metadata — pass 1 of the root
// ============================================================================

/** How a `set` / `link` column's halves live on the row (§3.4). */
export type SheetLinkForm = "link" | "array" | "string";

/**
 * One UNRENDERED cell a column's rule projects (#844) — a date's `level` /
 * `actual`, a column's `detail` — compiled once over the row type.
 *
 * @internal
 */
export interface SheetRuleCellMeta {
    /** The cell key ({@link sheetRuleCell}). */
    key: string;
    /** The reified accessor over the row. */
    fn: ExprType<FunctionType<[StructType], EastType>>;
    /** The cell arm the accessor's payload lands in. */
    tag: "String" | "DateTime";
    /** Whether the accessor returns an `Option` of the payload. */
    optional: boolean;
}

/**
 * One declared column, described against the row type — the static facts
 * every East function below is built from.
 *
 * @internal
 */
export interface SheetColumnMeta {
    /** The column key — the row field it sits on (a band cell: the line column it sits under, or `$title`). */
    key: string;
    /** The row field the cell reads and writes — the key for a column, a band cell's `field`. */
    field: string;
    /** The column kind. */
    kind: SheetColumnKindLiteral;
    /** The author's config. */
    config: SheetAnyColumnConfig;
    /** The row field's static type. */
    fieldType: EastType;
    /** Whether the field is an `Option` of the payload. */
    optional: boolean;
    /** The kind's payload type. */
    payloadType: EastType;
    /** The cell arm the payload lands in. */
    cellTag: "String" | "DateTime" | "Float" | "Integer" | "Boolean" | "Link";
    /** Whether the sheet writes the column. */
    editable: boolean;
    /** A reified `value` projection — the column is a derived, read-only read. */
    derived?: ExprType<FunctionType<[StructType], EastType>>;
    /** Whether the derived projection returns an `Option` of the payload. */
    derivedOptional?: boolean;
    /** A `set` / `link` column's storage form. */
    form?: SheetLinkForm;
    /** For the `array` form: the half THIS field holds. */
    ownHalf?: "from" | "to";
    /** For a `link` column in the `array` form: the field holding the other half. */
    otherField?: string;
    /** The register the column resolves against. */
    register?: string;
    /** The driver's row type the column was built with. */
    driverType?: StructType;
    /** The unrendered cells the column's rules project (#844). */
    ruleCells?: SheetRuleCellMeta[];
}

/** Whether a type is `Option<T>` — a variant of exactly `none: Null` and `some`. */
export function optionPayload(t: EastType): EastType | undefined {
    const v = t as { type: string; cases?: Record<string, EastType> };
    if (v.type !== "Variant" || v.cases === undefined) return undefined;
    const keys = Object.keys(v.cases);
    if (keys.length !== 2 || v.cases["none"] === undefined || v.cases["some"] === undefined) return undefined;
    if ((v.cases["none"] as { type: string }).type !== "Null") return undefined;
    return v.cases["some"];
}

/** The cell arm a primitive payload lands in, or `undefined` for a type no cell holds. */
export function cellTagOf(t: EastType): SheetColumnMeta["cellTag"] | undefined {
    if (t === SheetLinkType) return "Link";
    switch ((t as { type: string }).type) {
        case "String":   return "String";
        case "DateTime": return "DateTime";
        case "Float":    return "Float";
        case "Integer":  return "Integer";
        case "Boolean":  return "Boolean";
        default:         return undefined;
    }
}

const SCALAR_PAYLOAD: Partial<Record<SheetColumnKindLiteral, EastType>> = {
    text: StringType, lookup: StringType, reference: StringType, enum: StringType, stamped: StringType,
    date: DateTimeType, quantity: FloatType, integer: IntegerType,
};

/** Compile one rule accessor and check its payload — `String` or `DateTime`, or its Option. */
function ruleCell(
    key: string,
    rule: "actual" | "detail",
    rowType: StructType,
    accessor: (row: ExprType<StructType>) => unknown,
    tag: SheetRuleCellMeta["tag"],
): SheetRuleCellMeta {
    const fn = East.function([rowType], undefined, (_$, r) => accessor(r) as SubtypeExprOrValue<EastType>) as unknown as SheetRuleCellMeta["fn"];
    const out = (Expr.type(fn) as FunctionType).output as EastType;
    const payload = optionPayload(out);
    const unwrapped = payload ?? out;
    if (cellTagOf(unwrapped) !== tag) {
        throw new Error(`Sheet: column "${key}" has a \`${rule}\` rule returning ${describeType(out)} — it must return ${tag} or Option<${tag}>`);
    }
    return { key: sheetRuleCell(rule, key), fn, tag, optional: payload !== undefined };
}

/**
 * The unrendered cells a column's rules project (#844) — `detail` on any
 * column, `level` and `actual` on a date column.
 */
function ruleCellsOf(key: string, kind: SheetColumnKindLiteral, cfg: SheetAnyColumnConfig, rowType: StructType): SheetRuleCellMeta[] {
    const out: SheetRuleCellMeta[] = [];
    if (cfg.detail !== undefined) out.push(ruleCell(key, "detail", rowType, cfg.detail, "String"));
    if (kind !== "date") {
        if (cfg.level !== undefined || cfg.actual !== undefined) {
            throw new Error(`Sheet: column "${key}" is a ${kind} column — \`level\` and \`actual\` are date-column rules`);
        }
        return out;
    }
    if (cfg.level !== undefined) {
        const level = cfg.level;
        const fn = East.function([rowType], StringType, (_$, r) => resolveTag(level(r), SheetDateLevelType).match({
            week:  (_$2) => "week",
            day:   (_$2) => "day",
            range: (_$2) => "range",
            time:  (_$2) => "time",
        })) as unknown as SheetRuleCellMeta["fn"];
        out.push({ key: sheetRuleCell("level", key), fn, tag: "String", optional: false });
    }
    if (cfg.actual !== undefined) out.push(ruleCell(key, "actual", rowType, cfg.actual, "DateTime"));
    return out;
}

/**
 * Describe one column against the row type — the build-time refusals of
 * §3.12 live here, every one naming the column and the remedy.
 *
 * @param key - The column key
 * @param col - The built column
 * @param rowType - The host's row type
 * @returns The column's metadata
 * @throws Error naming the column when the kind cannot sit on the field
 */
export function describeColumn(key: string, col: SheetColumn<StructType, EastType>, rowType: StructType): SheetColumnMeta {
    const meta = describeKind(key, col, rowType);
    const ruleCells = ruleCellsOf(key, col.kind, col.config, rowType);
    if (col.config.options !== undefined && col.kind !== "enum" && col.kind !== "lookup" && col.kind !== "link") {
        throw new Error(`Sheet: column "${key}" is a ${col.kind} column — an \`options\` rule narrows an enum, lookup or link column's members`);
    }
    return ruleCells.length > 0 ? { ...meta, ruleCells } : meta;
}

/** {@link describeColumn}'s kind-by-kind half. */
function describeKind(key: string, col: SheetColumn<StructType, EastType>, rowType: StructType): SheetColumnMeta {
    const fields = rowType.fields as Record<string, EastType>;
    const fieldType = fields[key];
    if (fieldType === undefined) {
        throw new Error(`Sheet: column "${key}" is not a field of the row type — the columns map is keyed by the row's fields (${Object.keys(fields).join(", ")})`);
    }
    const cfg = col.config;
    const kind = col.kind;
    const payloadOf = optionPayload(fieldType);
    const optional = payloadOf !== undefined;
    const unwrapped = payloadOf ?? fieldType;

    // A derived read — the projection decides the payload; the field is free.
    if (cfg.value !== undefined && kind !== "set" && kind !== "link" && kind !== "stamped" && kind !== "custom") {
        const payloadType = SCALAR_PAYLOAD[kind] as EastType;
        const derived = East.function([rowType], undefined, (_$, r) => cfg.value!(r)) as unknown as ExprType<FunctionType<[StructType], EastType>>;
        const out = (Expr.type(derived) as FunctionType).output as EastType;
        const outPayload = optionPayload(out);
        const outUnwrapped = outPayload ?? out;
        if (outUnwrapped !== payloadType) {
            throw new Error(`Sheet: column "${key}" is a ${kind} column whose \`value\` projection returns ${(outUnwrapped as { type: string }).type} — a ${kind} column's projection must return ${(payloadType as { type: string }).type} or its Option`);
        }
        return {
            key, field: key, kind, config: cfg, fieldType, optional, payloadType,
            cellTag: cellTagOf(payloadType)!, editable: false,
            derived, derivedOptional: outPayload !== undefined,
            ...(col.register !== undefined ? { register: col.register } : {}),
            ...(col.driverType !== undefined ? { driverType: col.driverType } : {}),
        };
    }

    if (kind === "set" || kind === "link") {
        let form: SheetLinkForm;
        let ownHalf: "from" | "to" | undefined;
        let otherField: string | undefined;
        if (fieldType === SheetLinkType || unwrapped === SheetLinkType) {
            form = "link";
        } else if (fieldType === SheetMembersType) {
            form = "array";
            if (kind === "set") {
                ownHalf = "to";
            } else if (cfg.to !== undefined && cfg.from === undefined) {
                ownHalf = "from"; otherField = cfg.to as string;
            } else if (cfg.from !== undefined && cfg.to === undefined) {
                ownHalf = "to"; otherField = cfg.from as string;
            } else {
                throw new Error(`Sheet: link column "${key}" sits on an Array<Member> field, so it must name the OTHER half's field — \`to: "…"\` when this field holds the from members, \`from: "…"\` when it holds the to members`);
            }
            if (otherField !== undefined && fields[otherField] !== SheetMembersType) {
                throw new Error(`Sheet: link column "${key}" names "${otherField}" as its other half, but that is not an Array<Sheet.Types.Member> field of the row`);
            }
        } else if ((unwrapped as { type: string }).type === "String") {
            form = "string";
        } else {
            throw new Error(`Sheet: ${kind} column "${key}" must sit on a Sheet.Types.Link, Array<Sheet.Types.Member> or String field — got ${(fieldType as { type: string }).type}`);
        }
        return {
            key, field: key, kind, config: cfg, fieldType, optional: form === "link" ? unwrapped === SheetLinkType && optional : optional,
            payloadType: SheetLinkType, cellTag: "Link", editable: cfg.editable !== false,
            form,
            ...(ownHalf !== undefined ? { ownHalf } : {}),
            ...(otherField !== undefined ? { otherField } : {}),
            ...(col.register !== undefined ? { register: col.register } : {}),
            ...(col.driverType !== undefined ? { driverType: col.driverType } : {}),
        };
    }

    if (kind === "custom") {
        const parseFn = East.value(cfg.parse as never) as ExprType<EastType>;
        const parseType = typeOf(parseFn) as FunctionType;
        const parsed = optionPayload(parseType.output as EastType);
        if (parsed === undefined) {
            throw new Error(`Sheet: custom column "${key}" has a \`parse\` whose output is not an Option — it must return Option<payload>, \`none\` meaning unrecognised`);
        }
        if (parsed !== unwrapped) {
            throw new Error(`Sheet: custom column "${key}" parses to ${(parsed as { type: string }).type} but sits on a ${(unwrapped as { type: string }).type} field — the payload must be the field's type (or its Option's)`);
        }
        const tag = cellTagOf(parsed);
        if (tag === undefined) {
            throw new Error(`Sheet: custom column "${key}" has payload ${(parsed as { type: string }).type}, which no cell holds — use String, Integer, Float, DateTime, Boolean or Sheet.Types.Link`);
        }
        return { key, field: key, kind, config: cfg, fieldType, optional, payloadType: parsed, cellTag: tag, editable: cfg.editable !== false };
    }

    const payloadType = SCALAR_PAYLOAD[kind] as EastType;
    if (unwrapped !== payloadType) {
        throw new Error(`Sheet: ${kind} column "${key}" must sit on a ${(payloadType as { type: string }).type} or Option<${(payloadType as { type: string }).type}> field — got ${(fieldType as { type: string }).type}`);
    }
    return {
        key, field: key, kind, config: cfg, fieldType, optional, payloadType,
        cellTag: cellTagOf(payloadType)!,
        editable: kind !== "stamped" && cfg.editable !== false,
        ...(col.register !== undefined ? { register: col.register } : {}),
        ...(col.driverType !== undefined ? { driverType: col.driverType } : {}),
    };
}

/**
 * Describe one band cell against the GROUP's row type (#740) — a column
 * declared over the group's field, keyed by the line column it sits under.
 *
 * @param cellKey - The line column the cell sits under, or `$title`
 * @param cell - The built band cell
 * @param groupType - The group's row type
 * @returns The cell's metadata
 * @throws Error naming the band cell when the kind cannot sit on the field, or is not a band kind
 */
export function describeGroupCell(cellKey: string, cell: SheetGroupCell<StructType>, groupType: StructType): SheetColumnMeta {
    if (cell.kind === "lookup" || cell.kind === "set" || cell.kind === "link" || cell.kind === "custom") {
        throw new Error(`Sheet: band cell "${cellKey}" is a ${cell.kind} cell — a band draws text, date, quantity, integer, reference, enum and stamped cells only`);
    }
    let meta: SheetColumnMeta;
    try {
        meta = describeColumn(cell.field, { kind: cell.kind, config: cell.config, ...(cell.register !== undefined ? { register: cell.register } : {}) }, groupType);
    } catch (e) {
        throw new Error(`Sheet: band cell "${cellKey}" — ${(e as Error).message.replace(/^Sheet: /, "")}`);
    }
    return { ...meta, key: cellKey, field: cell.field };
}

// ============================================================================
// Cells — payload ↔ cell (the static-tag moves)
// ============================================================================

/** A payload value as a cell. */
export function cellOfPayload(tag: SheetColumnMeta["cellTag"], v: ExprType<EastType>): ExprType<SheetCellType> {
    return East.value(variant(tag, v) as unknown as SubtypeExprOrValue<SheetCellType>, SheetCellType);
}

/** The blank cell. */
export const NULL_CELL = East.value(variant("Null", null), SheetCellType);

/** A field VALUE (the payload or its Option) as a cell, by the column's static shape. */
function cellOfFieldValue(tag: SheetColumnMeta["cellTag"], v: ExprType<EastType>, optional: boolean): ExprType<SheetCellType> {
    if (!optional) return cellOfPayload(tag, v);
    return (v as unknown as ExprType<OptionType<EastType>>).match({
        some: (_$, x) => cellOfPayload(tag, x as ExprType<EastType>),
        none: (_$) => NULL_CELL,
    }) as ExprType<SheetCellType>;
}

/**
 * The cell of a column for one row — the projection `make` and `encode`
 * share. `members` is the column's register (bound in the caller's block)
 * for the `String` link form.
 */
function projectCell(
    meta: SheetColumnMeta,
    r: ExprType<StructType>,
    members: ExprType<typeof SheetRegisterMembersType> | undefined,
): ExprType<SheetCellType> {
    const row = r as unknown as Record<string, ExprType<EastType>>;
    if (meta.derived !== undefined) {
        return cellOfFieldValue(meta.cellTag, meta.derived(r), meta.derivedOptional === true);
    }
    const fv = row[meta.field] as ExprType<EastType>;
    if (meta.form === undefined) return cellOfFieldValue(meta.cellTag, fv, meta.optional);
    if (meta.form === "link") return cellOfFieldValue(meta.cellTag, fv, meta.optional);
    if (meta.form === "array") {
        const half = fv as unknown as ExprType<typeof SheetMembersType>;
        const empty = East.value([], SheetMembersType);
        const other = meta.otherField !== undefined ? row[meta.otherField] as unknown as ExprType<typeof SheetMembersType> : empty;
        const link = meta.ownHalf === "from"
            ? East.value({ from: half, to: other }, SheetLinkType)
            : East.value({ from: other, to: half }, SheetLinkType);
        return cellOfPayload("Link", link as unknown as ExprType<EastType>);
    }
    // The String form — the grammar parses it on read; blank text is the blank cell.
    const parse = (text: ExprType<StringType>): ExprType<SheetCellType> =>
        text.trim().length().equal(0n).ifElse(
            (_$) => NULL_CELL,
            (_$) => cellOfPayload("Link", parseLink(text, members ?? East.value([], SheetRegisterMembersType)) as unknown as ExprType<EastType>),
        ) as ExprType<SheetCellType>;
    if (!meta.optional) return parse(fv as ExprType<StringType>);
    return (fv as unknown as ExprType<OptionType<StringType>>).match({
        some: (_$, s) => parse(s),
        none: (_$) => NULL_CELL,
    }) as ExprType<SheetCellType>;
}

// ============================================================================
// The bridge
// ============================================================================

/** The resolved source the bridge reads real rows from. */
export type SheetBridgeSource =
    | { kind: "inline"; rows: ExprType<ArrayType<StructType>> }
    | { kind: "paged"; source: ExprType<StructType>; keyed: boolean };

/**
 * The group half of a bridge (#740) — the group's summary cells and child rows on
 * the wire.
 *
 * @internal
 */
export interface SheetGroupBridge {
    /** The field holding the lines. */
    linesField: string;
    /** `true` ⇒ `Dict<String, L>` lines; `false` ⇒ `Array<L>` lines. */
    keyed: boolean;
    /** The band's cells, the title first. */
    cellMetas: SheetColumnMeta[];
    /** `P` → the band's cells. */
    projectGroupCells: ExprType<FunctionType<[StructType], typeof SheetCellsType>>;
    /** `P` → its wire lines, in order, keyed by source identity. */
    projectLines: ExprType<FunctionType<[StructType], ArrayType<SheetLineType>>>;
}

/**
 * The compiled bridge of one sheet — every wire function the root stores is
 * built from these.
 *
 * @remarks
 * `rowType` is the SOURCE row's type — the host's row on a flat sheet, the
 * group's on a grouped one — and `lineType` the type the columns are
 * declared over: the same type on a flat sheet, the line type on a grouped
 * one. The patch, the proposal, `projectRow` and `draftRow` run over
 * `lineType`; `rowById` and the edit type over `rowType`.
 *
 * @internal
 */
export interface SheetBridge {
    /** The source row's type — the host's row, or the group's. */
    rowType: StructType;
    /** The type the columns are declared over — the row, or the line. */
    lineType: StructType;
    /** The driver's row type (`NullType` without a driver). */
    driverType: EastType;
    /** `Sheet.Types.DraftContext(R, D)` — or `Context(P, "lines", D)` on a grouped sheet. */
    ctxType: StructType;
    /** `Sheet.Types.CheckContext(R)` — or `CheckContext(P, "lines")`. */
    checkCtxType: StructType;
    /** `Sheet.Types.Patch(L)`. */
    patchType: StructType;
    /** `Sheet.Types.Proposal(L)`. */
    proposalType: StructType;
    /** Constructor defaults, including read-only cells. */
    seedCells: SheetBridge["encodePatch"];
    /** `L` → the wire cells. */
    projectRow: ExprType<FunctionType<[StructType], typeof SheetCellsType>>;
    /** `L` → its sub rows, sources in declaration order (#844; `[]` without `subRows`). */
    projectSubRows: ExprType<FunctionType<[StructType], ArrayType<SheetSubRowType>>>;
    /** Decode one row into its complete field draft. */
    draftRow: ReturnType<typeof buildDraftRowDecoder>;
    /** Decode edited cells into field drafts, preserving the previous child identities. */
    draftDecode: ExprType<FunctionType<[SheetRowType, OptionType<StructType>, OptionType<SheetRowType>], StructType>>;
    /** `(id, offset)` → the real source row. */
    rowById: ExprType<FunctionType<[StringType, IntegerType], OptionType<StructType>>>;
    /** The wire context → the typed context. */
    bridgeCtx: ExprType<FunctionType<[SheetContextType], StructType>>;
    /** A readiness batch → one typed context per check, over rows built once (#882). */
    bridgeReady: ExprType<FunctionType<[typeof SheetReadyBatchType], ArrayType<StructType>>>;
    /** `Sheet.Types.Patch(L)` → the set fields as cells. */
    encodePatch: ExprType<FunctionType<[StructType], typeof SheetCellsType>>;
    /** The group half — present on a grouped sheet. */
    group?: SheetGroupBridge;
}

/** The group declaration the bridge needs from the root (#740). */
export interface SheetBridgeGroupInput {
    /** The field holding the lines. */
    linesField: string;
    /** The band's cells, the title first. */
    cellMetas: SheetColumnMeta[];
}

/** What the bridge needs from the root. */
export interface SheetBridgeInput {
    rowType: StructType;
    idField: string | undefined;
    metas: SheetColumnMeta[];
    registers: Record<string, SheetRegisterValue>;
    driver: SheetDriverValue | undefined;
    source: SheetBridgeSource;
    group?: SheetBridgeGroupInput;
    subRows?: SheetSubRowsValue<StructType>;
}

/** The id of a row — the id field, or the key of a keyed window. */
function idOf(r: ExprType<StructType>, idField: string | undefined): ExprType<StringType> {
    if (idField === undefined) throw new Error("Sheet: a positional source needs `id` — the String field that identifies a row");
    return (r as unknown as Record<string, ExprType<StringType>>)[idField] as ExprType<StringType>;
}

/**
 * Compile the bridge for one sheet.
 *
 * @param input - The root's resolved declaration
 * @returns The bridge
 */
export function buildBridge(input: SheetBridgeInput): SheetBridge {
    const { rowType, idField, metas, registers, driver, source, group: groupInput, subRows } = input;
    const driverType: EastType = driver !== undefined ? driver.rowType : NullType;
    // A grouped sheet's columns are declared over the LINE type; its source
    // rows are groups. A flat sheet's line type is its row type.
    const shape = groupInput !== undefined ? sheetLinesOf(rowType, groupInput.linesField) : undefined;
    const lineType = shape?.lineType ?? rowType;
    const lineIdField = shape === undefined ? idField : undefined;
    const ctxType = (groupInput !== undefined
        ? SheetGroupContextTypeFor(rowType, groupInput.linesField as never, driverType)
        : SheetContextTypeFor(lineType, driverType)) as unknown as StructType;
    const checkCtxType = (groupInput !== undefined
        ? SheetGroupCheckContextTypeFor(rowType, groupInput.linesField as never)
        : SheetCheckContextTypeFor(lineType)) as unknown as StructType;
    const patchType = SheetPatchTypeFor(lineType) as unknown as StructType;
    const proposalType = SheetProposalTypeFor(lineType) as unknown as StructType;
    // L → the wire cells. Registers are bound ONCE per body for the String
    // link form (the capture rule: data, never a spliced expression).
    const stringFormRegisters = [...new Set(metas.filter((m) => m.form === "string" && m.register !== undefined).map((m) => m.register!))];
    const projectRow = East.function([lineType], SheetCellsType, ($, r) => {
        const cells = $.let(new Map<string, never>(), SheetCellsType);
        const bound = new Map<string, ExprType<typeof SheetRegisterMembersType>>();
        for (const name of stringFormRegisters) {
            bound.set(name, $.const(registers[name]!, SheetRegisterMembersType));
        }
        for (const m of metas) {
            $(cells.insert(m.key, projectCell(m, r, m.register !== undefined ? bound.get(m.register) : undefined)));
            for (const rc of m.ruleCells ?? []) {
                const rule = $.const(rc.fn);
                $(cells.insert(rc.key, cellOfFieldValue(rc.tag, rule(r), rc.optional)));
            }
        }
        return cells;
    }) as unknown as SheetBridge["projectRow"];
    const projectSubRows = buildSubRowProjection(lineType, subRows);

    // (id, offset) → the real source row. Inline, the row at its offset
    // answers first — the renderer reads a resident row where it sits — and
    // otherwise the nearest match outward from there, so a row that a local
    // edit shifted is found in the steps it moved: a read is never a scan of
    // the collection, which made every context and every readiness check
    // quadratic in the rows (#859). The search starts inside the rows, so a
    // stale offset still finds the row.
    const rowById = source.kind === "inline"
        ? East.function([StringType, IntegerType], OptionType(rowType), ($, id, offset) => {
            const rows = $.const(source.rows, ArrayType(rowType));
            const size = $.let(rows.size());
            const start = $.let(offset.less(0n).ifElse(() => 0n, () => offset.greaterEqual(size).ifElse(() => size.subtract(1n), () => offset)));
            const step = $.let(0n);
            $.while(start.subtract(step).greaterEqual(0n).or(() => start.add(step).less(size)), ($2) => {
                const below = $2.let(start.subtract(step));
                $2.if(below.greaterEqual(0n), ($3) => {
                    const r = $3.let(rows.get(below));
                    $3.if(idOf(r, idField).equal(id), ($4) => { $4.return(East.value(some(r), OptionType(rowType))); });
                });
                const above = $2.let(start.add(step));
                $2.if(step.greater(0n).and(() => above.less(size)), ($3) => {
                    const r = $3.let(rows.get(above));
                    $3.if(idOf(r, idField).equal(id), ($4) => { $4.return(East.value(some(r), OptionType(rowType))); });
                });
                $2.assign(step, step.add(1n));
            });
            return East.value(none, OptionType(rowType));
        })
        : East.function([StringType, IntegerType], OptionType(rowType), ($, id, offset) => {
            const src = $.const(source.source as unknown as ExprType<StructType<{ page: FunctionType<[IntegerType, IntegerType], OptionType<EastType>> }>>);
            const noRow = $.const(none, OptionType(rowType));
            return src.page(offset, 1n).match({
                none: (_$) => noRow,
                some: (_$, win) => source.keyed
                    ? (win as unknown as ExprType<DictType<StringType, StructType>>).tryGet(id)
                    : (win as unknown as ExprType<ArrayType<StructType>>).firstMap((_$2, r) => idOf(r, idField).equal(id).ifElse(
                        (_$3) => East.value(some(r), OptionType(rowType)),
                        (_$3) => East.value(none, OptionType(rowType)),
                    )),
            });
        });

    // The driver lookup — the driver data folded once into a dictionary; a
    // driverless sheet's lookup is always `none` (its `D` is `Null`).
    const lookupDriver = driver !== undefined
        ? East.function([StringType], OptionType(driverType), ($, k) => {
            const dict = $.const(
                driver.data.toDict((_$, d) => driver.keyFn(d), (_$, d) => d),
                DictType(StringType, driverType),
            );
            return dict.tryGet(k);
        })
        : East.function([StringType], OptionType(driverType), ($, _k) => $.const(none, OptionType(driverType)));

    // The group half (#740) — built before the context bridge, which decodes groups.
    const group = groupInput !== undefined && shape !== undefined
        ? buildGroupBridge(rowType, groupInput, projectRow, projectSubRows)
        : undefined;

    const draftRow = buildDraftRowDecoder(lineType, metas, registers, lineIdField);
    const flatDraft = SheetDraftTypeFor(rowType) as StructType;
    const draftDecode = groupInput !== undefined
        ? buildDraftGroupDecoder(rowType, groupInput.linesField, groupInput.cellMetas, draftRow, registers, idField)
        : East.function([SheetRowType, OptionType(flatDraft), OptionType(SheetRowType)], flatDraft, ($, row, base, _previous) => {
            const decode = $.const(draftRow);
            return decode(row.id, row.cells, base);
        });

    const bridgeCtx = buildDraftContextBridge(rowType, lineType, groupInput?.linesField, ctxType, driverType,
        rowById as SheetBridge["rowById"], draftDecode, draftRow, lookupDriver);
    const bridgeReady = buildReadyContexts(rowType, groupInput?.linesField, ctxType, driverType,
        rowById as SheetBridge["rowById"], draftDecode, lookupDriver);

    const encodePatch = buildPatchCells(lineType, metas, registers);

    return {
        rowType, lineType, driverType, ctxType, checkCtxType, patchType, proposalType,
        projectRow, projectSubRows, draftDecode, draftRow,
        rowById: rowById as unknown as SheetBridge["rowById"],
        bridgeCtx: bridgeCtx as unknown as SheetBridge["bridgeCtx"],
        bridgeReady,
        encodePatch, seedCells: buildPatchCells(lineType, metas, registers, false),
        ...(group !== undefined ? { group } : {}),
    };
}

/** Project supplied constructor/proposal fields without inventing a complete row. @internal */
export function buildPatchCells(rowType: StructType, metas: readonly SheetColumnMeta[], registers: Record<string, SheetRegisterValue>, editableOnly = true): SheetBridge["encodePatch"] {
    const patchType = SheetPatchTypeFor(rowType) as StructType;
    const fields = rowType.fields;
    const stringFormRegisters = [...new Set(metas.filter(m => m.form === "string" && m.register !== undefined).map(m => m.register!))];
    return East.function([patchType], SheetCellsType, ($, patch) => {
        const cells = $.let(new Map<string, never>(), SheetCellsType);
        const p = patch as unknown as Record<string, ExprType<OptionType<EastType>>>;
        const bound = new Map<string, ExprType<typeof SheetRegisterMembersType>>();
        for (const name of stringFormRegisters) {
            bound.set(name, $.const(registers[name]!, SheetRegisterMembersType));
        }
        for (const m of metas) {
            if ((editableOnly && !m.editable) || m.derived !== undefined) continue;
            if (m.form === "array") {
                // The other half is `none` when the column names no other field.
                const otherKey = m.otherField;
                const own = $.let(p[m.field] as never, OptionType(SheetMembersType));
                const other = $.let((otherKey !== undefined ? p[otherKey] : none) as never, OptionType(SheetMembersType));
                $.if(own.hasTag("some").or(() => other.hasTag("some")), ($2) => {
                    const empty = $2.const([], SheetMembersType);
                    const ownVal = $2.let(own.match({ some: (_$, v) => v, none: (_$) => empty }), SheetMembersType);
                    const otherVal = $2.let(other.match({ some: (_$, v) => v, none: (_$) => empty }), SheetMembersType);
                    const link = m.ownHalf === "from"
                        ? $2.let({ from: ownVal, to: otherVal }, SheetLinkType)
                        : $2.let({ from: otherVal, to: ownVal }, SheetLinkType);
                    $2(cells.insert(m.key, cellOfPayload("Link", link as unknown as ExprType<EastType>)));
                });
                continue;
            }
            const field = $.let(p[m.field] as never, OptionType(fields[m.field] as EastType));
            $.if(field.hasTag("some"), ($2) => {
                const v = $2.let(field.unwrap("some") as never, fields[m.field] as EastType);
                const asRow = { [m.field]: v } as unknown as ExprType<StructType>;
                $2(cells.insert(m.key, projectCell(m, asRow, m.register !== undefined ? bound.get(m.register) : undefined)));
            });
        }
        return cells;
    }) as unknown as SheetBridge["encodePatch"];
}

// ============================================================================
// Sub rows (#844)
// ============================================================================

/**
 * Compile the sub-row sources into one projection over the line type: each
 * mapper is compiled ONCE as `East.function([L, T], SubRow)` and called in
 * an eager map over its field; the sources concatenate in declaration order.
 *
 * @param lineType - The type the columns are built over
 * @param subRows - The `subRows` declaration, if any
 * @returns `L` → its sub rows
 * @throws Error when the declaration was built over another type, or a key is not an array field
 */
export function buildSubRowProjection(lineType: StructType, subRows: SheetSubRowsValue<StructType> | undefined): SheetBridge["projectSubRows"] {
    const fields = lineType.fields as Record<string, EastType>;
    const mappers: { field: string; fn: ExprType<FunctionType<[StructType, EastType], SheetSubRowType>> }[] = [];
    if (subRows !== undefined) {
        if (subRows.rowType !== lineType) {
            throw new Error("Sheet: `subRows` was built over a different type than the columns — pass the columns' type (a grouped sheet: the line type) to `Sheet.subRows(…)`");
        }
        for (const [field, map] of Object.entries(subRows.sources as Record<string, ((item: ExprType<EastType>, row: ExprType<StructType>) => SubtypeExprOrValue<SheetSubRowType>) | undefined>)) {
            if (map === undefined) continue;
            const t = fields[field] as { type?: string; value?: EastType } | undefined;
            if (t === undefined || t.type !== "Array" || t.value === undefined) {
                throw new Error(`Sheet: \`subRows\` names "${field}", which is ${t === undefined ? "not a field of the row type" : `a ${t.type} field`} — a sub-row source must be an Array field`);
            }
            mappers.push({ field, fn: East.function([lineType, t.value], SheetSubRowType, (_$, row, item) => map(item, row)) });
        }
    }
    return East.function([lineType], ArrayType(SheetSubRowType), ($, r) => {
        const row = r as unknown as Record<string, ExprType<ArrayType<EastType>>>;
        let all: ExprType<ArrayType<SheetSubRowType>> = $.const([], ArrayType(SheetSubRowType));
        for (const m of mappers) {
            const map = $.const(m.fn);
            const part = $.let(row[m.field]!.map((_$2, x) => map(r, x)), ArrayType(SheetSubRowType));
            all = mappers[0] === m ? part : $.let(all.concat(part), ArrayType(SheetSubRowType));
        }
        return all;
    }) as unknown as SheetBridge["projectSubRows"];
}

// ============================================================================
// The group half (#740)
// ============================================================================

/**
 * Compile a group's summary cells and ordered children into wire rows.
 *
 * @param rowType - The group's row type
 * @param input - The child field and summary cell metadata
 * @param projectRow - Child row to wire cells
 * @param projectSubRows - Child row to its sub rows
 * @returns The group half
 */
function buildGroupBridge(
    rowType: StructType,
    input: SheetBridgeGroupInput,
    projectRow: SheetBridge["projectRow"],
    projectSubRows: SheetBridge["projectSubRows"],
): SheetGroupBridge {
    const { linesField, cellMetas } = input;
    const linesType = rowType.fields[linesField] as ArrayType<StructType>;
    const projectGroupCells = East.function([rowType], SheetCellsType, ($, p) => {
        const cells = $.let(new Map<string, never>(), SheetCellsType);
        for (const m of cellMetas) $(cells.insert(m.key, projectCell(m, p, undefined)));
        return cells;
    }) as SheetGroupBridge["projectGroupCells"];
    const projectLines = East.function([rowType], ArrayType(SheetLineType), ($, p) => {
        const project = $.const(projectRow);
        const subRowsOf = $.const(projectSubRows);
        const lines = $.const(p[linesField] as ExprType<ArrayType<StructType>>, linesType);
        return lines.map((_$, line, index) => East.value({ key: East.print(index), cells: project(line), subRows: subRowsOf(line) }, SheetLineType));
    }) as SheetGroupBridge["projectLines"];
    return { linesField, keyed: false, cellMetas, projectGroupCells, projectLines };
}

// ============================================================================
// Wrappers — the author's typed functions inside their wire twins
// ============================================================================

/** Whether an East function value is asynchronous. */
export function isAsyncFunction(fn: ExprType<EastType>): boolean {
    return (typeOf(fn) as { type: string }).type === "AsyncFunction";
}

/** Pin an author function value and check its East input type against the bridge's context type. */
function pinProvider(
    bridge: SheetBridge,
    fn: unknown,
    where: string,
    expectedOutput: EastType,
): { fn: ExprType<EastType>; async: boolean } {
    const expr = East.value(fn as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const t = typeOf(expr) as { type: string; inputs?: EastType[]; output?: EastType };
    if (t.type !== "Function" && t.type !== "AsyncFunction") {
        throw new Error(`Sheet: ${where} must be an East.function or East.asyncFunction — got a ${t.type}`);
    }
    const inputs = t.inputs ?? [];
    if (inputs.length !== 1 || inputs[0] !== bridge.ctxType) {
        throw new Error(`Sheet: ${where} must take exactly this sheet's context — ${contextName(bridge)} — as its one argument; a function written over another row or driver type cannot run here`);
    }
    if (t.output !== expectedOutput) {
        throw new Error(`Sheet: ${where} returns the wrong type — it must return ${describeType(expectedOutput)}`);
    }
    return { fn: expr, async: t.type === "AsyncFunction" };
}

/** How this sheet's context is spelt, for a refusal message. */
function contextName(bridge: SheetBridge): string {
    const driver = bridge.driverType === NullType ? "" : ", DriverType";
    return bridge.group !== undefined
        ? `Sheet.Types.DraftContext(GroupType, "${bridge.group.linesField}"${driver})`
        : `Sheet.Types.DraftContext(RowType${driver})`;
}

/** A short description of an East type for a refusal message. */
function describeType(t: EastType): string {
    const v = t as { type: string; cases?: Record<string, EastType>; fields?: Record<string, EastType>; value?: EastType };
    if (v.type === "Variant" && v.cases !== undefined && optionPayload(t) !== undefined) return `Option<${describeType(optionPayload(t)!)}>`;
    if (v.type === "Struct" && v.fields !== undefined) return `{ ${Object.entries(v.fields).map(([k, f]) => `${k}: ${describeType(f)}`).join(", ")} }`;
    if (v.type === "Array" && v.value !== undefined) return `Array<${describeType(v.value)}>`;
    return v.type;
}

/**
 * Wrap a fill provider — `Sheet.Types.DraftContext(R, D)` → `Option<Fill(T)>` —
 * into the wire provider variant (sync or async by the function's type).
 */
export function wrapProvider(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown, index: number): ExprType<SheetProviderType> {
    const fillType = StructType({ value: meta.payloadType, meta: StringType });
    const { fn: author, async } = pinProvider(bridge, fn, `column "${meta.key}" fill provider #${index + 1}`, OptionType(fillType));
    const body = ($: BlockBuilder<OptionType<SheetFillType>>, ctx: ExprType<SheetContextType>): ExprType<OptionType<SheetFillType>> => {
        const a = $.const(author as unknown as ExprType<FunctionType<[StructType], OptionType<StructType<{ value: EastType; meta: StringType }>>>>);
        const bc = $.const(bridge.bridgeCtx);
        const typed = $.let(bc(ctx), bridge.ctxType);
        return a(typed).match({
            none: (_$) => East.value(none, OptionType(SheetFillType)),
            some: (_$, f) => East.value(some({ value: cellOfPayload(meta.cellTag, f.value as ExprType<EastType>), meta: f.meta }), OptionType(SheetFillType)),
        }) as ExprType<OptionType<SheetFillType>>;
    };
    const wire = async
        ? East.asyncFunction([SheetContextType], OptionType(SheetFillType), body)
        : East.function([SheetContextType], OptionType(SheetFillType), body);
    return East.value(variant(async ? "async" : "sync", wire) as unknown as SubtypeExprOrValue<SheetProviderType>, SheetProviderType);
}

/**
 * Wrap a row proposer — `Sheet.Types.DraftContext(R, D)` → `Array<Proposal(R)>` —
 * into the wire proposer variant.
 */
export function wrapProposer(bridge: SheetBridge, fn: unknown, index: number): ExprType<SheetProposerType> {
    const { fn: author, async } = pinProvider(bridge, fn, `suggest.propose #${index + 1}`, ArrayType(bridge.proposalType));
    const body = ($: BlockBuilder<ArrayType<SheetProposalType>>, ctx: ExprType<SheetContextType>): ExprType<ArrayType<SheetProposalType>> => {
        const a = $.const(author as unknown as ExprType<FunctionType<[StructType], ArrayType<StructType<{ patch: StructType; meta: StringType }>>>>);
        const bc = $.const(bridge.bridgeCtx);
        const enc = $.const(bridge.encodePatch);
        const typed = $.let(bc(ctx), bridge.ctxType);
        return a(typed).map((_$, p) => East.value({ cells: enc(p.patch), meta: p.meta }, SheetProposalType)) as unknown as ExprType<ArrayType<SheetProposalType>>;
    };
    const wire = async
        ? East.asyncFunction([SheetContextType], ArrayType(SheetProposalType), body)
        : East.function([SheetContextType], ArrayType(SheetProposalType), body);
    return East.value(variant(async ? "async" : "sync", wire) as unknown as SubtypeExprOrValue<SheetProposerType>, SheetProposerType);
}

/** Wrap an arity rule — `Sheet.Types.DraftContext(R, D)` → `Option<Counted>`. */
export function wrapArity(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown): ExprType<FunctionType<[SheetContextType], OptionType<SheetCountedType>>> {
    const { fn: author, async } = pinProvider(bridge, fn, `column "${meta.key}" arity rule`, OptionType(SheetCountedType));
    if (async) throw new Error(`Sheet: column "${meta.key}" arity rule must be synchronous — the strip reads it while the half is edited`);
    return East.function([SheetContextType], OptionType(SheetCountedType), ($, ctx) => {
        const a = $.const(author as unknown as ExprType<FunctionType<[StructType], OptionType<SheetCountedType>>>);
        const bc = $.const(bridge.bridgeCtx);
        return a(bc(ctx));
    });
}

/**
 * Wrap an options rule (#844) — `Sheet.Types.DraftContext(R, D)` →
 * `Option<Array<String>>` — into the wire rule. Synchronous: the menu reads
 * it as the cell opens.
 */
export function wrapOptions(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown): ExprType<SheetOptionsRuleType> {
    const { fn: author, async } = pinProvider(bridge, fn, `column "${meta.key}" options rule`, OptionType(ArrayType(StringType)));
    if (async) throw new Error(`Sheet: column "${meta.key}" options rule must be synchronous — the menu reads it as the cell opens`);
    return East.function([SheetContextType], OptionType(ArrayType(StringType)), ($, ctx) => {
        const a = $.const(author as unknown as ExprType<FunctionType<[StructType], OptionType<ArrayType<StringType>>>>);
        const bc = $.const(bridge.bridgeCtx);
        return a(bc(ctx));
    });
}

/** Wrap an author member check — `Sheet.Types.CheckContext(R)` → `Option<String>` — into the `custom` check arm. */
export function wrapCheck(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown, index: number): ExprType<SheetCheckType> {
    const expr = East.value(fn as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const t = typeOf(expr) as { type: string; inputs?: EastType[]; output?: EastType };
    if (t.type !== "Function" || (t.inputs ?? []).length !== 1 || t.inputs![0] !== bridge.checkCtxType || t.output !== OptionType(StringType)) {
        const spelt = bridge.group !== undefined ? `Sheet.Types.CheckContext(GroupType, "${bridge.group.linesField}")` : "Sheet.Types.CheckContext(RowType)";
        throw new Error(`Sheet: column "${meta.key}" check #${index + 1} must be an East.function over ${spelt} returning Option<String>`);
    }
    const field = bridge.group?.linesField;
    const draftType = (field === undefined ? SheetDraftTypeFor(bridge.rowType) : SheetDraftGroupTypeFor(bridge.rowType, field)) as StructType;
    const rowDraft = SheetDraftTypeFor(bridge.lineType) as StructType;
    const base = buildDraftBase(bridge.rowType, field, bridge.rowById);
    const wire = East.function([SheetCheckContextType], OptionType(StringType), ($, c) => {
        const a = $.const(expr as ExprType<FunctionType<[StructType], OptionType<StringType>>>);
        const read = $.const(base);
        const dec = $.const(bridge.draftRow);
        const decGroup = $.const(bridge.draftDecode);
        const original = $.const(read(c.drafts, c.rowId, c.offset));
        if (field === undefined) {
            const row = $.const(dec(c.rowId, c.row, original));
            return a($.const({ rowIndex: c.rowIndex, row, group: none, half: c.half, member: c.member } as SubtypeExprOrValue<StructType>, bridge.checkCtxType));
        }
        const group = $.const(c.group.match({
            none: () => original,
            some: (_$, wire) => some(decGroup(wire, original, some(wire))),
        }), OptionType(draftType));
        const prior = $.const(group.match({
            none: () => none,
            some: (_$, value) => {
                const children = value[field] as ExprType<ArrayType<StructType>>;
                return c.rowIndex.greaterEqual(0n).and(() => c.rowIndex.less(children.size())).ifElse(() => some(children.get(c.rowIndex)), () => none);
            },
        }), OptionType(rowDraft));
        const row = $.const(dec("", c.row, prior));
        return a($.const({ rowIndex: c.rowIndex, row, group, half: c.half, member: c.member } as SubtypeExprOrValue<StructType>, bridge.checkCtxType));
    });
    return East.value(variant("custom", wire) as unknown as SubtypeExprOrValue<SheetCheckType>, SheetCheckType);
}

/** Wrap a custom kind's `parse` — `(text, Context(R, D))` → `Option<P>` — into the wire parse. */
export function wrapCustomParse(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown): ExprType<FunctionType<[StringType, SheetContextType], OptionType<SheetCellType>>> {
    const expr = East.value(fn as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const t = typeOf(expr) as { type: string; inputs?: EastType[]; output?: EastType };
    const inputs = t.inputs ?? [];
    if (t.type !== "Function" || inputs.length !== 2 || inputs[0] !== StringType || inputs[1] !== bridge.ctxType) {
        throw new Error(`Sheet: custom column "${meta.key}" \`parse\` must be an East.function over (String, ${contextName(bridge)}) returning Option<payload>`);
    }
    return East.function([StringType, SheetContextType], OptionType(SheetCellType), ($, text, ctx) => {
        const a = $.const(expr as unknown as ExprType<FunctionType<[StringType, StructType], OptionType<EastType>>>);
        const bc = $.const(bridge.bridgeCtx);
        return a(text, bc(ctx)).match({
            none: (_$) => East.value(none, OptionType(SheetCellType)),
            some: (_$, v) => East.value(some(cellOfPayload(meta.cellTag, v as ExprType<EastType>)), OptionType(SheetCellType)),
        });
    });
}

/** Wrap a custom kind's `print` — `P` → `String` — into the wire print. */
export function wrapCustomPrint(meta: SheetColumnMeta, fn: unknown): ExprType<FunctionType<[SheetCellType], StringType>> {
    const expr = East.value(fn as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const t = typeOf(expr) as { type: string; inputs?: EastType[]; output?: EastType };
    const inputs = t.inputs ?? [];
    if (t.type !== "Function" || inputs.length !== 1 || inputs[0] !== meta.payloadType || t.output !== StringType) {
        throw new Error(`Sheet: custom column "${meta.key}" \`print\` must be an East.function over the payload (${describeType(meta.payloadType)}) returning String`);
    }
    return East.function([SheetCellType], StringType, ($, cell) => {
        const a = $.const(expr as unknown as ExprType<FunctionType<[EastType], StringType>>);
        return cell.match(
            { [meta.cellTag]: (_$: unknown, v: ExprType<EastType>) => a(v) } as never,
            (_$: unknown) => East.value("", StringType),
        ) as ExprType<StringType>;
    });
}

/** Re-exported for the root's driver-typed refusals. */
export { SheetHalfType, BooleanType, AsyncFunctionType, EMPTY_LINK };
