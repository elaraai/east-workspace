/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @elaraai/e3-ui — e3 + UI bridge.
 *
 * The public surface is the e3-specific JSX **tags** plus the platform
 * helpers:
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
    bindPagedPlatformFn,
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
    type BoundRecord,
    recordBindPlatformFn,
} from './bind/record.js';
export { DataManifestType, type DataManifest, encodeManifest, decodeManifest } from './utils/manifest.js';
export { deriveManifest } from './utils/derive.js';
export { ui } from './ui.js';

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
