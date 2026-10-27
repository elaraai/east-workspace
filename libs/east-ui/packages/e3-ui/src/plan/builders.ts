/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Plan value builders — shorthand resolvers, the instant sugar
 * ({@link resolveInstant} / `Plan.at`), the axis declarations (`Plan.axis`,
 * `.time` / `.number` / `.ordinal`), element value builders (`Plan.run` /
 * `decision` / `port` / `event` / `marker` / `chip` / `mark`) and cell
 * builders (`heatCells` / `weightCells` / `segmentCells` / `tableCells`).
 * Every element is pure data — rich click/hover surfaces resolve through
 * the ROOT's `popover` / `hover` functions over `PlanElementRefType`
 * (`Plan Data Interface.md` §3.3), never per-element embeds.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    East,
    Expr,
    isVariant,
    ArrayType,
    BooleanType,
    DateTimeType,
    FloatType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import {
    EventStateType,
    IconType,
    StatusValueType,
    TimeResolutionType,
    type EventStateLiteral,
    type IconName,
    type StatusValueLiteral,
} from "@elaraai/east-ui";
import {
    ColorSchemeType,
    MatrixFillType,
    TickFormatType,
    refuseNonSolid,
    resolveTag,
    type ColorSchemeLiteral,
    type MatrixFillLiteral,
    type SolidIconPrefix,
} from "@elaraai/east-ui/internal";
import {
    PlanAxisType,
    type PlanAxisOptions,
    type PlanNumberAxisOptions,
    type PlanOrdinalAxisOptions,
    PlanInstantType,
    type PlanInstantLikeType,
    type PlanInstantInput,
    type PlanAxisKindLiteral,
    type PlanKindOf,
    type PlanInstantExpr,
    type PlanRunExpr,
    type PlanDecisionMarkExpr,
    type PlanPortExpr,
    type PlanBucketEventExpr,
    type PlanCellMarkerExpr,
    type PlanChipExpr,
    type PlanEventMarkExpr,
    type PlanHeatCellsExpr,
    type PlanTableCellsExpr,
    type PlanTableSeriesExpr,
    type PlanAxisExpr,
    type PlanCellsInput,
    type PlanTableCellsInput,
    PlanPortType,
    PlanCellMarkerType,
    PlanStretchType,
    type PlanStretchLiteral,
    PlanContentAlignType,
    type PlanContentAlignLiteral,
    PlanContentType,
    PlanAnimationType,
    type PlanAnimationLiteral,
    PlanEventMarkKindType,
    PlanHeatCellType,
    PlanWeightCellType,
    PlanSegmentType,
    PlanSegmentCellType,
    PlanHeatCellsType,
    PlanTableCellType,
    PlanTableToneType,
    type PlanTableToneLiteral,
    PlanTableSeriesType,
    PlanLinkType,
    PlanRunRefType,
    PlanRunType,
    PlanDecisionMarkType,
    PlanBucketEventType,
    PlanChipType,
    PlanEventMarkType,
    PlanChartPointType,
    PlanChartBandPointType,
    PlanLaneType,
    PlanRowIdType,
    PlanFoldType,
    type PlanFoldLiteral,
    PlanQuantityType,
    PlanHeatScaleType,
    PlanUiStateType,
} from "./types.js";
import { eventRefKind } from "./refs.js";
import {
    planReadOf,
    planUse,
    planUseOf,
    refuseReadOutsideSeries,
    type PlanValuesEdit,
    type PlanValuesInput,
    type PlanValuesReadSpec,
    type PlanValuesUse,
} from "./reads.js";

// ============================================================================
// Shorthand resolvers
// ============================================================================

/**
 * Resolves the shared event-lifecycle string shorthands into an
 * {@link EventStateType} value: `"estimated"`, `"added"`, `"recommended"`,
 * `"removed"` (the three `proposed` flavours), `"confirmed"`,
 * `"in-progress"`, `"actual"`, `"rejected"`.
 *
 * @param state - An `EventStateType` value/expression or a string shorthand
 * @returns The resolved `EventStateType` value
 */
export function resolvePlanEventState(
    state: SubtypeExprOrValue<EventStateType> | EventStateLiteral,
): SubtypeExprOrValue<EventStateType> {
    if (typeof state !== "string") return state;
    switch (state) {
        case "estimated":   return East.value(variant("estimated", null), EventStateType);
        case "added":       return East.value(variant("proposed", variant("added", null)), EventStateType);
        case "recommended": return East.value(variant("proposed", variant("recommended", null)), EventStateType);
        case "removed":     return East.value(variant("proposed", variant("removed", null)), EventStateType);
        case "confirmed":   return East.value(variant("confirmed", null), EventStateType);
        case "in-progress": return East.value(variant("in-progress", null), EventStateType);
        case "actual":      return East.value(variant("actual", null), EventStateType);
        case "rejected":    return East.value(variant("rejected", null), EventStateType);
    }
}

/** A fold input — a {@link PlanFoldLiteral} or a `PlanFoldType` value / expression (#824). */
export type PlanFoldInput = PlanFoldLiteral | SubtypeExprOrValue<PlanFoldType>;

/**
 * Resolve a fold input, falling back to the default of what it folds.
 *
 * @param fold - The declared fold, if any
 * @param fallback - The default for the values being folded (`mean` for levels, `sum` for amounts)
 * @returns The fold
 */
export function resolveFold(fold: PlanFoldInput | undefined, fallback: PlanFoldLiteral): ExprType<PlanFoldType> {
    return resolveTag(fold ?? fallback, PlanFoldType);
}

/**
 * An icon input — a bare Font Awesome solid name (`"rocket"`), a
 * `{ prefix: "fas", name }` pair, or an `IconType` expression (the Banner
 * envelope precedent). East UI draws Font Awesome's solid set only (#1263).
 * The mounting context pins size and colour; hosts choose the glyph, never
 * the geometry.
 */
export type PlanIconInput = IconName | { prefix: SolidIconPrefix; name: string } | SubtypeExprOrValue<IconType>;

/**
 * Resolve a {@link PlanIconInput} into an `IconType` value.
 *
 * @param icon - The icon
 * @param where - What takes it, as a refusal names it (`Plan.run icon`, …)
 * @returns The icon as an `IconType` value or expression
 * @throws {Error} When an icon given by value is not of Font Awesome's solid set (#1263)
 */
export function resolveIcon(icon: PlanIconInput, where = "Plan icon"): SubtypeExprOrValue<IconType> {
    if (typeof icon === "string") {
        return East.value({ prefix: "fas", name: icon, label: none, style: none }, IconType);
    }
    refuseNonSolid(where, icon);
    if (typeof (icon as { prefix?: unknown }).prefix === "string") {
        return East.value({
            prefix: (icon as { prefix: string }).prefix,
            name:   (icon as { name: string }).name,
            label:  none,
            style:  none,
        }, IconType);
    }
    return icon as SubtypeExprOrValue<IconType>;
}

// ============================================================================
// Instants — the axis-kind sugar
// ============================================================================

/**
 * Resolves an instant input into a {@link PlanInstantType} value — the one
 * place the arm is inferred (#631).
 *
 * @remarks
 * The input is any {@link PlanInstantLikeType} value or expression. JS values
 * wrap by their type (`Date` ⇒ `time`, `number` / `bigint` ⇒ `number`,
 * `string` ⇒ `ordinal`); East expressions wrap by their STATIC type
 * (`DateTimeType` ⇒ `time`, `FloatType` ⇒ `number`, `IntegerType` ⇒ `number`
 * via `toFloat`, `StringType` ⇒ `ordinal`); a {@link PlanInstantType} value
 * or expression passes through (subtype-checked by `East.value`). Nothing
 * here knows the canvas axis — the arm is the INPUT's; the renderer holds it
 * against the root's declaration.
 *
 * @param v - The instant (a value or expression of a {@link PlanInstantLikeType})
 * @param where - The field being resolved, for the error message
 * @returns The instant as a `PlanInstantType` expression
 * @throws {Error} If `v` is an expression of a non-instant type
 */
export function resolveInstant(v: PlanInstantInput, where: string): ExprType<PlanInstantType> {
    if (v instanceof Date) return East.value(variant("time", v), PlanInstantType);
    if (typeof v === "number") return East.value(variant("number", v), PlanInstantType);
    if (typeof v === "bigint") return East.value(variant("number", Number(v)), PlanInstantType);
    if (typeof v === "string") return East.value(variant("ordinal", v), PlanInstantType);
    if (v instanceof Expr) {
        const tag = (Expr.type(v as Expr) as { type: string }).type;
        switch (tag) {
            case "DateTime": return East.value(variant("time", v as ExprType<DateTimeType>), PlanInstantType);
            case "Float":    return East.value(variant("number", v as ExprType<FloatType>), PlanInstantType);
            case "Integer":  return East.value(variant("number", (v as ExprType<IntegerType>).toFloat()), PlanInstantType);
            case "String":   return East.value(variant("ordinal", v as ExprType<StringType>), PlanInstantType);
            case "Variant":  return East.value(v as SubtypeExprOrValue<PlanInstantType>, PlanInstantType);
            default:
                throw new Error(
                    `Plan: ${where} must be an instant — a Date / number / string, a DateTime / Float / ` +
                    `Integer / String expression, or a Plan.at.* value (got a ${tag} expression)`);
        }
    }
    // A plain variant VALUE (`variant("time", d)`, a decoded instant).
    return East.value(v as SubtypeExprOrValue<PlanInstantType>, PlanInstantType);
}

/**
 * The `Plan.at` builders — one instant per axis kind, explicitly. The
 * element builders already wrap by type; these are for element RECORDS
 * written as data (`{ at: Plan.at.time(week(27n)), … }` in a
 * `Plan.Types.HeatCell` array) and for reading as a declaration. Each
 * result is BRANDED with its arm ({@link PlanInstantExpr}), so a cell
 * list built from them carries the kind to the root's compile-time check.
 */
export const at = {
    /**
     * A `time` instant.
     *
     * @param v - The UTC instant (a `Date` or `DateTimeType` expression)
     * @returns A `PlanInstantType` expression with the `time` arm, branded `"time"`
     */
    time: (v: SubtypeExprOrValue<DateTimeType>): PlanInstantExpr<"time"> =>
        East.value(variant("time", v), PlanInstantType) as PlanInstantExpr<"time">,
    /**
     * A `number` instant.
     *
     * @param v - The position (a number or `FloatType` expression)
     * @returns A `PlanInstantType` expression with the `number` arm, branded `"number"`
     */
    number: (v: SubtypeExprOrValue<FloatType> | number): PlanInstantExpr<"number"> =>
        East.value(variant("number", v), PlanInstantType) as PlanInstantExpr<"number">,
    /**
     * An `ordinal` instant.
     *
     * @param v - The declared value (a string or `StringType` expression)
     * @returns A `PlanInstantType` expression with the `ordinal` arm, branded `"ordinal"`
     */
    ordinal: (v: SubtypeExprOrValue<StringType>): PlanInstantExpr<"ordinal"> =>
        East.value(variant("ordinal", v), PlanInstantType) as PlanInstantExpr<"ordinal">,
} as const;

