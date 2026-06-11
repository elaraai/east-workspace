/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Planner` — the discrete `rows × ordered slots` scheduling primitive. Rows are
 * typed resources; slots are positions on a typed axis ({@link PlannerSlotType});
 * each cell holds zero or more events in one of three audit states
 * ({@link PlannerStateType}). The interface follows the `Chart.Spec` style: a
 * builder namespace (`Planner.axis.*` / `Planner.at.*` / `Planner.event`) with a
 * `.Types.*` mirror, and flat-object factories that normalise `some` / `none` /
 * `variant`.
 *
 * @packageDocumentation
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    type TypeOf,
    East,
    ArrayType,
    StructType,
    DictType,
    OptionType,
    FunctionType,
    StringType,
    FloatType,
    DateTimeType,
    NullType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { DensityType, type DensityLiteral } from "../../style/interaction.js";

import {
    PlannerSlotType,
    PlannerScaleType,
    type PlannerScaleLiteral,
    PlannerBucketType,
    PlannerRangeType,
    PlannerAxisType,
    PlannerFlavourType,
    PlannerStateType,
    PlannerMarkerType,
    PlannerAlignType,
    type PlannerAlignLiteral,
    PlannerColumnType,
    PlannerCellType,
    PlannerVariantType,
    PlannerSelectEventType,
    type AxisTimeOptions,
    type AxisNumberOptions,
    type AxisOrdinalOptions,
} from "./types.js";
import { type StatusValueLiteral } from "../../feedback/status/types.js";

// Re-export the UIComp-free types so consumers reach everything via this barrel.
export {
    PlannerSlotType,
    PlannerScaleType,
    type PlannerScaleLiteral,
    PlannerBucketType,
    PlannerRangeType,
    PlannerAxisType,
    PlannerFlavourType,
    PlannerStateType,
    PlannerMarkerType,
    PlannerAlignType,
    type PlannerAlignLiteral,
    PlannerColumnType,
    PlannerCellType,
    PlannerVariantType,
    PlannerSelectEventType,
    type AxisOptions,
    type AxisTimeOptions,
    type AxisNumberOptions,
    type AxisOrdinalOptions,
} from "./types.js";

// ============================================================================
// UIComp-coupled types — event, row, root
// ============================================================================

/**
 * A single placed event. `slot` is the (start) coordinate; `endSlot` is set on
 * Span events; `bucket` references a declared bucket key (none = unbucketed).
 * `popover` is the click-triggered rich body (popover-only — there is no
 * tooltip). Conflict markers are declared separately, on the row's `conflicts`.
 *
 * @property slot - The event's (start) slot coordinate
 * @property endSlot - The span end (Span variant; none for Point)
 * @property bucket - The declared bucket key the event sits in (none = unbucketed)
 * @property label - The event's text
 * @property state - The audit state (see {@link PlannerStateType})
 * @property key - Optional stable event identity (drag-grammar cell refs)
 * @property popover - Optional click-triggered rich body (UIComponent)
 */
export const PlannerEventType: StructType<{
    key: OptionType<StringType>,
    slot: PlannerSlotType,
    endSlot: OptionType<PlannerSlotType>,
    bucket: OptionType<StringType>,
    label: StringType,
    state: PlannerStateType,
    popover: OptionType<UIComponentType>,
}> = StructType({
    key:      OptionType(StringType),
    slot:     PlannerSlotType,
    endSlot:  OptionType(PlannerSlotType),
    bucket:   OptionType(StringType),
    label:    StringType,
    state:    PlannerStateType,
    popover:  OptionType(UIComponentType),
});
export type PlannerEventType = typeof PlannerEventType;

/**
 * One Planner row — a typed resource. `cells` are the left-column values keyed
 * by column key; `events` is the row's slot timeline; `markers` are the row's
 * status markers (declared parallel to events, not on them); `group` is the
 * optional group-head label. Rows are identified by index.
 *
 * @property group - Optional group-head label (`groupBy`)
 * @property cells - The left-column cell values keyed by column key
 * @property events - The row's events ({@link PlannerEventType})
 * @property markers - The row's status markers ({@link PlannerMarkerType})
 */
export const PlannerRowType: StructType<{
    group: OptionType<StringType>,
    cells: DictType<StringType, PlannerCellType>,
    events: ArrayType<PlannerEventType>,
    markers: ArrayType<PlannerMarkerType>,
}> = StructType({
    group:   OptionType(StringType),
    cells:   DictType(StringType, PlannerCellType),
    events:  ArrayType(PlannerEventType),
    markers: ArrayType(PlannerMarkerType),
});
export type PlannerRowType = typeof PlannerRowType;

/**
 * The Planner root IR — shared by Point and Span (the `variant` arm
 * discriminates). Content (`rows` / `columns`), the axis, and behaviour
 * (`onSelectRow`) sit on the root.
 *
 * @property variant - Which chassis configuration (point / span)
 * @property axis - The axis declaration (scale / buckets / range / format)
 * @property columns - The left-side columns
 * @property rows - The rows
 * @property now - Optional explicit committed/proposed divider; else derived from the data
 * @property density - Optional density (row / header rhythm)
 * @property slotMinWidth - Optional min-width (CSS) per x-axis slot column; the timeline scrolls when slots can't fit
 * @property onSelectRow - Optional row-selection callback
 */
export const PlannerRootType = StructType({
    variant:      PlannerVariantType,
    axis:         PlannerAxisType,
    columns:      ArrayType(PlannerColumnType),
    rows:         ArrayType(PlannerRowType),
    now:          OptionType(PlannerSlotType),
    density:      OptionType(DensityType),
    slotMinWidth: OptionType(StringType),
    onSelectRow:  OptionType(FunctionType([PlannerSelectEventType], NullType)),
});
export type PlannerRootType = typeof PlannerRootType;

// ============================================================================
// Axis builders
// ============================================================================

function axisFields(
    scale: PlannerScaleLiteral,
    buckets: { key: string; label: string }[] | undefined,
    range: SubtypeExprOrValue<PlannerRangeType> | undefined,
    format: SubtypeExprOrValue<StringType> | undefined,
): ExprType<PlannerAxisType> {
    return East.value({
        scale:   variant(scale, null),
        buckets: (buckets ?? []).map(b => East.value({ key: b.key, label: b.label }, PlannerBucketType)),
        range:   range !== undefined ? some(range) : none,
        format:  format !== undefined ? some(format) : none,
    }, PlannerAxisType);
}

/**
 * Builds a datetime axis (calendar slots).
 *
 * @param options - Buckets, format, and an optional datetime range
 * @returns An East expression of {@link PlannerAxisType}
 *
 * @remarks
 * Pass `options.range` to fix the visible extent to a closed datetime interval;
 * omit it to derive the extent from the data. `options.buckets` subdivides each
 * slot column into named bands (e.g. AM / PM). `options.format` controls the
 * tick-label format pattern forwarded to the renderer.
 * Pair every event and `now` coordinate with {@link slotTime}.
 */
function axisTime(options?: AxisTimeOptions): ExprType<PlannerAxisType> {
    const range = options?.range !== undefined
        ? East.value(variant("time", { min: options.range.min, max: options.range.max }), PlannerRangeType)
        : undefined;
    return axisFields("time", options?.buckets, range, options?.format);
}

/**
 * Builds a numeric axis (day-of-X, hour-of-Y).
 *
 * @param options - Buckets, format, and an optional numeric range
 * @returns An East expression of {@link PlannerAxisType}
 *
 * @remarks
 * Pass `options.range` (`{ min, max }`) to fix the slot extent; omit it to
 * derive the domain from the event coordinates. `options.buckets` subdivides
 * each slot column into named bands (e.g. AM / PM). `options.format` controls
 * the tick-label format pattern forwarded to the renderer.
 * Pair every event and `now` coordinate with {@link slotNumber}.
 */
function axisNumber(options?: AxisNumberOptions): ExprType<PlannerAxisType> {
    const range = options?.range !== undefined
        ? East.value(variant("number", { min: options.range.min, max: options.range.max }), PlannerRangeType)
        : undefined;
    return axisFields("number", options?.buckets, range, options?.format);
}

/**
 * Builds an ordinal axis (phase / stage / week-number).
 *
 * @param options - Buckets, format, and an optional ordered category range
 * @returns An East expression of {@link PlannerAxisType}
 *
 * @remarks
 * Pass `options.range` as a `string[]` to fix the column order and set of
 * visible categories; omit it to derive the domain from the event coordinates.
 * `options.buckets` subdivides each slot column into named bands.
 * `options.format` controls the tick-label format pattern forwarded to the
 * renderer. Pair every event and `now` coordinate with {@link slotOrdinal}.
 */
function axisOrdinal(options?: AxisOrdinalOptions): ExprType<PlannerAxisType> {
    const range = options?.range !== undefined
        ? East.value(variant("ordinal", options.range), PlannerRangeType)
        : undefined;
    return axisFields("ordinal", options?.buckets, range, options?.format);
}

// ============================================================================
// Slot-coordinate shorthands
// ============================================================================

/**
 * Builds a datetime slot coordinate.
 *
 * @param d - A `Date` or East `DateTimeType` expression identifying the slot
 * @returns An East expression of {@link PlannerSlotType} with the `time` arm
 *
 * @remarks
 * Use wherever a datetime position is required — the `slot` / `endSlot` fields
 * of an event, the `now` divider on the config, and the `now` option on
 * {@link axisTime}. Must be paired with a `time`-scale axis ({@link axisTime}).
 */
function slotTime(d: SubtypeExprOrValue<DateTimeType>): ExprType<PlannerSlotType> {
    return East.value(variant("time", d), PlannerSlotType);
}

/**
 * Builds a numeric slot coordinate.
 *
 * @param n - A number or East `FloatType` expression identifying the slot
 * @returns An East expression of {@link PlannerSlotType} with the `number` arm
 *
 * @remarks
 * Use wherever a numeric position is required — the `slot` / `endSlot` fields
 * of an event, the `now` divider on the config, and the `now` option on
 * {@link axisNumber}. Must be paired with a `number`-scale axis ({@link axisNumber}).
 */
function slotNumber(n: SubtypeExprOrValue<FloatType>): ExprType<PlannerSlotType> {
    return East.value(variant("number", n), PlannerSlotType);
}

/**
 * Builds an ordinal slot coordinate.
 *
 * @param s - A string or East `StringType` expression naming the category
 * @returns An East expression of {@link PlannerSlotType} with the `ordinal` arm
 *
 * @remarks
 * Use wherever a category label is required — the `slot` / `endSlot` fields of
 * an event, the `now` divider on the config, and the `now` option on
 * {@link axisOrdinal}. The string must match one of the category labels
 * declared in `options.range` (or present in the data when range is omitted).
 * Must be paired with an `ordinal`-scale axis ({@link axisOrdinal}).
 */
function slotOrdinal(s: SubtypeExprOrValue<StringType>): ExprType<PlannerSlotType> {
    return East.value(variant("ordinal", s), PlannerSlotType);
}

// ============================================================================
// Event factory
// ============================================================================

/**
 * Flat input for {@link createEvent} (`Planner.event`).
 *
 * @property slot - The event's (start) slot coordinate
 * @property endSlot - The span end (Span variant only)
 * @property bucket - The declared bucket key the event sits in
 * @property label - The event's text
 * @property state - The audit state — a `PlannerStateType` value or a string shorthand
 * @property popover - Optional click-triggered rich body (UIComponent)
 */
export interface EventInput {
    /** Optional stable event identity — referenced by drag-grammar cell refs. */
    key?: SubtypeExprOrValue<StringType>;
    /** The event's (start) slot coordinate. */
    slot: SubtypeExprOrValue<PlannerSlotType>;
    /** The span end (Span variant only). */
    endSlot?: SubtypeExprOrValue<PlannerSlotType>;
    /** The declared bucket key the event sits in. */
    bucket?: SubtypeExprOrValue<StringType>;
    /** The event's text. */
    label: SubtypeExprOrValue<StringType>;
    /** The audit state — a `PlannerStateType` value, or one of the string shorthands. */
    state: SubtypeExprOrValue<PlannerStateType> | "committed" | "rejected" | "added" | "model" | "removed";
    /** Optional click-triggered rich body (UIComponent). */
    popover?: SubtypeExprOrValue<UIComponentType>;
}

function resolveState(state: EventInput["state"]): SubtypeExprOrValue<PlannerStateType> {
    if (typeof state !== "string") return state;
    switch (state) {
        case "committed": return East.value(variant("committed", null), PlannerStateType);
        case "rejected":  return East.value(variant("rejected", null), PlannerStateType);
        case "added":     return East.value(variant("proposed", variant("added", null)), PlannerStateType);
        case "model":     return East.value(variant("proposed", variant("model", null)), PlannerStateType);
        case "removed":   return East.value(variant("proposed", variant("removed", null)), PlannerStateType);
    }
}

/**
 * Builds a single Planner event from a flat TS input. Normalises optional fields
 * into their `OptionType` envelopes and resolves the `state` string shorthands
 * (`"committed"` / `"rejected"` / `"added"` / `"model"` / `"removed"`).
 *
 * @param input - The event configuration ({@link EventInput})
 * @returns An East expression of {@link PlannerEventType}
 */
function createEvent(input: EventInput): ExprType<PlannerEventType> {
    return East.value({
        key:      input.key !== undefined ? some(input.key) : none,
        slot:     input.slot,
        endSlot:  input.endSlot !== undefined ? some(input.endSlot) : none,
        bucket:   input.bucket !== undefined ? some(input.bucket) : none,
        label:    input.label,
        state:    resolveState(input.state),
        popover:  input.popover !== undefined ? some(input.popover) : none,
    }, PlannerEventType);
}

/**
 * Flat input for {@link createMarker} (`Planner.marker`).
 *
 * @property slot - The slot coordinate of the cell the marker rings
 * @property status - The semantic status — drives the colour + paired icon (`"danger"` default)
 * @property message - The marker text surfaced as a hover tooltip
 */
export interface MarkerInput {
    /** The slot coordinate of the cell the marker rings. */
    slot: SubtypeExprOrValue<PlannerSlotType>;
    /** The semantic status (success / warning / danger / info / neutral). Defaults to `"danger"`. */
    status?: StatusValueLiteral;
    /** The marker text surfaced as a hover tooltip. */
    message: SubtypeExprOrValue<StringType>;
}

/**
 * Builds a single status marker from a flat input — declared parallel to events
 * (in a row's `markers`), not on an event. The renderer rings the cell at `slot`,
 * paints the paired status icon in the corner, and shows `message` on hover.
 *
 * @param input - The marker configuration ({@link MarkerInput})
 * @returns An East expression of {@link PlannerMarkerType}
 */
function createMarker(input: MarkerInput): ExprType<PlannerMarkerType> {
    return East.value({
        slot:    input.slot,
        status:  variant(input.status ?? "danger", null),
        message: input.message,
    }, PlannerMarkerType);
}

// ============================================================================
// Columns
// ============================================================================

type Accessor<R extends StructType> = (row: ExprType<R>) => SubtypeExprOrValue<StringType>;

/**
 * A left-side column definition. `value` is the cell text — a field or an East
 * expression (a derived column is just `value: r => East.print(...)`, recomputed
 * reactively); `sublabel` is the optional muted eyebrow line.
 *
 * @property key - The column identity and the row's cell key
 * @property header - Optional header text (defaults to `key`)
 * @property width - Optional CSS width
 * @property frozen - Whether the column is pinned sticky-left
 * @property align - Optional horizontal alignment
 * @property value - The cell text accessor over the row
 * @property sublabel - The optional muted eyebrow accessor over the row
 */
export interface PlannerColumnDef<R extends StructType> {
    /** The column identity and the row's cell key. */
    key: string;
    /** Optional header text (defaults to `key`). */
    header?: string;
    /** Optional CSS width. */
    width?: string;
    /** Whether the column is pinned sticky-left. */
    frozen?: boolean;
    /** Optional horizontal alignment. */
    align?: PlannerAlignLiteral;
    /** The cell text accessor over the row. */
    value: Accessor<R>;
    /** The optional muted eyebrow accessor over the row. */
    sublabel?: Accessor<R>;
}

function columnMeta<R extends StructType>(col: PlannerColumnDef<R>): ExprType<PlannerColumnType> {
    return East.value({
        key:    col.key,
        header: col.header ?? col.key,
        width:  col.width !== undefined ? some(col.width) : none,
        frozen: col.frozen !== undefined ? some(col.frozen) : none,
        align:  col.align !== undefined ? some(variant(col.align, null)) : none,
    }, PlannerColumnType);
}

function cellValue<R extends StructType>(col: PlannerColumnDef<R>, row: ExprType<R>): SubtypeExprOrValue<PlannerCellType> {
    return East.value({
        value:    col.value(row),
        sublabel: col.sublabel !== undefined ? some(col.sublabel(row)) : none,
    }, PlannerCellType);
}

// ============================================================================
// Factory — Point / Span
// ============================================================================

/**
 * Configuration for {@link createPoint} / {@link createSpan}.
 *
 * @typeParam R - The struct type of each data row
 * @property axis - The axis declaration (use `Planner.axis.*`)
 * @property columns - The left-side columns
 * @property events - Per-row accessor returning the row's events
 * @property markers - Optional per-row accessor returning the row's status markers (parallel to events)
 * @property groupBy - Optional per-row accessor returning the group-head label
 * @property now - Optional explicit committed/proposed divider slot
 * @property density - Optional density
 * @property slotMinWidth - Optional min-width (CSS) per x-axis slot column; the timeline scrolls horizontally when slots would otherwise be squeezed below it
 * @property onSelectRow - Optional row-selection callback
 */
export interface PlannerConfig<R extends StructType> {
    /** The axis declaration (use `Planner.axis.*`). */
    axis: SubtypeExprOrValue<PlannerAxisType>;
    /** The left-side columns. */
    columns: PlannerColumnDef<R>[];
    /** Per-row accessor returning the row's events. */
    events: (row: ExprType<R>) => SubtypeExprOrValue<ArrayType<PlannerEventType>>;
    /** Optional per-row accessor returning the row's status markers. */
    markers?: (row: ExprType<R>) => SubtypeExprOrValue<ArrayType<PlannerMarkerType>>;
    /** Optional per-row accessor returning the group-head label. */
    groupBy?: (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
    /** Optional explicit committed/proposed divider slot. */
    now?: SubtypeExprOrValue<PlannerSlotType>;
    /** Optional density (row / header rhythm). */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Optional min-width (CSS) per x-axis slot column. With it set, the
     *  timeline scrolls horizontally rather than squeezing slots below it. */
    slotMinWidth?: SubtypeExprOrValue<StringType>;
    /** Optional row-selection callback. */
    onSelectRow?: SubtypeExprOrValue<FunctionType<[PlannerSelectEventType], NullType>>;
}

// Infer the row struct type R from the data argument (a plain JS array of
// objects or an East array expression), mirroring the Table / Gantt factories.
export type RowElement<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    TypeOf<T> extends ArrayType<infer S> ? (S extends StructType ? S : never) : never;

function buildRoot(
    kind: "point" | "span",
    data: SubtypeExprOrValue<ArrayType<StructType>>,
    config: PlannerConfig<StructType>,
): ExprType<UIComponentType> {
    const data_expr = East.value(data) as ExprType<ArrayType<StructType>>;
    const columns = config.columns.map(columnMeta);

    const rows = data_expr.map(($, row) => {
        const cells = $.let(new Map(), DictType(StringType, PlannerCellType));
        for (const col of config.columns) {
            $(cells.insert(col.key, cellValue(col, row)));
        }
        return East.value({
            group:  config.groupBy !== undefined ? some(config.groupBy(row)) : none,
            cells,
            events: East.value(config.events(row), ArrayType(PlannerEventType)),
            markers: config.markers !== undefined
                ? East.value(config.markers(row), ArrayType(PlannerMarkerType))
                : East.value([], ArrayType(PlannerMarkerType)),
        }, PlannerRowType);
    });

    const density = config.density !== undefined
        ? some(typeof config.density === "string" ? East.value(variant(config.density, null), DensityType) : config.density)
        : none;

    return East.value(variant("Planner", {
        variant:     variant(kind, null),
        axis:        config.axis,
        columns:     East.value(columns, ArrayType(PlannerColumnType)),
        rows,
        now:          config.now !== undefined ? some(config.now) : none,
        density,
        slotMinWidth: config.slotMinWidth !== undefined ? some(config.slotMinWidth) : none,
        onSelectRow:  config.onSelectRow !== undefined ? some(config.onSelectRow) : none,
    }), UIComponentType);
}

/**
 * Creates a Point Planner — slot-bound events (each event sits in one
 * slot/bucket). The Roster default.
 *
 * @typeParam R - The struct type of each data row
 * @param data - The rows
 * @param config - The Planner configuration ({@link PlannerConfig})
 * @returns An East expression of `UIComponentType`
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Planner, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ =>
 *     Planner.Point(
 *         [{ id: "a", name: "Alice", events: [] }],
 *         {
 *             axis: Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }] }),
 *             columns: [{ key: "name", frozen: true, value: r => r.name }],
 *             events: r => r.events,
 *         },
 *     ),
 * );
 * ```
 */
