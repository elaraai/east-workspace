/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @elaraai/e3-ui — e3 + UI bridge.
 *
 * The public surface is the e3-specific JSX **tags** plus the platform
 * helpers:
 * - `<Plan>` — the axis-aligned planning canvas, rendered in its frame with
 *   its panes as optional props: event kinds over records, rows over data and
 *   read-only rows, with its authoring vocabulary on `Plan` (`Plan.axis`,
 *   `Plan.series.*`, `Plan.over`, `Plan.eventRef`, the value builders).
 * - `<Sheet>` — the planning spreadsheet, rendered in its frame with its
 *   panes as optional props, and its authoring vocabulary on `Sheet`
 *   (`Sheet.column.*`, `Sheet.register.*`, `Sheet.driver`, `Sheet.Types`).
 * - `<Record>` — the table for a system of records, with the record binding
 *   and its vocabulary on `Record` (`Record.bind`, `Record.onApply`,
 *   `Record.column.*`, `Record.register.*`, `Record.Types`).
 * - `<Flowchart>` — the state-transition flowchart over the app's records:
 *   its states in ordered lanes, the transitions between them and the
 *   decisions that govern them, each record's fields mapped to its roles,
 *   rendered in its frame — its library pane an optional prop, its inspector
 *   on by default — with its kinds, cards, patches, library tabs and types on
 *   `Flowchart` (`Flowchart.states`, `Flowchart.transitions`,
 *   `Flowchart.lanes`, `Flowchart.decisions`, `Flowchart.templates`,
 *   `Flowchart.patch`, `Flowchart.library`, `Flowchart.Types`), and the
 *   details a state or a transition takes (`Flowchart.details` and its reads,
 *   `Flowchart.figure`, `.histogram`, `.list` and `.tags`).
 * - `<Schematic>` — the 2D world-coordinate drawing of the app's own records:
 *   items, zones, links and nets, each record's fields mapped to its roles,
 *   with its kinds, details, templates, layers, library tabs, pattern and
 *   geometry helpers and types on `Schematic` (`Schematic.items`,
 *   `Schematic.details`, `Schematic.layers`, `Schematic.library.*`,
 *   `Schematic.hatch()`, …, `Schematic.Types`).
 * - `Schedule` — the event and resource kinds the Calendar and Plan's builder
 *   share (`Schedule.events`, `Schedule.resources`), and what a builder
 *   publishes (`Schedule.periods`).
 * - `<Ontology>` — graph editor over an `OntologyType`-bound dataset.
 * - `Data.bind` — workspace-scoped reactive dataset binding.
 * - `Func.bind` — workspace-scoped named-function (RPC) call binding.
 * - `ui()` — declare a first-class UI task.
 *
 * east-ui tags (`<VStack>`, `<Text>`, …) are imported from `@elaraai/east-ui`
 * — this package does not re-export them. The underlying factories
 * (`Ontology.Root(…)`) live under `@elaraai/e3-ui/internal` for renderers and tests.
 *
 * @remarks
 * `ui()` pulls in `@elaraai/e3` (Node-only). Browser bundles that only need
 * `Data` / `<Ontology>` / types should import from
 * `@elaraai/e3-ui/internal`, which is e3-free.
 *
 * @packageDocumentation
 */

export {
    Data,
    DataBindModeType,
    type DataBindModeLiteral,
    DiffBindingType,
    type BoundValue,
    DataBindHandleType,
    type DataBindOptions,
    bindPlatformFn,
    DataPagedHandleType,
    type PagedValue,
    type IndexWindowType,
    type BindPagedIndexOptions,
    bindPagedPlatformFn,
    bindPagedPinnedPlatformFn,
} from './bind/data.js';
export {
    Func,
    FuncStatusType,
    FuncErrorType,
    FuncBindingType,
    FuncBindHandleType,
    type BoundFunc,
    funcBindPlatformFn,
} from './bind/func.js';
export {
    RecordMutateStatusType,
    RecordErrorType,
    RecordBindingType,
    RecordBindHandleType,
    RecordOutcomeType,
    type BoundRecord,
    type RecordApplyOptions,
    type RecordApplyInsideOptions,
    recordBindPlatformFn,
} from './bind/record.js';
// The Record: `<Record>`, the table for a system of records, and the record
// binding beside it — `Record.bind`, `Record.onApply`, its columns, registers,
// hints, patches and types (`Record.column.*`, `Record.register.*`,
// `Record.field`, `Record.patch`, `Record.Types`).
export {
    Record, type RecordNamespace, type RecordColumnSpec, type RecordColumnGroupInput, type RecordNounInput, type RecordCommon,
} from './record/index.js';
export { DataManifestType, type DataManifest } from './utils/manifest.js';
export { deriveManifest, deriveUiAccess, UiAccessType, type UiAccess } from './utils/derive.js';
export { ui } from './ui.js';