// ============================================================================
// Axis — the three kinds
// ============================================================================

/**
 * The axis values built WITHOUT a window (#822) — a canvas given one must bind
 * a slice a source of which holds the window in its range (an event kind's or
 * a tab's, never the canvas's rows', #1344), or the Plan refuses it at build
 * time. An axis held in a variable (`$.const(Plan.axis(…))`) is not the value
 * recorded here, so its canvas is held to the rule at render instead.
 */
export const WINDOWLESS_AXES = new WeakSet<object>();

/**
 * The kind of each axis value `Plan.axis` built (#1191) — what a Plan reads to
 * refuse event kinds on a number or ordinal axis at build. An axis held in a
 * variable is not the value recorded here, so its Plan checks it as it is
 * evaluated instead.
 */
const AXIS_KINDS = new WeakMap<object, PlanAxisKindLiteral>();

/**
 * The kind of an axis value `Plan.axis` built.
 *
 * @param axis - A Plan's `axis`
 * @returns `"time"`, `"number"` or `"ordinal"`; `undefined` for an axis held in a variable
 * @internal
 */
export function axisKindOf(axis: unknown): PlanAxisKindLiteral | undefined {
    return typeof axis === "object" && axis !== null ? AXIS_KINDS.get(axis) : undefined;
}

/**
 * Builds the `time` axis declaration — `Plan.axis({ … })` / `Plan.axis.time`.
 *
 * @param options - Window, resolution(s), now instant and tick format ({@link PlanAxisOptions})
 * @returns An East expression of {@link PlanAxisType} (the `time` arm), branded `"time"` — the root's canvas kind
 *
 * @remarks
 * The window is half-open `[min, max)` in UTC; omit it to follow the datetime
 * range a source of the bound slice holds — an event kind's or a tab's, never
 * the canvas's rows' (#1344) — a canvas states one or the other (#822). There
 * is no fit to the data. `resolutions` lists the WEEK/DAY-style segment
 * options (omit ⇒ no segment). Where a source of the Plan's slice holds the
 * window, its state supersedes the window after mount; with none holding it,
 * the canvas holds its own, from this one. The resolution is the slice's.
 */
export function createTimeAxis(options: PlanAxisOptions): PlanAxisExpr<"time"> {
    const axis = East.value(variant("time", {
        window: options.window !== undefined
            ? some({ min: options.window.min, max: options.window.max })
            : none,
        resolution:  resolveTag(options.resolution, TimeResolutionType),
        resolutions: (options.resolutions ?? []).map(r => resolveTag(r, TimeResolutionType)),
        now:         options.now !== undefined ? some(options.now) : none,
        format:      options.format !== undefined ? some(options.format) : none,
    }), PlanAxisType) as PlanAxisExpr<"time">;
    if (options.window === undefined) WINDOWLESS_AXES.add(axis);
    AXIS_KINDS.set(axis, "time");
    return axis;
}

/**
 * Builds the `number` axis declaration — `Plan.axis.number({ … })`.
 *
 * @param options - Window, step, now position and tick format ({@link PlanNumberAxisOptions})
 * @returns An East expression of {@link PlanAxisType} (the `number` arm), branded `"number"` — the root's canvas kind
 * @throws {Error} If a literal `step` is not `> 0`
 *
 * @remarks
 * `[min, max)` ÷ `step` = `n` buckets, edges on whole multiples of `step`
 * (the `TimeResolution` rule, numerically). Omit the window to follow the
 * `float` / `integer` range a source of the bound slice holds — never the
 * canvas's rows' (#1344) — a canvas states one or the other (#822). Element
 * instants on this canvas are numbers — a `FloatType` /
 * `IntegerType` accessor or a bare number wraps to the `number` arm.
 */
export function createNumberAxis(options: PlanNumberAxisOptions): PlanAxisExpr<"number"> {
    if (typeof options.step === "number" && !(options.step > 0)) {
        throw new Error(`Plan.axis.number: \`step\` must be > 0 (got ${options.step}) — it is the bucket width`);
    }
    const axis = East.value(variant("number", {
        window: options.window !== undefined
            ? some({ min: options.window.min, max: options.window.max })
            : none,
        step:   options.step,
        now:    options.now !== undefined ? some(options.now) : none,
        format: options.format !== undefined ? some(options.format) : none,
    }), PlanAxisType) as PlanAxisExpr<"number">;
    if (options.window === undefined) WINDOWLESS_AXES.add(axis);
    AXIS_KINDS.set(axis, "number");
    return axis;
}

/**
 * Builds the `ordinal` axis declaration — `Plan.axis.ordinal({ … })`.
 *
 * @param options - The ordered values and the now value ({@link PlanOrdinalAxisOptions})
 * @returns An East expression of {@link PlanAxisType} (the `ordinal` arm), branded `"ordinal"` — the root's canvas kind
 * @throws {Error} If a literal `values` list is empty
 *
 * @remarks
 * The declared values ARE the buckets, one each, in order; the window is
 * the whole list, so there is no slice range to brush and the window keys
 * idle. Element instants on this canvas are the values — a `StringType`
 * accessor or a bare string wraps to the `ordinal` arm.
 */
export function createOrdinalAxis(options: PlanOrdinalAxisOptions): PlanAxisExpr<"ordinal"> {
    if (Array.isArray(options.values) && options.values.length === 0) {
        throw new Error("Plan.axis.ordinal: `values` must list at least one value — the list is the axis");
    }
    const axis = East.value(variant("ordinal", {
        values: East.value(options.values as SubtypeExprOrValue<ArrayType<StringType>>, ArrayType(StringType)),
        now:    options.now !== undefined ? some(options.now) : none,
    }), PlanAxisType) as PlanAxisExpr<"ordinal">;
    AXIS_KINDS.set(axis, "ordinal");
    return axis;
}

/**
 * The `Plan.axis` builder — the `time` shorthand, with the explicit
 * per-kind builders as members (the Planner's `Planner.axis.time / .number /
 * .ordinal` names).
 */
export interface PlanAxisBuilder {
    /** The `time` axis (the shorthand — `Plan.axis({ resolution: "week", … })`). */
    (options: PlanAxisOptions): PlanAxisExpr<"time">;
    /** The `time` axis, explicitly. */
    time: typeof createTimeAxis;
    /** The `number` axis — a numeric window ÷ `step`. */
    number: typeof createNumberAxis;
    /** The `ordinal` axis — a declared list of values. */
    ordinal: typeof createOrdinalAxis;
}

/**
 * Builds the shared axis declaration — `Plan.axis({ … })` is the `time`
 * shorthand; `Plan.axis.time` / `.number` / `.ordinal` declare each kind.
 *
 * @param options - The time-axis options ({@link PlanAxisOptions})
 * @returns An East expression of {@link PlanAxisType}, branded with its kind
 */
export const createAxis: PlanAxisBuilder = Object.assign(
    function axis(options: PlanAxisOptions): PlanAxisExpr<"time"> { return createTimeAxis(options); },
    { time: createTimeAxis, number: createNumberAxis, ordinal: createOrdinalAxis },
);

// ============================================================================
// Quantities (#824)
// ============================================================================

/**
 * How a quantity prints — see {@link Plan.quantity}.
 *
 * @property unit - The unit it is in (`"k sheets"`); quantities in different units never sum together
 * @property format - How the value prints (a `Format.*` spec); omit ⇒ the canvas's plain number
 * @property text - The caption to print instead of the formatted value and unit
 */
export interface PlanQuantityOptions {
    /** The unit the value is in (`"k sheets"`) — printed after it, and what a rollup sums by. */
    unit?: SubtypeExprOrValue<StringType>;
    /** How the value prints — a `Format.*` spec (the shared `TickFormatType`), in the viewer's locale. */
    format?: SubtypeExprOrValue<TickFormatType>;
    /** The caption to print instead of the formatted value and unit — the value still sums and weighs. */
    text?: SubtypeExprOrValue<StringType>;
}

/**
 * Builds a quantity — a number with its unit and how it prints (#824). A run
 * carries one as its `quantity` (its bar prints it; a parent's rollup band sums
 * its runs' per unit), and so does a link (its weight and its caption).
 *
 * @param value - The amount (a number or `FloatType` expression)
 * @param options - Its unit, format and caption override ({@link PlanQuantityOptions})
 * @returns An East expression of {@link PlanQuantityType}
 */
export function createQuantity(
    value: SubtypeExprOrValue<FloatType> | number,
    options?: PlanQuantityOptions,
): ExprType<PlanQuantityType> {
    return East.value({
        value,
        unit:   options?.unit !== undefined ? some(options.unit) : none,
        format: options?.format !== undefined ? some(East.value(options.format, TickFormatType)) : none,
        text:   options?.text !== undefined ? some(options.text) : none,
    }, PlanQuantityType);
}

// ============================================================================
// Looks — what a named read's `draw` gives (#1436)
// ============================================================================

/**
 * A look field its element holds as an `Option` (#1436): the value, or the
 * `Option` itself (`label: some(stop)`), so a field an item already holds as
 * an `Option` passes as it is.
 *
 * @typeParam T - The field's East type
 * @typeParam S - The shorthands it takes besides (a status literal, a number)
 */
export type PlanLookOption<T extends EastType, S = never> = SubtypeExprOrValue<T> | SubtypeExprOrValue<OptionType<T>> | S;

/**
 * What `draw` gives for a run — `Plan.items(field, { from, to }, draw)` on a
 * span series' `runs`: everything {@link Plan.run} takes but its key and its
 * instants, which are the item's id and its times.
 *
 * @property label - The bar text
 * @property state - The lifecycle state
 * @property quantity - The quantity the bar prints and a parent's band sums
 * @property status - The status tint
 * @property moved - The same-status churn counter
 * @property icon - The leading glyph
 */
export interface PlanRunLook {
    /** The bar text (`"RUN · J-4642"`). */
    label: SubtypeExprOrValue<StringType>;
    /** The lifecycle state — a string shorthand or an `EventStateType` value. */
    state: SubtypeExprOrValue<EventStateType> | EventStateLiteral;
    /** The quantity — `Plan.quantity(96, { unit: "k sheets" })`, or an `Option` of one. */
    quantity?: PlanLookOption<PlanQuantityType>;
    /** The status tint — `"warning"` draws the over-dwell ring. */
    status?: PlanLookOption<StatusValueType, StatusValueLiteral>;
    /** The same-status churn counter. */
    moved?: PlanLookOption<IntegerType, number>;
    /** The leading glyph. */
    icon?: PlanIconInput | SubtypeExprOrValue<OptionType<IconType>>;
}

