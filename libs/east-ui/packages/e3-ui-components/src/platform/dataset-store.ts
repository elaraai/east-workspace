/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * ReactiveDatasetCache for managing e3 dataset caching and reactivity.
 *
 * @remarks
 * Built on `@tanstack/query-core`: a {@link QueryClient} owns the content
 * bytes (one query per `(workspace, path)`, structured keys, in-flight
 * dedup + cancellation), while a thin subscription shim maintains the
 * string-keyed `subscribe` / `getKeyVersion` contract the platform
 * runtimes (`bind-runtime`, reactive trackers, Diff) consume, with an
 * optional `setScheduler` hook to defer notification flushes out of React
 * render.
 *
 * Server-side change detection is hash-based polling against
 * `workspaceStatus`: only when a dataset's hash moves do we issue a full
 * content fetch. Writes are optimistic and **serialized per key** —
 * concurrent writes to one dataset apply their bytes synchronously
 * (latest wins) but hit the server in order, and a failure only rolls
 * back to the last server-confirmed baseline when no later write has
 * taken ownership of the key. A write also cancels any in-flight content
 * fetch for its key so a stale fetch can never clobber the optimistic
 * bytes, and poll-driven fetch results are discarded when a write
 * supersedes them mid-flight (write-epoch guard).
 *
 * Independent from `@tanstack/react-query`. Other hooks in this package
 * (status / repos) use TanStack's React layer on their own keys; this
 * cache shares only the framework-agnostic core.
 *
 * @packageDocumentation
 */

import { CancelledError, QueryClient } from "@tanstack/query-core";
import { variant } from "@elaraai/east";
import {
    datasetGet,
    datasetSet,
    dataflowExecuteLaunch,
    datasetList as e3DatasetList,
    datasetListAt,
    workspaceStatus,
    ApiError,
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
    /** Fetch a dataset's content. `hash` is the server's content hash
     *  when it exposes one (`null` otherwise) — the cache records it so
     *  the next status poll doesn't refetch content it already has. */
    get(workspace: string, path: TreePath): Promise<{ data: Uint8Array; hash: string | null }>;
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
            return { data: result.data, hash: result.hash ?? null };
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
    /**
     * Launch a workspace dataflow run WITHOUT writing anything first, so
     * downstream tasks recompute against the current dataset state. This is the
     * standalone half of {@link writeAndStart} — use it after an out-of-band
     * mutation (e.g. a record commit) or to drive an explicit "Run" affordance.
     * Fire-and-await: resolves once the server accepts the request, not when
     * the dataflow finishes.
     */
    launchDataflow(workspace: string): Promise<void>;
    /** Preload a dataset into cache */
    preload(workspace: string, path: TreePath): Promise<void>;
    /** List fields at a path */
    list(workspace: string, path: TreePath): Promise<string[]>;
    /** Set polling interval for a dataset */
    setRefetchInterval(workspace: string, path: TreePath, intervalMs: number): void;
    /**
     * Stop polling a dataset previously registered with
     * {@link setRefetchInterval}. The workspace's shared poller stops
     * entirely once its last path is cleared — without this, a long-lived
     * session accumulates watched paths (and network traffic) forever.
     */
    clearRefetchInterval(workspace: string, path: TreePath): void;
    /**
     * Force one immediate workspace-status poll, reconciling every watched
     * path's content against the server (hash-gated; only changed datasets
     * refetch). Use after an out-of-band server mutation (e.g. a record
     * mutation commit) so a watched dataset picks up the new bytes without
     * waiting for the standing poll interval. No-op if the workspace has no
     * active poller. Fire-and-forget; resolves when the poll settles.
     */
    refresh(workspace: string): Promise<void>;
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
 *
 * @remarks
 * Dot-joined to match the server's own path encoding (workspaceStatus
 * reports `.a.b` paths) — field names containing `.` are ambiguous at
 * the e3 wire level itself, so the cache doesn't try to out-encode it.
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

/** The last server-confirmed state of a key, captured when its write
 *  pipeline goes idle → busy; failures roll back to this. */
interface WriteBaseline {
    value: Uint8Array | undefined;
    /** `undefined` = hash unknown (entry absent); `null` = known-absent. */
    hash: string | null | undefined;
    status: PlatformDatasetStatus | undefined;
}

