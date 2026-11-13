/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The paging runtime's API seam (`Data.bindPaged`): what a paged source is — a
 * dataset, and which of its rows — what a window, a row read by key, a run and
 * a placement are, and the narrow surface the runtime talks to e3 through. Tests
 * stub it; the React provider installs the real one. There is no offline
 * stand-in: paging is a SERVER capability (segment fences, exact totals, key
 * search), so a paged source resolves only against a live workspace.
 *
 * @packageDocumentation
 */

import type { EastTypeValue, option } from "@elaraai/east";
import {
    datasetGetPage, datasetFindKey, datasetFindKeys, datasetGetRows, datasetGetRuns, datasetGetStatus, datasetPlace, datasetWithin, type DatasetPage,
    type DatasetPlaceQuery, type DatasetPlacement, type DatasetWithin, type DatasetWithinQuery, type DatasetFindQuery, type DatasetFindResult,
    type DatasetFindKeysQuery, type DatasetFindKeysResult, type DatasetRows, type DatasetRowsQuery, type DatasetRuns, type DatasetRunsQuery,
    type RequestOptions,
} from "@elaraai/e3-api-client";
import type { TreePath } from "@elaraai/e3-types";

import type { ReactiveDatasetCacheInterface } from "../dataset-store.js";

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

/**
 * Adapter for the dataset paging endpoints. The default wraps
 * `@elaraai/e3-api-client`'s `datasetGetPage`, `datasetFindKey` and
 * `datasetGetStatus`, and follows datasets through the dataset store.
 *
 * Each request takes the signal of the read that asked it (#1398, CL6): a
 * read no reader waits on any longer — a window that left the demand ring, a
 * period read a newer navigation superseded — is aborted while still in
 * flight, and the request rejects as `fetch` does.
 */
export interface PagedApi {
    /** Fetch one element window of a collection dataset — or of one of a
     *  record's indexes, when the window names one. */
    getPage(workspace: string, path: TreePath, window: PagedWindow, signal?: AbortSignal): Promise<DatasetPage>;
    /** Locate a key query in a Set/Dict dataset's canonical key order. The
     *  `row` it answers with indexes the SAME row space {@link getPage}'s
     *  element windows serve, which is what makes a hit addressable. */
    findKey(workspace: string, path: TreePath, query: DatasetFindQuery, signal?: AbortSignal): Promise<DatasetFindResult>;
    /** Locate several key queries of one source in one request (#1351), each
     *  as {@link findKey} would, in order. */
    findKeys(workspace: string, path: TreePath, query: DatasetFindKeysQuery, signal?: AbortSignal): Promise<DatasetFindKeysResult>;
    /** Read the rows a Dict dataset holds under several keys in one request —
     *  its own, or those the entries of some runs of a record's index name
     *  (#1393) — each key's row or absence and its position, the first `count`
     *  of the keys the page's bounds reach. */
    getRows(workspace: string, path: TreePath, query: DatasetRowsQuery, signal?: AbortSignal): Promise<DatasetRows>;
    /** Read the entries of several runs of a source's rows in one request, in
     *  order: the first `count` of them a page's bounds reach. */
    getRuns(workspace: string, path: TreePath, query: DatasetRunsQuery, signal?: AbortSignal): Promise<DatasetRuns>;
    /** Place a window of a narrowing's runs of one of a record's indexes in the
     *  record (#1349): how many of the window's entries each record segment
     *  holds, the first `placed` of them a page's bounds reach. */
    place(workspace: string, path: TreePath, query: DatasetPlaceQuery, signal?: AbortSignal): Promise<DatasetPlacement>;
    /** Ask which of some index entries a narrowing's runs of one of a record's
     *  indexes hold, in one request (#1349). */
    within(workspace: string, path: TreePath, query: DatasetWithinQuery, signal?: AbortSignal): Promise<DatasetWithin>;
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
    /**
     * Says which hash a follower of a dataset reads at now, by evidence of
     * its own — an answer's revision installed, a refusal naming the
     * dataset's state, a lookup: {@link watchRevision} then tells it of the
     * dataset's hash wherever that differs, from the next poll started on,
     * rather than only where it differs from the last hash told.
     *
     * @param workspace - The workspace
     * @param path - The dataset's path
     * @param onChange - The follower, as {@link watchRevision} was given it
     * @param hash - The hash it reads at now; `null` while the dataset has no value
     */
    revisionHeld?(workspace: string, path: TreePath, onChange: (hash: string | null) => void, hash: string | null): void;
}

/**
 * A request's options with its read's signal: the `fetch` every one of its
 * requests goes through — its retries too — carries the signal, so aborting
 * the read rejects the request in flight as `fetch` does, and a retry is
 * never sent. The client's own options are otherwise as they were.
 *
 * @param options - The request's options
 * @param signal - The read's signal; absent, the options as they are
 * @returns The options
 */
function withSignal(options: RequestOptions, signal: AbortSignal | undefined): RequestOptions {
    if (signal === undefined) return options;
    const send = options.fetch ?? globalThis.fetch;
    return {
        ...options,
        fetch: (input, init) => {
            const own = init?.signal ?? undefined;
            if (own === undefined) return send(input, { ...init, signal });
            // A request with a signal of its own is aborted by either.
            const both = new AbortController();
            const abort = () => both.abort();
            if (own.aborted || signal.aborted) both.abort();
            own.addEventListener("abort", abort, { once: true });
            signal.addEventListener("abort", abort, { once: true });
            return send(input, { ...init, signal: both.signal });
        },
    };
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
    datasets: Pick<ReactiveDatasetCacheInterface, "watchHash" | "hashHeld">,
): PagedApi {
    return {
        async getPage(workspace, path, window, signal) {
            return datasetGetPage(apiUrl, repo, workspace, path, window, withSignal(getOptions(), signal));
        },
        async findKey(workspace, path, query, signal) {
            return datasetFindKey(apiUrl, repo, workspace, path, query, withSignal(getOptions(), signal));
        },
        async findKeys(workspace, path, query, signal) {
            return datasetFindKeys(apiUrl, repo, workspace, path, query, withSignal(getOptions(), signal));
        },
        async getRows(workspace, path, query, signal) {
            return datasetGetRows(apiUrl, repo, workspace, path, query, withSignal(getOptions(), signal));
        },
        async getRuns(workspace, path, query, signal) {
            return datasetGetRuns(apiUrl, repo, workspace, path, query, withSignal(getOptions(), signal));
        },
        async place(workspace, path, query, signal) {
            return datasetPlace(apiUrl, repo, workspace, path, query, withSignal(getOptions(), signal));
        },
        async within(workspace, path, query, signal) {
            return datasetWithin(apiUrl, repo, workspace, path, query, withSignal(getOptions(), signal));
        },
        async getRevision(workspace, path) {
            const status = await datasetGetStatus(apiUrl, repo, workspace, path, getOptions());
            return status.hash.type === "some" ? status.hash.value : null;
        },
        watchRevision(workspace, path, onChange) {
            return datasets.watchHash(workspace, path, onChange);
        },
        revisionHeld(workspace, path, onChange, hash) {
            datasets.hashHeld(workspace, path, onChange, hash);
        },
    };
}
