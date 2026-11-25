/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A described column (`Sheet Spec.md` §4.8, §3.12) — the static facts pass 1
 * of the root learns of each column against the type it is declared over
 * (`describe.ts`), which every East function of the bridge is built from — and
 * the moves that put a column's value in its cell: a payload in the cell arm
 * its kind takes, an `Option`'s none the blank cell, a key by its text
 * (east-workspace#1747), a `String` link parsed by its grammar.
 *
 * @packageDocumentation
 */

import {
    DictType,
    East,
    Expr,
    StringType,
    isTypeEqual,
    variant,
    type DateTimeType,
    type EastType,
    type ExprType,
    type FunctionType,
    type OptionType,
    type StructType,
    type SubtypeExprOrValue,
    type VariantType, FloatType, ArrayType,
} from "@elaraai/east";

import { SheetCellType, SheetLinkType, type RecordMarkType, type SheetColumnKindLiteral } from "./types.js";
import { SheetMembersType, SheetRegisterMembersType, parseLink } from "./link.js";
import type { SheetAnyColumnConfig } from "./columns.js";
import type { SheetActionCodec } from "./actions.js";

/** The wire cells dictionary type. */
export const SheetCellsType = DictType(StringType, SheetCellType);

/** The East type of an erased expression (`Expr.type` cannot infer through `ExprType<EastType>`). @internal */
export function typeOf(e: unknown): EastType {
    return Expr.type(e as Expr<EastType>) as EastType;
}

// ============================================================================
// The described column — what pass 1 learns of it
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
    /** The cell key (`sheetRuleCell`'s). */
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
    cellTag: "String" | "DateTime" | "Float" | "Integer" | "Boolean" | "Link" | "Action" | "Series";
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
    /** An action column's cell codec (#1474). */
    action?: SheetActionCodec;
    /** A cycle over a variant's steps: the register they make, and how a case and its key cross. */
    steps?: SheetStepsCodec;
    /**
     * A column whose cell holds the text of its value's key: how its value crosses — a key of its register's where the
     * register is keyed by another type than String (east-workspace#1747), or a variant's case, its step's key. A
     * String key needs none: its text is the key.
     */
    keys?: SheetKeyCodec;
    /** The column's `mark` over the row and the Record's day — words on its cells, or a lock; a column from data's is its {@link SheetFromDataMeta}'s. */
    mark?: ExprType<FunctionType<[StructType, DateTimeType], OptionType<typeof RecordMarkType>>>;
    /** A column from data: where its columns come from, and how each cell reads and writes the field. */
    data?: SheetFromDataMeta;
    /** A meter's max and tone over the row (east-workspace#1730), read with its marks. */
    meter?: SheetMeterMeta;
}

/**
 * A meter column's max and tone (east-workspace#1730), compiled over the row: read at the day with the row's marks, over
 * its entry or its whole draft, so they follow the draft — an edit of the field a max reads redraws its bar. Each meter
 * is read apart: one whose max or tone throws over a row holds why under its max ({@link buildCellsAt}).
 *
 * @internal
 */
export interface SheetMeterMeta {
    /** The row's max: the author's, a Float for every row made a function returning it, else 100. */
    max: ExprType<FunctionType<[StructType], FloatType>>;
    /** The row's tone, by its case's name; `undefined` without one. */
    tone: ExprType<FunctionType<[StructType], StringType>> | undefined;
}

/**
 * One column of a family made from a struct's fields: the field it shows, its
 * header, and the value it holds.
 *
 * @internal
 */
export interface SheetStructMember {
    /** The struct's field. */
    name: string;
    /** The column's header, as `each` gives it. */
    header: string;
    /** The value the column's cells hold: the kind's, or an `Option` of it. */
    valueType: EastType;
    /** Whether a clear writes `none`: the struct's field is an `Option`. */
    clears: boolean;
}

/**
 * A column from data, described: where its columns come from — a register's
 * members, or a struct's fields — and the functions each cell is read and
 * written through, the author's or the defaults its field's shape makes
 * obvious, each checked against the field, the members' key, the kind's value
 * and the day.
 *
 * @internal
 */
export type SheetFromDataMeta = {
    /** Its columns are a register's members. */
    from: "register";
    /** The register, by name. */
    register: string;
    /** The type of the register's keys: what the functions take a member's key as (east-workspace#1747). */
    memberKey: EastType;
    /** The register whose members head the columns' groups, through each member's `parent`. */
    groups: string | undefined;
    /** The value a cell holds: the kind's, or an `Option` of it. */
    valueType: EastType;
    /** Whether a clear writes `none`: the value `write` takes is an `Option`. */
    clears: boolean;
    /** `(field, member, day) → value`, the member's key at its register's type. */
    read: ExprType<FunctionType>;
    /** `(field, member, value, day) → field`; none for read-only columns. */
    write: ExprType<FunctionType> | undefined;
    /** `(field, member, day) → Option<Record.Types.Mark>`. */
    mark: ExprType<FunctionType> | undefined;
} | {
    /** Its columns are a struct's fields. */
    from: "fields";
    /** The struct `read` gives. */
    structType: StructType;
    /** The columns, in the order `each` gives them. */
    members: readonly SheetStructMember[];
    /** `(field, day) → struct`. */
    read: ExprType<FunctionType>;
    /** `(field, struct, day) → field`; none for read-only columns. */
    write: ExprType<FunctionType> | undefined;
    /** `(field, day) → Option<Record.Types.Mark>`. */
    mark: ExprType<FunctionType> | undefined;
};

