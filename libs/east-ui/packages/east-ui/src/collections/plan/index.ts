/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Plan` — the axis-aligned composite canvas. One shared axis
 * (`{ time | number | ordinal }`, declared once and carried by every element
 * instant — #631); heterogeneous rows: span rows (Gantt state-runs), bucket
 * rows (Planner lanes), chart rows (Chart layers consumed as data),
 * heat/table rows (Matrix cells / bucketed numerals), cards rows (Roster
 * chips) and event rows — sliced and reviewed as one surface.
 *
 * A canvas is DEFINED as `data` + `series`: a keyed source of entries, and a
 * list of `Plan.series.*` row recipes over them (`Plan.pick` makes the list
 * pickable). The list IS the layout — each series contributes its rows in
 * declared order, as blocks (#823: a data series one block of its entries'
 * rows, a section its header and then its members') — and the rows are an
 * ordered STREAM (`Array<PlanRow>`, #822), each parent followed by its subtree. The kind
 * factories (`Plan.span` / `buckets` / … / `group`) build the rows no dataset
 * holds, placed by a `Plan.series.rows` entry.
 *
 * Hierarchy comes only from the data's own nesting: a series' `children` walk
 * more of its own entries (a recursive entry, to any depth) or step down with
 * `Plan.children(of, [series…])`; `Plan.series.section` titles a block and
 * `Plan.series.views` shows one entry several ways. The declared aggregates —
 * span rollup bands (union / byStatus, `×k` peak concurrency, summed
 * quantities, pessimistic certainty), per-bucket heat `mean`/`max`/`sum`,
 * table subtotals, strip summaries and member counts — are derived
 * renderer-side from the tree the rows' `parent` ids encode, and are exact
 * because a whole subtree rides in its entry. Every row carries a typed id
 * (`{ series, path }` — `Plan.ref` builds one), which every callback reports.
 *
 * The module is the namespace assembler over the split sources:
 * `types.ts` (the UIComponent-free row vocabulary) · `ir.ts` (the root and
 * review types at `UIComponentType`) · `builders.ts` (the axis, instant,
 * element and cell builders, and row ids) · `assemble.ts` (the one row
 * envelope, the row streams and their re-basing) · `factories.ts` (the kind
 * factories, the per-kind constructors and chart-layer consumption) ·
 * `series.ts` (`Plan.series.*`, `Plan.children` and their application to
 * `data`) · `pick.ts` (`Plan.pick` / `Plan.pickItems`) · `root.ts`
 * (`Plan.Root`).
 *
 * @packageDocumentation
 */

import {
    PlanAxisType,
    PlanTimeAxisType,
    PlanNumberAxisType,
    PlanOrdinalAxisType,
    PlanInstantType,
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
    PlanRowIdType,
    PlanRunRefType,
    PlanGroupToggleEventType,
    PlanFooterItemType,
    PlanStyleType,
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
    PlanBlockType,
    PlanBlocksType,
    PlanFoldType,
    PlanQuantityType,
    PlanHeatScaleType,
    PlanGroupSummaryType,
    PlanUiStateType,
    PlanUiBindType,
} from "./types.js";
import { PlanReviewType, PlanRootType } from "./ir.js";
import {
    createAxis,
    at,
    createQuantity,
    createUiState,
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
    createRef,
    createSectionRef,
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
    createSeriesSection,
    createSeriesViews,
    createSeriesRows,
    createChildren,
} from "./series.js";
import { createPlanRoot } from "./root.js";
import { createPlanPick, createPlanPickItems } from "./pick.js";

// Re-export the UIComp-free types so consumers reach everything via this barrel.
export {
    PlanAxisType,
    PlanTimeAxisType,
    PlanNumberAxisType,
    PlanOrdinalAxisType,
    PlanInstantType,
    type PlanInstantLikeType,
    type PlanInstantInput,
    type PlanAxisKindLiteral,
    PlanAxisKindBrand,
    type PlanKinded,
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
    type PlanElementsInput,
    type PlanRecordInput,
    type PlanKindedRecord,
    type PlanCellsInput,
    type PlanHeatCellsInput,
    type PlanTableCellsInput,
    type PlanAxisInput,
    type PlanAxisOptions,
    type PlanNumberAxisOptions,
    type PlanOrdinalAxisOptions,
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
    PlanRowIdType,
    PlanRunRefType,
    PlanGroupToggleEventType,
    PlanFooterItemType,
    PlanStyleType,
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
    type PlanRowsValue,
    PlanBlockType,
    PlanBlocksType,
    type PlanBlocksValue,
    PlanFoldType,
    type PlanFoldLiteral,
    PlanQuantityType,
    PlanHeatScaleType,
    PlanGroupSummaryType,
    PlanUiStateType,
    PlanUiBindType,
} from "./types.js";

// ── Public surface — re-exported from the split modules ─────────────────────

export { PlanReviewType, PlanRootType } from "./ir.js";
export {
    resolvePlanEventState,
    resolveInstant,
    type PlanAxisBuilder,
    type PlanRawTableCellType,
    type PlanIconInput,
    type PlanFoldInput,
    type PlanQuantityOptions,
    type PlanHeatScaleInput,
    type PlanCellsFoldOptions,
    type PlanUiStateInput,
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
export { type PlanExpandInput, type PlanRowBaseInput, type PlanRowsInput, type PlanRowFields, type PlanGutterFields } from "./assemble.js";
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
    type PlanSpanParts,
    type PlanBucketsParts,
    type PlanChartParts,
    type PlanHeatParts,
    type PlanTableParts,
} from "./factories.js";
export { type PlanReviewConfig, type PlanConfig } from "./root.js";
export { type PlanPickOptions, createPlanPick, createPlanPickItems } from "./pick.js";
export {
    PlanSeriesType,
    type PlanSeriesArm,
    type PlanSeriesValue,
    type PlanSeriesInput,
    type PlanSeriesIdentity,
    type PlanEntryExpr,
    type PlanAccessor,
    type PlanElementsAccessor,
    type PlanKindedAccessor,
    type PlanChildren,
    type PlanChildrenInput,
    type PlanSeriesRowConfig,
    type PlanSpanSeriesConfig,
    type PlanHeatSeriesConfig,
    type PlanTableSeriesOfConfig,
    type PlanBucketsSeriesConfig,
    type PlanCardsSeriesConfig,
    type PlanEventsSeriesConfig,
    type PlanChartSeriesConfig,
    type PlanGroupSeriesConfig,
    type PlanSectionSeriesConfig,
    type PlanViewsSeriesConfig,
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
    /** Builds the shared axis declaration — `Plan.axis({ … })` is the `time`
     *  shorthand; `Plan.axis.time` / `.number` / `.ordinal` declare each kind. */
    axis: typeof createAxis;
    /** Builds one instant explicitly — `Plan.at.time(d)` / `.number(n)` /
     *  `.ordinal(s)` (element builders wrap by type; these are for records
     *  written as data and for reading as a declaration). */
    at: typeof at;
    /** Builds a quantity — a number with its unit and format (#824) — for a
     *  run's or a link's `quantity`. */
    quantity: typeof createQuantity;
    /** Builds a bound `ui` state's seed (#824) — `State.bind([Plan.Types.UiState], key, Plan.uiState())`. */
    uiState: typeof createUiState;
    /** Span-row stream builder (`series.rows` chrome + nested `rows:` input). */
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
     *  each builder takes the entry type first and returns a real East series
     *  value; the list is the layout (#822). */
    series: {
        /** A span series (runs; a parent rolls its subtree up into bands). */
        span: typeof createSeriesSpan;
        /** A bucket series (Planner tiles). */
        buckets: typeof createSeriesBuckets;
        /** A chart series (layers from each entry's data). */
        chart: typeof createSeriesChart;
        /** A heat series (a parent aggregates its children per bucket). */
        heat: typeof createSeriesHeat;
        /** A table series (a parent subtotals its children per position). */
        table: typeof createSeriesTable;
        /** A cards series (Roster chips). */
        cards: typeof createSeriesCards;
        /** An events series (instant marks). */
        events: typeof createSeriesEvents;
        /** One group strip per entry, its members the entry's children. */
        group: typeof createSeriesGroup;
        /** A fixed titled block over series. */
        section: typeof createSeriesSection;
        /** One row per member series per entry, adjacent. */
        views: typeof createSeriesViews;
        /** Hand-built rows, named by the series and placed as its block. */
        rows: typeof createSeriesRows;
    };
    /** A step down from an entry to a child collection of another type — a series' `children` (#822). */
    children: typeof createChildren;
    /** A row's id by series and path — `Plan.ref("machine-jobs", "L1", "m03")` (#822). */
    ref: typeof createRef;
    /** A section header's id — `Plan.sectionRef("crew-block", "L1")` (#822). */
    sectionRef: typeof createSectionRef;
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
    /** Binds the canvas's row series to a persisted pick (#590) — pass it as
     *  `<Plan pick>` and the canvas shows the picked series and mounts the
     *  library, which lists sections and kinds. */
    pick: typeof createPlanPick;
    /** The library entries for the canvas's series — no state binding. */
    pickItems: typeof createPlanPickItems;
    /** The Plan East types. */
    Types: {
        /** The Plan root IR ({@link PlanRootType}). */
        Root: typeof PlanRootType;
        /** The shared axis declaration — `{ time | number | ordinal }`. */
        Axis: typeof PlanAxisType;
        /** The `time` axis arm. */
        TimeAxis: typeof PlanTimeAxisType;
        /** The `number` axis arm. */
        NumberAxis: typeof PlanNumberAxisType;
        /** The `ordinal` axis arm. */
        OrdinalAxis: typeof PlanOrdinalAxisType;
        /** One instant on the shared axis — `{ time | number | ordinal }`. */
        Instant: typeof PlanInstantType;
        /** The two grains (group / resource). */
        Grain: typeof PlanGrainType;
        /** One canvas row. */
        Row: typeof PlanRowType;
        /** One block's rows — an ordered stream (#822). */
        Rows: typeof PlanRowsCollectionType;
        /** One block of the canvas's rows — a data series' entries, which a
         *  paged canvas pages on its own, or fixed rows drawn once (#823). */
        Block: typeof PlanBlockType;
        /** The canvas's rows — its blocks, in layout order (#823). */
        Blocks: typeof PlanBlocksType;
        /** A row's typed identity — `{ series, path }` (#822). */
        RowId: typeof PlanRowIdType;
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
        /** One link edge of the canvas's link graph (the ribbon shape). */
        Link: typeof PlanLinkType;
        /** A row's expand-in-place declaration (R2). */
        Expand: typeof PlanExpandType;
        /** The expand render's axis treatment (keep / dim / off). */
        ExpandAxis: typeof PlanExpandAxisType;
        /** The review config at the row's id. */
        Review: typeof PlanReviewType;
        /** The series type CONSTRUCTOR — `Plan.Types.Series(RowType)` gives the
         *  concrete variant type of one series over `Dict<String, RowType>`
         *  entries; `Plan.Types.Series(RowType, KeyType)` over another key type. */
        Series: typeof PlanSeriesType;
        /** One run by reference — a `run` element ref, and a link's two ends. */
        RunRef: typeof PlanRunRefType;
        /** One canvas element by reference — what `onElementClick` and the `popover` / `hover` resolvers receive. */
        ElementRef: typeof PlanElementRefType;
        /** How a bucket folds the values that fall in it (#824). */
        Fold: typeof PlanFoldType;
        /** A quantity — a number, its unit and format (#824). */
        Quantity: typeof PlanQuantityType;
        /** A heat scale — min, max and the warn threshold. */
        HeatScale: typeof PlanHeatScaleType;
        /** What a collapsed group strip shows (#824). */
        GroupSummary: typeof PlanGroupSummaryType;
        /** The interaction state a bound `ui` holds (#824). */
        UiState: typeof PlanUiStateType;
        /** A bound `ui` — `State.bind`'s handle at {@link PlanUiStateType}. */
        UiBind: typeof PlanUiBindType;
        /** The `onGroupToggle` payload. */
        GroupToggleEvent: typeof PlanGroupToggleEventType;
        /** One status-footer item. */
        FooterItem: typeof PlanFooterItemType;
        /** The Plan style. */
        Style: typeof PlanStyleType;
    };
}

/**
 * The `Plan` namespace — the axis-aligned composite canvas. Assemble a
 * Plan with `Plan.Root` (the `<Plan>` tag) over `data` + `series` (the
 * `Plan.series.*` blocks in layout order, or a `Plan.pick` handle), declare the
 * axis with `Plan.axis` (`time`) / `Plan.axis.number` / `Plan.axis.ordinal`,
 * place content with the value builders (`Plan.run` / `event` / `chip` /
 * `mark` / …, instants via `Plan.at.*` when written as data), build one-off
 * rows with the kind factories (`Plan.span` / `buckets` / `chart` / `heat` /
 * `table` / `cards` / `events` / `group`) inside `Plan.series.rows`, and
 * reach every East type via `Plan.Types.*`.
 */
export const Plan: PlanNamespace = {
    Root: createPlanRoot,
    axis: createAxis,
    at,
    quantity: createQuantity,
    uiState: createUiState,
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
        section: createSeriesSection,
        views: createSeriesViews,
        rows: createSeriesRows,
    },
    children: createChildren,
    ref: createRef,
    sectionRef: createSectionRef,
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
    pick: createPlanPick,
    pickItems: createPlanPickItems,
    Types: {
        Root: PlanRootType,
        Axis: PlanAxisType,
        TimeAxis: PlanTimeAxisType,
        NumberAxis: PlanNumberAxisType,
        OrdinalAxis: PlanOrdinalAxisType,
        Instant: PlanInstantType,
        Grain: PlanGrainType,
        Row: PlanRowType,
        Rows: PlanRowsCollectionType,
        Block: PlanBlockType,
        Blocks: PlanBlocksType,
        RowId: PlanRowIdType,
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
        Link: PlanLinkType,
        Expand: PlanExpandType,
        ExpandAxis: PlanExpandAxisType,
        Review: PlanReviewType,
        Series: PlanSeriesType,
        RunRef: PlanRunRefType,
        ElementRef: PlanElementRefType,
        Fold: PlanFoldType,
        Quantity: PlanQuantityType,
        HeatScale: PlanHeatScaleType,
        GroupSummary: PlanGroupSummaryType,
        UiState: PlanUiStateType,
        UiBind: PlanUiBindType,
        GroupToggleEvent: PlanGroupToggleEventType,
        FooterItem: PlanFooterItemType,
        Style: PlanStyleType,
    },
};
