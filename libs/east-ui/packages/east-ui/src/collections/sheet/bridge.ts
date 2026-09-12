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
 * - `decode` — the source row as the base (the row type's default when
 *   absent — an insert, a proposal), then each column's field from its cell
 *   by the static tag. A field with no column keeps the base row's value;
 * - `bridgeCtx` — the wire context to `Sheet.Types.Context(R, D)`;
 * - the wrappers — a fill provider, a proposer, an arity rule, a member
 *   check, a custom kind's parse / print, `onEdit` — each the author's typed
 *   function inside its closed wire twin.
 *
 * On a GROUPED sheet (#740) the source row is the group `P` and the columns
 * are declared over the line `L` its lines field holds: `projectRow` /
 * `decode` / the patch run over `L`, `rowById` returns the group, and the
 * group half of the bridge ({@link SheetGroupBridge}) projects a group's
 * band cells and lines and decodes a wire group row back to `P`. A wire
 * line's `key` is its identity for the bridge — the source index (`Array`
 * lines) or the dictionary key (`Dict` lines) at projection, or a minted
 * key for a line the source does not hold yet — while a line ADDRESS in an
 * edit event is its position (`Array`) or key (`Dict`).
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
    defaultValue,
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
    SheetFillType,
    SheetProposalType,
    SheetProviderType,
    SheetProposerType,
    SheetCheckContextType,
    SheetCheckType,
    SheetCountedType,
    SheetEditType,
    SheetHalfType,
    SheetContextTypeFor,
    SheetCheckContextTypeFor,
    SheetEditTypeFor,
    SheetPatchTypeFor,
    SheetProposalTypeFor,
    SheetGroupContextTypeFor,
    SheetGroupEditTypeFor,
    SheetGroupCheckContextTypeFor,
    sheetLinesOf,
    type SheetColumnKindLiteral,
} from "./types.js";
import { SheetMembersType, SheetRegisterMembersType, parseLink, printLink, printLinkWith, EMPTY_LINK } from "./link.js";
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
function cellOfFieldValue(meta: SheetColumnMeta, v: ExprType<EastType>, optional: boolean): ExprType<SheetCellType> {
    if (!optional) return cellOfPayload(meta.cellTag, v);
    return (v as unknown as ExprType<OptionType<EastType>>).match({
        some: (_$, x) => cellOfPayload(meta.cellTag, x as ExprType<EastType>),
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
        return cellOfFieldValue(meta, meta.derived(r), meta.derivedOptional === true);
    }
    const fv = row[meta.field] as ExprType<EastType>;
    if (meta.form === undefined) return cellOfFieldValue(meta, fv, meta.optional);
    if (meta.form === "link") return cellOfFieldValue(meta, fv, meta.optional);
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

/** The field value a cell decodes to — the payload or its Option, by the column's static shape. */
function fieldValueOfCell(meta: SheetColumnMeta, cell: ExprType<SheetCellType>, optional: boolean, payloadType: EastType): ExprType<EastType> {
    if (optional) {
        return cell.match(
            { [meta.cellTag]: (_$: unknown, v: ExprType<EastType>) => East.value(some(v), OptionType(payloadType)) } as never,
            (_$: unknown) => East.value(none, OptionType(payloadType)),
        ) as ExprType<EastType>;
    }
    return cell.match(
        { [meta.cellTag]: (_$: unknown, v: ExprType<EastType>) => v } as never,
        (_$: unknown) => East.value(defaultValue(payloadType) as SubtypeExprOrValue<EastType>, payloadType),
    ) as ExprType<EastType>;
}

/**
 * The value of THIS column's field from its cell (the base field when the cell
 * is absent or the column is read-only). `members` is the column's register,
 * bound in the caller's block, for the String link form's canonical print.
 */
function decodeOwnField(
    meta: SheetColumnMeta,
    cellOpt: ExprType<OptionType<SheetCellType>>,
    base: ExprType<EastType>,
    members: ExprType<typeof SheetRegisterMembersType> | undefined,
): ExprType<EastType> {
    if (!meta.editable) return base;
    // The String form prints the link back through the grammar — the keys as
    // typed, or the register's labels under `store: "canonical"` (B§4.2).
    const print = (l: ExprType<SheetLinkType>): ExprType<StringType> =>
        meta.config.store === "canonical" && members !== undefined ? printLinkWith(l, members) : printLink(l);
    return cellOpt.match({
        none: (_$) => base,
        some: (_$, cell) => {
            if (meta.form === undefined) return fieldValueOfCell(meta, cell, meta.optional, meta.payloadType);
            if (meta.form === "link") return fieldValueOfCell(meta, cell, meta.optional, SheetLinkType);
            if (meta.form === "array") {
                return cell.match(
                    { Link: (_$2: unknown, l: ExprType<SheetLinkType>) => meta.ownHalf === "from" ? l.from : l.to } as never,
                    (_$2: unknown) => East.value([], SheetMembersType),
                ) as ExprType<EastType>;
            }
            if (meta.optional) {
                return cell.match(
                    { Link: (_$2: unknown, l: ExprType<SheetLinkType>) => East.value(some(print(l)), OptionType(StringType)) } as never,
                    (_$2: unknown) => East.value(none, OptionType(StringType)),
                ) as unknown as ExprType<EastType>;
            }
            return cell.match(
                { Link: (_$2: unknown, l: ExprType<SheetLinkType>) => print(l) } as never,
                (_$2: unknown) => East.value("", StringType),
            ) as unknown as ExprType<EastType>;
        },
    }) as ExprType<EastType>;
}

/** The OTHER half's field of an `array`-form link column, from that column's cell. */
function decodeOtherHalf(meta: SheetColumnMeta, cellOpt: ExprType<OptionType<SheetCellType>>, base: ExprType<EastType>): ExprType<EastType> {
    if (!meta.editable) return base;
    return cellOpt.match({
        none: (_$) => base,
        some: (_$, cell) => cell.match(
            { Link: (_$2: unknown, l: ExprType<SheetLinkType>) => meta.ownHalf === "from" ? l.to : l.from } as never,
            (_$2: unknown) => East.value([], SheetMembersType),
        ) as ExprType<EastType>,
    }) as ExprType<EastType>;
}

// ============================================================================
// The bridge
// ============================================================================

/** The resolved source the bridge reads real rows from. */
export type SheetBridgeSource =
    | { kind: "inline"; rows: ExprType<ArrayType<StructType>> }
    | { kind: "paged"; source: ExprType<StructType>; keyed: boolean };

/**
 * The group half of a bridge (#740) — the group's band cells and lines on
 * the wire, and a wire group row back to the group.
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
    /** `(wireRow, base)` → `P`: the band cells into the group's fields, every wire line decoded over the base's line of the same key. */
    decodeGroup: ExprType<FunctionType<[SheetRowType, OptionType<StructType>], StructType>>;
    /** `(P, key)` → the line at the key — the index of `Array` lines, the key of `Dict` lines. */
    lineOf: ExprType<FunctionType<[StructType, StringType], OptionType<StructType>>>;
    /** `P` → its lines in order. */
    linesOf: ExprType<FunctionType<[StructType], ArrayType<StructType>>>;
}

/**
 * The compiled bridge of one sheet — every wire function the root stores is
 * built from these.
 *
 * @remarks
 * `rowType` is the SOURCE row's type — the host's row on a flat sheet, the
 * group's on a grouped one — and `lineType` the type the columns are
 * declared over: the same type on a flat sheet, the line type on a grouped
 * one. The patch, the proposal, `projectRow` and `decode` run over
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
    /** `Sheet.Types.Context(R, D)` — or `Context(P, "lines", D)` on a grouped sheet. */
    ctxType: StructType;
    /** `Sheet.Types.CheckContext(R)` — or `CheckContext(P, "lines")`. */
    checkCtxType: StructType;
    /** `Sheet.Types.Edit(R)` — or `Edit(P, "lines")`. */
    editType: EastType;
    /** `Sheet.Types.Patch(L)`. */
    patchType: StructType;
    /** `Sheet.Types.Proposal(L)`. */
    proposalType: StructType;
    /** `L` → the wire cells. */
    projectRow: ExprType<FunctionType<[StructType], typeof SheetCellsType>>;
    /** `(id, cells, base)` → `L`. */
    decode: ExprType<FunctionType<[StringType, typeof SheetCellsType, OptionType<StructType>], StructType>>;
    /** `(id, offset)` → the real source row. */
    rowById: ExprType<FunctionType<[StringType, IntegerType], OptionType<StructType>>>;
    /** The wire context → the typed context. */
    bridgeCtx: ExprType<FunctionType<[SheetContextType], StructType>>;
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
    const { rowType, idField, metas, registers, driver, source, group: groupInput } = input;
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
    const editType = (groupInput !== undefined
        ? SheetGroupEditTypeFor(rowType, groupInput.linesField as never)
        : SheetEditTypeFor(rowType)) as unknown as EastType;
    const patchType = SheetPatchTypeFor(lineType) as unknown as StructType;
    const proposalType = SheetProposalTypeFor(lineType) as unknown as StructType;
    const fields = lineType.fields as Record<string, EastType>;
    const byField = new Map(metas.map((m) => [m.key, m]));
    const otherHalfBy = new Map<string, SheetColumnMeta>();
    for (const m of metas) if (m.otherField !== undefined) otherHalfBy.set(m.otherField, m);
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
        }
        return cells;
    }) as unknown as SheetBridge["projectRow"];

    // (id, cells, base) → L: the base row (the type's default when absent),
    // every column's field from its cell, the id field from the wire id (a
    // line has no id field).
    const decode = East.function([StringType, SheetCellsType, OptionType(lineType)], lineType, ($, id, cells, base) => {
        const b = $.let(base.match({
            some: (_$, x) => x,
            none: (_$) => East.value(defaultValue(lineType) as SubtypeExprOrValue<StructType>, lineType),
        }), lineType) as unknown as Record<string, ExprType<EastType>>;
        // The String link form's registers, bound once per body (the capture rule).
        const bound = new Map<string, ExprType<typeof SheetRegisterMembersType>>();
        for (const name of stringFormRegisters) {
            bound.set(name, $.const(registers[name]!, SheetRegisterMembersType));
        }
        const out: Record<string, ExprType<EastType>> = {};
        for (const f of Object.keys(fields)) {
            const baseField = $.let(b[f] as never, fields[f] as EastType);
            if (f === lineIdField) {
                out[f] = id;
                continue;
            }
            const own = byField.get(f);
            if (own !== undefined) {
                out[f] = decodeOwnField(own, cells.tryGet(own.key), baseField, own.register !== undefined ? bound.get(own.register) : undefined);
                continue;
            }
            const other = otherHalfBy.get(f);
            if (other !== undefined) {
                out[f] = decodeOtherHalf(other, cells.tryGet(other.key), baseField);
                continue;
            }
            out[f] = baseField;
        }
        return East.value(out as unknown as SubtypeExprOrValue<StructType>, lineType);
    }) as unknown as SheetBridge["decode"];

    // (id, offset) → the real source row.
    const rowById = source.kind === "inline"
        ? East.function([StringType, IntegerType], OptionType(rowType), ($, id, _offset) => {
            const rows = $.const(source.rows, ArrayType(rowType));
            return rows.firstMap((_$, r) => idOf(r, idField).equal(id).ifElse(
                (_$2) => East.value(some(r), OptionType(rowType)),
                (_$2) => East.value(none, OptionType(rowType)),
            ));
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
        ? buildGroupBridge(rowType, lineType, idField, groupInput, shape.keyed, projectRow, decode)
        : undefined;

    // The wire context → Sheet.Types.Context(R, D) — or, grouped, to
    // Context(P, "lines", D): the line decoded over the group's line of the
    // same key, the group as it would be with the edited line in place, its
    // lines, and the resident groups.
    const bridgeCtx = group === undefined
        ? East.function([SheetContextType], ctxType, ($, ctx) => {
            const byId = $.const(rowById);
            const dec = $.const(decode);
            const row = $.let(dec(ctx.rowId, ctx.row, byId(ctx.rowId, ctx.offset)), rowType);
            const rows = $.let(ctx.rows.map((_$, r, i) => dec(r.id, r.cells, byId(r.id, ctx.rowsOffset.add(i)))), ArrayType(rowType));
            const lookup = $.const(lookupDriver);
            const driverRow = $.let(ctx.driver.match({
                none: (_$) => East.value(none, OptionType(driverType)),
                some: (_$, k) => lookup(k),
            }), OptionType(driverType));
            return East.value({
                rowIndex: ctx.rowIndex,
                row,
                rows,
                partial: ctx.partial,
                driver: driverRow,
                today: ctx.today,
            } as unknown as SubtypeExprOrValue<StructType>, ctxType);
        })
        : East.function([SheetContextType], ctxType, ($, ctx) => {
            const byId = $.const(rowById);
            const dec = $.const(decode);
            const decG = $.const(group.decodeGroup);
            const lineAt = $.const(group.lineOf);
            const linesOf = $.const(group.linesOf);
            const noLine = $.const(none, OptionType(lineType));
            const noWireRow = $.const(none, OptionType(SheetRowType));
            const base = $.let(byId(ctx.rowId, ctx.offset), OptionType(rowType));
            const wireGroup = $.let(ctx.rows.firstMap((_$, r) => r.id.equal(ctx.rowId).ifElse(
                (_$2) => East.value(some(r), OptionType(SheetRowType)),
                (_$2) => noWireRow,
            )), OptionType(SheetRowType));
            // The group as stored — the resident wire row decoded over the source, else the source itself.
            const stored = $.let(wireGroup.match({
                some: (_$, r) => decG(r, base),
                none: (_$) => base.match({
                    some: (_$2, p) => p,
                    none: (_$2) => East.value(defaultValue(rowType) as SubtypeExprOrValue<StructType>, rowType),
                }),
            }), rowType);
            const lineBase = $.let(ctx.line.match({
                some: (_$, k) => lineAt(stored, k),
                none: (_$) => noLine,
            }), OptionType(lineType));
            const row = $.let(dec("", ctx.row, lineBase), lineType);
            // The group as it would be — the wire row with the edited line's
            // cells in place, appended when the line is not among them yet.
            const edited = $.let(ctx.line.match({
                some: ($2, k) => wireGroup.match({
                    some: ($3, r) => {
                        const replaced = $3.let(r.lines.map((_$, wl) => wl.key.equal(k).ifElse(
                            (_$2) => East.value({ key: k, cells: ctx.row }, SheetLineType),
                            (_$2) => wl,
                        )), ArrayType(SheetLineType));
                        const present = $3.let(r.lines.filter((_$, wl) => wl.key.equal(k)).length().greater(0n), BooleanType);
                        const lines = $3.let(present.ifElse(
                            (_$) => replaced,
                            (_$) => replaced.concat(East.value([{ key: k, cells: ctx.row }], ArrayType(SheetLineType))),
                        ), ArrayType(SheetLineType));
                        return decG(East.value({ id: r.id, owned: r.owned, cells: r.cells, lines, band: r.band }, SheetRowType), base);
                    },
                    none: (_$3) => stored,
                }),
                none: (_$2) => stored,
            }), rowType);
            const rows = $.let(linesOf(edited), ArrayType(lineType));
            const groups = $.let(ctx.rows.map((_$, r, i) => decG(r, byId(r.id, ctx.rowsOffset.add(i)))), ArrayType(rowType));
            const lookup = $.const(lookupDriver);
            const driverRow = $.let(ctx.driver.match({
                none: (_$) => East.value(none, OptionType(driverType)),
                some: (_$, k) => lookup(k),
            }), OptionType(driverType));
            return East.value({
                rowIndex: ctx.rowIndex,
                row,
                rows,
                group: edited,
                groups,
                partial: ctx.partial,
                driver: driverRow,
                today: ctx.today,
            } as unknown as SubtypeExprOrValue<StructType>, ctxType);
        });

    // Sheet.Types.Patch(R) → the set fields as cells.
    const encodePatch = East.function([patchType], SheetCellsType, ($, patch) => {
        const cells = $.let(new Map<string, never>(), SheetCellsType);
        const p = patch as unknown as Record<string, ExprType<OptionType<EastType>>>;
        const bound = new Map<string, ExprType<typeof SheetRegisterMembersType>>();
        for (const name of stringFormRegisters) {
            bound.set(name, $.const(registers[name]!, SheetRegisterMembersType));
        }
        for (const m of metas) {
            if (!m.editable || m.derived !== undefined) continue;
            if (m.form === "array") {
                // The other half is `none` when the column names no other field.
                const otherKey = m.otherField;
                const own = $.let(p[m.key] as never, OptionType(SheetMembersType));
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
            const field = $.let(p[m.key] as never, OptionType(fields[m.key] as EastType));
            $.if(field.hasTag("some"), ($2) => {
                const v = $2.let(field.unwrap("some") as never, fields[m.key] as EastType);
                const asRow = { [m.key]: v } as unknown as ExprType<StructType>;
                $2(cells.insert(m.key, projectCell(m, asRow, m.register !== undefined ? bound.get(m.register) : undefined)));
            });
        }
        return cells;
    }) as unknown as SheetBridge["encodePatch"];

    return {
        rowType, lineType, driverType, ctxType, checkCtxType, editType, patchType, proposalType,
        projectRow, decode,
        rowById: rowById as unknown as SheetBridge["rowById"],
        bridgeCtx: bridgeCtx as unknown as SheetBridge["bridgeCtx"],
        encodePatch,
        ...(group !== undefined ? { group } : {}),
    };
}

// ============================================================================
// The group half (#740)
// ============================================================================

/**
 * Compile the group half of a bridge — the group's band cells and lines to
 * the wire, and a wire group row back to the group.
 *
 * @param rowType - The group's row type `P`
 * @param lineType - The line type `L`
 * @param idField - The group's id field
 * @param input - The lines field and the band's cell metas
 * @param keyed - `Dict` lines
 * @param projectRow - `L` → the wire cells
 * @param decode - `(id, cells, base)` → `L`
 * @returns The group half
 */
function buildGroupBridge(
    rowType: StructType,
    lineType: StructType,
    idField: string | undefined,
    input: SheetBridgeGroupInput,
    keyed: boolean,
    projectRow: SheetBridge["projectRow"],
    decode: SheetBridge["decode"],
): SheetGroupBridge {
    const { linesField, cellMetas } = input;
    const fields = rowType.fields as Record<string, EastType>;
    const linesType = fields[linesField] as EastType;
    const cellByField = new Map(cellMetas.map((m) => [m.field, m]));
    const linesOfRow = (p: ExprType<StructType>) => (p as unknown as Record<string, ExprType<EastType>>)[linesField] as ExprType<EastType>;

    // P → the band's cells.
    const projectGroupCells = East.function([rowType], SheetCellsType, ($, p) => {
        const cells = $.let(new Map<string, never>(), SheetCellsType);
        for (const m of cellMetas) {
            $(cells.insert(m.key, projectCell(m, p, undefined)));
        }
        return cells;
    }) as unknown as SheetGroupBridge["projectGroupCells"];

    // P → its wire lines: `Array` lines keyed by index, `Dict` lines by key.
    const projectLines = East.function([rowType], ArrayType(SheetLineType), ($, p) => {
        const project = $.const(projectRow);
        const lines = $.let(linesOfRow(p) as never, linesType);
        if (keyed) {
            return (lines as unknown as ExprType<DictType<StringType, StructType>>).toArray((_$, l, k) =>
                East.value({ key: k, cells: project(l) }, SheetLineType));
        }
        return (lines as unknown as ExprType<ArrayType<StructType>>).map((_$, l, i) =>
            East.value({ key: East.print(i), cells: project(l) }, SheetLineType));
    }) as unknown as SheetGroupBridge["projectLines"];

    // (P, key) → the line at the key.
    const lineOf = East.function([rowType, StringType], OptionType(lineType), ($, p, key) => {
        const lines = $.let(linesOfRow(p) as never, linesType);
        if (keyed) return (lines as unknown as ExprType<DictType<StringType, StructType>>).tryGet(key);
        const noLine = $.const(none, OptionType(lineType));
        const arr = lines as unknown as ExprType<ArrayType<StructType>>;
        return key.contains(new RegExp("^\\d+$")).ifElse(
            ($2) => {
                const i = $2.let(key.parse(IntegerType), IntegerType);
                return i.less(arr.length()).ifElse(
                    (_$3) => East.value(some(arr.get(i)), OptionType(lineType)),
                    (_$3) => noLine,
                );
            },
            (_$2) => noLine,
        );
    }) as unknown as SheetGroupBridge["lineOf"];

    // P → its lines in order.
    const linesOf = East.function([rowType], ArrayType(lineType), ($, p) => {
        const lines = $.let(linesOfRow(p) as never, linesType);
        if (keyed) return (lines as unknown as ExprType<DictType<StringType, StructType>>).toArray((_$, l, _k) => l);
        return lines as unknown as ExprType<ArrayType<StructType>>;
    }) as unknown as SheetGroupBridge["linesOf"];

    // (wireRow, base) → P: the base group (the type's default when absent),
    // each band cell's field from its cell, the id from the wire id, and the
    // lines rebuilt from the wire — every wire line decoded over the base's
    // line of the same key, so a line field with no column keeps its value.
    const decodeGroup = East.function([SheetRowType, OptionType(rowType)], rowType, ($, wr, base) => {
        const bRow = $.let(base.match({
            some: (_$, x) => x,
            none: (_$) => East.value(defaultValue(rowType) as SubtypeExprOrValue<StructType>, rowType),
        }), rowType);
        const b = bRow as unknown as Record<string, ExprType<EastType>>;
        const dec = $.const(decode);
        const lineAt = $.const(lineOf);
        const out: Record<string, ExprType<EastType>> = {};
        for (const f of Object.keys(fields)) {
            const baseField = $.let(b[f] as never, fields[f] as EastType);
            if (f === idField) {
                out[f] = wr.id;
                continue;
            }
            if (f === linesField) {
                out[f] = (keyed
                    ? wr.lines.toDict((_$, wl) => wl.key, (_$, wl) => dec("", wl.cells, lineAt(bRow, wl.key)))
                    : wr.lines.map((_$, wl) => dec("", wl.cells, lineAt(bRow, wl.key)))) as unknown as ExprType<EastType>;
                continue;
            }
            const own = cellByField.get(f);
            if (own !== undefined) {
                out[f] = decodeOwnField(own, wr.cells.tryGet(own.key), baseField, undefined);
                continue;
            }
            out[f] = baseField;
        }
        return East.value(out as unknown as SubtypeExprOrValue<StructType>, rowType);
    }) as unknown as SheetGroupBridge["decodeGroup"];

    return { linesField, keyed, cellMetas, projectGroupCells, projectLines, decodeGroup, lineOf, linesOf };
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
        ? `Sheet.Types.Context(GroupType, "${bridge.group.linesField}"${driver})`
        : `Sheet.Types.Context(RowType${driver})`;
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
 * Wrap a fill provider — `Sheet.Types.Context(R, D)` → `Option<Fill(T)>` —
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
 * Wrap a row proposer — `Sheet.Types.Context(R, D)` → `Array<Proposal(R)>` —
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

/** Wrap an arity rule — `Sheet.Types.Context(R, D)` → `Option<Counted>`. */
export function wrapArity(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown): ExprType<FunctionType<[SheetContextType], OptionType<SheetCountedType>>> {
    const { fn: author, async } = pinProvider(bridge, fn, `column "${meta.key}" arity rule`, OptionType(SheetCountedType));
    if (async) throw new Error(`Sheet: column "${meta.key}" arity rule must be synchronous — the strip reads it while the half is edited`);
    return East.function([SheetContextType], OptionType(SheetCountedType), ($, ctx) => {
        const a = $.const(author as unknown as ExprType<FunctionType<[StructType], OptionType<SheetCountedType>>>);
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
    const group = bridge.group;
    const wire = group === undefined
        ? East.function([SheetCheckContextType], OptionType(StringType), ($, c) => {
            const a = $.const(expr as unknown as ExprType<FunctionType<[StructType], OptionType<StringType>>>);
            const byId = $.const(bridge.rowById);
            const dec = $.const(bridge.decode);
            const row = $.let(dec(c.rowId, c.row, byId(c.rowId, c.offset)), bridge.rowType);
            return a(East.value({ rowIndex: c.rowIndex, row, half: c.half, member: c.member } as unknown as SubtypeExprOrValue<StructType>, bridge.checkCtxType));
        })
        : East.function([SheetCheckContextType], OptionType(StringType), ($, c) => {
            const a = $.const(expr as unknown as ExprType<FunctionType<[StructType], OptionType<StringType>>>);
            const byId = $.const(bridge.rowById);
            const dec = $.const(bridge.decode);
            const lineAt = $.const(group.lineOf);
            const noLine = $.const(none, OptionType(bridge.lineType));
            const groupRow = $.let(byId(c.rowId, c.offset).match({
                some: (_$, p) => p,
                none: (_$) => East.value(defaultValue(bridge.rowType) as SubtypeExprOrValue<StructType>, bridge.rowType),
            }), bridge.rowType);
            const lineBase = $.let(c.line.match({
                some: (_$, k) => lineAt(groupRow, k),
                none: (_$) => noLine,
            }), OptionType(bridge.lineType));
            const row = $.let(dec("", c.row, lineBase), bridge.lineType);
            return a(East.value({ rowIndex: c.rowIndex, row, group: groupRow, half: c.half, member: c.member } as unknown as SubtypeExprOrValue<StructType>, bridge.checkCtxType));
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

/**
 * Wrap a typed `onEdit` — `Sheet.Types.Edit(R)` → `Null`, or grouped
 * `Edit(P, "lines")` → `Null` — into the wire edit handler.
 *
 * @remarks
 * On a grouped sheet the wire's row arms are the group's (`groupCommit` /
 * `groupInsert` / `groupRemove`) and its line arms the typed `commit` /
 * `insert` / `remove`, a line address parsed to its index on `Array` lines.
 * The wire row is always the whole group after the edit, decoded over the
 * source group. A flat sheet never receives a line arm.
 */
export function wrapOnEdit(bridge: SheetBridge, fn: unknown): ExprType<FunctionType<[SheetEditType], NullType>> {
    const expr = East.value(fn as SubtypeExprOrValue<FunctionType<[EastType], NullType>>, FunctionType([bridge.editType], NullType)) as ExprType<FunctionType<[EastType], NullType>>;
    const group = bridge.group;
    if (group === undefined) {
        return East.function([SheetEditType], NullType, ($, e) => {
            const a = $.const(expr);
            const byId = $.const(bridge.rowById);
            const dec = $.const(bridge.decode);
            const noRow = $.const(none, OptionType(bridge.rowType));
            const et = bridge.editType;
            $(e.match({
                commit: (_$, c) => a(East.value(variant("commit", {
                    rowId: c.rowId, key: c.key, row: dec(c.rowId, c.row.cells, byId(c.rowId, c.offset)), source: c.source,
                }) as unknown as SubtypeExprOrValue<EastType>, et)),
                insert: (_$, i) => a(East.value(variant("insert", {
                    afterRowId: i.afterRowId, row: dec(i.row.id, i.row.cells, noRow), source: i.source,
                }) as unknown as SubtypeExprOrValue<EastType>, et)),
                remove: (_$, r) => a(East.value(variant("remove", { rowIds: r.rowIds }) as unknown as SubtypeExprOrValue<EastType>, et)),
            }, (_$) => East.value(null, NullType)));
        });
    }
    const addressType = group.keyed ? StringType : IntegerType;
    const addr = (k: ExprType<StringType>): ExprType<EastType> => (group.keyed ? k : k.parse(IntegerType)) as unknown as ExprType<EastType>;
    return East.function([SheetEditType], NullType, ($, e) => {
        const a = $.const(expr);
        const byId = $.const(bridge.rowById);
        const decG = $.const(group.decodeGroup);
        const noRow = $.const(none, OptionType(bridge.rowType));
        const noAddress = $.const(none, OptionType(addressType));
        const et = bridge.editType;
        $(e.match({
            commit: (_$, c) => a(East.value(variant("groupCommit", {
                rowId: c.rowId, key: c.key, row: decG(c.row, byId(c.rowId, c.offset)), source: c.source,
            }) as unknown as SubtypeExprOrValue<EastType>, et)),
            insert: (_$, i) => a(East.value(variant("groupInsert", {
                afterRowId: i.afterRowId, row: decG(i.row, noRow),
            }) as unknown as SubtypeExprOrValue<EastType>, et)),
            remove: (_$, r) => a(East.value(variant("groupRemove", { rowIds: r.rowIds }) as unknown as SubtypeExprOrValue<EastType>, et)),
            lineCommit: (_$, c) => a(East.value(variant("commit", {
                rowId: c.rowId, line: addr(c.line), key: c.key, row: decG(c.row, byId(c.rowId, c.offset)), source: c.source,
            }) as unknown as SubtypeExprOrValue<EastType>, et)),
            lineInsert: (_$, i) => a(East.value(variant("insert", {
                rowId: i.rowId,
                after: i.after.match({
                    some: (_$2, k) => East.value(some(addr(k)) as unknown as SubtypeExprOrValue<OptionType<EastType>>, OptionType(addressType)),
                    none: (_$2) => noAddress,
                }),
                line: addr(i.line),
                row: decG(i.row, byId(i.rowId, i.offset)),
                source: i.source,
            }) as unknown as SubtypeExprOrValue<EastType>, et)),
            lineRemove: (_$, r) => a(East.value(variant("remove", {
                rowId: r.rowId, lines: r.lines.map((_$2, k) => addr(k)),
            }) as unknown as SubtypeExprOrValue<EastType>, et)),
        }));
    });
}

/**
 * Compile `onUpdate` into the wire edit handler (§4.7) — the whole-value
 * rebuild: a commit rewrites one row, an insert appends a fresh row after
 * `afterRowId`, a remove filters ids; then the author's `onUpdate` receives
 * the collection.
 */
export function compileOnUpdate(
    bridge: SheetBridge,
    rows: ExprType<ArrayType<StructType>>,
    idField: string,
    fn: unknown,
): ExprType<FunctionType<[SheetEditType], NullType>> {
    const rowsType = ArrayType(bridge.rowType);
    const expr = East.value(fn as SubtypeExprOrValue<FunctionType<[ArrayType<StructType>], NullType>>, FunctionType([rowsType], NullType)) as ExprType<FunctionType<[ArrayType<StructType>], NullType>>;
    const group = bridge.group;
    return East.function([SheetEditType], NullType, ($, ev) => {
        const current = $.let(rows, rowsType);
        const upd = $.const(expr);
        const noRow = $.const(none, OptionType(bridge.rowType));
        // The decoder of a wire row over its source row — the line decoder on
        // a flat sheet, the group decoder on a grouped one.
        const dec = $.const(bridge.decode);
        const decG = group !== undefined ? $.const(group.decodeGroup) : undefined;
        const decodeRow = (wr: ExprType<SheetRowType>, base: ExprType<OptionType<StructType>>): ExprType<StructType> =>
            decG !== undefined ? decG(wr, base) : dec(wr.id, wr.cells, base);
        const rewrite = (rowId: ExprType<StringType>, wr: ExprType<SheetRowType>) =>
            current.map((_$2, r) => idOf(r, idField).equal(rowId).ifElse(
                (_$3) => decodeRow(wr, East.value(some(r), OptionType(bridge.rowType))),
                (_$3) => r,
            ));
        const next = $.let(ev.match({
            commit: (_$, c) => rewrite(c.rowId, c.row),
            insert: ($2, i) => {
                const fresh = $2.let(decodeRow(i.row, noRow), bridge.rowType);
                return i.afterRowId.match({
                    none: (_$3) => current.concat(East.value([fresh], rowsType)),
                    some: (_$3, after) => current.flatMap((_$4, r) => idOf(r, idField).equal(after).ifElse(
                        (_$5) => East.value([r, fresh], rowsType),
                        (_$5) => East.value([r], rowsType),
                    )),
                });
            },
            remove: ($2, rm) => {
                const ids = $2.let(rm.rowIds.toSet());
                return current.filter((_$3, r) => ids.has(idOf(r, idField)).not());
            },
            // The line arms carry the whole group after the edit — one rewrite each.
            lineCommit: (_$, c) => rewrite(c.rowId, c.row),
            lineInsert: (_$, i) => rewrite(i.rowId, i.row),
            lineRemove: (_$, r) => rewrite(r.rowId, r.row),
        }), rowsType);
        $(upd(next));
    });
}

/** Both channels at once — `onEdit` observes, then `onUpdate` writes. */
export function composeEditHandlers(
    observe: ExprType<FunctionType<[SheetEditType], NullType>> | undefined,
    write: ExprType<FunctionType<[SheetEditType], NullType>> | undefined,
): ExprType<FunctionType<[SheetEditType], NullType>> | undefined {
    if (observe === undefined) return write;
    if (write === undefined) return observe;
    return East.function([SheetEditType], NullType, ($, e) => {
        const o = $.const(observe);
        const w = $.const(write);
        $(o(e));
        $(w(e));
    });
}

/** Re-exported for the root's driver-typed refusals. */
export { SheetHalfType, BooleanType, AsyncFunctionType, EMPTY_LINK };
