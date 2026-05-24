/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * ReactiveDatasetCache for managing e3 dataset caching and reactivity.
 *
 * @remarks
 * Hand-rolled cache + subscription layer over `@elaraai/e3-api-client`.
 * The cache is a `Map<string, Uint8Array>` keyed by `(workspace, path)`;
 * change notifications go to per-key subscribers and a single global
 * subscriber set, with an optional `setScheduler` hook to defer flush
 * out of React render. Hash-based polling against `workspaceStatus`
 * detects server-side changes; only when a hash changes do we issue a
 * full content fetch.
 *
 * Independent from `@tanstack/react-query`. Other hooks in this package
 * (status / repos) use TanStack on their own keys; this cache does not.
 *
 * @packageDocumentation
 */

import { variant } from "@elaraai/east";
import {
    datasetGet,
    datasetSet,
    dataflowExecuteLaunch,
    datasetList as e3DatasetList,
    datasetListAt,
    workspaceStatus,
    type DatasetStatusInfo,
} from "@elaraai/e3-api-client";
import type { TreePath, DatasetStatus as PlatformDatasetStatus } from "@elaraai/e3-types";

/**
 * Timer abstraction the cache uses for periodic polling. Exists so
 * tests can drive the poll loop deterministically with a fake clock
 * instead of `setInterval` real-time.
 */
export interface Clock {
    /** Schedule `fn` to run every `ms` milliseconds. Returns a handle
     *  whose `clear()` cancels future invocations. */
    setInterval(fn: () => void, ms: number): { clear(): void };
}

/** Default {@link Clock} backed by `globalThis.setInterval`. */
export const realClock: Clock = {
    setInterval(fn, ms) {
        const id = setInterval(fn, ms);
        return { clear: () => clearInterval(id) };
    },
};

/**
 * Adapter the cache uses for every server round-trip. Exists so tests
 * (and any non-e3 host) can inject a synthetic implementation; the
 * default wraps the `@elaraai/e3-api-client` module-level functions.
 *
 * The cache passes its own `apiUrl` / `repo` / `token` config to the
 * adapter only via the {@link createDefaultDatasetApi} factory — the
 * adapter itself doesn't see those values, so tests don't need to
 * scaffold dummy URLs.
 */
export interface DatasetApi {
    get(workspace: string, path: TreePath): Promise<Uint8Array>;
    set(workspace: string, path: TreePath, value: Uint8Array): Promise<void>;
    launchDataflow(workspace: string): Promise<void>;
    listRoot(workspace: string): Promise<string[]>;
    listAt(workspace: string, path: TreePath): Promise<string[]>;
    workspaceStatus(workspace: string): Promise<{ datasets: DatasetStatusInfo[] }>;
}

/**
 * Build the default {@link DatasetApi} that talks to a real e3 server
 * via `@elaraai/e3-api-client`. Tests typically construct a
 * hand-rolled adapter instead.
 */
export function createDefaultDatasetApi(
    apiUrl: string,
    repo: string,
    getToken: () => string | null,
): DatasetApi {
    const opts = (): { token: string | null } => ({ token: getToken() });
    return {
        async get(workspace, path) {
            const result = await datasetGet(apiUrl, repo, workspace, path, opts());
            return result.data;
        },
        async set(workspace, path, value) {
            await datasetSet(apiUrl, repo, workspace, path, value, opts());
        },
        async launchDataflow(workspace) {
            await dataflowExecuteLaunch(apiUrl, repo, workspace, {}, opts());
        },
        async listRoot(workspace) {
            return e3DatasetList(apiUrl, repo, workspace, opts());
        },
        async listAt(workspace, path) {
            return datasetListAt(apiUrl, repo, workspace, path, opts());
        },
        async workspaceStatus(workspace) {
            return workspaceStatus(apiUrl, repo, workspace, opts());
        },
    };
}