function createPoint<T extends SubtypeExprOrValue<ArrayType<StructType>>>(data: T, config: PlannerConfig<RowElement<T>>): ExprType<UIComponentType> {
    return buildRoot("point", data, config as PlannerConfig<StructType>);
}

/**
 * Creates a Span Planner — multi-slot span events (start → end).
 *
 * @typeParam R - The struct type of each data row
 * @param data - The rows
 * @param config - The Planner configuration ({@link PlannerConfig})
 * @returns An East expression of `UIComponentType`
 */
function createSpan<T extends SubtypeExprOrValue<ArrayType<StructType>>>(data: T, config: PlannerConfig<RowElement<T>>): ExprType<UIComponentType> {
    return buildRoot("span", data, config as PlannerConfig<StructType>);
}

// ============================================================================
// Namespace
// ============================================================================

/**
 * The type of the {@link Planner} namespace. Declared explicitly (rather than
 * inferred from `as const`) so the declaration emit stays within TypeScript's
 * serialization limit.
 */
export interface PlannerNamespace {
    /** Creates a Point Planner (slot-bound events). */
    Point: typeof createPoint;
    /** Creates a Span Planner (multi-slot span events). */
    Span: typeof createSpan;
    /** Typed axis builders — `time` / `number` / `ordinal`. */
    axis: {
        /**
         * Builds a datetime axis (calendar slots).
         *
         * @remarks
         * Accepts an optional datetime range, bucket list, and format string.
         * Pair every event and `now` coordinate with `Planner.at.time`.
         */
        time: typeof axisTime;
        /**
         * Builds a numeric axis (day-of-X, hour-of-Y).
         *
         * @remarks
         * Accepts an optional `{ min, max }` numeric range, bucket list, and
         * format string. Pair every event and `now` coordinate with
         * `Planner.at.number`.
         */
        number: typeof axisNumber;
        /**
         * Builds an ordinal axis (phase / stage / week-number).
         *
         * @remarks
         * Accepts an optional ordered `string[]` range, bucket list, and format
         * string. Pair every event and `now` coordinate with
         * `Planner.at.ordinal`.
         */
        ordinal: typeof axisOrdinal;
    };
    /** Slot-coordinate shorthands — `time` / `number` / `ordinal`. */
    at: {
        /**
         * Wraps a `Date` or `DateTimeType` expression in the `time` arm of
         * {@link PlannerSlotType}.
         *
         * @remarks
         * Must be paired with a `time`-scale axis (`Planner.axis.time`).
         */
        time: typeof slotTime;
        /**
         * Wraps a number or `FloatType` expression in the `number` arm of
         * {@link PlannerSlotType}.
         *
         * @remarks
         * Must be paired with a `number`-scale axis (`Planner.axis.number`).
         */
        number: typeof slotNumber;
        /**
         * Wraps a string or `StringType` expression in the `ordinal` arm of
         * {@link PlannerSlotType}.
         *
         * @remarks
         * The string must name a category present in the axis range.
         * Must be paired with an `ordinal`-scale axis (`Planner.axis.ordinal`).
         */
        ordinal: typeof slotOrdinal;
    };
    /** Builds a single event from a flat input. */
    event: typeof createEvent;
    /** Builds a single status marker from a flat input (parallel to events). */
    marker: typeof createMarker;
    /** The Planner East types. */
    Types: {
        /** The Planner root IR ({@link PlannerRootType}). */
        Root: typeof PlannerRootType;
        /** Which chassis configuration (point / span). */
        Variant: typeof PlannerVariantType;
        /** A typed slot coordinate (time / number / ordinal). */
        Slot: typeof PlannerSlotType;
        /** The axis scale kind. */
        Scale: typeof PlannerScaleType;
        /** A labelled sub-slot bucket. */
        Bucket: typeof PlannerBucketType;
        /** An explicit axis domain. */
        Range: typeof PlannerRangeType;
        /** The axis declaration. */
        Axis: typeof PlannerAxisType;
        /** The proposed sub-flavour. */
        Flavour: typeof PlannerFlavourType;
        /** The three event states. */
        State: typeof PlannerStateType;
        /** A status marker (slot + status + message). */
        Marker: typeof PlannerMarkerType;
        /** A single placed event. */
        Event: typeof PlannerEventType;
        /** A column's horizontal alignment. */
        Align: typeof PlannerAlignType;
        /** A left-side column. */
        Column: typeof PlannerColumnType;
        /** A per-row cell (value + eyebrow). */
        Cell: typeof PlannerCellType;
        /** A Planner row. */
        Row: typeof PlannerRowType;
        /** The `onSelectRow` payload. */
        SelectEvent: typeof PlannerSelectEventType;
    };
}

