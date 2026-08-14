/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Plan value builders — shorthand resolvers, the axis declaration, element
 * value builders (`Plan.run` / `decision` / `port` / `event` / `marker` /
 * `chip` / `mark`), cell builders (`heatCells` / `weightCells` /
 * `segmentCells` / `tableCells`) and the Chart-layer consumption that turns
 * `Chart.*` builder results into data-only `PlanChartLayerType` values.
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
    PlanRowType,
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

/** An empty flattened-subtree value. */
export function emptyRows(): PlanRowsValue {
    return East.value([], ArrayType(PlanRowType));
}

// ============================================================================
// Axis
// ============================================================================

/**
 * Builds the shared time-axis declaration.
 *
 * @param options - Window, resolution(s), now instant and tick format ({@link PlanAxisOptions})
 * @returns An East expression of {@link PlanAxisType}
 *
 * @remarks
 * The window is half-open `[min, max)` in UTC; omit it to follow the bound
 * slice's datetime range (else fit to the data). `resolutions` lists the
 * WEEK/DAY-style segment options (omit ⇒ no segment). When the Plan is
 * slice-bound, slice state supersedes window + resolution after mount — the
 * slice is the single source of truth.
 */
export function createAxis(options: PlanAxisOptions): ExprType<PlanAxisType> {
    return East.value({
        window: options.window !== undefined
            ? some({ min: options.window.min, max: options.window.max })
            : none,
        resolution:  resolveTag(options.resolution, TimeResolutionType),
        resolutions: (options.resolutions ?? []).map(r => resolveTag(r, TimeResolutionType)),
        now:         options.now !== undefined ? some(options.now) : none,
        format:      options.format !== undefined ? some(options.format) : none,
    }, PlanAxisType);
}

// ============================================================================
// Value builders — runs, decisions, ports, events, markers, chips, marks
// ============================================================================

/**
 * Flat input for {@link Plan.run} — one continuous state-run bar.
 *
 * @property key - Stable run identity (drag refs, journey ribbons)
 * @property start - Run start (inclusive)
 * @property end - Run end (exclusive)
 * @property label - The bar text (`"RUN · B-214"`)
 * @property quantity - Optional displayed quantity suffix (`"96 t"`)
 * @property qty - Optional numeric quantity (summed into rollup bands)
 * @property state - The lifecycle state (string shorthand or `EventStateType`)
 * @property status - Optional status tint (`"warning"` ⇒ the over-dwell ring)
 * @property moved - Optional same-status churn counter (`moved ×k`)
 * @property icon - Optional leading FA glyph (10px, inherits bar text colour)
 */