/**
 * Configuration for the {@link ReactiveDatasetCache}.
 *
 * Strictly cache-internal — credentials and server identity (apiUrl,
 * repo, token) live in the {@link E3Config} context exposed by
 * `<E3Provider>`. The cache talks to the server only via the injected
 * {@link DatasetApi} adapter, so it has no opinion on transport.
 *
 * @property workspace - The workspace this cache instance renders
 *  against. Used by `Data.bind` to scope cache keys; consumed by
 *  bind-runtime + the Diff renderer via `getConfig().workspace`.
 */
export interface ReactiveDatasetCacheConfig {
    workspace?: string;
}

/**
 * Interface for the ReactiveDatasetCache.
 */
export interface ReactiveDatasetCacheInterface {
    /** Read a cached dataset value synchronously */
    read(workspace: string, path: TreePath): Uint8Array | undefined;
    /** Check if a dataset is cached */
    has(workspace: string, path: TreePath): boolean;
    /**
     * Get the platform status of a dataset — `unset` | `stale` | `up-to-date`.
     * Returns `unset` if we don't know yet (status hasn't been polled).
     * `write()` flips the local entry to `stale` immediately (optimistic).
     * The next poll updates from the server's authoritative status.
     */
    getStatus(workspace: string, path: TreePath): PlatformDatasetStatus;
    /** Write a dataset value (async - mutates remotely) */
    write(workspace: string, path: TreePath, value: Uint8Array): Promise<void>;
    /**
     * Write a dataset value AND launch a dataflow execution to propagate the
     * change to downstream tasks. Use when a single user action both mutates
     * input data and should trigger downstream recomputation (e.g. a Slider's
     * `onChangeEnd`). Use plain `write` for high-frequency optimistic updates
     * that you don't want to drive the dataflow on every tick.
     */
    writeAndStart(workspace: string, path: TreePath, value: Uint8Array): Promise<void>;
    /** Preload a dataset into cache */
    preload(workspace: string, path: TreePath): Promise<void>;
    /** List fields at a path */
    list(workspace: string, path: TreePath): Promise<string[]>;
    /** Set polling interval for a dataset */
    setRefetchInterval(workspace: string, path: TreePath, intervalMs: number): void;
    /** Subscribe to changes on a specific key */
    subscribe(key: string, callback: () => void): () => void;
    /** Subscribe to all changes */
    subscribe(callback: () => void): () => void;
    /** Get global snapshot version */
    getSnapshot(): number;
    /** Get version for a specific key */
    getKeyVersion(key: string): number;
    /** Set notification scheduler */
    setScheduler(scheduler: ((notify: () => void) => void) | undefined): void;
    /** Batch multiple operations */
    batch<T>(fn: () => T): T;
    /** Get the configuration */
    getConfig(): ReactiveDatasetCacheConfig;
    /** Clean up resources */
    destroy(): void;
}

/**
 * Convert a dataset path to a string key for caching.
 */
export function datasetPathToString(path: TreePath): string {
    return path.map(p => p.value).join(".");
}

/**
 * Create a cache key from workspace and path.
 */
export function datasetCacheKey(workspace: string, path: TreePath): string {
    const pathStr = datasetPathToString(path);
    return pathStr ? `${workspace}.${pathStr}` : workspace;
}

/**
 * Convert our TreePath to e3-api-client TreePath.
 */
function toTreePath(path: TreePath): TreePath {
    return path as TreePath;
}

/**
 * ReactiveDatasetCache manages dataset caching and reactivity.
 *
 * @remarks
 * Combines TanStack Query for network operations with a local
 * subscription system for reactive updates. Uses e3-api-client
 * for all e3 API interactions.
 *
 * This differs from raw `@elaraai/e3-api-client` dataset functions which
 * are for direct API calls without reactive binding or caching.
 */
export class ReactiveDatasetCache implements ReactiveDatasetCacheInterface {
    private destroyed = false;
    private api: DatasetApi;
    private config: {
        workspace: string | undefined;
    };