/**
 * What `draw` gives for a decision diamond — `Plan.items(field, { at }, draw)`
 * on a span series' `decisions`.
 *
 * @property applied - `true` fills the diamond
 */
export interface PlanDecisionLook {
    /** `true` fills the diamond (◆ applied). */
    applied: SubtypeExprOrValue<BooleanType> | boolean;
}

/**
 * What `draw` gives for a port — `Plan.values(field, draw)` on a span series'
 * `ports`: a port has no id, so its instant is its key.
 *
 * @property label - The caption
 */
export interface PlanPortLook {
    /** The caption (`"−24 k sheets"`). */
    label?: PlanLookOption<StringType>;
}

/**
 * What `draw` gives for a bucket-row tile — `Plan.items(field, { at }, draw)`
 * on a bucket series' `events`: everything {@link Plan.event} takes but its
 * key and its instant.
 *
 * @property state - The lifecycle state
 * @property lane - The lane key
 * @property label - The tile text
 * @property icon - The leading glyph
 * @property tone - The semantic tint
 * @property color - A raw colour token
 * @property colorPalette - A brand palette
 * @property stretch - The fill axis
 * @property content - The content alignment
 * @property animation - The attention animation
 */
export interface PlanBucketEventLook {
    /** The lifecycle state. */
    state: SubtypeExprOrValue<EventStateType> | EventStateLiteral;
    /** The lane key. */
    lane?: PlanLookOption<StringType>;
    /** The tile text; omitted ⇒ ✓ or the dashed `plan` chip. */
    label?: PlanLookOption<StringType>;
    /** The leading glyph. */
    icon?: PlanIconInput | SubtypeExprOrValue<OptionType<IconType>>;
    /** The semantic tint. */
    tone?: PlanLookOption<StatusValueType, StatusValueLiteral>;
    /** A raw colour token (`"teal.solid"`). */
    color?: PlanLookOption<StringType>;
    /** A brand palette (`"teal"`). */
    colorPalette?: PlanLookOption<ColorSchemeType, ColorSchemeLiteral>;
    /** The fill axis. */
    stretch?: PlanLookOption<PlanStretchType, PlanStretchLiteral>;
    /** The two-axis content alignment, or an `Option` of one. */
    content?: PlanBucketEventInput["content"] | SubtypeExprOrValue<OptionType<PlanContentType>>;
    /** The attention animation. */
    animation?: PlanLookOption<PlanAnimationType, PlanAnimationLiteral>;
}

/**
 * What `draw` gives for a cell marker — `Plan.values(field, draw)` on a bucket
 * series' `markers`: a marker has no id, so its instant is its key.
 *
 * @property message - The hover text
 * @property lane - The lane key within the cell
 * @property status - The semantic status (default `"danger"`)
 */
export interface PlanCellMarkerLook {
    /** The hover-tooltip text. */
    message: SubtypeExprOrValue<StringType>;
    /** The lane key within the cell. */
    lane?: PlanLookOption<StringType>;
    /** The semantic status (default `"danger"`). */
    status?: SubtypeExprOrValue<StatusValueType> | StatusValueLiteral;
}

/**
 * What `draw` gives for a cards-row chip — `Plan.items(field, { from, to },
 * draw)` on a cards series' `chips`.
 *
 * @property label - The chip text
 * @property state - The lifecycle state
 * @property icon - The leading glyph
 */
export interface PlanChipLook {
    /** The chip text (`"80h"`). */
    label: SubtypeExprOrValue<StringType>;
    /** The lifecycle state. */
    state: SubtypeExprOrValue<EventStateType> | EventStateLiteral;
    /** The leading glyph. */
    icon?: PlanIconInput | SubtypeExprOrValue<OptionType<IconType>>;
}

/**
 * What `draw` gives for an event-row mark — `Plan.items(field, { at }, draw)`
 * on an events series' `marks`.
 *
 * @property kind - `"milestone"` / `"exception"` / `Plan.markKind.decision(applied)`
 * @property icon - A glyph swap
 * @property label - The caption
 */
export interface PlanEventMarkLook {
    /** The mark kind. */
    kind: SubtypeExprOrValue<PlanEventMarkKindType> | "milestone" | "exception";
    /** A glyph swap (still kind-coloured). */
    icon?: PlanIconInput | SubtypeExprOrValue<OptionType<IconType>>;
    /** The caption. */
    label?: PlanLookOption<StringType>;
}

/**
 * What `draw` gives for a heat cell — `Plan.heatCells(Plan.values(field,
 * draw))`.
 *
 * @property value - The value — `some(v)`, `none` for the no-data hatch, or a plain value
 * @property label - The cell's caption
 */
export interface PlanHeatCellLook {
    /** The value: `some(v)`, `none` for the no-data hatch, or a plain value. */
    value: PlanLookOption<FloatType, number>;
    /** The cell's caption. */
    label?: PlanLookOption<StringType>;
}

/**
 * What `draw` gives for a weight cell — `Plan.weightCells(Plan.values(field,
 * draw))`.
 *
 * @property fraction - The fraction of the bucket booked
 * @property planned - Whether it is planned (pale)
 */
export interface PlanWeightCellLook {
    /** The fraction of the bucket booked. */
    fraction: SubtypeExprOrValue<FloatType> | number;
    /** Whether it is planned (drawn pale). */
    planned: SubtypeExprOrValue<BooleanType> | boolean;
}

/**
 * What `draw` gives for a segment cell — `Plan.segmentCells(Plan.values(field,
 * draw))`.
 *
 * @property segments - The cell's segments (`Plan.segment` values)
 */
export interface PlanSegmentCellLook {
    /** The cell's segments (`Plan.segment` values). */
    segments: SubtypeExprOrValue<ArrayType<typeof PlanSegmentType>>;
}

/**
 * What `draw` gives for a table cell — `Plan.tableCells(Plan.values(field,
 * draw))`.
 *
 * @property value - The value — `some(v)`, `none` for the muted em-dash, or a plain value
 * @property text - Text printed in place of the value
 * @property tone - The cell's tone
 */
export interface PlanTableCellLook {
    /** The value: `some(v)`, `none` for the muted em-dash, or a plain value. */
    value: PlanLookOption<FloatType, number>;
    /** Text printed in place of the value. */
    text?: PlanLookOption<StringType>;
    /** The cell's tone (`"muted"`, `"neg"`). */
    tone?: PlanLookOption<PlanTableToneType, PlanTableToneLiteral>;
}

/**
 * What `draw` gives for a chart point — `Plan.line`, `Plan.area`,
 * `Plan.column` or `Plan.scatter` over `Plan.values(field, draw)`.
 *
 * @property y - The point's value
 */
export interface PlanChartPointLook {
    /** The point's value. */
    y: SubtypeExprOrValue<FloatType> | number;
}

/**
 * What `draw` gives for a band point — `Plan.band(Plan.values(field, draw))`.
 *
 * @property lo - The band's low edge
 * @property hi - The band's high edge
 */
export interface PlanChartBandLook {
    /** The band's low edge. */
    lo: SubtypeExprOrValue<FloatType> | number;
    /** The band's high edge. */
    hi: SubtypeExprOrValue<FloatType> | number;
}

/** Whether a look field is already an `Option`: a `some(…)` or `none` value, or an expression of an `Option` type. */
function isOptionLike(v: unknown): boolean {
    if (isVariant(v)) return v.type === "some" || v.type === "none";
    if (v instanceof Expr) {
        const t = Expr.type(v as Expr) as { type: string; cases?: Record<string, unknown> };
        if (t.type !== "Variant" || t.cases === undefined) return false;
        const names = Object.keys(t.cases);
        return names.length === 2 && names.includes("none") && names.includes("some");
    }
    return false;
}

/**
 * A look field its element holds as an `Option` (#1436): absent, `none`; an
 * `Option` as it is; anything else its value, resolved and wrapped.
 *
 * @param v - The field as `draw` (or a builder's input) gives it
 * @param type - The field's East type
 * @param resolve - Resolves a shorthand into a value of `type`
 * @returns The field as an `Option` expression
 */
function lookOption<T extends EastType>(v: unknown, type: T, resolve?: (v: never) => unknown): ExprType<OptionType<T>> {
    if (v === undefined) return East.value(none, OptionType(type)) as ExprType<OptionType<T>>;
    if (isOptionLike(v)) return East.value(v as SubtypeExprOrValue<OptionType<T>>, OptionType(type)) as ExprType<OptionType<T>>;
    const value = (resolve !== undefined ? resolve(v as never) : v) as SubtypeExprOrValue<T>;
    return East.value(some(value), OptionType(type)) as ExprType<OptionType<T>>;
}

/** A shorthand number as an East integer. */
const asInteger = (m: SubtypeExprOrValue<IntegerType> | number) => typeof m === "number" ? BigInt(m) : m;

/** A run's look, resolved into its fields (#1436) — shared by {@link Plan.run} and a read's `draw`. @internal */
export function runLookFields(look: PlanRunLook, where = "Plan.run icon") {
    return {
        label:    look.label,
        quantity: lookOption(look.quantity, PlanQuantityType),
        state:    resolvePlanEventState(look.state),
        status:   lookOption(look.status, StatusValueType, (s: StatusValueLiteral) => resolveTag(s, StatusValueType)),
        moved:    lookOption(look.moved, IntegerType, asInteger),
        icon:     lookOption(look.icon, IconType, (i: PlanIconInput) => resolveIcon(i, where)),
    };
}

/** A decision's look, resolved (#1436). @internal */
export function decisionLookFields(look: PlanDecisionLook) {
    return { applied: look.applied };
}

/** A port's look, resolved (#1436). @internal */
export function portLookFields(look: PlanPortLook) {
    return { label: lookOption(look.label, StringType) };
}

/** A tile's content alignment, resolved. */
function contentOf(content: PlanBucketEventInput["content"]): SubtypeExprOrValue<PlanContentType> {
    return East.value({
        horizontal: content!.horizontal !== undefined ? some(resolveTag(content!.horizontal, PlanContentAlignType)) : none,
        vertical:   content!.vertical !== undefined ? some(resolveTag(content!.vertical, PlanContentAlignType)) : none,
    }, PlanContentType);
}

/** A tile's look, resolved (#1436). @internal */
export function bucketEventLookFields(look: PlanBucketEventLook, where = "Plan.event icon") {
    return {
        lane:         lookOption(look.lane, StringType),
        label:        lookOption(look.label, StringType),
        icon:         lookOption(look.icon, IconType, (i: PlanIconInput) => resolveIcon(i, where)),
        state:        resolvePlanEventState(look.state),
        tone:         lookOption(look.tone, StatusValueType, (t: StatusValueLiteral) => resolveTag(t, StatusValueType)),
        color:        lookOption(look.color, StringType),
        colorPalette: lookOption(look.colorPalette, ColorSchemeType, (c: ColorSchemeLiteral) => resolveTag(c, ColorSchemeType)),
        stretch:      lookOption(look.stretch, PlanStretchType, (s: PlanStretchLiteral) => resolveTag(s, PlanStretchType)),
        content:      lookOption(look.content, PlanContentType, contentOf),
        animation:    lookOption(look.animation, PlanAnimationType, (a: PlanAnimationLiteral) => resolveTag(a, PlanAnimationType)),
    };
}

