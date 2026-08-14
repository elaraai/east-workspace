/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Plan` — the temporally-aligned composite canvas. One shared time axis;
 * heterogeneous rows: span rows (Gantt state-runs), bucket rows (Planner
 * lanes), chart rows (Chart layers consumed as data), heat/table rows (Matrix
 * cells / bucketed numerals), cards rows (Roster chips) and event rows —
 * sliced and reviewed as one surface.
 *
 * Rows are **flat** in the IR with `parent` keys; the kind factories nest via
 * `rows:` / `groupBy` and compute parent aggregates **eagerly**: span rollup
 * bands (union / byStatus, `×k` peak concurrency, summed quantities,
 * pessimistic certainty), per-bucket heat `mean`/`max`/`sum`, and table
 * subtotals. Every factory returns the row's **flattened subtree**
 * (`ExprType<ArrayType<PlanRowType>>`), so factories compose: a nested
 * `rows:` input is just other factories' results.
 *
 * The module is the namespace assembler over the split sources:
 * `types.ts` (UIComp-free data) · `ir.ts` (resolved IR types) ·
 * `builders.ts` (value/cell builders) · `assemble.ts` (row envelope + eager
 * engines) · `factories.ts` (kind factories + chart consumption) ·
 * `data-forms.ts` (`Plan.rows` + the `.of` accessor forms) · `root.ts`
 * (templates + `Plan.Root`).
 *
 * @packageDocumentation
 */

import {
    PlanAxisType,
    PlanGrainType,
    PlanGutterType,
    PlanDrillType,
    PlanPortType,
    PlanRollupType,
    PlanCellMarkerType,
    PlanStretchType,
    PlanContentType,
    PlanAnimationType,
    PlanChartPointType,
    PlanAxisSideType,
    PlanBreachType,
    PlanChartAxisType,
    PlanChartLayerType,
    PlanChartHeightType,
    PlanHeatCellType,
    PlanWeightCellType,
    PlanSegmentType,
    PlanSegmentCellType,
    PlanHeatCellsType,
    PlanAggregateType,
    PlanTableToneType,
    PlanTableCellType,
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
    PlanLinkType,
    PlanExpandAxisType,
} from "./types.js";
import {
    PlanExpandType,
    PlanRunType,
    PlanDecisionMarkType,
    PlanBucketEventType,
    PlanChipType,
    PlanEventMarkType,
    PlanLaneType,
    PlanRowKindType,
    PlanRowType,
    PlanTemplateType,
    PlanJourneyType,
    PlanReviewType,
    PlanRootType,
    type PlanRowsValue,
} from "./ir.js";
import {
    createAxis,
    createRun,
    createDecision,
    createPort,
    createBucketEvent,
    createLane,
    createCellMarker,
    createChip,
    createEventMark,
    markKind,
    createHeatCells,
    createWeightCells,
    createSegmentCells,
    createSegment,
    createTableCells,
    createTableSeries,
    createLink,
} from "./builders.js";
import { createDrill } from "./assemble.js";
import {
    createLayer,
    createFixedHeight,
    createSpan,
    createBuckets,
    createChart,
    createHeat,
    createTable,
    createCards,
    createEvents,
    createGroup,
    type PlanSpanInput,
    type PlanHeatInput,
    type PlanTableInput,
} from "./factories.js";
import { createRows, createSpanOf, createHeatOf, createTableOf } from "./data-forms.js";
import { createTemplate, createPlanRoot } from "./root.js";

// Re-export the UIComp-free types so consumers reach everything via this barrel.
export {
    PlanAxisType,
    type PlanAxisOptions,
    PlanGrainType,
    type PlanGrainLiteral,
    PlanGutterType,
    PlanGutterSwatchType,
    PlanDrillType,
    PlanDrillPointType,
    PlanPortType,
    PlanRollupType,
    type PlanRollupLiteral,
    PlanCellMarkerType,
    PlanStretchType,
    type PlanStretchLiteral,
    PlanContentAlignType,
    type PlanContentAlignLiteral,
    PlanContentType,
    PlanAnimationType,
    type PlanAnimationLiteral,
    PlanChartPointType,
    PlanAxisSideType,
    type PlanAxisSideLiteral,
    PlanBreachType,
    PlanChartBandPointType,
    PlanChartAxisType,
    PlanChartLayerType,
    PlanChartHeightType,
    type PlanChartHeightLiteral,
    PlanHeatCellType,
    PlanWeightCellType,
    PlanSegmentType,
    PlanSegmentCellType,
    PlanHeatCellsType,
    PlanAggregateType,
    type PlanAggregateLiteral,
    PlanTableToneType,
    type PlanTableToneLiteral,
    PlanTableCellType,
    PlanTableSeriesType,
    PlanTableSplitType,
    type PlanTableSplitLiteral,
    PlanTableEmphasisType,
    type PlanTableEmphasisLiteral,
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
    type PlanTemplateKindLiteral,
    PlanJourneyRibbonType,
    PlanLinkType,
    PlanExpandAxisType,
    type PlanExpandAxisLiteral,
} from "./types.js";

// ── Public surface — re-exported from the split modules ─────────────────────

export {
    PlanExpandType,
    PlanRunType,
    PlanDecisionMarkType,
    PlanBucketEventType,
    PlanChipType,
    PlanEventMarkType,
    PlanLaneType,
    PlanRowKindType,
    PlanRowType,
    PlanTemplateType,
    PlanJourneyType,
    PlanReviewType,
    PlanRootType,
    type PlanRowsValue,
} from "./ir.js";
export {
    resolvePlanEventState,
    type PlanIconInput,
    type PlanRunInput,
    type PlanDecisionInput,
    type PlanPortInput,
    type PlanBucketEventInput,
    type PlanLaneInput,
    type PlanCellMarkerInput,
    type PlanChipInput,
    type PlanEventMarkInput,
    type PlanHeatCellsOptions,
    type PlanSegmentInput,
    type PlanTableSeriesInput,
    type PlanLinkInput,
} from "./builders.js";
export { type PlanDrillInput, type PlanExpandInput, type PlanRowBaseInput, type PlanRowsInput } from "./assemble.js";
export {
    type PlanLayerChannels,
    type PlanWrappedLayer,
    type PlanChartLayerInput,
    type PlanChartAxisInput,
    type PlanSpanInput,
    type PlanBucketsInput,
    type PlanChartInput,
    type PlanHeatInput,
    type PlanTableInput,
    type PlanCardsInput,
    type PlanEventsInput,
    type PlanGroupInput,
} from "./factories.js";
export {
    type RowElement,
    type PlanGroupByLevel,
    type PlanRowsGroupConfig,
    type PlanSpanOfConfig,
    type PlanHeatOfConfig,
    type PlanTableOfConfig,
} from "./data-forms.js";
export { type PlanTemplateInput, type PlanReviewConfig, type PlanConfig } from "./root.js";

// ============================================================================
// Namespace
// ============================================================================

/** The callable-with-`.of` shape of `Plan.span`. */
export interface PlanSpanFactory {
    /** Creates a span row (see {@link Plan.span}). */
    (input: PlanSpanInput): PlanRowsValue;
    /** The accessor-driven `.of` form. */
    of: typeof createSpanOf;
}

/** The callable-with-`.of` shape of `Plan.heat`. */
export interface PlanHeatFactory {
    /** Creates a heat row (see {@link Plan.heat}). */
    (input: PlanHeatInput): PlanRowsValue;
    /** The accessor-driven `.of` form. */
    of: typeof createHeatOf;
}

/** The callable-with-`.of` shape of `Plan.table`. */
export interface PlanTableFactory {
    /** Creates a table row (see {@link Plan.table}). */
    (input: PlanTableInput): PlanRowsValue;
    /** The accessor-driven `.of` form. */
    of: typeof createTableOf;
}

const spanFactory: PlanSpanFactory = Object.assign(createSpan, { of: createSpanOf });
const heatFactory: PlanHeatFactory = Object.assign(createHeat, { of: createHeatOf });
const tableFactory: PlanTableFactory = Object.assign(createTable, { of: createTableOf });

/**
 * The type of the {@link Plan} namespace. Declared explicitly (rather than
 * inferred from `as const`) so the declaration emit stays within
 * TypeScript's serialization limit.
 */
export interface PlanNamespace {
    /** Creates the Plan root (the `<Plan>` tag's factory). */
    Root: typeof createPlanRoot;
    /** Builds the shared time-axis declaration. */
    axis: typeof createAxis;
    /** Span rows (the Gantt surface) — callable, plus the accessor `.of` form. */
    span: PlanSpanFactory;
    /** Bucket rows (the Planner surface). */
    buckets: typeof createBuckets;
    /** Chart rows — Chart layer builders consumed as data. */
    chart: typeof createChart;
    /** Heat rows (the Matrix cell recipes) — callable, plus `.of`. */
    heat: PlanHeatFactory;
    /** Table rows (bucketed numerals) — callable, plus `.of`. */
    table: PlanTableFactory;
    /** Cards rows (Roster chips). */
    cards: typeof createCards;
    /** Event rows (instant marks). */
    events: typeof createEvents;
    /** Group strips (the heterogeneous container). */
    group: typeof createGroup;
    /** Data-driven rows — per-element constructor or grouped config. */
    rows: typeof createRows;
    /** Builds one span run. */
    run: typeof createRun;
    /** Builds one decision diamond. */
    decision: typeof createDecision;
    /** Builds one quantity port glyph. */
    port: typeof createPort;
    /** Builds one bucket-event tile. */
    event: typeof createBucketEvent;
    /** Builds one bucket-row lane. */
    lane: typeof createLane;
    /** Builds one bucket-cell status marker. */
    marker: typeof createCellMarker;
    /** Builds one cards chip. */
    chip: typeof createChip;
    /** Builds one event-row mark. */
    mark: typeof createEventMark;
    /** Builds one drill payload value (put it IN data rows — `drill: some(Plan.drill({…}))`). */
    drill: typeof createDrill;
    /** Builds one link edge of the canvas's link graph (`Plan.Root`'s `links`). */
    link: typeof createLink;
    /** Non-null mark-kind builders (`Plan.markKind.decision(applied)`). */
    markKind: typeof markKind;
    /** Wraps heat cells into the `heat` arm (scale + warn threshold). */
    heatCells: typeof createHeatCells;
    /** Wraps weight cells into the `weight` arm. */
    weightCells: typeof createWeightCells;
    /** Wraps segment cells into the `segments` arm. */
    segmentCells: typeof createSegmentCells;
    /** Builds one segment of a segment cell. */
    segment: typeof createSegment;
    /** Builds formatted per-bucket table cells from raw values. */
    tableCells: typeof createTableCells;
    /** Builds one table-row value series (per-position style, raw cells). */
    tableSeries: typeof createTableSeries;
    /** Wraps a Chart layer with the Plan-only channels (axis / breach / series). */
    layer: typeof createLayer;
    /** Pins a chart row to an explicit pixel height. */
    fixed: typeof createFixedHeight;
    /** Builds one row-library template (the binding rides `make`). */
    template: typeof createTemplate;
    /** The Plan East types. */
    Types: {
        /** The Plan root IR ({@link PlanRootType}). */
        Root: typeof PlanRootType;
        /** The shared time-axis declaration. */
        Axis: typeof PlanAxisType;
        /** The three grains (group / resource / item). */
        Grain: typeof PlanGrainType;
        /** One flat canvas row. */
        Row: typeof PlanRowType;
        /** The eight-arm row kind. */
        RowKind: typeof PlanRowKindType;
        /** The gutter identity. */
        Gutter: typeof PlanGutterType;
        /** The drilled-row payload. */
        Drill: typeof PlanDrillType;
        /** One span run. */
        Run: typeof PlanRunType;
        /** One decision diamond. */
        DecisionMark: typeof PlanDecisionMarkType;
        /** One quantity port. */
        Port: typeof PlanPortType;
        /** The rollup mode (union / byStatus / sum). */
        Rollup: typeof PlanRollupType;
        /** One bucket-event tile. */
        BucketEvent: typeof PlanBucketEventType;
        /** One bucket-row lane. */
        Lane: typeof PlanLaneType;
        /** One bucket-cell status marker. */
        CellMarker: typeof PlanCellMarkerType;
        /** The tile fill axis. */
        Stretch: typeof PlanStretchType;
        /** The tile two-axis content alignment. */
        Content: typeof PlanContentType;
        /** The tile attention animation. */
        Animation: typeof PlanAnimationType;
        /** One data-only chart layer. */
        ChartLayer: typeof PlanChartLayerType;
        /** One `{t, y}` chart point. */
        ChartPoint: typeof PlanChartPointType;
        /** A chart y-axis declaration. */
        ChartAxis: typeof PlanChartAxisType;
        /** The chart height mode (spark / expanded / fixed). */
        ChartHeight: typeof PlanChartHeightType;
        /** The y-axis side (left / right). */
        AxisSide: typeof PlanAxisSideType;
        /** A breach threshold. */
        Breach: typeof PlanBreachType;
        /** A heat row's cells (heat / weight / segments). */
        HeatCells: typeof PlanHeatCellsType;
        /** One heat cell. */
        HeatCell: typeof PlanHeatCellType;
        /** One weight cell. */
        WeightCell: typeof PlanWeightCellType;
        /** One segment cell. */
        SegmentCell: typeof PlanSegmentCellType;
        /** One segment of a segment cell. */
        Segment: typeof PlanSegmentType;
        /** The heat aggregation mode. */
        Aggregate: typeof PlanAggregateType;
        /** One table cell. */
        TableCell: typeof PlanTableCellType;
        /** One table-row value series (cells + per-position style). */
        TableSeries: typeof PlanTableSeriesType;
        /** The multi-series part layout (horizontal / vertical). */
        TableSplit: typeof PlanTableSplitType;
        /** The table-cell tone. */
        TableTone: typeof PlanTableToneType;
        /** The table-row emphasis. */
        TableEmphasis: typeof PlanTableEmphasisType;
        /** One cards chip. */
        Chip: typeof PlanChipType;
        /** One event mark. */
        EventMark: typeof PlanEventMarkType;
        /** The event-mark kind. */
        EventMarkKind: typeof PlanEventMarkKindType;
        /** One row-library template. */
        Template: typeof PlanTemplateType;
        /** The template kind. */
        TemplateKind: typeof PlanTemplateKindType;
        /** The K8 journey overlay. */
        Journey: typeof PlanJourneyType;
        /** One journey ribbon. */
        JourneyRibbon: typeof PlanJourneyRibbonType;
        /** One link edge of the canvas's link graph (the ribbon shape). */
        Link: typeof PlanLinkType;
        /** A row's expand-in-place declaration (R2). */
        Expand: typeof PlanExpandType;
        /** The expand render's axis treatment (keep / dim / off). */
        ExpandAxis: typeof PlanExpandAxisType;
        /** The review config at the keyed-row subject. */
        Review: typeof PlanReviewType;
        /** The keyed row-subject reference. */
        RowRef: typeof PlanRowRefType;
        /** The `onRunClick` payload. */
        RunClickEvent: typeof PlanRunClickEventType;
        /** The `onEventClick` payload. */
        EventClickEvent: typeof PlanEventClickEventType;
        /** The `onMarkClick` payload. */
        MarkClickEvent: typeof PlanMarkClickEventType;
        /** The `onChipClick` payload. */
        ChipClickEvent: typeof PlanChipClickEventType;
        /** The `onCellClick` payload. */
        CellClickEvent: typeof PlanCellClickEventType;
        /** The `onGroupToggle` payload. */
        GroupToggleEvent: typeof PlanGroupToggleEventType;
        /** One status-footer item. */
        FooterItem: typeof PlanFooterItemType;
        /** The Plan style. */
        Style: typeof PlanStyleType;
    };
}

/**
 * The `Plan` namespace — the temporally-aligned composite canvas. Assemble a
 * Plan with `Plan.Root` (the `<Plan>` tag), declare the axis with
 * `Plan.axis`, build rows with the kind factories (`Plan.span` / `buckets` /
 * `chart` / `heat` / `table` / `cards` / `events` / `group`, plus the
 * data-driven `Plan.rows` and `.of` forms), place content with the value
 * builders (`Plan.run` / `event` / `chip` / `mark` / …), and reach every
 * East type via `Plan.Types.*`.
 */
export const Plan: PlanNamespace = {
    Root: createPlanRoot,
    axis: createAxis,
    span: spanFactory,
    buckets: createBuckets,
    chart: createChart,
    heat: heatFactory,
    table: tableFactory,
    cards: createCards,
    events: createEvents,
    group: createGroup,
    rows: createRows,
    run: createRun,
    decision: createDecision,
    port: createPort,
    event: createBucketEvent,
    lane: createLane,
    marker: createCellMarker,
    chip: createChip,
    mark: createEventMark,
    drill: createDrill,
    link: createLink,
    markKind,
    heatCells: createHeatCells,
    weightCells: createWeightCells,
    segmentCells: createSegmentCells,
    segment: createSegment,
    tableCells: createTableCells,
    tableSeries: createTableSeries,
    layer: createLayer,
    fixed: createFixedHeight,
    template: createTemplate,
    Types: {
        Root: PlanRootType,
        Axis: PlanAxisType,
        Grain: PlanGrainType,
        Row: PlanRowType,
        RowKind: PlanRowKindType,
        Gutter: PlanGutterType,
        Drill: PlanDrillType,
        Run: PlanRunType,
        DecisionMark: PlanDecisionMarkType,
        Port: PlanPortType,
        Rollup: PlanRollupType,
        BucketEvent: PlanBucketEventType,
        Lane: PlanLaneType,
        CellMarker: PlanCellMarkerType,
        Stretch: PlanStretchType,
        Content: PlanContentType,
        Animation: PlanAnimationType,
        ChartLayer: PlanChartLayerType,
        ChartPoint: PlanChartPointType,
        ChartAxis: PlanChartAxisType,
        ChartHeight: PlanChartHeightType,
        AxisSide: PlanAxisSideType,
        Breach: PlanBreachType,
        HeatCells: PlanHeatCellsType,
        HeatCell: PlanHeatCellType,
        WeightCell: PlanWeightCellType,
        SegmentCell: PlanSegmentCellType,
        Segment: PlanSegmentType,
        Aggregate: PlanAggregateType,
        TableCell: PlanTableCellType,
        TableSeries: PlanTableSeriesType,
        TableSplit: PlanTableSplitType,
        TableTone: PlanTableToneType,
        TableEmphasis: PlanTableEmphasisType,
        Chip: PlanChipType,
        EventMark: PlanEventMarkType,
        EventMarkKind: PlanEventMarkKindType,
        Template: PlanTemplateType,
        TemplateKind: PlanTemplateKindType,
        Journey: PlanJourneyType,
        JourneyRibbon: PlanJourneyRibbonType,
        Link: PlanLinkType,
        Expand: PlanExpandType,
        ExpandAxis: PlanExpandAxisType,
        Review: PlanReviewType,
        RowRef: PlanRowRefType,
        RunClickEvent: PlanRunClickEventType,
        EventClickEvent: PlanEventClickEventType,
        MarkClickEvent: PlanMarkClickEventType,
        ChipClickEvent: PlanChipClickEventType,
        CellClickEvent: PlanCellClickEventType,
        GroupToggleEvent: PlanGroupToggleEventType,
        FooterItem: PlanFooterItemType,
        Style: PlanStyleType,
    },
};