/**
 * How a column whose cell holds the text of its value's key crosses
 * (east-workspace#1747): its value to that text, and the text back. A register
 * keyed by another type than String holds its members' keys so, each as East
 * prints it, and a cycle over a variant its cases, each by its step's key. The
 * cell holds the text, so the renderer draws it as it draws a String key's.
 *
 * @internal
 */
export interface SheetKeyCodec {
    /** The value's type: the register's key type, or the variant. */
    type: EastType;
    /** A value → its key's text. */
    encode: ExprType<FunctionType<[EastType], StringType>>;
    /** A key's text → its value; `none` for a text no value has. */
    decode: ExprType<FunctionType<[StringType], OptionType<EastType>>>;
}

/**
 * A cycle over a variant (`Record.column.cycle(R, V, { steps })`): its steps
 * as a register keyed by the cases' names, and how a case and its key cross.
 * The cell holds the key, so the renderer's cycle draws it as it draws any
 * register's.
 *
 * @internal
 */
export interface SheetStepsCodec extends SheetKeyCodec {
    /** The steps as a register's members, in stepping order. */
    members: ExprType<typeof SheetRegisterMembersType>;
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

/** A series of numbers: a trace's or a sparkline's payload (east-workspace#1728), which a `Series` cell holds. */
export const SERIES_TYPE = ArrayType(FloatType);

/**
 * The kinds that draw a row's numbers with an east-ui part and take no edit (east-workspace#1726) — the Record's display
 * columns — each with what its cell shows, as a refusal says it.
 *
 * @internal
 */
export const DISPLAY_KINDS: ReadonlyMap<SheetColumnKindLiteral, string> = new Map<SheetColumnKindLiteral, string>([
    ["trace", "series"], ["sparkline", "series"], ["meter", "value against its max"],
]);

/** The cell arm a primitive payload lands in, or `undefined` for a type no cell holds. */
export function cellTagOf(t: EastType): SheetColumnMeta["cellTag"] | undefined {
    if (isTypeEqual(t, SheetLinkType)) return "Link";
    if (isTypeEqual(t, SERIES_TYPE)) return "Series";
    switch ((t as { type: string }).type) {
        case "String":   return "String";
        case "DateTime": return "DateTime";
        case "Float":    return "Float";
        case "Integer":  return "Integer";
        case "Boolean":  return "Boolean";
        default:         return undefined;
    }
}

/** A short description of an East type for a refusal message. @internal */
export function describeType(t: EastType): string {
    const payload = optionPayload(t);
    if (payload !== undefined) return `Option<${describeType(payload)}>`;
    if (t.type === "Struct") return `{ ${Object.entries(t.fields as Record<string, EastType>).map(([k, f]) => `${k}: ${describeType(f)}`).join(", ")} }`;
    if (t.type === "Array") return `Array<${describeType(t.value)}>`;
    return t.type;
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

/**
 * A field VALUE (the payload or its Option) as a cell, by the column's static
 * shape — a value whose key's text the cell holds, as that text
 * ({@link SheetKeyCodec}).
 *
 * @internal
 */
export function cellOfFieldValue(tag: SheetColumnMeta["cellTag"], v: ExprType<EastType>, optional: boolean, keys?: SheetKeyCodec): ExprType<SheetCellType> {
    const cellOf = (x: ExprType<EastType>): ExprType<SheetCellType> =>
        (keys !== undefined ? cellOfPayload("String", keys.encode(x) as ExprType<EastType>) : cellOfPayload(tag, x));
    if (!optional) return cellOf(v);
    return (v as unknown as ExprType<OptionType<EastType>>).match({
        some: (_$, x) => cellOf(x as ExprType<EastType>),
        none: (_$) => NULL_CELL,
    }) as ExprType<SheetCellType>;
}

/**
 * The cell of a column for one row — the projection `make` and `encode`
 * share. `members` is the column's register (bound in the caller's block)
 * for the `String` link form.
 *
 * @internal
 */
export function projectCell(
    meta: SheetColumnMeta,
    r: ExprType<StructType>,
    members: ExprType<typeof SheetRegisterMembersType> | undefined,
): ExprType<SheetCellType> {
    const row = r as unknown as Record<string, ExprType<EastType>>;
    if (meta.derived !== undefined) {
        return cellOfFieldValue(meta.cellTag, meta.derived(r), meta.derivedOptional === true, meta.keys);
    }
    const fv = row[meta.field] as ExprType<EastType>;
    // An action column's case and its value (#1474).
    if (meta.action !== undefined) {
        const encode = meta.action.encode;
        return meta.optional
            ? (fv as unknown as ExprType<OptionType<VariantType>>).match({ some: (_$, v) => encode(v), none: (_$) => NULL_CELL }) as ExprType<SheetCellType>
            : encode(fv as ExprType<VariantType>);
    }
    // A value whose key's text the cell holds: a register's key of another type than String (east-workspace#1747), or a
    // variant's case by its step's key.
    if (meta.keys !== undefined) return cellOfFieldValue("String", fv, meta.optional, meta.keys);
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
