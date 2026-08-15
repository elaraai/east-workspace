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
    IntegerType,
    OptionType,
    decodeBeast2For,
    none,
    variant,
    type EastTypeValue,
} from "@elaraai/east";
import { type PlatformFunction, EastTypeType } from "@elaraai/east/internal";
import { bindPagedPlatformFn, DataPagedPrimitives } from "@elaraai/e3-ui/internal";
import {
    registerReactiveTracker,
    registerPlatformImplementation,
} from "@elaraai/east-ui-components/platform";
import { datasetGetPage, type DatasetPage } from "@elaraai/e3-api-client";
import { TreePathType, type TreePath } from "@elaraai/e3-types";

import { datasetPathToString } from "./dataset-store.js";
import { TrackedChannelStore } from "./tracked-channel.js";

// =============================================================================
// API seam — the narrow surface the runtime talks through. Tests stub it;
// the showcase harness swaps in an in-memory implementation.
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
 * The handle's `seek` field: `some(fn)` for a key-ordered source, `none` for
 * an Array (stream order has nothing to binary-search).
 *
 * Wired to the server's fence search in a later step; until then a keyed
 * source still advertises the capability and resolves `none` (in flight),
 * which is the contract's "not yet" and leaves the chrome inert rather than
 * wrong.
 */
function buildSeek(
    _sourceType: EastTypeValue,
    _pathExpr: unknown,
    _platform: PlatformFunction[],
): unknown {
    return none;
}

/** Tracked-channel key for one window. */
export function pagedWindowKey(workspace: string, path: TreePath, offset: number, limit: number): string {
    return `paged:${workspace}:${datasetPathToString(path)}#${offset}+${limit}`;
}

/** Tracked-channel key for a source's element total. */
export function pagedTotalKey(workspace: string, path: TreePath): string {
    return `paged:${workspace}:${datasetPathToString(path)}#total`;
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
                "Data.bindPaged: no workspace configured — mount a provider (or call initializePagedApi) first",
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
        while (this.loadedWindows.size > MAX_RETAINED_WINDOWS) {
            const coldest = this.loadedWindows.keys().next().value;
            if (coldest === undefined) break;
            this.loadedWindows.delete(coldest);
            const entry = this.entries.get(coldest);
            // Never evict a window that is still in flight — its settle would
            // land on an entry the next read has already relaunched.
            if (entry === undefined || entry.status !== "loaded") continue;
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
            seek: buildSeek(sourceType, pathExpr, platform),
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
// In-memory PagedApi — offline harnesses (showcase, snapshots, tests) serve
// windows out of a local array, round-tripped through the same beast2 codec a
// real server uses.
// =============================================================================

/** One offline paged source for {@link createInMemoryPagedApi}. */
export interface InMemoryPagedSource {
    /** The dataset path this source answers for. */
    path: TreePath;
    /** Encode one window's elements to beast2 bytes — the server's job. The
     *  closure carries the collection type, so the source needs no separate
     *  type field. */
    encode: (elements: unknown[]) => Uint8Array;
    /** The whole source, as elements. */
    elements: unknown[];
}

/**
 * Build an offline {@link PagedApi} from local element arrays — the
 * showcase/snapshot harnesses' stand-in for a deployed dataset.
 */
export function createInMemoryPagedApi(sources: InMemoryPagedSource[]): PagedApi {
    return {
        async getPage(_workspace, path, window) {
            const pathStr = datasetPathToString(path);
            const source = sources.find(s => datasetPathToString(s.path) === pathStr);
            if (!source) throw new Error(`no in-memory paged source "${pathStr}"`);
            const slice = source.elements.slice(window.offset, window.offset + window.limit);
            const data = source.encode(slice);
            return {
                data,
                totalElements: source.elements.length,
                totalBytes: data.length,
                totalExact: true,
                segmentCount: 0,
                offset: window.offset,
                count: slice.length,
                hash: "",
            };
        },
    };
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
