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
 * immutable once loaded: a dataset that changes content is a new bind, not a
 * mutated window, so there is no invalidation path here.
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
    OptionType,
    decodeBeast2For,
    none,
    some,
    variant,
    type EastTypeValue,
} from "@elaraai/east";
import { type PlatformFunction, EastTypeType } from "@elaraai/east/internal";
import { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import { bindPagedPlatformFn, DataPagedPrimitives } from "@elaraai/e3-ui/internal";
import {
    registerReactiveTracker,
    registerPlatformImplementation,
} from "@elaraai/east-ui-components/platform";
import { datasetGetPage, datasetFindKey, type DatasetPage, type DatasetFindQuery, type DatasetFindResult } from "@elaraai/e3-api-client";
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
}

/**
 * Adapter for the dataset paging endpoint. The default wraps
 * `@elaraai/e3-api-client`'s `datasetGetPage`.
 */
export interface PagedApi {
    /** Fetch one element window of a collection dataset. */
    getPage(workspace: string, path: TreePath, window: PagedWindow): Promise<DatasetPage>;
    /** Locate a key query in a Set/Dict dataset's canonical key order. The
     *  `row` it answers with indexes the SAME row space {@link getPage}'s
     *  element windows serve, which is what makes a hit addressable. */
    findKey(workspace: string, path: TreePath, query: DatasetFindQuery): Promise<DatasetFindResult>;
}

/**
 * Build the default {@link PagedApi} that talks to a real e3 server via
 * `@elaraai/e3-api-client`.
 *
 * @remarks
 * Windows are requested unpinned (no content hash). `useDatasetPage` pins its
 * requests so browser/edge caches can hold pages immutably; a bound paged
 * source has no hash to pin with — it never fetches the whole value or polls
 * status — so it reads the current content instead.
 */
export function createDefaultPagedApi(
    apiUrl: string,
    repo: string,
    getToken: () => string | null,
): PagedApi {
    const opts = (): { token: string | null } => ({ token: getToken() });
    return {
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
                if (!current || current.launchSeq !== mySeq) return; // superseded
                mutate(current);
                this.notify(key);
            };
            if (!api) {
                settle(e => { e.status = "failed"; e.failedAtMs = this.now(); });
                console.error("Data.bindPaged: no PagedApi installed");
                return;
            }
            let page: DatasetPage;
            try {
                page = await api.getPage(workspace, path, { offset, limit });
            } catch (err) {
                const permanent = isPermanentPageError(err);
                settle(e => { e.status = "failed"; e.failedAtMs = this.now(); e.permanent = permanent; });
                console.error(
                    permanent
                        ? `Data.bindPaged: ${datasetPathToString(path)} is not a pageable dataset — ` +
                          `bind a collection (Array / Set / Dict), or use Data.bind for a whole value:`
                        : `Data.bindPaged: fetch failed for ${key}:`,
                    err,
                );
                return;
            }
            let decoded: unknown;
            try {
                decoded = decodeBeast2For(sourceType)(page.data);
            } catch (err) {
                settle(e => { e.status = "failed"; e.failedAtMs = this.now(); });
                console.error(`Data.bindPaged: decode failed for ${key}:`, err);
                return;
            }
            settle(e => { e.status = "loaded"; e.window = decoded; e.total = page.totalElements; });
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
                if (!current || current.launchSeq !== mySeq) return; // superseded
                mutate(current);
                this.notify(key);
            };
            if (!api) {
                settle(e => { e.status = "failed"; e.failedAtMs = this.now(); });
                console.error("Data.bindPaged: no PagedApi installed");
                return;
            }
            try {
                const range = await api.findKey(workspace, path, query);
                settle(e => { e.status = "loaded"; e.range = range; });
            } catch (err) {
                const permanent = isPermanentPageError(err);
                settle(e => { e.status = "failed"; e.failedAtMs = this.now(); e.permanent = permanent; });
                console.error(`Data.bindPaged: key search failed for ${key}:`, err);
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
                        return variant("some", entry.window);
                    }
                    return variant("none", null);
                }),
            DataPagedPrimitives.total.implement((_sourceType: EastTypeValue) =>
                (pathArg: unknown) => {
                    const workspace = this.resolveWorkspace();
                    const key = pagedTotalKey(workspace, pathArg as TreePath);
                    this.track(key);
                    const entry = this.entry(key);
                    return entry.total !== undefined
                        ? variant("some", BigInt(entry.total))
                        : variant("none", null);
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
        const { page, total } = DataPagedPrimitives;

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