    // Local cache for synchronous access
    private cache: Map<string, Uint8Array> = new Map();

    // Hash tracking for efficient change detection
    // Maps cache key -> last known e3 content hash
    private knownHashes: Map<string, string | null> = new Map();

    // Per-key platform status (unset | stale | up-to-date). Defaults to
    // unset until either a poll returns a server status or a local write
    // optimistically marks it stale.
    private statuses: Map<string, PlatformDatasetStatus> = new Map();

    // Subscription management
    private keySubscribers: Map<string, Set<() => void>> = new Map();
    private globalSubscribers: Set<() => void> = new Set();

    // Version tracking for useSyncExternalStore
    private version: number = 0;
    private keyVersions: Map<string, number> = new Map();

    // Workspace status polling — groups subscriptions by workspace for
    // efficiency. Each entry holds the active interval handle from the
    // injected {@link Clock} so tests can drive ticking deterministically.
    private workspacePollers: Map<string, {
        intervalMs: number;
        paths: Set<string>;
        handle: { clear(): void } | null;
    }> = new Map();
    private readonly clock: Clock;

    // In-flight poll dedup — concurrent callers (interval tick + a
    // post-write trigger) share a single round-trip rather than racing.
    private inFlightPolls: Map<string, Promise<void>> = new Map();

    // Batching
    private batchDepth: number = 0;
    private changedKeys: Set<string> = new Set();

    // Pending fetches for deduplication
    private pendingFetches: Map<string, Promise<Uint8Array>> = new Map();

    // Scheduler for deferred notifications
    private scheduler: ((notify: () => void) => void) | undefined;
    private flushScheduled = false;

    constructor(config: ReactiveDatasetCacheConfig, api: DatasetApi, clock: Clock = realClock) {
        this.config = { workspace: config.workspace };
        this.api = api;
        this.clock = clock;
    }

    /**
     * Read the cache's own configuration. Server identity (apiUrl,
     * repo, token) is NOT here — read it from `<E3Provider>` via
     * `useE3Config()` instead.
     */
    getConfig(): ReactiveDatasetCacheConfig {
        return this.config.workspace !== undefined
            ? { workspace: this.config.workspace }
            : {};
    }

    /**
     * Read a dataset value synchronously from cache.
     */
    read(workspace: string, path: TreePath): Uint8Array | undefined {
        const key = datasetCacheKey(workspace, path);
        return this.cache.get(key);
    }

    /**
     * Check if a dataset is cached.
     */
    has(workspace: string, path: TreePath): boolean {
        const key = datasetCacheKey(workspace, path);
        return this.cache.has(key);
    }

    /**
     * Get the platform status of a dataset. Defaults to `unset` until the
     * first poll returns a server status.
     */
    getStatus(workspace: string, path: TreePath): PlatformDatasetStatus {
        const key = datasetCacheKey(workspace, path);
        return this.statuses.get(key) ?? variant('unset', null);
    }

    /**
     * Write a dataset value (async - mutates remotely).
     */
    async write(workspace: string, path: TreePath, value: Uint8Array): Promise<void> {
        if (this.destroyed) return;
        const key = datasetCacheKey(workspace, path);

        // Optimistic update — bytes go into the cache synchronously,
        // status flips to `stale` until the server confirms. On any
        // failure we restore everything atomically.
        const previous = this.cache.get(key);
        const previousHash = this.knownHashes.get(key);
        const previousStatus = this.statuses.get(key);
        this.cache.set(key, value);
        this.knownHashes.delete(key);
        this.statuses.set(key, variant('stale', null));
        this.notifyChange(key);

        try {
            await this.api.set(workspace, toTreePath(path), value);

            // Trigger a poll to refresh the hash + authoritative status.
            if (this.workspacePollers.has(workspace)) {
                void this.pollWorkspaceStatus(workspace);
            }
        } catch (error) {
            if (previous !== undefined) {
                this.cache.set(key, previous);
                if (previousHash !== undefined) {
                    this.knownHashes.set(key, previousHash);
                }
            } else {
                this.cache.delete(key);
                this.knownHashes.delete(key);
            }
            if (previousStatus !== undefined) {
                this.statuses.set(key, previousStatus);
            } else {
                this.statuses.delete(key);
            }
            this.notifyChange(key);
            throw error;
        }
    }