// The Studio (#787): components as code, the pages record operators build, and
// the components a solution mounts — the builder, the page library, one page.
export {
    Studio,
    StudioComponentType,
    StudioFrameType,
    StudioCellType,
    StudioEntryType,
    StudioKeyType,
    StudioLiveType,
    StudioPageEntryType,
    StudioPageType,
    StudioPagesType,
    StudioVersionType,
    type StudioNamespace,
    type StudioTypes,
    type StudioComponentMeta,
    type StudioFrameLiteral,
    type StudioPagesHandle,
    type StudioPageOptions,
    type StudioVersionLiteral,
    type StudioBuilderOptions,
    type StudioLibraryOptions,
} from './studio/index.js';

// The query builder (#875): the component a solution mounts, the saved
// queries record it declares and the queries it ships in it, and a query as
// the steps the builder edits.
export {
    Query,
    QueryAggregateFunctionType,
    QueryAggregateType,
    QueryComparisonType,
    QueryConditionType,
    QueryDatePartType,
    QueryGroupByType,
    QueryInputType,
    QueryMatchType,
    QueryPickFieldType,
    QueryResultType,
    QueryRootEntryType,
    QuerySortDirectionType,
    QueryStepInputType,
    QueryStepType,
    QueryStepValueType,
    QueryStepsType,
    SavedQueriesType,
    SavedQueryType,
    type QueriesHandle,
    type QueryBuilderOptions,
    type QueryLibraryOptions,
    type QueryNamespace,
    type QueryTypes,
    type SavedQueryInput,
} from './query/index.js';
export { DataSourceType, type BoundSource } from './bind/sources.js';

// The Plan (#1177, #1191): the axis-aligned planning canvas a solution mounts,
// `<Plan>` — event kinds over records, rows over data and read-only rows, in
// its frame, its library pane an optional prop (#1195) — its authoring
// vocabulary on `Plan` (`Plan.axis`, `Plan.series.*`, `Plan.over`,
// `Plan.eventRef`, `Plan.library.*`, the value and cell builders,
// `Plan.Types`), and its props.
export {
    Plan, type PlanNamespace, type PlanProps, type PlanConfig, type PlanRowsItem, type PlanOverRows,
    type PlanLibraryTab, type PlanLibraryTabConfig, type PlanNestedItemsOf,
} from './plan/index.js';

// The Sheet (#1179, #1216): the planning spreadsheet a solution mounts,
// `<Sheet>` — over an e3 record or the host's rows, in its frame, its library
// and inspector panes optional props — its authoring vocabulary on `Sheet`
// (`Sheet.column.*`, `Sheet.register.*`, `Sheet.driver`, `Sheet.link.*`,
// `Sheet.group`, `Sheet.patch`, `Sheet.templates`, `Sheet.library.*`,
// `Sheet.field`, `Sheet.apply`, `Sheet.Types`), and its props.
export {
    Sheet, type SheetNamespace, type SheetOptions, type SheetCommon, type SheetTemplates, type SheetTemplatesConfig, type SheetTemplatesProp,
    type SheetLibraryTab, type SheetLibraryTabConfig, type SheetOptimiseRequestType, type SheetOptimiseResultType,
} from './sheet/index.js';