/** A marker's look, resolved (#1436). @internal */
export function cellMarkerLookFields(look: PlanCellMarkerLook) {
    return {
        lane:    lookOption(look.lane, StringType),
        status:  resolveTag(look.status ?? "danger", StatusValueType),
        message: look.message,
    };
}

/** A chip's look, resolved (#1436). @internal */
export function chipLookFields(look: PlanChipLook, where = "Plan.chip icon") {
    return {
        label: look.label,
        state: resolvePlanEventState(look.state),
        icon:  lookOption(look.icon, IconType, (i: PlanIconInput) => resolveIcon(i, where)),
    };
}

/** A mark's look, resolved (#1436). @internal */
export function eventMarkLookFields(look: PlanEventMarkLook, where = "Plan.mark icon") {
    return {
        kind:  typeof look.kind === "string" ? East.value(variant(look.kind, null), PlanEventMarkKindType) : look.kind,
        icon:  lookOption(look.icon, IconType, (i: PlanIconInput) => resolveIcon(i, where)),
        label: lookOption(look.label, StringType),
    };
}

/** A heat cell's look, resolved (#1436). @internal */
export function heatCellLookFields(look: PlanHeatCellLook) {
    return { value: lookOption(look.value, FloatType), label: lookOption(look.label, StringType) };
}

/** A weight cell's look, resolved (#1436). @internal */
export function weightCellLookFields(look: PlanWeightCellLook) {
    return { fraction: look.fraction, planned: look.planned };
}

/** A segment cell's look, resolved (#1436). @internal */
export function segmentCellLookFields(look: PlanSegmentCellLook) {
    return { segments: look.segments };
}

/** A table cell's look, resolved (#1436). @internal */
export function tableCellLookFields(look: PlanTableCellLook) {
    return {
        value: lookOption(look.value, FloatType),
        text:  lookOption(look.text, StringType),
        tone:  lookOption(look.tone, PlanTableToneType, (t: PlanTableToneLiteral) => resolveTag(t, PlanTableToneType)),
    };
}

/** A chart point's look, resolved (#1436). @internal */
export function chartPointLookFields(look: PlanChartPointLook) {
    return { y: look.y };
}

/** A band point's look, resolved (#1436). @internal */
export function chartBandLookFields(look: PlanChartBandLook) {
    return { lo: look.lo, hi: look.hi };
}

/**
 * What a named read completes (#1436): an element of a series' row or a cell
 * of a consumer, by its kind — its East type, its key field (a thing people
 * drag is keyed by its item's id; a value by nothing but its instant), its
 * instant fields, and how its look resolves.
 *
 * @internal
 */
export const PLAN_LOOKS = {
    run:      { type: PlanRunType,            key: "key", instants: ["start", "end"], look: runLookFields as (l: never) => object },
    decision: { type: PlanDecisionMarkType,   key: "key", instants: ["at"],           look: decisionLookFields as (l: never) => object },
    port:     { type: PlanPortType,           key: undefined, instants: ["at"],       look: portLookFields as (l: never) => object },
    event:    { type: PlanBucketEventType,    key: "key", instants: ["at"],           look: bucketEventLookFields as (l: never) => object },
    marker:   { type: PlanCellMarkerType,     key: undefined, instants: ["at"],       look: cellMarkerLookFields as (l: never) => object },
    chip:     { type: PlanChipType,           key: "key", instants: ["from", "to"],   look: chipLookFields as (l: never) => object },
    mark:     { type: PlanEventMarkType,      key: "key", instants: ["at"],           look: eventMarkLookFields as (l: never) => object },
    heat:     { type: PlanHeatCellType,       key: undefined, instants: ["at"],       look: heatCellLookFields as (l: never) => object },
    weight:   { type: PlanWeightCellType,     key: undefined, instants: ["at"],       look: weightCellLookFields as (l: never) => object },
    segment:  { type: PlanSegmentCellType,    key: undefined, instants: ["at"],       look: segmentCellLookFields as (l: never) => object },
    table:    { type: PlanTableCellType,      key: undefined, instants: ["at"],       look: tableCellLookFields as (l: never) => object },
    point:    { type: PlanChartPointType,     key: undefined, instants: ["t"],        look: chartPointLookFields as (l: never) => object },
    band:     { type: PlanChartBandPointType, key: undefined, instants: ["t"],        look: chartBandLookFields as (l: never) => object },
} as const;

/** What a named read completes. @internal */
export type PlanLookKind = keyof typeof PLAN_LOOKS;

// ============================================================================
// Value builders — runs, decisions, ports, events, markers, chips, marks
// ============================================================================

/**
 * Flat input for {@link Plan.run} — one continuous state-run bar.
 *
 * @typeParam S - The `start` input's type — its axis kind brands the result ({@link PlanKindOf})
 * @typeParam E - The `end` input's type
 * @property key - Stable run identity (drag refs, link edges)
 * @property start - Run start (inclusive) — an instant input (a Date / number / string, or a typed expression)
 * @property end - Run end (exclusive)
 * @property label - The bar text (`"RUN · J-4642"`)
 * @property quantity - Optional quantity (`Plan.quantity(96, { unit: "k sheets" })`) — printed after the label, summed into rollup bands per unit
 * @property state - The lifecycle state (string shorthand or `EventStateType`)
 * @property status - Optional status tint (`"warning"` ⇒ the over-dwell ring)
 * @property moved - Optional same-status churn counter (`moved ×k`)
 * @property icon - Optional leading FA glyph (10px, inherits bar text colour)
 */
export interface PlanRunInput<S extends PlanInstantInput = PlanInstantInput, E extends PlanInstantInput = PlanInstantInput> {
    /** Stable run identity (drag refs, link edges). */
    key: SubtypeExprOrValue<StringType>;
    /** Run start (inclusive) — wraps to the axis arm by its type (see {@link PlanInstantLikeType}). */
    start: S;
    /** Run end (exclusive). */
    end: E;
    /** The bar text (`"RUN · J-4642"`). */
    label: SubtypeExprOrValue<StringType>;
    /** Optional quantity — `Plan.quantity(96, { unit: "k sheets" })`: the bar prints its caption after the label
     *  (the muted `.q` text), and a parent's rollup band sums it with its siblings' in the same unit. */
    quantity?: SubtypeExprOrValue<PlanQuantityType>;
    /** The lifecycle state — a string shorthand or an `EventStateType` value. */
    state: SubtypeExprOrValue<EventStateType> | EventStateLiteral;
    /** Optional status tint — `"warning"` draws the `.stuck` over-dwell ring. */
    status?: SubtypeExprOrValue<StatusValueType> | StatusValueLiteral;
    /** Optional same-status churn counter (rendered `moved ×k`, never extra bars). */
    moved?: SubtypeExprOrValue<IntegerType> | number;
    /** Optional leading FA glyph (10px, inherits the bar text colour). */
    icon?: PlanIconInput;
}

/**
 * Builds one span run from a flat input. The result is BRANDED with the axis
 * kind `start` / `end` imply ({@link PlanKindOf}) — a `DateTimeType` accessor
 * makes a `"time"` run, a `FloatType` one a `"number"` run — so the series and
 * root can refuse a mismatched kind at compile time; an erased input (an
 * `Expr<PlanInstantType>`) leaves the run unbranded.
 *
 * @typeParam S - The `start` input's type
 * @typeParam E - The `end` input's type
 * @param input - The run configuration ({@link PlanRunInput})
 * @returns An East expression of {@link PlanRunType}, branded with its kind
 */
export function createRun<S extends PlanInstantInput, E extends PlanInstantInput>(
    input: PlanRunInput<S, E>,
): PlanRunExpr<PlanKindOf<S | E>> {
    return East.value({
        key:       input.key,
        start:     resolveInstant(input.start, "run start"),
        end:       resolveInstant(input.end, "run end"),
        ...runLookFields(input),
    }, PlanRunType) as PlanRunExpr<PlanKindOf<S | E>>;
}

/**
 * Flat input for {@link Plan.decision} — a ◇/◆ diamond on a run transition.
 *
 * @typeParam A - The `at` input's type — its axis kind brands the result
 * @property key - Stable decision identity
 * @property at - The transition instant the diamond sits on
 * @property applied - `true` fills the diamond (◆)
 */
export interface PlanDecisionInput<A extends PlanInstantInput = PlanInstantInput> {
    /** Stable decision identity. */
    key: SubtypeExprOrValue<StringType>;
    /** The transition instant the diamond sits on (see {@link PlanInstantLikeType}). */
    at: A;
    /** `true` fills the diamond (◆ applied). */
    applied: SubtypeExprOrValue<BooleanType> | boolean;
}

/**
 * Builds one decision mark from a flat input, branded with `at`'s kind.
 *
 * @typeParam A - The `at` input's type
 * @param input - The decision configuration ({@link PlanDecisionInput})
 * @returns An East expression of {@link PlanDecisionMarkType}, branded with its kind
 */
export function createDecision<A extends PlanInstantInput>(input: PlanDecisionInput<A>): PlanDecisionMarkExpr<PlanKindOf<A>> {
    return East.value({
        key:     input.key,
        at:      resolveInstant(input.at, "decision at"),
        ...decisionLookFields(input),
    }, PlanDecisionMarkType) as PlanDecisionMarkExpr<PlanKindOf<A>>;
}

/**
 * Flat input for {@link Plan.port} — a quantity in/out glyph on a span row.
 *
 * @typeParam A - The `at` input's type — its axis kind brands the result
 * @property at - The instant the quantity moves
 * @property label - Optional caption (`"−24 k sheets"`)
 */
export interface PlanPortInput<A extends PlanInstantInput = PlanInstantInput> {
    /** The instant the quantity moves (see {@link PlanInstantLikeType}). */
    at: A;
    /** Optional caption (`"−24 k sheets"`). */
    label?: SubtypeExprOrValue<StringType>;
}

/**
 * Builds one port glyph from a flat input, branded with `at`'s kind.
 *
 * @typeParam A - The `at` input's type
 * @param input - The port configuration ({@link PlanPortInput})
 * @returns An East expression of {@link PlanPortType}, branded with its kind
 */
export function createPort<A extends PlanInstantInput>(input: PlanPortInput<A>): PlanPortExpr<PlanKindOf<A>> {
    return East.value({
        at:    resolveInstant(input.at, "port at"),
        ...portLookFields(input),
    }, PlanPortType) as PlanPortExpr<PlanKindOf<A>>;
}

