/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's resolved IR types — the UIComponent-coupled twins of the `Plan`
 * arm in `component.ts` (which spells the SAME shapes inline with the
 * recursion `node`). Keep the two in lockstep: every factory builds values of
 * these types and `Plan.Root` constructs the variant against the arm, so any
 * drift fails the specs at build time.
 *
 * @packageDocumentation
 */

import {
    type ExprType,
    ArrayType,
    BooleanType,
    DateTimeType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { IconType } from "../../display/icon/types.js";
import { StatusValueType } from "../../feedback/status/types.js";
import { ColorSchemeType } from "../../style/scheme.js";
import { EventStateType } from "../../contracts/states.js";
import { TickFormatType } from "../../format/types.js";
import { ApprovalStateType, reviewType, type ReviewStructType } from "../../contracts/approval.js";
import { CanDropFnType, DragEventType } from "../../contracts/drag.js";
import { SliceChromeType } from "../../platform/slice/index.js";
import { TableAggregateType } from "../table/types.js";
import {
    PlanAxisType,
    PlanGrainType,
    PlanGutterType,
    PlanDrillType,
    PlanExpandAxisType,
    PlanLinkType,
    PlanPortType,
    PlanRollupType,
    PlanCellMarkerType,
    PlanStretchType,
    PlanContentType,
    PlanAnimationType,
    PlanChartLayerType,
    PlanChartAxisType,
    PlanChartHeightType,
    PlanHeatCellsType,
    PlanAggregateType,
    PlanTableSeriesType,
    PlanTableSplitType,
    PlanTableEmphasisType,
    PlanEventMarkKindType,
    PlanRowRefType,
    PlanRunClickEventType,
    PlanEventClickEventType,
    PlanMarkClickEventType,
    PlanChipClickEventType,
    PlanCellClickEventType,
    PlanGroupToggleEventType,
    PlanFooterItemType,
    PlanStyleType,
    PlanTemplateKindType,
    PlanJourneyRibbonType,
} from "./types.js";

// ============================================================================
// Resolved types — the UIComponent-coupled shapes at `UIComponentType`
// ============================================================================
//
// Each definition is the named twin of the `Plan` arm in `component.ts`,
// which spells the SAME shape inline with the recursion `node` (the
// container convention). Keep the two in lockstep: every factory below
// builds values of these types and `Plan.Root` constructs the `Plan`
// variant against the arm, so any drift fails the specs at build time.

/**
 * One span run — a continuous `[start, end)` state-run bar
 * (`"RUN · B-214 · 96 t"`). Runs are quantity-bearing states, not tasks: no
 * dependency arrows, no critical path.
 *
 * @remarks
 * `quantity` is the displayed `.q` suffix (`"96 t"`); `qty` is the optional
 * numeric twin the factory sums into parent rollup bands — display and
 * arithmetic deliberately separate. `state` is the shared `EventStateType`
 * lifecycle driving the bar recipe; `status: warning` adds the `.stuck`
 * warn ring; `moved` collapses same-status churn to a `moved ×k` counter.
 */
export const PlanRunType = StructType({
    key: StringType,
    start: DateTimeType,
    end: DateTimeType,
    label: StringType,
    quantity: OptionType(StringType),
    qty: OptionType(FloatType),
    state: EventStateType,
    status: OptionType(StatusValueType),
    moved: OptionType(IntegerType),
    icon: OptionType(IconType),
    popover: OptionType(UIComponentType),
    hovercard: OptionType(UIComponentType),
});
/** Type alias for {@link PlanRunType}. */
export type PlanRunType = typeof PlanRunType;

/**
 * One decision mark — the ◇/◆ diamond sitting on the run transition it
 * fires (`applied` fills it).
 */
export const PlanDecisionMarkType = StructType({
    key: StringType,
    at: DateTimeType,
    applied: BooleanType,
    popover: OptionType(UIComponentType),
});
/** Type alias for {@link PlanDecisionMarkType}. */
export type PlanDecisionMarkType = typeof PlanDecisionMarkType;

/**
 * One bucket-event tile — the full Planner point-event grammar carried over
 * whole (everything `PlannerEventType` had except the slot-coordinate
 * variant — the axis is always the shared time scale — and `endSlot` —
 * multi-bucket spans are span rows).
 *
 * @remarks
 * `label: none` ⇒ the resting look — a ✓ chip for confirmed/actual, the
 * dashed `plan` chip for proposed. `icon` with `label: none` ⇒ an icon-only
 * tile. In a laned row, `lane: none` is the mixed grammar — the tile takes
 * the full cell across lanes.
 */
export const PlanBucketEventType = StructType({
    key: StringType,
    at: DateTimeType,
    lane: OptionType(StringType),
    label: OptionType(StringType),
    icon: OptionType(IconType),
    state: EventStateType,
    tone: OptionType(StatusValueType),
    color: OptionType(StringType),
    colorPalette: OptionType(ColorSchemeType),
    stretch: OptionType(PlanStretchType),
    content: OptionType(PlanContentType),
    animation: OptionType(PlanAnimationType),
    popover: OptionType(UIComponentType),
    hovercard: OptionType(UIComponentType),
});
/** Type alias for {@link PlanBucketEventType}. */
export type PlanBucketEventType = typeof PlanBucketEventType;

/**
 * One cards chip — a Roster shift chip spanning whole buckets. `confirmed`
 * renders the brand-tint chip, proposals dashed (`+64h`),
 * `proposed(removed)` the warn strikethrough, `estimated` the faint ghost a
 * tap would accept.
 */
export const PlanChipType = StructType({
    key: StringType,
    from: DateTimeType,
    to: DateTimeType,
    label: StringType,
    state: EventStateType,
    icon: OptionType(IconType),
    popover: OptionType(UIComponentType),
});
/** Type alias for {@link PlanChipType}. */
export type PlanChipType = typeof PlanChipType;

/**
 * One event-row mark — ● milestone · ◇/◆ decision · ▲ exception at an
 * instant. Clusters collapse to `◇ ×3` in the renderer; labels print when
 * there is room. `icon` swaps the kind's default glyph for an FA icon
 * (12px, still kind-coloured) — hosts choose the glyph, never the geometry.
 */
export const PlanEventMarkType = StructType({
    key: StringType,
    at: DateTimeType,
    kind: PlanEventMarkKindType,
    icon: OptionType(IconType),
    label: OptionType(StringType),
    popover: OptionType(UIComponentType),
});
/** Type alias for {@link PlanEventMarkType}. */
export type PlanEventMarkType = typeof PlanEventMarkType;

/**
 * One bucket-row lane — a sub-slot within each column cell (`AM`/`PM`).
 * `label: none` renders an unlabelled lane strip.
 */
export const PlanLaneType = StructType({
    key: StringType,
    label: OptionType(StringType),
});
/** Type alias for {@link PlanLaneType}. */
export type PlanLaneType = typeof PlanLaneType;

/**
 * The eight-arm row kind — `group · span · buckets · chart · heat · table ·
 * cards · events` — each keeping its source component's rendered surface.
 *
 * @remarks
 * `span` positions continuously (real datetimes, may cross bucket edges);
 * `buckets` / `heat` / `table` / `cards` quantise to the bucket grid;
 * `chart` draws per-bucket and continuous marks; `events` places instant
 * marks; `group` is the heterogeneous container whose collapsed form is
 * its `summary` heat strip.
 */
export const PlanRowKindType = VariantType({
    group: StructType({
        summary: OptionType(PlanHeatCellsType),
        summaryAggregate: OptionType(PlanAggregateType),
        collapsed: OptionType(BooleanType),
    }),
    span: StructType({
        runs: ArrayType(PlanRunType),
        decisions: ArrayType(PlanDecisionMarkType),
        ports: ArrayType(PlanPortType),
        rollup: OptionType(PlanRollupType),
        unit: OptionType(StringType),
    }),
    buckets: StructType({
        lanes: ArrayType(PlanLaneType),
        events: ArrayType(PlanBucketEventType),
        markers: ArrayType(PlanCellMarkerType),
    }),
    chart: StructType({
        layers: ArrayType(PlanChartLayerType),
        left: OptionType(PlanChartAxisType),
        right: OptionType(PlanChartAxisType),
        height: PlanChartHeightType,
        /** Height the EXPANDED state opens to, a CSS px size like every
         *  component height (`"120px"`; `none` ⇒ the 88px default). */
        expandedHeight: OptionType(StringType),
        expandable: OptionType(BooleanType),
    }),
    heat: StructType({
        cells: PlanHeatCellsType,
        aggregate: OptionType(PlanAggregateType),
    }),
    table: StructType({
        series: ArrayType(PlanTableSeriesType),
        split: PlanTableSplitType,
        aggregate: OptionType(TableAggregateType),
        format: OptionType(TickFormatType),
        emphasis: PlanTableEmphasisType,
    }),
    cards: StructType({
        chips: ArrayType(PlanChipType),
    }),
    events: StructType({
        marks: ArrayType(PlanEventMarkType),
    }),
});
/** Type alias for {@link PlanRowKindType}. */
export type PlanRowKindType = typeof PlanRowKindType;

/**
 * A row's expand-in-place declaration (R2) — the developer render mounted
 * under the row's own content when the `expand` control fires: the row grows
 * to `height` (a CSS px size; `none` ⇒ 152px, clamped to the canvas),
 * neighbours compress to 16px context strips, and `axis` chooses how the
 * shared grid + now-line run through the render.
 */
export const PlanExpandType = StructType({
    render: FunctionType([], UIComponentType),
    height: OptionType(StringType),
    axis: PlanExpandAxisType,
});
/** Type alias for {@link PlanExpandType}. */
export type PlanExpandType = typeof PlanExpandType;

/**
 * One flat canvas row.
 *
 * @remarks
 * Rows are flat, in depth-first order; `parent` keys encode the tree
 * (depth structurally unlimited — the Table `groupBy` guarantee). `pinned`
 * rows render above the virtualised body under the ruler; `height` is a
 * fixed CSS-px override; `status` the quiet gutter dot; `approval` the
 * review verdict (rendered only with the root's review chrome); `drill`
 * the in-place 96px expansion payload; `expand` the R2 developer render.
 */
export const PlanRowType = StructType({
    key: StringType,
    parent: OptionType(StringType),
    gutter: PlanGutterType,
    kind: PlanRowKindType,
    pinned: OptionType(BooleanType),
    height: OptionType(StringType),
    status: OptionType(StatusValueType),
    approval: OptionType(ApprovalStateType),
    drill: OptionType(PlanDrillType),
    expand: OptionType(PlanExpandType),
});
/** Type alias for {@link PlanRowType}. */
export type PlanRowType = typeof PlanRowType;

/**
 * One row-library template — a kind + label card whose `make` function IS
 * the binding: it builds the live row subtree (`ArrayType(PlanRowType)` —
 * the same flattened shape every kind factory returns) from captured data
 * and bind-handles, so a dropped row is live immediately. Templates are
 * plain East data: a host can store the library in a dataset.
 */
export const PlanTemplateType = StructType({
    key: StringType,
    label: StringType,
    sublabel: OptionType(StringType),
    kind: PlanTemplateKindType,
    icon: OptionType(IconType),
    make: FunctionType([], ArrayType(PlanRowType)),
});
/** Type alias for {@link PlanTemplateType}. */
export type PlanTemplateType = typeof PlanTemplateType;

/**
 * The K8 journey overlay — one item's story: ancestors above, descendants
 * below, quantity ribbons between run edges, decision diamonds on the
 * transitions. Item families are domain data the canvas cannot derive, so
 * the ITEM grain and the drilled row's `open item journey →` resolve
 * through the root's `journeys` behavior prop at interaction time.
 */
export const PlanJourneyType = StructType({
    title: StringType,
    rows: ArrayType(StructType({
        key: StringType,
        label: StringType,
        sublabel: OptionType(StringType),
        runs: ArrayType(PlanRunType),
    })),
    ribbons: ArrayType(PlanJourneyRibbonType),
    decisions: ArrayType(PlanDecisionMarkType),
});
/** Type alias for {@link PlanJourneyType}. */
export type PlanJourneyType = typeof PlanJourneyType;

/**
 * The Plan review config — the shared review contract at the Plan's
 * keyed-row subject (`{ key }`).
 */
export const PlanReviewType: ReviewStructType<PlanRowRefType, UIComponentType> = reviewType(PlanRowRefType, UIComponentType);
/** Type alias for {@link PlanReviewType}. */
export type PlanReviewType = typeof PlanReviewType;

/**
 * The Plan root IR — the whole canvas.
 *
 * @remarks
 * Window and resolution deliberately have **no callbacks**: they are slice
 * writes (`setRange` / `setResolution`) — hosts observe the slice. Row
 * order is data (no sort callback), and there are no double-click
 * callbacks — a second row click *is* drill, and element detail lives in
 * popovers.
 */
export const PlanRootType = StructType({
    rows: ArrayType(PlanRowType),
    // The link graph (R1) — run-edge to run-edge quantity links; the
    // links-focus control gathers a row's transitive family over it.
    links: ArrayType(PlanLinkType),
    axis: PlanAxisType,
    grain: OptionType(PlanGrainType),
    library: ArrayType(PlanTemplateType),
    journeys: OptionType(FunctionType([StringType], PlanJourneyType)),
    review: OptionType(PlanReviewType),
    slice: OptionType(SliceChromeType),
    footer: ArrayType(PlanFooterItemType),
    // DnD target role — the shared grammar verbatim (contracts/drag.ts).
    id: StringType,
    sources: ArrayType(StringType),
    onDrag: OptionType(FunctionType([DragEventType], NullType)),
    canDrop: OptionType(CanDropFnType),
    // Selection / drill (click selects, second click drills) + per-element clicks.
    onSelect: OptionType(FunctionType([PlanRowRefType], NullType)),
    onDrill: OptionType(FunctionType([PlanRowRefType], NullType)),
    onRunClick: OptionType(FunctionType([PlanRunClickEventType], NullType)),
    onEventClick: OptionType(FunctionType([PlanEventClickEventType], NullType)),
    onMarkClick: OptionType(FunctionType([PlanMarkClickEventType], NullType)),
    onChipClick: OptionType(FunctionType([PlanChipClickEventType], NullType)),
    onCellClick: OptionType(FunctionType([PlanCellClickEventType], NullType)),
    onGroupToggle: OptionType(FunctionType([PlanGroupToggleEventType], NullType)),
    onGrainChange: OptionType(FunctionType([PlanGrainType], NullType)),
    style: OptionType(PlanStyleType),
});
/** Type alias for {@link PlanRootType}. */
export type PlanRootType = typeof PlanRootType;

/** The flattened-subtree shape every kind factory returns. */
export type PlanRowsValue = ExprType<ArrayType<PlanRowType>>;