export interface PlanRunInput {
    /** Stable run identity (drag refs, journey ribbons). */
    key: SubtypeExprOrValue<StringType>;
    /** Run start (inclusive). */
    start: SubtypeExprOrValue<DateTimeType>;
    /** Run end (exclusive). */
    end: SubtypeExprOrValue<DateTimeType>;
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
 * Builds one span run from a flat input.
 *
 * @param input - The run configuration ({@link PlanRunInput})
 * @returns An East expression of {@link PlanRunType}
 */
export function createRun(input: PlanRunInput): ExprType<PlanRunType> {
    return East.value({
        key:       input.key,
        start:     input.start,
        end:       input.end,
        label:     input.label,
        quantity:  input.quantity !== undefined ? some(input.quantity) : none,
        qty:       input.qty !== undefined ? some(input.qty) : none,
        state:     resolvePlanEventState(input.state),
        status:    input.status !== undefined ? some(resolveTag(input.status, StatusValueType)) : none,
        moved:     input.moved !== undefined ? some(typeof input.moved === "number" ? BigInt(input.moved) : input.moved) : none,
        icon:      input.icon !== undefined ? some(resolveIcon(input.icon)) : none,
    }, PlanRunType);
}

/**
 * Flat input for {@link Plan.decision} — a ◇/◆ diamond on a run transition.
 *
 * @property key - Stable decision identity
 * @property at - The transition instant the diamond sits on
 * @property applied - `true` fills the diamond (◆)
 */
export interface PlanDecisionInput {
    /** Stable decision identity. */
    key: SubtypeExprOrValue<StringType>;
    /** The transition instant the diamond sits on. */
    at: SubtypeExprOrValue<DateTimeType>;
    /** `true` fills the diamond (◆ applied). */
    applied: SubtypeExprOrValue<BooleanType> | boolean;
}

/**
 * Builds one decision mark from a flat input.
 *
 * @param input - The decision configuration ({@link PlanDecisionInput})
 * @returns An East expression of {@link PlanDecisionMarkType}
 */
export function createDecision(input: PlanDecisionInput): ExprType<PlanDecisionMarkType> {
    return East.value({
        key:     input.key,
        at:      input.at,
        applied: input.applied,
    }, PlanDecisionMarkType);
}

/**
 * Flat input for {@link Plan.port} — a quantity in/out glyph on a span row.
 *
 * @property at - The instant the quantity moves
 * @property label - Optional caption (`"−24 t"`)
 */
export interface PlanPortInput {
    /** The instant the quantity moves. */
    at: SubtypeExprOrValue<DateTimeType>;
    /** Optional caption (`"−24 t"`). */
    label?: SubtypeExprOrValue<StringType>;
}

/**
 * Builds one port glyph from a flat input.
 *
 * @param input - The port configuration ({@link PlanPortInput})
 * @returns An East expression of {@link PlanPortType}
 */
export function createPort(input: PlanPortInput): ExprType<typeof PlanPortType> {
    return East.value({
        at:    input.at,
        label: input.label !== undefined ? some(input.label) : none,
    }, PlanPortType);
}

/**
 * Flat input for {@link Plan.event} — one bucket-row tile (the full Planner
 * point-event grammar).
 *
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
export interface PlanBucketEventInput {
    /** Stable event identity (drag-grammar cell refs). */
    key: SubtypeExprOrValue<StringType>;
    /** The bucket instant. */
    at: SubtypeExprOrValue<DateTimeType>;
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
 * Builds one bucket event from a flat input.
 *
 * @param input - The event configuration ({@link PlanBucketEventInput})
 * @returns An East expression of {@link PlanBucketEventType}
 */
export function createBucketEvent(input: PlanBucketEventInput): ExprType<PlanBucketEventType> {
    const content = input.content !== undefined
        ? some(East.value({
            horizontal: input.content.horizontal !== undefined ? some(resolveTag(input.content.horizontal, PlanContentAlignType)) : none,
            vertical:   input.content.vertical !== undefined ? some(resolveTag(input.content.vertical, PlanContentAlignType)) : none,
        }, PlanContentType))
        : none;
    return East.value({
        key:          input.key,
        at:           input.at,
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
    }, PlanBucketEventType);
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
 * control gathers a row's transitive upstream/downstream family over them,
 * and the K8 journey overlay shares the same edge shape.
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
 * @property at - The bucket instant the marker rings
 * @property lane - The lane key within the cell
 * @property status - The semantic status (default `"danger"`)
 * @property message - The hover-tooltip text
 */
export interface PlanCellMarkerInput {
    /** The bucket instant the marker rings. */
    at: SubtypeExprOrValue<DateTimeType>;
    /** The lane key within the cell. */
    lane?: SubtypeExprOrValue<StringType>;
    /** The semantic status (default `"danger"`). */
    status?: SubtypeExprOrValue<StatusValueType> | StatusValueLiteral;
    /** The hover-tooltip text. */
    message: SubtypeExprOrValue<StringType>;
}

/**
 * Builds one cell marker from a flat input.
 *
 * @param input - The marker configuration ({@link PlanCellMarkerInput})
 * @returns An East expression of {@link PlanCellMarkerType}
 */
export function createCellMarker(input: PlanCellMarkerInput): ExprType<typeof PlanCellMarkerType> {
    return East.value({
        at:      input.at,
        lane:    input.lane !== undefined ? some(input.lane) : none,
        status:  resolveTag(input.status ?? "danger", StatusValueType),
        message: input.message,
    }, PlanCellMarkerType);
}

/**
 * Flat input for {@link Plan.chip} — one cards-row shift chip.
 *
 * @property key - Stable chip identity
 * @property from - Chip start (inclusive)
 * @property to - Chip end (exclusive)
 * @property label - The chip text (`"80h"`, `"+64h"`)
 * @property state - The lifecycle state (string shorthand or value)
 * @property icon - Optional leading FA glyph
 */
export interface PlanChipInput {
    /** Stable chip identity (drag refs). */
    key: SubtypeExprOrValue<StringType>;
    /** Chip start (inclusive). */
    from: SubtypeExprOrValue<DateTimeType>;
    /** Chip end (exclusive). */
    to: SubtypeExprOrValue<DateTimeType>;
    /** The chip text (`"80h"`, `"+64h"`). */
    label: SubtypeExprOrValue<StringType>;
    /** The lifecycle state — confirmed tint · proposed dashed · removed strikethrough · estimated ghost. */
    state: SubtypeExprOrValue<EventStateType> | EventStateLiteral;
    /** Optional leading FA glyph (shift-type etc.). */
    icon?: PlanIconInput;
}

/**
 * Builds one cards chip from a flat input.
 *
 * @param input - The chip configuration ({@link PlanChipInput})
 * @returns An East expression of {@link PlanChipType}
 */
export function createChip(input: PlanChipInput): ExprType<PlanChipType> {
    return East.value({
        key:     input.key,
        from:    input.from,
        to:      input.to,
        label:   input.label,
        state:   resolvePlanEventState(input.state),
        icon:    input.icon !== undefined ? some(resolveIcon(input.icon)) : none,
    }, PlanChipType);
}

/**
 * Flat input for {@link Plan.mark} — one event-row instant mark.
 *
 * @property key - Stable mark identity
 * @property at - The instant
 * @property kind - `"milestone"` / `"exception"` / `Plan.markKind.decision(applied)`
 * @property icon - Optional FA glyph swap (12px, kind-coloured)
 * @property label - Optional caption (printed when there is room)
 */
export interface PlanEventMarkInput {
    /** Stable mark identity. */
    key: SubtypeExprOrValue<StringType>;
    /** The instant. */
    at: SubtypeExprOrValue<DateTimeType>;
    /** The mark kind — `"milestone"` / `"exception"` string shorthand or a `PlanEventMarkKindType` value (see `Plan.markKind`). */
    kind: SubtypeExprOrValue<PlanEventMarkKindType> | "milestone" | "exception";
    /** Optional FA glyph swap (12px, still kind-coloured). */
    icon?: PlanIconInput;
    /** Optional caption (printed when there is room). */
    label?: SubtypeExprOrValue<StringType>;
}

/**
 * Builds one event mark from a flat input.
 *
 * @param input - The mark configuration ({@link PlanEventMarkInput})
 * @returns An East expression of {@link PlanEventMarkType}
 */
export function createEventMark(input: PlanEventMarkInput): ExprType<PlanEventMarkType> {
    return East.value({
        key:     input.key,
        at:      input.at,
        kind:    typeof input.kind === "string" ? East.value(variant(input.kind, null), PlanEventMarkKindType) : input.kind,
        icon:    input.icon !== undefined ? some(resolveIcon(input.icon)) : none,
        label:   input.label !== undefined ? some(input.label) : none,
    }, PlanEventMarkType);
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
 *
 * @param cells - The cells (`{ at, value, label }` structs; `value: none` ⇒ the no-data hatch)
 * @param options - Scale + warn threshold ({@link PlanHeatCellsOptions})
 * @returns A `PlanHeatCellsType` expression
 */
export function createHeatCells(
    cells: SubtypeExprOrValue<ArrayType<PlanHeatCellType>>,
    options?: PlanHeatCellsOptions,
): ExprType<PlanHeatCellsType> {
    return East.value(variant("heat", {
        cells:  East.value(cells, ArrayType(PlanHeatCellType)),
        min:    options?.min !== undefined ? some(options.min) : none,
        max:    options?.max !== undefined ? some(options.max) : none,
        warnAt: options?.warnAt !== undefined ? some(options.warnAt) : none,
    }), PlanHeatCellsType);
}

/**
 * Wraps per-bucket weight cells into the `weight` arm of
 * {@link PlanHeatCellsType} (booked-vs-free bars; planned ⇒ pale).
 *
 * @param cells - The cells (`{ at, fraction, planned }` structs)
 * @returns A `PlanHeatCellsType` expression
 */
export function createWeightCells(
    cells: SubtypeExprOrValue<ArrayType<PlanWeightCellType>>,
): ExprType<PlanHeatCellsType> {
    return East.value(variant("weight", East.value(cells, ArrayType(PlanWeightCellType))), PlanHeatCellsType);
}

/**
 * Wraps per-bucket segment cells into the `segments` arm of
 * {@link PlanHeatCellsType} (committed / pending / slack compositions).
 *
 * @param cells - The cells (`{ at, segments }` structs — build segments with `Plan.segment`)
 * @returns A `PlanHeatCellsType` expression
 */
export function createSegmentCells(
    cells: SubtypeExprOrValue<ArrayType<PlanSegmentCellType>>,
): ExprType<PlanHeatCellsType> {
    return East.value(variant("segments", East.value(cells, ArrayType(PlanSegmentCellType))), PlanHeatCellsType);
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
 * @property cells - The series' cells (a `Plan.tableCells` result / `PlanTableCellType` values)
 * @property format - Numeral format override for this series (else the row's `format`)
 * @property tone - Default tone for the series' values (`"muted"` de-emphasises a plan column)
 * @property strong - Semibold emphasis for this series' values
 * @property rollup - `true` ⇒ this series feeds declared parent aggregation (default: the first)
 */
export interface PlanTableSeriesInput {
    /** The series' cells (a `Plan.tableCells` result / `PlanTableCellType` values). */
    cells: SubtypeExprOrValue<ArrayType<PlanTableCellType>>;
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
 * per-position style declared once, raw cells beneath it.
 *
 * @param input - The series configuration ({@link PlanTableSeriesInput})
 * @returns An East expression of {@link PlanTableSeriesType}
 */
export function createTableSeries(input: PlanTableSeriesInput): ExprType<PlanTableSeriesType> {
    return East.value({
        cells:  East.value(input.cells, ArrayType(PlanTableCellType)),
        format: input.format !== undefined ? some(East.value(input.format, TickFormatType)) : none,
        tone:   input.tone !== undefined ? some(resolveTag(input.tone, PlanTableToneType)) : none,
        strong: input.strong !== undefined ? some(input.strong) : none,
        rollup: input.rollup !== undefined ? some(input.rollup) : none,
    }, PlanTableSeriesType);
}

/**
 * Builds per-bucket table cells from raw values. The RENDERER prints each
 * value through the row's `format` (a `Format.*` spec — the shared
 * `TickFormatType`), tones negatives `neg` and renders `none` as the muted
 * em-dash; build `PlanTableCellType` values directly for explicit `text` /
 * `tone` overrides.
 *
 * @param cells - The raw cells (`{ at, value }` structs; `value` an `Option<Float>`)
 * @returns An `ArrayType(PlanTableCellType)` expression
 */
export function createTableCells(
    cells: SubtypeExprOrValue<ArrayType<StructType<{ at: DateTimeType, value: OptionType<FloatType> }>>>,
): ExprType<ArrayType<PlanTableCellType>> {
    const raw = East.value(cells, ArrayType(StructType({ at: DateTimeType, value: OptionType(FloatType) })));
    return raw.map((_$, c) => East.value({
        at:    c.at,
        value: c.value,
        text:  none,
        tone:  none,
    }, PlanTableCellType)) as ExprType<ArrayType<PlanTableCellType>>;
}
