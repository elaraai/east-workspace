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
 * - `<Flowchart>` — the state-transition flowchart: states in ordered phase
 *   lanes, H/V-routed transitions, decision triggers and evidence, over a
 *   record of flows or the host's flow, rendered in its frame with its panes
 *   as optional props, with the values, patches, library tabs and types it is
 *   written with on `Flowchart` (`Flowchart.values`, `Flowchart.value`,
 *   `Flowchart.over`, `Flowchart.patch`, `Flowchart.library`,
 *   `Flowchart.Types`).
 * - `Schedule` — the event and resource kinds the Calendar and Plan's builder
 *   share (`Schedule.events`, `Schedule.resources`).
 * - `<Diff>` — review pending changes for any combination of bindings.
 * - `<Ontology>` — graph editor over an `OntologyType`-bound dataset.
 * - `Data.bind` — workspace-scoped reactive dataset binding.
 * - `Func.bind` — workspace-scoped named-function (RPC) call binding.
 * - `ui()` — declare a first-class UI task.
 *
 * east-ui tags (`<VStack>`, `<Text>`, …) are imported from `@elaraai/east-ui`
 * — this package does not re-export them. The underlying factories
 * (`Diff.Root(…)`) live under `@elaraai/e3-ui/internal` for renderers and tests.
 *
 * @remarks
 * `ui()` pulls in `@elaraai/e3` (Node-only). Browser bundles that only need
 * `Data` / `<Diff>` / `<Ontology>` / types should import from
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
    Record,
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
export { DataManifestType, type DataManifest } from './utils/manifest.js';
export { deriveManifest } from './utils/derive.js';
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
    fingerprintOf,
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
    type PlanLibraryTab, type PlanLibraryTabConfig,
} from './plan/index.js';

// The Sheet (#1179, #1216): the planning spreadsheet a solution mounts,
// `<Sheet>` — over an e3 record or the host's rows, in its frame, its library
// and inspector panes optional props — its authoring vocabulary on `Sheet`
// (`Sheet.column.*`, `Sheet.register.*`, `Sheet.driver`, `Sheet.link.*`,
// `Sheet.group`, `Sheet.patch`, `Sheet.library.*`, `Sheet.field`,
// `Sheet.apply`, `Sheet.Types`), and its props.
export {
    Sheet, type SheetNamespace, type SheetOptions, type SheetCommon, type SheetTemplate, type SheetTemplatesInput,
    type SheetLibraryTab, type SheetLibraryTabConfig,
} from './sheet/index.js';

// The Flowchart (#1243, #1244, #1245, #1246): the state-transition flowchart a
// solution mounts, `<Flowchart>` — states in ordered phase lanes, H/V-routed
// transitions, decision triggers and evidence-weighted strokes, over a record
// of flows or the host's flow, in its frame, its library and inspector panes
// optional props — the values, patches, library tabs and East types it is
// written with (`Flowchart.values`, `Flowchart.value`, `Flowchart.over`,
// `Flowchart.patch`, `Flowchart.library`, `Flowchart.Types`), and its props.
export {
    Flowchart, type FlowchartNamespace, type FlowchartTypes, type FlowchartCommon, type FlowchartRecordHandle, type FlowchartBindHandle,
    type FlowchartLibrary, type FlowchartLibraryTab, type FlowchartOneFlowLibraryTab,
    type FlowchartCanvasOptions, type FlowchartSliceOptions, type FlowchartFreshnessInput, type FlowchartOrientationLiteral,
    type FlowchartLinkModeLiteral, type FlowchartTables, type FlowchartStateFields, type FlowchartLinkFields, type FlowchartLaneFields,
    type FlowchartTriggerFields, type FlowchartEvidenceFields, type FlowchartLaneLiteral, type FlowchartFlowInput, type FlowchartLaneInput,
    type FlowchartStateInput, type FlowchartLinkInput, type FlowchartEvidenceInput, type FlowchartTriggerInput, type FlowchartLinkKindLiteral,
    type FlowchartRowType, type FlowchartPatchOf, type FlowchartPatchInput,
} from './flowchart/index.js';

// Schedule (#1218, #1190): the event and resource kinds the Calendar and
// Plan's builder share — `Schedule.events`, `Schedule.resources`,
// `Schedule.field`, `Schedule.patch`, `Schedule.days`, `Schedule.unscheduled`
// and `Schedule.Types` — with Plan's options beside the Calendar's.
export {
    Schedule, type ScheduleNamespace,
    type ScheduleBacklog, type ScheduleEventKind, type ScheduleEventsBase, type ScheduleEventsConfig, type ScheduleInstantEventsConfig,
    type ScheduleInstantTemplate, type ScheduleOverlapsLiteral, type SchedulePatchInput, type SchedulePatchOf, type ScheduleQuantity,
    type ScheduleRecordHandle, type ScheduleResourceKind, type ScheduleResourcesConfig, type ScheduleTemplate,
} from './schedule/index.js';

// e3 `<Diff>` tag + its types
export { Diff } from './runtime/diff.js';
export {
    DiffPayloadType,
    DiffStyleType,
    type DiffOptions,
} from './diff/index.js';

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

// e3 `<Experiment>` tag + its payload/options. The render-contract value types
// (Config / Result / DoseResponse / Journal …) are intentionally NOT public
// named exports — reach them via `Experiment.Types.Config`, `.Result`, … (like
// `Table.Types.*`), since users only touch them to type the bound `experiment`
// function / seed result datasets.
export { Experiment } from './runtime/experiment.js';
export {
    ExperimentPayloadType,
    type ExperimentOptions,
    type ExperimentTabLiteral,
} from './experiment/index.js';

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
