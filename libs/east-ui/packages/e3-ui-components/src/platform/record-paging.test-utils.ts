/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record read a window at a time, under test (#1199): a stand-in paging
 * service over records the dataset cache holds — each record's own entries a
 * window at a time in key order, pinned to the content it holds, a stale pin
 * refused naming the content held now; a key search by a key's text; and a
 * record's revision followed as it commits — and a count of every whole read
 * of a dataset the cache answers, but the stand-in record server's own, which
 * reads a record to apply a patch, as e3 does. The server names the state it
 * commits by its content's hash, as e3 does, and so does the service: a Save's
 * revision is the one the record's paged reads move to. What a surface's test
 * reads a paged record through, and proves it is never read whole by.
 *
 * @packageDocumentation
 */

import { DatasetHashMismatchError, type DatasetFindQuery, type DatasetFindResult, type DatasetPage } from "@elaraai/e3-api-client";
import { NullType, SortedMap, compareFor, decodeBeast2For, encodeBeast2For, parseFor, some, none, variant, type DictType, type EastType } from "@elaraai/east";
import { indexWindowType, type TreePath } from "@elaraai/e3-types";
import { datasetCacheKey, type PagedApi, type ReactiveDatasetCache, type RecordApi } from "./index.js";

/** A record the service serves: where e3 keeps it, and its type — a Dict. */
export interface PagedRecord {
    /** Its dataset's path. */
    readonly path: TreePath;
    /** Its type. */
    readonly type: DictType<EastType, EastType>;
    /** Optional day/backlog indexes, evaluated on the stand-in server with the declared East key function. */
    readonly indexes?: readonly { name: string; keyType: EastType; keys: (key: unknown, row: unknown) => Iterable<unknown> }[];
}

/** The whole reads of datasets a test counts, and how it reads past the count. */
export interface WholeReads {
    /** Each dataset read whole, by its path's text, in order. */
    readonly paths: string[];
    /** The cache's own read, uncounted: what the service and the test read a record by. */
    readonly raw: (workspace: string, path: TreePath) => Uint8Array | undefined;
    /**
     * A record API as e3's server answers: its patch door's own read of the
     * record, as it applies a patch, not counted; and each state it commits
     * named by its content's hash ({@link contentHash}), the revision the
     * record's paged reads move to.
     *
     * @param api - The records' API
     * @returns The same API, its writes uncounted and its states content-named
     */
    serve(api: RecordApi): RecordApi;
}

/** A dataset's path as e3 names it: its fields, joined by dots. */
export const pathText = (path: TreePath) => path.map((step) => step.value).join(".");

/** The dataset a record's current value lives at, as e3 keeps it. */
const recordPathOf = (name: string): TreePath => [variant("field", "records"), variant("field", name)];

/**
 * A content hash of bytes: what the service names the content it holds by,
 * and the server the state it commits — so a Save's revision is the one the
 * record's paged reads move to, as e3's are.
 *
 * @param bytes - The content
 * @returns Its hash
 */
export function contentHash(bytes: Uint8Array | undefined): string {
    let hash = 0x811c9dc5;
    for (const byte of bytes ?? []) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, "0");
}

/**
 * Counts every whole read of a dataset the cache answers from here on.
 *
 * @param cache - The dataset cache
 * @returns The reads, the uncounted read, and how a record API's own writes go uncounted
 */
export function countWholeReads(cache: ReactiveDatasetCache): WholeReads {
    const raw = cache.read.bind(cache);
    const paths: string[] = [];
    let serving = false;
    cache.read = (workspace, path) => {
        if (!serving) paths.push(pathText(path));
        return raw(workspace, path);
    };
    return {
        paths,
        raw,
        serve: (api) => ({
            ...api,
            // The server reads the record before its first wait, as it applies the patch; the state it commits is
            // named by its content's hash.
            mutate: async (workspace, record, mutation, request) => {
                let answer: ReturnType<RecordApi["mutate"]>;
                serving = true;
                try {
                    answer = api.mutate(workspace, record, mutation, request);
                } finally {
                    serving = false;
                }
                const result = await answer;
                if (result.outcome.type !== "committed") return result;
                const committed = { ...result.outcome.value, stateHash: contentHash(raw(workspace, recordPathOf(record))) };
                return { ...result, outcome: variant("committed", committed) } as Awaited<ReturnType<RecordApi["mutate"]>>;
            },
        }),
    };
}

/**
 * The stand-in paging service over records — see the module docs.
 *
 * @param cache - The dataset cache the records live in, which the service follows
 * @param read - The cache's own read, uncounted
 * @param records - The records it serves
 * @returns The service's API, and each request it was sent, as `<path> <op> <where>`
 */