/**
 * Flat input for {@link Plan.event} — one bucket-row tile (the full Planner
 * point-event grammar).
 *
 * @typeParam A - The `at` input's type — its axis kind brands the result
 * @property key - Stable event identity (drag refs)
 * @property at - The bucket instant
 * @property lane - The lane key (`[]`-laned rows omit it; in a laned row, omitting takes the full cell)
 * @property label - Optional tile text; omitted ⇒ the resting ✓ / `plan` chip
 * @property icon - Optional leading FA glyph (icon-only tile when `label` omitted)
 * @property state - The lifecycle state (string shorthand or value)
 * @property tone - Optional semantic tile tint
 * @property color - Optional raw colour token override
 * @property colorPalette - Optional brand palette override
 * @property stretch - Optional fill axis (`"horizontal"` / `"vertical"` / `"both"`)
 * @property content - Optional two-axis content alignment
 * @property animation - Optional attention animation (`"pulse"`)
 */
export interface PlanBucketEventInput<A extends PlanInstantInput = PlanInstantInput> {
    /** Stable event identity (drag-grammar cell refs). */
    key: SubtypeExprOrValue<StringType>;
    /** The bucket instant (see {@link PlanInstantLikeType}). */
    at: A;
    /** The lane key. In a laned row, omitting takes the full cell (the mixed grammar). */
    lane?: SubtypeExprOrValue<StringType>;
    /** Optional tile text; omitted ⇒ ✓ (confirmed/actual) or the dashed `plan` chip (proposed). */
    label?: SubtypeExprOrValue<StringType>;
    /** Optional leading FA glyph (chip-sized, inherits chip colour; icon-only tile when `label` omitted). */
    icon?: PlanIconInput;
    /** The lifecycle state — a string shorthand or an `EventStateType` value. */
    state: SubtypeExprOrValue<EventStateType> | EventStateLiteral;
    /** Optional semantic tile tint (keeps the state's border-style). */
    tone?: SubtypeExprOrValue<StatusValueType> | StatusValueLiteral;
    /** Optional raw colour token override (`"teal.solid"`). */
    color?: SubtypeExprOrValue<StringType>;
    /** Optional brand palette override (`"teal"`, `"purple"`). */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Optional fill axis. */
    stretch?: SubtypeExprOrValue<PlanStretchType> | PlanStretchLiteral;
    /** Optional two-axis content alignment (defaults to top-left). */
    content?: {
        /** Horizontal content alignment (→ `justifyContent`). */
        horizontal?: SubtypeExprOrValue<PlanContentAlignType> | PlanContentAlignLiteral;
        /** Vertical content alignment (→ `alignItems`). */
        vertical?: SubtypeExprOrValue<PlanContentAlignType> | PlanContentAlignLiteral;
    };
    /** Optional attention animation (`"pulse"` honours `prefers-reduced-motion`). */
    animation?: SubtypeExprOrValue<PlanAnimationType> | PlanAnimationLiteral;
}

/**
 * Builds one bucket event from a flat input, branded with `at`'s kind.
 *
 * @typeParam A - The `at` input's type
 * @param input - The event configuration ({@link PlanBucketEventInput})
 * @returns An East expression of {@link PlanBucketEventType}, branded with its kind
 */
export function createBucketEvent<A extends PlanInstantInput>(input: PlanBucketEventInput<A>): PlanBucketEventExpr<PlanKindOf<A>> {
    return East.value({
        key:          input.key,
        at:           resolveInstant(input.at, "event at"),
        ...bucketEventLookFields(input),
    }, PlanBucketEventType) as PlanBucketEventExpr<PlanKindOf<A>>;
}

/**
 * Flat input for {@link Plan.lane} — one bucket-row sub-slot lane.
 *
 * @property key - The lane key (`"am"`) — bucket events reference it via `lane`
 * @property label - Optional printed caption (`"AM"`); omitted ⇒ an unlabelled strip
 */
export interface PlanLaneInput {
    /** The lane key (`"am"`) — bucket events reference it via `lane`. */
    key: SubtypeExprOrValue<StringType>;
    /** Optional printed caption (`"AM"`); omitted ⇒ an unlabelled strip. */
    label?: SubtypeExprOrValue<StringType>;
}

/**
 * Builds one bucket-row lane from a flat input.
 *
 * @param input - The lane configuration ({@link PlanLaneInput})
 * @returns An East expression of {@link PlanLaneType}
 */
export function createLane(input: PlanLaneInput): ExprType<PlanLaneType> {
    return East.value({
        key:   input.key,
        label: input.label !== undefined ? some(input.label) : none,
    }, PlanLaneType);
}

/**
 * A row's id by its series and path — `Plan.ref("press-jobs", "H1", "p03")`
 * is the row series `press-jobs` made from entry `p03` under `H1` (#822).
 * What `links` name their ends with, and what a callback's row compares to.
 *
 * @remarks
 * A segment is an entry's key as the canvas prints it: a String key as is, any
 * other key type as its `.east` text (`printFor`), an `Array` child's index as
 * its digits.
 *
 * @param series - The series key
 * @param path - The entry keys that lead to the row, outermost first
 * @returns The `entry` id
 */
export function createRef(
    series: SubtypeExprOrValue<StringType>,
    ...path: SubtypeExprOrValue<StringType>[]
): ExprType<PlanRowIdType> {
    return East.value(variant("entry", { series, path }), PlanRowIdType);
}

/**
 * A section header's id — `Plan.sectionRef("crew-block", "H1")` is the
 * `crew-block` section's header under entry `H1`; a top-level section's path
 * is empty (#822).
 *
 * @param series - The section's series key
 * @param path - The path of the entry the section sits under (empty at the top level)
 * @returns The `section` id
 */
export function createSectionRef(
    series: SubtypeExprOrValue<StringType>,
    ...path: SubtypeExprOrValue<StringType>[]
): ExprType<PlanRowIdType> {
    return East.value(variant("section", { series, path }), PlanRowIdType);
}

/**
 * What a bound `ui` state starts as — see {@link Plan.uiState}.
 *
 * @property selected - The selected row
 * @property collapsed - Rows folded against what they declare
 * @property expanded - Rows opened against what they declare
 * @property charts - Chart rows expanded from spark
 * @property focus - A row to bring into view (a request the canvas spends)
 */
export interface PlanUiStateInput {
    /** The selected row. */
    selected?: SubtypeExprOrValue<PlanRowIdType>;
    /** Rows folded — overriding what they declare. */
    collapsed?: SubtypeExprOrValue<PlanRowIdType>[] | SubtypeExprOrValue<ArrayType<PlanRowIdType>>;
    /** Rows opened — overriding what they declare. */
    expanded?: SubtypeExprOrValue<PlanRowIdType>[] | SubtypeExprOrValue<ArrayType<PlanRowIdType>>;
    /** Chart rows expanded from spark to full height. */
    charts?: SubtypeExprOrValue<PlanRowIdType>[] | SubtypeExprOrValue<ArrayType<PlanRowIdType>>;
    /** A row to bring into view — the canvas spends the request (`none`) once it has. */
    focus?: SubtypeExprOrValue<PlanRowIdType>;
}

/**
 * Builds a {@link PlanUiStateType} value — the seed of a bound `ui` state
 * (`State.bind([Plan.Types.UiState], key, Plan.uiState())`, #824). Omitted
 * fields are empty: nothing selected, every row as it declares, no chart
 * expanded, nothing to bring into view.
 *
 * @param init - What the state starts as ({@link PlanUiStateInput})
 * @returns An East expression of {@link PlanUiStateType}
 */
export function createUiState(init?: PlanUiStateInput): ExprType<PlanUiStateType> {
    const ids = (list: PlanUiStateInput["collapsed"]) =>
        East.value((list ?? []) as SubtypeExprOrValue<ArrayType<PlanRowIdType>>, ArrayType(PlanRowIdType));
    return East.value({
        selected:  init?.selected !== undefined ? some(East.value(init.selected, PlanRowIdType)) : none,
        collapsed: ids(init?.collapsed),
        expanded:  ids(init?.expanded),
        charts:    ids(init?.charts),
        focus:     init?.focus !== undefined ? some(East.value(init.focus, PlanRowIdType)) : none,
    }, PlanUiStateType);
}

/**
 * Flat input for {@link Plan.link} — one run-edge quantity link of the
 * canvas's link graph (a Plan's `links`). Each end is a row and a run on it
 * (`from` and `fromRun`), or an event of one of the Plan's event kinds
 * (`from: Plan.eventRef("job", key)`, no run), wherever it draws (#1191).
 *
 * @property key - The link's identity — what a click on its ribbon names it by (#824)
 * @property from - The source row's id (`Plan.ref(series, …path)`), or an event (`Plan.eventRef(kind, key)`)
 * @property fromRun - The source run key (the ribbon leaves this run's end edge); none with an event
 * @property to - The destination row's id, or an event
 * @property toRun - The destination run key (the ribbon lands on this run's start edge); none with an event
 * @property quantity - The moved quantity (`Plan.quantity(34, { unit: "k sheets" })`) — the link's weight and caption
 */
export interface PlanLinkInput {
    /** The link's identity — what the `link` element ref a ribbon click reports names it by (#824). */
    key: SubtypeExprOrValue<StringType>;
    /** The source row's id (`Plan.ref(series, …path)`), or an event (`Plan.eventRef(kind, key)`). */
    from: SubtypeExprOrValue<PlanRowIdType> | ExprType<PlanRunRefType>;
    /** The source run key (the ribbon leaves this run's end edge) — with a row's id; an event names its own. */
    fromRun?: SubtypeExprOrValue<StringType>;
    /** The destination row's id, or an event. */
    to: SubtypeExprOrValue<PlanRowIdType> | ExprType<PlanRunRefType>;
    /** The destination run key (the ribbon lands on this run's start edge) — with a row's id; an event names its own. */
    toRun?: SubtypeExprOrValue<StringType>;
    /** The moved quantity — `Plan.quantity(34, { unit: "k sheets" })`: its value's third of the family's largest
     *  sets the link's weight (2, 4 or 8), and its caption prints on the link, on a paper knockout. Omit ⇒ the
     *  thinnest link (1.5), no caption. */
    quantity?: SubtypeExprOrValue<PlanQuantityType>;
}

/**
 * The event kinds each link `Plan.link` built names at its ends — none for a
 * link between rows — by the value it returned (#1191). A link whose event end
 * was held in a variable is not recorded: its kind is not known here.
 */
const LINK_EVENT_KINDS = new WeakMap<object, readonly string[]>();