// The Flowchart (#1498): the state-transition flowchart a solution mounts,
// `<Flowchart>` — one flowchart over the app's own records, its states in
// ordered lanes, the transitions between them and the decisions that govern
// them, each kind's fields mapped to its roles, in its frame, its library
// pane an optional prop and its inspector on by default, every gesture a
// transaction of its editing session, narrowed through one
// `Slice.bindRecords` — its kinds, cards, patches, library tabs and East
// types (`Flowchart.states`, `Flowchart.transitions`, `Flowchart.lanes`,
// `Flowchart.decisions`, `Flowchart.templates`, `Flowchart.patch`,
// `Flowchart.library`, `Flowchart.Types`), its details and their reads
// (`Flowchart.details`, `Flowchart.figure`, `Flowchart.histogram`,
// `Flowchart.list`, `Flowchart.tags`), and its props.
export {
    Flowchart, type FlowchartNamespace, type FlowchartTypes, type FlowchartProps,
    type FlowchartStatesSpec, type FlowchartTransitionsSpec, type FlowchartLanesSpec, type FlowchartDecisionsSpec,
    type FlowchartStates, type FlowchartTransitions, type FlowchartLanes, type FlowchartDecisions, type FlowchartBinding, type FlowchartWholeBinding,
    type FlowchartTextField, type FlowchartKeyField, type FlowchartKeysField, type FlowchartOrderField, type FlowchartValuesOf,
    type FlowchartTemplates, type FlowchartTemplatesSpec,
    type FlowchartDetails, type FlowchartDetailsSpec, type FlowchartTransitionDetailsSpec, type FlowchartDetailsBinding,
    type FlowchartRead, type FlowchartReadKind, type FlowchartShow, type FlowchartLabelDraws, type FlowchartLegendOnCanvas,
    type FlowchartFigureField, type FlowchartHistogramField, type FlowchartListField, type FlowchartTagsField, type FlowchartListItem,
    type FlowchartHistogramOptions, type FlowchartDurationUnit, type FlowchartBarScale, type FlowchartTick, type FlowchartTagColor,
    type FlowchartLibrary, type FlowchartLibraryTab, type FlowchartKindTab, type FlowchartKindTabOptions, type FlowchartAuthorTab,
    type FlowchartLibraryRows, type FlowchartTabConfig,
    type FlowchartCanvasOptions, type FlowchartFreshnessInput, type FlowchartOrientationLiteral,
} from './flowchart/index.js';

// The Schematic (#1381): the 2D world-coordinate drawing a solution mounts,
// `<Schematic>` — its kinds over the app's own records (items, zones, links
// and nets, each by slot), their details and templates, its layers read from
// the app's record, its library's tabs, the pattern and geometry helpers and
// the East types it is written with (`Schematic.items`, `Schematic.details`,
// `Schematic.layers`, `Schematic.library.*`, `Schematic.hatch()`,
// `Schematic.Types`), and its props.
export {
    Schematic, type SchematicNamespace, type SchematicTypes, type SchematicProps, type SchematicLayers, type SchematicLayersConfig,
    type SchematicNarrowedOptions,
    type SchematicItemsConfig, type SchematicZonesConfig, type SchematicLinksConfig, type SchematicNetsConfig, type SchematicDetailsConfig,
    type SchematicItems, type SchematicZones, type SchematicLinks, type SchematicNets, type SchematicDetails, type SchematicRecord,
    type SchematicEnd, type SchematicSide, type SchematicStatusConfig, type SchematicValuesOf, type SchematicTemplates, type SchematicTemplatesConfig,
    type SchematicLibrary, type SchematicLibraryTab, type SchematicLibraryTabConfig,
    type SchematicPatternConfig, type SchematicPolylineConfig, type SchematicVertexInput, type SchematicVertices, type SchematicToneLiteral,
} from './schematic/index.js';

