/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Plan` — the axis-aligned composite canvas, `<Plan>`, the one Plan (#1191):
 * it renders in its `BuilderFrame` wherever it is used, its panes optional
 * props. One shared axis
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
 * `data`) · `pick.ts` (`Plan.pick` / `Plan.pickItems`) · `root.ts` (the
 * canvas's root, the internal namespace's `Plan.Root`) · `plan.ts` (`<Plan>`
 * itself, its payload and its `Plan` carrier, #1191) with `over.ts`
 * (`Plan.over`, read-only rows over a dataset), `refs.ts` (`Plan.eventRef`,
 * an event named for a link's end) and `library.ts` (`Plan.library`, the
 * library pane's tabs, #1195). The event kinds a Plan takes are `Schedule`'s
 * (`src/schedule/`).
 *
 * `Plan` is the tag and the namespace at once, as east-ui's `Table` and the
 * Sheet are.
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
    PlanDrawType,
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
    PlanDropType,
    PlanMoveType,
    PlanGestureType,
    PlanMoveEditsType,
    PlanRowEditsType,
    PlanPatchEventTypeFor,
    PlanEditingType,
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
import { PlanComponent, PlanTag, createPlanPayload, type PlanTagType } from "./plan.js";
import { createOver } from "./over.js";
import { createEventRef } from "./refs.js";
import { libraryBacklog, libraryEvents, librarySeries, libraryTab } from "./library.js";

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
    PlanDrawType,
    type PlanDrawLiteral,
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
    PlanDropType,
    PlanMoveType,
    PlanGestureType,
    PlanMoveEditsType,
    PlanRowEditsType,
    PlanPatchEventTypeFor,
    PlanEditingType,
    PlanWriteRequestType,
    PlanReadyEntryType,
    PLAN_PAGE_SIZE,
} from "./types.js";

// ── Public surface — re-exported from the split modules ─────────────────────

export { PlanReviewType, PlanRootType } from "./ir.js";
export {
    PlanTag,
    PlanComponent,
    PlanPayloadType,
    PlanSettingsType,
    PlanEventBlocksType,
    PlanEventCanDropType,
    createPlanPayload,
    planKeys,
    type PlanTagType,
    type PlanProps,
    type PlanRowsItem,
} from "./plan.js";
export { createOver, type PlanOverRows } from "./over.js";
export { createEventRef, eventRefKind } from "./refs.js";
export {
    PlanLibraryCardType,
    PlanLibraryHidesType,
    PlanLibraryRowsItemType,
    PlanLibrarySeriesType,
    PlanLibraryTabType,
    libraryBacklog,
    libraryEvents,
    librarySeries,
    libraryTab,
    planHideId,
    type PlanLibraryTab,
    type PlanLibraryTabConfig,
} from "./library.js";
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
export { type PlanReviewConfig, type PlanEditingConfig, type PlanBindHandle, type PlanConfig, type PlanCanvasOptions, createPlanRoot, buildPlanRoot } from "./root.js";
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
    type PlanEntryFields,
    type PlanVerdictField,
    type PlanItemsField,
    type PlanItemOf,
    type PlanItemFields,
    type PlanItemKeyField,
    type PlanItemInstantType,
    type PlanItemInstantField,
    type PlanReviewInput,
    type PlanEditInput,
    type PlanPointEditInput,
} from "./series.js";

// ============================================================================
// Namespace
// ============================================================================

/**
 * The type of `Plan`: the `<Plan>` tag and its namespace. Declared explicitly
 * (rather than inferred from `as const`) so the declaration emit stays within
 * TypeScript's serialization limit.
 */
export interface PlanNamespace extends PlanTagType {
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
    /** A row's id by series and path — `Plan.ref("press-jobs", "H1", "p03")` (#822). */
    ref: typeof createRef;
    /** A section header's id — `Plan.sectionRef("crew-block", "H1")` (#822). */
    sectionRef: typeof createSectionRef;
    /** An event of one of the Plan's event kinds, named for a link's end — `Plan.eventRef("job", key)` (#1191). */
    eventRef: typeof createEventRef;
    /** Series over a dataset, read only, for a Plan's `rows` — `Plan.over(data, [series…])` (#1191). */
    over: typeof createOver;
    /** The library pane's tabs, for a Plan's `library`, in its order (#1195). */
    library: {
        /** Every event kind's templates, by kind — `Plan.library.events()`. */
        events: typeof libraryEvents;
        /** Every event kind's unscheduled events, by when they are due — `Plan.library.backlog()`. */
        backlog: typeof libraryBacklog;
        /** What the canvas shows that a viewer can hide, each with an eye — `Plan.library.series()`. */
        series: typeof librarySeries;
        /** Cards of the author's own, one per row — `Plan.library.tab(rows, { name, label, … })`. */
        tab: typeof libraryTab;
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
    /** Builds one link edge of the canvas's link graph (`<Plan links>`). */
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
        /** How an event kind draws — bars, tiles, chips or marks (#1190). */
        Draw: typeof PlanDrawType;
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
        /** The review chrome — the decision column's label, the foot's summary and Rerun (#880). */
        Review: typeof PlanReviewType;
        /** A gesture a draft is made by — a verdict, a card dropped on a row (#880), or an element moved or resized (#825). */
        Gesture: typeof PlanGestureType;
        /** A library card dropped on a row — what an editable series' `create` builds its item from (#880). */
        Drop: typeof PlanDropType;
        /** A run, chip, tile or mark moved or resized — its item's new row and instants (#825). */
        Move: typeof PlanMoveType;
        /** Which gestures a row takes (#880). */
        RowEdits: typeof PlanRowEditsType;
        /** How a row's elements move — its item type, and whether they resize (#825). */
        MoveEdits: typeof PlanMoveEditsType;
        /** `PatchEvent(R)` — what `editing.onPatch` receives for entries of `R` (#880). */
        PatchEvent: typeof PlanPatchEventTypeFor;
        /** The root's editing declaration on the wire — the shared session's fields and the canvas's own (#880). */
        Editing: typeof PlanEditingType;
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

/** The namespace's members — everything `Plan` carries beside the tag itself. */
const PLAN_MEMBERS = {
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
    eventRef: createEventRef,
    over: createOver,
    library: {
        events: libraryEvents,
        backlog: libraryBacklog,
        series: librarySeries,
        tab: libraryTab,
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
        Draw: PlanDrawType,
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
        Gesture: PlanGestureType,
        Drop: PlanDropType,
        Move: PlanMoveType,
        RowEdits: PlanRowEditsType,
        MoveEdits: PlanMoveEditsType,
        PatchEvent: PlanPatchEventTypeFor,
        Editing: PlanEditingType,
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

/**
 * The axis-aligned planning canvas, `<Plan>`: the one Plan. It renders in its
 * `BuilderFrame` wherever it is used — one toolbar holding every control, the
 * banners, the canvas in main, the footer — and its panes are optional props:
 * no prop, no pane.
 *
 * One shared axis (`{ time | number | ordinal }` — a window ÷ resolution or
 * step, or an ordinal list, = `n` buckets) runs under heterogeneous rows —
 * span rows (Gantt state-runs), bucket rows (Planner allocation lanes), chart
 * rows (Chart layers consumed as data), heat and table rows (Matrix cells,
 * bucketed numerals), cards rows (Roster chips), event marks and group strips
 * — sliced and reviewed as one surface.
 *
 * - **The rows** come from event kinds over records (`resources` and
 *   `events`, `Schedule`'s, which a Calendar takes too), from `data` laid out
 *   by `series` and edited through `editing`, and from `rows` (hand-built rows
 *   and `Plan.over(data, [series…])`), read only — in that order down the
 *   canvas, pinned rows of any source under the ruler.
 * - **`data` and `series`**: a keyed collection of raw entries, or a paged
 *   source of one, and one `Plan.series.*` value per row series, whose
 *   accessors derive each canvas row from the raw fields (`Plan.pick` makes
 *   the list one the user picks from). The list IS the layout — one block per
 *   series, top to bottom — and hierarchy comes only from the data's own
 *   nesting (#822): a series' `children` walk what an entry holds, to any
 *   depth (`Plan.children` steps down to another entry type), and a flat
 *   source is grouped in a data step first (`groupToDicts`).
 *   `Plan.series.section` titles a block and `Plan.series.views` shows one
 *   entry several ways. Every row has a typed id — its series and the path of
 *   entry keys to it (`Plan.ref`).
 * - **The axis** is `Plan.axis` (`time`), `Plan.axis.number` or
 *   `Plan.axis.ordinal`, its window stated or supplied by a bound slice. Event
 *   kinds need a time axis.
 * - **Content** comes from the value builders (`Plan.run` / `event` / `chip`
 *   / `mark` / `marker` / `decision` / `port` / `segment` / the cell builders,
 *   instants via `Plan.at.*` when written as data) and the kind factories
 *   (`Plan.span` / `buckets` / `chart` / `heat` / `table` / `cards` /
 *   `events` / `group`); every East type is on `Plan.Types.*`.
 * - **Links** join runs (`Plan.ref(series, …path)` and the run's key) or
 *   events (`Plan.eventRef(kind, key)`).
 * - **The library** (`library`) is the start pane's tabs, in its order:
 *   `Plan.library.events()`, `backlog()`, `series()` and `tab(rows, { … })`,
 *   cards of the author's own. Left out, there is no library pane.
 *
 * The Plan fills its parent and draws no border of its own. `id` keeps two
 * Plans on one surface apart. The tag is generic in the canvas's axis kind,
 * inferred from `axis`: a series or a hand-built row whose instants ride
 * another arm is a compile error at the tag.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, StringType, StructType, VariantType, variant } from "@elaraai/east";
 * import { EventStateType, Format, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Plan } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const SeriesJob = StructType({ ticket: StringType, start: DateTimeType, end: DateTimeType, sheets: FloatType, state: EventStateType });
 * export const SeriesShift = StructType({ key: StringType, from: DateTimeType, to: DateTimeType, hours: FloatType, state: EventStateType });
 * export const SeriesOpsRow = StructType({
 *     hall: StringType,
 *     kind: VariantType({
 *         press: StructType({ jobs: ArrayType(SeriesJob) }),
 *         crew:    StructType({ shifts: ArrayType(SeriesShift) }),
 *     }),
 * });
 * export const planSeriesOps = e3.input("plan_series_ops", DictType(StringType, SeriesOpsRow), variant("value", new Map([
 *     ["H1-P03", { hall: "Hall 1", kind: variant("press", { jobs: [
 *         { ticket: "J-4642", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-27T00:00:00Z"), sheets: 96.0, state: variant("in-progress", null) },
 *         { ticket: "J-4663", start: new Date("2026-08-03T00:00:00Z"), end: new Date("2026-08-24T00:00:00Z"), sheets: 88.0, state: variant("proposed", variant("recommended", null)) },
 *     ] }) }],
 *     ["H1-P04", { hall: "Hall 1", kind: variant("press", { jobs: [
 *         { ticket: "J-4624", start: new Date("2026-06-29T00:00:00Z"), end: new Date("2026-07-20T00:00:00Z"), sheets: 112.0, state: variant("actual", null) },
 *     ] }) }],
 *     ["H2-P11", { hall: "Hall 2", kind: variant("press", { jobs: [
 *         { ticket: "J-4723", start: new Date("2026-07-13T00:00:00Z"), end: new Date("2026-08-10T00:00:00Z"), sheets: 92.0, state: variant("confirmed", null) },
 *     ] }) }],
 *     ["crewA", { hall: "Hall 1", kind: variant("crew", { shifts: [
 *         { key: "s1", from: new Date("2026-06-29T00:00:00Z"), to: new Date("2026-07-13T00:00:00Z"), hours: 80.0, state: variant("confirmed", null) },
 *         { key: "s2", from: new Date("2026-07-27T00:00:00Z"), to: new Date("2026-08-10T00:00:00Z"), hours: 64.0, state: variant("proposed", variant("recommended", null)) },
 *     ] }) }],
 * ])));
 *
 * const canvas = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         // The source, bound from e3 — its rows are what the dataset holds.
 *         const ops = $.let(Data.bind(planSeriesOps));
 *         // Monday of ISO week n, 2026 — window W27–W38 (half-open), now W31.
 *         const week = $.const(East.function([IntegerType], DateTimeType, ($, n) => {
 *             const w1 = $.const(new Date("2025-12-29T00:00:00Z"), DateTimeType);
 *             return w1.addWeeks(n.subtract(1n));
 *         }));
 *         // Hierarchy is the DATA's (#822): one `groupToDicts` groups the rows
 *         // into the canvas's blocks — each press under its hall, the crews
 *         // under one "Crews" block. An entry of the result holds its rows.
 *         const blocks = $.let(ops.read().groupToDicts(
 *             ($, r) => r.kind.hasTag("crew").ifElse(() => "Crews", () => r.hall),
 *             ($, _r, k) => k));
 *         const Block = DictType(StringType, SeriesOpsRow);
 *         // The series — real East values bound in the body, typed by the
 *         // constructor. The list IS the layout: one block per series, top to
 *         // bottom. The accessors are where raw fields become canvas vocabulary:
 *         // labels, quantity displays and chip text all derive CLIENT-SIDE,
 *         // inside each series' `derive`.
 *         const series = $.const([
 *             // One row per hall, its presses stepped down into
 *             // (`Plan.children`) and their runs rolled up into its bands —
 *             // which sum the runs' quantities, unit by unit.
 *             Plan.series.span(Block, {
 *                 key: "halls", title: "Halls",
 *                 match: (_b, name) => name.equal("Crews").not(),
 *                 label: (_b, name) => name,
 *                 runs: _b => [],
 *                 rollup: "union",
 *                 children: Plan.children((b) => b, [
 *                     Plan.series.span(SeriesOpsRow, {
 *                         key: "presses", title: "Presses",
 *                         match: r => r.kind.hasTag("press"),
 *                         label: (_r, k) => k, id: true,
 *                         runs: r => r.kind.unwrap("press").jobs.map((_$, j) => Plan.run({
 *                             key: j.ticket, start: j.start, end: j.end,
 *                             label: East.str`RUN · ${j.ticket}`,
 *                             // A quantity is one value: the bar prints `96 k sheets`,
 *                             // and the hall's band sums the sheets.
 *                             quantity: Plan.quantity(j.sheets, { unit: "k sheets", format: Format.Number({ maximumFractionDigits: 0n }) }),
 *                             state: j.state,
 *                         })),
 *                     }),
 *                 ]),
 *             }),
 *             // One strip per matching block — here the one "Crews" block,
 *             // wearing its member count.
 *             Plan.series.group(Block, {
 *                 key: "crews", title: "Crews",
 *                 match: (_b, name) => name.equal("Crews"),
 *                 label: (_b, name) => name,
 *                 children: Plan.children((b) => b, [
 *                     Plan.series.cards(SeriesOpsRow, {
 *                         key: "crew-shifts", title: "Crew shifts",
 *                         match: r => r.kind.hasTag("crew"),
 *                         label: (_r, k) => k,
 *                         chips: r => r.kind.unwrap("crew").shifts.map(($, s) => {
 *                             const hrs = $.let(East.Float.printFixed(s.hours, 0n), StringType);
 *                             // `+` marks ADDED hours — a removed proposal keeps the
 *                             // plain figure (see planCardRows for the full ladder).
 *                             const label = $.let(s.state.match({
 *                                 proposed: (_$, p) => p.hasTag("removed").ifElse(
 *                                     () => East.str`${hrs}h`,
 *                                     () => East.str`+${hrs}h`),
 *                             }, _$ => East.str`${hrs}h`), StringType);
 *                             return Plan.chip({ key: s.key, from: s.from, to: s.to, label, state: s.state });
 *                         }),
 *                     }),
 *                 ]),
 *             }),
 *             Plan.series.rows(Block, { key: "chrome", title: "Milestones", subtitle: "one-off chrome" },
 *                 [Plan.events({ key: "ms", label: "Milestones", id: true, marks: [
 *                     Plan.mark({ key: "kick", at: week(28n), kind: "milestone", label: "KICKOFF" }),
 *                     Plan.mark({ key: "rel", at: week(33n), kind: "milestone", label: "REL 2.4" }),
 *                 ] })]),
 *         ], ArrayType(Plan.Types.Series(Block)));
 *         const axis = $.const(Plan.axis({ window: { min: week(27n), max: week(39n) }, resolution: "week", now: week(31n) }));
 *         return (
 *             <Plan
 *                 axis={axis}
 *                 data={blocks}
 *                 series={series}
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { DateTimeType, DictType, East, FloatType, NullType, OptionType, StringType, StructType, VariantType, none, some, variant } from "@elaraai/east";
 * import { ApprovalStateType, EventStateType, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Plan, Record, Schedule } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const PrintPress = StructType({ name: StringType, hall: StringType, sheets_per_hour: FloatType });
 * export const PrintJob = StructType({
 *     title: StringType,
 *     start: OptionType(DateTimeType),
 *     end: OptionType(DateTimeType),
 *     press: OptionType(StringType),
 *     state: EventStateType,
 *     sheets: FloatType,
 *     verdict: ApprovalStateType,
 *     customer: StringType,
 *     stock: VariantType({ coated: NullType, uncoated: NullType, board: NullType }),
 *     due: OptionType(DateTimeType),
 * });
 * export const planPrintPresses = e3.record("plan_print_presses", DictType(StringType, PrintPress), new Map([
 *     ["a1", { name: "Press A1", hall: "Hall A", sheets_per_hour: 12000.0 }],
 *     ["a2", { name: "Press A2", hall: "Hall A", sheets_per_hour: 10000.0 }],
 *     ["a3", { name: "Press A3", hall: "Hall A", sheets_per_hour: 8000.0 }],
 *     ["b1", { name: "Press B1", hall: "Hall B", sheets_per_hour: 15000.0 }],
 *     ["b2", { name: "Press B2", hall: "Hall B", sheets_per_hour: 12000.0 }],
 *     ["b3", { name: "Press B3", hall: "Hall B", sheets_per_hour: 6000.0 }],
 * ]));
 * export const planPrintJobs = e3.record("plan_print_jobs", DictType(StringType, PrintJob), new Map([
 *     ["J-1001", { title: "Spring catalogue", start: some(new Date("2026-10-05T06:00:00Z")), end: some(new Date("2026-10-05T14:00:00Z")), press: some("a1"), state: variant("actual", null), sheets: 96000.0, verdict: variant("approved", null), customer: "Alder & Finch", stock: variant("coated", null), due: some(new Date("2026-10-07T00:00:00Z")) }],
 *     ["J-1002", { title: "Museum guide", start: some(new Date("2026-10-07T06:00:00Z")), end: some(new Date("2026-10-07T12:00:00Z")), press: some("a1"), state: variant("actual", null), sheets: 72000.0, verdict: variant("approved", null), customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
 *     ["J-1003", { title: "Event posters", start: some(new Date("2026-10-14T07:00:00Z")), end: some(new Date("2026-10-14T12:00:00Z")), press: some("a1"), state: variant("in-progress", null), sheets: 60000.0, verdict: variant("approved", null), customer: "Granite Hall", stock: variant("uncoated", null), due: some(new Date("2026-10-15T00:00:00Z")) }],
 *     ["J-1004", { title: "Course handbook", start: some(new Date("2026-10-19T06:00:00Z")), end: some(new Date("2026-10-19T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 144000.0, verdict: variant("approved", null), customer: "Elmway College", stock: variant("uncoated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
 *     ["J-1005", { title: "Menu cards", start: some(new Date("2026-10-27T06:00:00Z")), end: some(new Date("2026-10-27T08:00:00Z")), press: some("a1"), state: variant("proposed", variant("recommended", null)), sheets: 24000.0, verdict: variant("pending", null), customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
 *     ["J-1006", { title: "Tour brochure", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T14:00:00Z")), press: some("a2"), state: variant("actual", null), sheets: 80000.0, verdict: variant("approved", null), customer: "Bluewater Tours", stock: variant("coated", null), due: some(new Date("2026-10-08T00:00:00Z")) }],
 *     ["J-1007", { title: "Annual report", start: some(new Date("2026-10-14T06:00:00Z")), end: some(new Date("2026-10-14T12:00:00Z")), press: some("a2"), state: variant("in-progress", null), sheets: 60000.0, verdict: variant("approved", null), customer: "Harbour Arts Society", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *     ["J-1008", { title: "Seed catalogue", start: some(new Date("2026-10-21T06:00:00Z")), end: some(new Date("2026-10-21T16:00:00Z")), press: some("a2"), state: variant("proposed", variant("added", null)), sheets: 100000.0, verdict: variant("pending", null), customer: "Foxglove Gardens", stock: variant("coated", null), due: some(new Date("2026-10-24T00:00:00Z")) }],
 *     ["J-1009", { title: "Season flyers", start: some(new Date("2026-10-28T06:00:00Z")), end: some(new Date("2026-10-28T09:00:00Z")), press: some("a2"), state: variant("estimated", null), sheets: 30000.0, verdict: variant("pending", null), customer: "Hollow Oak Theatre", stock: variant("uncoated", null), due: some(new Date("2026-10-31T00:00:00Z")) }],
 *     ["J-1010", { title: "Club newsletter", start: some(new Date("2026-10-08T06:00:00Z")), end: some(new Date("2026-10-08T08:00:00Z")), press: some("a3"), state: variant("actual", null), sheets: 16000.0, verdict: variant("approved", null), customer: "Kestrel Cycling Club", stock: variant("uncoated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
 *     ["J-1011", { title: "Stationery set", start: some(new Date("2026-10-15T06:00:00Z")), end: some(new Date("2026-10-15T09:00:00Z")), press: some("a3"), state: variant("confirmed", null), sheets: 24000.0, verdict: variant("approved", null), customer: "Ivy Lane Studio", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *     ["J-1012", { title: "Gift boxes", start: some(new Date("2026-10-22T06:00:00Z")), end: some(new Date("2026-10-22T12:00:00Z")), press: some("a3"), state: variant("proposed", variant("recommended", null)), sheets: 48000.0, verdict: variant("pending", null), customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-26T00:00:00Z")) }],
 *     ["J-1013", { title: "Holiday catalogue", start: some(new Date("2026-10-05T06:00:00Z")), end: some(new Date("2026-10-05T22:00:00Z")), press: some("b1"), state: variant("actual", null), sheets: 240000.0, verdict: variant("approved", null), customer: "Larkspur Home", stock: variant("coated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
 *     ["J-1014", { title: "Magazine run", start: some(new Date("2026-10-12T06:00:00Z")), end: some(new Date("2026-10-12T18:00:00Z")), press: some("b1"), state: variant("actual", null), sheets: 180000.0, verdict: variant("approved", null), customer: "Meridian Monthly", stock: variant("coated", null), due: some(new Date("2026-10-13T00:00:00Z")) }],
 *     ["J-1015", { title: "Store flyers", start: some(new Date("2026-10-14T06:00:00Z")), end: some(new Date("2026-10-14T16:00:00Z")), press: some("b1"), state: variant("in-progress", null), sheets: 150000.0, verdict: variant("approved", null), customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *     ["J-1016", { title: "Exhibition book", start: some(new Date("2026-10-26T06:00:00Z")), end: some(new Date("2026-10-26T12:00:00Z")), press: some("b1"), state: variant("estimated", null), sheets: 90000.0, verdict: variant("pending", null), customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
 *     ["J-1017", { title: "Timetables", start: some(new Date("2026-10-09T06:00:00Z")), end: some(new Date("2026-10-09T10:00:00Z")), press: some("b2"), state: variant("actual", null), sheets: 48000.0, verdict: variant("approved", null), customer: "Bluewater Tours", stock: variant("uncoated", null), due: some(new Date("2026-10-12T00:00:00Z")) }],
 *     ["J-1018", { title: "Market posters", start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T12:00:00Z")), press: some("b2"), state: variant("confirmed", null), sheets: 72000.0, verdict: variant("approved", null), customer: "Orchard Street Market", stock: variant("coated", null), due: some(new Date("2026-10-22T00:00:00Z")) }],
 *     ["J-1019", { title: "Loyalty cards", start: some(new Date("2026-10-20T10:00:00Z")), end: some(new Date("2026-10-20T13:00:00Z")), press: some("b2"), state: variant("proposed", variant("added", null)), sheets: 36000.0, verdict: variant("pending", null), customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
 *     ["J-1020", { title: "Ticket books", start: some(new Date("2026-10-29T06:00:00Z")), end: some(new Date("2026-10-29T08:00:00Z")), press: some("b2"), state: variant("estimated", null), sheets: 24000.0, verdict: variant("pending", null), customer: "Hollow Oak Theatre", stock: variant("uncoated", null), due: some(new Date("2026-11-02T00:00:00Z")) }],
 *     ["J-1021", { title: "Handbook covers", start: some(new Date("2026-10-16T06:00:00Z")), end: some(new Date("2026-10-16T08:00:00Z")), press: some("b3"), state: variant("confirmed", null), sheets: 12000.0, verdict: variant("approved", null), customer: "Elmway College", stock: variant("board", null), due: some(new Date("2026-10-19T00:00:00Z")) }],
 *     ["J-1022", { title: "Box sleeves", start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T09:00:00Z")), press: some("b3"), state: variant("proposed", variant("recommended", null)), sheets: 18000.0, verdict: variant("pending", null), customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-22T00:00:00Z")) }],
 *     ["J-1023", { title: "Guide reprint", start: none, end: none, press: none, state: variant("estimated", null), sheets: 24000.0, verdict: variant("pending", null), customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *     ["J-1024", { title: "Order forms", start: none, end: none, press: none, state: variant("proposed", variant("added", null)), sheets: 40000.0, verdict: variant("pending", null), customer: "Larkspur Home", stock: variant("uncoated", null), due: some(new Date("2026-10-17T00:00:00Z")) }],
 *     ["J-1025", { title: "Winter brochure", start: none, end: none, press: none, state: variant("estimated", null), sheets: 64000.0, verdict: variant("pending", null), customer: "Bluewater Tours", stock: variant("coated", null), due: some(new Date("2026-10-21T00:00:00Z")) }],
 *     ["J-1026", { title: "Wall calendars", start: none, end: none, press: none, state: variant("estimated", null), sheets: 50000.0, verdict: variant("pending", null), customer: "Foxglove Gardens", stock: variant("coated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
 *     ["J-1027", { title: "Prospectus", start: none, end: none, press: none, state: variant("estimated", null), sheets: 100000.0, verdict: variant("pending", null), customer: "Elmway College", stock: variant("coated", null), due: some(new Date("2026-11-06T00:00:00Z")) }],
 *     ["J-1028", { title: "Price lists", start: none, end: none, press: none, state: variant("estimated", null), sheets: 16000.0, verdict: variant("pending", null), customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-11-13T00:00:00Z")) }],
 *     ["J-1029", { title: "Spare covers", start: none, end: none, press: none, state: variant("estimated", null), sheets: 8000.0, verdict: variant("pending", null), customer: "Meridian Monthly", stock: variant("board", null), due: none }],
 *     ["J-1030", { title: "Proof sheets", start: none, end: none, press: none, state: variant("estimated", null), sheets: 2000.0, verdict: variant("pending", null), customer: "Alder & Finch", stock: variant("uncoated", null), due: none }],
 * ]));
 * export const planPrintJobsPatch = e3.mutation.patch(planPrintJobs);
 *
 * const planEvents = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const presses = $.let(Record.bind(planPrintPresses, []));
 *         const jobs = $.let(Record.bind(planPrintJobs, [planPrintJobsPatch]));
 *         const axis = $.let(Plan.axis({
 *             window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
 *             resolution: "day",
 *         }));
 *         return (
 *             <Plan
 *                 axis={axis}
 *                 resources={{
 *                     presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name }),
 *                 }}
 *                 events={{
 *                     job: Schedule.events(jobs, {
 *                         name: "Print job", icon: "file-lines",
 *                         title: "title", start: "start", end: "end",
 *                         resource: { field: "press", of: "presses" },
 *                     }),
 *                 }}
 *             />
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export const Plan: PlanNamespace = Object.assign(PlanTag, PLAN_MEMBERS);

/**
 * The type of the internal Plan namespace — the public one, the payload the
 * tag returns through its carrier, the canvas's root alone, and the carrier
 * the renderer registers against.
 */
export interface PlanInternalNamespace extends PlanNamespace {
    /** Creates the Plan's payload alone — what `<Plan>` returns through the `Plan` carrier ({@link createPlanPayload}). */
    Payload: typeof createPlanPayload;
    /** Creates the canvas's root alone — the axis, rows over `data` and the rest the payload carries as its `plan` ({@link createPlanRoot}). */
    Root: typeof createPlanRoot;
    /** The `Plan` carrier ({@link PlanComponent}). */
    Component: typeof PlanComponent;
}

/** `<Plan>`, for the internal namespace: the tag, on an object of its own, so the public `Plan` carries none of the internal members. */
function PlanInternalTag(props: Parameters<PlanTagType>[0]): ReturnType<PlanTagType> {
    return PlanTag(props);
}

/**
 * The internal Plan namespace — `@elaraai/e3-ui/internal`'s `Plan`: the public
 * namespace, `Plan.Payload`, `Plan.Root` and the `Plan` carrier, for the
 * renderer and the tests.
 *
 * @internal
 */
export const PlanInternal: PlanInternalNamespace = Object.assign(PlanInternalTag as PlanTagType, PLAN_MEMBERS, {
    Payload: createPlanPayload,
    Root: createPlanRoot,
    Component: PlanComponent,
});
