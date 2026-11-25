/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Record.column.*`'s own kinds (`Record - DX Proposal.md`) — a record's
 * title, a person, a checkbox, a toggle, a cycle, the time since a moment and
 * the last change the app kept — their configs and their builders. Each takes
 * the row type first and only captures, as the Sheet's kinds do
 * (`columns.ts`); a Sheet refuses them, and only the Record's grid draws them.
 *
 * @packageDocumentation
 */

import type {
    EastType,
    ExprType,
    SubtypeExprOrValue,
    ArrayType,
    BooleanType,
    DateTimeType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import type { StatusValueLiteral, StatusValueType } from "@elaraai/east-ui";
import type {
    RecordChangeType,
    SheetAgeUnitLiteral,
    SheetAuditModeLiteral,
    SheetColumnKindLiteral,
    SheetLookLiteral,
} from "./types.js";
import {
    column,
    type SheetColumn,
    type SheetColumnBaseConfig,
    type SheetFieldKey,
    type SheetFromDataColumn,
    type SheetFromDataConfig,
    type SheetFromDataInput,
    type SheetMarkInput,
    type SheetValueConfig,
} from "./columns.js";

// ============================================================================
// Configs
// ============================================================================

/**
 * Config for `Record.column.title` — a record's title, on a `String` field.
 *
 * @property avatar - Neutral initials before the title, drawn from it (`A. Morgan` → `AM`)
 */
export interface RecordTitleConfig<R extends StructType> extends SheetColumnBaseConfig<R, StringType> {
    /** Neutral initials before the title, drawn from it. */
    avatar?: boolean;
}

/**
 * Config for `Record.column.person` — a person, by a register's key. Its fill
 * providers fill a member's key, at the register's key type.
 *
 * @property unassigned - The words for no one, beside a dashed ring (default "Unassigned")
 */
export interface RecordPersonConfig<R extends StructType> extends SheetColumnBaseConfig<R, EastType> {
    /** The words for no one. */
    unassigned?: SubtypeExprOrValue<StringType>;
}

/** Config for `Record.column.boolean` — a checkbox on a `Boolean` field. */
export type RecordBooleanConfig<R extends StructType> = SheetColumnBaseConfig<R, BooleanType>;

/**
 * Config for `Record.column.toggle` — two states on a `Boolean` field.
 *
 * @property on - The word for true ("yes")
 * @property off - The word for false ("no")
 * @property look - A chip (the default), or a mark
 */
export interface RecordToggleConfig<R extends StructType> extends SheetColumnBaseConfig<R, BooleanType> {
    /** The word for true. */
    on: SubtypeExprOrValue<StringType>;
    /** The word for false. */
    off: SubtypeExprOrValue<StringType>;
    /** A chip (the default), or a mark. */
    look?: SheetLookLiteral;
}

/**
 * Config for `Record.column.cycle` — a register's members, stepped by a
 * click, on a field holding a member's key: of the register's key type, or its
 * Option.
 *
 * @remarks
 * The register's members, in order, are the cycle's states: their labels its
 * chips, their `meta` their names, their `tone` their colours, and a member's
 * label or alias typed in the cell sets it.
 *
 * @property scale - The first member draws empty and the rest step up the heat ramp in order; without it each member's `tone` colours it
 * @property look - A chip (the default), or a mark
 */
export interface RecordCycleConfig<R extends StructType> extends SheetColumnBaseConfig<R, EastType> {
    /** The members step up the heat ramp, the first empty. */
    scale?: boolean;
    /** A chip (the default), or a mark. */
    look?: SheetLookLiteral;
}

/**
 * One step of a cycle over a variant: a case, and the chip it draws as.
 *
 * @typeParam V - The variant the field holds
 * @property case - The case, by its name
 * @property label - What the chip prints, and a spelling typed text resolves
 * @property meta - The case in words, beside the chip
 * @property aliases - Other spellings typed text resolves
 * @property tone - The chip's colour, where the cycle is no `scale`
 */
export interface RecordCycleStep<V extends VariantType> {
    /** The case, by its name. */
    case: Extract<keyof V["cases"], string>;
    /** What the chip prints. */
    label: SubtypeExprOrValue<StringType>;
    /** The case in words. */
    meta?: SubtypeExprOrValue<StringType>;
    /** Other spellings typed text resolves. */
    aliases?: SubtypeExprOrValue<ArrayType<StringType>>;
    /** The chip's colour. */
    tone?: StatusValueLiteral | SubtypeExprOrValue<StatusValueType>;
}

/**
 * Config for `Record.column.cycle(R, V, { steps })` — a variant's cases,
 * stepped by a click, on a field holding the variant.
 *
 * @remarks
 * East keeps a variant's cases in alphabetical order, so `steps` gives the
 * order a click steps through them in: every case once, each with its chip.
 * A step has no value to give a case, so no case of the variant holds data.
 *
 * @typeParam V - The variant the field holds
 * @property steps - The cases in stepping order, each with its chip
 * @property scale - The first step draws empty and the rest step up the heat ramp in order; without it each step's `tone` colours it
 * @property look - A chip (the default), or a mark
 */
export interface RecordCycleStepsConfig<R extends StructType, V extends VariantType> extends Omit<SheetColumnBaseConfig<R, StringType>, "fill"> {
    /** The cases in stepping order. */
    steps: RecordCycleStep<V>[];
    /** The steps go up the heat ramp, the first empty. */
    scale?: boolean;
    /** A chip (the default), or a mark. */
    look?: SheetLookLiteral;
}

/**
 * Config for `Record.column.age` — the time since a moment the row holds,
 * keyed by a name of its own.
 *
 * @remarks
 * `since` reads the row; the count is taken as the cell is drawn. Hours run to
 * the browser's clock. Days and weeks are the calendar's: from the moment's
 * date to the Record's day, as a column read at the day has it — the day its
 * page sets (`day`), else the viewer's own, so a count turns over at the
 * viewer's midnight, without a rebuild — whatever time of day the moment
 * holds. As a column from data
 * ({@link SheetFromDataInput}) it names its `field`, and each member's value
 * is the moment its count starts from, in place of `since`.
 *
 * @property header - The header line
 * @property sub - The second header line
 * @property width - CSS width
 * @property since - When the clock started, over the row: a DateTime, a `Record.Types.Change` (its `at`), or an Option of either; `none` draws `absent`
 * @property unit - What one counts (default `"days"`)
 * @property stale - At or past this many, the cell warns and the row counts as stale
 * @property absent - The words when `since` is none (default "—")
 * @property mark - Words on the cell, or a lock, over the row and the Record's day ({@link SheetMarkInput})
 */
export interface RecordAgeConfig<R extends StructType> {
    /** Words on the cell, or a lock: over the row and the Record's day. */
    mark?: SheetMarkInput<R>;
    /** The header line. */
    header?: SubtypeExprOrValue<StringType>;
    /** The second header line. */
    sub?: SubtypeExprOrValue<StringType>;
    /** CSS width. */
    width?: SubtypeExprOrValue<StringType>;
    /** When the clock started, over the row. */
    since: (row: ExprType<R>) => SubtypeExprOrValue<DateTimeType | OptionType<DateTimeType> | RecordChangeType | OptionType<RecordChangeType>>;
    /** What one counts. */
    unit?: SheetAgeUnitLiteral;
    /** At or past this many, the cell warns. */
    stale?: SubtypeExprOrValue<IntegerType> | bigint;
    /** The words when `since` is none. */
    absent?: SubtypeExprOrValue<StringType>;
}

/**
 * Config for `Record.column.audit` — the last change the app kept, on a
 * `Record.Types.Change` field or its Option. Read only.
 *
 * @property header - The header line
 * @property sub - The second header line
 * @property width - CSS width
 * @typeParam R - The host's row type
 * @property mode - `date` (the default): the date, its verb and who in the tooltip · `blame`: the date, then the verb and who
 * @property absent - The words when the field is none (default "—")
 * @property mark - Words on the cell, or a lock, over the row and the Record's day ({@link SheetMarkInput})
 */
export interface RecordAuditConfig<R extends StructType = StructType> {
    /** Words on the cell, or a lock: over the row and the Record's day. */
    mark?: SheetMarkInput<R>;
    /** The header line. */
    header?: SubtypeExprOrValue<StringType>;
    /** The second header line. */
    sub?: SubtypeExprOrValue<StringType>;
    /** CSS width. */
    width?: SubtypeExprOrValue<StringType>;
    /** How the change reads. */
    mode?: SheetAuditModeLiteral;
    /** The words when the field is none. */
    absent?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// The Record's kinds
// ============================================================================

/**
 * The kinds a Record draws and a Sheet refuses: one wire, one bridge and one
 * cell part per kind, shared, with only the Record's grid drawing them.
 *
 * @internal
 */
export const RECORD_COLUMN_KINDS: ReadonlySet<SheetColumnKindLiteral> = new Set<SheetColumnKindLiteral>(["title", "person", "boolean", "toggle", "cycle", "age", "audit", "trace", "sparkline", "meter"]);

/**
 * An age column — what `Record.column.age` returns. It shows no field, so it
 * is keyed by a name of its own, and only it may be: the `"age"` kind is how
 * a Record's columns map tells it from a column over a field.
 *
 * @typeParam R - The host's row type
 */
export interface RecordAgeColumn<R extends StructType> extends SheetColumn<R, never> {
    /** The column kind. */
    readonly kind: "age";
}

/**
 * A title column — `Record.column.title(R, cfg)`: a record's title, its
 * initials before it with `avatar`. Sits on a `String` field. A click selects
 * the row and opens it in the inspector; it is edited there. With `value`, a
 * read-only projection on any field — a name that falls back to the row's id;
 * with `each`, a column per member of a register or per field of a struct
 * ({@link SheetFromDataInput}).
 */
export function title<R extends StructType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, config: SheetFromDataConfig<RecordTitleConfig<R>, StringType, F>): SheetFromDataColumn<R, F>;
export function title<R extends StructType>(rowType: R, config: RecordTitleConfig<R> & SheetValueConfig<R, StringType>): SheetColumn<R, EastType>;
export function title<R extends StructType>(rowType: R, config?: RecordTitleConfig<R>): SheetColumn<R, StringType>;
export function title<R extends StructType>(rowType: R, config: object = {}): SheetColumn<R, EastType> {
    return column(rowType, "title", config);
}

/**
 * A person column — `Record.column.person(R, register, cfg)`: a register's
 * member by its key, with neutral initials, or no one. Sits on a field holding
 * one member's key: of the register's key type, or its Option
 * (east-workspace#1747) — a `String` / `Option<String>` one for a register keyed
 * by String; with `each`, a column per member of a register or per field of a
 * struct, each cell a person's key ({@link SheetFromDataInput}).
 */
export function person<R extends StructType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, register: string, config: SheetFromDataConfig<RecordPersonConfig<R>, EastType, F>): SheetFromDataColumn<R, F>;
export function person<R extends StructType>(rowType: R, register: string, config?: RecordPersonConfig<R>): SheetColumn<R, EastType>;
export function person<R extends StructType>(rowType: R, register: string, config: object = {}): SheetColumn<R, EastType> {
    return column(rowType, "person", config, { register });
}

/**
 * A boolean column — `Record.column.boolean(R, cfg)`: a checkbox, a click or
 * space flipping it. Sits on a `Boolean` field; with `each`, a column per
 * member of a register or per field of a struct ({@link SheetFromDataInput}).
 */
export function booleanColumn<R extends StructType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, config: SheetFromDataConfig<RecordBooleanConfig<R>, BooleanType, F>): SheetFromDataColumn<R, F>;
export function booleanColumn<R extends StructType>(rowType: R, config?: RecordBooleanConfig<R>): SheetColumn<R, BooleanType>;
export function booleanColumn<R extends StructType>(rowType: R, config: object = {}): SheetColumn<R, EastType> {
    return column(rowType, "boolean", config);
}

/**
 * A toggle column — `Record.column.toggle(R, { on, off })`: two states on a
 * `Boolean` field, each a word, a click or space flipping it; with `each`, a
 * column per member of a register or per field of a struct
 * ({@link SheetFromDataInput}).
 */
export function toggle<R extends StructType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, config: SheetFromDataConfig<RecordToggleConfig<R>, BooleanType, F>): SheetFromDataColumn<R, F>;
export function toggle<R extends StructType>(rowType: R, config: RecordToggleConfig<R>): SheetColumn<R, BooleanType>;
export function toggle<R extends StructType>(rowType: R, config: object): SheetColumn<R, EastType> {
    return column(rowType, "toggle", config);
}

/**
 * A cycle column — `Record.column.cycle(R, register, cfg)`: a register's
 * members, stepped by a click (⇧-click steps back), a member's label or alias
 * typed in the cell setting it. Sits on a field holding a member's key: of the
 * register's key type, or its Option (east-workspace#1747) — a `String` one for
 * a register keyed by String.
 *
 * `Record.column.cycle(R, V, { steps })` steps a variant's cases instead, in
 * the order `steps` gives, on a field holding the variant. Either, with
 * `each`, makes a column per member of a register or per field of a struct
 * ({@link SheetFromDataInput}).
 */
export function cycle<R extends StructType, V extends VariantType<{ [K in string]: NullType }>, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, variantType: V, config: SheetFromDataConfig<RecordCycleStepsConfig<R, V>, V, F>): SheetFromDataColumn<R, F>;
export function cycle<R extends StructType, V extends VariantType<{ [K in string]: NullType }>>(rowType: R, variantType: V, config: RecordCycleStepsConfig<R, V>): SheetColumn<R, V>;
export function cycle<R extends StructType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, register: string, config: SheetFromDataConfig<RecordCycleConfig<R>, EastType, F>): SheetFromDataColumn<R, F>;
export function cycle<R extends StructType>(rowType: R, register: string, config?: RecordCycleConfig<R>): SheetColumn<R, EastType>;
export function cycle<R extends StructType>(rowType: R, over: string | VariantType, config: object = {}): SheetColumn<R, EastType> {
    if (typeof over === "string") return column(rowType, "cycle", config, { register: over });
    return column(rowType, "cycle", config, { variantType: over });
}

/**
 * An age column — `Record.column.age(R, { since })`: the hours since a moment
 * the row holds, or the days or weeks since its date to the Record's day — the
 * day its page sets, else the viewer's own.
 * Keyed by a name of its own; read only.
 * With `each` and the `field` it reads, a column per member of a register or
 * per field of a struct, each member's value the moment its count starts from
 * ({@link SheetFromDataInput}).
 */
export function age<R extends StructType>(rowType: R, config: Omit<RecordAgeConfig<R>, "since" | "mark" | "header"> & SheetFromDataInput<DateTimeType | RecordChangeType> & {
    /** The field the columns read. */
    field: SheetFieldKey<R>;
}): RecordAgeColumn<R>;
export function age<R extends StructType>(rowType: R, config: RecordAgeConfig<R>): RecordAgeColumn<R>;
export function age<R extends StructType>(rowType: R, config: object): RecordAgeColumn<R> {
    return column(rowType, "age", config) as RecordAgeColumn<R>;
}

/**
 * An audit column — `Record.column.audit(R, cfg)`: the last change the app
 * kept, its date and, in `blame` mode, who and what beside it; Pending while
 * the row holds drafts. Sits on a `Record.Types.Change` /
 * `Option<Record.Types.Change>` field; read only. With `each`, a column per
 * member of a register or per field of a struct, each member's value a change
 * ({@link SheetFromDataInput}).
 */
export function audit<R extends StructType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, config: SheetFromDataConfig<RecordAuditConfig<R>, RecordChangeType, F>): SheetFromDataColumn<R, F>;
export function audit<R extends StructType>(rowType: R, config?: RecordAuditConfig<R>): SheetColumn<R, RecordChangeType | OptionType<RecordChangeType>>;
export function audit<R extends StructType>(rowType: R, config: object = {}): SheetColumn<R, EastType> {
    return column(rowType, "audit", config);
}