export function recordPaging(
    cache: ReactiveDatasetCache, read: WholeReads["raw"], records: readonly PagedRecord[],
): { api: PagedApi; requests: string[] } {
    const requests: string[] = [];
    const recordOf = (path: TreePath): PagedRecord => {
        const record = records.find((r) => pathText(r.path) === pathText(path));
        if (record === undefined) throw new Error(`the service holds no ${pathText(path)}`);
        return record;
    };
    const revisionOf = (workspace: string, path: TreePath) => contentHash(read(workspace, path));
    const pinned = (workspace: string, path: TreePath, hash: string | undefined) => {
        const now = revisionOf(workspace, path);
        if (hash !== undefined && hash !== now) throw new DatasetHashMismatchError("stale pin", now);
        return now;
    };
    /** A record's entries as it holds them now, in key order. */
    const entriesOf = (workspace: string, record: PagedRecord): ReadonlyMap<unknown, unknown> =>
        decodeBeast2For(record.type)(read(workspace, record.path)!) as ReadonlyMap<unknown, unknown>;
    const indexed = (workspace: string, record: PagedRecord, name: string) => {
        const index = record.indexes?.find(candidate => candidate.name === name);
        if (index === undefined) throw new Error(`the service holds no index ${name}`);
        const compareIndex = compareFor(index.keyType); const compareKey = compareFor(record.type.key);
        const entries = [...entriesOf(workspace, record)].flatMap(([key, row]) => [...index.keys(key, row)].map(ik => ({ ik, key, value: null, row })));
        entries.sort((a, b) => compareIndex(a.ik, b.ik) || compareKey(a.key, b.key));
        return { index, entries };
    };
    const api: PagedApi = {
        async getRevision(workspace, path) { return revisionOf(workspace, path); },
        async getPage(workspace, path, window): Promise<DatasetPage> {
            const record = recordOf(path);
            if (window.index !== undefined) {
                requests.push(`${pathText(path)} index ${window.index} page ${window.offset}+${window.limit}`);
                const hash = pinned(workspace, path, window.hash);
                const { index, entries } = indexed(workspace, record, window.index);
                const rows = entries.slice(window.offset, window.offset + window.limit).map(entry => ({ ...entry, row: window.join === true ? some(entry.row) : none }));
                const data = encodeBeast2For(indexWindowType(record.type.key, index.keyType, NullType, record.type.value))(rows);
                return { data, totalElements: entries.length, totalBytes: data.length, totalExact: true, segmentCount: 1, offset: window.offset, count: rows.length, hash };
            }
            requests.push(`${pathText(path)} page ${window.offset}+${window.limit}`);
            const hash = pinned(workspace, path, window.hash);
            const entries = [...entriesOf(workspace, record)];
            const slice = entries.slice(window.offset, window.offset + window.limit);
            const data = encodeBeast2For(record.type)(new SortedMap(slice, compareFor(record.type.key)) as never);
            return { data, totalElements: entries.length, totalBytes: data.length, totalExact: true, segmentCount: 1, offset: window.offset, count: slice.length, hash };
        },
        async findKey(workspace, path, query: DatasetFindQuery): Promise<DatasetFindResult> {
            const record = recordOf(path);
            const hash = pinned(workspace, path, query.hash);
            if (query.index !== undefined) {
                if (!("from" in query) || query.from?.[0] === undefined) throw new Error("an index is sought from its first day key");
                requests.push(`${pathText(path)} index ${query.index} seek ${query.from[0]}`);
                const { index, entries } = indexed(workspace, record, query.index);
                const parsed = parseFor(index.keyType)(query.from[0]);
                if (!parsed.success) throw new Error(`not a key of ${query.index}: ${query.from[0]}`);
                const compare = compareFor(index.keyType);
                const row = entries.filter(entry => compare(entry.ik, parsed.value) < 0).length;
                return { found: row < entries.length, row, count: entries.length - row, hash };
            }
            // By a key's text, as East prints it.
            if (!("key" in query)) throw new Error("a record's own entries are sought by a key");
            requests.push(`${pathText(path)} seek ${query.key}`);
            const parsed = parseFor(record.type.key)(query.key);
            if (!parsed.success) throw new Error(`not a key of ${pathText(path)}: ${query.key}`);
            const compare = compareFor(record.type.key);
            const keys = [...entriesOf(workspace, record).keys()];
            const row = keys.filter((k) => compare(k, parsed.value) < 0).length;
            const count = keys.filter((k) => compare(k, parsed.value) === 0).length;
            return { found: count > 0, row, count, hash };
        },
        watchRevision(workspace, path, onChange) {
            let told = revisionOf(workspace, path);
            return cache.subscribe(datasetCacheKey(workspace, path), () => {
                const now = revisionOf(workspace, path);
                if (now === told) return;
                told = now;
                onChange(now);
            });
        },
    };
    return { api, requests };
}
