/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3 Data platform — reactive dataset cache, runtime, and React hooks for Data.bind.
 *
 * @packageDocumentation
 */

// Cache
export {
    ReactiveDatasetCache,
    createReactiveDatasetCache,
    type ReactiveDatasetCacheInterface,
    type ReactiveDatasetCacheConfig,
    datasetCacheKey,
    datasetPathToString,
} from "./dataset-store.js";

// Runtime
export {
    ReactiveDatasetPlatform,
    getReactiveDatasetCache,
    initializeReactiveDatasetCache,
    clearReactiveDatasetCache,
    enableDatasetTracking,
    disableDatasetTracking,
    isDatasetTracking,
    trackDatasetPath,
    createDatasetTracker,
    preloadReactiveDatasetList,
    clearReactiveDatasetListCache,
} from "./dataset-runtime.js";

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