    /**
     * Write a dataset value AND launch a workspace dataflow run so downstream
     * tasks pick up the change. The launch is fire-and-await: it returns once
     * the server has accepted the request (not when the dataflow finishes).
     * Polling continues to surface live status as tasks complete.
     */
    async writeAndStart(workspace: string, path: TreePath, value: Uint8Array): Promise<void> {
        await this.write(workspace, path, value);
        await this.api.launchDataflow(workspace);
    }

    /**
     * Preload a dataset into cache.
     */
    async preload(workspace: string, path: TreePath): Promise<void> {
        if (this.destroyed) return;
        const key = datasetCacheKey(workspace, path);

        // Check if already cached
        if (this.cache.has(key)) return;

        // Check if already loading
        const pending = this.pendingFetches.get(key);
        if (pending) {
            await pending;
            return;
        }

        // Start fetch
        const fetchPromise = this.fetchDataset(workspace, path);
        this.pendingFetches.set(key, fetchPromise);

        try {
            const data = await fetchPromise;
            // Bail if we destroyed during the await — otherwise we'd
            // repopulate the cleared map and notify subscribers that
            // were torn down on unmount.
            if (this.destroyed) return;
            // Only update if not already set (another fetch might have completed)
            if (!this.cache.has(key)) {
                this.cache.set(key, data);
                this.notifyChange(key);
            }
        } finally {
            this.pendingFetches.delete(key);
        }
    }

    private fetchDataset(workspace: string, path: TreePath): Promise<Uint8Array> {
        return this.api.get(workspace, toTreePath(path));
    }

    /**
     * List fields at a path. Empty path lists workspace root.
     */
    list(workspace: string, path: TreePath): Promise<string[]> {
        return path.length === 0
            ? this.api.listRoot(workspace)
            : this.api.listAt(workspace, toTreePath(path));
    }

    /**
     * Set refetch interval for a dataset (polling).
     *
     * @remarks
     * Uses hash-based change detection for efficiency:
     * 1. Polls workspaceStatus to get dataset hashes (lightweight)
     * 2. Compares hashes to detect changes
     * 3. Only fetches full content when hash changes
     *
     * Multiple subscriptions to the same workspace share a single poller.
     */
    setRefetchInterval(workspace: string, path: TreePath, intervalMs: number): void {
        const pathStr = datasetPathToString(path);
        let poller = this.workspacePollers.get(workspace);

        if (poller) {
            poller.paths.add(pathStr);
            // If the new interval is shorter, restart with shorter interval.
            if (intervalMs < poller.intervalMs) {
                poller.handle?.clear();
                poller.intervalMs = intervalMs;
                poller.handle = this.clock.setInterval(
                    () => this.pollWorkspaceStatus(workspace),
                    intervalMs,
                );
            }
        } else {
            poller = {
                intervalMs,
                paths: new Set([pathStr]),
                handle: this.clock.setInterval(
                    () => this.pollWorkspaceStatus(workspace),
                    intervalMs,
                ),
            };
            this.workspacePollers.set(workspace, poller);
            // Do an immediate poll. Promise is intentionally floated —
            // the dedup map handles concurrency, errors are logged.
            void this.pollWorkspaceStatus(workspace);
        }
    }

    /**
     * Poll workspace status and reconcile the cache with the server.
     * Concurrent calls for the same workspace dedupe to a single fetch.
     */
    private pollWorkspaceStatus(workspace: string): Promise<void> {
        const existing = this.inFlightPolls.get(workspace);
        if (existing) return existing;
        const promise = this.doPollWorkspaceStatus(workspace).finally(() => {
            this.inFlightPolls.delete(workspace);
        });
        this.inFlightPolls.set(workspace, promise);
        return promise;
    }

