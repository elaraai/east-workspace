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
 * throws its reason when read, so `none` means only "in flight".
 *
 * Every bind of one dataset shares a SNAPSHOT: the content hash its reads are
 * pinned to, its revision. Windows, totals and searches are fetched pinned, so
 * the server answers from that content or refuses; what one snapshot delivered
 * is never served beside another's. The snapshot follows its dataset — the
 * dataset store's status poll reporting a new hash, a refused pin, or
 * `refresh` moves it — and a move drops what the old snapshot delivered, so the
 * windows and searches still being read are fetched again, pinned to the new
 * one.
 *
 * One tracked channel per window, per total and per search, each keyed by the
 * revision it belongs to, plus one per dataset for its revision, which every
 * read tracks.
 *
 * The dataset store's CONTENT is deliberately not used: it holds whole values,
 * and a paged source is precisely the thing you cannot hold whole. A source
 * rides the store's status poll for hashes alone, through
 * {@link PagedApi.watchRevision}, and reads windows through its own API seam —
 * the same shape `FuncRuntime` / `RecordRuntime` use.
 *
 * @packageDocumentation
 */

import {
    East,
    SortedMap,
    compareFor,
    fromEastTypeValue,
    type EastType,
    BooleanType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    decodeBeast2For,
    none,
    some,
    type EastTypeValue,
    type option,
    type ValueTypeOf,
} from "@elaraai/east";
import { type PlatformFunction, EastTypeType } from "@elaraai/east/internal";
import { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import { bindPagedPinnedPlatformFn, bindPagedPlatformFn, DataPagedPrimitives } from "@elaraai/e3-ui/internal";
import {
    registerReactiveTracker,
    registerPlatformImplementation,
} from "@elaraai/east-ui-components/platform";
import {
    datasetGetPage,
    datasetFindKey,
    datasetGetStatus,
    DatasetHashMismatchError,
    type DatasetPage,
    type DatasetFindQuery,
    type DatasetFindResult,
    type RequestOptions,
} from "@elaraai/e3-api-client";
import { TreePathType, type TreePath } from "@elaraai/e3-types";

import { datasetPathToString, type ReactiveDatasetCacheInterface } from "./dataset-store.js";
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
    /** Read through one of a record's secondary indexes instead of the record
     *  itself — the window is then the INDEX's row space, in its own order. */
    index?: string;
    /** With {@link index}: read each entry's row from the record too. */
    join?: boolean;
    /** The content hash the window is pinned to. The server answers from that
     *  content or refuses, naming the content the dataset holds now; it never
     *  answers from other content. */
    hash?: string;
}

/** Which rows a bind serves: the dataset's own, or one of a record's indexes.
 *  Every channel key, every fetch and the handle cache carry it, because two
 *  binds that differ here serve different row spaces from one path. */
export interface PagedSelector {
    /** The index's name, or `null` for the dataset itself. */
    index: string | null;
    /** Whether an index read joins each entry to its row. */
    join: boolean;
}

/** The selector a bind with no index has. */
const NO_INDEX: PagedSelector = { index: null, join: false };

/** A selector's contribution to a channel key and a cache key. */
function selectorKey(selector: PagedSelector): string {
    return selector.index === null ? "" : `@${selector.index}${selector.join ? "+join" : ""}`;
}

/**
 * Adapter for the dataset paging endpoints. The default wraps
 * `@elaraai/e3-api-client`'s `datasetGetPage`, `datasetFindKey` and
 * `datasetGetStatus`, and follows datasets through the dataset store.
 */
export interface PagedApi {
    /** Fetch one element window of a collection dataset — or of one of a
     *  record's indexes, when the window names one. */
    getPage(workspace: string, path: TreePath, window: PagedWindow): Promise<DatasetPage>;
    /** Locate a key query in a Set/Dict dataset's canonical key order. The
     *  `row` it answers with indexes the SAME row space {@link getPage}'s
     *  element windows serve, which is what makes a hit addressable. */
    findKey(workspace: string, path: TreePath, query: DatasetFindQuery): Promise<DatasetFindResult>;
    /**
     * The dataset's current content hash, or `null` while it has no value. For
     * a record it is the record's state hash, which reads through its indexes
     * are pinned to as well.
     */
    getRevision(workspace: string, path: TreePath): Promise<string | null>;
    /**
     * Follow a dataset's content hash.
     *
     * @param workspace - The workspace
     * @param path - The dataset's path
     * @param onChange - Hears each hash the dataset moves to, the first report
     *   included; `null` while it has no value
     * @returns A function that stops following
     */
    watchRevision(workspace: string, path: TreePath, onChange: (hash: string | null) => void): () => void;
}

