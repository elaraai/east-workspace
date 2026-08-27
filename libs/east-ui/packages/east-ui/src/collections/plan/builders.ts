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

import { TickFormatType } from "../../format/types.js";
import { IconType, type IconName } from "../../display/icon/types.js";
import { StatusValueType, type StatusValueLiteral } from "../../feedback/status/types.js";
import { ColorSchemeType, type ColorSchemeLiteral } from "../../style/scheme.js";
import { EventStateType, type EventStateLiteral } from "../../contracts/states.js";
import { TimeResolutionType } from "../../contracts/time.js";
import { type MatrixFillLiteral, MatrixFillType } from "../matrix/types.js";
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
    PlanRunType,
    PlanDecisionMarkType,
    PlanBucketEventType,
    PlanChipType,
    PlanEventMarkType,
    PlanLaneType,
    PlanRowsCollectionType,
    type PlanRowsValue,
} from "./types.js";

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

/** Resolve a null-payload variant string shorthand against its East type. */
export function resolveTag<T extends EastType>(v: SubtypeExprOrValue<NoInfer<T>> | string, type: T): ExprType<T> {
    const value = typeof v === "string" ? (variant(v, null) as unknown) : (v as unknown);
    return East.value(value as SubtypeExprOrValue<T>, type) as ExprType<T>;
}

/**
 * An icon input — a bare Font Awesome solid name (`"rocket"`), a
 * `{ prefix, name }` pair, or an `IconType` expression (the Banner envelope
 * precedent). The mounting context pins size and colour; hosts choose the
 * glyph, never the geometry.
 */
export type PlanIconInput = IconName | { prefix: string; name: string } | SubtypeExprOrValue<IconType>;