// Schedule (#1218, #1190): the event and resource kinds the Calendar and
// Plan's builder share — `Schedule.events`, `Schedule.resources`,
// `Schedule.field`, `Schedule.patch`, `Schedule.days`, `Schedule.unscheduled`
// and `Schedule.Types` — with Plan's options beside the Calendar's, and the
// Roster's and the Allocation's beside them, with what a builder publishes,
// `Schedule.periods` (#1367).
export {
    Schedule, type ScheduleNamespace,
    type ScheduleBacklog, type ScheduleEventKind, type ScheduleEventsBase, type ScheduleEventsConfig, type ScheduleInstantEventsConfig,
    type ScheduleInstantTemplate, type ScheduleOverlapsLiteral, type ScheduleParts, type SchedulePatchInput, type SchedulePatchOf,
    type SchedulePeriods, type SchedulePeriodsConfig, type ScheduleQuantity, type ScheduleRecordHandle, type ScheduleResourceKind,
    type ScheduleResourcesConfig, type ScheduleTemplate, type ScheduleNewValues,
} from './schedule/index.js';
// The optimiser's request and answer over a Calendar's or a Plan's event kinds (#1409): the types `Calendar.Types` and
// `Plan.Types` build them with, for an app that names them in its own code.
export {
    type ScheduleOptimiseRecordsOf, type ScheduleOptimiseRequestType, type ScheduleOptimiseResultType, type ScheduleOptimiseRows,
} from './schedule/optimise.js';
// The handle a Calendar's, a Plan's or a Sheet's `optimise` takes (#1409): any `Func.bind` handle, checked at build.
export { type OptimiseHandle } from './utils/optimise.js';

// e3 `<Ontology>` tag + its types
export { Ontology } from './runtime/ontology.js';
export {
    OntologyPayloadType,
    OntologyStyleType,
    type OntologyOptions,
    NodeKindType,
    LinkKindType,
    NodeType,
    LinkType,
    OntologyMetadataType,
    OntologyType,
    type OntologyStructType,
    OntologyViewType,
    type OntologyViewLiteral,
} from './ontology/index.js';

// Decision platform types + factory
export { Decision } from './decision/index.js';
export {
    DecisionType,
    DecisionOptionType,
    UrgencyType,
    type UrgencyLiteral,
    StakesLevelType,
    type StakesLevelLiteral,
    EvidenceType,
    AnswerType,
    type AnswerLiteral,
    VerdictType,
    ReferenceType,
    JudgementInputType,
    DecisionConstraintType,
    PromptType,
    LeverType,
    judgementInputType,
    type PromptInput,
    type LeverInput,
    type DecisionInput,
    type DecisionOptionInput,
    type EvidenceInput,
    type DecisionReferenceInput,
    type DecisionJudgementInput,
} from './decision/types.js';
export {
    decisionBind,
    decisionBindPlatformFn,
    DecisionHandleType,
    DecisionHandleRefType,
    CommitStateType,
    JudgementsType,
    type DecisionHandle,
    type DecisionBindOptions,
} from './decision/bind.js';
// e3 `<DecisionQueue>` tag (+ author-facing options type)
export { DecisionQueue } from './runtime/decision/queue.js';
export { type DecisionQueueOptions } from './decision/queue.js';
export { DecisionJournal } from './runtime/decision/journal.js';
export { type DecisionJournalOptions } from './decision/journal.js';

export { Calendar, type CalendarProps, type CalendarLibraryTab } from "./calendar/index.js";

// Record-backed staffing roster.
export { Roster, type RosterProps, type RosterNamespace } from "./roster/index.js";
export type {
    RosterActivitiesConfig, RosterGroups, RosterGroupsConfig, RosterPatterns, RosterPatternsConfig, RosterPositions, RosterPositionsConfig,
    RosterProposals, RosterProposalsConfig, RosterShifts, RosterShiftsConfig,
} from "./roster/lists.js";
export type { RosterTargets, RosterTargetsConfig } from "./roster/targets.js";
export type { RosterLibraryTab } from "./roster/library.js";

// The Allocation (#1371): a day's arrivals booked into lane slots and
// allocated to resources, over the app's own bins, lanes, resources, arrivals
// and days, with the app's fit on e3.
export {
    Allocation, type AllocationNamespace, type AllocationProps, type AllocationColumn, type AllocationLibraryDeclaration, type AllocationNoun,
} from "./allocation/index.js";
export type { AllocationArrivals, AllocationArrivalsConfig } from "./allocation/adapters.js";
