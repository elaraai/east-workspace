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
 * chips) and event rows — sliced and planned as one surface.
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
 * `types.ts` (the UIComponent-free row vocabulary) · `ir.ts` (the root at
 * `UIComponentType`) · `builders.ts` (the axis, instant,
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
import { PlanRootType } from "./ir.js";
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

export { PlanRootType } from "./ir.js";
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
export { type PlanEditingConfig, type PlanBindHandle, type PlanConfig, type PlanCanvasOptions, createPlanRoot, buildPlanRoot } from "./root.js";
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
    type PlanItemsField,
    type PlanItemOf,
    type PlanItemFields,
    type PlanItemKeyField,
    type PlanItemInstantType,
    type PlanItemInstantField,
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
        /** A gesture a draft is made by — a card dropped on a row (#880), or an element moved or resized (#825). */
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
 * — sliced and planned as one surface.
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
 * import { ArrayType, BooleanType, DictType, East, FloatType, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
 * import { Chart, EventStateType, Format, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Plan } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const OrdinalJob = StructType({ key: StringType, label: StringType, start: StringType, end: StringType, state: EventStateType });
 * export const OrdinalAlloc = StructType({ key: StringType, phase: StringType, state: EventStateType });
 * export const OrdinalShift = StructType({ key: StringType, from: StringType, to: StringType, label: StringType, state: EventStateType });
 * export const OrdinalMark = StructType({ key: StringType, phase: StringType, label: StringType, exception: BooleanType });
 * export const OrdinalPoint = StructType({ phase: StringType, n: FloatType });
 * export const OrdinalReading = StructType({ at: StringType, value: OptionType(FloatType) });
 * export const OrdinalOrderRow = StructType({
 *     series: StringType, label: StringType, value: OptionType(StringType), sub: OptionType(StringType),
 *     jobs: ArrayType(OrdinalJob), allocations: ArrayType(OrdinalAlloc), shifts: ArrayType(OrdinalShift),
 *     marks: ArrayType(OrdinalMark), points: ArrayType(OrdinalPoint), counts: ArrayType(OrdinalReading),
 *     cells: ArrayType(Plan.Types.HeatCell),
 * });
 * export const planOrdinalOrders = e3.input("plan_ordinal_orders", DictType(StringType, OrdinalOrderRow), variant("value", new Map([
 *     ["j6188", { series: "job", label: "J-6188", value: some("96 k sheets"), sub: none,
 *       allocations: [], shifts: [], marks: [], points: [], counts: [], cells: [],
 *       jobs: [
 *           { key: "plates", label: "PLATES", start: "PREPRESS", end: "PLATES", state: variant("actual", null) },
 *           { key: "print", label: "PRINT · J-4642", start: "PRINT", end: "FINISH", state: variant("in-progress", null) },
 *           { key: "deliver", label: "BIND + DELIVER", start: "BIND", end: "DELIVER", state: variant("proposed", variant("recommended", null)) },
 *       ] }],
 *     ["j6204", { series: "job", label: "J-6204", value: some("54 k sheets"), sub: none,
 *       allocations: [], shifts: [], marks: [], points: [], counts: [], cells: [],
 *       jobs: [
 *           { key: "prepress", label: "PREPRESS", start: "PREPRESS", end: "PREPRESS", state: variant("actual", null) },
 *           { key: "print", label: "PRINT · J-4663", start: "PLATES", end: "BIND", state: variant("proposed", variant("recommended", null)) },
 *       ] }],
 *     ["bindery", { series: "bindery", label: "Bindery 2", value: none, sub: some("slots"),
 *       jobs: [], shifts: [], marks: [], points: [], counts: [], cells: [],
 *       allocations: [
 *           { key: "a1", phase: "PLATES", state: variant("confirmed", null) }, { key: "a2", phase: "PRINT", state: variant("confirmed", null) },
 *           { key: "a3", phase: "PRINT", state: variant("proposed", variant("recommended", null)) }, { key: "a4", phase: "BIND", state: variant("proposed", variant("recommended", null)) },
 *       ] }],
 *     // Heat cells as STORED records — the phase spelled on the `ordinal` arm.
 *     ["load", { series: "load", label: "Phase load", value: none, sub: none,
 *       jobs: [], allocations: [], shifts: [], marks: [], points: [], counts: [],
 *       cells: [
 *           { at: variant("ordinal", "PREPRESS"), value: some(35.0), label: some("35") },
 *           { at: variant("ordinal", "PLATES"), value: some(66.0), label: some("66") },
 *           { at: variant("ordinal", "PRINT"), value: some(37.0), label: some("37") },
 *           { at: variant("ordinal", "FINISH"), value: some(68.0), label: some("68") },
 *           { at: variant("ordinal", "BIND"), value: some(39.0), label: some("39") },
 *           { at: variant("ordinal", "DELIVER"), value: some(70.0), label: some("70") },
 *       ] }],
 *     ["wip", { series: "wip", label: "WIP · jobs", value: some("31"), sub: none,
 *       jobs: [], allocations: [], shifts: [], marks: [], counts: [], cells: [],
 *       points: [
 *           { phase: "PREPRESS", n: 4.0 }, { phase: "PLATES", n: 11.0 }, { phase: "PRINT", n: 18.0 },
 *           { phase: "FINISH", n: 5.0 }, { phase: "BIND", n: 12.0 }, { phase: "DELIVER", n: 19.0 },
 *       ] }],
 *     ["count", { series: "count", label: "Jobs in phase", value: none, sub: none,
 *       jobs: [], allocations: [], shifts: [], marks: [], points: [], cells: [],
 *       counts: [
 *           { at: "PREPRESS", value: some(12.0) }, { at: "PLATES", value: some(23.0) }, { at: "PRINT", value: some(34.0) },
 *           { at: "FINISH", value: some(15.0) }, { at: "BIND", value: none }, { at: "DELIVER", value: some(37.0) },
 *       ] }],
 *     ["crew", { series: "crew", label: "Crew B", value: none, sub: none,
 *       jobs: [], allocations: [], marks: [], points: [], counts: [], cells: [],
 *       shifts: [
 *           { key: "s1", from: "PREPRESS", to: "PLATES", label: "prepress crew", state: variant("confirmed", null) },
 *           { key: "s2", from: "PRINT", to: "DELIVER", label: "+ bindery crew", state: variant("proposed", variant("recommended", null)) },
 *       ] }],
 *     ["gates", { series: "gates", label: "Gates", value: none, sub: none,
 *       jobs: [], allocations: [], shifts: [], points: [], counts: [], cells: [],
 *       marks: [
 *           { key: "g1", phase: "FINISH", label: "HOLD", exception: true },
 *           { key: "g2", phase: "DELIVER", label: "RELEASE", exception: false },
 *       ] }],
 * ])));
 *
 * const canvas = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const orders = $.let(Data.bind(planOrdinalOrders));
 *         const PHASES = $.const(["PREPRESS", "PLATES", "PRINT", "FINISH", "BIND", "DELIVER"], ArrayType(StringType));
 *         const EXCEPTION = $.const(variant("exception", null), Plan.Types.EventMarkKind);
 *         const MILESTONE = $.const(variant("milestone", null), Plan.Types.EventMarkKind);
 *         const series = $.const([
 *             Plan.series.section(OrdinalOrderRow, { key: "job-block", title: "Jobs", meta: "2 rows" }, [
 *                 Plan.series.span(OrdinalOrderRow, {
 *                     key: "job", title: "Jobs",
 *                     match: r => r.series.equal("job"),
 *                     label: r => r.label, id: true, value: r => r.value,
 *                     // `j.start` / `j.end` are StringType fields — the builder wraps them to the ordinal arm.
 *                     runs: r => r.jobs.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.label, state: j.state })),
 *                 }),
 *             ]),
 *             Plan.series.buckets(OrdinalOrderRow, {
 *                 key: "bindery", title: "Bindery",
 *                 match: r => r.series.equal("bindery"),
 *                 label: r => r.label, sub: r => r.sub,
 *                 events: r => r.allocations.map((_$, a) => Plan.event({ key: a.key, at: a.phase, state: a.state })),
 *             }),
 *             Plan.series.heat(OrdinalOrderRow, {
 *                 key: "load", title: "Phase load",
 *                 match: r => r.series.equal("load"),
 *                 label: r => r.label,
 *                 cells: r => Plan.heatCells(r.cells, { min: 0, max: 100, warnAt: 90 }),
 *             }),
 *             Plan.series.chart(OrdinalOrderRow, {
 *                 key: "wip", title: "WIP",
 *                 match: r => r.series.equal("wip"),
 *                 label: r => r.label, id: true, value: r => r.value, height: "expanded",
 *                 // A string x accessor lands the columns on the ordinal arm.
 *                 layers: r => [Chart.Column(r.points, { x: p => p.phase, y: p => p.n })],
 *             }),
 *             Plan.series.table(OrdinalOrderRow, {
 *                 key: "count", title: "Counts",
 *                 match: r => r.series.equal("count"),
 *                 label: r => r.label,
 *                 cells: r => Plan.tableCells(r.counts),
 *                 format: Format.Number({ maximumFractionDigits: 0n }),
 *             }),
 *             Plan.series.cards(OrdinalOrderRow, {
 *                 key: "crew", title: "Crews",
 *                 match: r => r.series.equal("crew"),
 *                 label: r => r.label,
 *                 chips: r => r.shifts.map((_$, s) => Plan.chip({ key: s.key, from: s.from, to: s.to, label: s.label, state: s.state })),
 *             }),
 *             Plan.series.events(OrdinalOrderRow, {
 *                 key: "gates", title: "Gates",
 *                 match: r => r.series.equal("gates"),
 *                 label: r => r.label, id: true,
 *                 marks: r => r.marks.map((_$, m) => Plan.mark({
 *                     key: m.key, at: m.phase, label: m.label,
 *                     kind: m.exception.ifElse(() => EXCEPTION, () => MILESTONE),
 *                 })),
 *             }),
 *         ], ArrayType(Plan.Types.Series(OrdinalOrderRow)));
 *         // The declaration: the list IS the axis — one bucket per phase, `now` at PRINT.
 *         const axis = $.const(Plan.axis.ordinal({ values: PHASES, now: "PRINT" }));
 *         return (
 *             <Plan
 *                 axis={axis}
 *                 data={orders}
 *                 series={series}
 *                 footer={[{ text: "6 PHASES · NOW PRINT" }]}
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
 * import { EventStateType, Reactive, UIComponentType } from "@elaraai/east-ui";
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
 *     customer: StringType,
 *     stock: VariantType({ coated: NullType, uncoated: NullType, board: NullType }),
 *     due: OptionType(DateTimeType),
 * });
 * export const PrintCustomer = StructType({ name: StringType, district: StringType, trade: StringType });
 * export const planPrintPresses = e3.record("plan_print_presses", DictType(StringType, PrintPress), new Map([
 *     ["a1", { name: "Press A1", hall: "Hall A", sheets_per_hour: 12000.0 }],
 *     ["a2", { name: "Press A2", hall: "Hall A", sheets_per_hour: 10000.0 }],
 *     ["a3", { name: "Press A3", hall: "Hall A", sheets_per_hour: 8000.0 }],
 *     ["b1", { name: "Press B1", hall: "Hall B", sheets_per_hour: 15000.0 }],
 *     ["b2", { name: "Press B2", hall: "Hall B", sheets_per_hour: 12000.0 }],
 *     ["b3", { name: "Press B3", hall: "Hall B", sheets_per_hour: 6000.0 }],
 * ]));
 * export const planPrintCustomers = e3.record("plan_print_customers", DictType(StringType, PrintCustomer), new Map([
 *     ["alder-finch", { name: "Alder & Finch", district: "Old Town", trade: "Retail" }],
 *     ["bluewater-tours", { name: "Bluewater Tours", district: "North Quay", trade: "Travel" }],
 *     ["copperleaf-cafe", { name: "Copperleaf Cafe", district: "Old Town", trade: "Hospitality" }],
 *     ["driftwood-museum", { name: "Driftwood Museum", district: "North Quay", trade: "Arts" }],
 *     ["elmway-college", { name: "Elmway College", district: "Riverside", trade: "Education" }],
 *     ["foxglove-gardens", { name: "Foxglove Gardens", district: "Riverside", trade: "Retail" }],
 *     ["granite-hall", { name: "Granite Hall", district: "Old Town", trade: "Events" }],
 *     ["harbour-arts", { name: "Harbour Arts Society", district: "North Quay", trade: "Arts" }],
 *     ["heathfield", { name: "Heathfield Theatre", district: "Old Town", trade: "Arts" }],
 *     ["ivy-lane", { name: "Ivy Lane Studio", district: "Riverside", trade: "Design" }],
 *     ["juniper-toys", { name: "Juniper Toys", district: "Riverside", trade: "Retail" }],
 *     ["kestrel-cycling", { name: "Kestrel Cycling Club", district: "Riverside", trade: "Sport" }],
 *     ["larkspur-home", { name: "Larkspur Home", district: "Old Town", trade: "Retail" }],
 *     ["meridian-monthly", { name: "Meridian Monthly", district: "North Quay", trade: "Publishing" }],
 *     ["northwind", { name: "Northwind Outfitters", district: "North Quay", trade: "Retail" }],
 *     ["orchard-market", { name: "Orchard Street Market", district: "Old Town", trade: "Markets" }],
 * ]));
 * export const planEventJobs = e3.record("plan_event_jobs", DictType(StringType, PrintJob), new Map([
 *     ["J-3001", { title: "Spring catalogue", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T14:00:00Z")), press: some("a1"), state: variant("actual", null), sheets: 96000.0, customer: "Alder & Finch", stock: variant("coated", null), due: some(new Date("2026-10-08T00:00:00Z")) }],
 *     ["J-3002", { title: "Course handbook", start: some(new Date("2026-10-19T06:00:00Z")), end: some(new Date("2026-10-19T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 144000.0, customer: "Elmway College", stock: variant("uncoated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
 *     ["J-3003", { title: "Annual report", start: some(new Date("2026-10-14T06:00:00Z")), end: some(new Date("2026-10-14T12:00:00Z")), press: some("a2"), state: variant("in-progress", null), sheets: 60000.0, customer: "Harbour Arts Society", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *     ["J-3004", { title: "Club newsletter", start: some(new Date("2026-10-08T06:00:00Z")), end: some(new Date("2026-10-08T08:00:00Z")), press: some("a3"), state: variant("actual", null), sheets: 16000.0, customer: "Kestrel Cycling Club", stock: variant("uncoated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
 *     ["J-3005", { title: "Store flyers", start: some(new Date("2026-10-15T06:00:00Z")), end: some(new Date("2026-10-15T16:00:00Z")), press: some("b1"), state: variant("confirmed", null), sheets: 150000.0, customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *     ["J-3006", { title: "Market posters", start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T12:00:00Z")), press: some("b2"), state: variant("confirmed", null), sheets: 72000.0, customer: "Orchard Street Market", stock: variant("coated", null), due: some(new Date("2026-10-22T00:00:00Z")) }],
 *     ["J-3007", { title: "Loyalty cards", start: some(new Date("2026-10-20T10:00:00Z")), end: some(new Date("2026-10-20T13:00:00Z")), press: some("b2"), state: variant("proposed", variant("added", null)), sheets: 36000.0, customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
 *     ["J-3008", { title: "Gift boxes", start: some(new Date("2026-10-27T06:00:00Z")), end: some(new Date("2026-10-27T12:00:00Z")), press: some("b3"), state: variant("proposed", variant("recommended", null)), sheets: 48000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
 *     ["J-3009", { title: "Ticket books", start: some(new Date("2026-10-22T06:00:00Z")), end: some(new Date("2026-10-22T09:00:00Z")), press: none, state: variant("proposed", variant("added", null)), sheets: 24000.0, customer: "Heathfield Theatre", stock: variant("uncoated", null), due: some(new Date("2026-10-26T00:00:00Z")) }],
 *     ["J-3010", { title: "Guide reprint", start: none, end: none, press: none, state: variant("estimated", null), sheets: 24000.0, customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
 *     ["J-3011", { title: "Wall calendars", start: none, end: none, press: none, state: variant("estimated", null), sheets: 50000.0, customer: "Foxglove Gardens", stock: variant("coated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
 *     ["J-3012", { title: "Spare covers", start: none, end: none, press: none, state: variant("estimated", null), sheets: 8000.0, customer: "Meridian Monthly", stock: variant("board", null), due: none }],
 * ]));
 * export const planEventJobsPatch = e3.mutation.patch(planEventJobs);
 *
 * const planEvents = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const presses = $.let(Record.bind(planPrintPresses, []));
 *         const jobs = $.let(Record.bind(planEventJobs, [planEventJobsPatch]));
 *         const customers = $.let(Record.bind(planPrintCustomers, []));
 *         const axis = $.let(Plan.axis({
 *             window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
 *             resolution: "day", now: new Date("2026-10-14T09:00:00Z"),
 *         }));
 *         return (
 *             <Plan
 *                 id="jobs"
 *                 axis={axis}
 *                 resources={{
 *                     presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name }),
 *                 }}
 *                 events={{
 *                     job: Schedule.events(jobs, {
 *                         name: "Print job", icon: "file-lines",
 *                         title: "title", start: "start", end: "end",
 *                         resource: { field: "press", of: "presses" },
 *                         state: "state",
 *                         // A job with no start waits in the backlog: placed, it runs as long as its sheets take at
 *                         // 8,000 an hour.
 *                         backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
 *                         fields: {
 *                             customer: Schedule.field.text({ label: "Customer" }),
 *                             stock: Schedule.field.select({ labels: { coated: "Coated", uncoated: "Uncoated", board: "Board" } }),
 *                         },
 *                     }),
 *                 }}
 *                 library={[
 *                     Plan.library.backlog(),
 *                     // The customers, by district: a card dropped on a job sets its customer.
 *                     Plan.library.tab(customers.read(), {
 *                         name: "Customers", icon: "building",
 *                         label: c => c.name, meta: c => some(c.trade), group: c => c.district,
 *                         drop: c => Schedule.patch(PrintJob, { customer: c.name }),
 *                     }),
 *                 ]}
 *                 inspector
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
