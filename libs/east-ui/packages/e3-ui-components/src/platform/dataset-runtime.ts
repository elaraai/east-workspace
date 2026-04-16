/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Runtime implementation for Data.bind platform function.
 *
 * @packageDocumentation
 */

import {
    type EastTypeValue,
    encodeBeast2For,
    EastError,
} from "@elaraai/east";
import { type PlatformFunction } from "@elaraai/east/internal";
import { getWasmSync, decodeBeast2Value } from "@elaraai/east-ui-components";
import { Data } from "@elaraai/e3-ui";
import {
    registerReactiveTracker,
    registerPlatformImplementation,
} from "@elaraai/east-ui-components";
import type { TreePath } from "@elaraai/e3-types";
import {
    type ReactiveDatasetCacheInterface,
    datasetCacheKey,
} from "./dataset-store.js";

// =============================================================================
// Singleton Cache
// =============================================================================

let _reactiveDatasetCache: ReactiveDatasetCacheInterface | null = null;

export function getReactiveDatasetCache(): ReactiveDatasetCacheInterface {
    if (!_reactiveDatasetCache) {
        throw new Error(
            "ReactiveDatasetCache not initialized. " +
            "Use ReactiveDatasetProvider in React or call initializeReactiveDatasetCache() directly."
        );
    }
    return _reactiveDatasetCache;
}

export function initializeReactiveDatasetCache(cache: ReactiveDatasetCacheInterface): void {
    _reactiveDatasetCache = cache;
}

export function clearReactiveDatasetCache(): void {
    _reactiveDatasetCache = null;
}

// =============================================================================
// Reactive Dependency Tracking
// =============================================================================

let datasetTrackingContext: Set<string> | null = null;

export function enableDatasetTracking(): Set<string> {
    datasetTrackingContext = new Set();
    return datasetTrackingContext;
}

export function disableDatasetTracking(): string[] {
    const keys = datasetTrackingContext ? [...datasetTrackingContext] : [];
    datasetTrackingContext = null;
    return keys;
}

export function isDatasetTracking(): boolean {
    return datasetTrackingContext !== null;
}

export function trackDatasetPath(workspace: string, path: TreePath): void {
    if (datasetTrackingContext) {
        const key = datasetCacheKey(workspace, path);
        datasetTrackingContext.add(key);
    }
}

// =============================================================================
// Pending Writes Queue
// =============================================================================

const pendingWrites: Array<() => Promise<void>> = [];
let isProcessingWrites = false;

function queueWrite(writeFn: () => Promise<void>): void {
    pendingWrites.push(writeFn);
    processWriteQueue();
}

async function processWriteQueue(): Promise<void> {
    if (isProcessingWrites) return;
    isProcessingWrites = true;
    while (pendingWrites.length > 0) {
        const writeFn = pendingWrites.shift()!;
        try {
            await writeFn();
        } catch (error) {
            console.error("Dataset write failed:", error);
        }
    }
    isProcessingWrites = false;
}

// =============================================================================
// Platform Implementation — Data.bind
// =============================================================================

export const ReactiveDatasetPlatform: PlatformFunction[] = [
    Data.bind.implement((type: EastTypeValue) => (path: unknown) => {
        const cache = getReactiveDatasetCache();
        const ws = cache.getConfig().workspace;
        if (!ws) throw new Error("ReactiveDatasetCache workspace not configured");
        const dataPath = path as TreePath;

        return {
            read: () => {
                trackDatasetPath(ws, dataPath);
                const cached = cache.read(ws, dataPath);
                if (!cached) {
                    const key = datasetCacheKey(ws, dataPath);
                    throw new EastError(`Dataset not loaded: ${key}`, {
                        location: [{ filename: 'Data.bind', line: 0n, column: 0n }],
                    });
                }
                return decodeBeast2Value(getWasmSync(), cached, type);
            },
            write: (value: unknown) => {
                const encode = encodeBeast2For(type);
                queueWrite(() => cache.write(ws, dataPath, encode(value)));
                return null;
            },
            has: () => cache.has(ws, dataPath),
        };
    }),
];

// =============================================================================
// Tracker Registration
// =============================================================================

/**
 * Create and register a dataset tracker for a given cache.
 * Returns an unregister function.
 */
export function createDatasetTracker(cache: ReactiveDatasetCacheInterface): () => void {
    const unregisterTracker = registerReactiveTracker({
        id: "d",
        enableTracking: enableDatasetTracking,
        disableTracking: disableDatasetTracking,
        getStore: () => ({
            subscribe: (key: string, cb: () => void) => cache.subscribe(key, cb),
            getKeyVersion: (key: string) => cache.getKeyVersion(key),
        }),
    });

    const unregisterPlatform = registerPlatformImplementation(ReactiveDatasetPlatform);

    return () => {
        unregisterTracker();
        unregisterPlatform();
    };
}

// =============================================================================
// List cache helpers
// =============================================================================

const listCache: Map<string, string[]> = new Map();

export async function preloadReactiveDatasetList(workspace: string, path: TreePath): Promise<string[]> {
    const cache = getReactiveDatasetCache();
    const key = datasetCacheKey(workspace, path);
    const cached = listCache.get(key);
    if (cached) return cached;
    const result = await cache.list(workspace, path);
    listCache.set(key, result);
    return result;
}

export function clearReactiveDatasetListCache(): void {
    listCache.clear();
}