/** Resolve a {@link PlanIconInput} into an `IconType` value. */
export function resolveIcon(icon: PlanIconInput): SubtypeExprOrValue<IconType> {
    if (typeof icon === "string") {
        return East.value({ prefix: "fas", name: icon, label: none, style: none }, IconType);
    }
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

/** An empty flattened-subtree value — the keyed collection with no rows. */
export function emptyRows(): PlanRowsValue {
    return East.value(new Map(), PlanRowsCollectionType);
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
 * Builds the `time` axis declaration — `Plan.axis({ … })` / `Plan.axis.time`.
 *
 * @param options - Window, resolution(s), now instant and tick format ({@link PlanAxisOptions})
 * @returns An East expression of {@link PlanAxisType} (the `time` arm), branded `"time"` — the root's canvas kind
 *
 * @remarks
 * The window is half-open `[min, max)` in UTC; omit it to follow the bound
 * slice's datetime range (else fit to the data). `resolutions` lists the
 * WEEK/DAY-style segment options (omit ⇒ no segment). When the Plan is
 * slice-bound, slice state supersedes window + resolution after mount — the
 * slice is the single source of truth.
 */
export function createTimeAxis(options: PlanAxisOptions): PlanAxisExpr<"time"> {
    return East.value(variant("time", {
        window: options.window !== undefined
            ? some({ min: options.window.min, max: options.window.max })
            : none,
        resolution:  resolveTag(options.resolution, TimeResolutionType),
        resolutions: (options.resolutions ?? []).map(r => resolveTag(r, TimeResolutionType)),
        now:         options.now !== undefined ? some(options.now) : none,
        format:      options.format !== undefined ? some(options.format) : none,
    }), PlanAxisType) as PlanAxisExpr<"time">;
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
 * bound slice's `float` / `integer` range (else fit to the data). Element
 * instants on this canvas are numbers — a `FloatType` / `IntegerType`
 * accessor or a bare number wraps to the `number` arm.
 */
export function createNumberAxis(options: PlanNumberAxisOptions): PlanAxisExpr<"number"> {
    if (typeof options.step === "number" && !(options.step > 0)) {
        throw new Error(`Plan.axis.number: \`step\` must be > 0 (got ${options.step}) — it is the bucket width`);
    }
    return East.value(variant("number", {
        window: options.window !== undefined
            ? some({ min: options.window.min, max: options.window.max })
            : none,
        step:   options.step,
        now:    options.now !== undefined ? some(options.now) : none,
        format: options.format !== undefined ? some(options.format) : none,
    }), PlanAxisType) as PlanAxisExpr<"number">;
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
    return East.value(variant("ordinal", {
        values: East.value(options.values as SubtypeExprOrValue<ArrayType<StringType>>, ArrayType(StringType)),
        now:    options.now !== undefined ? some(options.now) : none,
    }), PlanAxisType) as PlanAxisExpr<"ordinal">;
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
 * @property label - The bar text (`"RUN · B-214"`)
 * @property quantity - Optional displayed quantity suffix (`"96 t"`)
 * @property qty - Optional numeric quantity (summed into rollup bands)
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
    /** The bar text (`"RUN · B-214"`). */
    label: SubtypeExprOrValue<StringType>;
    /** Optional displayed quantity suffix (`"96 t"` — the muted `.q` text). */
    quantity?: SubtypeExprOrValue<StringType>;
    /** Optional numeric quantity — summed into parent rollup bands (pair with the span factory's `unit`). */
    qty?: SubtypeExprOrValue<FloatType>;
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
        label:     input.label,
        quantity:  input.quantity !== undefined ? some(input.quantity) : none,
        qty:       input.qty !== undefined ? some(input.qty) : none,
        state:     resolvePlanEventState(input.state),
        status:    input.status !== undefined ? some(resolveTag(input.status, StatusValueType)) : none,
        moved:     input.moved !== undefined ? some(typeof input.moved === "number" ? BigInt(input.moved) : input.moved) : none,
        icon:      input.icon !== undefined ? some(resolveIcon(input.icon)) : none,
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
        applied: input.applied,
    }, PlanDecisionMarkType) as PlanDecisionMarkExpr<PlanKindOf<A>>;
}

/**
 * Flat input for {@link Plan.port} — a quantity in/out glyph on a span row.
 *
 * @typeParam A - The `at` input's type — its axis kind brands the result
 * @property at - The instant the quantity moves
 * @property label - Optional caption (`"−24 t"`)
 */
export interface PlanPortInput<A extends PlanInstantInput = PlanInstantInput> {
    /** The instant the quantity moves (see {@link PlanInstantLikeType}). */
    at: A;
    /** Optional caption (`"−24 t"`). */
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
        label: input.label !== undefined ? some(input.label) : none,
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
    const content = input.content !== undefined
        ? some(East.value({
            horizontal: input.content.horizontal !== undefined ? some(resolveTag(input.content.horizontal, PlanContentAlignType)) : none,
            vertical:   input.content.vertical !== undefined ? some(resolveTag(input.content.vertical, PlanContentAlignType)) : none,
        }, PlanContentType))
        : none;
    return East.value({
        key:          input.key,
        at:           resolveInstant(input.at, "event at"),
        lane:         input.lane !== undefined ? some(input.lane) : none,
        label:        input.label !== undefined ? some(input.label) : none,
        icon:         input.icon !== undefined ? some(resolveIcon(input.icon)) : none,
        state:        resolvePlanEventState(input.state),
        tone:         input.tone !== undefined ? some(resolveTag(input.tone, StatusValueType)) : none,
        color:        input.color !== undefined ? some(input.color) : none,
        colorPalette: input.colorPalette !== undefined ? some(resolveTag(input.colorPalette, ColorSchemeType)) : none,
        stretch:      input.stretch !== undefined ? some(resolveTag(input.stretch, PlanStretchType)) : none,
        content,
        animation:    input.animation !== undefined ? some(resolveTag(input.animation, PlanAnimationType)) : none,
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
 * Flat input for {@link Plan.link} — one run-edge quantity link of the
 * canvas's link graph (`Plan.Root`'s `links`).
 *
 * @property from - The source row key
 * @property fromRun - The source run key (the ribbon leaves this run's end edge)
 * @property to - The destination row key
 * @property toRun - The destination run key (the ribbon lands on this run's start edge)
 * @property quantity - The moved quantity (drives ribbon share + opacity)
 * @property label - The printed quantity caption (`"34 t"`)
 */
export interface PlanLinkInput {
    /** The source row key. */
    from: SubtypeExprOrValue<StringType>;
    /** The source run key (the ribbon leaves this run's end edge). */
    fromRun: SubtypeExprOrValue<StringType>;
    /** The destination row key. */
    to: SubtypeExprOrValue<StringType>;
    /** The destination run key (the ribbon lands on this run's start edge). */
    toRun: SubtypeExprOrValue<StringType>;
    /** The moved quantity (drives ribbon share + opacity). */
    quantity: SubtypeExprOrValue<FloatType> | number;
    /** The printed quantity caption (`"34 t"`). */
    label: SubtypeExprOrValue<StringType>;
}

/**
 * Builds one link edge from a flat input. Links are root DATA
 * (`links={transfers.map(($, t) => Plan.link({ … }))}`): the links-focus
 * control gathers a row's transitive upstream/downstream family over them.
 *
 * @param input - The link configuration ({@link PlanLinkInput})
 * @returns An East expression of {@link PlanLinkType}
 */
export function createLink(input: PlanLinkInput): ExprType<PlanLinkType> {
    return East.value({
        fromRow:  input.from,
        fromRun:  input.fromRun,
        toRow:    input.to,
        toRun:    input.toRun,
        quantity: input.quantity,
        label:    input.label,
    }, PlanLinkType);
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
        lane:    input.lane !== undefined ? some(input.lane) : none,
        status:  resolveTag(input.status ?? "danger", StatusValueType),
        message: input.message,
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
        label:   input.label,
        state:   resolvePlanEventState(input.state),
        icon:    input.icon !== undefined ? some(resolveIcon(input.icon)) : none,
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
        kind:    typeof input.kind === "string" ? East.value(variant(input.kind, null), PlanEventMarkKindType) : input.kind,
        icon:    input.icon !== undefined ? some(resolveIcon(input.icon)) : none,
        label:   input.label !== undefined ? some(input.label) : none,
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
 * Options for {@link Plan.heatCells} — the heat scale + warn threshold.
 *
 * @property min - Scale minimum (default: observed)
 * @property max - Scale maximum (default: observed)
 * @property warnAt - Warn-ring threshold (≥ it rings the cell)
 */
export interface PlanHeatCellsOptions {
    /** Scale minimum (default: the observed extent). */
    min?: SubtypeExprOrValue<FloatType> | number;
    /** Scale maximum (default: the observed extent). */
    max?: SubtypeExprOrValue<FloatType> | number;
    /** Warn-ring threshold (≥ it rings the cell). */
    warnAt?: SubtypeExprOrValue<FloatType> | number;
}

/**
 * Wraps per-bucket heat cells into the `heat` arm of {@link PlanHeatCellsType}.
 * Literal records whose `at` is a `Plan.at.*` value brand the result with
 * that kind ({@link PlanCellsInput}); an East array is kind-erased.
 *
 * @typeParam K - The kind inferred from the literal records' `at`
 * @param cells - The cells (`{ at, value, label }` structs; `value: none` ⇒ the no-data hatch)
 * @param options - Scale + warn threshold ({@link PlanHeatCellsOptions})
 * @returns A `PlanHeatCellsType` expression, branded with the cells' kind
 */
export function createHeatCells<K extends PlanAxisKindLiteral = never>(
    cells: PlanCellsInput<PlanHeatCellType, K>,
    options?: PlanHeatCellsOptions,
): PlanHeatCellsExpr<K> {
    return East.value(variant("heat", {
        cells:  East.value(cells as SubtypeExprOrValue<ArrayType<PlanHeatCellType>>, ArrayType(PlanHeatCellType)),
        min:    options?.min !== undefined ? some(options.min) : none,
        max:    options?.max !== undefined ? some(options.max) : none,
        warnAt: options?.warnAt !== undefined ? some(options.warnAt) : none,
    }), PlanHeatCellsType) as PlanHeatCellsExpr<K>;
}

/**
 * Wraps per-bucket weight cells into the `weight` arm of
 * {@link PlanHeatCellsType} (booked-vs-free bars; planned ⇒ pale). Literal
 * records with `Plan.at.*` instants brand the result with their kind.
 *
 * @typeParam K - The kind inferred from the literal records' `at`
 * @param cells - The cells (`{ at, fraction, planned }` structs)
 * @returns A `PlanHeatCellsType` expression, branded with the cells' kind
 */
export function createWeightCells<K extends PlanAxisKindLiteral = never>(
    cells: PlanCellsInput<PlanWeightCellType, K>,
): PlanHeatCellsExpr<K> {
    return East.value(variant("weight", East.value(cells as SubtypeExprOrValue<ArrayType<PlanWeightCellType>>, ArrayType(PlanWeightCellType))), PlanHeatCellsType) as PlanHeatCellsExpr<K>;
}

/**
 * Wraps per-bucket segment cells into the `segments` arm of
 * {@link PlanHeatCellsType} (committed / pending / slack compositions).
 * Literal records with `Plan.at.*` instants brand the result with their kind.
 *
 * @typeParam K - The kind inferred from the literal records' `at`
 * @param cells - The cells (`{ at, segments }` structs — build segments with `Plan.segment`)
 * @returns A `PlanHeatCellsType` expression, branded with the cells' kind
 */
export function createSegmentCells<K extends PlanAxisKindLiteral = never>(
    cells: PlanCellsInput<PlanSegmentCellType, K>,
): PlanHeatCellsExpr<K> {
    return East.value(variant("segments", East.value(cells as SubtypeExprOrValue<ArrayType<PlanSegmentCellType>>, ArrayType(PlanSegmentCellType))), PlanHeatCellsType) as PlanHeatCellsExpr<K>;
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
 * @property rollup - `true` ⇒ this series feeds declared parent aggregation (default: the first)
 */
export interface PlanTableSeriesInput<K extends PlanAxisKindLiteral = never> {
    /** The series' cells (a `Plan.tableCells` result / `PlanTableCellType` values). */
    cells: PlanTableCellsInput<K>;
    /** Numeral format override for THIS series — a `Format.*` spec (else the row's `format`). */
    format?: SubtypeExprOrValue<TickFormatType>;
    /** Default tone for the series' values; per-cell tones and the derived neg/em-dash win. */
    tone?: SubtypeExprOrValue<PlanTableToneType> | PlanTableToneLiteral;
    /** Semibold emphasis for this series' values. */
    strong?: SubtypeExprOrValue<BooleanType> | boolean;
    /** `true` ⇒ this series feeds declared parent aggregation (default: the first series). */
    rollup?: SubtypeExprOrValue<BooleanType> | boolean;
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
export function createTableSeries<K extends PlanAxisKindLiteral = never>(input: PlanTableSeriesInput<K>): PlanTableSeriesExpr<K> {
    return East.value({
        cells:  East.value(input.cells as SubtypeExprOrValue<ArrayType<PlanTableCellType>>, ArrayType(PlanTableCellType)),
        format: input.format !== undefined ? some(East.value(input.format, TickFormatType)) : none,
        tone:   input.tone !== undefined ? some(resolveTag(input.tone, PlanTableToneType)) : none,
        strong: input.strong !== undefined ? some(input.strong) : none,
        rollup: input.rollup !== undefined ? some(input.rollup) : none,
    }, PlanTableSeriesType) as PlanTableSeriesExpr<K>;
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
export function createTableCells<A extends PlanInstantInput = never>(
    cells:
        | { at: A; value: SubtypeExprOrValue<OptionType<FloatType>> }[]
        | SubtypeExprOrValue<ArrayType<PlanRawTableCellType>>,
): PlanTableCellsExpr<PlanKindOf<A>> {
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
        return East.value(built, ArrayType(PlanTableCellType)) as PlanTableCellsExpr<PlanKindOf<A>>;
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
    }, PlanTableCellType)) as unknown as PlanTableCellsExpr<PlanKindOf<A>>;
}
