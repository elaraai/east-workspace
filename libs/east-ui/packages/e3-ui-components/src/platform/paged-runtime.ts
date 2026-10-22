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
 * once a search. Windows re-fire as each lands.
 *
 * A window a landed one covers is never fetched (#1217): its rows are that
 * window's, at the same revision, so the read is answered from it and keeps
 * the answer in its own channel. A sheet reads an entry it is about to draft
 * as a one-element window, beside the windows it draws.
 *
 * Several reads of one source are asked as one request when a reader asks
 * them together (#1351): `seekAll` a batch of key searches (`findKeys`),
 * `rowsAll` the rows of several keys of a Dict, `runsAll` the entries of
 * several runs. A batch is one request and one channel, which re-fires its
 * readers once. What it answers serves the single reads too: each search's
 * bounds land in that search's own channel, each row is held at its position —
 * a search by its key, or a one-row window at its row, is answered from it —
 * and a window inside one of a runs read's runs is cut from it. A record Slice
 * over a binding the indexed runtime built reads a plan's searches, and a
 * window across several runs, through them.
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
    SortedSet,
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
    parseFor,
    printFor,
    some,
    type EastTypeValue,
    type option,
} from "@elaraai/east";
import { type PlatformFunction, EastTypeType } from "@elaraai/east/internal";
import { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import { bindPagedPinnedPlatformFn, bindPagedPlatformFn, DataPagedPrimitives } from "@elaraai/e3-ui/internal";
import {
    registerReactiveTracker,
    registerPlatformImplementation,
    registerRecordSliceBatches,
} from "@elaraai/east-ui-components/platform";
import {
    datasetGetPage,
    datasetFindKey,
    datasetFindKeys,
    datasetGetRows,
    datasetGetRuns,
    datasetGetStatus,
    datasetPlace,
    datasetWithin,
    DatasetHashMismatchError,
    DATASET_BATCH_MAX,
    type DatasetPage,
    type DatasetPlaceQuery,
    type DatasetPlacement,
    type DatasetWithin,
    type DatasetWithinQuery,
    type DatasetFindQuery,
    type DatasetFindResult,
    type DatasetFindKeysQuery,
    type DatasetFindKeysResult,
    type DatasetKeySearch,
    type DatasetRows,
    type DatasetRowsQuery,
    type DatasetRuns,
    type DatasetRunsQuery,
    type RequestOptions,
} from "@elaraai/e3-api-client";
import { TreePathType, datasetRowsType, type TreePath } from "@elaraai/e3-types";

import { datasetPathToString, type ReactiveDatasetCacheInterface } from "./dataset-store.js";
import { TrackedChannelStore } from "./tracked-channel.js";
import { IndexedPagedRuntime, recordSliceBatchesOf } from "./indexed-paged.js";
import { toFindQuery } from "./find-query.js";

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

/** What a paged handle serves: a dataset, and which of its rows. */
export interface PagedSource {
    /** The dataset's path. */
    readonly path: TreePath;
    /** The rows it serves: the dataset's own, or one of a record's indexes. */
    readonly selector: PagedSelector;
    /** What a window of it decodes as: the dataset's own type, or an index's
     *  window type. */
    readonly type: EastTypeValue;
}

/** One row a read by key answers (#1351): the key, the row the dataset holds
 *  under it or none, and the key's position in the dataset's canonical order —
 *  the row space a window addresses. */
export interface PagedRow {
    readonly key: unknown;
    readonly row: option<unknown>;
    readonly position: number;
}

/** A run of a source's rows: its first row and how many it holds. */
export type PagedRun = readonly [row: number, count: number];

/** A record segment some of a narrowing's rows fall in (#1349). */
export interface PagedPlacedSegment {
    /** The segment's number in the record's manifest. */
    readonly segment: number;
    /** Its first row in the record's order. */
    readonly offset: number;
    /** How many rows it holds. */
    readonly count: number;
    /** How many of the narrowing's rows it holds. */
    readonly rows: number;
}

/** Where a narrowing's runs of an index sit in its record, as far as they are placed (#1349). */
export interface PagedPlacement {
    /** The record segments the placed entries fall in, in the record's order, each with how many it holds. */
    readonly segments: readonly PagedPlacedSegment[];
    /** How many of the runs' entries are placed. */
    readonly placed: number;
    /** How many entries the runs hold. */
    readonly entries: number;
    /** The record's row count. */
    readonly total: number;
    /** Whether every entry is placed: until then, the segments not yet placed hold rows the placement has not counted. */
    readonly complete: boolean;
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
    /** Locate several key queries of one source in one request (#1351), each
     *  as {@link findKey} would, in order. */
    findKeys(workspace: string, path: TreePath, query: DatasetFindKeysQuery): Promise<DatasetFindKeysResult>;
    /** Read the rows a Dict dataset holds under several keys in one request:
     *  each key's row or absence and its position, the first `count` of the
     *  keys the page byte budget reaches. */
    getRows(workspace: string, path: TreePath, query: DatasetRowsQuery): Promise<DatasetRows>;
    /** Read the entries of several runs of a source's rows in one request, in
     *  order: the first `count` of them a page's bounds reach. */
    getRuns(workspace: string, path: TreePath, query: DatasetRunsQuery): Promise<DatasetRuns>;
    /** Place a window of a narrowing's runs of one of a record's indexes in the
     *  record (#1349): how many of the window's entries each record segment
     *  holds, the first `placed` of them a page's bounds reach. */
    place(workspace: string, path: TreePath, query: DatasetPlaceQuery): Promise<DatasetPlacement>;
    /** Ask which of some index entries a narrowing's runs of one of a record's
     *  indexes hold, in one request (#1349). */
    within(workspace: string, path: TreePath, query: DatasetWithinQuery): Promise<DatasetWithin>;
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
        async findKeys(workspace, path, query) {
            return datasetFindKeys(apiUrl, repo, workspace, path, query, getOptions());
        },
        async getRows(workspace, path, query) {
            return datasetGetRows(apiUrl, repo, workspace, path, query, getOptions());
        },
        async getRuns(workspace, path, query) {
            return datasetGetRuns(apiUrl, repo, workspace, path, query, getOptions());
        },
        async place(workspace, path, query) {
            return datasetPlace(apiUrl, repo, workspace, path, query, getOptions());
        },
        async within(workspace, path, query) {
            return datasetWithin(apiUrl, repo, workspace, path, query, getOptions());
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
    /** A landed window's place: its family (the source, its rows and the
     *  revision), its first element's offset, and how many elements it holds —
     *  a window the server trimmed holds fewer than it asked for. A read it
     *  covers is answered from it (#1217). */
    span?: WindowSpan;
    /** A landed runs read's place (#1351): its family, and where each run's
     *  entries sit in it — a read inside one of its runs is answered from it,
     *  as from a window's span. */
    runSpans?: RunSpans;
    /** Total elements in the source, learned from any landed window. */
    total?: number;
    /** Where a key query landed — the answer on a seek channel. */
    range?: DatasetFindResult;
    /** A rows read's answer, every key asked's row in order — the answer on a
     *  rows batch's channel (#1351). */
    rows?: readonly PagedRow[];
    /** A placement's answer so far — the answer on a placement's channel
     *  (#1349), set as each of its windows lands. */
    placement?: PagedPlacement;
    /** Why the last attempt failed — what a read of the channel throws. */
    error?: string;
    /** When the last attempt failed, so a retry can be rate-limited. */
    failedAtMs?: number;
    /** No retry can help while the source holds the same content. */
    permanent?: boolean;
}

/** Where a landed window sits in its source's row space (#1217). */
interface WindowSpan {
    /** The window's family — {@link pagedWindowFamily}: a read of another
     *  family is never answered from it. */
    readonly family: string;
    /** Its first element's offset. */
    readonly offset: number;
    /** How many elements it holds. */
    readonly count: number;
}

/** Where a landed runs read's entries sit in its source's row space (#1351). */
interface RunSpans {
    /** The read's family — {@link pagedWindowFamily}. */
    readonly family: string;
    /** Each run, ascending: its first row, how many entries it holds, and
     *  where they start in the read's window. */
    readonly runs: readonly { readonly row: number; readonly count: number; readonly at: number }[];
}

/**
 * Where a read of `[offset, offset + limit)` of a family starts in a landed
 * window that holds all of it: by the window's span, or inside one of a runs
 * read's runs (#1217, #1351).
 *
 * @param entry - A landed window's channel
 * @param family - The read's family
 * @param offset - The read's first element
 * @param limit - How many elements it asks for
 * @returns The element of the window it starts at, or `undefined` when the window holds none of it whole
 */
function coveringAt(entry: PageEntry, family: string, offset: number, limit: number): number | undefined {
    const span = entry.span;
    if (span !== undefined) {
        return span.family === family && span.offset <= offset && offset + limit <= span.offset + span.count ? offset - span.offset : undefined;
    }
    const spans = entry.runSpans;
    if (spans === undefined || spans.family !== family) return undefined;
    // The last run starting at or before the read's offset.
    let lo = 0;
    let hi = spans.runs.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (spans.runs[mid]!.row <= offset) lo = mid + 1;
        else hi = mid;
    }
    const run = spans.runs[lo - 1];
    return run !== undefined && offset + limit <= run.row + run.count ? run.at + (offset - run.row) : undefined;
}

/** Searches of one source's rows launched in one synchronous turn (#1360). */
interface SearchBurst {
    /** Whether a search may still join: until the turn that opened it ends. */
    open: boolean;
    /** Members still in flight. */
    pending: number;
    /** The channels its members answered, landed or failed, to re-fire once
     *  the last is done. */
    readonly answered: string[];
}

/**
 * How many elements a decoded window holds, by the source's collection type;
 * `undefined` for a type a window is not cut from.
 *
 * @param sourceType - The source's type: an Array, Dict or Set
 * @param window - A decoded window of it
 * @returns The element count
 */
function elementCount(sourceType: EastTypeValue, window: unknown): number | undefined {
    switch (sourceType.type) {
        case "Array": return (window as readonly unknown[]).length;
        case "Dict": return (window as ReadonlyMap<unknown, unknown>).size;
        case "Set": return (window as ReadonlySet<unknown>).size;
        default: return undefined;
    }
}

/**
 * Elements `[from, from + count)` of a decoded window, as a value of the
 * source's own type: an Array's slice, or a Dict's or a Set's entries in
 * their key order, under the key type's own comparator (#1217).
 *
 * @param sourceType - The source's type: an Array, Dict or Set
 * @param window - A decoded window of it
 * @param from - The first element, counted from the window's start
 * @param count - How many elements
 * @returns The cut, or `undefined` for a type a window is not cut from
 */
function cutWindow(sourceType: EastTypeValue, window: unknown, from: number, count: number): unknown {
    switch (sourceType.type) {
        case "Array": return (window as readonly unknown[]).slice(from, from + count);
        case "Dict": {
            const keyType = fromEastTypeValue((sourceType.value as { key: EastTypeValue }).key);
            return new SortedMap([...(window as ReadonlyMap<unknown, unknown>)].slice(from, from + count), compareFor(keyType));
        }
        case "Set": {
            const elementType = fromEastTypeValue(sourceType.value as EastTypeValue);
            return new SortedSet([...(window as ReadonlySet<unknown>)].slice(from, from + count), compareFor(elementType));
        }
        default: return undefined;
    }
}

/** What every bind of one dataset shares: the content its reads are pinned to. */
interface Snapshot {
    /** The dataset's revision channel, as snapshots are keyed — the channel
     *  every read of the dataset tracks. */
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
    /** The rows reads by key have held at this revision, by the family of the
     *  rows they read (#1351): a search by one of their keys, and a one-row
     *  page at one's position, answer from them. Dropped when it moves. */
    readonly held: Map<string, HeldRows>;
    /** Which entry keys a narrowing's runs hold, as membership reads have
     *  answered them at this revision, by the runs (#1349). Dropped when it
     *  moves, with what each batch kept for its reader. */
    readonly within: Map<string, HeldWithin>;
    /** Stops following the dataset; `undefined` while it is not followed —
     *  nothing reads it, or no adapter is installed. */
    unwatch: (() => void) | undefined;
}

/** The rows reads by key have held at one revision, of one family (#1351). */
interface HeldRows {
    /** Every key answered: its row or absence, and its position. */
    readonly byKey: SortedMap<unknown, PagedRow>;
    /** The rows the dataset holds, by their position. */
    readonly byPosition: Map<number, PagedRow>;
}

/** The most rows a family holds from reads by key; past it, what it held goes
 *  and the newest read's rows are held alone. */
const MAX_HELD_ROWS = 20_000;

/** How many windows of a placement are asked at once (#1349). */
const PLACE_CONCURRENCY = 4;

/** The most entry keys one membership read asks of (#1349): a reader asks of
 *  more in parts. */
export const MAX_WITHIN_KEYS = 20_000;

/** The most entry keys whose membership one narrowing's runs hold answered;
 *  past it, the least recently read go — but never one a batch keeps for its
 *  reader ({@link HeldWithin}), so the answers a read waits on are held when
 *  it reads again, whatever other readers' answers land meanwhile. */
const MAX_HELD_WITHIN = 2 * MAX_WITHIN_KEYS;

/** The most membership batches of one narrowing's runs that keep keys for
 *  their readers at once; past it, the oldest batch's keys are trimmed as any
 *  are. What batches keep is bounded by it, so the answers held never pass
 *  {@link MAX_HELD_WITHIN} by more than the keys of this many batches. */
const MAX_PINNING_BATCHES = 16;

/**
 * Which entry keys one narrowing's runs hold, as membership reads answered
 * them at one revision (#1349), and what each batch keeps for its reader.
 *
 * A batch keeps every key its reader asks of — those already held when it
 * launches, and those its answer brings — until a read that holds every key
 * it asks of reads them. So however many readers' answers land between a
 * batch's landing and its reader's next read, trimming to
 * {@link MAX_HELD_WITHIN} never takes an answer the reader is waiting to
 * read, and each reader reads its answers after one batch: no reader's
 * landing undoes another's.
 */
interface HeldWithin {
    /** Each entry key's answer, the least recently read first: a read moves the keys it reads to the end. */
    readonly answers: Map<string, boolean>;
    /** The batches that keep each key, until a read reads it. */
    readonly pins: Map<string, Set<string>>;
    /** Each batch keeping keys, the oldest first, with the keys its reader asks of. */
    readonly batches: Map<string, readonly string[]>;
}

/** The membership answers one narrowing's runs hold, made empty on first use. */
function heldWithinOf(snapshot: Snapshot, family: string): HeldWithin {
    let held = snapshot.within.get(family);
    if (held === undefined) {
        held = { answers: new Map(), pins: new Map(), batches: new Map() };
        snapshot.within.set(family, held);
    }
    return held;
}

/**
 * Keep keys for a batch until its reader reads them. Past
 * {@link MAX_PINNING_BATCHES}, the oldest batch keeps its keys no longer.
 *
 * @param held - The answers one narrowing's runs hold
 * @param batch - The batch's channel key
 * @param keys - Every key its reader asks of
 * @param kept - The keys it keeps now: those held as it launches, or those its answer brings
 */
function keepWithin(held: HeldWithin, batch: string, keys: readonly string[], kept: Iterable<string>): void {
    if (!held.batches.has(batch)) held.batches.set(batch, keys);
    for (const key of kept) {
        let by = held.pins.get(key);
        if (by === undefined) {
            by = new Set();
            held.pins.set(key, by);
        }
        by.add(batch);
    }
    while (held.batches.size > MAX_PINNING_BATCHES) releaseWithin(held, held.batches.keys().next().value!);
}

/** A batch keeps its keys no longer: they are trimmed as any are, unless another batch keeps them. */
function releaseWithin(held: HeldWithin, batch: string): void {
    const keys = held.batches.get(batch);
    if (keys === undefined) return;
    held.batches.delete(batch);
    for (const key of keys) {
        const by = held.pins.get(key);
        if (by === undefined) continue;
        by.delete(batch);
        if (by.size === 0) held.pins.delete(key);
    }
}

/**
 * A read that holds every key it asks of has read them: each moves to the
 * end, the most recently read, and no batch keeps it any longer — however
 * many kept it, since the read answers every reader asking of it alike.
 */
function readWithin(held: HeldWithin, keys: readonly string[]): void {
    for (const key of keys) {
        const answer = held.answers.get(key);
        if (answer === undefined) continue;
        held.answers.delete(key);
        held.answers.set(key, answer);
        held.pins.delete(key);
    }
    trimWithin(held);
}

/** Past {@link MAX_HELD_WITHIN}, the least recently read answers go — but none a batch keeps. */
function trimWithin(held: HeldWithin): void {
    if (held.answers.size <= MAX_HELD_WITHIN) return;
    for (const key of held.answers.keys()) {
        if (held.answers.size <= MAX_HELD_WITHIN) break;
        if (!held.pins.has(key)) held.answers.delete(key);
    }
}

/**
 * The runs left of `runs` once their first `taken` entries are in hand.
 *
 * @param runs - The runs asked
 * @param taken - How many of their entries an answer held
 * @returns The rest, the first one cut where the answer ended
 */
function runsAfter(runs: readonly PagedRun[], taken: number): PagedRun[] {
    const rest: PagedRun[] = [];
    let skip = taken;
    for (const [row, count] of runs) {
        if (skip >= count) { skip -= count; continue; }
        rest.push([row + skip, count - skip]);
        skip = 0;
    }
    return rest;
}

/**
 * The parts of one window read in turn, as one value of the source's type: an
 * Array's items one after another, a Set's or a Dict's in their key order.
 *
 * @param sourceType - The source's type: an Array, a Set or a Dict
 * @param parts - The decoded parts, in order
 * @returns The window
 */
function joinWindows(sourceType: EastTypeValue, parts: readonly unknown[]): unknown {
    if (parts.length === 1) return parts[0];
    switch (sourceType.type) {
        case "Dict": {
            const keyType = fromEastTypeValue((sourceType.value as { key: EastTypeValue }).key);
            return new SortedMap(parts.flatMap((part) => [...(part as ReadonlyMap<unknown, unknown>)]), compareFor(keyType));
        }
        case "Set": {
            const elementType = fromEastTypeValue(sourceType.value as EastTypeValue);
            return new SortedSet(parts.flatMap((part) => [...(part as ReadonlySet<unknown>)]), compareFor(elementType));
        }
        default: return parts.flatMap((part) => [...(part as readonly unknown[])]);
    }
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

/** The family a window belongs to: its dataset, the rows it serves and its
 *  revision — every window one landed window can answer for (#1217). */
function pagedWindowFamily(workspace: string, path: TreePath, revision: string, selector: PagedSelector): string {
    return `paged:${workspace}:${datasetPathToString(path)}${selectorKey(selector)}@${revision}`;
}

/** Tracked-channel key for one window of one revision. */
export function pagedWindowKey(
    workspace: string, path: TreePath, revision: string, offset: number, limit: number, selector: PagedSelector = NO_INDEX,
): string {
    return `${pagedWindowFamily(workspace, path, revision, selector)}#${offset}+${limit}`;
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
    return `paged:${workspace}:${datasetPathToString(path)}${selectorKey(selector)}@${revision}#seek:${seekQueryText(query)}`;
}

/** A key query's form and literals, as a channel's key names it. */
function seekQueryText(query: DatasetFindQuery): string {
    return "key" in query
        ? `k=${query.key}`
        : "fields" in query
            ? `f=${query.fields.join("\u0000")}|p=${query.prefix ?? ""}`
            : "prefix" in query
                ? `p=${query.prefix}`
                : `r=${(query.from ?? []).join("\u0000")}|${(query.to ?? []).join("\u0000")}`;
}

/**
 * Tracked-channel key for one batch of reads of one revision (#1351): several
 * key searches, the rows of several keys, or the entries of several runs, each
 * batch by what it asks.
 *
 * @param workspace - The workspace
 * @param path - The dataset's path
 * @param revision - The revision the batch reads
 * @param selector - The rows it reads
 * @param kind - What it reads
 * @param parts - What it asks, each in its channel text
 * @returns The key
 */
export function pagedBatchKey(
    workspace: string, path: TreePath, revision: string, selector: PagedSelector, kind: "seekAll" | "rows" | "runs" | "place" | "within", parts: readonly string[],
): string {
    return `${pagedWindowFamily(workspace, path, revision, selector)}#${kind}:${parts.join("\u0001")}`;
}

/** The family of a narrowing's membership answers (#1349): the runs of one
 *  of a record's indexes, at one revision. */
function withinFamily(workspace: string, path: TreePath, revision: string, selector: PagedSelector, runs: readonly PagedRun[]): string {
    return `${pagedWindowFamily(workspace, path, revision, selector)}#within:${runs.map(([row, count]) => `${row}+${count}`).join(",")}`;
}

/** A key query as a batch's wire takes it: its form alone, the index and the
 *  pin being the batch's. */
function searchOf(query: DatasetFindQuery): DatasetKeySearch {
    const { index: _index, hash: _hash, ...search } = query;
    return search as DatasetKeySearch;
}

// A search from East's form to e3's wire, in a module of its own so the
// indexed runtime, which this module builds, reaches it without a cycle.
export { toFindQuery } from "./find-query.js";

/**
 * Encapsulates all `Data.bindPaged` runtime state. The module-level
 * {@link defaultPagedRuntime} instance backs the registered platform; tests
 * construct their own for isolation.
 */
export class PagedRuntime extends TrackedChannelStore<PageEntry> {
    private api: PagedApi | null = null;
    private workspace: string | null = null;
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

    /** Loaded window keys in least-recently-READ order (a Map preserves
     *  insertion order; a read re-inserts). Bounds the decoded-window cache. */
    private readonly loadedWindows = new Map<string, true>();

    /** Each dataset's snapshot, by workspace and path. */
    private readonly snapshots = new Map<string, Snapshot>();

    /** This turn's open search bursts, by the family of the rows they search. */
    private readonly bursts = new Map<string, SearchBurst>();

    /** Fetches launched so far — the source of every channel's `launchSeq`. */
    private launches = 0;

    /** Each key type's printer and parser, and each landed Dict window's keys
     *  in order — what reads by key look keys up by (#1351). */
    private readonly printers = new WeakMap<EastTypeValue, (key: unknown) => string>();
    private readonly parsers = new WeakMap<EastTypeValue, ReturnType<typeof parseFor>>();
    private readonly keysOfWindows = new WeakMap<object, readonly unknown[]>();

    /** Monotonic clock seam so tests can drive the retry gate. */
    protected now(): number {
        return Date.now();
    }

    protected createEntry(): PageEntry {
        return { status: "idle", launchSeq: 0 };
    }

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

    /** Stop following every dataset, and drop what every snapshot delivered. */
    private reset(): void {
        for (const snapshot of this.snapshots.values()) snapshot.unwatch?.();
        this.snapshots.clear();
        this.clearChannels();
        this.loadedWindows.clear();
        this.bursts.clear();
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

    /** A dataset's snapshot, followed from a read while something reads the
     *  dataset ({@link unsubscribed}) — the read that makes it, or the first
     *  after its readers all let it go. */
    private snapshotOf(workspace: string, path: TreePath): Snapshot {
        const key = pagedRevisionKey(workspace, path);
        let snapshot = this.snapshots.get(key);
        if (snapshot === undefined) {
            snapshot = {
                key,
                revision: undefined,
                moves: 0,
                findSeq: 0,
                finding: false,
                channels: new Set(),
                held: new Map(),
                within: new Map(),
                unwatch: undefined,
            };
            this.snapshots.set(key, snapshot);
        }
        if (snapshot.unwatch === undefined && this.api !== null) {
            const followed = snapshot;
            snapshot.unwatch = this.api.watchRevision(workspace, path, (hash) => this.moveTo(workspace, path, followed, hash));
        }
        return snapshot;
    }

    /**
     * A dataset its readers have all let go stops being followed, so nothing
     * polls for it: every read tracks its revision channel, and a reader lets
     * the channel go as it unmounts. What its snapshot delivered stays, and a
     * read follows it again — moved at the first report if the dataset moved
     * meanwhile.
     */
    protected override unsubscribed(key: string): void {
        const snapshot = this.snapshots.get(key);
        if (snapshot?.unwatch === undefined) return;
        // A reader re-subscribing lets every channel go before it subscribes
        // again: the dataset goes only if nothing reads it once that is done.
        queueMicrotask(() => {
            if (!this.isLive(snapshot) || this.isSubscribed(key)) return;
            snapshot.unwatch?.();
            snapshot.unwatch = undefined;
        });
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
        snapshot.held.clear();
        snapshot.within.clear();
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

    /** Apply a fetch's outcome if the channel still waits on it. Returns
     *  whether it applied. */
    private apply(key: string, seq: number, mutate: (entry: PageEntry) => void): boolean {
        const entry = this.entries.get(key);
        if (entry === undefined || entry.launchSeq !== seq) return false;
        mutate(entry);
        return true;
    }

    /** Apply a fetch's outcome if the channel still waits on it, re-firing the
     *  channel's reads. Returns whether it applied. */
    private settle(key: string, seq: number, mutate: (entry: PageEntry) => void): boolean {
        if (!this.apply(key, seq, mutate)) return false;
        this.notify(key);
        return true;
    }

    /** A failed fetch's outcome: the reason a read will throw. */
    private failure(reason: string, permanent: boolean): (entry: PageEntry) => void {
        return (e) => {
            e.status = "failed";
            e.error = reason;
            e.failedAtMs = this.now();
            e.permanent = permanent;
        };
    }

    /** Settle a fetch as failed, with the reason a read will throw. */
    private fail(key: string, seq: number, reason: string, permanent: boolean): void {
        this.settle(key, seq, this.failure(reason, permanent));
    }

    /**
     * Join this turn's burst of searches of one source's rows (#1360), opening
     * it with the turn's first. It closes as the turn ends.
     *
     * @param family - The rows searched — {@link pagedWindowFamily}
     * @returns The burst
     */
    private joinBurst(family: string): SearchBurst {
        let burst = this.bursts.get(family);
        if (burst === undefined) {
            const opened: SearchBurst = { open: true, pending: 0, answered: [] };
            this.bursts.set(family, opened);
            queueMicrotask(() => {
                opened.open = false;
                if (this.bursts.get(family) === opened) this.bursts.delete(family);
                this.flushBurst(opened);
            });
            burst = opened;
        }
        burst.pending += 1;
        return burst;
    }

    /**
     * A member of a burst is done: answered, or dropped — by a move, or by a
     * newer launch on its channel.
     *
     * @param burst - Its burst
     * @param answered - Its channel, when its answer was applied
     */
    private leaveBurst(burst: SearchBurst, answered: string | undefined): void {
        if (answered !== undefined) burst.answered.push(answered);
        burst.pending -= 1;
        this.flushBurst(burst);
    }

    /** Re-fire every channel a closed burst answered, once its last member is done. */
    private flushBurst(burst: SearchBurst): void {
        if (burst.open || burst.pending > 0 || burst.answered.length === 0) return;
        this.notifyAll(burst.answered.splice(0));
    }

    /**
     * Ask again what failed: an explicit refresh — a Retry — puts every channel
     * of the snapshot that failed for a reason a retry can fix back to `idle`
     * and re-fires its readers, so their next read fetches it at once, not
     * after the retry gap a read alone waits. A permanent failure stays until
     * the source moves; nothing else is dropped.
     *
     * @param snapshot - The source's snapshot
     */
    private rearmFailed(snapshot: Snapshot): void {
        for (const key of snapshot.channels) {
            const entry = this.entries.get(key);
            if (entry === undefined || entry.status !== "failed" || entry.permanent === true) continue;
            entry.status = "idle";
            delete entry.error;
            delete entry.failedAtMs;
            this.notify(key);
        }
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
            delete entry.rows;
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
            const count = elementCount(sourceType, decoded);
            const landed = this.settle(key, seq, (e) => {
                e.status = "loaded";
                e.window = decoded;
                e.total = page.totalElements;
                // Where it sits, by what it holds — a read it covers is answered from it (#1217).
                if (count !== undefined) e.span = { family: pagedWindowFamily(workspace, path, revision, selector), offset, count };
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

    /**
     * Answer a window from a landed one of its family that covers it — the
     * same rows at the same revision (#1217), a window's or one run of a runs
     * read's (#1351): the cut lands in the window's own channel, so it keeps
     * one identity, and nothing is fetched. The channel is the snapshot's, so
     * a move drops the cut with every window.
     *
     * @param sourceType - The source's type
     * @param snapshot - The source's snapshot
     * @param family - The window's family
     * @param offset - The window's first element
     * @param limit - How many elements it asks for
     * @param into - The window's channel, not loaded
     */
    private cutFromCovering(
        sourceType: EastTypeValue, snapshot: Snapshot, family: string, offset: number, limit: number, into: PageEntry,
    ): void {
        for (const key of snapshot.channels) {
            const covering = this.entries.get(key);
            if (covering === undefined || covering === into || covering.status !== "loaded" || covering.window === undefined) continue;
            const from = coveringAt(covering, family, offset, limit);
            if (from === undefined) continue;
            const cut = cutWindow(sourceType, covering.window, from, limit);
            if (cut === undefined) return;
            into.status = "loaded";
            into.window = cut;
            if (covering.total !== undefined) into.total = covering.total;
            into.span = { family, offset, count: limit };
            delete into.error;
            delete into.failedAtMs;
            delete into.permanent;
            // The covering window was read, through its cut.
            this.touchWindow(key);
            return;
        }
    }

    /** Start the pinned fence search for one key query if it is due one,
     *  returning its channel — the seek sibling of {@link ensureWindow}. Its
     *  answer re-fires its channel with the rest of its burst (#1360). */
    private ensureSeek(
        workspace: string,
        path: TreePath,
        snapshot: Snapshot,
        revision: string,
        selector: PagedSelector,
        query: DatasetFindQuery,
        key: string,
    ): PageEntry {
        const entry = this.channel(snapshot, key);
        if (!this.due(entry)) return entry;
        const seq = this.launch(entry);
        const api = this.api;
        const burst = this.joinBurst(pagedWindowFamily(workspace, path, revision, selector));

        void (async () => {
            let answered = false;
            try {
                let range: DatasetFindResult;
                try {
                    if (api === null) throw new Error("no PagedApi installed");
                    range = await api.findKey(workspace, path, { ...query, hash: revision });
                } catch (err) {
                    if (this.followed(workspace, path, snapshot, revision, err)) return;
                    answered = this.apply(key, seq, this.failure(failureOf(path, err), isPermanentPageError(err)));
                    console.error(`Data.bindPaged: key search failed for ${key}:`, err);
                    return;
                }
                if (!this.pinnedTo(snapshot, revision)) return;
                answered = this.apply(key, seq, (e) => {
                    e.status = "loaded";
                    e.range = range;
                    delete e.error;
                });
            } finally {
                // Every way out leaves the burst, so its last member re-fires the rest.
                this.leaveBurst(burst, answered ? key : undefined);
            }
        })();
        return entry;
    }

    // ----- batches (#1351) -------------------------------------------------

    /**
     * Several key searches of one source's rows, read as ONE request and ONE
     * channel (#1351): each query's bounds, as `seek` answers them, in the order
     * asked — `none` while any is in flight.
     *
     * @remarks
     * A query the runtime already holds — one a search asked, or an earlier
     * batch answered — is answered from its channel; the rest go in one
     * `findKeys` request (one for each {@link DATASET_BATCH_MAX} of them), whose
     * readers track the batch's one channel. As the answer lands, each query's
     * bounds go into its own channel, so a search asked later answers from it,
     * and the batch's channel re-fires once, with every reader waiting on one of
     * its queries.
     *
     * @param source - The rows searched: a dataset's own, or one of a record's indexes
     * @param queries - The searches, as e3's wire takes them; their index is the source's
     * @returns Each search's bounds, in order, once every one has landed
     * @throws The batch's failure, until a read after the retry gap asks again
     */
    seekAll(source: PagedSource, queries: readonly DatasetFindQuery[]): option<DatasetFindResult[]> {
        const workspace = this.resolveWorkspace();
        const { path, selector } = source;
        const revision = this.revisionFor(workspace, path);
        if (typeof revision !== "string") return none;
        const snapshot = this.snapshotOf(workspace, path);
        const keys = queries.map((query) => pagedSeekKey(workspace, path, revision, query, selector));
        const results: DatasetFindResult[] = new Array<DatasetFindResult>(queries.length);
        const missing: number[] = [];
        for (const [i, key] of keys.entries()) {
            const entry = this.entries.get(key);
            if (entry?.status === "loaded" && entry.range !== undefined) results[i] = entry.range;
            else missing.push(i);
        }
        if (missing.length === 0) return some(results);
        const batchKey = pagedBatchKey(workspace, path, revision, selector, "seekAll", queries.map(seekQueryText));
        this.track(batchKey);
        const batch = this.channel(snapshot, batchKey);
        // Landed, and a query's channel lost since: it is asked again.
        if (batch.status === "loaded") batch.status = "idle";
        if (this.due(batch)) {
            this.launchSeekBatch(workspace, path, snapshot, revision, selector, batchKey,
                missing.map((i) => ({ query: queries[i]!, key: keys[i]! })));
        }
        return this.answer<DatasetFindResult[]>(batch, undefined);
    }

    /** Launch a batch's key searches: one request for each
     *  {@link DATASET_BATCH_MAX} of them, the answers landing together. */
    private launchSeekBatch(
        workspace: string,
        path: TreePath,
        snapshot: Snapshot,
        revision: string,
        selector: PagedSelector,
        batchKey: string,
        asked: readonly { query: DatasetFindQuery; key: string }[],
    ): void {
        const seq = this.launch(this.channel(snapshot, batchKey));
        const api = this.api;
        void (async () => {
            const answers: DatasetFindResult[] = [];
            try {
                if (api === null) throw new Error("no PagedApi installed");
                for (let at = 0; at < asked.length; at += DATASET_BATCH_MAX) {
                    const { results, hash } = await api.findKeys(workspace, path, {
                        queries: asked.slice(at, at + DATASET_BATCH_MAX).map(({ query }) => searchOf(query)),
                        hash: revision,
                        ...(selector.index !== null && { index: selector.index }),
                    });
                    for (const result of results) answers.push({ ...result, hash });
                }
            } catch (err) {
                if (this.followed(workspace, path, snapshot, revision, err)) return;
                this.fail(batchKey, seq, failureOf(path, err), isPermanentPageError(err));
                console.error(`Data.bindPaged: key searches failed for ${batchKey}:`, err);
                return;
            }
            if (!this.pinnedTo(snapshot, revision)) return;
            if (answers.length !== asked.length) {
                this.fail(batchKey, seq, `Data.bindPaged: ${datasetPathToString(path)}: ${asked.length} key searches were asked, and ${answers.length} answered`, true);
                return;
            }
            if (!this.apply(batchKey, seq, (e) => { e.status = "loaded"; delete e.error; })) return;
            for (const [i, { key }] of asked.entries()) {
                const entry = this.channel(snapshot, key);
                entry.status = "loaded";
                entry.range = answers[i]!;
                delete entry.error;
            }
            this.notifyAll([batchKey, ...asked.map(({ key }) => key)]);
        })();
    }

    /**
     * The rows a Dict source holds under several keys, read as ONE request and
     * ONE channel (#1351): each key's row, or its absence, and its position in
     * the source's canonical order, in the order asked — `none` while the read
     * is in flight.
     *
     * @remarks
     * A key the runtime already holds — a row an earlier read by key answered,
     * or a key a landed window of the same rows holds — is answered from what it
     * holds, and the rest go in one rows request: the server holds an answer to
     * its byte budget, and what it did not reach is asked again until every key
     * is answered. Each row is held at its position, so a later read by its key
     * — a search by the key, then a one-row page at its row — answers from it,
     * with no request.
     *
     * @param source - A Dict dataset's own rows
     * @param keys - The keys, as East values of the key type
     * @returns Each key's row, in order, once every one is known
     * @throws The read's failure, until a read after the retry gap asks again;
     *   at once, for a source that is not a Dict's own rows
     */
    rowsAll(source: PagedSource, keys: readonly unknown[]): option<readonly PagedRow[]> {
        if (source.selector.index !== null || source.type.type !== "Dict") {
            throw new Error("Data.bindPaged: a read of rows by key reads a Dict dataset's own rows, never an index's or another collection's");
        }
        const workspace = this.resolveWorkspace();
        const { path, selector } = source;
        const revision = this.revisionFor(workspace, path);
        if (typeof revision !== "string") return none;
        const snapshot = this.snapshotOf(workspace, path);
        const keyType = (source.type.value as { key: EastTypeValue }).key;
        const literals = keys.map(this.printerOf(keyType));
        const batchKey = pagedBatchKey(workspace, path, revision, selector, "rows", literals);
        this.track(batchKey);
        const batch = this.channel(snapshot, batchKey);
        if (batch.status === "loaded" && batch.rows !== undefined) {
            this.touchWindow(batchKey);
            return some(batch.rows);
        }
        const family = pagedWindowFamily(workspace, path, revision, selector);
        const held = this.heldRowsOf(snapshot, family, keyType);
        const known = keys.map((key) => held.byKey.get(key) ?? this.rowInWindows(snapshot, family, keyType, key));
        if (known.every((row): row is PagedRow => row !== undefined)) {
            // Every key is held already: the answer is what is held.
            batch.status = "loaded";
            batch.rows = known;
            this.touchWindow(batchKey);
            return some(known);
        }
        if (this.due(batch)) this.launchRowsBatch(workspace, path, snapshot, revision, source.type, batchKey, literals, known);
        return this.answer(batch, batch.rows);
    }

    /** Launch a rows read for the keys not already held, asking again for what
     *  each answer's budget did not reach. */
    private launchRowsBatch(
        workspace: string,
        path: TreePath,
        snapshot: Snapshot,
        revision: string,
        sourceType: EastTypeValue,
        batchKey: string,
        literals: readonly string[],
        known: readonly (PagedRow | undefined)[],
    ): void {
        const seq = this.launch(this.channel(snapshot, batchKey));
        const api = this.api;
        const { key: keyType, value: rowType } = sourceType.value as { key: EastTypeValue; value: EastTypeValue };
        const decode = decodeBeast2For(datasetRowsType(fromEastTypeValue(keyType), fromEastTypeValue(rowType))) as
            (bytes: Uint8Array) => { key: unknown; row: option<unknown>; position: bigint }[];
        void (async () => {
            const rows = [...known];
            const asked = rows.flatMap((row, i) => (row === undefined ? [i] : []));
            try {
                if (api === null) throw new Error("no PagedApi installed");
                for (let next = 0; next < asked.length;) {
                    const chunk = asked.slice(next, next + DATASET_BATCH_MAX);
                    const answer = await api.getRows(workspace, path, { keys: chunk.map((i) => literals[i]!), hash: revision });
                    const decoded = decode(answer.data);
                    if (answer.count < 1 || decoded.length !== answer.count) {
                        throw new Error(`a read of ${chunk.length} rows by key answered ${decoded.length}, and said ${answer.count}`);
                    }
                    for (const [n, entry] of decoded.entries()) {
                        rows[chunk[n]!] = { key: entry.key, row: entry.row, position: Number(entry.position) };
                    }
                    next += answer.count;
                }
            } catch (err) {
                if (this.followed(workspace, path, snapshot, revision, err)) return;
                this.fail(batchKey, seq, failureOf(path, err), isPermanentPageError(err));
                console.error(`Data.bindPaged: read by key failed for ${batchKey}:`, err);
                return;
            }
            if (!this.pinnedTo(snapshot, revision)) return;
            const answered = rows as PagedRow[];
            if (!this.apply(batchKey, seq, (e) => { e.status = "loaded"; e.rows = answered; delete e.error; })) return;
            this.hold(snapshot, pagedWindowFamily(workspace, path, revision, NO_INDEX), keyType, answered);
            this.touchWindow(batchKey);
            this.notify(batchKey);
        })();
    }

    /**
     * The entries of several runs of a source's rows, read as ONE request and
     * ONE channel (#1351): one window of the source's type holding exactly the
     * runs' entries, in order — `none` while the read is in flight.
     *
     * @remarks
     * The server holds an answer to a page's bounds, and the runs' rest is asked
     * again until every entry has landed, the parts joined in order. The window
     * is kept as a landed window is, bounded with them, and a window of the same
     * rows inside one of its runs is answered from it, as from a landed window
     * that covers it (#1217).
     *
     * @param source - The rows read: a dataset's own, or one of a record's
     *   indexes, joined as its selector says
     * @param runs - The runs: ascending, disjoint, each inside the source
     * @returns The window, once every entry has landed
     * @throws The read's failure, until a read after the retry gap asks again
     */
    runsAll(source: PagedSource, runs: readonly PagedRun[]): option<unknown> {
        const workspace = this.resolveWorkspace();
        const { path, selector } = source;
        const revision = this.revisionFor(workspace, path);
        if (typeof revision !== "string") return none;
        const snapshot = this.snapshotOf(workspace, path);
        const batchKey = pagedBatchKey(workspace, path, revision, selector, "runs", runs.map(([row, count]) => `${row}+${count}`));
        this.track(batchKey);
        const batch = this.channel(snapshot, batchKey);
        if (batch.status === "loaded" && batch.window !== undefined) {
            this.touchWindow(batchKey);
            return some(batch.window);
        }
        if (this.due(batch)) this.launchRunsBatch(workspace, path, snapshot, revision, source, batchKey, runs);
        return this.answer(batch, batch.window);
    }

    /** Launch a runs read, asking again for the entries each answer's bounds
     *  did not reach. */
    private launchRunsBatch(
        workspace: string,
        path: TreePath,
        snapshot: Snapshot,
        revision: string,
        source: PagedSource,
        batchKey: string,
        runs: readonly PagedRun[],
    ): void {
        const seq = this.launch(this.channel(snapshot, batchKey));
        const api = this.api;
        const { selector } = source;
        const decode = decodeBeast2For(source.type);
        void (async () => {
            const parts: unknown[] = [];
            try {
                if (api === null) throw new Error("no PagedApi installed");
                for (let rest: PagedRun[] = [...runs]; rest.length > 0;) {
                    const chunk = rest.slice(0, DATASET_BATCH_MAX);
                    const answer = await api.getRuns(workspace, path, {
                        runs: chunk, hash: revision,
                        ...(selector.index !== null && { index: selector.index, join: selector.join }),
                    });
                    const part = decode(answer.data);
                    if (answer.count < 1 || elementCount(source.type, part) !== answer.count) {
                        throw new Error(`a read of runs answered ${elementCount(source.type, part)} entries, and said ${answer.count}`);
                    }
                    parts.push(part);
                    rest = [...runsAfter(chunk, answer.count), ...rest.slice(DATASET_BATCH_MAX)];
                }
            } catch (err) {
                if (this.followed(workspace, path, snapshot, revision, err)) return;
                this.fail(batchKey, seq, failureOf(path, err), isPermanentPageError(err));
                console.error(`Data.bindPaged: read of runs failed for ${batchKey}:`, err);
                return;
            }
            if (!this.pinnedTo(snapshot, revision)) return;
            const window = joinWindows(source.type, parts);
            // Where each run's entries sit, so a read inside one is answered from them.
            let at = 0;
            const spans = runs.map(([row, count]) => { const span = { row, count, at }; at += count; return span; });
            const runSpans: RunSpans = { family: pagedWindowFamily(workspace, path, revision, selector), runs: spans };
            if (!this.apply(batchKey, seq, (e) => { e.status = "loaded"; e.window = window; e.runSpans = runSpans; delete e.error; })) return;
            this.touchWindow(batchKey);
            this.notify(batchKey);
        })();
    }

    /**
     * Where a narrowing's runs of one of a record's indexes sit in the record
     * (#1349): how many of the runs' entries each record segment holds, placed
     * a window at a time and drawn as the windows land.
     *
     * @remarks
     * The first window learns how many entries the server places in one, and
     * the rest are asked {@link PLACE_CONCURRENCY} at a time from there; a
     * window placed short leaves the rest of it to ask again. Runs past a
     * request's {@link DATASET_BATCH_MAX} are placed a group at a time. A
     * narrowing's runs name each row once, so the windows' placements add up,
     * segment by segment. The channel re-fires as each window lands, its
     * placement `complete` once the last has.
     *
     * @param source - One of a record's indexes, the runs' rows
     * @param runs - The narrowing's runs: ascending, disjoint, each inside the index
     * @returns What is placed so far, once the first window has landed
     * @throws The placement's failure, until a read after the retry gap asks again;
     *   at once, for a source that is no record's index
     */
    placeAll(source: PagedSource, runs: readonly PagedRun[]): option<PagedPlacement> {
        const index = source.selector.index;
        if (index === null) throw new Error("Data.bindPaged: a placement places runs of one of a record's indexes");
        const workspace = this.resolveWorkspace();
        const { path, selector } = source;
        const revision = this.revisionFor(workspace, path);
        if (typeof revision !== "string") return none;
        const snapshot = this.snapshotOf(workspace, path);
        const batchKey = pagedBatchKey(workspace, path, revision, selector, "place", runs.map(([row, count]) => `${row}+${count}`));
        this.track(batchKey);
        const batch = this.channel(snapshot, batchKey);
        if (this.due(batch)) this.launchPlacement(workspace, path, snapshot, revision, index, batchKey, runs);
        if (batch.status === "failed") return this.answer<PagedPlacement>(batch, undefined);
        return batch.placement === undefined ? none : some(batch.placement);
    }

    /** Launch a placement: its windows, {@link PLACE_CONCURRENCY} at a time,
     *  each answer added in as it lands. */
    private launchPlacement(
        workspace: string,
        path: TreePath,
        snapshot: Snapshot,
        revision: string,
        index: string,
        batchKey: string,
        runs: readonly PagedRun[],
    ): void {
        const seq = this.launch(this.channel(snapshot, batchKey));
        const api = this.api;
        const entries = runs.reduce((sum, [, count]) => sum + count, 0);
        void (async () => {
            const held = new Map<number, PagedPlacedSegment>();
            let placed = 0;
            let total = 0;
            /** Add a window's answer in, and re-fire the placement's readers. */
            const land = (answer: DatasetPlacement): boolean => {
                for (const segment of answer.segments) {
                    const known = held.get(segment.segment);
                    held.set(segment.segment, known === undefined ? { ...segment } : { ...known, rows: known.rows + segment.rows });
                }
                placed += answer.placed;
                total = answer.totalElements;
                const placement: PagedPlacement = {
                    segments: [...held.values()].sort((a, b) => a.segment - b.segment), placed, entries, total, complete: placed === entries,
                };
                return this.settle(batchKey, seq, (e) => {
                    e.placement = placement;
                    if (placement.complete) { e.status = "loaded"; delete e.error; }
                });
            };
            try {
                if (api === null) throw new Error("no PagedApi installed");
                // No runs are one group, placing nothing, whose answer says how many rows the record holds.
                const groups: (readonly PagedRun[])[] = [];
                for (let at = 0; at < runs.length; at += DATASET_BATCH_MAX) groups.push(runs.slice(at, at + DATASET_BATCH_MAX));
                if (groups.length === 0) groups.push([]);
                for (const group of groups) {
                    const groupEntries = group.reduce((sum, [, count]) => sum + count, 0);
                    // The first window says how many entries a window places.
                    const first = await api.place(workspace, path, { index, runs: group, offset: 0, hash: revision });
                    if (!this.pinnedTo(snapshot, revision) || !land(first)) return;
                    if (first.placed < 1 && groupEntries > 0) throw new Error("a placement placed no entry of runs that hold some");
                    const width = first.placed;
                    // What is left to place, as stretches of the runs' entries.
                    const left: [number, number][] = first.placed < groupEntries ? [[first.placed, groupEntries]] : [];
                    while (left.length > 0) {
                        const asked: [number, number][] = [];
                        while (asked.length < PLACE_CONCURRENCY && left.length > 0) {
                            const [from, to] = left[0]!;
                            const until = Math.min(to, from + width);
                            asked.push([from, until]);
                            if (until === to) left.shift();
                            else left[0] = [until, to];
                        }
                        const answers = await Promise.all(asked.map(([from, until]) =>
                            api.place(workspace, path, { index, runs: group, offset: from, limit: until - from, hash: revision })));
                        if (!this.pinnedTo(snapshot, revision)) return;
                        for (const [k, answer] of answers.entries()) {
                            const [from, until] = asked[k]!;
                            if (answer.placed < 1) throw new Error("a placement placed no entry of a window that holds some");
                            if (!land(answer)) return;
                            // A window placed short leaves the rest of it to ask again.
                            if (from + answer.placed < until) left.unshift([from + answer.placed, until]);
                        }
                    }
                }
            } catch (err) {
                if (this.followed(workspace, path, snapshot, revision, err)) return;
                this.fail(batchKey, seq, failureOf(path, err), isPermanentPageError(err));
                console.error(`Data.bindPaged: placement failed for ${batchKey}:`, err);
            }
        })();
    }

    /**
     * Which of some index entries a narrowing's runs of one of a record's
     * indexes hold (#1349): for each entry key, whether it lies in one of the
     * runs, in the order asked — `none` while any is in flight.
     *
     * @remarks
     * Each key's answer is held at the revision, by the runs, so a key asked
     * again — a segment drawn again, a window panned back — is answered from
     * what is held, and only the keys not held go in a request: one for each
     * {@link DATASET_BATCH_MAX} keys, and for each as many runs, a key in any
     * group of the runs being in them. Past {@link MAX_HELD_WITHIN} answers the
     * least recently read go, but a batch keeps every key its reader asks of
     * until the reader has read them ({@link HeldWithin}): several readers whose
     * keys together pass the cap each read theirs after one batch, and a reader
     * whose answers went since asks again for those alone.
     *
     * @param source - One of a record's indexes, the runs' rows
     * @param runs - The narrowing's runs: ascending, disjoint, each inside the index
     * @param keys - `.east` literals of the index's entry keys, `(ik=…, k=…)`: at
     *   most {@link MAX_WITHIN_KEYS} in one read
     * @returns Whether each key lies in one of the runs, once every one is known
     * @throws The read's failure, until a read after the retry gap asks again;
     *   at once, for a source that is no record's index, or more keys than a read takes
     */
    withinAll(source: PagedSource, runs: readonly PagedRun[], keys: readonly string[]): option<readonly boolean[]> {
        const index = source.selector.index;
        if (index === null) throw new Error("Data.bindPaged: a membership read asks of runs of one of a record's indexes");
        if (keys.length > MAX_WITHIN_KEYS) {
            throw new Error(`Data.bindPaged: a membership read asks of ${MAX_WITHIN_KEYS} entry keys at most; ask of ${keys.length} in parts`);
        }
        const workspace = this.resolveWorkspace();
        const { path, selector } = source;
        const revision = this.revisionFor(workspace, path);
        if (typeof revision !== "string") return none;
        const snapshot = this.snapshotOf(workspace, path);
        const family = withinFamily(workspace, path, revision, selector, runs);
        const held = snapshot.within.get(family);
        const answers: boolean[] = new Array<boolean>(keys.length);
        const missing = new Set<string>();
        for (const [i, key] of keys.entries()) {
            const known = held?.answers.get(key);
            if (known === undefined) missing.add(key);
            else answers[i] = known;
        }
        if (missing.size === 0) {
            // Every answer is held: the reader has read them, and no batch keeps them for it any longer.
            if (held !== undefined) readWithin(held, keys);
            return some(answers);
        }
        const asked = [...missing];
        // The channel coordinates the read; the answers are held key by key, so
        // two reads that share a channel each read their own keys again if need be.
        const batchKey = pagedBatchKey(workspace, path, revision, selector, "within",
            [family, String(asked.length), asked[0]!, asked[asked.length - 1]!]);
        this.track(batchKey);
        const batch = this.channel(snapshot, batchKey);
        if (batch.status === "loaded") batch.status = "idle";
        if (this.due(batch)) {
            // The batch keeps every key its reader asks of: those held now, and those its answer brings.
            const kept = heldWithinOf(snapshot, family);
            releaseWithin(kept, batchKey);
            keepWithin(kept, batchKey, [...keys], keys.filter((key) => !missing.has(key)));
            this.launchWithin(workspace, path, snapshot, revision, index, family, batchKey, runs, asked);
        }
        return this.answer<readonly boolean[]>(batch, undefined);
    }

    /**
     * How many membership answers the runtime holds of a source's dataset,
     * over every narrowing's runs, and how many of them batches keep for their
     * readers (#1349): what its specs hold the bounds to. A move drops them
     * all, so they are always the current revision's.
     *
     * @param source - One of a record's indexes, or any source of the same record
     * @returns The answers held, and those kept
     */
    protected withinHeld(source: PagedSource): { answers: number; kept: number } {
        const snapshot = this.snapshots.get(pagedRevisionKey(this.resolveWorkspace(), source.path));
        let answers = 0;
        let kept = 0;
        for (const held of snapshot?.within.values() ?? []) {
            answers += held.answers.size;
            kept += held.pins.size;
        }
        return { answers, kept };
    }

    /** Launch a membership read of the keys not held: a request for each group
     *  of keys and of runs, a key in any group of the runs being in them. */
    private launchWithin(
        workspace: string,
        path: TreePath,
        snapshot: Snapshot,
        revision: string,
        index: string,
        family: string,
        batchKey: string,
        runs: readonly PagedRun[],
        keys: readonly string[],
    ): void {
        const seq = this.launch(this.channel(snapshot, batchKey));
        const api = this.api;
        void (async () => {
            const within = new Array<boolean>(keys.length).fill(false);
            try {
                if (api === null) throw new Error("no PagedApi installed");
                for (let k = 0; k < keys.length; k += DATASET_BATCH_MAX) {
                    const chunk = keys.slice(k, k + DATASET_BATCH_MAX);
                    for (let r = 0; r < Math.max(1, runs.length); r += DATASET_BATCH_MAX) {
                        const answer = await api.within(workspace, path, { index, runs: runs.slice(r, r + DATASET_BATCH_MAX), keys: chunk, hash: revision });
                        if (answer.within.length !== chunk.length) {
                            throw new Error(`a membership read of ${chunk.length} keys answered ${answer.within.length}`);
                        }
                        for (const [i, inside] of answer.within.entries()) within[k + i] ||= inside;
                    }
                }
            } catch (err) {
                if (this.followed(workspace, path, snapshot, revision, err)) return;
                this.fail(batchKey, seq, failureOf(path, err), isPermanentPageError(err));
                console.error(`Data.bindPaged: membership read failed for ${batchKey}:`, err);
                return;
            }
            if (!this.pinnedTo(snapshot, revision)) return;
            const held = heldWithinOf(snapshot, family);
            for (const [i, key] of keys.entries()) {
                held.answers.delete(key);
                held.answers.set(key, within[i]!);
            }
            // Its answers are kept for its reader, beside what the batch kept as it launched, until the reader reads
            // them; past the cap, the least recently read of the rest go.
            keepWithin(held, batchKey, keys, keys);
            trimWithin(held);
            this.settle(batchKey, seq, (e) => { e.status = "loaded"; delete e.error; });
        })();
    }

    /** A printer of a key type's East text, built once per type. */
    private printerOf(keyType: EastTypeValue): (key: unknown) => string {
        let print = this.printers.get(keyType);
        if (print === undefined) {
            print = printFor(keyType) as (key: unknown) => string;
            this.printers.set(keyType, print);
        }
        return print;
    }

    /** A parser of a key type's East text, built once per type. */
    private parserOf(keyType: EastTypeValue): (text: string) => ReturnType<ReturnType<typeof parseFor>> {
        let parse = this.parsers.get(keyType);
        if (parse === undefined) {
            parse = parseFor(keyType);
            this.parsers.set(keyType, parse);
        }
        return parse;
    }

    /** The rows a family's reads by key hold, made empty on first use. */
    private heldRowsOf(snapshot: Snapshot, family: string, keyType: EastTypeValue): HeldRows {
        let held = snapshot.held.get(family);
        if (held === undefined) {
            held = { byKey: new SortedMap<unknown, PagedRow>(undefined, compareFor(fromEastTypeValue(keyType))), byPosition: new Map() };
            snapshot.held.set(family, held);
        }
        return held;
    }

    /** Hold a read's rows, each by its key and the dataset's by position too;
     *  past {@link MAX_HELD_ROWS}, the family's older rows go first. */
    private hold(snapshot: Snapshot, family: string, keyType: EastTypeValue, rows: readonly PagedRow[]): void {
        let held = this.heldRowsOf(snapshot, family, keyType);
        if (held.byKey.size + rows.length > MAX_HELD_ROWS) {
            snapshot.held.delete(family);
            held = this.heldRowsOf(snapshot, family, keyType);
        }
        for (const row of rows) {
            held.byKey.set(row.key, row);
            if (row.row.type === "some") held.byPosition.set(row.position, row);
        }
    }

    /** The row a landed Dict window of a family holds under a key — or the
     *  key's absence, when the window's span takes it in — and its position. */
    private rowInWindows(snapshot: Snapshot, family: string, keyType: EastTypeValue, key: unknown): PagedRow | undefined {
        const cmp = compareFor(fromEastTypeValue(keyType)) as (a: unknown, b: unknown) => number;
        for (const channelKey of snapshot.channels) {
            const entry = this.entries.get(channelKey);
            const span = entry?.span;
            if (entry === undefined || entry.status !== "loaded" || entry.window === undefined || span === undefined || span.family !== family) continue;
            const keys = this.windowKeys(entry.window as ReadonlyMap<unknown, unknown>);
            if (keys.length === 0 || cmp(key, keys[0]) < 0 || cmp(key, keys[keys.length - 1]) > 0) continue;
            let lo = 0;
            let hi = keys.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (cmp(keys[mid], key) < 0) lo = mid + 1;
                else hi = mid;
            }
            const window = entry.window as ReadonlyMap<unknown, unknown>;
            return cmp(keys[lo], key) === 0
                ? { key: keys[lo], row: some(window.get(keys[lo])), position: span.offset + lo }
                : { key, row: none, position: span.offset + lo };
        }
        return undefined;
    }

    /** A Dict window's keys, in order, listed once per window. */
    private windowKeys(window: ReadonlyMap<unknown, unknown>): readonly unknown[] {
        let keys = this.keysOfWindows.get(window);
        if (keys === undefined) {
            keys = [...window.keys()];
            this.keysOfWindows.set(window, keys);
        }
        return keys;
    }

    /** The row a family's reads by key hold under a key's East text, when they
     *  hold one — what a search by the key answers from (#1351). */
    private heldRow(snapshot: Snapshot, family: string, sourceType: EastTypeValue, literal: string): PagedRow | undefined {
        if (sourceType.type !== "Dict") return undefined;
        const held = snapshot.held.get(family);
        if (held === undefined) return undefined;
        const parsed = this.parserOf((sourceType.value as { key: EastTypeValue }).key)(literal);
        return parsed.success ? held.byKey.get(parsed.value) : undefined;
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
                        this.cutFromCovering(sourceType, snapshot, family, offset, limit, own);
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
                    // A key a read by key holds is answered from it, never searched (#1351).
                    const own = this.channel(snapshot, key);
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
                        const snapshot = this.snapshotOf(workspace, path);
                        if (target.type === "some") { this.moveTo(workspace, path, snapshot, target.value); return; }
                        // Following the current state is a Retry too: what failed is asked again now.
                        this.rearmFailed(snapshot);
                        this.find(workspace, path, snapshot);
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