/**
 * Build the default {@link PagedApi} that talks to a real e3 server via
 * `@elaraai/e3-api-client`.
 *
 * @remarks
 * A dataset is followed through the dataset store's workspace-status poll,
 * which reports every dataset's hash: a followed dataset joins that poll, adds
 * no request of its own, and never has its content fetched.
 *
 * @param apiUrl - Base URL of the e3 API server
 * @param repo - Repository name
 * @param getOptions - Reads the current request options — the token, and the
 *   `fetch` requests go through — so a rotated one is used at once
 * @param datasets - The dataset store whose status poll reports the hashes
 * @returns The adapter
 */
export function createDefaultPagedApi(
    apiUrl: string,
    repo: string,
    getOptions: () => RequestOptions,
    datasets: Pick<ReactiveDatasetCacheInterface, "watchHash">,
): PagedApi {
    return {
        async getPage(workspace, path, window) {
            return datasetGetPage(apiUrl, repo, workspace, path, window, getOptions());
        },
        async findKey(workspace, path, query) {
            return datasetFindKey(apiUrl, repo, workspace, path, query, getOptions());
        },
        async getRevision(workspace, path) {
            const status = await datasetGetStatus(apiUrl, repo, workspace, path, getOptions());
            return status.hash.type === "some" ? status.hash.value : null;
        },
        watchRevision(workspace, path, onChange) {
            return datasets.watchHash(workspace, path, onChange);
        },
    };
}

// =============================================================================
// Runtime
// =============================================================================

/** One tracked channel per window, per total and per search. */
interface PageEntry {
    status: "idle" | "running" | "loaded" | "failed";
    /** The fetch the channel waits on; a settling fetch that is no longer it
     *  is discarded. Unique across the runtime, so a channel dropped by a move
     *  and made again never mistakes an old fetch for its own. */
    launchSeq: number;
    /** The decoded window — a value of the dataset's own type. */
    window?: unknown;
    /** Total elements in the source, learned from any landed window. */
    total?: number;
    /** Where a key query landed — the answer on a seek channel. */
    range?: DatasetFindResult;
    /** Why the last attempt failed — what a read of the channel throws. */
    error?: string;
    /** When the last attempt failed, so a retry can be rate-limited. */
    failedAtMs?: number;
    /** No retry can help while the source holds the same content. */
    permanent?: boolean;
}

/** What every bind of one dataset shares: the content its reads are pinned to. */
interface Snapshot {
    /** The dataset, as snapshots are keyed. */
    readonly key: string;
    /** The content hash reads are pinned to: `undefined` until found, `null`
     *  while the dataset has no value. */
    revision: string | null | undefined;
    /** Moves so far. A lookup that began before a move answers for content no
     *  newer than the move's, so its answer is dropped. */
    moves: number;
    /** The latest lookup of the revision; only it settles. */
    findSeq: number;
    /** Whether a lookup is in flight. */
    finding: boolean;
    /** Why the last lookup failed, while the revision is unknown. */
    findError?: string;
    /** When the last lookup failed, so a retry can be rate-limited. */
    findFailedAtMs?: number;
    /** The channels of the current revision, dropped when it moves. */
    readonly channels: Set<string>;
    /** Stops following the dataset. */
    unwatch: () => void;
}

/** Minimum gap between retries of a read whose fetch failed. */
const RETRY_AFTER_MS = 2000;

/**
 * Decoded windows retained across ALL paged sources (#567 D6).
 *
 * A decoded window is the heavy object here — a window of wide rows runs to
 * megabytes — and nothing else evicts one while its revision stands: scrolling
 * a GB-scale dataset end to end would pin every window it passed. Retention is
 * bounded least-recently-READ, and an evicted window drops back to `idle` so
 * the next read simply refetches it (the raw bytes may still be in an HTTP
 * cache, so a return is usually cheap).
 *
 * `<PagedDatasetPreview>` caps its own materialized rows the same way
 * (`MAX_RETAINED_PAGES`); this is the cap for the *bound* path, where the
 * renderer holds no cache of its own and the runtime is the only holder.
 */
const MAX_RETAINED_WINDOWS = 24;

/**
 * Server error codes that no retry can fix while the dataset holds the same
 * content: the request, or the stored value, is wrong rather than the moment.
 * A read that failed with one keeps throwing without fetching again until the
 * source moves. Anything else — a transport blip, a cold server — is fetched
 * again after {@link RETRY_AFTER_MS}.
 */
