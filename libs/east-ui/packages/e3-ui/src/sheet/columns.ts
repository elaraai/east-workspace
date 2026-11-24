/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet.column.*` — the column builders (`Sheet Spec.md` §3.2). Each takes
 * the row type FIRST (the `Plan.series.<kind>(OpsRow, …)` shape) and returns
 * a typed column value the `columns` map is checked against per key:
 * {@link SheetColumnSpec} is a mapped type over the row's fields, and every
 * builder's result carries the field types it may sit on, so a key that is
 * not a field, or a `date` under a `String` field, is a type error (§3.12).
 *
 * The builders only CAPTURE: the config and the row type. Reification and
 * bridging happen in the root, which has the driver, the registers and the
 * source in hand (`root.ts`, `describe.ts`, `bridge.ts`).
 *
 * Each builder but an action column's also makes a column from data — a
 * column per member of a register, or per field of a struct — given `each`
 * ({@link SheetFromDataInput}), and every one takes a `mark`: words on its
 * cells, or a lock. A Record draws both; a Sheet refuses them. The Record's
 * own kinds — a title, a person, a boolean, a toggle, a cycle, an age and an
 * audit — are `record-columns.ts`'s.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    type ArrayType,
    type AsyncFunctionType,
    type DateTimeType,
    type FloatType,
    type FunctionType,
    type IntegerType,
    type OptionType,
    type StringType,
    type StructType,
    type VariantType,
} from "@elaraai/east";

import type { TickFormatType } from "@elaraai/east-ui/internal";
import type {
    SheetLinkType,
    SheetMemberType,
    SheetSidesValueType,
    SheetSidesLiteral,
    SheetStoreLiteral,
    SheetColumnKindLiteral,
    SheetAnyContextOf,
    SheetFillOf,
    SheetDateLevelType,
    SheetDateLevelLiteral,
    RecordMarkType,
} from "./types.js";
import type { SheetArityInput, SheetCheckInput, SheetLocksInput } from "./link.js";
import type { SheetAnyActionConfig } from "./actions.js";
import type {
    RecordAgeConfig,
    RecordAuditConfig,
    RecordCycleConfig,
    RecordCycleStepsConfig,
    RecordPersonConfig,
    RecordTitleConfig,
    RecordToggleConfig,
} from "./record-columns.js";

// ============================================================================
// The column value and the spec map
// ============================================================================

/**
 * A built column — what a `Sheet.column.*` builder returns and the
 * `columns` map holds.
 *
 * @remarks
 * `R` and `A` are phantom: the row type the column was built over, and the
 * field types it may sit on. Both ride as contravariant function slots, so
 * `SheetColumn<R, DateTime | Option<DateTime>>` is assignable to the spec's
 * `SheetColumn<R, Option<DateTime>>` and not to `SheetColumn<R, String>`.
 *
 * @typeParam R - The host's row type
 * @typeParam A - The field types the column accepts
 */
export interface SheetColumn<R extends StructType, A extends EastType> {
    /** The column kind. */
    readonly kind: SheetColumnKindLiteral;
    /** The author's config, as given. @internal */
    readonly config: SheetAnyColumnConfig;
    /** The driver's row type, for kinds that read the driver's row. @internal */
    readonly driverType?: StructType;
    /** The register the column resolves against. @internal */
    readonly register?: string;
    /** The row type the column was built over — checked against the sheet's at build time. @internal */
    readonly rowType?: StructType;
    /** An action column's variant (#1474), or the variant a cycle steps through. @internal */
    readonly variantType?: VariantType;
    /** A column from data keyed by a name of its own: the field it reads and writes. @internal */
    readonly field?: string;
    /** Phantom — the row type. @internal */
    readonly __row?: (r: R) => void;
    /** Phantom — the accepted field types. @internal */
    readonly __field?: (f: A) => void;
}

/** The field keys of a row struct. */
export type SheetFieldKey<R extends StructType> = Extract<keyof R["fields"], string>;

/** The keys of a row struct whose field is an `Array<Sheet.Types.Member>`. */
export type SheetMemberArrayField<R extends StructType> = {
    [K in SheetFieldKey<R>]: R["fields"][K] extends ArrayType<SheetMemberType> ? K : never
}[SheetFieldKey<R>];

/**
 * The `columns` map — keyed by the row's fields, each value a column built
 * over that row whose accepted field types include the field's (the
 * `<Table columns>` idiom, §3.12).
 *
 * @typeParam R - The host's row type
 */
export type SheetColumnSpec<R extends StructType> = {
    [K in SheetFieldKey<R>]?: SheetColumn<R, R["fields"][K]>
};

// ============================================================================
// Configs
// ============================================================================

/**
 * One fill provider — a synchronous or asynchronous East function over
 * `Sheet.Types.Context(R, D)` to an optional `Sheet.Types.Fill(T)` (§3.5).
 *
 * @remarks
 * The driver type is `any` here and checked at BUILD time against the
 * sheet's driver: the function's East input type must be the sheet's own
 * context type, so a provider written for another sheet — another row type,
 * another driver — is refused with the column named. On a grouped sheet
 * (#740) the context is `Sheet.Types.Context(P, "lines", D)` over the line
 * `R`.
 *
 * @typeParam R - The host's row type (a grouped sheet: the line type)
 * @typeParam T - The column kind's payload type
 */
export type SheetFillInput<R extends StructType, T extends EastType> =
    | SubtypeExprOrValue<FunctionType<[SheetAnyContextOf<R>], OptionType<SheetFillOf<T>>>>
    | SubtypeExprOrValue<AsyncFunctionType<[SheetAnyContextOf<R>], OptionType<SheetFillOf<T>>>>;

/**
 * An OPTIONS rule (#844) — an East function over `Sheet.Types.Context(R, D)`
 * to the register member keys the row may be OFFERED, at the register's key
 * type (east-workspace#1747); `none` offers the whole register. Typed text
 * still resolves against the whole register, so the rule narrows the menu,
 * never what may be entered. The driver type, and the keys' type, are checked
 * at build time, as a fill provider's are.
 *
 * @typeParam R - The host's row type (a grouped sheet: the line type)
 * @typeParam K - The register's key type
 */
export type SheetOptionsInput<R extends StructType, K extends EastType = StringType> =
    SubtypeExprOrValue<FunctionType<[SheetAnyContextOf<R>], OptionType<ArrayType<K>>>>;

/**
 * The fields every column kind shares.
 *
 * @typeParam R - The host's row type
 * @typeParam T - The kind's payload type
 * @property header - The header line (`label` is what a register member prints)
 * @property sub - The grey second header line
 * @property width - CSS width
 * @property editable - `false` makes the column read-only
 * @property fill - Fill providers; the first that yields wins
 * @property detail - The cell's detail — text the hover and the strip show beyond the value (#844); `""` or `none` shows none
 * @property mark - Words on the cell, or a lock, over the row and the Record's day ({@link SheetMarkInput}); a Record's
 */
export interface SheetColumnBaseConfig<R extends StructType, T extends EastType> {
    /** The header line. */
    header?: SubtypeExprOrValue<StringType>;
    /** The grey second header line. */
    sub?: SubtypeExprOrValue<StringType>;
    /** CSS width (`"96px"`). */
    width?: SubtypeExprOrValue<StringType>;
    /** `false` makes the column read-only. */
    editable?: boolean;
    /** Fill providers — the first that yields wins (§3.5). */
    fill?: SheetFillInput<R, T>[];
    /** The cell's detail, over the row — projected into an unrendered cell. */
    detail?: (row: ExprType<R>) => SubtypeExprOrValue<StringType | OptionType<StringType>>;
    /** Words on the cell, or a lock: over the row and the Record's day. */
    mark?: SheetMarkInput<R>;
}

// ============================================================================
// Columns from data
// ============================================================================

/**
 * A column's `mark`: words drawn in its cell, or a lock the grid then won't
 * edit through — an East function over the row and the Record's day to an
 * optional `Record.Types.Mark`. A column from data takes its member's instead
 * ({@link SheetFromDataInput}).
 *
 * @remarks
 * The day is the Record's clock: the browser's local calendar date, at UTC
 * midnight, which turns over without a rebuild.
 *
 * @typeParam R - The host's row type
 */
export type SheetMarkInput<R extends StructType> = SubtypeExprOrValue<FunctionType<[R, DateTimeType], OptionType<RecordMarkType>>>;

/**
 * The options that make a column from data: one column per member of a
 * register, or per field of a struct, each cell one value of the column's
 * field, read and written through the solution's East functions — or through
 * the defaults the field's shape makes obvious.
 *
 * @remarks
 * Over a register (`each: "projects"`) the columns are its members, in its
 * order, each headed by its member's label, and the functions take the
 * member's key, at the register's key type (east-workspace#1747); with
 * `groups`, each column sits under its member's `parent`, the groups in their
 * own register's order. Over a struct's fields
 * (`each: { mon: "Mon", … }`) the columns are fixed, in the order given and
 * headed as given, and the functions take the struct. A column from data
 * takes no `header` of its own.
 *
 * With no `read` and no `write`, a `Dict` keyed by the member reads its
 * entry, sets it, and removes it on a clear; the struct `each` names reads
 * itself and writes the new one. A field of any other shape takes a `read`,
 * and a `write` unless the column is read only. A clear writes `none` where
 * a cell's value is an `Option` — a `Dict`'s entry, a struct's optional
 * field, a `write` taking an `Option` — and is refused where it isn't.
 *
 * Each of its columns is keyed by the column's key and its member's — the
 * member's key, or the struct's field: `hours:P-100`, `week:mon`. An issue the
 * app's `ready` raises about one member's cell names that key as its `field`,
 * and the cell is marked as any cell's issue marks it, Details and the Issues
 * tab naming it by its member. An issue naming the field the columns write
 * (`hours`) holds Apply, and marks no cell.
 *
 * The day each function takes is the Record's clock: the browser's local
 * calendar date, at UTC midnight. A Record draws columns from data; a Sheet
 * refuses them.
 *
 * @typeParam T - The kind's value: what one cell holds
 * @property each - A register's name — a column per member — or `{ field: "Header", … }`, a column per field of the struct the column reads
 * @property groups - With `each` over a register: the register whose members head the columns' groups, through each member's `parent`
 * @property read - How a cell reads the field: `(field, member, day) → value or Option<value>`, or `(field, day) → struct` over a struct's fields
 * @property write - How an edit writes the field: `(field, member, value, day) → field`, or `(field, struct, day) → field` — the field's new value
 * @property mark - Words on a cell, or a lock: `(field, member, day)`, or `(field, day)` over a struct's fields, to an optional `Record.Types.Mark`
 */
export interface SheetFromDataInput<T extends EastType> {
    /** A register's name, or `{ field: "Header", … }` over the struct the column reads. */
    each: string | { readonly [field: string]: string };
    /** With `each` over a register: the register heading the columns' groups. */
    groups?: string;
    /** How a cell reads the field — over a register, given the member's key at the register's key type. */
    read?: SubtypeExprOrValue<FunctionType<[EastType, EastType, DateTimeType], T | OptionType<T>>> | SubtypeExprOrValue<FunctionType<[EastType, DateTimeType], StructType>>;
    /** How an edit writes the field. */
    write?: SubtypeExprOrValue<FunctionType<[EastType, EastType, T | OptionType<T>, DateTimeType], EastType>> | SubtypeExprOrValue<FunctionType<[EastType, StructType, DateTimeType], EastType>>;
    /** Words on a cell, or a lock. */
    mark?: SubtypeExprOrValue<FunctionType<[EastType, EastType, DateTimeType], OptionType<RecordMarkType>>> | SubtypeExprOrValue<FunctionType<[EastType, DateTimeType], OptionType<RecordMarkType>>>;
}

/**
 * A builder's config as a column from data: its own options, less those a
 * column from data does not take — `fill`, `options`, the row's `mark`, and
 * `header`, since a member's name heads each of its columns — and the options
 * that make it ({@link SheetFromDataInput}), with `field` where the column is
 * keyed by a name of its own.
 *
 * @typeParam C - The builder's own config
 * @typeParam T - The kind's value: what one cell holds
 * @typeParam F - The field the column reads and writes, where it is keyed by a name of its own
 */
export type SheetFromDataConfig<C, T extends EastType, F extends string | undefined> =
    Omit<C, "fill" | "options" | "mark" | "header"> & SheetFromDataInput<T> & {
        /** The field the column reads and writes, where the column is keyed by a name of its own. */
        field?: F;
    };

/**
 * A column from data keyed by a name of its own, naming with `field` the field
 * it reads and writes — so two families of columns may read one field. A
 * Record's columns map takes it under a key that is no field of the row.
 *
 * @typeParam R - The host's row type
 */
export interface RecordNamedColumn<R extends StructType> extends SheetColumn<R, EastType> {
    /** The field the column reads and writes. */
    readonly field: string;
}

/**
 * What a builder returns as a column from data: keyed by its field, a column
 * that may sit on a field of any type, which the build checks against its
 * functions and its shape; given `field`, one keyed by a name of its own.
 *
 * @typeParam R - The host's row type
 * @typeParam F - The field named by `field`, if any
 */
export type SheetFromDataColumn<R extends StructType, F extends string | undefined> =
    [F] extends [string] ? RecordNamedColumn<R> : SheetColumn<R, EastType>;

/**
 * A derived read — the column displays the projection and is read-only;
 * the sheet writes fields, never projections. May sit on any field.
 *
 * @typeParam R - The host's row type
 * @typeParam T - The kind's payload type
 * @property value - The projection over the row, at the payload or its `Option`
 */
export interface SheetValueConfig<R extends StructType, T extends EastType> {
    /** The projection over the row. */
    value: (row: ExprType<R>) => SubtypeExprOrValue<T | OptionType<T>>;
}

/** Config for `Sheet.column.text`. */
export type SheetTextConfig<R extends StructType> = SheetColumnBaseConfig<R, StringType>;

/**
 * Config for `Sheet.column.date`.
 *
 * @remarks
 * `level` and `actual` (#844) are accessors over the row, evaluated in the
 * row projection into unrendered cells: they follow the host's row, not an
 * open edit. With an `actual`, a cell whose work has happened prints that
 * instant with its difference from the wanted date, and the wanted date
 * becomes the cell's detail.
 *
 * @property base - The column relative entry counts from (`4d` = base + 4, B§3)
 * @property format - A display pattern (East date tokens); omit ⇒ `17 Nov 26`
 * @property level - How deep the row's date is read and typed — `week` · `day` · `range` · `time`; omit ⇒ `day`
 * @property actual - When the work really happened (`none` until it has)
 */
export interface SheetDateConfig<R extends StructType> extends SheetColumnBaseConfig<R, DateTimeType> {
    /** The column relative entry counts from (`4d` means base + 4). */
    base?: SheetFieldKey<R>;
    /** A display pattern (East date tokens). */
    format?: SubtypeExprOrValue<StringType>;
    /** How deep the row's date is read and typed. */
    level?: (row: ExprType<R>) => SubtypeExprOrValue<SheetDateLevelType> | SheetDateLevelLiteral;
    /** When the work really happened. */
    actual?: (row: ExprType<R>) => SubtypeExprOrValue<DateTimeType | OptionType<DateTimeType>>;
}

/**
 * Config for `Sheet.column.quantity`.
 *
 * @typeParam D - The driver's row type
 * @property uom - The unit, read off the DRIVER's row (`d => d.uom`)
 * @property unit - One unit for every row (`"hrs"`), where no driver gives one
 * @property format - A display format (`Format.Number({ … })`)
 */
export interface SheetQuantityConfig<R extends StructType, D extends StructType> extends SheetColumnBaseConfig<R, FloatType> {
    /** The unit, read off the driver's row. */
    uom?: (driver: ExprType<D>) => SubtypeExprOrValue<StringType>;
    /** One unit for every row, where no driver gives one. */
    unit?: SubtypeExprOrValue<StringType>;
    /** A display format. */
    format?: SubtypeExprOrValue<TickFormatType>;
}

/** Config for `Sheet.column.integer`. */
export type SheetIntegerConfig<R extends StructType> = SheetColumnBaseConfig<R, IntegerType>;

/**
 * Config for `Sheet.column.lookup` — the driver column; its register is the driver's.
 *
 * @property options - The members a row may be offered (#844)
 */
export interface SheetLookupConfig<R extends StructType> extends SheetColumnBaseConfig<R, StringType> {
    /** The members a row may be offered. */
    options?: SheetOptionsInput<R>;
}

/**
 * Config for `Sheet.column.reference` — a lookup over a flat member list. Its
 * fill providers fill a member's key, at the register's key type.
 */
export type SheetReferenceConfig<R extends StructType> = SheetColumnBaseConfig<R, EastType>;

/**
 * Config for `Sheet.column.enum` — an upper-cased register word with a valence
 * dot. Its fill providers fill a member's key, and its options rule offers
 * members by their keys, at the register's key type.
 *
 * @property options - The members a row may be offered (#844)
 */
export interface SheetEnumConfig<R extends StructType> extends SheetColumnBaseConfig<R, EastType> {
    /** The members a row may be offered. */
    options?: SheetOptionsInput<R, EastType>;
}

/**
 * One member kind a `set` / `link` column accepts (B§4.1).
 *
 * @property kind - The register member kind
 * @property identified - Resolves by code (bare digits try the code prefix)
 * @property countable - Takes the counted form (`N x kind`)
 * @property resolvesTo - What a counted member resolves to later
 * @property ranged - Offer and print runs of consecutive codes as one range (#844)
 */
export interface SheetMemberKindInput {
    /** The register member kind. */
    kind: string;
    /** Resolves by code. */
    identified?: boolean;
    /** Takes the counted form. */
    countable?: boolean;
    /** What a counted member resolves to later. */
    resolvesTo?: string;
    /** Offer and print runs of consecutive codes as one range. */
    ranged?: boolean;
}

/**
 * The counted-member grammar (B§4.1).
 *
 * @property forms - The accepted forms (default `["N x kind", "kind x N"]`)
 * @property ops - The multiplication tokens (default `["x", "X", "*", "×"]`)
 * @property appliesTo - Which kinds may be counted (default `"countable"`)
 */
export interface SheetMultipleInput {
    /** The accepted forms. */
    forms?: string[];
    /** The multiplication tokens. */
    ops?: string[];
    /** Which kinds may be counted. */
    appliesTo?: string;
}

/**
 * Config for `Sheet.column.set` — comma members, the link grammar without
 * an arrow. Sits on a `Sheet.Types.Link` field (the `to` half), an
 * `Array<Sheet.Types.Member>` field, or a `String` field.
 *
 * @property members - The member kinds accepted
 * @property multiple - The counted-member grammar
 * @property store - How a `String` field is written back
 */
export interface SheetSetConfig<R extends StructType> extends SheetColumnBaseConfig<R, SheetLinkType> {
    /** The member kinds accepted. */
    members?: SheetMemberKindInput[];
    /** The counted-member grammar. */
    multiple?: SheetMultipleInput;
    /** How a `String` field is written back. */
    store?: SheetStoreLiteral;
}

/**
 * A link column's sides declaration (B§4.2).
 *
 * @typeParam D - The driver's row type
 * @property value - The driver row's sides value (`d => d.sides`)
 * @property locks - Lock tags: half → the sides value that locks it → the tag text
 */
export interface SheetSidesInput<D extends StructType> {
    /** The driver row's sides value. */
    value: (driver: ExprType<D>) => SubtypeExprOrValue<SheetSidesValueType> | SheetSidesLiteral;
    /** Lock tags — half → the sides value that locks it → the tag text. */
    locks?: SheetLocksInput;
}

/**
 * Config for `Sheet.column.link` — `from > to`, the split cell (§3.4).
 *
 * @remarks
 * The halves live on the row in one of three ways, chosen by the field's
 * static type: a `Sheet.Types.Link` field (the column edits it in place); an
 * `Array<Sheet.Types.Member>` field paired with the OTHER half's field named
 * by `from` / `to` (the column sits on one half, the factory composes the
 * value on read and decomposes it on write); or a `String` field the grammar
 * parses on read and prints on commit per `store`.
 *
 * @typeParam R - The host's row type
 * @typeParam D - The driver's row type
 * @property from - When the column sits on the `to` half: the field holding the `from` members
 * @property to - When the column sits on the `from` half: the field holding the `to` members
 * @property members - The member kinds accepted
 * @property multiple - The counted-member grammar
 * @property sides - Which halves the driver makes live, and the lock tags
 * @property arity - The arity rule (`Sheet.link.arity`)
 * @property check - Member checks (`Sheet.link.check.exists()` and author rules)
 * @property store - How a `String` field is written back
 * @property options - The members a row may be offered (#844)
 */
export interface SheetLinkConfig<R extends StructType, D extends StructType> extends SheetColumnBaseConfig<R, SheetLinkType> {
    /** When the column sits on the `to` half: the field holding the `from` members. */
    from?: SheetMemberArrayField<R>;
    /** When the column sits on the `from` half: the field holding the `to` members. */
    to?: SheetMemberArrayField<R>;
    /** The member kinds accepted. */
    members?: SheetMemberKindInput[];
    /** The counted-member grammar. */
    multiple?: SheetMultipleInput;
    /** Which halves the driver makes live, and the lock tags. */
    sides?: SheetSidesInput<D>;
    /** The arity rule. */
    arity?: SheetArityInput<R, D>;
    /** Member checks. */
    check?: SheetCheckInput<R>[];
    /** How a `String` field is written back. */
    store?: SheetStoreLiteral;
    /** The members a row may be offered. */
    options?: SheetOptionsInput<R>;
}

/**
 * Config for `Sheet.column.stamped` — a read-only code an upstream system
 * owns; never editable, skipped by paste and clear.
 *
 * @typeParam R - The host's row type
 * @property header - The header line
 * @property sub - The second header line
 * @property width - CSS width
 * @property owner - The owning system, for the strip
 * @property mark - Words on the cell, or a lock, over the row and the Record's day ({@link SheetMarkInput}); a Record's
 */
export interface SheetStampedConfig<R extends StructType = StructType> {
    /** The header line. */
    header?: SubtypeExprOrValue<StringType>;
    /** The second header line. */
    sub?: SubtypeExprOrValue<StringType>;
    /** CSS width. */
    width?: SubtypeExprOrValue<StringType>;
    /** The owning system. */
    owner?: SubtypeExprOrValue<StringType>;
    /** Words on the cell, or a lock: over the row and the Record's day. */
    mark?: SheetMarkInput<R>;
}

/**
 * Config for `Sheet.column.custom` — an author parse / print pair over the
 * field's own payload (§3.9).
 *
 * @typeParam R - The host's row type
 * @typeParam P - The payload type (the field's type, or its `Option`'s)
 * @property accepts - The strip's "what this field accepts" line
 * @property parse - Typed text → `Option<P>`; `none` keeps the editor open with the neg ring
 * @property print - `P` → display text
 */
export interface SheetCustomConfig<R extends StructType, P extends EastType> extends SheetColumnBaseConfig<R, P> {
    /** The strip's "what this field accepts" line. */
    accepts: SubtypeExprOrValue<StringType>;
    /** Typed text → `Option<P>`. */
    parse: SubtypeExprOrValue<FunctionType<[StringType, SheetAnyContextOf<R>], OptionType<P>>>;
    /** `P` → display text. */
    print: SubtypeExprOrValue<FunctionType<[P], StringType>>;
}

/** Every column config, erased — what a built column carries. @internal */
export type SheetAnyColumnConfig =
    & SheetColumnBaseConfig<StructType, EastType>
    & Partial<SheetValueConfig<StructType, EastType>>
    & Partial<SheetDateConfig<StructType>>
    & Partial<SheetQuantityConfig<StructType, StructType>>
    & Partial<SheetSetConfig<StructType>>
    & Partial<SheetLinkConfig<StructType, StructType>>
    & Partial<SheetStampedConfig>
    & Partial<SheetCustomConfig<StructType, EastType>>
    & Partial<Pick<SheetAnyActionConfig, "cases" | "start" | "blocked" | "name" | "title">>
    & Partial<Pick<RecordTitleConfig<StructType>, "avatar">>
    & Partial<Pick<RecordPersonConfig<StructType>, "unassigned">>
    & Partial<Pick<RecordToggleConfig<StructType>, "on" | "off" | "look">>
    & Partial<Pick<RecordCycleConfig<StructType>, "scale">>
    & Partial<Pick<RecordCycleStepsConfig<StructType, VariantType>, "steps">>
    // An age's `unit` names what it counts, a quantity's the unit it prints: the age's is read by its own name.
    & Partial<Omit<RecordAgeConfig<StructType>, "header" | "sub" | "width" | "unit">>
    & Partial<Pick<RecordAuditConfig, "mode">>
    // A column from data's `mark` is the member's, read by the build as the function it is given.
    & Partial<Omit<SheetFromDataInput<EastType>, "mark">>
    & { field?: string };

// ============================================================================
// Builders
// ============================================================================

/** Build one column value — a column from data keyed by a name of its own carrying the field it names. @internal */
export function column<R extends StructType, A extends EastType>(
    rowType: R,
    kind: SheetColumnKindLiteral,
    config: object,
    extra: { driverType?: StructType; register?: string; variantType?: VariantType } = {},
): SheetColumn<R, A> {
    const field = (config as { field?: unknown }).field;
    return { kind, config: config as SheetAnyColumnConfig, rowType, ...extra, ...(typeof field === "string" ? { field } : {}) };
}

/** Whether a builder's second positional argument is a driver row type. */
function isStructType(v: unknown): v is StructType {
    return typeof v === "object" && v !== null && (v as { type?: unknown }).type === "Struct";
}

/**
 * A free-text column — `Sheet.column.text(R, cfg)`. Sits on a `String` /
 * `Option<String>` field; with `value`, a read-only projection on any field;
 * with `each`, a column per member of a register or per field of a struct
 * ({@link SheetFromDataInput}).
 */
export function text<R extends StructType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, config: SheetFromDataConfig<SheetTextConfig<R>, StringType, F>): SheetFromDataColumn<R, F>;
export function text<R extends StructType>(rowType: R, config: SheetTextConfig<R> & SheetValueConfig<R, StringType>): SheetColumn<R, EastType>;
export function text<R extends StructType>(rowType: R, config?: SheetTextConfig<R>): SheetColumn<R, StringType | OptionType<StringType>>;
export function text<R extends StructType>(rowType: R, config: object = {}): SheetColumn<R, EastType> {
    return column(rowType, "text", config);
}

/**
 * A date column — `Sheet.column.date(R, cfg)`: UTC midnight, the B§3 date
 * grammar (`+3d`, `4d` from `base`, weekdays, ISO, `d/m[/yy]`). Sits on a
 * `DateTime` / `Option<DateTime>` field; with `each`, a column per member of
 * a register or per field of a struct ({@link SheetFromDataInput}).
 */
export function date<R extends StructType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, config: SheetFromDataConfig<SheetDateConfig<R>, DateTimeType, F>): SheetFromDataColumn<R, F>;
export function date<R extends StructType>(rowType: R, config: SheetDateConfig<R> & SheetValueConfig<R, DateTimeType>): SheetColumn<R, EastType>;
export function date<R extends StructType>(rowType: R, config?: SheetDateConfig<R>): SheetColumn<R, DateTimeType | OptionType<DateTimeType>>;
export function date<R extends StructType>(rowType: R, config: object = {}): SheetColumn<R, EastType> {
    return column(rowType, "date", config);
}

/**
 * A quantity column — `Sheet.column.quantity(R, cfg)` on a sheet without a
 * driver, `Sheet.column.quantity(R, D, cfg)` when the unit is read off the
 * driver's row (`uom: d => d.uom`). Sits on a `Float` / `Option<Float>` field;
 * with `each` and one `unit` for every row, a column per member of a register
 * or per field of a struct ({@link SheetFromDataInput}).
 */
export function quantity<R extends StructType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, config: SheetFromDataConfig<Omit<SheetQuantityConfig<R, StructType>, "uom">, FloatType, F>): SheetFromDataColumn<R, F>;
export function quantity<R extends StructType, D extends StructType>(rowType: R, driverType: D, config: SheetQuantityConfig<R, D> & SheetValueConfig<R, FloatType>): SheetColumn<R, EastType>;
export function quantity<R extends StructType, D extends StructType>(rowType: R, driverType: D, config?: SheetQuantityConfig<R, D>): SheetColumn<R, FloatType | OptionType<FloatType>>;
export function quantity<R extends StructType>(rowType: R, config: Omit<SheetQuantityConfig<R, StructType>, "uom"> & SheetValueConfig<R, FloatType>): SheetColumn<R, EastType>;
export function quantity<R extends StructType>(rowType: R, config?: Omit<SheetQuantityConfig<R, StructType>, "uom">): SheetColumn<R, FloatType | OptionType<FloatType>>;
export function quantity<R extends StructType>(rowType: R, second?: unknown, third?: unknown): SheetColumn<R, EastType> {
    if (isStructType(second)) return column(rowType, "quantity", (third ?? {}) as object, { driverType: second });
    return column(rowType, "quantity", (second ?? {}) as object);
}

/**
 * An integer column — `Sheet.column.integer(R, cfg)`. Sits on an `Integer` /
 * `Option<Integer>` field; with `each`, a column per member of a register or
 * per field of a struct ({@link SheetFromDataInput}).
 */
export function integer<R extends StructType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, config: SheetFromDataConfig<SheetIntegerConfig<R>, IntegerType, F>): SheetFromDataColumn<R, F>;
export function integer<R extends StructType>(rowType: R, config: SheetIntegerConfig<R> & SheetValueConfig<R, IntegerType>): SheetColumn<R, EastType>;
export function integer<R extends StructType>(rowType: R, config?: SheetIntegerConfig<R>): SheetColumn<R, IntegerType | OptionType<IntegerType>>;
export function integer<R extends StructType>(rowType: R, config: object = {}): SheetColumn<R, EastType> {
    return column(rowType, "integer", config);
}

/**
 * The driver column — `Sheet.column.lookup(R, cfg)`: scored candidates from
 * the driver's register (B§3.1). Sits on a `String` field; the `driver` prop
 * names it.
 */
export function lookup<R extends StructType>(rowType: R, config: SheetLookupConfig<R> = {}): SheetColumn<R, StringType | OptionType<StringType>> {
    return column(rowType, "lookup", config);
}

/**
 * A reference column — `Sheet.column.reference(R, register, cfg)`: a lookup
 * over a flat member list. Sits on a field holding one member's key: of the
 * register's key type, or its Option (east-workspace#1747) — a `String` /
 * `Option<String>` one for a register keyed by String; with `each`, a column
 * per member of a register or per field of a struct ({@link SheetFromDataInput}).
 */
export function reference<R extends StructType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, register: string, config: SheetFromDataConfig<SheetReferenceConfig<R>, EastType, F>): SheetFromDataColumn<R, F>;
export function reference<R extends StructType>(rowType: R, register: string, config?: SheetReferenceConfig<R>): SheetColumn<R, EastType>;
export function reference<R extends StructType>(rowType: R, register: string, config: object = {}): SheetColumn<R, EastType> {
    return column(rowType, "reference", config, { register });
}

/**
 * An enum column — `Sheet.column.enum(R, register, cfg)`: an upper-cased
 * register word with the member's valence dot. Sits on a field holding one
 * member's key: of the register's key type, or its Option (east-workspace#1747)
 * — a `String` / `Option<String>` one for a register keyed by String; with
 * `each`, a column per member of a register or per field of a struct
 * ({@link SheetFromDataInput}).
 */
export function enumColumn<R extends StructType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, register: string, config: SheetFromDataConfig<SheetEnumConfig<R>, EastType, F>): SheetFromDataColumn<R, F>;
export function enumColumn<R extends StructType>(rowType: R, register: string, config?: SheetEnumConfig<R>): SheetColumn<R, EastType>;
export function enumColumn<R extends StructType>(rowType: R, register: string, config: object = {}): SheetColumn<R, EastType> {
    return column(rowType, "enum", config, { register });
}

/**
 * A set column — `Sheet.column.set(R, register, cfg)`: comma members, the
 * link grammar without an arrow. Sits on a `Sheet.Types.Link`,
 * `Array<Sheet.Types.Member>` or `String` field; with `each`, a column per
 * member of a register or per field of a struct, each cell a
 * `Sheet.Types.Link` ({@link SheetFromDataInput}).
 */
export function set<R extends StructType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, register: string, config: SheetFromDataConfig<SheetSetConfig<R>, SheetLinkType, F>): SheetFromDataColumn<R, F>;
export function set<R extends StructType>(rowType: R, register: string, config?: SheetSetConfig<R>): SheetColumn<R, SheetLinkType | ArrayType<SheetMemberType> | StringType | OptionType<StringType>>;
export function set<R extends StructType>(rowType: R, register: string, config: object = {}): SheetColumn<R, EastType> {
    return column(rowType, "set", config, { register });
}

/**
 * A link column — `Sheet.column.link(R, D, register, cfg)`: `from > to`, the
 * split cell with sides, arity and checks (§3.4). Sits on a
 * `Sheet.Types.Link`, `Array<Sheet.Types.Member>` or `String` field; with
 * `each`, a column per member of a register or per field of a struct, each
 * cell a `Sheet.Types.Link` ({@link SheetFromDataInput}).
 */
export function link<R extends StructType, D extends StructType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, driverType: D, register: string, config: SheetFromDataConfig<SheetLinkConfig<R, D>, SheetLinkType, F>): SheetFromDataColumn<R, F>;
export function link<R extends StructType, D extends StructType>(rowType: R, driverType: D, register: string, config?: SheetLinkConfig<R, D>): SheetColumn<R, SheetLinkType | ArrayType<SheetMemberType> | StringType | OptionType<StringType>>;
export function link<R extends StructType, D extends StructType>(rowType: R, driverType: D, register: string, config: object = {}): SheetColumn<R, EastType> {
    return column(rowType, "link", config, { driverType, register });
}

/**
 * A stamped column — `Sheet.column.stamped(R, cfg)`: a read-only code an
 * upstream system owns. Sits on a `String` / `Option<String>` field; with
 * `each`, a column per member of a register or per field of a struct, read
 * only ({@link SheetFromDataInput}).
 */
export function stamped<R extends StructType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, config: SheetFromDataConfig<SheetStampedConfig<R>, StringType, F>): SheetFromDataColumn<R, F>;
export function stamped<R extends StructType>(rowType: R, config?: SheetStampedConfig<R>): SheetColumn<R, StringType | OptionType<StringType>>;
export function stamped<R extends StructType>(rowType: R, config: object = {}): SheetColumn<R, EastType> {
    return column(rowType, "stamped", config);
}

/**
 * A custom column — `Sheet.column.custom(R, cfg)`: an author parse / print
 * pair over the field's own payload (§3.9). Sits on a field of the payload
 * type or its `Option`; with `each`, a column per member of a register or
 * per field of a struct, each cell a payload ({@link SheetFromDataInput}).
 */
export function custom<R extends StructType, P extends EastType, F extends SheetFieldKey<R> | undefined = undefined>(rowType: R, config: SheetFromDataConfig<SheetCustomConfig<R, P>, P, F>): SheetFromDataColumn<R, F>;
export function custom<R extends StructType, P extends EastType>(rowType: R, config: SheetCustomConfig<R, P>): SheetColumn<R, P | OptionType<P>>;
export function custom<R extends StructType>(rowType: R, config: object): SheetColumn<R, EastType> {
    return column(rowType, "custom", config);
}
