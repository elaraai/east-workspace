/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Internal exports — the `Plan` / `Sheet` / `Flowchart` / `Diff` / `Ontology`
 * **factories** (`Plan.Payload(…)`, `Sheet.Payload(…)`, `Flowchart.Payload(…)`,
 * `Diff.Root(…)`, `Diff.Component`) plus `Data`, the manifest type and
 * derivation, and types.
 *
 * @remarks
 * The public `@elaraai/e3-ui` entry exports JSX **tags** (and `ui()`, which
 * pulls in Node-only `@elaraai/e3`). This entry is e3-free and is what the
 * renderer (`e3-ui-components`) and the in-repo specs import — they build /
 * inspect IR directly via the factories and the `*.Component` carriers.
 *
 * @internal
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
    DataBindPrimitives,
    DataPagedHandleType,
    type PagedValue,
    type IndexWindowType,
    type BindPagedIndexOptions,
    bindPagedPlatformFn,
    bindPagedPinnedPlatformFn,
    DataPagedPrimitives,
} from './bind/data.js';
export {
    Func,
    FuncStatusType,
    FuncErrorType,
    FuncBindingType,
    FuncBindHandleType,
    type BoundFunc,
    funcBindPlatformFn,
    FuncBindPrimitives,
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
    RecordBindPrimitives,
} from './bind/record.js';
export { DataManifestType, type DataManifest } from './utils/manifest.js';
export { deriveManifest } from './utils/derive.js';

// The Studio (#787): its components' factories and carriers, the payloads the
// renderers take, and the East the renderers call. `Studio` here is the
// internal namespace — the public one, and the page functions.
export {
    StudioInternal as Studio,
    StudioComponentType,
    StudioFrameType,
    StudioCellChangeType,
    StudioCellType,
    StudioChangeType,
    StudioEntryType,
    StudioKeyType,
    StudioLiveType,
    StudioPageEntryType,
    StudioPageType,
    StudioPagesHandleType,
    StudioPagesType,
    StudioStatusType,
    StudioVersionType,
    fingerprintOf,
    saveCells,
    type StudioNamespace,
    type StudioInternalNamespace,
    type StudioTypes,
    type StudioComponentMeta,
    type StudioFrameLiteral,
    type StudioPagesHandle,
    type StudioPageOptions,
    type StudioVersionLiteral,
    type StudioBuilderOptions,
    type StudioLibraryOptions,
    StudioPageComponent,
    StudioPagePayloadType,
    StudioBuilderComponent,
    StudioBuilderPayloadType,
    StudioLibraryComponent,
    StudioLibraryPayloadType,
    StudioLibraryPageType,
    StudioLibraryTemplateType,
    libraryProjects,
    libraryPages,
    libraryTemplates,
    layoutSummary,
    nameWriteRefusal,
    builderKeys,
    paletteCards,
    palettePages,
    PaletteCardType,
    PalettePageType,
    canvasTiles,
    CanvasTileType,
    StudioSaveTemplatePayloadType,
    inspectorSelection,
    InspectorLayoutType,
    InspectorSelectionType,
    StudioInspectorPayloadType,
    PublishChangeType,
    PublishStandingType,
    PublishSummaryType,
    StudioPublishPayloadType,
    publishSummary,
    publishRefusal,
} from './studio/index.js';

// The query builder and the query library (#875): their factories and
// carriers, the payloads the renderers take, the East they call, and the types
// the step functions take. `Query` here is the internal namespace — the public
// one, and the saved queries' East.
export {
    QueryInternal as Query,
    QueryAggregateFunctionType,
    QueryAggregateType,
    QueryBuilder,
    QueryBuilderComponent,
    QueryBuilderPayloadType,
    QueryLibrary,
    QueryLibraryComponent,
    QueryLibraryPayloadType,
    QueryComparisonType,
    QueryConditionType,
    QueryDatePartType,
    QueryGroupByType,
    QueryInputType,
    QueryMatchType,
    QueryPickFieldType,
    QueryResultType,
    QueryRootBoundType,
    QueryRootEntryType,
    QuerySortDirectionType,
    QueryStepInputType,
    QueryStepType,
    QueryStepValueType,
    QueryStepsType,
    QueriesHandleType,
    SavedQueriesPatchType,
    SavedQueriesType,
    SavedQueryType,
    queryKeys,
    rootBound,
    saveQuery,
    savedQueriesValue,
    type QueriesHandle,
    type QueryBuilderOptions,
    type QueryInternalNamespace,
    type QueryLibraryOptions,
    type QueryNamespace,
    type QueryTypes,
    type SavedQueryInput,
} from './query/index.js';
export { DataSourceType, dataSources, type BoundSource } from './bind/sources.js';

