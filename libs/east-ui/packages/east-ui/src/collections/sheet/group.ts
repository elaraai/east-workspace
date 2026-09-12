/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet.group` and `Sheet.group.cell.*` — grouped rows (#740): the group is
 * the row, its lines live in one field of its own type (`Array<L>` or
 * `Dict<String, L>`), and the band a group draws above its lines shows the
 * group's own fields under the line columns.
 *
 * `Sheet.group(P, "lines", { title, sub?, cells?, folded? })` names the lines
 * field and the band; each `cells` entry is a group field declared over the
 * group's row with `Sheet.group.cell.<kind>(P, "field", cfg)` — the same
 * builders as `Sheet.column.<kind>` minus the header, keyed in `cells` by
 * the LINE column it sits under. A band cell edits like any cell and reaches
 * the host through the sheet's `onEdit` callback (`groupCommit`) or the
 * `onUpdate` rebuild; `editable: false` and a `value:` projection are
 * read-only.
 *
 * The builders only CAPTURE; the root describes each cell against the group's
 * row type and reifies the accessors (`root.ts`, `bridge.ts`).
 *
 * @packageDocumentation
 */

import type {
    EastType,
    ExprType,
    SubtypeExprOrValue,
    BooleanType,
    DateTimeType,
    FloatType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
} from "@elaraai/east";

import type { TickFormatType } from "../../format/types.js";
import type { SheetColumnKindLiteral, SheetLinesField, SheetLineOf } from "./types.js";
import type { SheetAnyColumnConfig, SheetFieldKey } from "./columns.js";

// ============================================================================
// The band cell value
// ============================================================================

/**
 * A built band cell — what a `Sheet.group.cell.*` builder returns and the
 * `cells` map holds.
 *
 * @typeParam P - The group's row type
 */
export interface SheetGroupCell<P extends StructType> {
    /** The cell's kind. */
    readonly kind: SheetColumnKindLiteral;
    /** The group field the cell reads and writes. */
    readonly field: SheetFieldKey<P>;
    /** The author's config, as given. @internal */
    readonly config: SheetAnyColumnConfig;
    /** The register the cell resolves against. @internal */
    readonly register?: string;
    /** Phantom — the row type. @internal */
    readonly __row?: (r: P) => void;
}

/** The keys of a group row whose field is `A` or its `Option`. */
export type SheetFieldOf<P extends StructType, A extends EastType> = {
    [K in SheetFieldKey<P>]: P["fields"][K] extends A | OptionType<A> ? K : never
}[SheetFieldKey<P>];

// ============================================================================
// Configs
// ============================================================================

/**
 * What every band cell takes.
 *
 * @property editable - `false` makes the cell read-only
 */
export interface SheetGroupCellBaseConfig {
    /** `false` makes the cell read-only. */
    editable?: boolean;
}

/**
 * A derived read — the cell displays the projection over the group row and
 * is read-only; it may reach into the group's lines.
 *
 * @typeParam P - The group's row type
 * @typeParam T - The kind's payload type
 */
export interface SheetGroupValueConfig<P extends StructType, T extends EastType> {
    /** The projection over the group row. */
    value: (row: ExprType<P>) => SubtypeExprOrValue<T | OptionType<T>>;
}

/** Config for `Sheet.group.cell.date`. */
export interface SheetGroupDateConfig extends SheetGroupCellBaseConfig {
    /** A display pattern (East date tokens). */
    format?: SubtypeExprOrValue<StringType>;
}

/**
 * Config for `Sheet.group.cell.quantity`. A band has no driver member, so a
 * band quantity carries no unit; the line column's unit is the driver's.
 */
export interface SheetGroupQuantityConfig extends SheetGroupCellBaseConfig {
    /** A display format. */
    format?: SubtypeExprOrValue<TickFormatType>;
}

/** Config for `Sheet.group.cell.stamped`. */
export interface SheetGroupStampedConfig {
    /** The owning system. */
    owner?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// Builders
// ============================================================================

/** Build one band cell value. */
function cell<P extends StructType>(
    kind: SheetColumnKindLiteral,
    field: SheetFieldKey<P>,
    config: object,
    extra: { register?: string } = {},
): SheetGroupCell<P> {
    return { kind, field, config: config as SheetAnyColumnConfig, ...extra };
}

/** A text band cell — `Sheet.group.cell.text(P, "field", cfg)` on a `String` / `Option<String>` field, or a `value:` projection on any field. */
export function text<P extends StructType>(groupType: P, field: SheetFieldKey<P>, config: SheetGroupCellBaseConfig & SheetGroupValueConfig<P, StringType>): SheetGroupCell<P>;
export function text<P extends StructType>(groupType: P, field: SheetFieldOf<P, StringType>, config?: SheetGroupCellBaseConfig): SheetGroupCell<P>;
export function text<P extends StructType>(_groupType: P, field: string, config: object = {}): SheetGroupCell<P> {
    return cell("text", field as SheetFieldKey<P>, config);
}

/** A date band cell — `Sheet.group.cell.date(P, "field", cfg)` on a `DateTime` / `Option<DateTime>` field. */
export function date<P extends StructType>(groupType: P, field: SheetFieldKey<P>, config: SheetGroupDateConfig & SheetGroupValueConfig<P, DateTimeType>): SheetGroupCell<P>;
export function date<P extends StructType>(groupType: P, field: SheetFieldOf<P, DateTimeType>, config?: SheetGroupDateConfig): SheetGroupCell<P>;
export function date<P extends StructType>(_groupType: P, field: string, config: object = {}): SheetGroupCell<P> {
    return cell("date", field as SheetFieldKey<P>, config);
}

/** A quantity band cell — `Sheet.group.cell.quantity(P, "field", cfg)` on a `Float` / `Option<Float>` field, or a `value:` projection (a total over the lines, say). */
export function quantity<P extends StructType>(groupType: P, field: SheetFieldKey<P>, config: SheetGroupQuantityConfig & SheetGroupValueConfig<P, FloatType>): SheetGroupCell<P>;
export function quantity<P extends StructType>(groupType: P, field: SheetFieldOf<P, FloatType>, config?: SheetGroupQuantityConfig): SheetGroupCell<P>;
export function quantity<P extends StructType>(_groupType: P, field: string, config: object = {}): SheetGroupCell<P> {
    return cell("quantity", field as SheetFieldKey<P>, config);
}

/** An integer band cell — `Sheet.group.cell.integer(P, "field", cfg)` on an `Integer` / `Option<Integer>` field. */
export function integer<P extends StructType>(groupType: P, field: SheetFieldKey<P>, config: SheetGroupCellBaseConfig & SheetGroupValueConfig<P, IntegerType>): SheetGroupCell<P>;
export function integer<P extends StructType>(groupType: P, field: SheetFieldOf<P, IntegerType>, config?: SheetGroupCellBaseConfig): SheetGroupCell<P>;
export function integer<P extends StructType>(_groupType: P, field: string, config: object = {}): SheetGroupCell<P> {
    return cell("integer", field as SheetFieldKey<P>, config);
}

/** A reference band cell — `Sheet.group.cell.reference(P, register, "field", cfg)`: a lookup over a flat member list, on a `String` / `Option<String>` field. */
export function reference<P extends StructType>(_groupType: P, register: string, field: SheetFieldOf<P, StringType>, config: SheetGroupCellBaseConfig = {}): SheetGroupCell<P> {
    return cell("reference", field as SheetFieldKey<P>, config, { register });
}

/** An enum band cell — `Sheet.group.cell.enum(P, register, "field", cfg)`: an upper-cased register word with its valence dot, on a `String` / `Option<String>` field. */
export function enumCell<P extends StructType>(_groupType: P, register: string, field: SheetFieldOf<P, StringType>, config: SheetGroupCellBaseConfig = {}): SheetGroupCell<P> {
    return cell("enum", field as SheetFieldKey<P>, config, { register });
}

/** A stamped band cell — `Sheet.group.cell.stamped(P, "field", cfg)`: a read-only code an upstream system owns, on a `String` / `Option<String>` field. */
export function stamped<P extends StructType>(_groupType: P, field: SheetFieldOf<P, StringType>, config: SheetGroupStampedConfig = {}): SheetGroupCell<P> {
    return cell("stamped", field as SheetFieldKey<P>, config);
}

// ============================================================================
// The group declaration
// ============================================================================

/**
 * What `Sheet.group(P, "lines", …)` takes.
 *
 * @typeParam P - The group's row type
 * @typeParam L - The line type the lines field holds
 * @property title - The band's title — a `String` field of the group row; ⏎ / F2 on the band renames it
 * @property sub - The band's eyebrow — an accessor over the group row, display only
 * @property cells - Band cells keyed by the LINE column they sit under
 * @property folded - Whether a group opens folded — an accessor over the group row
 */
export interface SheetGroupConfig<P extends StructType, L extends StructType = StructType> {
    /** The band's title — a `String` field of the group row. */
    title: SheetFieldOf<P, StringType>;
    /** The band's eyebrow — display only. */
    sub?: (row: ExprType<P>) => SubtypeExprOrValue<StringType>;
    /** Band cells keyed by the line column they sit under. */
    cells?: { [K in SheetFieldKey<L>]?: SheetGroupCell<P> };
    /** Whether a group opens folded. */
    folded?: (row: ExprType<P>) => SubtypeExprOrValue<BooleanType>;
}

/**
 * A built group declaration — what `Sheet.group(…)` returns and the `group`
 * prop takes.
 *
 * @typeParam P - The group's row type
 * @typeParam F - The lines field
 */
export interface SheetGroupValue<P extends StructType, F extends string> {
    /** The group's row type. */
    readonly rowType: P;
    /** The field holding the lines. */
    readonly lines: F;
    /** The author's config, as given. @internal */
    readonly config: SheetGroupConfig<P, StructType>;
}

/**
 * Declares grouped rows — `Sheet.group(P, "lines", { title, sub?, cells?, folded? })`
 * (#740): the group is the row, `lines` names the field holding its lines
 * (an `Array<Line>` or a `Dict<String, Line>`), and the band draws the
 * title, the eyebrow and the `cells` under their line columns.
 *
 * @typeParam P - The group's row type
 * @typeParam F - The lines field — an `Array<Line>` or `Dict<String, Line>` field of `P`
 * @param rowType - The group's row type value
 * @param lines - The lines field
 * @param config - The band ({@link SheetGroupConfig})
 * @returns The declaration the `group` prop takes
 */
export function createGroup<P extends StructType, F extends SheetLinesField<P>>(rowType: P, lines: F, config: SheetGroupConfig<P, SheetLineOf<P, F>>): SheetGroupValue<P, F> {
    return { rowType, lines, config: config as SheetGroupConfig<P, StructType> };
}
