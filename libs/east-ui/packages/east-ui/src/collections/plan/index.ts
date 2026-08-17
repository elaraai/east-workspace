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
 * Rows are **flat and KEYED** in the IR (`Dict<String, PlanRow>`) with
 * `parent` keys; the kind factories nest via `rows:` / `groupBy`, and the
 * declared aggregates — span rollup bands (union / byStatus, `×k` peak
 * concurrency, summed quantities, pessimistic certainty), per-bucket heat
 * `mean`/`max`/`sum`, table subtotals, strip summaries and member counts — are
 * derived renderer-side from the tree the `parent` keys encode. Every factory
 * returns the row's **subtree** (`ExprType<PlanRowsCollectionType>`), so
 * factories compose: a nested `rows:` input is just other factories' results,
 * and a repeated key is one row, not two (#568).
 *
 * The module is the namespace assembler over the split sources:
 * `types.ts` (UIComp-free data) · `ir.ts` (resolved IR types) ·
 * `builders.ts` (value/cell builders) · `assemble.ts` (row envelope + eager
 * engines) · `factories.ts` (kind factories + chart consumption) ·
 * `data-forms.ts` (the accessor config surfaces + grouping engine) · `root.ts`
 * (templates + `Plan.Root`).
 *
 * @packageDocumentation
 */

import {
    PlanAxisType,
    PlanGrainType,
    PlanGutterType,
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
    PlanLinkType,
    PlanExpandAxisType,
    PlanElementRefType,
    PlanExpandType,
    PlanRunType,
    PlanDecisionMarkType,
    PlanBucketEventType,
    PlanChipType,
    PlanEventMarkType,
    PlanLaneType,
    PlanRowKindType,
    PlanRowType,
    PlanRowsCollectionType,
    PlanTemplateType,
} from "./types.js";
import { PlanReviewType, PlanRootType } from "./ir.js";
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
} from "./factories.js";

import {
    PlanSeriesType,
    createSeriesSpan,
    createSeriesBuckets,
    createSeriesChart,
    createSeriesHeat,
    createSeriesTable,
    createSeriesCards,
    createSeriesEvents,
    createSeriesGroup,
    createSeriesRows,
} from "./series.js";
import { createTemplate, createPlanRoot } from "./root.js";

// Re-export the UIComp-free types so consumers reach everything via this barrel.
export {
    PlanAxisType,
    type PlanAxisOptions,
    PlanGrainType,
    type PlanGrainLiteral,
    PlanGutterType,
    PlanGutterSwatchType,
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
    PlanLinkType,
    PlanExpandAxisType,
    type PlanExpandAxisLiteral,
    PlanElementRefType,
    PlanExpandType,
    PlanRunType,
    PlanDecisionMarkType,
    PlanBucketEventType,
    PlanChipType,
    PlanEventMarkType,
    PlanLaneType,
    PlanRowKindType,
    PlanRowType,
    PlanRowsCollectionType,
    PlanTemplateType,
    type PlanRowsValue,
} from "./types.js";

// ── Public surface — re-exported from the split modules ─────────────────────

export { PlanReviewType, PlanRootType } from "./ir.js";
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
export { type PlanExpandInput, type PlanRowBaseInput, type PlanRowsInput } from "./assemble.js";
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
    type PlanAccessor,
    type PlanSpanOfConfig,
    type PlanHeatOfConfig,
    type PlanTableOfConfig,
} from "./data-forms.js";
export { type PlanTemplateInput, type PlanReviewConfig, type PlanConfig } from "./root.js";
export {
    PlanSeriesType,
    type PlanSeriesValue,
    type PlanSeriesInput,
    type PlanSeriesEnvelopeConfig,
    type PlanSpanSeriesConfig,
    type PlanHeatSeriesConfig,
    type PlanTableSeriesOfConfig,
    type PlanBucketsSeriesConfig,
    type PlanCardsSeriesConfig,
    type PlanEventsSeriesConfig,
    type PlanChartSeriesConfig,
    type PlanGroupSeriesChrome,
    type PlanGroupSeriesByConfig,
} from "./series.js";