// The Plan (#1177, #1191): `<Plan>` with its namespace, the payload the
// renderer takes through the `Plan` carrier, the canvas's root, its editing
// wire, and the types a Plan is written with. `Plan` here is the internal
// namespace — the public one, `Plan.Payload`, `Plan.Root` and
// `Plan.Component`.
export {
    PlanInternal as Plan,
    PlanTag,
    PlanComponent,
    PlanPayloadType,
    PlanSettingsType,
    PlanEventBlocksType,
    PlanEventCanDropType,
    createPlanPayload,
    createPlanRoot,
    buildPlanRoot,
    planKeys,
    createOver,
    createEventRef,
    eventRefKind,
    type PlanTagType,
    type PlanProps,
    type PlanRowsItem,
    type PlanOverRows,
    type PlanCanvasOptions,
    PlanRootType,
    PlanEditingType,
    PlanWriteRequestType,
    PlanReadyEntryType,
    PLAN_PAGE_SIZE,
    type PlanNamespace,
    type PlanInternalNamespace,
    type PlanConfig,
    type PlanRowBaseInput,
    type PlanSpanInput,
    type PlanBucketsInput,
    type PlanChartInput,
    type PlanHeatInput,
    type PlanTableInput,
    type PlanCardsInput,
    type PlanEventsInput,
    type PlanGroupInput,
    type PlanRunInput,
    type PlanDecisionInput,
    type PlanPortInput,
    type PlanBucketEventInput,
    type PlanCellMarkerInput,
    type PlanChipInput,
    type PlanEventMarkInput,
    type PlanSegmentInput,
    type PlanTableSeriesInput,
    type PlanExpandInput,
    type PlanLinkInput,
    type PlanIconInput,
    type PlanLayerChannels,
    type PlanChartLayerInput,
    type PlanChartAxisInput,
    type PlanHeatCellsOptions,
    type PlanEditingConfig,
    type PlanBindHandle,
    type PlanEditInput,
    type PlanRowsInput,
    type PlanRowsValue,
    type PlanSeriesArm,
    type PlanSeriesValue,
    type PlanSeriesInput,
    type PlanSeriesIdentity,
    type PlanEntryExpr,
    type PlanAccessor,
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
} from './plan/index.js';
// The resources' rows a Plan of event kinds draws over a window (#1192): the
// `blocks` seam its payload carries, made inside the payload's assembly, and
// the drafts it reads, by kind; and a paged resource kind's rows, a window of
// its resources at a time, with the events placed on them (#1199).
export {
    createEventBlocks, createEventPaged, eventDrawsOf, PlanEventDraftsType, PlanEventPagedType, PlanEventPlacedType,
} from './plan/event-rows.js';
// The Plan's library pane on the wire (#1195): its tabs, an author's tab's
// cards, the Series tab's lines and what hiding each hides, and the ids a
// viewer's hidden set holds.
export {
    PlanLibraryCardType,
    PlanLibraryHidesType,
    PlanLibraryRowsItemType,
    PlanLibrarySeriesType,
    PlanLibraryTabType,
    planHideId,
    type PlanLibraryTab,
    type PlanLibraryTabConfig,
} from './plan/library.js';

