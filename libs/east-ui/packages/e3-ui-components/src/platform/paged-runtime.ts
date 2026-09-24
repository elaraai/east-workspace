/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Runtime implementation for the `Data.bindPaged` platform function — reading
 * a collection dataset one WINDOW at a time, for sources too large to hold
 * whole.
 *
 * The read itself is the trigger: `page(offset, limit)` returns the window if
 * it has landed, and otherwise starts the fetch and returns `none`. The caller
 * re-reads on the next reactive frame (the window's channel notifies when it
 * settles), which is why the East-side contract is `Option` rather than a
 * promise — the same shape `Func.bind`'s `read()` has.
 *
 * One tracked channel per window `(workspace, path, offset, limit)`, plus one
 * per source for the element total (any landed window teaches it). Windows are
 * immutable within a content revision. Refresh invalidates windows, totals
 * and key search together, preserving resident demand for the next snapshot.
 *
 * A bound source follows its dataset (#821): the API's `watchRevision`
 * reports each new content hash, and a hash that is not the served revision
 * refreshes the source to it. A pinned read the server refuses because the
 * dataset has moved past the pin (409 `dataset_hash_mismatch`) rediscovers the
 * current revision rather than failing its window.
 *
 * A window whose fetch FAILED is not in flight, so it does not read `none`:
 * the read throws the reason (#811). `none` there made every consumer spin
 * "Loading…" forever over a dataset that was never going to arrive. A later
 * read relaunches a transient failure once the retry gap has passed — which
 * is what a component's Retry is — and a permanent one (an authoring error)
 * keeps throwing its reason without refetching. Key searches follow the same
 * rule.
 *
 * Deliberately NOT routed through {@link ReactiveDatasetCache}: that cache is
 * for whole dataset values (synchronous reads of everything ever loaded, a
 * write pipeline, a status poll). A paged source is precisely the thing you
 * cannot hold whole, so it gets its own narrow API seam — the same shape
 * `FuncRuntime` / `RecordRuntime` use.
 *
 * @packageDocumentation
 */

import {
    East,
    SortedMap,
    compareFor,
    fromEastTypeValue,
    type EastType,
    IntegerType,
    StringType,
    NullType,
    OptionType,
    decodeBeast2For,
    none,
    some,
    type ValueTypeOf,
    type EastTypeValue,
} from "@elaraai/east";
import { type PlatformFunction, EastTypeType } from "@elaraai/east/internal";
import { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import { bindPagedPlatformFn, DataPagedPrimitives } from "@elaraai/e3-ui/internal";
import {
    registerReactiveTracker,
    registerPlatformImplementation,
} from "@elaraai/east-ui-components/platform";
import { datasetGetStatus, datasetGetPage, datasetFindKey, type DatasetPage, type DatasetFindQuery, type DatasetFindResult } from "@elaraai/e3-api-client";
import { TreePathType, type TreePath } from "@elaraai/e3-types";

import { datasetPathToString } from "./dataset-store.js";
import { TrackedChannelStore } from "./tracked-channel.js";

// =============================================================================
// API seam — the narrow surface the runtime talks through. Tests stub it; the
// React provider installs the real one. There is no offline stand-in: paging is
// a SERVER capability (segment fences, exact totals, key search), so a paged
// source resolves only against a live workspace.
// =============================================================================

/** One element window of a paged source. */
export interface PagedWindow {
    /** Global element offset of the window's first element. */
    offset: number;
    /** Maximum elements to return (the server may clamp it). */
    limit: number;
    /** Content snapshot to read; the server must refuse a different snapshot. */
    hash?: string;
}

/**
 * Adapter for the dataset paging endpoint. The default wraps
 * `@elaraai/e3-api-client`'s `datasetGetPage`.
 */
export interface PagedApi {
    /** Resolve current content without fetching the whole dataset. */
    getRevision(workspace: string, path: TreePath): Promise<string>;
    /** Fetch one element window of a collection dataset. */
    getPage(workspace: string, path: TreePath, window: PagedWindow): Promise<DatasetPage>;
    /** Locate a key query in a Set/Dict dataset's canonical key order. The
     *  `row` it answers with indexes the SAME row space {@link getPage}'s
     *  element windows serve, which is what makes a hit addressable. */
    findKey(workspace: string, path: TreePath, query: DatasetFindQuery): Promise<DatasetFindResult>;
    /**
     * Follow the dataset's content (#821): `onRevision` hears its content hash
     * once known and on every change after (`null` while it holds no value).
     * Returns a disposer. Without it, a source moves to another revision only
     * when its `refresh` is called.
     */
    watchRevision?(workspace: string, path: TreePath, onRevision: (hash: string | null) => void): () => void;
}

/**
 * Build the default {@link PagedApi} that talks to a real e3 server via
 * `@elaraai/e3-api-client`.
 *
 * @remarks
 * Resolve the current content hash once, then pin every page and key search
 * to that snapshot. Refresh starts a new generation shared by all consumers.
 */
export function createDefaultPagedApi(
    apiUrl: string,
    repo: string,
    getToken: () => string | null,
): PagedApi {
    const opts = (): { token: string | null } => ({ token: getToken() });
    return {
        async getRevision(workspace, path) {
            const status = await datasetGetStatus(apiUrl, repo, workspace, path, opts());
            if (status.hash.type !== "some") throw new Error("Data.bindPaged: dataset has no content snapshot");
            return status.hash.value;
        },
        async getPage(workspace, path, window) {
            return datasetGetPage(apiUrl, repo, workspace, path, window, opts());
        },
        async findKey(workspace, path, query) {
            return datasetFindKey(apiUrl, repo, workspace, path, query, opts());
        },
    };
}

// =============================================================================
// Runtime
// =============================================================================

/** One tracked channel per window (and one per source, for the total). */
interface SourceSnapshot {
    generation: number;
    revision: string | undefined;
    resolving: boolean;
    error: unknown;
    failedAtMs: number | undefined;
    windows: Map<string, { type: EastTypeValue; offset: number; limit: number }>;
    seeks: Map<string, DatasetFindQuery>;
}

interface PageEntry {
    status: "idle" | "running" | "loaded" | "failed";
    launchSeq: number;
    /** The decoded window — a value of the dataset's own type. */
    window?: unknown;
    /** Total elements in the source, learned from any landed window. */
    total?: number;
    /** Where a key query landed — the answer on a seek channel. */
    range?: DatasetFindResult;
    /** When the last attempt failed, so a retry can be rate-limited. */
    failedAtMs?: number;
    /** The failure is an authoring error, so retrying can never help. */
    permanent?: boolean;
    /** Why the last attempt failed — what a read of the failed entry throws. */
    error?: string;
}

/** One line naming why an attempt failed. */
function failureOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** A failed entry's read: throw its reason — never `none`, which reads as
 *  "still in flight" and spins a consumer's loading state forever (#811). */
function throwFailure(entry: PageEntry, what: string): never {
    throw new Error(entry.error ?? `Data.bindPaged: ${what} could not be read`);
}

/** Minimum gap between retries of a window whose fetch failed. */
const RETRY_AFTER_MS = 2000;

/**
 * Decoded windows retained across ALL paged sources (#567 D6).
 *
 * A decoded window is the heavy object here — a window of wide rows runs to
 * megabytes — and windows are immutable once loaded, so nothing ever evicts
 * them on its own: scrolling a GB-scale dataset end to end would pin every
 * window it passed. Retention is bounded least-recently-READ, and an evicted
 * window drops back to `idle` so the next read simply refetches it (the raw
 * bytes may still be in an HTTP cache, so a return is usually cheap).
 *
 * `<PagedDatasetPreview>` caps its own materialized rows the same way
 * (`MAX_RETAINED_PAGES`); this is the cap for the *bound* path, where the
 * renderer holds no cache of its own and the runtime is the only holder.
 */
const MAX_RETAINED_WINDOWS = 24;

/**
 * Server error codes that no amount of retrying will fix — the bind itself is
 * wrong, not the moment. Everything else (a dataset the dataflow has not
 * produced yet, a hash race, a transport blip) is worth another attempt.
 */
const PERMANENT_PAGE_ERRORS = new Set(["dataset_not_pageable"]);

/** Whether a caught fetch error is an authoring error rather than a hiccup. */
function isPermanentPageError(err: unknown): boolean {
    const code = (err as { code?: unknown } | null)?.code;
    return typeof code === "string" && PERMANENT_PAGE_ERRORS.has(code);
}

/** Whether a pinned read was refused because the dataset moved past the
 *  pinned snapshot (409 `dataset_hash_mismatch`) — the source's news, not
 *  the window's failure (#821). */
function isRevisionMoved(err: unknown): boolean {
    return (err as { code?: unknown } | null)?.code === "dataset_hash_mismatch";
}

/** The Dict key / Set element type of a keyed collection, else null — the
 *  `seek` capability is decided from the dataset's own type at bind time. */
export function keyTypeOf(sourceType: EastTypeValue): EastTypeValue | null {
    if (sourceType.type === "Dict") return (sourceType.value as { key: EastTypeValue }).key;
    if (sourceType.type === "Set") return sourceType.value as EastTypeValue;
    return null;
}

/**
 * The handle's `seek` field: `some(fn)` for a key-ordered source, `none` for an
 * Array (stream order has nothing to binary-search).
 *
 * The capability is decided from the DATASET's own type at bind time, so a
 * component renders the search affordance only where the server can answer it —
 * `datasetFindKey` binary-searches the stored blob's segment fences and decodes
 * at most two segments, which only a Set/Dict blob has.
 *
 * The function is an IR-bearing `East.function` over the `data_page_seek`
 * primitive, capturing only the plain-data path — the same shape `page` /
 * `total` have, so the whole handle stays serializable (issue #106).
 */
function buildSeek(
    sourceType: EastTypeValue,
    T: EastType,
    pathExpr: unknown,
    platform: PlatformFunction[],
): unknown {
    if (keyTypeOf(sourceType) === null) return none;
    const { seek } = DataPagedPrimitives;
    return some(East.compile(
        East.function([SeekQueryType], OptionType(SeekRangeType), ($, query) => {
            $.return(seek([T], pathExpr as never, query));
        }),
        platform,
    ));
}

/** Tracked-channel key for one window. */
export function pagedWindowKey(workspace: string, path: TreePath, offset: number, limit: number): string {
    return `paged:${workspace}:${datasetPathToString(path)}#${offset}+${limit}`;
}

/** Tracked-channel key for a source's element total. */
export function pagedTotalKey(workspace: string, path: TreePath): string {
    return `paged:${workspace}:${datasetPathToString(path)}#total`;
}

/** Tracked-channel key for ONE key query against a source. Every distinct
 *  query gets its own channel: a search result is as immutable as a window. */
export function pagedSeekKey(workspace: string, path: TreePath, query: DatasetFindQuery): string {
    const q = "key" in query
        ? `k=${query.key}`
        : "fields" in query
            ? `f=${query.fields.join("\u0000")}|p=${query.prefix ?? ""}`
            : `p=${query.prefix}`;
    return `paged:${workspace}:${datasetPathToString(path)}#seek:${q}`;
}

/**
 * The decoded East {@link SeekQueryType} value as e3's wire query.
 *
 * The two are deliberately the same three shapes, so this is a re-tagging
 * rather than a translation: `.east` literals stay text, and the East option on
 * the `fields` arm becomes an absent property (`exactOptionalPropertyTypes`).
 */
export function toFindQuery(query: unknown): DatasetFindQuery {
    const q = query as { type: string; value: unknown };
    if (q.type === "key") return { key: q.value as string };
    if (q.type === "prefix") return { prefix: q.value as string };
    const f = q.value as { values: string[]; prefix: { type: string; value: unknown } };
    const fields = [...f.values];
    return f.prefix.type === "some"
        ? { fields, prefix: f.prefix.value as string }
        : { fields };
}

/**
 * Encapsulates all `Data.bindPaged` runtime state. The module-level
 * {@link defaultPagedRuntime} instance backs the registered platform; tests
 * construct their own for isolation.
 */
export class PagedRuntime extends TrackedChannelStore<PageEntry> {
    private api: PagedApi | null = null;
    private workspace: string | null = null;
    private generation = 0;
    private readonly snapshots = new Map<string, SourceSnapshot>();
    /** Per source (its total key): the disposer of its dataset watch (#821). */
    private readonly watches = new Map<string, () => void>();

    // Compiled-handle cache (issue #106 perf): buildHandle compiles 2
    // East.functions per bind, and binds re-run every reactive frame. The
    // method IR is a pure function of (sourceType, sourcePath), and the methods
    // resolve api/workspace LIVE, so a cached handle still re-binds.
    //
    // Keyed by TYPE first, then path — never by path alone. The window decoder
    // is baked from `sourceType`, so a path re-bound at a different type (a
    // redeployed dataset whose schema changed, inside a live session) must not
    // hand back the handle compiled against the old type. Structural key for
    // the same reason `bind-runtime` uses one: every bind builds a fresh
    // `EastTypeValue` from IR, so a by-identity cache would miss every render.
    private readonly handleCache = new SortedMap<EastTypeValue, Map<string, Record<string, unknown>>>(
        undefined,
        compareFor(EastTypeType),
    );

    /** Loaded window keys in least-recently-READ order (a Map preserves
     *  insertion order; a read re-inserts). Bounds the decoded-window cache. */
    private readonly loadedWindows = new Map<string, true>();

    /** Monotonic clock seam so tests can drive the retry gate. */
    protected now(): number {
        return Date.now();
    }

    protected createEntry(): PageEntry {
        return { status: "idle", launchSeq: 0 };
    }

    // ----- wiring ----------------------------------------------------------

    /** Install the API adapter + workspace — called by the React provider
     *  (or a test/showcase harness) before any handle is used. */
    initialize(api: PagedApi, workspace: string): void {
        if (this.workspace !== null && (this.workspace !== workspace || this.api !== api)) this.clear();
        this.api = api;
        this.workspace = workspace;
    }

    /** Tear down the adapter and all window state. */
    clear(): void {
        this.api = null;
        this.workspace = null;
        this.clearChannels();
        this.handleCache.clear();
        this.loadedWindows.clear();
        this.snapshots.clear();
        for (const stop of this.watches.values()) stop();
        this.watches.clear();
        this.generation += 1;
    }

    private resolveWorkspace(): string {
        if (!this.workspace) {
            throw new Error(
                "Data.bindPaged: no paging service — a paged source is served BY THE SERVER " +
                "(datasetGetPage), so it resolves only inside a live workspace. Render this " +
                "component against a deployed workspace, or bind the whole value with Data.bind.",
            );
        }
        return this.workspace;
    }

    private snapshot(workspace: string, path: TreePath): SourceSnapshot {
        const key = pagedTotalKey(workspace, path);
        let snapshot = this.snapshots.get(key);
        if (!snapshot) {
            snapshot = {
                generation: ++this.generation, revision: undefined, resolving: false,
                error: undefined, failedAtMs: undefined, windows: new Map(), seeks: new Map(),
            };
            this.snapshots.set(key, snapshot);
            this.watch(workspace, path, key);
        }
        return snapshot;
    }

    /** Follow the source's dataset: a content hash the watch reports that
     *  is not the served revision moves the source to it (#821). */
    private watch(workspace: string, path: TreePath, key: string): void {
        const api = this.api;
        if (api?.watchRevision === undefined || this.watches.has(key)) return;
        this.watches.set(key, api.watchRevision(workspace, path, (hash) => this.follow(workspace, path, hash)));
    }

    /** The dataset's content is now `hash`. A source still discovering its
     *  revision, or moving to a target, lands on what is current anyway; a
     *  dataset with no value leaves the served snapshot standing. */
    private follow(workspace: string, path: TreePath, hash: string | null): void {
        const snapshot = this.snapshots.get(pagedTotalKey(workspace, path));
        if (snapshot === undefined || hash === null || snapshot.revision === undefined || snapshot.revision === hash) return;
        this.refresh(workspace, path, some(hash));
    }

    private isCurrent(workspace: string, path: TreePath, snapshot: SourceSnapshot): boolean {
        return this.snapshots.get(pagedTotalKey(workspace, path)) === snapshot;
    }

    private demand(workspace: string, path: TreePath, snapshot: SourceSnapshot): void {
        for (const window of snapshot.windows.values()) {
            this.ensureWindow(window.type, workspace, path, window.offset, window.limit);
        }
        for (const [key, query] of snapshot.seeks) this.ensureSeek(workspace, path, query, key);
    }

    private discover(workspace: string, path: TreePath, snapshot: SourceSnapshot): void {
        if (snapshot.revision !== undefined || snapshot.resolving) return;
        if (snapshot.failedAtMs !== undefined && this.now() - snapshot.failedAtMs < RETRY_AFTER_MS) return;
        const api = this.api;
        if (!api) return;
        snapshot.resolving = true;
        void api.getRevision(workspace, path).then(hash => {
            if (!this.isCurrent(workspace, path, snapshot)) return;
            if (!hash) throw new Error("Data.bindPaged: paging service returned no content revision");
            snapshot.revision = hash;
            snapshot.resolving = false;
            snapshot.error = undefined;
            snapshot.failedAtMs = undefined;
            this.demand(workspace, path, snapshot);
            this.notify(pagedTotalKey(workspace, path));
        }).catch((error: unknown) => {
            if (!this.isCurrent(workspace, path, snapshot)) return;
            snapshot.resolving = false;
            snapshot.error = error;
            snapshot.failedAtMs = this.now();
            this.notify(pagedTotalKey(workspace, path));
        });
    }

    /** Invalidate one logical source, retaining its resident window demand. */
    private refresh(workspace: string, path: TreePath, target: ValueTypeOf<OptionType<StringType>>): void {
        const previous = this.snapshot(workspace, path);
        const snapshot: SourceSnapshot = {
            ...previous, generation: ++this.generation, revision: undefined,
            resolving: target.type === "some", error: undefined, failedAtMs: undefined,
            windows: new Map(previous.windows), seeks: new Map(previous.seeks),
        };
        const totalKey = pagedTotalKey(workspace, path);
        this.snapshots.set(totalKey, snapshot);
        const keys = [totalKey, ...snapshot.windows.keys(), ...snapshot.seeks.keys()];
        for (const key of keys) {
            this.entries.delete(key);
            this.loadedWindows.delete(key);
        }
        // Notify the unknown revision first, including when the target hash is
        // unchanged. A refresh invalidates every consumer's read-once cache.
        for (const key of keys) this.notify(key);
        queueMicrotask(() => {
            if (!this.isCurrent(workspace, path, snapshot)) return;
            if (target.type === "some") {
                snapshot.resolving = false;
                if (!target.value) {
                    snapshot.error = new Error("Data.bindPaged: refresh requires a nonempty content revision");
                } else {
                    snapshot.revision = target.value;
                    this.demand(workspace, path, snapshot);
                }
                this.notify(totalKey);
            } else this.discover(workspace, path, snapshot);
        });
    }

    // ----- window loading --------------------------------------------------

    /** Note a window as most-recently-read, and drop the coldest decoded
     *  windows once the cache exceeds its cap. An evicted window returns to
     *  `idle`, so the next read refetches it rather than reading a hole. */
    private touchWindow(key: string): void {
        this.loadedWindows.delete(key);
        this.loadedWindows.set(key, true);
        if (this.loadedWindows.size <= MAX_RETAINED_WINDOWS) return;
        // Evict coldest-first, but SKIP anything the current evaluation has
        // already read. A reader walking a prefix longer than this cache would
        // otherwise evict its own head partway through the pass; the next pass
        // finds window 0 `idle`, gets `none`, stops at the hole, and the canvas
        // renders zero rows — a source over ~4,800 elements blinked empty and
        // reloaded forever (#581).
        //
        // If EVERY loaded window is in the current read set the cache is left
        // over its cap for this pass, which is the right trade: exceeding a
        // memory target beats blanking the surface. The readers additionally
        // bound their own demand so this is not reached in practice.
        for (const candidate of [...this.loadedWindows.keys()]) {
            if (this.loadedWindows.size <= MAX_RETAINED_WINDOWS) break;
            if (this.isTracked(candidate)) continue;
            const entry = this.entries.get(candidate);
            // Never evict a window that is still in flight — its settle would
            // land on an entry the next read has already relaunched.
            if (entry === undefined || entry.status !== "loaded") continue;
            this.loadedWindows.delete(candidate);
            entry.status = "idle";
            delete entry.window;
            for (const snapshot of this.snapshots.values()) snapshot.windows.delete(candidate);
        }
    }

    /**
     * Start the fetch for a window if it isn't loaded or already in flight.
     *
     * Deliberately does NOT notify on launch — the read that triggers it runs
     * inside a render pass, and notifying there would re-enter the renderer.
     * Only the settle notifies.
     */
    private ensureWindow(
        sourceType: EastTypeValue,
        workspace: string,
        path: TreePath,
        offset: number,
        limit: number,
    ): void {
        const key = pagedWindowKey(workspace, path, offset, limit);
        const snapshot = this.snapshot(workspace, path);
        snapshot.windows.set(key, { type: sourceType, offset, limit });
        this.track(pagedTotalKey(workspace, path));
        this.discover(workspace, path, snapshot);
        if (snapshot.error !== undefined) throw snapshot.error;
        const revision = snapshot.revision;
        if (revision === undefined) return;
        const entry = this.entry(key);
        if (entry.status === "running" || entry.status === "loaded") return;
        if (entry.status === "failed") {
            // An authoring error never resolves itself — stay failed rather
            // than re-asking (and re-logging) forever.
            if (entry.permanent) return;
            // Rate-limit retries: a caller that polls a still-missing window
            // (the canvas readers do) must not hammer a failing server.
            const since = this.now() - (entry.failedAtMs ?? 0);
            if (since < RETRY_AFTER_MS) return;
        }

        entry.status = "running";
        entry.launchSeq += 1;
        const mySeq = entry.launchSeq;
        const api = this.api;

        void (async () => {
            const settle = (mutate: (e: PageEntry) => void): void => {
                const current = this.entries.get(key);
                if (current !== entry || current.launchSeq !== mySeq || !this.isCurrent(workspace, path, snapshot) || snapshot.revision !== revision) return; // superseded
                mutate(current);
                this.notify(key);
            };
            if (!api) {
                settle(e => {
                    e.status = "failed"; e.failedAtMs = this.now();
                    e.error = "Data.bindPaged: no PagedApi installed";
                });
                console.error("Data.bindPaged: no PagedApi installed");
                return;
            }
            let page: DatasetPage;
            try {
                page = await api.getPage(workspace, path, { offset, limit, hash: revision });
                if (!this.isCurrent(workspace, path, snapshot)) return;
                if (page.hash !== revision) throw new Error("Data.bindPaged: page does not match the requested content revision");
            } catch (err) {
                if (!this.isCurrent(workspace, path, snapshot)) return;
                // The dataset moved past the pinned snapshot: the source
                // rediscovers and reads again — never this window's failure.
                if (isRevisionMoved(err)) {
                    this.refresh(workspace, path, none);
                    return;
                }
                const permanent = isPermanentPageError(err);
                const reason = permanent
                    ? `Data.bindPaged: ${datasetPathToString(path)} is not a pageable dataset — ` +
                      `bind a collection (Array / Set / Dict), or use Data.bind for a whole value`
                    : `Data.bindPaged: fetch failed for ${datasetPathToString(path)} ` +
                      `elements ${offset}–${offset + limit - 1}: ${failureOf(err)}`;
                settle(e => {
                    e.status = "failed"; e.failedAtMs = this.now(); e.permanent = permanent;
                    e.error = reason;
                });
                console.error(`${reason}:`, err);
                return;
            }
            if (!this.isCurrent(workspace, path, snapshot)) return;
            let decoded: unknown;
            try {
                decoded = decodeBeast2For(sourceType)(page.data);
            } catch (err) {
                const reason = `Data.bindPaged: could not decode ${datasetPathToString(path)} ` +
                    `elements ${offset}–${offset + limit - 1}: ${failureOf(err)}`;
                settle(e => { e.status = "failed"; e.failedAtMs = this.now(); e.error = reason; });
                console.error(`${reason}:`, err);
                return;
            }
            settle(e => { e.status = "loaded"; e.window = decoded; e.total = page.totalElements; });
            if (!this.isCurrent(workspace, path, snapshot)) return;
            this.touchWindow(key);
            // Any landed window teaches the source's total — publish it on the
            // source-level channel so a reader watching `total()` re-fires.
            const totalKey = pagedTotalKey(workspace, path);
            const totalEntry = this.entry(totalKey);
            if (totalEntry.total !== page.totalElements) {
                totalEntry.total = page.totalElements;
                totalEntry.status = "loaded";
                this.notify(totalKey);
            }
        })();
    }

    /**
     * Start the fence search for one key query if it isn't answered or already
     * in flight — the seek sibling of {@link ensureWindow}, with the same
     * launch-does-not-notify rule (the read runs inside a render pass).
     */
    private ensureSeek(
        workspace: string,
        path: TreePath,
        query: DatasetFindQuery,
        key: string,
    ): void {
        const snapshot = this.snapshot(workspace, path);
        snapshot.seeks.set(key, query);
        this.track(pagedTotalKey(workspace, path));
        this.discover(workspace, path, snapshot);
        if (snapshot.error !== undefined) throw snapshot.error;
        const revision = snapshot.revision;
        if (revision === undefined) return;
        const entry = this.entry(key);
        if (entry.status === "running" || entry.status === "loaded") return;
        if (entry.status === "failed") {
            if (entry.permanent) return;
            const since = this.now() - (entry.failedAtMs ?? 0);
            if (since < RETRY_AFTER_MS) return;
        }

        entry.status = "running";
        entry.launchSeq += 1;
        const mySeq = entry.launchSeq;
        const api = this.api;

        void (async () => {
            const settle = (mutate: (e: PageEntry) => void): void => {
                const current = this.entries.get(key);
                if (current !== entry || current.launchSeq !== mySeq || !this.isCurrent(workspace, path, snapshot) || snapshot.revision !== revision) return; // superseded
                mutate(current);
                this.notify(key);
            };
            if (!api) {
                settle(e => {
                    e.status = "failed"; e.failedAtMs = this.now();
                    e.error = "Data.bindPaged: no PagedApi installed";
                });
                console.error("Data.bindPaged: no PagedApi installed");
                return;
            }
            try {
                const range = await api.findKey(workspace, path, { ...query, hash: revision });
                if (!this.isCurrent(workspace, path, snapshot)) return;
                if (range.hash !== revision) throw new Error("Data.bindPaged: key search does not match the requested content revision");
                settle(e => { e.status = "loaded"; e.range = range; });
            } catch (err) {
                if (!this.isCurrent(workspace, path, snapshot)) return;
                if (isRevisionMoved(err)) {
                    this.refresh(workspace, path, none);
                    return;
                }
                const permanent = isPermanentPageError(err);
                const reason = `Data.bindPaged: key search failed for ${datasetPathToString(path)}: ${failureOf(err)}`;
                settle(e => {
                    e.status = "failed"; e.failedAtMs = this.now(); e.permanent = permanent;
                    e.error = reason;
                });
                console.error(`${reason}:`, err);
            }
        })();
    }

    /**
     * The low-level primitives backing handle methods, bound to THIS runtime.
     * Registered globally (extension registry) and included by the scoped
     * platform (e3 `ui()` tasks) so a decoded handle re-binds to whatever
     * runtime resolves the primitives on the decode side.
     */
    buildPrimitives(): PlatformFunction[] {
        return [
            DataPagedPrimitives.revision.implement((_sourceType: EastTypeValue) =>
                (pathArg: unknown) => {
                    const workspace = this.resolveWorkspace();
                    const path = pathArg as TreePath;
                    this.track(pagedTotalKey(workspace, path));
                    const snapshot = this.snapshot(workspace, path);
                    this.discover(workspace, path, snapshot);
                    if (snapshot.error !== undefined) throw snapshot.error;
                    return snapshot.revision === undefined ? none : some(snapshot.revision);
                }),
            DataPagedPrimitives.refresh.implement((_sourceType: EastTypeValue) =>
                (pathArg: unknown, target: unknown) => {
                    this.refresh(this.resolveWorkspace(), pathArg as TreePath, target as ValueTypeOf<OptionType<StringType>>);
                    return null;
                }),
            DataPagedPrimitives.page.implement((sourceType: EastTypeValue) =>
                (pathArg: unknown, offsetArg: unknown, limitArg: unknown) => {
                    const workspace = this.resolveWorkspace();
                    const path = pathArg as TreePath;
                    const offset = Number(offsetArg as bigint);
                    const limit = Number(limitArg as bigint);
                    const key = pagedWindowKey(workspace, path, offset, limit);
                    this.track(key);
                    this.ensureWindow(sourceType, workspace, path, offset, limit);
                    const entry = this.entry(key);
                    if (entry.status === "loaded" && entry.window !== undefined) {
                        this.touchWindow(key);
                        return some(entry.window);
                    }
                    // Failed (and not relaunched by this read): not in flight,
                    // so not `none` — the reason (#811).
                    if (entry.status === "failed") throwFailure(entry, `elements ${offset}–${offset + limit - 1}`);
                    return none;
                }),
            DataPagedPrimitives.total.implement((_sourceType: EastTypeValue) =>
                (pathArg: unknown) => {
                    const workspace = this.resolveWorkspace();
                    const key = pagedTotalKey(workspace, pathArg as TreePath);
                    this.track(key);
                    const entry = this.entry(key);
                    return entry.total !== undefined
                        ? some(BigInt(entry.total))
                        : none;
                }),
            DataPagedPrimitives.seek.implement((_sourceType: EastTypeValue) =>
                (pathArg: unknown, queryArg: unknown) => {
                    const workspace = this.resolveWorkspace();
                    const path = pathArg as TreePath;
                    const query = toFindQuery(queryArg);
                    const key = pagedSeekKey(workspace, path, query);
                    this.track(key);
                    this.ensureSeek(workspace, path, query, key);
                    const entry = this.entry(key);
                    // A failed search throws its reason (#811) — the same rule
                    // `page` follows; `none` would read as still searching.
                    if (entry.status === "failed") throwFailure(entry, "the key search");
                    // `none` is "still searching" — the same in-flight
                    // convention `page` uses, so the chrome shows nothing
                    // rather than a wrong answer while the fences are walked.
                    if (entry.status !== "loaded" || entry.range === undefined) return none;
                    const r = entry.range;
                    return some({ found: r.found, row: BigInt(r.row), count: BigInt(r.count) });
                }),
        ];
    }

    /**
     * Build the handle value for one `Data.bindPaged` evaluation. Both methods
     * are thin IR-bearing `East.function`s over {@link buildPrimitives},
     * capturing only the plain-data source path (the value type rides as a
     * type-arg) — so the handle is ordinary serializable East data (issue #106).
     */
    buildHandle(sourceType: EastTypeValue, path: TreePath): Record<string, unknown> {
        const pathKey = datasetPathToString(path);
        let byPath = this.handleCache.get(sourceType);
        if (byPath) {
            const hit = byPath.get(pathKey);
            if (hit) return hit;
        } else {
            byPath = new Map<string, Record<string, unknown>>();
            this.handleCache.set(sourceType, byPath);
        }

        const T = fromEastTypeValue(sourceType);
        // A single literal `Value` IR node for the captured path (the
        // `Data.bind` convention — manifest derivation reads it back).
        const pathExpr = East.value(path, TreePathType);
        const platform = this.buildPrimitives();
        const { page, total, revision, refresh } = DataPagedPrimitives;

        const handle: Record<string, unknown> = {
            // The comparable identity east-ui's `PagedSourceType` requires:
            // East compares every function as EQUAL, so a struct of nothing but
            // closures is indistinguishable from any other and a memoized
            // component would never re-render on a source swap (#567 D4). The
            // dataset path is the natural identity — same path, same rows.
            id: pathKey,
            page: East.compile(
                East.function([IntegerType, IntegerType], OptionType(T), ($, offset, limit) => {
                    $.return(page([T], pathExpr, offset, limit));
                }),
                platform,
            ),
            total: East.compile(
                East.function([], OptionType(IntegerType), ($) => {
                    $.return(total([T], pathExpr));
                }),
                platform,
            ),
            // Key search is a KEY-ORDER capability: Set/Dict element windows
            // ride the canonical East key order, so a key locates in O(log
            // segments) against the stored fences; an Array's stream order has
            // nothing to search. Resolved at bind time from the dataset's own
            // type, so a component renders the affordance only when it works.
            seek: buildSeek(sourceType, T, pathExpr, platform),
            revision: East.compile(
                East.function([], OptionType(StringType), ($) => $.return(revision([T], pathExpr))), platform,
            ),
            refresh: East.compile(
                East.function([OptionType(StringType)], NullType, ($, target) => $.return(refresh([T], pathExpr, target))), platform,
            ),
        };
        byPath.set(pathKey, handle);
        return handle;
    }

    // ----- platform building -------------------------------------------------

    /** Build a `Data.bindPaged` PlatformFunction bound to this runtime. Pass
     *  `allowed=null` for an unscoped impl; pass a Set of path strings for
     *  manifest scoping. */
    buildPlatform(allowed: ReadonlySet<string> | null): PlatformFunction {
        return bindPagedPlatformFn.implement((sourceType: EastTypeValue) =>
            (pathArg: unknown) => {
                const path = pathArg as TreePath;
                if (allowed) {
                    const pathStr = datasetPathToString(path);
                    if (!allowed.has(pathStr)) {
                        throw new Error(
                            `Data.bindPaged: source path "${pathStr}" not declared in manifest — ` +
                            `bind it in the task body so derivation records it`,
                        );
                    }
                }
                return this.buildHandle(sourceType, path);
            },
        );
    }
}

// =============================================================================
// Default process-global runtime + free-function exports.
// =============================================================================

/** Process-global runtime backing the `PagedPlatform` export. */
export const defaultPagedRuntime = new PagedRuntime();

/** Install the paging API adapter + workspace — called by the React provider
 *  on mount (or by a test/showcase harness). */
export function initializePagedApi(api: PagedApi, workspace: string): void {
    defaultPagedRuntime.initialize(api, workspace);
}

/** Tear down the paging API adapter and all window state. */
export function clearPagedApi(): void {
    defaultPagedRuntime.clear();
}

/** Global, manifest-unscoped `Data.bindPaged` impl + its backing primitives.
 *  Registered on module load (powers the extension registry decode path). */
export const PagedPlatform: PlatformFunction[] = [
    defaultPagedRuntime.buildPlatform(null),
    ...defaultPagedRuntime.buildPrimitives(),
];

/** Build a manifest-scoped `Data.bindPaged` implementation + its backing
 *  primitives, from the manifest's `pages` list.
 *
 *  The `data_page*` primitives MUST ship with the scoped platform: e3 `ui()`
 *  tasks render through `createScoped*()` arrays (UITaskPreview), NOT the
 *  global registry, so a serialized handle's methods would otherwise decode to
 *  "Platform function 'data_page' is not available". */
export function createScopedPagedPlatform(pages: readonly TreePath[]): PlatformFunction[] {
    const allowed = new Set(pages.map(p => datasetPathToString(p)));
    return [
        defaultPagedRuntime.buildPlatform(allowed),
        ...defaultPagedRuntime.buildPrimitives(),
    ];
}

// =============================================================================
// Module-load registrations — wire the default runtime into east-ui hooks.
// Tests with their own `PagedRuntime` don't use these.
// =============================================================================

registerReactiveTracker({
    id: "data-bind-paged",
    enableTracking: () => defaultPagedRuntime.enableTracking(),
    disableTracking: () => defaultPagedRuntime.disableTracking(),
    getStore: () => ({
        subscribe: (key, cb) => defaultPagedRuntime.subscribe(key, cb),
        getKeyVersion: (key) => defaultPagedRuntime.getKeyVersion(key),
    }),
});

registerPlatformImplementation(PagedPlatform);