    private async doPollWorkspaceStatus(workspace: string): Promise<void> {
        if (this.destroyed) return;
        const poller = this.workspacePollers.get(workspace);
        if (!poller || poller.paths.size === 0) return;

        let status;
        try {
            status = await this.api.workspaceStatus(workspace);
        } catch (error) {
            console.error(`Failed to poll workspace status for ${workspace}:`, error);
            return;
        }
        if (this.destroyed) return;

        // First pass — apply status updates synchronously, collect paths
        // that need a content fetch. Doing these in two passes lets us
        // batch the hash/status notifications under one `flush()` and
        // run the fetches in parallel.
        type PendingFetch =
            | { kind: "fetch"; key: string; path: TreePath; pathStr: string; newHash: string }
            | { kind: "clear"; key: string };
        const pending: PendingFetch[] = [];

        this.batch(() => {
            for (const pathStr of poller.paths) {
                const e3Path = pathStr ? `.${pathStr}` : "";
                const info = status.datasets.find((d: DatasetStatusInfo) => d.path === e3Path);
                const key = pathStr ? `${workspace}.${pathStr}` : workspace;
                const currentHash = info?.hash?.type === "some" ? info.hash.value : null;
                const knownHash = this.knownHashes.get(key);

                if (info?.status) {
                    const previous = this.statuses.get(key);
                    this.statuses.set(key, info.status);
                    if (!previous || previous.type !== info.status.type) {
                        this.notifyChange(key);
                    }
                }

                if (currentHash !== knownHash || !this.cache.has(key)) {
                    if (currentHash !== null) {
                        pending.push({
                            kind: "fetch",
                            key,
                            pathStr,
                            path: this.stringToPath(pathStr),
                            newHash: currentHash,
                        });
                    } else if (this.cache.has(key)) {
                        pending.push({ kind: "clear", key });
                    }
                }
            }
        });

        if (pending.length === 0) return;

        // Run all fetches in parallel — N paths with hash changes used
        // to cost N serialized round-trips. Errors per path are isolated.
        const fetched = await Promise.allSettled(
            pending.map(p => p.kind === "fetch"
                ? this.fetchDataset(workspace, p.path).then(data => ({ p, data }))
                : Promise.resolve({ p, data: null as Uint8Array | null }),
            ),
        );
        if (this.destroyed) return;

        this.batch(() => {
            for (let i = 0; i < pending.length; i++) {
                const p = pending[i]!;
                const result = fetched[i]!;
                if (result.status === "rejected") {
                    console.error(`Failed to fetch dataset ${p.key}:`, result.reason);
                    continue;
                }
                if (p.kind === "fetch") {
                    this.cache.set(p.key, result.value.data!);
                    this.knownHashes.set(p.key, p.newHash);
                    this.notifyChange(p.key);
                } else {
                    this.cache.delete(p.key);
                    this.knownHashes.set(p.key, null);
                    this.notifyChange(p.key);
                }
            }
        });
    }

    /**
     * Convert a path string back to TreePath.
     */
    private stringToPath(pathStr: string): TreePath {
        if (!pathStr) return [];
        return pathStr.split(".").map(field => variant("field", field));
    }

    // =========================================================================
    // Subscription API (mirrors UIStore for compatibility)
    // =========================================================================

