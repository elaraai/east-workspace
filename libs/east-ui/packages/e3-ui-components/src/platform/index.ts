/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3 Data platform — reactive dataset cache, runtime, and React hooks for
 * `Data.bind`.
 *
 * @packageDocumentation
 */

// Cache
export {
    ReactiveDatasetCache,
    createReactiveDatasetCache,
    createDefaultDatasetApi,
    realClock,
    type ReactiveDatasetCacheInterface,
    type ReactiveDatasetCacheConfig,
    type DatasetApi,
    type Clock,
    datasetCacheKey,
    datasetPathToString,
} from "./dataset-store.js";

// Staged buffer — IndexedDB-backed local edit buffer used by staged-mode
// `Data.bind` calls. Public so tests / non-e3 hosts can wire a custom
// adapter.
export {
    StagedStore,
    IndexedDBStagedAdapter,
    MemoryStagedAdapter,
    type StagedStoreInterface,
    type StagedPersistenceAdapter,
    type StagedEntry,
    type PersistedStagedEntry,
    getStagedStore,
    initializeStagedStore,
    clearStagedStoreSingleton,
} from "./staged-store.js";

// Unified `Data.bind` runtime — replaces the legacy dataset / staged /
// overlay runtimes with a single mode-dispatched implementation.
export {
    BindRuntime,
    defaultBindRuntime,
    BindPlatform,
    createScopedBindPlatform,
    getReactiveDatasetCache,
    initializeReactiveDatasetCache,
    clearReactiveDatasetCache,
    enableBindingTracking,
    disableBindingTracking,
    isBindingTracking,
    trackDatasetPath,
    getBindingTypes,
    clearBindingRegistry,
    type BindingTypes,
    type BindHandle,
    preloadReactiveDatasetList,
    clearReactiveDatasetListCache,
    onWriteError,
    awaitPendingWrites,
    clearPendingWrites,
} from "./bind-runtime.js";

// `Func.bind` runtime — workspace-scoped named-function (RPC) calls.
export {
    FuncRuntime,
    defaultFuncRuntime,
    FuncPlatform,
    createScopedFuncPlatform,
    createDefaultFunctionApi,
    initializeFunctionApi,
    clearFunctionApi,
    funcChannelKey,
    signatureOfHandleType,
    createInMemoryFunctionApi,
    type InMemoryFunctionDef,
    type FunctionApi,
    type FunctionCallArgs,
} from "./func-runtime.js";

// `Record.bind` runtime — read + typed mutations over an e3.record.
export {
    RecordRuntime,
    defaultRecordRuntime,
    RecordPlatform,
    createScopedRecordPlatform,
    createDefaultRecordApi,
    initializeRecordApi,
    clearRecordApi,
    recordChannelKey,
    createInMemoryRecordApi,
    type InMemoryRecordDef,
    type RecordApi,
    type RecordMutateArgs,
} from "./record-runtime.js";

// E3 server-identity context (apiUrl / repo / workspace / token).
// Mounted as the outermost e3-related provider; every hook in this
// package that talks to e3 reads from it.
export {
    E3Provider,
    useE3Config,
    useE3ConfigOptional,
    type E3Config,
    type E3ProviderProps,
} from "./e3-config.js";

// React hooks and provider
export {
    ReactiveDatasetProvider,
    type ReactiveDatasetProviderProps,
    useReactiveDatasetCache,
    useReactiveDatasetCacheSubscription,
    useReactiveDatasetKey,
    usePreloadReactiveDatasets,
    type ReactiveDatasetToPreload,
    type PreloadReactiveDatasetsResult,
    useReactiveDatasetWrite,
    useReactiveDatasetHas,
    ReactiveDatasetLoader,
    type ReactiveDatasetLoaderProps,
} from "./dataset-hooks.js";