// ============================================================================
// Namespace
// ============================================================================

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
    /** Span-row SUBTREE builder (library `make` bodies + `series.rows` chrome). */
    span: typeof createSpan;
    /** Bucket-row subtree builder. */
    buckets: typeof createBuckets;
    /** Chart-row subtree builder — Chart layer builders consumed as data. */
    chart: typeof createChart;
    /** Heat-row subtree builder. */
    heat: typeof createHeat;
    /** Table-row subtree builder. */
    table: typeof createTable;
    /** Cards rows (Roster chips). */
    cards: typeof createCards;
    /** Event rows (instant marks). */
    events: typeof createEvents;
    /** Group strips (the heterogeneous container). */
    group: typeof createGroup;
    /** Data-driven row SERIES over one source (`data` + `series` props) —
     *  each builder takes the row type first and returns a real East series
     *  value (`Plan Data Interface.md` §3.5a). */
    series: {
        /** A span series (runs; groupBy rollup parents). */
        span: typeof createSeriesSpan;
        /** A bucket series (Planner tiles). */
        buckets: typeof createSeriesBuckets;
        /** A chart series (layers from each row's data). */
        chart: typeof createSeriesChart;
        /** A heat series (groupBy aggregate parents). */
        heat: typeof createSeriesHeat;
        /** A table series (groupBy subtotal parents). */
        table: typeof createSeriesTable;
        /** A cards series (Roster chips). */
        cards: typeof createSeriesCards;
        /** An events series (instant marks). */
        events: typeof createSeriesEvents;
        /** A group strip around child series. */
        group: typeof createSeriesGroup;
        /** Literal one-off chrome rows, placed by their own keys. */
        rows: typeof createSeriesRows;
    };
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
        /** The two grains (group / resource). */
        Grain: typeof PlanGrainType;
        /** One flat canvas row. */
        Row: typeof PlanRowType;
        /** The canvas's row COLLECTION — rows keyed by their stable `key`. */
        Rows: typeof PlanRowsCollectionType;
        /** The eight-arm row kind. */
        RowKind: typeof PlanRowKindType;
        /** The gutter identity. */
        Gutter: typeof PlanGutterType;
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
        /** The series type CONSTRUCTOR — `Plan.Types.Series(RowType)` gives the
         *  concrete variant type of one series over that row type. */
        Series: typeof PlanSeriesType;
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
        /** One canvas element by reference — the `popover` / `hover` resolvers' subject. */
        ElementRef: typeof PlanElementRefType;
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
 * `chart` / `heat` / `table` / `cards` / `events` / `group`, or drive them
 * from data with `Plan.series.*`), place content with the value
 * builders (`Plan.run` / `event` / `chip` / `mark` / …), and reach every
 * East type via `Plan.Types.*`.
 */
export const Plan: PlanNamespace = {
    Root: createPlanRoot,
    axis: createAxis,
    span: createSpan,
    buckets: createBuckets,
    chart: createChart,
    heat: createHeat,
    table: createTable,
    cards: createCards,
    events: createEvents,
    group: createGroup,
    series: {
        span: createSeriesSpan,
        buckets: createSeriesBuckets,
        chart: createSeriesChart,
        heat: createSeriesHeat,
        table: createSeriesTable,
        cards: createSeriesCards,
        events: createSeriesEvents,
        group: createSeriesGroup,
        rows: createSeriesRows,
    },
    run: createRun,
    decision: createDecision,
    port: createPort,
    event: createBucketEvent,
    lane: createLane,
    marker: createCellMarker,
    chip: createChip,
    mark: createEventMark,
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
        Rows: PlanRowsCollectionType,
        RowKind: PlanRowKindType,
        Gutter: PlanGutterType,
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
        Link: PlanLinkType,
        Expand: PlanExpandType,
        ExpandAxis: PlanExpandAxisType,
        Review: PlanReviewType,
        RowRef: PlanRowRefType,
        Series: PlanSeriesType,
        RunClickEvent: PlanRunClickEventType,
        EventClickEvent: PlanEventClickEventType,
        MarkClickEvent: PlanMarkClickEventType,
        ChipClickEvent: PlanChipClickEventType,
        CellClickEvent: PlanCellClickEventType,
        ElementRef: PlanElementRefType,
        GroupToggleEvent: PlanGroupToggleEventType,
        FooterItem: PlanFooterItemType,
        Style: PlanStyleType,
    },
};