/**
 * The event kinds a link names at its ends, when they are known at build —
 * what a Plan checks against its `events` (#1191).
 *
 * @param link - A link value
 * @returns The kinds its event ends name, in order — none for a link between rows; `undefined` for a link
 *   `Plan.link` did not build here (held in a variable, or built in East) or whose event end was held in a
 *   variable, which a Plan checks as it is evaluated instead
 * @internal
 */
export function linkEventKinds(link: unknown): readonly string[] | undefined {
    return typeof link === "object" && link !== null ? LINK_EVENT_KINDS.get(link) : undefined;
}

/**
 * Whether a link end is an event (`Plan.eventRef`'s run ref, a struct) rather
 * than a row's id (a variant).
 *
 * @param end - The end
 * @returns `true` for an event
 */
function isEventEnd(end: PlanLinkInput["from"]): boolean {
    return end instanceof Expr && (Expr.type(end as Expr) as { type: string }).type === "Struct";
}

/**
 * One link end on the wire: a row's id with its run, or an event's ref as it is.
 *
 * @param end - The end — a row's id, or an event (`Plan.eventRef`)
 * @param run - The run on the row
 * @param name - `"from"` or `"to"`, for the message
 * @returns The run ref
 * @throws {Error} When a row's end has no run, or an event's end names one
 */
function linkEnd(end: PlanLinkInput["from"], run: PlanLinkInput["fromRun"], name: "from" | "to"): SubtypeExprOrValue<PlanRunRefType> {
    if (isEventEnd(end)) {
        if (run !== undefined) {
            throw new Error(`Plan.link: \`${name}\` is an event, which names its own run — leave out \`${name}Run\``);
        }
        return end as ExprType<PlanRunRefType>;
    }
    if (run === undefined) {
        throw new Error(`Plan.link: \`${name}\` is a row's id — name the run on it with \`${name}Run\`, or name an event with Plan.eventRef(kind, key)`);
    }
    return { row: end as SubtypeExprOrValue<PlanRowIdType>, run };
}

/**
 * Builds one link edge from a flat input. Links are root DATA
 * (`links={transfers.map(($, t) => Plan.link({ … }))}`): the links-focus
 * control gathers a row's transitive upstream/downstream family over them.
 *
 * @param input - The link configuration ({@link PlanLinkInput})
 * @returns An East expression of {@link PlanLinkType}
 * @throws {Error} When an end is a row's id without its run, or an event with one
 */
export function createLink(input: PlanLinkInput): ExprType<PlanLinkType> {
    const link = East.value({
        key:      input.key,
        from:     linkEnd(input.from, input.fromRun, "from"),
        to:       linkEnd(input.to, input.toRun, "to"),
        quantity: input.quantity !== undefined ? some(East.value(input.quantity, PlanQuantityType)) : none,
    }, PlanLinkType);
    // The kinds its event ends name, when each is `Plan.eventRef`'s own value.
    const kinds = [input.from, input.to].filter(isEventEnd).map(eventRefKind);
    if (kinds.every((k) => k !== undefined)) LINK_EVENT_KINDS.set(link, kinds as string[]);
    return link;
}

/**
 * Flat input for {@link Plan.marker} — a bucket-cell status ring.
 *
 * @typeParam A - The `at` input's type — its axis kind brands the result
 * @property at - The bucket instant the marker rings
 * @property lane - The lane key within the cell
 * @property status - The semantic status (default `"danger"`)
 * @property message - The hover-tooltip text
 */
export interface PlanCellMarkerInput<A extends PlanInstantInput = PlanInstantInput> {
    /** The bucket instant the marker rings (see {@link PlanInstantLikeType}). */
    at: A;
    /** The lane key within the cell. */
    lane?: SubtypeExprOrValue<StringType>;
    /** The semantic status (default `"danger"`). */
    status?: SubtypeExprOrValue<StatusValueType> | StatusValueLiteral;
    /** The hover-tooltip text. */
    message: SubtypeExprOrValue<StringType>;
}

/**
 * Builds one cell marker from a flat input, branded with `at`'s kind.
 *
 * @typeParam A - The `at` input's type
 * @param input - The marker configuration ({@link PlanCellMarkerInput})
 * @returns An East expression of {@link PlanCellMarkerType}, branded with its kind
 */
export function createCellMarker<A extends PlanInstantInput>(input: PlanCellMarkerInput<A>): PlanCellMarkerExpr<PlanKindOf<A>> {
    return East.value({
        at:      resolveInstant(input.at, "marker at"),
        ...cellMarkerLookFields(input),
    }, PlanCellMarkerType) as PlanCellMarkerExpr<PlanKindOf<A>>;
}

/**
 * Flat input for {@link Plan.chip} — one cards-row shift chip.
 *
 * @typeParam F - The `from` input's type — its axis kind brands the result
 * @typeParam T - The `to` input's type
 * @property key - Stable chip identity
 * @property from - Chip start (inclusive)
 * @property to - Chip end (exclusive)
 * @property label - The chip text (`"80h"`, `"+64h"`)
 * @property state - The lifecycle state (string shorthand or value)
 * @property icon - Optional leading FA glyph
 */
export interface PlanChipInput<F extends PlanInstantInput = PlanInstantInput, T extends PlanInstantInput = PlanInstantInput> {
    /** Stable chip identity (drag refs). */
    key: SubtypeExprOrValue<StringType>;
    /** Chip start (inclusive) — see {@link PlanInstantLikeType}. */
    from: F;
    /** Chip end (exclusive). */
    to: T;
    /** The chip text (`"80h"`, `"+64h"`). */
    label: SubtypeExprOrValue<StringType>;
    /** The lifecycle state — confirmed tint · proposed dashed · removed strikethrough · estimated ghost. */
    state: SubtypeExprOrValue<EventStateType> | EventStateLiteral;
    /** Optional leading FA glyph (shift-type etc.). */
    icon?: PlanIconInput;
}

/**
 * Builds one cards chip from a flat input, branded with the kind `from` /
 * `to` imply.
 *
 * @typeParam F - The `from` input's type
 * @typeParam T - The `to` input's type
 * @param input - The chip configuration ({@link PlanChipInput})
 * @returns An East expression of {@link PlanChipType}, branded with its kind
 */
export function createChip<F extends PlanInstantInput, T extends PlanInstantInput>(
    input: PlanChipInput<F, T>,
): PlanChipExpr<PlanKindOf<F | T>> {
    return East.value({
        key:     input.key,
        from:    resolveInstant(input.from, "chip from"),
        to:      resolveInstant(input.to, "chip to"),
        ...chipLookFields(input),
    }, PlanChipType) as PlanChipExpr<PlanKindOf<F | T>>;
}

/**
 * Flat input for {@link Plan.mark} — one event-row instant mark.
 *
 * @typeParam A - The `at` input's type — its axis kind brands the result
 * @property key - Stable mark identity
 * @property at - The instant
 * @property kind - `"milestone"` / `"exception"` / `Plan.markKind.decision(applied)`
 * @property icon - Optional FA glyph swap (12px, kind-coloured)
 * @property label - Optional caption (printed when there is room)
 */
export interface PlanEventMarkInput<A extends PlanInstantInput = PlanInstantInput> {
    /** Stable mark identity. */
    key: SubtypeExprOrValue<StringType>;
    /** The instant (see {@link PlanInstantLikeType}). */
    at: A;
    /** The mark kind — `"milestone"` / `"exception"` string shorthand or a `PlanEventMarkKindType` value (see `Plan.markKind`). */
    kind: SubtypeExprOrValue<PlanEventMarkKindType> | "milestone" | "exception";
    /** Optional FA glyph swap (12px, still kind-coloured). */
    icon?: PlanIconInput;
    /** Optional caption (printed when there is room). */
    label?: SubtypeExprOrValue<StringType>;
}

/**
 * Builds one event mark from a flat input, branded with `at`'s kind.
 *
 * @typeParam A - The `at` input's type
 * @param input - The mark configuration ({@link PlanEventMarkInput})
 * @returns An East expression of {@link PlanEventMarkType}, branded with its kind
 */
export function createEventMark<A extends PlanInstantInput>(input: PlanEventMarkInput<A>): PlanEventMarkExpr<PlanKindOf<A>> {
    return East.value({
        key:     input.key,
        at:      resolveInstant(input.at, "mark at"),
        ...eventMarkLookFields(input),
    }, PlanEventMarkType) as PlanEventMarkExpr<PlanKindOf<A>>;
}

/** The `Plan.markKind` builders — non-null mark kinds. */
export const markKind = {
    /**
     * A decision diamond mark — ◇ pending / ◆ applied.
     *
     * @param applied - `true` fills the diamond
     * @returns A `PlanEventMarkKindType` expression with the `decision` arm
     */
    decision: (applied: SubtypeExprOrValue<BooleanType> | boolean): ExprType<PlanEventMarkKindType> =>
        East.value(variant("decision", { applied }), PlanEventMarkKindType),
} as const;

// ============================================================================
// Cell builders — heat / weight / segments / table
// ============================================================================

/**
 * The fold an options object declares, as its literal type, else the default
 * (#1436) — what a consumer of a values read brands its subtotals with. A fold
 * given as an East value names none the types can see.
 *
 * @typeParam O - The options, as written
 * @typeParam D - The consumer's default fold
 */
export type PlanFoldOf<O, D extends PlanFoldLiteral> = O extends { readonly fold: infer F } ? (F extends PlanFoldLiteral ? F : D) : D;

/** The fold a builder's options declare, as its literal where it is one (#1436). */
function foldLiteral(fold: PlanFoldInput | undefined, fallback: PlanFoldLiteral): PlanFoldLiteral | undefined {
    if (fold === undefined) return fallback;
    if (typeof fold === "string") return fold;
    return isVariant(fold) ? fold.type as PlanFoldLiteral : undefined;
}

/**
 * The values read a cell builder is given, if it is given one (#1436).
 *
 * @param x - The builder's cells argument
 * @param where - The builder, for the message
 * @returns The read, or `undefined` for cells given as cells
 * @throws {Error} When it is a read of items, which draws elements, not cells
 */
function valuesReadOf(x: unknown, where: string): PlanValuesReadSpec | undefined {
    const read = planReadOf(x);
    if (read === undefined) return undefined;
    if (read.kind !== "values") {
        throw new Error(
            `${where} takes a row's values: read "${read.field}" with Plan.values("${read.field}", draw) — Plan.items ` +
            "reads things people drag, for a series' runs, decisions, events, chips or marks");
    }
    return read;
}

/**
 * A heat scale — the value at no depth, the value at full depth, and the warn
 * threshold ({@link PlanHeatScaleType}).
 *
 * @property min - The value painted at no depth (default: the least shown)
 * @property max - The value painted at full depth (default: the greatest shown)
 * @property warnAt - Warn-ring threshold (≥ it rings the cell)
 */