/**
 * The `Planner` namespace — the discrete `rows × ordered slots` scheduling
 * primitive. Assemble a Planner with `Planner.Point` / `Planner.Span`, declare
 * the axis with `Planner.axis.*`, place events with `Planner.event` /
 * `Planner.at.*`, and reach every East type via `Planner.Types.*`.
 */
export const Planner: PlannerNamespace = {
    /**
     * Creates a Point Planner — slot-bound events (each event sits in one
     * slot/bucket). The Roster default.
     *
     * @typeParam R - The struct type of each data row
     * @param data - The rows
     * @param config - The Planner configuration ({@link PlannerConfig})
     * @returns An East expression of `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Planner, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Planner.Point(
     *         [{ id: "a", name: "Alice", events: [] }],
     *         {
     *             axis: Planner.axis.number({ buckets: [{ key: "am", label: "AM" }, { key: "pm", label: "PM" }] }),
     *             columns: [{ key: "name", frozen: true, value: r => r.name }],
     *             events: r => r.events,
     *         },
     *     ),
     * );
     * ```
     */
    Point: createPoint,
    /**
     * Creates a Span Planner — multi-slot span events (start → end).
     *
     * @typeParam R - The struct type of each data row
     * @param data - The rows
     * @param config - The Planner configuration ({@link PlannerConfig})
     * @returns An East expression of `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Planner, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Planner.Span(
     *         [{ id: "a", name: "Alice", events: [] }],
     *         {
     *             axis: Planner.axis.time(),
     *             columns: [{ key: "name", frozen: true, value: r => r.name }],
     *             events: r => r.events,
     *         },
     *     ),
     * );
     * ```
     */
    Span: createSpan,
    /**
     * Typed axis builders. Each builder declares the axis scale and returns an
     * East expression of {@link PlannerAxisType}.
     *
     * @remarks
     * Choose the builder that matches your slot coordinates — mixing arms within
     * one Planner is unsupported. All three accept an optional bucket list and
     * format string; the range option is typed per-scale:
     * - `time` — datetime axis, `range: { min: Date, max: Date }`.
     * - `number` — numeric axis, `range: { min: number, max: number }`.
     * - `ordinal` — ordered-category axis, `range: string[]`.
     */
    axis: { time: axisTime, number: axisNumber, ordinal: axisOrdinal },
    /**
     * Slot-coordinate shorthands. Each builder wraps a raw coordinate in the
     * matching arm of {@link PlannerSlotType}.
     *
     * @remarks
     * Use the same family as the axis — `at.time` with `axis.time`, `at.number`
     * with `axis.number`, `at.ordinal` with `axis.ordinal`. These shorthands
     * are used for the `slot` / `endSlot` fields of events, the row `now`
     * divider on the config, and any explicit `now` forwarded to the axis builder.
     */
    at: { time: slotTime, number: slotNumber, ordinal: slotOrdinal },
    /**
     * Builds a single Planner event from a flat TS input. Normalises optional
     * fields into their `OptionType` envelopes and resolves the `state` string
     * shorthands (`"committed"` / `"rejected"` / `"added"` / `"model"` /
     * `"removed"`).
     *
     * @param input - The event configuration ({@link EventInput})
     * @returns An East expression of {@link PlannerEventType}
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Planner, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Planner.Point(
     *         [{ id: "a", name: "Alice", events: [Planner.event({ slot: Planner.at.number(0), label: "Shift", state: "committed" })] }],
     *         {
     *             axis: Planner.axis.number(),
     *             columns: [{ key: "name", frozen: true, value: r => r.name }],
     *             events: r => r.events,
     *         },
     *     ),
     * );
     * ```
     */
    event: createEvent,
    /**
     * Builds a single status marker from a flat input — declared parallel to
     * events (in a row's `markers`), not on an event. The renderer rings the
     * cell at `slot`, paints the paired status icon in the corner, and shows
     * `message` on hover.
     *
     * @param input - The marker configuration ({@link MarkerInput})
     * @returns An East expression of {@link PlannerMarkerType}
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Planner, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Planner.Point(
     *         [{ id: "a", name: "Alice", events: [], markers: [Planner.marker({ slot: Planner.at.number(0), status: "danger", message: "Conflict" })] }],
     *         {
     *             axis: Planner.axis.number(),
     *             columns: [{ key: "name", frozen: true, value: r => r.name }],
     *             events: r => r.events,
     *             markers: r => r.markers,
     *         },
     *     ),
     * );
     * ```
     */
    marker: createMarker,
    /** The Planner East types. */
    Types: {
        /**
         * The Planner root IR — shared by Point and Span (the `variant` arm
         * discriminates).
         *
         * @remarks
         * The top-level shape every Planner compiles to. Content (`rows` /
         * `columns`), the axis, and behaviour (`onSelectRow`) sit on the root.
         *
         * @property variant - Which chassis configuration (point / span)
         * @property axis - The axis declaration (scale / buckets / range / format)
         * @property columns - The left-side columns
         * @property rows - The rows
         * @property now - Optional explicit committed/proposed divider; else derived from the data
         * @property density - Optional density (row / header rhythm)
         * @property slotMinWidth - Optional min-width (CSS) per x-axis slot column; the timeline scrolls when slots can't fit
         * @property onSelectRow - Optional row-selection callback
         */
        Root: PlannerRootType,
        /**
         * Which chassis configuration this Planner is.
         *
         * @remarks
         * Discriminates Point from Span on the {@link PlannerRootType} root.
         *
         * @property point - Slot-bound events (each event sits in one slot/bucket)
         * @property span - Multi-slot span events (start → end)
         */
        Variant: PlannerVariantType,
        /**
         * A typed slot coordinate. The arm chooses the axis scale the renderer
         * builds, so the scale kind is derived from the data and never declared
         * twice.
         *
         * @remarks
         * The coordinate space of every event and marker; mixing arms within one
         * Planner is the forbidden "one axis type per Planner" case.
         *
         * @property time - A datetime position (calendar slots)
         * @property number - A numeric position (day-of-X, hour-of-Y)
         * @property ordinal - An ordinal label (phase / stage / week-number)
         */
        Slot: PlannerSlotType,
        /**
         * The axis scale kind, declared once on the axis; must match every
         * slot's arm.
         *
         * @remarks
         * The scale declaration on {@link PlannerAxisType}, mirroring the arm of
         * each {@link PlannerSlotType} coordinate.
         *
         * @property time - Datetime axis
         * @property number - Numeric axis
         * @property ordinal - Ordinal axis
         */
        Scale: PlannerScaleType,
        /**
         * One labelled sub-slot bucket inside a column — the explicit name an
         * operator reads (AM/PM, the parts of a day, …).
         *
         * @remarks
         * Buckets are an arbitrary labelled array on the axis; an empty array
         * means one slot per column.
         *
         * @property key - The bucket identity an event references
         * @property label - The displayed bucket name
         */
        Bucket: PlannerBucketType,
        /**
         * An explicit axis domain, typed to the axis's coordinate kind. Supplied
         * to fix the extent instead of deriving it from the data.
         *
         * @remarks
         * The optional `range` on {@link PlannerAxisType}; its arm matches the
         * axis {@link PlannerScaleType}.
         *
         * @property time - Datetime bounds for a time axis
         * @property number - Numeric bounds for a numeric axis
         * @property ordinal - The ordered category labels for an ordinal axis
         */
        Range: PlannerRangeType,
        /**
         * The axis declaration — the scale kind, the labelled sub-slot buckets,
         * an optional explicit range, and an optional tick-label format.
         *
         * @remarks
         * The `axis` field of {@link PlannerRootType}; built with the
         * `Planner.axis.*` builders.
         *
         * @property scale - The axis coordinate kind (see {@link PlannerScaleType})
         * @property buckets - The labelled sub-slot buckets ([] = one slot per column)
         * @property range - Optional explicit domain; else derived from the data
         * @property format - Optional tick-label format pattern
         */
        Axis: PlannerAxisType,
        /**
         * The sub-flavour of a `proposed` event. It rides inside the `proposed`
         * arm of {@link PlannerStateType}, so it is only representable while
         * proposed — a committed event can never carry a flavour.
         *
         * @remarks
         * Nested under the `proposed` arm of {@link PlannerStateType}; drives the
         * proposed event's rendering.
         *
         * @property added - An operator proposal
         * @property model - A model's suggestion (rendered italic)
         * @property removed - A proposed deletion of a committed event (struck through)
         */
        Flavour: PlannerFlavourType,
        /**
         * The three event states. `committed` is audit-locked and read-only;
         * `proposed` is dirty-patch owned (carrying its flavour); `rejected` is a
         * proposal that was turned down, kept for diff context.
         *
         * @remarks
         * The `state` of every {@link PlannerEventType}; the `proposed` arm nests
         * a {@link PlannerFlavourType}.
         *
         * @property committed - Audit-locked, immutable
         * @property proposed - Drafted; the flavour (see {@link PlannerFlavourType}) is nested
         * @property rejected - Reviewed and declined; kept for diff
         */
        State: PlannerStateType,
        /**
         * A status marker placed at a slot — declared parallel to events (in the
         * row's `markers`, not on an event). The renderer rings the cell at
         * `slot`, paints the paired status icon in its corner, and surfaces
         * `message` as a hover tooltip.
         *
         * @remarks
         * Reuses the shared {@link StatusValueType} so a cell can be flagged good
         * (`success`) just as readily as bad (`danger` / `warning`); declared on
         * a {@link PlannerRowType} row's `markers`.
         *
         * @property slot - The slot coordinate of the cell the marker rings
         * @property status - The semantic status (success / warning / danger / info / neutral) — drives colour + icon
         * @property message - The marker text surfaced as a hover tooltip
         */
        Marker: PlannerMarkerType,
        /**
         * A single placed event. `slot` is the (start) coordinate; `endSlot` is
         * set on Span events; `bucket` references a declared bucket key (none =
         * unbucketed).
         *
         * @remarks
         * The element of a {@link PlannerRowType} row's `events`. `popover` is the
         * click-triggered rich body (popover-only — there is no tooltip).
         *
         * @property slot - The event's (start) slot coordinate
         * @property endSlot - The span end (Span variant; none for Point)
         * @property bucket - The declared bucket key the event sits in (none = unbucketed)
         * @property label - The event's text
         * @property state - The audit state (see {@link PlannerStateType})
         * @property popover - Optional click-triggered rich body (UIComponent)
         */
        Event: PlannerEventType,
        /**
         * Horizontal alignment of a left column's content.
         *
         * @remarks
         * The optional `align` of a {@link PlannerColumnType}.
         *
         * @property start - Align to the start (left)
         * @property end - Align to the end (right)
         */
        Align: PlannerAlignType,
        /**
         * A left-side column definition — flat and kind-free, the same shape as
         * Table / Gantt.
         *
         * @remarks
         * An element of {@link PlannerRootType}'s `columns`. The five spec "column
         * kinds" are authoring patterns built from `value` + `sublabel`, not
         * distinct IR shapes.
         *
         * @property key - The column identity (and the row's cell key)
         * @property header - The column header text
         * @property width - Optional CSS width
         * @property frozen - Whether the column is pinned sticky-left
         * @property align - Optional horizontal alignment of the cell content
         */
        Column: PlannerColumnType,
        /**
         * The per-row cell content — a `value` and an optional muted `sublabel`
         * (eyebrow).
         *
         * @remarks
         * The value of a {@link PlannerRowType} row's `cells` dict. A derived
         * column is just a `value` computed in East; there is no separate kind.
         *
         * @property value - The cell text (a field or an East-computed value)
         * @property sublabel - The optional muted eyebrow line beneath the value
         */
        Cell: PlannerCellType,
        /**
         * One Planner row — a typed resource, identified by index.
         *
         * @remarks
         * An element of {@link PlannerRootType}'s `rows`. `cells` are the
         * left-column values keyed by column key; `events` is the row's slot
         * timeline; `markers` are the row's status markers (declared parallel to
         * events, not on them).
         *
         * @property group - Optional group-head label (`groupBy`)
         * @property cells - The left-column cell values keyed by column key
         * @property events - The row's events ({@link PlannerEventType})
         * @property markers - The row's status markers ({@link PlannerMarkerType})
         */
        Row: PlannerRowType,
        /**
         * The payload of the `onSelectRow` callback (a row was clicked /
         * selected).
         *
         * @remarks
         * Passed to {@link PlannerRootType}'s `onSelectRow` when a row is picked.
         *
         * @property rowIndex - The selected row's index (0-based)
         */
        SelectEvent: PlannerSelectEventType,
    },
};