    /**
     * Subscribe to changes on a specific key or all changes.
     */
    subscribe(callback: () => void): () => void;
    subscribe(key: string, callback: () => void): () => void;
    subscribe(keyOrCallback: string | (() => void), maybeCallback?: () => void): () => void {
        if (typeof keyOrCallback === "function") {
            // Global subscription
            this.globalSubscribers.add(keyOrCallback);
            return () => { this.globalSubscribers.delete(keyOrCallback); };
        } else {
            // Key-specific subscription
            const key = keyOrCallback;
            const callback = maybeCallback!;
            let subs = this.keySubscribers.get(key);
            if (!subs) {
                subs = new Set();
                this.keySubscribers.set(key, subs);
            }
            subs.add(callback);
            return () => {
                subs!.delete(callback);
                if (subs!.size === 0) {
                    this.keySubscribers.delete(key);
                }
            };
        }
    }

    /**
     * Get global version for useSyncExternalStore.
     */
    getSnapshot(): number {
        return this.version;
    }

    /**
     * Get version for a specific key.
     */
    getKeyVersion(key: string): number {
        return this.keyVersions.get(key) ?? 0;
    }

    /**
     * Set scheduler for deferred notifications.
     */
    setScheduler(scheduler: ((notify: () => void) => void) | undefined): void {
        this.scheduler = scheduler;
    }

    /**
     * Batch multiple operations.
     */
    batch<T>(fn: () => T): T {
        this.batchDepth++;
        try {
            return fn();
        } finally {
            this.batchDepth--;
            if (this.batchDepth === 0) {
                this.flush();
            }
        }
    }

    /**
     * Notify subscribers of a change.
     */
    private notifyChange(key: string): void {
        // Increment key version
        const currentVersion = this.keyVersions.get(key) ?? 0;
        this.keyVersions.set(key, currentVersion + 1);

        this.changedKeys.add(key);

        if (this.batchDepth === 0) {
            this.flush();
        }
    }

    /**
     * Flush pending notifications.
     */
    private flush(): void {
        if (this.changedKeys.size === 0) return;

        if (this.scheduler) {
            // Defer notifications to avoid "setState during render" errors
            if (!this.flushScheduled) {
                this.flushScheduled = true;
                this.scheduler(() => this.doFlush());
            }
        } else {
            // Synchronous flush (no scheduler provided)
            this.doFlush();
        }
    }

    private doFlush(): void {
        this.flushScheduled = false;
        if (this.changedKeys.size === 0) return;

        // Snapshot + clear BEFORE notifying. Without this, a subscriber
        // that mutates the cache during its callback would add new keys
        // to `changedKeys`, which we'd then `clear()` at the end —
        // silently dropping the new notifications. Snapshot-first lets
        // the recursive flush (or the next batch) handle them.
        const keys = [...this.changedKeys];
        const globals = [...this.globalSubscribers];
        this.changedKeys.clear();

        this.version++;

        for (const key of keys) {
            const subs = this.keySubscribers.get(key);
            if (subs) for (const cb of subs) cb();
        }
        for (const cb of globals) cb();
    }

    /**
     * Cleanup resources. After `destroy()` returns, in-flight fetches
     * and polls that are still mid-await won't write to the cache —
     * `this.destroyed` short-circuits their post-await branches.
     */
    destroy(): void {
        this.destroyed = true;
        for (const poller of this.workspacePollers.values()) {
            poller.handle?.clear();
        }
        this.workspacePollers.clear();
        this.inFlightPolls.clear();
        this.keySubscribers.clear();
        this.globalSubscribers.clear();
        this.cache.clear();
        this.knownHashes.clear();
        this.statuses.clear();
        this.keyVersions.clear();
        this.changedKeys.clear();
        this.pendingFetches.clear();
    }
}

/**
 * Create a new {@link ReactiveDatasetCache}. The caller is responsible
 * for constructing a {@link DatasetApi} adapter; in a React tree the
 * `<ReactiveDatasetProvider>` builds one from the surrounding
 * `<E3Provider>`. Tests inject a fake `clock` to drive polling
 * deterministically.
 */
export function createReactiveDatasetCache(
    config: ReactiveDatasetCacheConfig,
    api: DatasetApi,
    clock?: Clock,
): ReactiveDatasetCache {
    return new ReactiveDatasetCache(config, api, clock);
}