export interface PlanHeatScaleInput {
    /** The value painted at no depth (default: the least value shown). */
    min?: SubtypeExprOrValue<FloatType> | number;
    /** The value painted at full depth (default: the greatest value shown). */
    max?: SubtypeExprOrValue<FloatType> | number;
    /** Warn-ring threshold (≥ it rings the cell). */
    warnAt?: SubtypeExprOrValue<FloatType> | number;
}

/**
 * Build a heat scale value from its input.
 *
 * @param input - The scale ({@link PlanHeatScaleInput}); omit ⇒ every bound from the values shown
 * @returns An East expression of {@link PlanHeatScaleType}
 */
export function createHeatScale(input?: PlanHeatScaleInput): ExprType<PlanHeatScaleType> {
    return East.value({
        min:    input?.min !== undefined ? some(input.min) : none,
        max:    input?.max !== undefined ? some(input.max) : none,
        warnAt: input?.warnAt !== undefined ? some(input.warnAt) : none,
    }, PlanHeatScaleType);
}

/**
 * How a cells arm folds and prints (#824) — the options every cell builder
 * takes.
 *
 * @property fold - How a bucket folds the cells that fall in it at a coarser resolution than theirs
 * @property format - How the arm's values print (a `Format.*` spec)
 */
export interface PlanCellsFoldOptions {
    /** How a bucket folds the cells that fall in it at a coarser resolution than theirs
     *  (`"sum"` / `"mean"` / `"min"` / `"max"` / `"last"` / `"count"`; each builder says its default). */
    fold?: PlanFoldInput;
    /** How the arm's values print — a `Format.*` spec (the shared `TickFormatType`), in the viewer's locale. */
    format?: SubtypeExprOrValue<TickFormatType>;
}

/**
 * Options for {@link Plan.heatCells} — the heat scale, the warn threshold, and
 * how the cells fold and print.
 *
 * @property min - Scale minimum (default: the least shown)
 * @property max - Scale maximum (default: the greatest shown)
 * @property warnAt - Warn-ring threshold (≥ it rings the cell)
 * @property fold - How a bucket folds its cells (default `"mean"`)
 * @property format - How a value prints — a cell without a `label` prints its value only when one is declared
 */
export interface PlanHeatCellsOptions extends PlanHeatScaleInput, PlanCellsFoldOptions {}

/** The declared `format`, as the arm's option. */
function formatOpt(format: SubtypeExprOrValue<TickFormatType> | undefined): ExprType<OptionType<TickFormatType>> {
    return format !== undefined
        ? East.value(some(East.value(format, TickFormatType)), OptionType(TickFormatType))
        : East.value(none, OptionType(TickFormatType));
}

/**
 * Wraps per-bucket heat cells into the `heat` arm of {@link PlanHeatCellsType}.
 * Literal records whose `at` is a `Plan.at.*` value brand the result with
 * that kind ({@link PlanCellsInput}); an East array is kind-erased.
 *
 * @remarks
 * At a coarser resolution than the cells', a bucket shows ONE cell — the
 * `fold` of the cells in it (`"mean"` by default: a heat cell is a level).
 * A cell prints its `label`; one without prints its value only through a
 * declared `format` (#824).
 *
 * @typeParam K - The kind inferred from the literal records' `at`
 * @param cells - The cells (`{ at, value, label }` structs; `value: none` ⇒ the no-data hatch)
 * @param options - Scale, warn threshold, fold and format ({@link PlanHeatCellsOptions})
 * @returns A `PlanHeatCellsType` expression, branded with the cells' kind
 */
export function createHeatCells<R extends EastType, K extends PlanAxisKindLiteral, U, const O extends PlanHeatCellsOptions = PlanHeatCellsOptions>(
    values: PlanValuesInput<R, PlanHeatCellLook, K, U>,
    options?: O,
): PlanValuesUse<"heat", R, K, U, PlanFoldOf<O, "mean">>;
export function createHeatCells<K extends PlanAxisKindLiteral = never>(
    cells: PlanCellsInput<PlanHeatCellType, K>,
    options?: PlanHeatCellsOptions,
): PlanHeatCellsExpr<K>;
export function createHeatCells(cells: unknown, options?: PlanHeatCellsOptions): unknown {
    const read = valuesReadOf(cells, "Plan.heatCells");
    if (read !== undefined) {
        return planUse({
            makes: "heat", read, cell: "heat", fold: foldLiteral(options?.fold, "mean"), rollup: false,
            wrap: (built) => createHeatCells(built as ExprType<ArrayType<PlanHeatCellType>>, options),
        });
    }
    return East.value(variant("heat", {
        cells:  East.value(cells as SubtypeExprOrValue<ArrayType<PlanHeatCellType>>, ArrayType(PlanHeatCellType)),
        scale:  createHeatScale(options),
        fold:   resolveFold(options?.fold, "mean"),
        format: formatOpt(options?.format),
    }), PlanHeatCellsType);
}

/**
 * Wraps per-bucket weight cells into the `weight` arm of
 * {@link PlanHeatCellsType} (booked-vs-free bars; planned ⇒ pale). Literal
 * records with `Plan.at.*` instants brand the result with their kind.
 *
 * @remarks
 * At a coarser resolution, a bucket shows ONE bar — the `fold` of its cells'
 * fractions (`"mean"` by default: a cell is the fraction of its bucket booked,
 * and a month's fraction is its weeks' mean), pale only when every cell in it
 * is planned. `format` prints the fraction in the words a reader hears
 * (default: a percent).
 *
 * @typeParam K - The kind inferred from the literal records' `at`
 * @param cells - The cells (`{ at, fraction, planned }` structs)
 * @param options - Fold and format ({@link PlanCellsFoldOptions})
 * @returns A `PlanHeatCellsType` expression, branded with the cells' kind
 */
export function createWeightCells<R extends EastType, K extends PlanAxisKindLiteral, U, const O extends PlanCellsFoldOptions = PlanCellsFoldOptions>(
    values: PlanValuesInput<R, PlanWeightCellLook, K, U>,
    options?: O,
): PlanValuesUse<"heat", R, K, U, PlanFoldOf<O, "mean">>;
export function createWeightCells<K extends PlanAxisKindLiteral = never>(
    cells: PlanCellsInput<PlanWeightCellType, K>,
    options?: PlanCellsFoldOptions,
): PlanHeatCellsExpr<K>;
export function createWeightCells(cells: unknown, options?: PlanCellsFoldOptions): unknown {
    const read = valuesReadOf(cells, "Plan.weightCells");
    if (read !== undefined) {
        return planUse({
            makes: "heat", read, cell: "weight", fold: foldLiteral(options?.fold, "mean"), rollup: false,
            wrap: (built) => createWeightCells(built as ExprType<ArrayType<PlanWeightCellType>>, options),
        });
    }
    return East.value(variant("weight", {
        cells:  East.value(cells as SubtypeExprOrValue<ArrayType<PlanWeightCellType>>, ArrayType(PlanWeightCellType)),
        fold:   resolveFold(options?.fold, "mean"),
        format: formatOpt(options?.format),
    }), PlanHeatCellsType);
}

/**
 * Wraps per-bucket segment cells into the `segments` arm of
 * {@link PlanHeatCellsType} (committed / pending / slack compositions).
 * Literal records with `Plan.at.*` instants brand the result with their kind.
 *
 * @remarks
 * At a coarser resolution, a bucket shows ONE composition — each fill's
 * weights folded across the cells in it (`"sum"` by default: the weights are
 * amounts, and the bar normalises them). `format` prints a segment's share in
 * the words a reader hears (default: a percent).
 *
 * @typeParam K - The kind inferred from the literal records' `at`
 * @param cells - The cells (`{ at, segments }` structs — build segments with `Plan.segment`)
 * @param options - Fold and format ({@link PlanCellsFoldOptions})
 * @returns A `PlanHeatCellsType` expression, branded with the cells' kind
 */
export function createSegmentCells<R extends EastType, K extends PlanAxisKindLiteral, U, const O extends PlanCellsFoldOptions = PlanCellsFoldOptions>(
    values: PlanValuesInput<R, PlanSegmentCellLook, K, U>,
    options?: O,
): PlanValuesUse<"heat", R, K, U, PlanFoldOf<O, "sum">>;
export function createSegmentCells<K extends PlanAxisKindLiteral = never>(
    cells: PlanCellsInput<PlanSegmentCellType, K>,
    options?: PlanCellsFoldOptions,
): PlanHeatCellsExpr<K>;
export function createSegmentCells(cells: unknown, options?: PlanCellsFoldOptions): unknown {
    const read = valuesReadOf(cells, "Plan.segmentCells");
    if (read !== undefined) {
        return planUse({
            makes: "heat", read, cell: "segment", fold: foldLiteral(options?.fold, "sum"), rollup: false,
            wrap: (built) => createSegmentCells(built as ExprType<ArrayType<PlanSegmentCellType>>, options),
        });
    }
    return East.value(variant("segments", {
        cells:  East.value(cells as SubtypeExprOrValue<ArrayType<PlanSegmentCellType>>, ArrayType(PlanSegmentCellType)),
        fold:   resolveFold(options?.fold, "sum"),
        format: formatOpt(options?.format),
    }), PlanHeatCellsType);
}

/**
 * Flat input for {@link Plan.segment} — one weighted slice of a segment cell.
 *
 * @property fill - The status-leveraged fill (string shorthand or `MatrixFillType`)
 * @property weight - The proportional weight
 * @property label - Optional in-bar text (printed when wide enough)
 */
export interface PlanSegmentInput {
    /** The status-leveraged fill. */
    fill: SubtypeExprOrValue<MatrixFillType> | MatrixFillLiteral;
    /** The proportional weight (normalised with siblings). */
    weight: SubtypeExprOrValue<FloatType> | number;
    /** Optional in-bar text (printed when the segment is wide enough). */
    label?: SubtypeExprOrValue<StringType>;
}

/**
 * Builds one segment from a flat input (the Matrix segment vocabulary).
 *
 * @param input - The segment configuration ({@link PlanSegmentInput})
 * @returns An East expression of {@link PlanSegmentType}
 */
export function createSegment(input: PlanSegmentInput): ExprType<typeof PlanSegmentType> {
    return East.value({
        fill:   resolveTag(input.fill, MatrixFillType),
        weight: input.weight,
        label:  input.label !== undefined ? some(input.label) : none,
    }, PlanSegmentType);
}

/**
 * Flat input for {@link Plan.tableSeries} — one value series of a
 * multi-series table row. Style is declared ONCE here, per position (never
 * per cell — the wire-lean contract); the cells stay raw values.
 *
 * @typeParam K - The cells' axis kind (a `Plan.tableCells` result carries it)
 * @property cells - The series' cells (a `Plan.tableCells` result / `PlanTableCellType` values)
 * @property format - Numeral format override for this series (else the row's `format`)
 * @property tone - Default tone for the series' values (`"muted"` de-emphasises a plan column)
 * @property strong - Semibold emphasis for this series' values
 * @property rollup - `true` ⇒ this series feeds declared parent aggregation (flag none ⇒ every series does)
 * @property fold - How a bucket folds this series' cells at a coarser resolution (default `"sum"`)
 */
