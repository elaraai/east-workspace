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
    decodeBeast2For,
    EastError,
} from "@elaraai/east";
import { type PlatformFunction } from "@elaraai/east/internal";
import { Data, type DataManifest } from "@elaraai/e3-ui";
import {
    registerReactiveTracker,
    registerPlatformImplementation,
} from "@elaraai/east-ui-components";
import type { TreePath } from "@elaraai/e3-types";
import {
    type ReactiveDatasetCacheInterface,
    datasetCacheKey,
    datasetPathToString,
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
                return decodeBeast2For(type)(cached);
            },
            write: (value: unknown) => {
                const encode = encodeBeast2For(type);
                queueWrite(() => cache.write(ws, dataPath, encode(value)));
                return null;
            },
            writeAndStart: (value: unknown) => {
                const encode = encodeBeast2For(type);
                queueWrite(() => cache.writeAndStart(ws, dataPath, encode(value)));
                return null;
            },
            has: () => cache.has(ws, dataPath),
            status: () => {
                trackDatasetPath(ws, dataPath);
                return cache.getStatus(ws, dataPath);
            },
        };
    }),
];

// =============================================================================
// Manifest-Scoped Platform — strict reads/writes per UI subtree
// =============================================================================

/**
 * Build a `Data.bind` platform implementation that validates each call against
 * the given manifest. Any access (read, write, or has) to a path NOT in
 * `manifest.paths` throws an `EastError`.
 *
 * Pass the returned array (combined with `StateImpl`/`OverlayImpl` etc) to
 * `decodeBeast2For`'s `platform` option. Closures inside the decoded value
 * — `onChange` callbacks, etc — close over this scoped impl, so each rendered
 * UI subtree gets its own validation regime even when multiple are mounted.
 */
export function createScopedDataPlatform(manifest: DataManifest): PlatformFunction[] {
    const allowed = new Set(manifest.paths.map(p => datasetPathToString(p)));
    // eslint-disable-next-line no-console
    console.log('[Data.bind/scoped] manifest paths:', Array.from(allowed));

    return [
        Data.bind.implement((type: EastTypeValue) => (path: unknown) => {
            const cache = getReactiveDatasetCache();
            const ws = cache.getConfig().workspace;
            if (!ws) throw new Error("ReactiveDatasetCache workspace not configured");
            const dataPath = path as TreePath;
            const pathStr = datasetPathToString(dataPath);
            // eslint-disable-next-line no-console
            console.log('[Data.bind/scoped.call] requested path:', pathStr, 'raw:', JSON.stringify(path), 'allowed:', Array.from(allowed));

            if (!allowed.has(pathStr)) {
                throw new EastError(
                    `Data.bind: path "${pathStr}" not declared in manifest`,
                    { location: [{ filename: 'Data.bind', line: 0n, column: 0n }] },
                );
            }

            const pathKey = datasetCacheKey(ws, dataPath);
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
                    return decodeBeast2For(type)(cached);
                },
                write: (value: unknown) => {
                    // eslint-disable-next-line no-console
                    console.log('[Data.bind/scoped.write]', pathKey, 'value=', value, 'typeKind=', (type as any)?.type);
                    const encode = encodeBeast2For(type);
                    queueWrite(() => cache.write(ws, dataPath, encode(value)));
                    return null;
                },
                writeAndStart: (value: unknown) => {
                    // eslint-disable-next-line no-console
                    console.log('[Data.bind/scoped.writeAndStart]', pathKey, 'value=', value, 'typeKind=', (type as any)?.type);
                    const encode = encodeBeast2For(type);
                    queueWrite(() => cache.writeAndStart(ws, dataPath, encode(value)));
                    return null;
                },
                has: () => cache.has(ws, dataPath),
                status: () => {
                    trackDatasetPath(ws, dataPath);
                    return cache.getStatus(ws, dataPath);
                },
            };
        }),
    ];
}

// =============================================================================
// Tracker + Platform Registration
//
// Registered at module load (mirrors how State does it in east-ui-components).
// The tracker and platform impl look up the cache singleton on each call, so a
// missing cache surfaces as a clear "ReactiveDatasetCache not initialized"
// runtime error rather than a "platform fn not available" compile-time error.
// =============================================================================

registerReactiveTracker({
    id: "d",
    enableTracking: enableDatasetTracking,
    disableTracking: disableDatasetTracking,
    getStore: () => {
        if (!_reactiveDatasetCache) return null;
        const cache = _reactiveDatasetCache;
        return {
            subscribe: (key: string, cb: () => void) => cache.subscribe(key, cb),
            getKeyVersion: (key: string) => cache.getKeyVersion(key),
        };
    },
});

registerPlatformImplementation(ReactiveDatasetPlatform);

/**
 * No-op kept for backward compatibility with `ReactiveDatasetProvider`. Tracker
 * + platform are now registered at module load, so providers only need to set
 * the cache singleton via `initializeReactiveDatasetCache(cache)`.
 */
export function createDatasetTracker(_cache: ReactiveDatasetCacheInterface): () => void {
    return () => { /* no-op */ };
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
