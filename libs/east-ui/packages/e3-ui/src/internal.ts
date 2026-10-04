/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Internal exports — the `Plan` / `Diff` / `Ontology` **factories**
 * (`Plan.Root(…)`, `Diff.Root(…)`, `Diff.Component`) plus `Data`, the
 * manifest type and derivation, and types.
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

// The Plan (#1177): the canvas's factory and the `PlanView` carrier, the
// payload the renderer takes, the editing wire it is handed, and the types a
// canvas is written with. `Plan` here is the internal namespace — the public
// one, `Plan.Root`, `Plan.Payload` and `Plan.Component`.
export {
    PlanInternal as Plan,
    PlanView,
    PlanViewComponent,
    PlanRootType,
    PlanReviewType,
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
    type PlanReviewConfig,
    type PlanEditingConfig,
    type PlanBindHandle,
    type PlanReviewInput,
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