const PERMANENT_PAGE_ERRORS = new Set([
    "bad_request",
    "dataset_not_canonical",
    "dataset_not_indexed",
    "dataset_not_pageable",
    "dataset_not_searchable",
    "dataset_not_segmented",
    "index_not_found",
    "key_parse_error",
]);

/** Server error codes that say the dataset has no value, so the source has no
 *  snapshot until one lands. */
const NO_VALUE_ERRORS = new Set(["dataset_unassigned", "dataset_null"]);

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

/** A caught error's server code, when it carries one. */
function errorCode(err: unknown): string | undefined {
    const code = (err as { code?: unknown } | null)?.code;
    return typeof code === "string" ? code : undefined;
}

/** Whether a caught fetch error is one no retry can fix. */
function isPermanentPageError(err: unknown): boolean {
    const code = errorCode(err);
    return code !== undefined && PERMANENT_PAGE_ERRORS.has(code);
}

/** What a failed read throws: the server's code and message, or the error's own. */
function failureOf(path: TreePath, err: unknown): string {
    const code = errorCode(err);
    const details = (err as { details?: unknown } | null)?.details;
    const reason = code === undefined
        ? (err instanceof Error ? err.message : String(err))
        : typeof details === "string" && details !== "" ? `${code}: ${details}` : code;
    return `Data.bindPaged: ${datasetPathToString(path)}: ${reason}`;
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

/** Tracked-channel key for a dataset's revision. Every read of the dataset
 *  tracks it, so every read re-fires when the source moves. */
export function pagedRevisionKey(workspace: string, path: TreePath): string {
    return `paged:${workspace}:${datasetPathToString(path)}#revision`;
}

/** Tracked-channel key for one window of one revision. */
export function pagedWindowKey(
    workspace: string, path: TreePath, revision: string, offset: number, limit: number, selector: PagedSelector = NO_INDEX,
): string {
    return `paged:${workspace}:${datasetPathToString(path)}${selectorKey(selector)}@${revision}#${offset}+${limit}`;
}

/** Tracked-channel key for one revision's element total. */
export function pagedTotalKey(workspace: string, path: TreePath, revision: string, selector: PagedSelector = NO_INDEX): string {
    return `paged:${workspace}:${datasetPathToString(path)}${selectorKey(selector)}@${revision}#total`;
}

/** Tracked-channel key for ONE key query against one revision. Every distinct
 *  query gets its own channel: a search result is as fixed as a window. */
export function pagedSeekKey(
    workspace: string, path: TreePath, revision: string, query: DatasetFindQuery, selector: PagedSelector = NO_INDEX,
): string {
    const q = "key" in query
        ? `k=${query.key}`
        : "fields" in query
            ? `f=${query.fields.join("\u0000")}|p=${query.prefix ?? ""}`
            : "prefix" in query
                ? `p=${query.prefix}`
                : `r=${(query.from ?? []).join("\u0000")}|${(query.to ?? []).join("\u0000")}`;
    return `paged:${workspace}:${datasetPathToString(path)}${selectorKey(selector)}@${revision}#seek:${q}`;
}

/**
 * The decoded East {@link SeekQueryType} value as e3's wire query.
 *
 * The two are deliberately the same shapes, so this is a re-tagging rather
 * than a translation: `.east` literals stay text, and the East option on the
 * `fields` arm, like an open end of a `range`, becomes an absent property
 * (`exactOptionalPropertyTypes`).
 */
export function toFindQuery(query: unknown, selector: PagedSelector = NO_INDEX): DatasetFindQuery {
    const q = query as ValueTypeOf<typeof SeekQueryType>;
    const scope = selector.index === null ? {} : { index: selector.index };
    if (q.type === "key") return { key: q.value, ...scope };
    if (q.type === "prefix") return { prefix: q.value, ...scope };
    if (q.type === "range") {
        // A half-open bound on a leading prefix of the FLATTENED key — an
        // empty side is an open end, which the wire says by omitting it. Open
        // at both ends it names no run, and a server refuses it with an error
        // the retry gate would keep re-asking, so it is refused here instead.
        const r = q.value;
        const from = [...r.from];
        const to = [...r.to];
        if (from.length === 0 && to.length === 0) {
            throw new Error("Data.bindPaged: a range seek names no end — give it a `from`, a `to`, or both");
        }
        return from.length === 0 ? { to, ...scope } : to.length === 0 ? { from, ...scope } : { from, to, ...scope };
    }
    const f = q.value;
    const fields = [...f.values];
    return f.prefix.type === "some"
        ? { fields, prefix: f.prefix.value, ...scope }
        : { fields, ...scope };
}

/**
 * Encapsulates all `Data.bindPaged` runtime state. The module-level
 * {@link defaultPagedRuntime} instance backs the registered platform; tests
 * construct their own for isolation.
 */
export class PagedRuntime extends TrackedChannelStore<PageEntry> {
    private api: PagedApi | null = null;
    private workspace: string | null = null;

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

    /** Loaded window keys in least-recently-READ order (a Map preserves
     *  insertion order; a read re-inserts). Bounds the decoded-window cache. */
    private readonly loadedWindows = new Map<string, true>();

    /** Each dataset's snapshot, by workspace and path. */
    private readonly snapshots = new Map<string, Snapshot>();

    /** Fetches launched so far — the source of every channel's `launchSeq`. */
    private launches = 0;

    /** Monotonic clock seam so tests can drive the retry gate. */
    protected now(): number {
        return Date.now();
    }

    protected createEntry(): PageEntry {
        return { status: "idle", launchSeq: 0 };
    }

    // ----- wiring ----------------------------------------------------------

    /** Install the API adapter + workspace — called by the React provider
     *  (or a test/showcase harness) before any handle is used. Another adapter
     *  or workspace starts from nothing: no snapshot of the old one's carries
     *  over. */
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
    }

    /** Stop following every dataset, and drop what every snapshot delivered. */
    private reset(): void {
        for (const snapshot of this.snapshots.values()) snapshot.unwatch();
        this.snapshots.clear();
        this.clearChannels();
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

    // ----- snapshots -------------------------------------------------------

    /** A dataset's snapshot, followed from its first read until the runtime
     *  is cleared. */
    private snapshotOf(workspace: string, path: TreePath): Snapshot {
        const key = `${workspace}:${datasetPathToString(path)}`;
        const existing = this.snapshots.get(key);
        if (existing !== undefined) return existing;
        const snapshot: Snapshot = {
            key,
            revision: undefined,
            moves: 0,
            findSeq: 0,
            finding: false,
            channels: new Set(),
            unwatch: () => {},
        };
        this.snapshots.set(key, snapshot);
        if (this.api !== null) {
            snapshot.unwatch = this.api.watchRevision(workspace, path, (hash) => this.moveTo(workspace, path, snapshot, hash));
        }
        return snapshot;
    }

    /** Whether a snapshot is still the runtime's, rather than one a clear or a
     *  re-initialization dropped. */
    private isLive(snapshot: Snapshot): boolean {
        return this.snapshots.get(snapshot.key) === snapshot;
    }

    /** Whether a live snapshot is still pinned to `revision`. */
    private pinnedTo(snapshot: Snapshot, revision: string): boolean {
        return this.isLive(snapshot) && snapshot.revision === revision;
    }

    /**
     * The revision a read of `path` is pinned to — a hash, `null` while the
     * dataset has no value, or `undefined` while it is being found — tracked so
     * the read re-fires when the source moves.
     *
     * @throws The failed lookup's reason, until a read after the retry gap
     *   looks again
     */
    private revisionFor(workspace: string, path: TreePath): string | null | undefined {
        this.track(pagedRevisionKey(workspace, path));
        const snapshot = this.snapshotOf(workspace, path);
        if (snapshot.revision !== undefined || snapshot.finding) return snapshot.revision;
        if (snapshot.findError !== undefined && this.now() - (snapshot.findFailedAtMs ?? 0) < RETRY_AFTER_MS) {
            throw new Error(snapshot.findError);
        }
        this.find(workspace, path, snapshot);
        return undefined;
    }

    /**
     * Ask the server which content the dataset holds, and move there — unless
     * a move lands first, which came from something no older than the answer.
     */
    private find(workspace: string, path: TreePath, snapshot: Snapshot): void {
        const seq = ++snapshot.findSeq;
        const moves = snapshot.moves;
        snapshot.finding = true;
        const api = this.api;
        void (async () => {
            let revision: string | null;
            try {
                if (api === null) throw new Error("no PagedApi installed");
                revision = await api.getRevision(workspace, path);
            } catch (err) {
                if (!this.isLive(snapshot) || snapshot.findSeq !== seq) return;
                snapshot.finding = false;
                if (snapshot.revision !== undefined) return;
                snapshot.findError = failureOf(path, err);
                snapshot.findFailedAtMs = this.now();
                console.error(`Data.bindPaged: could not find which content ${datasetPathToString(path)} holds:`, err);
                this.notify(pagedRevisionKey(workspace, path));
                return;
            }
            if (!this.isLive(snapshot) || snapshot.findSeq !== seq) return;
            snapshot.finding = false;
            if (snapshot.moves !== moves) return;
            this.moveTo(workspace, path, snapshot, revision);
        })();
    }

    /**
     * Move a dataset's source to `revision`: drop what the old snapshot
     * delivered and re-fire every read of the dataset, so the windows and
     * searches still in use are fetched again, pinned to the new one. A move to
     * the revision the source already has changes nothing.
     */
    private moveTo(workspace: string, path: TreePath, snapshot: Snapshot, revision: string | null): void {
        if (!this.isLive(snapshot) || snapshot.revision === revision) return;
        snapshot.revision = revision;
        snapshot.moves += 1;
        delete snapshot.findError;
        delete snapshot.findFailedAtMs;
        for (const key of snapshot.channels) {
            this.entries.delete(key);
            this.loadedWindows.delete(key);
        }
        snapshot.channels.clear();
        this.notify(pagedRevisionKey(workspace, path));
    }

    /**
     * Handle what a pinned fetch threw when it is not the read's failure: a
     * refusal naming other content moves the source there, and "no value"
     * moves it to no snapshot. Returns whether the error was one of those, or
     * arrived after the source had already moved on.
     */
    private followed(workspace: string, path: TreePath, snapshot: Snapshot, revision: string, err: unknown): boolean {
        if (!this.pinnedTo(snapshot, revision)) return true;
        if (err instanceof DatasetHashMismatchError) {
            if (err.currentHash !== null && err.currentHash !== revision) {
                this.moveTo(workspace, path, snapshot, err.currentHash);
                return true;
            }
            // A refusal that names no other content: look it up, and let this
            // read fail until the lookup moves the source.
            this.find(workspace, path, snapshot);
            return false;
        }
        const code = errorCode(err);
        if (code !== undefined && NO_VALUE_ERRORS.has(code)) {
            this.moveTo(workspace, path, snapshot, null);
            return true;
        }
        return false;
    }

    // ----- channels ----------------------------------------------------------

    /** A channel of the snapshot's current revision, dropped when it moves. */
    private channel(snapshot: Snapshot, key: string): PageEntry {
        snapshot.channels.add(key);
        return this.entry(key);
    }

    /** Whether a channel is due a fetch: never fetched, evicted, or failed
     *  for a reason a retry can fix, longer ago than the retry gap. */
    private due(entry: PageEntry): boolean {
        if (entry.status === "idle") return true;
        if (entry.status !== "failed" || entry.permanent === true) return false;
        return this.now() - (entry.failedAtMs ?? 0) >= RETRY_AFTER_MS;
    }

    /**
     * Mark a channel's fetch as started, returning the fetch's sequence number.
     *
     * Deliberately does NOT notify — the read that triggers it runs inside a
     * render pass, and notifying there would re-enter the renderer. Only the
     * settle notifies.
     */
    private launch(entry: PageEntry): number {
        entry.status = "running";
        entry.launchSeq = ++this.launches;
        return entry.launchSeq;
    }

    /** Apply a fetch's outcome if the channel still waits on it, re-firing the
     *  channel's reads. Returns whether it applied. */
    private settle(key: string, seq: number, mutate: (entry: PageEntry) => void): boolean {
        const entry = this.entries.get(key);
        if (entry === undefined || entry.launchSeq !== seq) return false;
        mutate(entry);
        this.notify(key);
        return true;
    }

    /** Settle a fetch as failed, with the reason a read will throw. */
    private fail(key: string, seq: number, reason: string, permanent: boolean): void {
        this.settle(key, seq, (e) => {
            e.status = "failed";
            e.error = reason;
            e.failedAtMs = this.now();
            e.permanent = permanent;
        });
    }

    /** What a read of a channel answers: its value once loaded, `none` while
     *  in flight, or its failure, thrown. */
    private answer<T>(entry: PageEntry, value: T | undefined): option<T> {
        if (entry.status === "loaded" && value !== undefined) return some(value);
        if (entry.status === "failed") throw new Error(entry.error ?? "Data.bindPaged: the read failed");
        return none;
    }

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

    // ----- window loading --------------------------------------------------

    /** Start the pinned fetch for a window if it is due one, returning its
     *  channel. */
    private ensureWindow(
        sourceType: EastTypeValue,
        workspace: string,
        path: TreePath,
        snapshot: Snapshot,
        revision: string,
        offset: number,
        limit: number,
        selector: PagedSelector,
        key: string,
    ): PageEntry {
        const entry = this.channel(snapshot, key);
        if (!this.due(entry)) return entry;
        const seq = this.launch(entry);
        const api = this.api;

        void (async () => {
            let page: DatasetPage;
            try {
                if (api === null) throw new Error("no PagedApi installed");
                page = await api.getPage(workspace, path, {
                    offset, limit, hash: revision,
                    ...(selector.index !== null && { index: selector.index, join: selector.join }),
                });
            } catch (err) {
                if (this.followed(workspace, path, snapshot, revision, err)) return;
                this.fail(key, seq, failureOf(path, err), isPermanentPageError(err));
                console.error(`Data.bindPaged: fetch failed for ${key}:`, err);
                return;
            }
            if (!this.pinnedTo(snapshot, revision)) return;
            let decoded: unknown;
            try {
                decoded = decodeBeast2For(sourceType)(page.data);
            } catch (err) {
                // A window of this content that does not decode as the
                // source's type never will.
                this.fail(key, seq, `${failureOf(path, err)} (the window does not decode as the source's type)`, true);
                console.error(`Data.bindPaged: decode failed for ${key}:`, err);
                return;
            }
            const landed = this.settle(key, seq, (e) => {
                e.status = "loaded";
                e.window = decoded;
                e.total = page.totalElements;
                delete e.error;
            });
            if (!landed) return;
            this.touchWindow(key);
            // Any landed window teaches the revision's total — publish it on
            // the total's channel so a reader watching `total()` re-fires.
            const totalKey = pagedTotalKey(workspace, path, revision, selector);
            const totalEntry = this.channel(snapshot, totalKey);
            if (totalEntry.total !== page.totalElements) {
                totalEntry.total = page.totalElements;
                totalEntry.status = "loaded";
                this.notify(totalKey);
            }
        })();
        return entry;
    }

    /** Start the pinned fence search for one key query if it is due one,
     *  returning its channel — the seek sibling of {@link ensureWindow}. */
    private ensureSeek(
        workspace: string,
        path: TreePath,
        snapshot: Snapshot,
        revision: string,
        query: DatasetFindQuery,
        key: string,
    ): PageEntry {
        const entry = this.channel(snapshot, key);
        if (!this.due(entry)) return entry;
        const seq = this.launch(entry);
        const api = this.api;

        void (async () => {
            let range: DatasetFindResult;
            try {
                if (api === null) throw new Error("no PagedApi installed");
                range = await api.findKey(workspace, path, { ...query, hash: revision });
            } catch (err) {
                if (this.followed(workspace, path, snapshot, revision, err)) return;
                this.fail(key, seq, failureOf(path, err), isPermanentPageError(err));
                console.error(`Data.bindPaged: key search failed for ${key}:`, err);
                return;
            }
            if (!this.pinnedTo(snapshot, revision)) return;
            this.settle(key, seq, (e) => {
                e.status = "loaded";
                e.range = range;
                delete e.error;
            });
        })();
        return entry;
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
                    const entry = this.ensureWindow(
                        sourceType, workspace, path, this.snapshotOf(workspace, path), revision, offset, limit, selector, key,
                    );
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
            DataPagedPrimitives.seek.implement((_sourceType: EastTypeValue) =>
                (pathArg: unknown, indexArg: unknown, joinArg: unknown, queryArg: unknown) => {
                    const workspace = this.resolveWorkspace();
                    const path = pathArg as TreePath;
                    const revision = this.revisionFor(workspace, path);
                    if (typeof revision !== "string") return none;
                    const selector = toSelector(indexArg, joinArg);
                    const query = toFindQuery(queryArg, selector);
                    const key = pagedSeekKey(workspace, path, revision, query, selector);
                    this.track(key);
                    const entry = this.ensureSeek(workspace, path, this.snapshotOf(workspace, path), revision, query, key);
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
                        const snapshot = this.snapshotOf(workspace, path);
                        if (target.type === "some") this.moveTo(workspace, path, snapshot, target.value);
                        else this.find(workspace, path, snapshot);
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

/** Install the paging API adapter + workspace — called by the React provider
 *  on mount (or by a test/showcase harness). */
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
