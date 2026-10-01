/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// =============================================================================
// Side-effect imports — register platform implementations + UI extension
// renderers at module load. Keeping these as explicit imports (rather than
// relying on the package.json `sideEffects` field) makes registration
// bulletproof under bundlers that ignore or partially honour that field.
// =============================================================================
import './platform/bind-runtime.js';      // → registerPlatformImplementation(BindPlatform)
import './platform/paged-runtime.js';     // → registerPlatformImplementation(PagedPlatform)
import './platform/func-runtime.js';      // → registerPlatformImplementation(FuncPlatform)
import './diff/index.js';                 // → implementUIComponent(Diff.Component, EastChakraDiff)
import './ontology/index.js';             // → implementUIComponent(Ontology.Component, EastChakraOntology)
import './experiment/index.js';           // → implementUIComponent(Experiment.Component, EastChakraExperiment)
import './decision/queue.js';             // → implementUIComponent(DecisionQueue.Component, EastChakraDecisionQueue)
import './decision/journal.js';           // → implementUIComponent(DecisionJournal.Component, EastChakraDecisionJournal)
import './studio/builder.js';             // → implementUIComponent(StudioBuilderComponent, EastChakraStudioBuilder)
import './studio/library.js';             // → implementUIComponent(StudioLibraryComponent, EastChakraStudioLibrary)
import './studio/page.js';                // → implementUIComponent(StudioPageComponent, EastChakraStudioPage)
import './query/builder.js';              // → implementUIComponent(QueryBuilderComponent, EastChakraQueryBuilder)

// Platform — reactive dataset cache, runtime, and React hooks for Data.bind
export * from './platform/index.js';

// Utilities
export { formatApiError, formatError } from './errors.js';

// Hooks
export * from './hooks/index.js';

// Diff renderer — registers itself against the Diff extension on import.
export { EastChakraDiff, type EastChakraDiffProps } from './diff/index.js';

// Ontology renderer — registers itself against the Ontology extension on import.
export { EastChakraOntology, type EastChakraOntologyProps } from './ontology/index.js';
// Experiment renderer — registers itself against the Experiment extension on import.
export { EastChakraExperiment, type EastChakraExperimentProps } from './experiment/index.js';

// Decision queue renderer — registers itself against the DecisionQueue extension on import.
export { EastChakraDecisionQueue, type EastChakraDecisionQueueProps } from './decision/queue.js';
export { EastChakraDecisionJournal, type EastChakraDecisionJournalProps } from './decision/journal.js';
export { useDecisionHandle, type UseDecisionHandleResult, type DecisionHandleValue } from './decision/handle-runtime.js';

// Studio renderers — each registers itself against its extension on import: the builder,
// the page library and one page — and the Studio's words.
export { EastChakraStudioBuilder, type EastChakraStudioBuilderProps } from './studio/builder.js';
export { EastChakraStudioLibrary, type EastChakraStudioLibraryProps } from './studio/library.js';
export { EastChakraStudioPage, type EastChakraStudioPageProps } from './studio/page.js';
export {
    studioMessages,
    useStudioMessages,
    StudioMessagesProvider,
    type StudioMessages,
    type StudioMessagesProviderProps,
} from './studio/messages.js';

// The query builder (#875) — its renderer registers itself against its
// extension on import — the builder's words, how it makes a one-shot call (and
// a call answered in memory, where there is no server), and the query's
// one-shot call itself, which a host can make without the builder.
export { EastChakraQueryBuilder, type EastChakraQueryBuilderProps, type QueryFocus, type QueryTab } from './query/builder.js';
export {
    QueryMessagesProvider,
    useQueryMessages,
    useQueryWords,
    type QueryMessagesProviderProps,
} from './query/words.js';
export { queryMessages, type QueryMessages } from './query/model/messages.js';
export {
    QueryCallProvider,
    useQueryCall,
    type QueryCall,
    type QueryCallProviderProps,
} from './query/hooks.js';
export { createInMemoryQueryCall, type InMemoryDataset } from './query/in-memory-call.js';
export {
    prepareQuery,
    queryResultOf,
    queryRoot,
    type PreparedQuery,
    type QueryOptions,
    type QueryRoot,
    type QueryRootEntry,
} from './query/one-shot.js';

// Components
export { ErrorBoundary, type ErrorBoundaryProps } from './components/ErrorBoundary.js';
export { InputPreview, type InputPreviewProps } from './components/InputPreview.js';
export { TaskPreview, type TaskPreviewProps } from './components/TaskPreview.js';
export { UITaskPreview, type UITaskPreviewProps } from './components/UITaskPreview.js';
export { DataTaskPreview, type DataTaskPreviewProps } from './components/DataTaskPreview.js';
export { DatasetPreview, type DatasetPreviewProps } from './components/DatasetPreview.js';
// Key search moved to east-ui-components in #574 (it has no e3 dependency);
// re-exported here so existing consumers of this package are untouched.
export {
    DatasetKeySearch,
    type DatasetKeySearchProps,
    type DatasetKeyMatchRange,
    type DatasetKeyQuery,
} from '@elaraai/east-ui-components';
export { StatusDisplay, type StatusDisplayProps } from './components/StatusDisplay.js';
export { EastValueViewer, type EastValueViewerProps } from './components/EastValueViewer.js';
export { VirtualizedLogViewer, type VirtualizedLogViewerProps } from './components/VirtualizedLogViewer.js';
