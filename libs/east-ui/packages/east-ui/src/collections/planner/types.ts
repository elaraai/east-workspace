/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Planner` IR — the UIComponent-free types. A Planner is a discrete
 * `rows × ordered slots` scheduling grid: rows are typed resources, slots are
 * positions on a typed axis, and each cell holds zero or more events in one of
 * three audit states.
 *
 * The axis design follows the `Chart.Spec` style — a typed coordinate variant
 * ({@link PlannerSlotType}) whose arm chooses the scale, so the axis kind is
 * derived from the data ("one axis type per Planner"). Sub-slot buckets are an
 * arbitrary labelled array, never a bare count.
 *
 * `PlannerEventType` / `PlannerRowType` / `PlannerRootType` carry a
 * `UIComponentType` (`event.popover`) and therefore live in `./index.ts`, not
 * here — `types.ts` stays UIComp-free so `component.ts` can import it without a
 * circular dependency.
 *
 * @packageDocumentation
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    VariantType,
    StringType,
    FloatType,
    IntegerType,
    BooleanType,
    DateTimeType,
    NullType,
    ArrayType,
} from "@elaraai/east";
import { StatusValueType } from "../../feedback/status/types.js";

// ============================================================================
// Axis — typed slot coordinate + scale + buckets + range
// ============================================================================

/**
 * A typed slot coordinate. The arm chooses the axis scale the renderer builds,
 * so the scale kind is derived from the data and never declared twice; mixing
 * arms within one Planner is the forbidden "one axis type per Planner" case.
 *
 * @remarks
 * Use `Planner.at.time(date)`, `Planner.at.number(n)`, or
 * `Planner.at.ordinal(label)` to construct slot values rather than building
 * the variant manually. Every event and marker on the same Planner must use
 * the same arm — the renderer enforces the single-axis-kind rule at render
 * time.
 *
 * @property time - A datetime position (calendar slots)
 * @property number - A numeric position (day-of-X, hour-of-Y)
 * @property ordinal - An ordinal label (phase / stage / week-number)
 */
export const PlannerSlotType = VariantType({
    time:    DateTimeType,
    number:  FloatType,
    ordinal: StringType,
});
export type PlannerSlotType = typeof PlannerSlotType;

/**
 * The axis scale kind, declared once on the axis; must match every slot's arm.
 *
 * @remarks
 * This value is embedded in the serialised `PlannerAxisType` and read by the
 * renderer to choose the correct tick-label formatter. Prefer the
 * `Planner.axis.*` builder helpers over constructing it directly — they set the
 * scale tag automatically from the builder you call.
 *
 * @property time - Datetime axis
 * @property number - Numeric axis
 * @property ordinal - Ordinal axis
 */
export const PlannerScaleType = VariantType({
    time:    NullType,
    number:  NullType,
    ordinal: NullType,
});
export type PlannerScaleType = typeof PlannerScaleType;

/** String-literal shorthand for {@link PlannerScaleType}. */
export type PlannerScaleLiteral = "time" | "number" | "ordinal";

/**
 * The time-axis resolution — the calendar unit of each `time`-axis slot
 * column. The Planner sibling of the Gantt axis `tier`, except that a Planner
 * resolution sets slot *identity* (the column set, event placement, and drag
 * slot keys), not just header labels.
 *
 * @remarks
 * Declared via `Planner.axis.time({ resolution })`; meaningless on `number` /
 * `ordinal` axes. `auto` (or an absent resolution) infers the unit from the
 * axis extent: a pinned `range` spanning ≤ 14 days derives one column per
 * day, anything else keeps one column per month (the pre-resolution
 * behaviour — data-derived extents never infer day columns). The fixed arms
 * force the unit regardless of extent; `hour` is never chosen automatically.
 *
 * @property auto - Infer from the pinned range span (≤ 14 days ⇒ day, else month)
 * @property hour - One column per hour
 * @property day - One column per day
 * @property week - One column per week
 * @property month - One column per calendar month
 * @property quarter - One column per calendar quarter
 * @property year - One column per calendar year
 */
export const PlannerResolutionType = VariantType({
    auto:    NullType,
    hour:    NullType,
    day:     NullType,
    week:    NullType,
    month:   NullType,
    quarter: NullType,
    year:    NullType,
});
export type PlannerResolutionType = typeof PlannerResolutionType;

/** String-literal shorthand for {@link PlannerResolutionType}. */
export type PlannerResolutionLiteral = "auto" | "hour" | "day" | "week" | "month" | "quarter" | "year";

/**
 * One labelled sub-slot bucket inside a column — the explicit name an operator
 * reads (AM/PM, the parts of a day, …). Buckets are an arbitrary labelled
 * array; an empty array means one slot per column.
 *
 * @remarks
 * Pass bucket objects via the `buckets` array in `AxisTimeOptions`,
 * `AxisNumberOptions`, or `AxisOrdinalOptions`. Events reference a bucket by
 * its `key`; the renderer displays the `label` in the column header. When no
 * buckets are specified an event omits the `bucket` field entirely.
 *
 * @property key - The bucket identity an event references
 * @property label - The displayed bucket name
 */
export const PlannerBucketType = StructType({
    key:   StringType,
    label: StringType,
});
export type PlannerBucketType = typeof PlannerBucketType;

/**
 * An explicit axis domain, typed to the axis's coordinate kind. Supplied to fix
 * the extent instead of deriving it from the data.
 *
 * @remarks
 * When omitted the renderer derives the domain from the union of all event
 * slots, which can produce a shifting viewport as data changes. Supply a range
 * to pin the visible extent regardless of what events are present — useful for
 * keeping a calendar grid stable even when some days have no events. The arm
 * must match the axis scale: a `number` axis requires the `number` arm, a
 * `time` axis the `time` arm, and an `ordinal` axis the `ordinal` arm.
 *
 * @property time - Datetime bounds for a time axis
 * @property number - Numeric bounds for a numeric axis
 * @property ordinal - The ordered category labels for an ordinal axis
 */
export const PlannerRangeType = VariantType({
    time:    StructType({ min: DateTimeType, max: DateTimeType }),
    number:  StructType({ min: FloatType, max: FloatType }),
    ordinal: ArrayType(StringType),
});
export type PlannerRangeType = typeof PlannerRangeType;

/**
 * The axis declaration — the scale kind, the labelled sub-slot buckets, an
 * optional explicit range, an optional tick-label format, and (time axes
 * only) an optional column grain.
 *
 * @remarks
 * This is the serialised form written into the Planner IR. Consumer code
 * should construct it via `Planner.axis.time(opts)`, `Planner.axis.number(opts)`,
 * or `Planner.axis.ordinal(opts)` rather than by hand — those builders fill
 * `scale` and coerce the `range` variant automatically.
 *
 * @property scale - The axis coordinate kind (see {@link PlannerScaleType})
 * @property buckets - The labelled sub-slot buckets ([] = one slot per column)
 * @property range - Optional explicit domain; else derived from the data
 * @property format - Optional tick-label format pattern
 * @property resolution - Optional time-axis column unit (see {@link PlannerResolutionType}); absent ≡ auto
 */
export const PlannerAxisType = StructType({
    scale:      PlannerScaleType,
    buckets:    ArrayType(PlannerBucketType),
    range:      OptionType(PlannerRangeType),
    format:     OptionType(StringType),
    resolution: OptionType(PlannerResolutionType),
});
export type PlannerAxisType = typeof PlannerAxisType;

// ============================================================================
// Event state + conflict marker
// ============================================================================

// The three-state audit grammar (`committed` / `proposed(flavour)` /
// `rejected`) moved to `contracts/states.ts` (#571) — it is shared by Roster,
// Board, and Blend, so it outlives the Planner. Re-exported here so Planner
// modules and imports keep working until the component is deleted.
export { PlannerFlavourType, PlannerStateType } from "../../contracts/states.js";

/**
 * A row's review decision — distinct from the event-level {@link PlannerStateType}.
 *
 * @remarks
 * Used only when the Planner's `review` chrome is enabled. `approved` rests
 * pre-approved (its Approve renders as the active state); `pending` awaits an
 * explicit call (a flagged line); `rejected` is an explicit decline.
 *
 * The canonical definition is the shared review contract's
 * `ApprovalStateType` (`contracts/review.ts`) — this structural twin is kept
 * so existing Planner IR and imports round-trip unchanged, and because
 * `component.ts` must reach the variant through a `UIComponentType`-free
 * module. Prefer `ApprovalStateType` in new code.
 *
 * @property approved - Pre-approved / accepted (the resting state for a clean line)
 * @property pending - Undecided — awaits an explicit Approve / Reject
 * @property rejected - Explicitly declined
 */
export const PlannerApprovalType = VariantType({
    /** Pre-approved / accepted (the resting state for a clean line). */
    approved: NullType,
    /** Undecided — awaits an explicit Approve / Reject. */
    pending: NullType,
    /** Explicitly declined. */
    rejected: NullType,
});
export type PlannerApprovalType = typeof PlannerApprovalType;

/**
 * A status marker placed at a slot — declared parallel to events (in the row's
 * `markers`, not on an event). The renderer rings the cell at `slot`, paints the
 * paired status icon in its corner, and surfaces `message` as a hover tooltip.
 * Reuses the shared {@link StatusValueType} so a cell can be flagged good
 * (`success`) just as readily as bad (`danger` / `warning`). The consumer
 * computes the rule (in East) and emits the markers; the library renders them.
 *
 * @remarks
 * Markers are computed independently of events and passed via the `markers`
 * callback on the Planner root options. A slot can carry a marker and zero
 * events simultaneously — for example, to flag a capacity breach on a day that
 * has no events scheduled yet. The `message` field is intentionally free-form;
 * compute it from the same East expression that determines the status so the
 * tooltip stays in sync with the visual.
 *
 * @property slot - The slot coordinate of the cell the marker rings
 * @property status - The semantic status (success / warning / danger / info / neutral) — drives colour + icon
 * @property message - The marker text surfaced as a hover tooltip
 */
export const PlannerMarkerType = StructType({
    slot:    PlannerSlotType,
    status:  StatusValueType,
    message: StringType,
});
export type PlannerMarkerType = typeof PlannerMarkerType;

// ============================================================================
// Event geometry — stretch + content alignment + animation
// ============================================================================

/**
 * Which axis an event tile stretches to fill its cell on. Absent ⇒ the tile is
 * content-sized (intrinsic). Deliberately `stretch` (not `fill`) to avoid
 * confusion with the background-colour fill — it matches the flexbox
 * `alignItems: stretch` vocabulary the renderer already uses.
 *
 * @remarks
 * Pass the string shorthand (`"horizontal"` / `"vertical"` / `"both"`) to
 * `Planner.event`'s `stretch` field. A horizontal stretch fills the cell width,
 * a vertical stretch fills its height (so a single-occupant event paints the
 * whole day cell), and `both` fills both axes. A vertical-stretch tile that
 * shares a cell with others stretches to its flex-line height, not the full
 * cell.
 *
 * @property horizontal - Fill the cell width
 * @property vertical - Fill the cell height
 * @property both - Fill both axes
 */
export const PlannerStretchType = VariantType({ horizontal: NullType, vertical: NullType, both: NullType });
export type PlannerStretchType = typeof PlannerStretchType;

/** String-literal shorthand for {@link PlannerStretchType}. */
export type PlannerStretchLiteral = "horizontal" | "vertical" | "both";

/**
 * One alignment position for an event tile's content along a single axis.
 *
 * @remarks
 * Used for both axes of {@link PlannerContentType}. Maps to `justifyContent`
 * (horizontal) / `alignItems` (vertical) inside the tile, and positions a
 * normal-size tile within a taller cell. Defaults to `start` on each axis.
 *
 * @property start - Align to the start (left / top)
 * @property center - Centre
 * @property end - Align to the end (right / bottom)
 */
export const PlannerContentAlignType = VariantType({ start: NullType, center: NullType, end: NullType });
export type PlannerContentAlignType = typeof PlannerContentAlignType;

/** String-literal shorthand for {@link PlannerContentAlignType}. */
export type PlannerContentAlignLiteral = "start" | "center" | "end";

/**
 * Where an event tile's content sits inside the tile — a two-axis alignment.
 *
 * @remarks
 * Both axes default to `start` (top-left) when omitted. `horizontal` drives the
 * tile's `justifyContent`; `vertical` its `alignItems`. Meaningful even without
 * `stretch` — it positions a normal-size tile within a taller (e.g. bucketed or
 * mixed) cell.
 *
 * @property horizontal - Horizontal content alignment (→ `justifyContent`)
 * @property vertical - Vertical content alignment (→ `alignItems`)
 */
export const PlannerContentType = StructType({
    horizontal: OptionType(PlannerContentAlignType),
    vertical:   OptionType(PlannerContentAlignType),
});
export type PlannerContentType = typeof PlannerContentType;

/**
 * An event tile's optional attention animation.
 *
 * @remarks
 * Pass `"pulse"` to `Planner.event`'s `animation` field to draw a gentle
 * opacity pulse (the shared `elara-pulse` keyframe); `"none"` (or absent) is
 * static. The pulse honours `prefers-reduced-motion`.
 *
 * @property none - No animation (the default)
 * @property pulse - A gentle opacity pulse
 */
export const PlannerAnimationType = VariantType({ none: NullType, pulse: NullType });
export type PlannerAnimationType = typeof PlannerAnimationType;

/** String-literal shorthand for {@link PlannerAnimationType}. */
export type PlannerAnimationLiteral = "none" | "pulse";

// ============================================================================
// Columns — one flat shape (value + eyebrow)
// ============================================================================

/**
 * Horizontal alignment of a left column's content.
 *
 * @remarks
 * Defaults to `start` when omitted. Use `"end"` for numeric columns such as
 * hours or counts so digits align on their decimal point. Pass the string
 * literal directly to the `align` field in a column definition rather than
 * constructing the variant explicitly.
 *
 * @property start - Align to the start (left)
 * @property end - Align to the end (right)
 */
export const PlannerAlignType = VariantType({ start: NullType, end: NullType });
export type PlannerAlignType = typeof PlannerAlignType;

/** String-literal shorthand for {@link PlannerAlignType}. */
export type PlannerAlignLiteral = "start" | "end";

/**
 * A left-side column definition — flat and kind-free, the same shape as Table /
 * Gantt. The five spec "column kinds" are authoring patterns built from `value`
 * + `sublabel`, not distinct IR shapes.
 *
 * @remarks
 * Pass column definitions as plain objects in the `columns` array of the
 * Planner root options. Set `frozen: true` on the identity column so it stays
 * visible while the slot grid scrolls horizontally. Derived columns — values
 * computed from the row in East rather than read from a field directly — use
 * the same shape; there is no separate kind for them.
 *
 * @property key - The column identity (and the row's cell key)
 * @property header - The column header text
 * @property width - Optional CSS width
 * @property frozen - Whether the column is pinned sticky-left
 * @property align - Optional horizontal alignment of the cell content
 */
export const PlannerColumnType = StructType({
    key:    StringType,
    header: StringType,
    width:  OptionType(StringType),
    frozen: OptionType(BooleanType),
    align:  OptionType(PlannerAlignType),
});
export type PlannerColumnType = typeof PlannerColumnType;

/**
 * The per-row cell content — a `value` and an optional muted `sublabel`
 * (eyebrow). A derived column is just a `value` computed in East; there is no
 * separate kind.
 *
 * @remarks
 * This is the serialised cell shape stored in the row's `cells` map, keyed by
 * the matching `PlannerColumnType.key`. Consumer code produces cell values via
 * the `value` and `sublabel` callbacks on each column definition — the builder
 * assembles this struct from those callbacks automatically.
 *
 * @property value - The cell text (a field or an East-computed value)
 * @property sublabel - The optional muted eyebrow line beneath the value
 */
export const PlannerCellType = StructType({
    value:    StringType,
    sublabel: OptionType(StringType),
});
export type PlannerCellType = typeof PlannerCellType;

// ============================================================================
// Variant + callback payloads
// ============================================================================

/**
 * Which chassis configuration this Planner is.
 *
 * @remarks
 * Set automatically by `Planner.Point(...)` and `Planner.Span(...)` — consumer
 * code never needs to construct this variant directly. The renderer uses it to
 * decide whether to treat events as single-cell tiles (`point`) or as
 * horizontal bars stretching from `slot` to `endSlot` (`span`).
 *
 * @property point - Slot-bound events (each event sits in one slot/bucket)
 * @property span - Multi-slot span events (start → end)
 */
export const PlannerVariantType = VariantType({
    point: NullType,
    span:  NullType,
});
export type PlannerVariantType = typeof PlannerVariantType;

/**
 * The payload of the `onSelectRow` callback (a row was clicked / selected).
 *
 * @remarks
 * Passed as the sole argument to the `East.function` supplied to `onSelectRow`
 * on the Planner root options. Use `Planner.Types.SelectEvent` to reference
 * this type when declaring that function's parameter list, as shown in the
 * `plannerPoint` example.
 *
 * @property rowIndex - The selected row's index (0-based)
 */
export const PlannerSelectEventType = StructType({ rowIndex: IntegerType });
export type PlannerSelectEventType = typeof PlannerSelectEventType;

/**
 * The payload of the per-row `review.onApprove` / `review.onReject` callbacks
 * (a row's Approve / Reject was clicked). Mirrors {@link PlannerSelectEventType}.
 *
 * @remarks
 * A structural twin of the shared review contract's `RowRefType`
 * (`contracts/review.ts`), kept for the same round-trip / import-graph
 * reasons as {@link PlannerApprovalType}. Prefer `RowRefType` in new code.
 *
 * @property rowIndex - The row's index (0-based)
 */
export const PlannerApproveEventType = StructType({ rowIndex: IntegerType });
export type PlannerApproveEventType = typeof PlannerApproveEventType;

// ============================================================================
// TypeScript input interfaces (UIComp-free)
// ============================================================================

/**
 * Shared options for the axis builders (`Planner.axis.*`).
 *
 * @property buckets - The labelled sub-slot buckets ([] = one slot per column)
 * @property format - Optional tick-label format pattern
 */
export interface AxisOptions {
    /** The labelled sub-slot buckets ([] = one slot per column). */
    buckets?: { key: string; label: string }[];
    /** Optional tick-label format pattern (e.g. `"MMM"` for a time axis). */
    format?: SubtypeExprOrValue<StringType>;
}

/**
 * Options for `Planner.axis.time` — extends {@link AxisOptions} with a datetime
 * extent and a column resolution.
 *
 * @remarks
 * Supply `range` to pin the visible calendar window regardless of event
 * coverage; omit it to let the renderer derive the extent from the earliest
 * and latest event slots. `min` and `max` accept a plain JS `Date` *or* a
 * `DateTimeType` expression (a data-driven calendar window) — the builder
 * coerces either to the `PlannerRangeType` `time` arm automatically.
 *
 * `resolution` sets the calendar unit of each slot column. Omitted (or
 * `"auto"`) it is inferred: a pinned `range` spanning ≤ 14 days derives one
 * column per day; anything else keeps one column per month. A pinned range is
 * a half-open calendar window `[min, max)` — `{ Mar 30 … Apr 6 }` at day
 * resolution is exactly the seven columns `Mar 30 … Apr 5`, so a sibling
 * Chart with the same `[min, max]` time domain lines its points up with the
 * column centres under a shared `AlignedStack` gutter. A data-derived extent
 * is closed instead: every observed slot's period gets a column, including
 * the last. `format` labels each column with the same date-pattern tokens as
 * Chart tick formats (`"ddd DD"` → `Mon 30`); omitted, a
 * resolution-appropriate default applies (hour `"HH:mm"`, day `"ddd DD"`,
 * week `"MMM DD"`, month `"MMM"` — `"MMM YYYY"` across years — and year
 * `"YYYY"`).
 *
 * @property buckets - The labelled sub-slot buckets ([] = one slot per column)
 * @property format - Optional tick-label format pattern (e.g. `"ddd DD"` for `Mon 30` day columns)
 * @property range - Optional explicit datetime extent (plain `Date` or expression); omit to derive from event slots
 * @property resolution - Optional column unit (see {@link PlannerResolutionType}); omit / `"auto"` to infer from the pinned range span
 */
export interface AxisTimeOptions extends AxisOptions {
    /** Optional explicit datetime extent — a half-open calendar window
     *  `[min, max)`; omit to derive a closed extent from the event slots.
     *  `min`/`max` accept a plain JS `Date` or a `DateTimeType` expression. */
    range?: { min: SubtypeExprOrValue<DateTimeType>; max: SubtypeExprOrValue<DateTimeType> };
    /** Optional column unit — one column per `"hour"` / `"day"` / `"week"` /
     *  `"month"` / `"quarter"` / `"year"`. Omit (or `"auto"`) to infer from the
     *  pinned range span (≤ 14 days ⇒ day, else month). */
    resolution?: SubtypeExprOrValue<PlannerResolutionType> | PlannerResolutionLiteral;
}

/**
 * Options for `Planner.axis.number` — extends {@link AxisOptions} with a numeric extent.
 *
 * @remarks
 * Supply `range` to fix the slot domain (e.g. days 1–31 for a monthly roster)
 * so the grid stays stable even when some slots have no events. Without it the
 * renderer derives `min` and `max` from the event slots present, which can
 * cause the grid to shrink on sparse days. `min`/`max` accept a plain JS
 * `number` *or* a `FloatType` expression, so the extent can be pinned to
 * runtime/bound data (e.g. `max: row.decision_day.toFloat()`).
 *
 * @property buckets - The labelled sub-slot buckets ([] = one slot per column)
 * @property format - Optional tick-label format pattern
 * @property range - Optional explicit numeric extent (plain `number` or expression); omit to derive from event slots
 */
export interface AxisNumberOptions extends AxisOptions {
    /** Optional explicit numeric extent; omit to derive from event slots.
     *  `min`/`max` accept a plain JS `number` or a `FloatType` expression. */
    range?: { min: SubtypeExprOrValue<FloatType>; max: SubtypeExprOrValue<FloatType> };
}

/**
 * Options for `Planner.axis.ordinal` — extends {@link AxisOptions} with an ordered category list.
 *
 * @remarks
 * `range` is the authoritative ordered label sequence for the axis columns —
 * the renderer renders one column per entry in declaration order. Without it
 * the renderer derives the order from the set of ordinal slot values present
 * in the events, which is insertion-ordered and may be unstable across data
 * updates. Supply it whenever column order is semantically meaningful (e.g.
 * workflow phases: `["backlog", "active", "review", "done"]`). Accepts a plain
 * JS `string[]` *or* an `Array<String>` expression (a data-driven category set).
 *
 * @property buckets - The labelled sub-slot buckets ([] = one slot per column)
 * @property format - Optional tick-label format pattern
 * @property range - Optional explicit ordered category labels (plain `string[]` or expression); omit to derive from event slots
 */
export interface AxisOrdinalOptions extends AxisOptions {
    /** Optional explicit ordered category labels; omit to derive from event slots.
     *  Accepts a plain JS `string[]` or an `Array<String>` expression. */
    range?: SubtypeExprOrValue<ArrayType<StringType>>;
}