/**
 * ReactiveDatasetCache manages dataset caching and reactivity.
 *
 * @remarks
 * Content bytes live in a `@tanstack/query-core` {@link QueryClient}
 * (structured query keys, fetch dedup + cancellation); statuses, content
 * hashes, write pipelines, the workspace-status poll loop, and the
 * string-keyed subscription shim are cache-owned. See the module remarks
 * for the write/poll race rules.
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

    // Content store — one query per (workspace, path). `staleTime` and
    // `gcTime` are Infinity: content only changes when the hash-poll says
    // so (we invalidate explicitly), and the platform closures need
    // synchronous reads of everything ever loaded (no observer-based GC).
    private readonly client: QueryClient;

    // Hash tracking for efficient change detection.
    // Maps cache key -> last known e3 content hash (`null` = known-absent).
    private knownHashes: Map<string, string | null> = new Map();

    // Per-key platform status (unset | stale | up-to-date). Defaults to
    // unset until either a poll returns a server status or a local write
    // optimistically marks it stale.
    private statuses: Map<string, PlatformDatasetStatus> = new Map();

    // Write pipeline (per key): writes apply optimistically + synchronously
    // (latest wins) but reach the server serialized, and only the newest
    // failed write rolls back — to the last server-confirmed baseline.
    // The epoch also discards poll-driven fetch results that a write
    // superseded mid-flight.
    private writeEpochs: Map<string, number> = new Map();
    private writeChains: Map<string, Promise<void>> = new Map();
    private writeBaselines: Map<string, WriteBaseline> = new Map();
    private pendingWriteCounts: Map<string, number> = new Map();

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

    // Scheduler for deferred notifications
    private scheduler: ((notify: () => void) => void) | undefined;
    private flushScheduled = false;

    constructor(config: ReactiveDatasetCacheConfig, api: DatasetApi, clock: Clock = realClock) {
        this.config = { workspace: config.workspace };
        this.api = api;
        this.clock = clock;
        this.client = new QueryClient({
            defaultOptions: {
                queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
            },
        });
        this.client.mount();
    }

    /** Structured query key for a dataset's content. */
    private contentKey(workspace: string, path: TreePath): readonly unknown[] {
        return ["dataset", workspace, ...path.map(p => p.value)];
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
        return this.client.getQueryData<Uint8Array>(this.contentKey(workspace, path));
    }

    /**
     * Check if a dataset is cached.
     */
    has(workspace: string, path: TreePath): boolean {
        return this.read(workspace, path) !== undefined;
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
     *
     * @remarks
     * Optimistic and synchronous: the bytes are readable via {@link read}
     * before this method's first await. Concurrent writes to the same key
     * are serialized server-side (issue order preserved); on failure, only
     * the newest write rolls the key back — to the last server-confirmed
     * baseline, not to a possibly-superseded optimistic intermediate.
     */
    write(workspace: string, path: TreePath, value: Uint8Array): Promise<void> {
        if (this.destroyed) return Promise.resolve();
        const key = datasetCacheKey(workspace, path);
        const queryKey = this.contentKey(workspace, path);

        // Abort any in-flight content fetch for this key NOW — a stale
        // fetch result must never apply over the optimistic bytes. (The
        // returned promise only awaits teardown; the abort is immediate.)
        void this.client.cancelQueries({ queryKey, exact: true });

        // Baseline = last server-confirmed state, captured when this key's
        // write pipeline goes idle → busy.
        const pendingCount = this.pendingWriteCounts.get(key) ?? 0;
        if (pendingCount === 0) {
            this.writeBaselines.set(key, {
                value: this.client.getQueryData<Uint8Array>(queryKey),
                hash: this.knownHashes.has(key) ? this.knownHashes.get(key) : undefined,
                status: this.statuses.get(key),
            });
        }
        this.pendingWriteCounts.set(key, pendingCount + 1);
        const myEpoch = (this.writeEpochs.get(key) ?? 0) + 1;
        this.writeEpochs.set(key, myEpoch);

        // Optimistic update — bytes go into the cache synchronously,
        // status flips to `stale` until the server confirms.
        this.client.setQueryData(queryKey, value);
        this.knownHashes.delete(key);
        this.statuses.set(key, variant('stale', null));
        this.notifyChange(key);

        // Server set, serialized after any earlier writes to this key.
        const prevTail = this.writeChains.get(key) ?? Promise.resolve();
        const run = prevTail.then(async () => {
            try {
                await this.api.set(workspace, path, value);
                if (this.destroyed) return;

                // Confirmed — this value is the new rollback baseline for
                // any still-pending later writes.
                this.writeBaselines.set(key, {
                    value,
                    hash: undefined,
                    status: variant('stale', null),
                });

                // Trigger a poll to refresh the hash + authoritative status.
                if (this.workspacePollers.has(workspace)) {
                    void this.pollWorkspaceStatus(workspace);
                }
            } catch (error) {
                // Roll back only if no later write owns the key's state.
                if (!this.destroyed && this.writeEpochs.get(key) === myEpoch) {
                    const baseline = this.writeBaselines.get(key);
                    if (baseline?.value !== undefined) {
                        this.client.setQueryData(queryKey, baseline.value);
                    } else {
                        this.client.removeQueries({ queryKey, exact: true });
                    }
                    if (baseline?.hash !== undefined) {
                        this.knownHashes.set(key, baseline.hash);
                    } else {
                        this.knownHashes.delete(key);
                    }
                    if (baseline?.status !== undefined) {
                        this.statuses.set(key, baseline.status);
                    } else {
                        this.statuses.delete(key);
                    }
                    this.notifyChange(key);
                }
                throw error;
            } finally {
                const remaining = (this.pendingWriteCounts.get(key) ?? 1) - 1;
                if (remaining <= 0) {
                    this.pendingWriteCounts.delete(key);
                    this.writeBaselines.delete(key);
                } else {
                    this.pendingWriteCounts.set(key, remaining);
                }
            }
        });
        // The chain tail must never reject (later writes chain onto it).
        this.writeChains.set(key, run.then(() => undefined, () => undefined));
        return run;
    }

    /**
     * Write a dataset value AND launch a workspace dataflow run so downstream
     * tasks pick up the change. The launch is fire-and-await: it returns once
     * the server has accepted the request (not when the dataflow finishes).
     * Polling continues to surface live status as tasks complete.
     */
    async writeAndStart(workspace: string, path: TreePath, value: Uint8Array): Promise<void> {
        await this.write(workspace, path, value);
        if (this.destroyed) return;
        await this.api.launchDataflow(workspace);
    }

    /**
     * Launch a workspace dataflow run without writing first. The standalone
     * half of {@link writeAndStart}; see the interface doc for semantics.
     */
    async launchDataflow(workspace: string): Promise<void> {
        if (this.destroyed) return;
        await this.api.launchDataflow(workspace);
    }

    /**
     * Preload a dataset into cache. Concurrent preloads of the same key
     * share one fetch (query-core dedup); a write racing the fetch cancels
     * it, so a preload can never clobber optimistic bytes.
     */
    async preload(workspace: string, path: TreePath): Promise<void> {
        if (this.destroyed) return;
        const key = datasetCacheKey(workspace, path);
        const queryKey = this.contentKey(workspace, path);

        // Already cached (including optimistically) — nothing to do.
        if (this.client.getQueryData(queryKey) !== undefined) return;

        let fetchedHash: string | null = null;
        try {
            await this.client.fetchQuery({
                queryKey,
                queryFn: async () => {
                    const result = await this.api.get(workspace, path);
                    fetchedHash = result.hash;
                    return result.data;
                },
            });
        } catch (error) {
            // A write cancelled the fetch — its optimistic bytes win.
            if (isCancelledError(error)) return;
            // An unassigned dataset is the `unset` status, not a failure: leave it
            // uncached so getStatus()→unset and has()→false, and the surface renders
            // its own loading/empty branch (Data.bind(...).status()/.has()) instead of
            // the whole tree crashing. A later status poll flips it once the producing
            // task computes it. (Matches BoundValue's {unset, stale, up-to-date}.)
            if (isDatasetUnassignedError(error)) {
                this.statuses.set(key, variant("unset", null));
                this.notifyChange(key);
                return;
            }
            throw error;
        }
        if (this.destroyed) {
            this.client.removeQueries({ queryKey, exact: true });
            return;
        }
        // Record the content hash so the next status poll doesn't refetch
        // bytes we already hold.
        this.knownHashes.set(key, fetchedHash);
        this.notifyChange(key);
    }

    /**
     * List fields at a path. Empty path lists workspace root.
     */
    list(workspace: string, path: TreePath): Promise<string[]> {
        return path.length === 0
            ? this.api.listRoot(workspace)
            : this.api.listAt(workspace, path);
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
     * Pair with {@link clearRefetchInterval} on unmount so the poller can
     * stop when nothing is watching.
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
     * Stop polling a dataset; the workspace poller is torn down when its
     * last watched path is cleared.
     */
    clearRefetchInterval(workspace: string, path: TreePath): void {
        const poller = this.workspacePollers.get(workspace);
        if (!poller) return;
        poller.paths.delete(datasetPathToString(path));
        if (poller.paths.size === 0) {
            poller.handle?.clear();
            this.workspacePollers.delete(workspace);
        }
    }

    refresh(workspace: string): Promise<void> {
        // One immediate hash-gated poll, reusing the standing workspace poller
        // the same way write() nudges after a confirmed set. No-op when nothing
        // watches the workspace; pollWorkspaceStatus dedupes an in-flight poll.
        if (this.destroyed) return Promise.resolve();
        if (!this.workspacePollers.has(workspace)) return Promise.resolve();
        return this.pollWorkspaceStatus(workspace);
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

        // Capture each watched key's write epoch BEFORE the status fetch:
        // any write that lands after this point owns its key's state, and
        // this poll's (potentially pre-write) content must not apply.
        const epochsAtStart = new Map<string, number>();
        for (const pathStr of poller.paths) {
            const key = pathStr ? `${workspace}.${pathStr}` : workspace;
            epochsAtStart.set(key, this.writeEpochs.get(key) ?? 0);
        }

        let status;
        try {
            status = await this.api.workspaceStatus(workspace);
        } catch (error) {
            console.error(`Failed to poll workspace status for ${workspace}:`, error);
            return;
        }
        if (this.destroyed) return;

        // Index once — the path loop below must not rescan the dataset
        // list per watched path.
        const infoByPath = new Map<string, DatasetStatusInfo>();
        for (const info of status.datasets) infoByPath.set(info.path, info);

        // First pass — apply status updates synchronously, collect paths
        // that need a content fetch. Doing these in two passes lets us
        // batch the hash/status notifications under one `flush()` and
        // run the fetches in parallel.
        type PendingFetch =
            | { kind: "fetch"; key: string; path: TreePath; pathStr: string; newHash: string }
            | { kind: "clear"; key: string; path: TreePath };
        const pending: PendingFetch[] = [];

        this.batch(() => {
            for (const pathStr of poller.paths) {
                const e3Path = pathStr ? `.${pathStr}` : "";
                const info = infoByPath.get(e3Path);
                const key = pathStr ? `${workspace}.${pathStr}` : workspace;
                const path = this.stringToPath(pathStr);
                const currentHash = info?.hash?.type === "some" ? info.hash.value : null;
                const knownHash = this.knownHashes.get(key);

                if (info?.status) {
                    const previous = this.statuses.get(key);
                    this.statuses.set(key, info.status);
                    if (!previous || previous.type !== info.status.type) {
                        this.notifyChange(key);
                    }
                }

                // Skip content reconciliation for keys with writes in
                // flight — the write pipeline owns them.
                if ((this.writeEpochs.get(key) ?? 0) !== epochsAtStart.get(key)
                    || (this.pendingWriteCounts.get(key) ?? 0) > 0) {
                    continue;
                }

                if (currentHash !== knownHash || !this.has(workspace, path)) {
                    if (currentHash !== null) {
                        pending.push({ kind: "fetch", key, pathStr, path, newHash: currentHash });
                    } else if (this.has(workspace, path)) {
                        pending.push({ kind: "clear", key, path });
                    }
                }
            }
        });

        if (pending.length === 0) return;

        // Run all fetches in parallel; per-path errors are isolated. The
        // results apply under the write-epoch guard: a key written while
        // the fetch was in flight keeps its optimistic bytes.
        const fetched = await Promise.allSettled(
            pending.map(p => p.kind === "fetch"
                ? this.api.get(workspace, p.path).then(result => ({ p, result }))
                : Promise.resolve({ p, result: null as { data: Uint8Array; hash: string | null } | null }),
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
                if ((this.writeEpochs.get(p.key) ?? 0) !== epochsAtStart.get(p.key)) {
                    continue; // superseded by a write mid-flight
                }
                const queryKey = this.contentKey(workspace, p.path);
                if (p.kind === "fetch") {
                    this.client.setQueryData(queryKey, result.value.result!.data);
                    this.knownHashes.set(p.key, result.value.result!.hash ?? p.newHash);
                    this.notifyChange(p.key);
                } else {
                    this.client.removeQueries({ queryKey, exact: true });
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
                subs.delete(callback);
                // Only drop the key's registration if it still points at
                // OUR set — a stale disposer called twice must not tear
                // down a newer subscriber set under the same key.
                if (subs.size === 0 && this.keySubscribers.get(key) === subs) {
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
     * Cleanup resources. After `destroy()` returns, in-flight fetches,
     * polls, and writes that are still mid-await won't write to the cache —
     * `this.destroyed` short-circuits their post-await branches, and the
     * query client's in-flight fetches are torn down with it.
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
        this.knownHashes.clear();
        this.statuses.clear();
        this.keyVersions.clear();
        this.changedKeys.clear();
        this.writeEpochs.clear();
        this.writeChains.clear();
        this.writeBaselines.clear();
        this.pendingWriteCounts.clear();
        this.client.clear();
        this.client.unmount();
    }
}

/** True when `error` is query-core's cancellation rejection (a racing
 *  write aborted the fetch). */
function isCancelledError(error: unknown): boolean {
    return error instanceof CancelledError;
}

/** True when `error` is the server's `dataset_unassigned` response — a dataset
 *  with no value yet (a pending task output, or a UI-only input that no task
 *  computes). This is the `unset` status, NOT a failure: callers treat it as
 *  "no value" so a surface renders its own loading/empty state rather than
 *  crashing the whole tree. */
function isDatasetUnassignedError(error: unknown): boolean {
    return error instanceof ApiError && error.code === "dataset_unassigned";
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
