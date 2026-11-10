/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Runtime implementation for the `Data.bindPaged` platform functions — reading
 * a collection dataset one WINDOW at a time, for sources too large to hold
 * whole.
 *
 * The read itself is the trigger: `page(offset, limit)` returns the window if
 * it has landed, and otherwise starts the fetch and returns `none`. The caller
 * re-reads on the next reactive frame (the window's channel notifies when it
 * settles), which is why the East-side contract is `Option` rather than a
 * promise — the same shape `Func.bind`'s `read()` has. A fetch that failed
 * throws its reason when read — a {@link PagedReadError}, so a reader tells a
 * read that failed from any other error — so `none` means only "in flight".
 *
 * Every bind of one dataset shares a SNAPSHOT: the content hash its reads are
 * pinned to, its revision. Windows, totals and searches are fetched pinned, so
 * the server answers from that content or refuses; what one snapshot delivered
 * is never served beside another's. The snapshot follows its dataset — the
 * dataset store's status poll reporting a new hash, a refused pin, or
 * `refresh` moves it — and a move drops what the old snapshot delivered, so the
 * windows and searches still being read are fetched again, pinned to the new
 * one. It follows while something reads the dataset: once its readers have all
 * let it go, nothing polls for it, and the next read follows it again — moved
 * at the first report if the dataset moved meanwhile.
 *
 * One tracked channel per window, per total and per search, each keyed by the
 * revision it belongs to, plus one per dataset for its revision, which every
 * read tracks.
 *
 * Searches of one source's rows launched in one synchronous turn are a burst
 * (#1360): each answer is applied to its channel as it lands, and the last
 * re-fires every channel the burst answered at once, so a reader of a window
 * over an interval index — some fifty-five searches — runs again once, not
 * once a search. Windows are applied to their readers once a frame (#1398,
 * CL9) — those by offset and those across a narrowing's runs alike: each lands
 * in its channel at once, and the windows that land before the next frame — a
 * fling coming to rest, the windows read ahead either side — re-fire together,
 * so a reader draws once for them, never once a window.
 *
 * A window a landed one covers is never fetched (#1217): its rows are that
 * window's, at the same revision, so the read is answered from it and keeps
 * the answer in its own channel. A sheet reads an entry it is about to draft
 * as a one-element window, beside the windows it draws.
 *
 * Landed windows are kept least recently read first, at most
 * {@link MAX_RETAINED_WINDOWS} of them: past the cap a window no reader holds
 * goes whole, and none a reader holds is evicted under it (#1409, R24), so a
 * reader of more windows than the cap — rows read a key at a time among
 * them, each a key search and a one-row window — settles, each read once.
 *
 * Several reads of one source are asked as one request when a reader asks
 * them together (#1351): `seekAll` a batch of key searches (`findKeys`),
 * `rowsAll` the rows of several keys of a Dict, `runsAll` the entries of
 * several runs — and `joinAll` a Dict's rows under the keys some runs of one
 * of a record's indexes name, the keys read by the server, none sent (#1393).
 * A batch is one request and one channel, named by a digest of what it asks,
 * which re-fires its readers once and holds its answer as a landed window
 * does, bounded with them. What it answers serves the single reads too: each
 * search's bounds are held at the revision — the last
 * {@link MAX_LANDED_SEARCHES} of them, a search's own answer among them once
 * no reader holds its channel — each row is held at its position — a search
 * by its key, or a one-row window at its row, is answered from it — and a
 * window inside one of a runs read's runs is cut from it. A channel no reader
 * holds goes once it holds nothing — aborted, evicted, or a batch whose
 * answer is held elsewhere — and its version with it. A record Slice over a
 * binding the indexed runtime built reads a plan's searches, and a window
 * across several runs, through them. A read by another record's runs is
 * pinned to both datasets' revisions, its channel both snapshots': a move of
 * either drops it.
 *
 * A read no reader waits on any longer is aborted while still in flight
 * (#1398, CL6, CL7): a window that left the demand ring, a period read a newer
 * navigation superseded. Each fetch carries its channel's signal through the
 * API seam; once the channel's last reader lets it go — and has not
 * subscribed again by the next microtask — its requests are cancelled and the
 * channel goes back to `idle`, so a read that asks for it again fetches it
 * afresh. (A read of a revision the source moved past is not aborted: its
 * answer lands nowhere, its pin no longer holding.)
 *
 * The dataset store's CONTENT is deliberately not used: it holds whole values,
 * and a paged source is precisely the thing you cannot hold whole. A source
 * rides the store's status poll for hashes alone, through
 * {@link PagedApi.watchRevision}, and reads windows through its own API seam —
 * the same shape `FuncRuntime` / `RecordRuntime` use.
 *
 * The runtime is a layer a file, each reading through the one before it, in
 * `paged/`: its API seam (`api.ts`), the names of its channels (`keys.ts`),
 * what it holds and its bounds (`state.ts`), window arithmetic (`windows.ts`)
 * and how it reads a failure (`errors.ts`); then the channels of a snapshot
 * and their fetches (`channels.ts`), single windows and searches (`reads.ts`)
 * and batched reads (`batches.ts`). This module is the last layer — the
 * handles, the platform functions and the default runtime — and the
 * runtime's entry: the rest of the package imports the runtime from here.
 *
 * @packageDocumentation
 */

import {
    East, SortedMap, compareFor, fromEastTypeValue, type EastType, BooleanType, IntegerType, NullType, OptionType, StringType, none, some,
    type EastTypeValue, type option,
} from "@elaraai/east";
import { type PlatformFunction, EastTypeType } from "@elaraai/east/internal";
import { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import { bindPagedPinnedPlatformFn, bindPagedPlatformFn, DataPagedPrimitives } from "@elaraai/e3-ui/internal";
import { registerReactiveTracker, registerPlatformImplementation, registerRecordSliceBatches } from "@elaraai/east-ui-components/platform";
import { TreePathType, type TreePath } from "@elaraai/e3-types";

import { datasetPathToString } from "./dataset-store.js";
import { IndexedPagedRuntime, recordSliceBatchesOf } from "./indexed-paged.js";
import { toFindQuery } from "./find-query.js";
import type { PagedSelector, PagedSource, PagedApi } from "./paged/api.js";
import { NO_INDEX, selectorKey, pagedWindowFamily, pagedWindowKey, pagedTotalKey, pagedSeekKey } from "./paged/keys.js";
import { heldSearch } from "./paged/state.js";
import type { PagedLandingFrame } from "./paged/channels.js";
import { PagedBatches } from "./paged/batches.js";

// The runtime's parts, in the files that hold them.
export {
    type PagedWindow,
    type PagedSelector,
    type PagedSource,
    type PagedRow,
    type PagedRun,
    type PagedPlacedSegment,
    type PagedPlacement,
    type PagedApi,
    createDefaultPagedApi,
} from "./paged/api.js";
export { pagedRevisionKey, pagedWindowKey, pagedTotalKey, pagedSeekKey, pagedBatchKey } from "./paged/keys.js";
export { MAX_WITHIN_KEYS, MAX_HELD_PLACEMENTS } from "./paged/state.js";
export { type PagedLandingFrame, MAX_RETAINED_WINDOWS } from "./paged/channels.js";
export { type PagedRuntimeProbe, setPagedRuntimeProbe } from "./paged/reads.js";

/** The decoded descriptor arguments as a selector. */
function toSelector(indexArg: unknown, joinArg: unknown): PagedSelector {
    const index = indexArg as option<string> | undefined;
    return {
        index: index !== undefined && index.type === "some" ? index.value : null,
        join: joinArg === true,
    };
}

/** Refuses a paged bind of a path the task's manifest never declared — so a
 *  `ui()` task windows only the datasets derivation recorded. */
function checkDeclared(allowed: ReadonlySet<string> | null, path: TreePath): void {
    if (allowed === null) return;
    const pathStr = datasetPathToString(path);
    if (!allowed.has(pathStr)) {
        throw new Error(
            `Data.bindPaged: source path "${pathStr}" not declared in manifest — ` +
            `bind it in the task body so derivation records it`,
        );
    }
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
    indexExpr: unknown,
    joinExpr: unknown,
    selector: PagedSelector,
    platform: PlatformFunction[],
): unknown {
    // An INDEX window is an Array — it has to be, or a Dict would re-sort it
    // out of index order — but the collection behind it is keyed by `{ik, k}`,
    // so it is searchable even though its window type is not.
    if (selector.index === null && keyTypeOf(sourceType) === null) return none;
    const { seek } = DataPagedPrimitives;
    return some(East.compile(
        East.function([SeekQueryType], OptionType(SeekRangeType), ($, query) => {
            $.return(seek([T], pathExpr as never, indexExpr as never, joinExpr as never, query));
        }),
        platform,
    ));
}

// A search from East's form to e3's wire, in a module of its own so the
// indexed runtime, which this module builds, reaches it without a cycle.
export { toFindQuery } from "./find-query.js";

/**
 * Encapsulates all `Data.bindPaged` runtime state. The module-level
 * {@link defaultPagedRuntime} instance backs the registered platform; tests
 * construct their own for isolation.
 */
export class PagedRuntime extends PagedBatches {
    /** Field-index bindings share this runtime's existing reads. */
    readonly indexed = new IndexedPagedRuntime(this);

    // Compiled-handle cache (issue #106 perf): buildHandle compiles several
    // East.functions per bind, and binds re-run every reactive frame. The
    // method IR is a pure function of (sourceType, path, selector, shape), and
    // the methods resolve api/workspace LIVE, so a cached handle still
    // re-binds.
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

    /** The source each handle serves, by the handle's `id` — what the id says,
     *  kept as it was built rather than read back from its text. */
    private readonly sources = new Map<string, PagedSource>();

    // ----- wiring ----------------------------------------------------------

    /** Install the API adapter + workspace — called by the React provider
     *  (or a test) before any handle is used. Another adapter or workspace
     *  starts from nothing: no snapshot of the old one's carries over. */
    initialize(api: PagedApi, workspace: string): void {
        if (this.api !== api || this.workspace !== workspace) this.reset();
        this.api = api;
        this.workspace = workspace;
    }

    /**
     * Tear down the adapter and all window state.
     *
     * @param api - Clear only while this is the installed adapter, so a
     *   provider tearing down after another installed its own leaves that one
     *   in place
     */
    clear(api?: PagedApi): void {
        if (api !== undefined && this.api !== api) return;
        this.api = null;
        this.workspace = null;
        this.reset();
        this.handleCache.clear();
        this.indexed.clear();
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
                (pathArg: unknown, indexArg: unknown, joinArg: unknown, offsetArg: unknown, limitArg: unknown) => {
                    const workspace = this.resolveWorkspace();
                    const path = pathArg as TreePath;
                    const revision = this.revisionFor(workspace, path);
                    if (typeof revision !== "string") return none;
                    const selector = toSelector(indexArg, joinArg);
                    const offset = Number(offsetArg as bigint);
                    const limit = Number(limitArg as bigint);
                    const key = pagedWindowKey(workspace, path, revision, offset, limit, selector);
                    this.track(key);
                    const snapshot = this.snapshotOf(workspace, path);
                    const family = pagedWindowFamily(workspace, path, revision, selector);
                    // A window a landed one covers is answered from it, never fetched (#1217).
                    const own = this.channel(snapshot, key);
                    if (own.status !== "loaded") {
                        this.cutFromCovering(sourceType, family, offset, limit, own);
                    }
                    // A one-row window at a row a read by key holds is answered from it (#1351).
                    if (own.status !== "loaded" && limit === 1 && selector.index === null && sourceType.type === "Dict") {
                        const held = snapshot.held.get(family)?.byPosition.get(offset);
                        if (held !== undefined && held.row.type === "some") {
                            const keyType = fromEastTypeValue((sourceType.value as { key: EastTypeValue }).key);
                            own.status = "loaded";
                            own.window = new SortedMap([[held.key, held.row.value]], compareFor(keyType));
                            own.span = { family, offset, count: 1 };
                            delete own.error;
                        }
                    }
                    const entry = this.ensureWindow(sourceType, workspace, path, snapshot, revision, offset, limit, selector, key);
                    if (entry.status === "loaded" && entry.window !== undefined) this.touchWindow(key);
                    return this.answer(entry, entry.window);
                }),
            DataPagedPrimitives.total.implement((_sourceType: EastTypeValue) =>
                (pathArg: unknown, indexArg: unknown, joinArg: unknown) => {
                    const workspace = this.resolveWorkspace();
                    const path = pathArg as TreePath;
                    const revision = this.revisionFor(workspace, path);
                    if (typeof revision !== "string") return none;
                    const key = pagedTotalKey(workspace, path, revision, toSelector(indexArg, joinArg));
                    this.track(key);
                    const entry = this.channel(this.snapshotOf(workspace, path), key);
                    return entry.total !== undefined ? some(BigInt(entry.total)) : none;
                }),
            DataPagedPrimitives.seek.implement((sourceType: EastTypeValue) =>
                (pathArg: unknown, indexArg: unknown, joinArg: unknown, queryArg: unknown) => {
                    const workspace = this.resolveWorkspace();
                    const path = pathArg as TreePath;
                    const revision = this.revisionFor(workspace, path);
                    if (typeof revision !== "string") return none;
                    const selector = toSelector(indexArg, joinArg);
                    const query = toFindQuery(queryArg, selector);
                    const key = pagedSeekKey(workspace, path, revision, query, selector);
                    this.track(key);
                    const snapshot = this.snapshotOf(workspace, path);
                    const own = this.channel(snapshot, key);
                    // A search a batch answered, or this one's own answer its channel left, is answered from what the
                    // revision holds, never searched (#1351).
                    const landed = own.status === "loaded" ? undefined : heldSearch(snapshot, key);
                    if (landed !== undefined) {
                        own.status = "loaded";
                        own.range = landed;
                        delete own.error;
                    }
                    // A key a read by key holds is answered from it, never searched (#1351).
                    if (own.status !== "loaded" && selector.index === null && "key" in query) {
                        const held = this.heldRow(snapshot, pagedWindowFamily(workspace, path, revision, selector), sourceType, query.key);
                        if (held !== undefined) {
                            const found = held.row.type === "some";
                            own.status = "loaded";
                            own.range = { found, row: held.position, count: found ? 1 : 0, hash: revision };
                            delete own.error;
                        }
                    }
                    const entry = this.ensureSeek(workspace, path, snapshot, revision, selector, query, key);
                    const range = entry.range;
                    return this.answer(entry, range === undefined
                        ? undefined
                        : { found: range.found, row: BigInt(range.row), count: BigInt(range.count) });
                }),
            DataPagedPrimitives.revision.implement((_sourceType: EastTypeValue) =>
                (pathArg: unknown, _indexArg: unknown, _joinArg: unknown) => {
                    const revision = this.revisionFor(this.resolveWorkspace(), pathArg as TreePath);
                    return typeof revision === "string" ? some(revision) : none;
                }),
            DataPagedPrimitives.refresh.implement((_sourceType: EastTypeValue) =>
                (pathArg: unknown, _indexArg: unknown, _joinArg: unknown, targetArg: unknown) => {
                    const workspace = this.resolveWorkspace();
                    const path = pathArg as TreePath;
                    const target = targetArg as option<string>;
                    // Deferred: a refresh called while a view renders must not
                    // re-fire that render from inside it.
                    queueMicrotask(() => {
                        if (this.workspace !== workspace) return;
                        if (target.type === "some") { this.moveTo(workspace, path, this.snapshotOf(workspace, path), target.value); return; }
                        // Following the current state is a Retry too: what failed is asked again now.
                        this.retryNow(workspace, path);
                    });
                    return null;
                }),
        ];
    }

    /**
     * Build the handle value for one paged bind. Every method is a thin
     * IR-bearing `East.function` over {@link buildPrimitives}, capturing only
     * the plain-data source path and selector (the value type rides as a
     * type-arg) — so the handle is ordinary serializable East data (issue
     * #106).
     *
     * @param sourceType - The dataset's type, or an index's window type
     * @param path - The dataset's path
     * @param selector - The rows the bind serves
     * @param shape - `released`: the handle `data_bind_paged` returns, without
     *   `revision` or `refresh`; `pinned`: the handle `data_bind_paged_pinned`
     *   returns. Both read through the same snapshot.
     * @returns The handle
     */
    buildHandle(
        sourceType: EastTypeValue,
        path: TreePath,
        selector: PagedSelector,
        shape: "released" | "pinned",
    ): Record<string, unknown> {
        const id = `${datasetPathToString(path)}${selectorKey(selector)}`;
        this.sources.set(id, { path, selector, type: sourceType });
        const cacheKey = `${id}#${shape}`;
        let byPath = this.handleCache.get(sourceType);
        if (byPath) {
            const hit = byPath.get(cacheKey);
            if (hit) return hit;
        } else {
            byPath = new Map<string, Record<string, unknown>>();
            this.handleCache.set(sourceType, byPath);
        }

        const T = fromEastTypeValue(sourceType);
        // A single literal `Value` IR node for the captured path (the
        // `Data.bind` convention — manifest derivation reads it back).
        const pathExpr = East.value(path, TreePathType);
        // The selector rides the call as plain data, exactly as the path does,
        // so a decoded handle re-binds to the same rows.
        const indexExpr = East.value(selector.index === null ? none : some(selector.index), OptionType(StringType));
        const joinExpr = East.value(selector.join, BooleanType);
        const platform = this.buildPrimitives();
        const { page, total, revision, refresh } = DataPagedPrimitives;

        const handle: Record<string, unknown> = {
            // The comparable identity east-ui's `PagedSourceType` requires:
            // East compares every function as EQUAL, so a struct of nothing but
            // closures is indistinguishable from any other and a memoized
            // component would never re-render on a source swap (#567 D4). The
            // dataset path and selector are the natural identity — same path,
            // same rows. The snapshot they serve is `revision`'s, not the id's.
            id,
            page: East.compile(
                East.function([IntegerType, IntegerType], OptionType(T), ($, offset, limit) => {
                    $.return(page([T], pathExpr, indexExpr, joinExpr, offset, limit));
                }),
                platform,
            ),
            total: East.compile(
                East.function([], OptionType(IntegerType), ($) => {
                    $.return(total([T], pathExpr, indexExpr, joinExpr));
                }),
                platform,
            ),
            // Key search is a KEY-ORDER capability: Set/Dict element windows
            // ride the canonical East key order, so a key locates in O(log
            // segments) against the stored fences; an Array's stream order has
            // nothing to search. Resolved at bind time from the dataset's own
            // type, so a component renders the affordance only when it works.
            seek: buildSeek(sourceType, T, pathExpr, indexExpr, joinExpr, selector, platform),
        };
        if (shape === "pinned") {
            handle.revision = East.compile(
                East.function([], OptionType(StringType), ($) => {
                    $.return(revision([T], pathExpr, indexExpr, joinExpr));
                }),
                platform,
            );
            handle.refresh = East.compile(
                East.function([OptionType(StringType)], NullType, ($, target) => {
                    $.return(refresh([T], pathExpr, indexExpr, joinExpr, target));
                }),
                platform,
            );
        }
        byPath.set(cacheKey, handle);
        return handle;
    }

    /**
     * The source a handle this runtime built serves, by the handle's `id`: its
     * dataset's path and the rows it reads — what a component holding only the
     * handle needs to name the dataset, such as a query's root.
     *
     * @param id - A paged handle's `id`
     * @returns Its source, or `undefined` when this runtime built no handle with that id
     */
    sourceOf(id: string): PagedSource | undefined {
        return this.sources.get(id);
    }

    // ----- platform building -------------------------------------------------

    /** Build the PlatformFunction behind `data_bind_paged` — the bind a UI
     *  exported before pinned reads calls — bound to this runtime. Its handle
     *  has no `revision` or `refresh`, but its reads are pinned, follow the
     *  dataset and fail visibly all the same. Pass `allowed=null` for an
     *  unscoped impl, or a Set of path strings for manifest scoping. */
    buildPlatform(allowed: ReadonlySet<string> | null): PlatformFunction {
        return bindPagedPlatformFn.implement((sourceType: EastTypeValue) =>
            (pathArg: unknown) => {
                const path = pathArg as TreePath;
                checkDeclared(allowed, path);
                return this.buildHandle(sourceType, path, NO_INDEX, "released");
            },
        );
    }

    /** Build the PlatformFunction behind `data_bind_paged_pinned` — what
     *  `Data.bindPaged` emits, for a dataset's own rows or a record's index —
     *  bound to this runtime and scoped by `allowed` exactly as
     *  {@link buildPlatform} is: an index read is a read of the record's path. */
    buildPinnedPlatform(allowed: ReadonlySet<string> | null): PlatformFunction {
        return bindPagedPinnedPlatformFn.implement((sourceType: EastTypeValue) =>
            (pathArg: unknown, indexArg: unknown, joinArg: unknown) => {
                const path = pathArg as TreePath;
                checkDeclared(allowed, path);
                return this.buildHandle(sourceType, path, toSelector(indexArg, joinArg), "pinned");
            },
        );
    }
}

// =============================================================================
// Default process-global runtime + free-function exports.
// =============================================================================

/** Process-global runtime backing the `PagedPlatform` export. */
export const defaultPagedRuntime = new PagedRuntime();

/**
 * The source a paged handle serves, by the handle's `id`, from the runtime
 * behind the registered and the scoped paged platforms.
 *
 * @param id - A paged handle's `id`
 * @returns Its dataset's path and the rows it serves, or `undefined` when no
 *   handle with that id has been bound
 */
export function pagedSourceOf(id: string): PagedSource | undefined {
    return defaultPagedRuntime.sourceOf(id);
}

/**
 * Apply the windows the default runtime lands in frames of this, in place of
 * the page's next frame (#1398, CL9): a DOM test's, whose page draws no frame
 * its test waits on. `undefined` gives the page's frames back.
 *
 * @param frame - What asks for the frame, or `undefined`
 */
export function setPagedLandingFrame(frame: PagedLandingFrame | undefined): void {
    defaultPagedRuntime.setLandingFrame(frame);
}

/** Install the paging API adapter + workspace — called by the React provider
 *  on mount (or by a test). */
export function initializePagedApi(api: PagedApi, workspace: string): void {
    defaultPagedRuntime.initialize(api, workspace);
}

/**
 * Tear down the paging API adapter and all window state.
 *
 * @param api - Clear only while this is the installed adapter
 */
export function clearPagedApi(api?: PagedApi): void {
    defaultPagedRuntime.clear(api);
}

/** Global, manifest-unscoped paged binds + their backing primitives.
 *  Registered on module load (powers the extension registry decode path). */
export const PagedPlatform: PlatformFunction[] = [
    defaultPagedRuntime.buildPlatform(null),
    defaultPagedRuntime.buildPinnedPlatform(null),
    ...defaultPagedRuntime.indexed.platform(null),
    ...defaultPagedRuntime.buildPrimitives(),
];

/** Build manifest-scoped paged binds + their backing primitives, from the
 *  manifest's `pages` list.
 *
 *  The `data_page*` primitives MUST ship with the scoped platform: e3 `ui()`
 *  tasks render through `createScoped*()` arrays (UITaskPreview), NOT the
 *  global registry, so a serialized handle's methods would otherwise decode to
 *  "Platform function 'data_page' is not available". */
export function createScopedPagedPlatform(pages: readonly TreePath[]): PlatformFunction[] {
    const allowed = new Set(pages.map(p => datasetPathToString(p)));
    return [
        defaultPagedRuntime.buildPlatform(allowed),
        defaultPagedRuntime.buildPinnedPlatform(allowed),
        ...defaultPagedRuntime.indexed.platform(allowed),
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

// A record Slice over a binding an indexed runtime built — this one's, or a
// spec's own — reads a plan's searches and its windows in batches, through that
// runtime's channels (#1351).
registerRecordSliceBatches(recordSliceBatchesOf);