// The Sheet (#1179, #1216): `<Sheet>` with its namespace, the payload the
// renderer takes through the `Sheet` carrier, the grid's root, its editing
// wire, and the types a sheet is written with. `Sheet` here is the internal
// namespace — the public one, `Sheet.Payload`, `Sheet.Root` and
// `Sheet.Component`.
export {
    SheetInternal as Sheet,
    type SheetNamespace,
    type SheetInternalNamespace,
    type SheetOptions,
    type SheetGroupedOptions,
    type SheetEntriesOptions,
    type SheetReadyInput,
    type SheetSuggestInput,
    type SheetProposerInput,
    type SheetStringField,
    type SheetBindHandle,
    type SheetColumn,
    type SheetColumnSpec,
    type SheetFieldKey,
    type SheetMemberArrayField,
    type SheetFillInput,
    type SheetOptionsInput,
    type SheetColumnBaseConfig,
    type SheetValueConfig,
    type SheetTextConfig,
    type SheetDateConfig,
    type SheetQuantityConfig,
    type SheetIntegerConfig,
    type SheetLookupConfig,
    type SheetReferenceConfig,
    type SheetEnumConfig,
    type SheetMemberKindInput,
    type SheetMultipleInput,
    type SheetSetConfig,
    type SheetSidesInput,
    type SheetLinkConfig,
    type SheetStampedConfig,
    type SheetCustomConfig,
    type SheetRegisterValue,
    type SheetMembersConfig,
    type SheetDriverConfig,
    type SheetDriverValue,
    type SheetArityInput,
    type SheetCheckInput,
    type SheetExistsCheck,
    type SheetLocksInput,
} from './sheet/index.js';
export * from './sheet/types.js';
export * from './sheet/transactions.js';
export * from './sheet/drafts.js';
export * from './sheet/editing-types.js';
// A record's rows and the Apply back to it (#1182), the grid's root e3-ui's
// own factories build over them, and the sheet's payload, carrier, templates,
// library and inspector pane on the wire, and its shared keys (#1183, #1186,
// #1188, #1216).
export { recordRows, type SheetRecordEntry, type SheetRecordRows, type SheetRecordRowsOptions } from './sheet/record.js';
export { createSheetRoot, createSheetRootWith, createSheetBuild, type SheetBuild, type SheetInternalOptions } from './sheet/root.js';
export {
    SheetComponent,
    SheetPayloadType,
    SheetInspectorType,
    SheetInspectorPaneType,
    SheetHistoryType,
    buildInspector,
    buildInspectorPane,
    createSheetPayload,
    sheetKeys,
    type SheetTagType,
    type SheetRecordHandle,
    type SheetEntryRows,
    type SheetLooseEntryRows,
    type SheetEntriesField,
    type SheetCommon,
} from './sheet/sheet.js';
export { SheetTemplateWireType, buildTemplates, type SheetTemplate, type SheetTemplatesInput } from './sheet/templates.js';
export {
    SheetLibraryCardType,
    SheetLibraryDropType,
    SheetLibraryTabType,
    buildLibrary,
    type SheetLibraryTab,
    type SheetLibraryTabConfig,
} from './sheet/library.js';
export { SheetFieldType, SheetFormType, SheetFormsType, buildForms } from './sheet/fields.js';
// The Flowchart (#1243–#1247): `<Flowchart>` with its namespace, the payload
// the renderer takes through the `Flowchart` carrier — its canvas, its source
// of flows with the editing session's Save over a record or the host's flows,
// and its library's wire — its shared keys, its library's tabs, and the types
// a flowchart is written with. `Flowchart` here is the internal namespace —
// the public one, `Flowchart.Payload`, `Flowchart.Component` and the payload's
// types.
export {
    FlowchartInternal as Flowchart,
    FlowchartTag,
    FlowchartComponent,
    FlowchartPayloadType,
    FlowchartCanvasType,
    FlowchartSourceType,
    FlowchartDataType,
    FlowchartFlowsHandleType,
    FlowchartSessionApplyType,
    FlowchartLibraryFactories,
    libraryFlows,
    type FlowchartLibrary,
    type FlowchartLibraryTab,
    type FlowchartOneFlowLibraryTab,
    FlowchartFlowsApplyType,
    FlowchartFlowApplyType,
    FlowchartHistoryType,
    FlowchartLibraryTabType,
    FlowchartLandsType,
    FlowchartCardType,
    FlowchartStateCardType,
    FlowchartTransitionCardType,
    FlowchartLaneCardType,
    FlowchartDecisionCardType,
    FlowchartPatchTypeFor,
    buildCanvas,
    createFlowchartPayload,
    flowchartKeys,
    flowchartOver,
    flowchartPatch,
    flowchartValue,
    flowchartValues,
    type FlowchartTagType,
    type FlowchartNamespace,
    type FlowchartInternalNamespace,
    type FlowchartTypes,
    type FlowchartCommon,
    type FlowchartRecordHandle,
    type FlowchartBindHandle,
    type FlowchartCanvasOptions,
    type FlowchartSliceOptions,
    type FlowchartFreshnessInput,
    type FlowchartOrientationLiteral,
    type RowElement,
    type FlowchartTables,
    type FlowchartStateFields,
    type FlowchartLinkFields,
    type FlowchartLaneFields,
    type FlowchartTriggerFields,
    type FlowchartEvidenceFields,
    type FlowchartLaneLiteral,
    type FlowchartFlowInput,
    type FlowchartLaneInput,
    type FlowchartStateInput,
    type FlowchartLinkInput,
    type FlowchartEvidenceInput,
    type FlowchartTriggerInput,
    type FlowchartLinkKindLiteral,
    type FlowchartRowType,
    type FlowchartPatchOf,
    type FlowchartPatchInput,
} from './flowchart/index.js';
export * from './flowchart/types.js';
// Schedule (#1218, #1190): the kinds the Calendar and Plan's builder share,
// the checks a builder makes across its slots, and the kinds' wire, the
// Calendar's and Plan's. `Schedule` here is the internal namespace — the
// public one, `check` and the wire types.
export {
    ScheduleInternal as Schedule,
    scheduleCheck,
    type ScheduleNamespace,
    type ScheduleInternalNamespace,
} from './schedule/index.js';
export * from './schedule/types.js';
export {
    scheduleEvents,
    type ScheduleAtField, type ScheduleBacklog, type ScheduleEventKind, type ScheduleEventsBase, type ScheduleEventsConfig,
    type ScheduleFloatField, type ScheduleInstantEventsConfig, type ScheduleInstantField, type ScheduleInstantTemplate,
    type ScheduleOverlapsLiteral, type ScheduleQuantity, type ScheduleRecordHandle, type ScheduleResourceField, type ScheduleResourceOf,
    type ScheduleStateField, type ScheduleStatusCasesOf, type ScheduleStatusConfig, type ScheduleStatusField, type ScheduleStringField,
    type ScheduleTemplate, type ScheduleValuesOf,
} from './schedule/events.js';
export { SCHEDULE_DEF, scheduleResources, type ScheduleResourceKind, type ScheduleResourcesConfig } from './schedule/resources.js';
export { scheduleDays, scheduleUnscheduled } from './schedule/days.js';
// The window reader (#1199): an event kind's record read a window at a time,
// through its day index and its backlog index — the Calendar's and Plan's —
// and one entry of a record read by its key, through its own entries.
export {
    SCHEDULE_INDEX_PAGE, ScheduleKeyReadType, checkEntries, checkIndexWindow, joinRefusal, scheduleBacklogWindow, scheduleDayWindow,
    scheduleEntryByKey, scheduleLastKey, type ScheduleWindowProp,
} from './schedule/window.js';
export { SchedulePatchTypeFor, schedulePatch, type SchedulePatchInput, type SchedulePatchOf } from './schedule/patch.js';
export {
    Diff,
    DiffComponent,
    DiffPayloadType,
    DiffStyleType,
    type DiffOptions,
} from './diff/index.js';
export {
    Ontology,
    OntologyComponent,
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
// Experiment factory + component carrier for renderers/tests. The value types
// ride on `Experiment.Types`, so they are not re-exported individually here.
export { Experiment, ExperimentComponent } from './experiment/index.js';
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
    DecisionBindPrimitives,
    DecisionHandleType,
    DecisionHandleRefType,
    CommitStateType,
    JudgementsType,
    type DecisionHandle,
    type DecisionBindOptions,
} from './decision/bind.js';
export {
    DecisionQueue,
    DecisionQueueComponent,
    DecisionQueuePayloadType,
    DecisionUpdateType,
    type DecisionQueueOptions,
} from './decision/queue.js';
export {
    DecisionJournal,
    DecisionJournalComponent,
    DecisionJournalPayloadType,
    type DecisionJournalOptions,
} from './decision/journal.js';