export interface PlanTableSeriesInput<K extends PlanAxisKindLiteral = never> {
    /** The series' cells (a `Plan.tableCells` result / `PlanTableCellType` values). */
    cells: PlanTableCellsInput<K>;
    /** Numeral format override for THIS series — a `Format.*` spec (else the row's `format`). */
    format?: SubtypeExprOrValue<TickFormatType>;
    /** Default tone for the series' values; per-cell tones and the derived neg/em-dash win. */
    tone?: SubtypeExprOrValue<PlanTableToneType> | PlanTableToneLiteral;
    /** Semibold emphasis for this series' values (default `false`). */
    strong?: SubtypeExprOrValue<BooleanType> | boolean;
    /** `true` ⇒ this series feeds declared parent aggregation (default `false` — flag none and every series does). */
    rollup?: SubtypeExprOrValue<BooleanType> | boolean;
    /** How a bucket folds this series' cells at a coarser resolution than theirs (default `"sum"`, #824). */
    fold?: PlanFoldInput;
}

/**
 * Input for {@link Plan.tableSeries} over a values read (#1436) — one position
 * of a table row, its cells a row's values (`Plan.tableCells(Plan.values(field,
 * draw))`). Its `fold` and `rollup` are literals, since a parent's subtotal of
 * them is what a source's index keeps (#1435).
 *
 * @typeParam R - The entry type
 * @typeParam K - The cells' axis kind
 * @typeParam U - What the cells read
 * @typeParam FO - How a bucket folds the position's values
 * @typeParam RO - Whether the position feeds its parent's subtotal
 * @property cells - The position's cells, from a values read
 * @property format - Numeral format override for this position
 * @property tone - Default tone for its values
 * @property strong - Semibold emphasis for its values
 * @property rollup - `true` ⇒ it feeds the parent's subtotal (flag none ⇒ every position does)
 * @property fold - How a bucket folds its values at a coarser resolution (default `"sum"`)
 * @property edit - `true` ⇒ its values take typed numbers, each drawn as stored (#1436)
 */
export interface PlanTableSeriesOfValues<R extends EastType, K extends PlanAxisKindLiteral, U, FO extends PlanFoldLiteral, RO extends boolean> {
    /** The position's cells — `Plan.tableCells(Plan.values(field, draw))`. */
    cells: PlanValuesUse<"tableCells", R, K, U>;
    /** Numeral format override for this position — a `Format.*` spec. */
    format?: SubtypeExprOrValue<TickFormatType>;
    /** Default tone for its values. */
    tone?: SubtypeExprOrValue<PlanTableToneType> | PlanTableToneLiteral;
    /** Semibold emphasis for its values. */
    strong?: SubtypeExprOrValue<BooleanType> | boolean;
    /** `true` ⇒ it feeds the parent's subtotal (flag none and every position does). */
    rollup?: RO;
    /** How a bucket folds its values at a coarser resolution than theirs (default `"sum"`). */
    fold?: FO;
    /** `true` ⇒ a number typed into one of its cells is written as the value at the bucket's start (#1436) — its cells' draw giving each value as stored, `value: some(v)`. */
    edit?: PlanValuesEdit;
}

/**
 * Builds one table-row value series (see {@link Plan.table}'s `series`) —
 * per-position style declared once, raw cells beneath it; the result carries
 * the cells' axis kind.
 *
 * @typeParam K - The cells' axis kind
 * @param input - The series configuration ({@link PlanTableSeriesInput})
 * @returns An East expression of {@link PlanTableSeriesType}, branded with the cells' kind
 */
export function createTableSeries<
    R extends EastType, K extends PlanAxisKindLiteral, U,
    const FO extends PlanFoldLiteral = "sum", const RO extends boolean = false,
>(input: PlanTableSeriesOfValues<R, K, U, FO, RO>): PlanValuesUse<"tableSeries", R, K, U, FO, RO>;
export function createTableSeries<K extends PlanAxisKindLiteral = never>(input: PlanTableSeriesInput<K>): PlanTableSeriesExpr<K>;
export function createTableSeries(input: PlanTableSeriesInput<PlanAxisKindLiteral> | PlanTableSeriesOfValues<EastType, PlanAxisKindLiteral, unknown, PlanFoldLiteral, boolean>): unknown {
    const use = planUseOf(input.cells);
    if (use !== undefined) {
        if (use.makes !== "tableCells") {
            throw new Error("Plan.tableSeries: its cells are one row's table cells — give cells as Plan.tableCells(Plan.values(field, draw))");
        }
        const { edit, ...rest } = input as PlanTableSeriesOfValues<EastType, PlanAxisKindLiteral, unknown, PlanFoldLiteral, boolean>;
        if (edit !== undefined && edit !== true) {
            throw new Error("Plan.tableSeries: edit is true — its values take typed numbers — or left out");
        }
        return planUse({
            makes: "tableSeries", read: use.read, cell: "table", fold: foldLiteral(rest.fold, "sum"),
            rollup: rest.rollup === true, edit: edit === true,
            wrap: (built) => createTableSeries({ ...(rest as unknown as PlanTableSeriesInput<PlanAxisKindLiteral>), cells: built as ExprType<ArrayType<PlanTableCellType>> }),
        });
    }
    if ("edit" in input) {
        throw new Error("Plan.tableSeries: edit writes the values its cells read — give cells as Plan.tableCells(Plan.values(field, draw))");
    }
    refuseReadOutsideSeries(input.cells);
    return East.value({
        cells:  East.value(input.cells as SubtypeExprOrValue<ArrayType<PlanTableCellType>>, ArrayType(PlanTableCellType)),
        format: input.format !== undefined ? some(East.value(input.format, TickFormatType)) : none,
        tone:   input.tone !== undefined ? some(resolveTag(input.tone, PlanTableToneType)) : none,
        strong: input.strong ?? false,
        rollup: input.rollup ?? false,
        fold:   resolveFold(input.fold, "sum"),
    }, PlanTableSeriesType);
}

/**
 * The raw table-cell record — `{ at, value }`, its `at` any
 * {@link PlanInstantLikeType} (wrapped to the axis arm by its static type).
 */
export type PlanRawTableCellType = StructType<{ at: PlanInstantLikeType; value: OptionType<FloatType> }>;

/**
 * Builds per-bucket table cells from raw values. The RENDERER prints each
 * value through the row's `format` (a `Format.*` spec — the shared
 * `TickFormatType`), tones negatives `neg` and renders `none` as the muted
 * em-dash; build `PlanTableCellType` values directly for explicit `text` /
 * `tone` overrides.
 *
 * @remarks
 * The `at` of each raw cell wraps to the axis arm by its type — a
 * `DateTimeType` field to `time`, a numeric field to `number`, a string
 * field to `ordinal`, a {@link PlanInstantType} field as is — so a
 * `{ at: DateTimeType, value }` dataset keeps compiling unchanged.
 *
 * Literal records brand the result with the kind their `at` implies
 * ({@link PlanKindOf}); an East array is kind-erased.
 *
 * @typeParam A - The literal records' `at` type
 * @param cells - The raw cells (`{ at, value }` records; `value` an `Option<Float>`)
 * @returns An `ArrayType(PlanTableCellType)` expression, branded with the cells' kind
 * @throws {Error} If an East array's element `at` is not an instant-typed field
 */
export function createTableCells<R extends EastType, K extends PlanAxisKindLiteral, U>(
    values: PlanValuesInput<R, PlanTableCellLook, K, U>,
): PlanValuesUse<"tableCells", R, K, U>;
export function createTableCells<A extends PlanInstantInput = never>(
    cells:
        | { at: A; value: SubtypeExprOrValue<OptionType<FloatType>> }[]
        | SubtypeExprOrValue<ArrayType<PlanRawTableCellType>>,
): PlanTableCellsExpr<PlanKindOf<A>>;
export function createTableCells(
    cells:
        | { at: PlanInstantInput; value: SubtypeExprOrValue<OptionType<FloatType>> }[]
        | SubtypeExprOrValue<ArrayType<PlanRawTableCellType>>
        | PlanValuesInput<EastType, PlanTableCellLook, PlanAxisKindLiteral, unknown>,
): unknown {
    const read = valuesReadOf(cells, "Plan.tableCells");
    if (read !== undefined) {
        return planUse({ makes: "tableCells", read, cell: "table", fold: undefined, rollup: false, wrap: (built) => built });
    }
    if (Array.isArray(cells)) {
        // Each element is a literal record or a struct expression; both
        // expose `at` / `value` (a struct expression's field accessors carry
        // the field's static type, which is what `resolveInstant` reads).
        const built = cells.map((c) => {
            const rec = c as { at: SubtypeExprOrValue<PlanInstantLikeType>; value: SubtypeExprOrValue<OptionType<FloatType>> };
            return East.value({
                at:    resolveInstant(rec.at, "tableCells at"),
                value: East.value(rec.value, OptionType(FloatType)),
                text:  none,
                tone:  none,
            }, PlanTableCellType);
        });
        return East.value(built, ArrayType(PlanTableCellType));
    }
    // An East array — wrap `at` by its STATIC element type, once for the map.
    const raw = cells as unknown as ExprType<ArrayType<StructType<{ at: EastType; value: OptionType<FloatType> }>>>;
    const elem = (Expr.type(raw) as ArrayType<StructType<{ at: EastType; value: OptionType<FloatType> }>>).value;
    const atTag = ((elem as unknown as { fields: { at: { type: string } } }).fields.at).type;
    const wrap = (v: ExprType<EastType>): ExprType<PlanInstantType> => {
        switch (atTag) {
            case "DateTime": return East.value(variant("time", v as ExprType<DateTimeType>), PlanInstantType);
            case "Float":    return East.value(variant("number", v as ExprType<FloatType>), PlanInstantType);
            case "Integer":  return East.value(variant("number", (v as ExprType<IntegerType>).toFloat()), PlanInstantType);
            case "String":   return East.value(variant("ordinal", v as ExprType<StringType>), PlanInstantType);
            case "Variant":  return East.value(v as unknown as ExprType<PlanInstantType>, PlanInstantType);
            default:
                throw new Error(
                    "Plan.tableCells: each cell's `at` must be an instant-typed field (DateTime / Float / " +
                    `Integer / String / Plan.Types.Instant) — got ${atTag}`);
        }
    };
    return raw.map((_$, c) => East.value({
        at:    wrap((c as unknown as { at: ExprType<EastType> }).at),
        value: (c as unknown as { value: ExprType<OptionType<FloatType>> }).value,
        text:  none,
        tone:  none,
    }, PlanTableCellType));
}
