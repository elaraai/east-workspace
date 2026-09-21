/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Dataset content — what the value tree shows for one dataset path.
 *
 * `tick` polls `datasetGetStatus` (every 5 s while the dataset is on
 * screen) and, on a new content hash, decides how the value is shown, as
 * the web preview does: no value → *unset* / *null*; a collection root
 * (Array / Set / Dict) → *paged* through `datasetGetPage`, read-only, at
 * every size; any other root ≤ 200 KB → fetched whole, decoded and
 * materialized into the tree (*inline*); larger → *too large* (`/save`
 * still works). The server's refusals map to states: `dataset_not_indexed`
 * (a legacy blob) → *not indexed* with a `⏎ load whole value` fallback up
 * to 64 MB, `dataset_too_large` → *too large*, `dataset_hash_mismatch` →
 * the status is refetched.
 *
 * Paging is driven by one *window* per shown dataset — the pages the view
 * wants right now, set by every scroll ({@link DatasetLoader.needRows}) —
 * not by a queue of requests: at most {@link MAX_INFLIGHT} fetches run per
 * dataset, each issued for a page of the current window (nearest its
 * centre first), so a thumb drag across a million rows costs the pages of
 * where it stops, not of everywhere it passed. A page's size in rows is
 * chosen per dataset from the blob's stored bytes per row
 * ({@link pageSizeFor}): a page of wide rows holds as many rows as
 * {@link PAGE_BYTES_TARGET} covers, a page of narrow rows
 * {@link PAGE_SIZE_MAX}; a server that cuts a window short by its own byte
 * budget is asked for the rest until the page is whole. Loaded pages are
 * pruned to {@link MAX_RETAINED_PAGES} around the window whenever the set
 * changes — as a page lands as much as when the window moves — and raw
 * bytes stay in a small cache so a page that left re-materializes without
 * a request. Decoding and materializing yield to the renderer.
 *
 * @packageDocumentation
 */

import { decodeBeast2For, variant, type EastTypeValue } from '@elaraai/east';
import { ValueTree } from '@elaraai/east-ui';
import { findKeyInline, pruneRetainedPages, type DatasetKeyMatchRange, type DatasetKeyQuery, type ValueTreePagedRow } from '@elaraai/east-ui/internal';
import { apiCode, describeError, treePathOf, type Api } from '../api.js';
import { applyAnchor, captureAnchor, collectionKeys, isCollectionType, keyTypeOf, viewDataset } from '../model/tree.js';
import type { DatasetData, DatasetMode } from '../state/actions.js';
import type { Store } from '../state/store.js';

export { collectionKeys, isCollectionType, keyTypeOf, viewDataset };

/** Non-collection values up to this many bytes are fetched whole. */
export const INLINE_LIMIT = 200 * 1024;
/** `⏎ load whole value` on a not-indexed collection is offered up to this size. */
export const WHOLE_LIMIT = 64 * 1024 * 1024;
/** Root rows per page at most — the page size of narrow rows. */
export const PAGE_SIZE_MAX = 500;
/** Stored bytes a page aims to hold: wide rows make shorter pages, so what one page materializes stays bounded. */
export const PAGE_BYTES_TARGET = 128 * 1024;
/** Loaded (materialized) pages retained around the window. */
export const MAX_RETAINED_PAGES = 6;
/** Raw page bytes kept per session (a return re-materializes without a request). */
export const MAX_CACHED_PAGES = 32;
/** Page fetches in flight per dataset. */
export const MAX_INFLIGHT = 2;
/** Root rows requested around the first window before the view has scrolled. */
const INITIAL_WINDOW_ROWS = 60;
/** Rows materialized between yields to the renderer. */
const MATERIALIZE_SLICE = 100;
/** How long a failed page waits before it is asked for again. */
const RETRY_AFTER_MS = 2_000;

/** The paged mode. */
type PagedMode = Extract<DatasetMode, { kind: 'paged' }>;

/**
 * The rows per page of a collection: as many as {@link PAGE_BYTES_TARGET}
 * covers at the blob's average stored bytes per row, at most
 * {@link PAGE_SIZE_MAX}, at least one.
 *
 * @param totalBytes - The stored blob's size
 * @param totalRows - Its root rows
 * @returns The page size
 */
export function pageSizeFor(totalBytes: number, totalRows: number): number {
    if (totalRows <= 0 || totalBytes <= 0) return PAGE_SIZE_MAX;
    return Math.max(1, Math.min(PAGE_SIZE_MAX, Math.floor(PAGE_BYTES_TARGET / (totalBytes / totalRows))));
}

/** The elements of a decoded page in row order (a Dict's entries as pairs). */
function elementsOf(type: EastTypeValue, decoded: unknown): unknown[] {
    if (type.type === 'Array') return decoded as unknown[];
    if (type.type === 'Dict') return Array.from((decoded as Map<unknown, unknown>).entries());
    return Array.from((decoded as Set<unknown>).values());
}

/** One root row of the paged tree: the element materialized, with its global step and label. */
function rowOf(type: EastTypeValue, element: unknown, row: number): ValueTreePagedRow {
    if (type.type === 'Dict') {
        const { key: keyType, value: valueType } = type.value as { key: EastTypeValue; value: EastTypeValue };
        const [k, v] = element as [unknown, unknown];
        const stringKeys = keyType.type === 'String';
        return {
            node: ValueTree.materialize(valueType, v),
            step: stringKeys ? variant('key', k as string) : variant('index', BigInt(row)),
            label: stringKeys ? (k as string) : ValueTree.keyLabel(keyType, k),
        };
    }
    return { node: ValueTree.materialize(type.value as EastTypeValue, element), step: variant('index', BigInt(row)) };
}

/**
 * Materializes one decoded page into the tree's paged-row contract (the
 * web preview's `pageRows`).
 *
 * @param type - The dataset's root type
 * @param decoded - The decoded page (a value of the root type)
 * @param offset - The global row of the page's first element
 * @returns The rows
 */
export function pageRows(type: EastTypeValue, decoded: unknown, offset: number): ValueTreePagedRow[] {
    return elementsOf(type, decoded).map((element, i) => rowOf(type, element, offset + i));
}

/** What the loader needs. */
export interface DatasetLoaderDeps {
    store: Store;
    api: () => Api | null;
    log?: ((line: string) => void) | undefined;
    /** The clock (for the retry hold). */
    now?: (() => number) | undefined;
    /** How long a failed page waits before it is asked for again. */
    retryAfterMs?: number | undefined;
}

/** The dataset loader. */
export interface DatasetLoader {
    /** Polls the status and (re)loads the content on a new hash (`force` also past a pending edit's conflict). */
    tick(ws: string, path: string, force?: boolean): Promise<void>;
    /** Reloads the content now, past any conflict (`/reload`). */
    reload(ws: string, path: string): Promise<void>;
    /**
     * Sets the window: the pages covering root rows `[startRow, endRow)` are
     * what the view wants now. They are fetched two at a time, nearest the
     * window's centre first; pages far from them are dropped; a window set
     * while pages are in flight replaces the last one, so what lands for a
     * position the view has left is cached, not shown.
     */
    needRows(ws: string, path: string, startRow: number, endRow: number): void;
    /** `⏎ load whole value` on a not-indexed collection. */
    loadWhole(ws: string, path: string): Promise<void>;
    /** Locates a key query: server-side for a paged value, in memory for an inline one. */
    findKey(ws: string, path: string, query: DatasetKeyQuery): Promise<DatasetKeyMatchRange>;
    /** The stored bytes (`/save`). */
    bytes(ws: string, path: string): Promise<Uint8Array>;
    /** Drops the caches, the windows and the in-flight bookkeeping. */
    reset(): void;
}

/** One response of a page: `count` rows from `offset`, as the server's blob. */
interface PageChunk { offset: number; count: number; bytes: Uint8Array }
/** A page's raw bytes — one chunk, or several when the server's byte budget cut a window short. */
interface CachedPage { chunks: PageChunk[] }
/** The pages a shown dataset wants. */
interface PageWindow { hash: string; first: number; last: number }

const yieldToRender = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
const chunkRows = (entry: CachedPage): number => entry.chunks.reduce((n, c) => n + c.count, 0);
const sameList = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Creates the loader.
 *
 * @param deps - The store, the API accessor, the log
 * @returns The loader
 */
export function createDatasetLoader(deps: DatasetLoaderDeps): DatasetLoader {
    const { store } = deps;
    const clock = deps.now ?? Date.now;
    const retryAfterMs = deps.retryAfterMs ?? RETRY_AFTER_MS;
    const wholeInflight = new Set<string>();
    const cache = new Map<string, CachedPage>();
    /** Per dataset (`ws\npath`): the window. */
    const windows = new Map<string, PageWindow>();
    /** Per dataset and hash: the pages being fetched. */
    const inflight = new Map<string, Set<number>>();
    /** Per page key: when a failed page may be asked for again. */
    const retryAt = new Map<string, number>();
    /** Per dataset: the pump already scheduled for a hold, and when for. */
    const retryPump = new Map<string, { at: number; timer: ReturnType<typeof setTimeout> }>();
    const datasetKey = (ws: string, path: string): string => `${ws}\n${path}`;
    const keyOf = (ws: string, path: string, hash: string, page: number | 'whole'): string => `${ws}\n${path}\n${hash}\n${page}`;
    const current = (ws: string, path: string): DatasetData | undefined => store.getState().data.dataset[ws]?.[path];
    const notFound: DatasetKeyMatchRange = { found: false, row: 0, count: 0 };

    const inflightOf = (ws: string, path: string, hash: string): Set<number> => {
        const key = keyOf(ws, path, hash, 'whole');
        let set = inflight.get(key);
        if (set === undefined) {
            set = new Set();
            inflight.set(key, set);
        }
        return set;
    };

    /** Replaces the mode, unless the value changed underneath; the shown tree's selection stays on its logical row. */
    const setMode = (ws: string, path: string, hash: string, mode: DatasetMode): void => {
        const s = store.getState();
        const d = s.data.dataset[ws]?.[path];
        if (d === undefined || d.hash !== hash) return;
        const anchor = captureAnchor(s, ws, path);
        store.dispatch({ type: 'data/datasetMode', ws, path, mode });
        if (anchor !== null) {
            const view = applyAnchor(store.getState(), anchor);
            if (view !== null) store.dispatch({ type: 'view/set', view });
        }
    };

    const cachePut = (key: string, entry: CachedPage): void => {
        cache.delete(key);
        cache.set(key, entry);
        while (cache.size > MAX_CACHED_PAGES) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            cache.delete(oldest);
        }
    };

    /** The window's pages not loaded yet, nearest its centre first. */
    const wantedMissing = (w: PageWindow, mode: PagedMode): number[] => {
        const centre = (w.first + w.last) / 2;
        const missing: number[] = [];
        for (let p = w.first; p <= w.last; p++) if (!mode.pages.has(p)) missing.push(p);
        return missing.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre) || a - b);
    };

    const loadInline = async (api: Api, ws: string, path: string, hash: string, type: EastTypeValue): Promise<void> => {
        const key = keyOf(ws, path, hash, 'whole');
        if (wholeInflight.has(key)) return;
        wholeInflight.add(key);
        try {
            const got = await api.datasetGet(ws, treePathOf(path));
            await yieldToRender();
            const value = decodeBeast2For(type)(got.data);
            await yieldToRender();
            const root = ValueTree.materialize(type, value);
            setMode(ws, path, hash, { kind: 'inline', root, value });
        } catch (err) {
            deps.log?.(`dataset ${ws}${path} load failed: ${describeError(err)}`);
            setMode(ws, path, hash, { kind: 'error', message: describeError(err) });
        } finally {
            wholeInflight.delete(key);
        }
    };

    /** Maps a page request's failure to a state; a paged value holds the page back before it is asked for again. */
    const pageFailure = (ws: string, path: string, hash: string, page: number, err: unknown): void => {
        const code = apiCode(err);
        const d = current(ws, path);
        if (code === 'dataset_hash_mismatch') {
            deps.log?.(`dataset ${ws}${path} page ${page}: hash mismatch — refetching the status`);
            void loader.tick(ws, path);
        } else if (code === 'dataset_not_indexed') {
            setMode(ws, path, hash, { kind: 'not-indexed', loadable: (d?.size ?? 0) <= WHOLE_LIMIT });
        } else if (code === 'dataset_too_large') {
            setMode(ws, path, hash, { kind: 'too-large' });
        } else if (d?.mode.kind === 'paged' && d.hash === hash) {
            deps.log?.(`dataset ${ws}${path} page ${page} failed: ${describeError(err)}`);
            // A failing server is not hammered: the page waits out the hold,
            // then the window's next move or the hold's end asks again. The
            // pump below re-arms for the hold, so the wait cannot be lost.
            retryAt.set(keyOf(ws, path, hash, page), clock() + retryAfterMs);
        } else {
            deps.log?.(`dataset ${ws}${path} first page failed: ${describeError(err)}`);
            setMode(ws, path, hash, { kind: 'error', message: describeError(err) });
        }
    };

    /** Fetches the rest of a page — window by window when the server cuts one short — into the byte cache. */
    const fetchPage = async (api: Api, ws: string, path: string, hash: string, key: string, start: number, want: number, partial: CachedPage | undefined): Promise<CachedPage> => {
        const chunks = partial === undefined ? [] : [...partial.chunks];
        let got = chunkRows({ chunks });
        while (got < want) {
            const p = await api.datasetGetPage(ws, treePathOf(path), { offset: start + got, limit: want - got, hash });
            const count = Math.max(0, Math.min(p.count, want - got));
            chunks.push({ offset: start + got, count, bytes: p.data });
            if (count === 0) break; // nothing more came: the page ends here
            got += count;
        }
        const entry = { chunks };
        cachePut(key, entry);
        return entry;
    };

    /** Decodes a page's chunks and materializes its rows `[start, start + want)`, yielding as it goes. */
    const materializePage = async (type: EastTypeValue, entry: CachedPage, start: number, want: number): Promise<ValueTreePagedRow[]> => {
        const rows: ValueTreePagedRow[] = [];
        const decode = decodeBeast2For(type);
        for (const chunk of entry.chunks) {
            const elements = elementsOf(type, decode(chunk.bytes));
            for (let i = 0; i < elements.length; i++) {
                const row = chunk.offset + i;
                if (row < start || row >= start + want) continue;
                rows.push(rowOf(type, elements[i], row));
                if (rows.length % MATERIALIZE_SLICE === 0) await yieldToRender();
            }
        }
        return rows;
    };

    /** Loads one page of the window: its bytes (cached or fetched), then its rows — unless the window left it behind meanwhile. */
    const loadPage = async (api: Api, ws: string, path: string, hash: string, type: EastTypeValue, mode: PagedMode, page: number): Promise<void> => {
        const running = inflightOf(ws, path, hash);
        if (running.has(page)) return;
        running.add(page);
        const key = keyOf(ws, path, hash, page);
        try {
            const start = page * mode.pageSize;
            const want = Math.max(0, Math.min(mode.pageSize, mode.totalRows - start));
            let entry = cache.get(key);
            if (entry === undefined || chunkRows(entry) < want) entry = await fetchPage(api, ws, path, hash, key, start, want, entry);
            // The window moved on while the page was in flight: its bytes are
            // cached for a return; nothing is materialized for a page nobody shows.
            const w = windows.get(datasetKey(ws, path));
            if (w === undefined || w.hash !== hash || page < w.first || page > w.last) return;
            await yieldToRender();
            const rows = await materializePage(type, entry, start, want);
            const d = current(ws, path);
            if (d === undefined || d.hash !== hash || d.mode.kind !== 'paged') return;
            const after = windows.get(datasetKey(ws, path));
            const pages = new Map(d.mode.pages);
            pages.set(page, rows);
            const kept = after !== undefined && after.hash === hash ? pruneRetainedPages(pages, after.first, after.last, MAX_RETAINED_PAGES) : pages;
            const next: PagedMode = { ...d.mode, pages: kept, loading: [] };
            if (after !== undefined && after.hash === hash) next.loading = wantedMissing(after, next);
            setMode(ws, path, hash, next);
        } catch (err) {
            pageFailure(ws, path, hash, page, err);
        } finally {
            running.delete(page);
            pump(ws, path);
        }
    };

    /** Starts loads for the window's missing pages, up to the in-flight cap. */
    const pump = (ws: string, path: string): void => {
        const api = deps.api();
        const w = windows.get(datasetKey(ws, path));
        const d = current(ws, path);
        if (api === null || w === undefined || d === undefined || d.hash !== w.hash || d.type === null || d.mode.kind !== 'paged') return;
        const running = inflightOf(ws, path, w.hash);
        const now = clock();
        let soonestHold = Infinity;
        for (const page of wantedMissing(w, d.mode)) {
            if (running.size >= MAX_INFLIGHT) break;
            if (running.has(page)) continue;
            const hold = retryAt.get(keyOf(ws, path, w.hash, page));
            if (hold !== undefined && hold > now) {
                soonestHold = Math.min(soonestHold, hold);
                continue;
            }
            void loadPage(api, ws, path, w.hash, d.type, d.mode, page);
        }
        // A page held back is asked for again when its hold ends — by THIS
        // pump, which is the only thing that will. Scheduling the wait where
        // the failure happened was not enough: `setTimeout` counts on libuv's
        // monotonic clock and the hold is stamped from `Date.now`, so a timer
        // that fires a millisecond before the wall clock agrees found the page
        // still held, skipped it, and left nothing to ask again — the page
        // stranded until the window next moved. Re-arming here closes that,
        // whatever the two clocks think of each other.
        if (soonestHold !== Infinity) armRetryPump(ws, path, soonestHold, now);
    };

    /** Schedules the pump that ends the soonest hold, keeping one timer per
     *  dataset: an earlier wait replaces a later one, a later one is already
     *  covered. */
    const armRetryPump = (ws: string, path: string, at: number, now: number): void => {
        const key = datasetKey(ws, path);
        const pending = retryPump.get(key);
        if (pending !== undefined) {
            if (pending.at <= at) return;
            clearTimeout(pending.timer);
        }
        const timer = setTimeout(() => {
            retryPump.delete(key);
            pump(ws, path);
        }, Math.max(1, at - now));
        timer.unref?.();
        retryPump.set(key, { at, timer });
    };

    /** A server that reports no row geometry: one window of the head tells the totals, and its rows seed page 0. */
    const probe = async (api: Api, ws: string, path: string, hash: string): Promise<PagedMode | null> => {
        try {
            const p = await api.datasetGetPage(ws, treePathOf(path), { offset: 0, limit: PAGE_SIZE_MAX, hash });
            cachePut(keyOf(ws, path, hash, 0), { chunks: [{ offset: 0, count: p.count, bytes: p.data }] });
            return { kind: 'paged', pageSize: pageSizeFor(p.totalBytes, p.totalElements), totalRows: p.totalElements, totalBytes: p.totalBytes, pages: new Map(), loading: [] };
        } catch (err) {
            pageFailure(ws, path, hash, 0, err);
            return null;
        }
    };

    const loader: DatasetLoader = {
        async tick(ws, path, force = false) {
            const api = deps.api();
            if (api === null) return;
            const status = await api.datasetGetStatus(ws, treePathOf(path));
            const hash = status.hash.type === 'some' ? status.hash.value : null;
            const size = status.size.type === 'some' ? Number(status.size.value) : 0;
            const type = status.type;
            const before = current(ws, path);
            if (!force && before !== undefined && before.status !== null && before.hash === hash && before.mode.kind !== 'error') {
                if (before.size !== size) store.dispatch({ type: 'data/dataset', ws, path, data: { ...before, status, size } });
                return;
            }
            // A value that changed on the server under a pending edit: keep the base
            // the ops were made against and raise the conflict; `/reload` replays them.
            const edit = store.getState().edit;
            if (!force && edit !== null && edit.ws === ws && edit.path === path && edit.ops.length > 0 && hash !== edit.baseHash) {
                if (edit.conflict !== hash) store.dispatch({ type: 'edit/set', edit: { ...edit, conflict: hash } });
                return;
            }
            const base: DatasetData = { status, hash, type, size, mode: { kind: 'loading' }, forced: false };
            if (status.refType !== 'value' || hash === null) {
                store.dispatch({ type: 'data/dataset', ws, path, data: { ...base, mode: { kind: status.refType === 'null' ? 'null' : 'unset' } } });
                return;
            }
            store.dispatch({ type: 'data/dataset', ws, path, data: base });
            if (isCollectionType(type)) {
                // The status carries the stored geometry, so the page size is known
                // before a row is fetched; a server without it is probed once.
                const rows = status.rows.type === 'some' ? Number(status.rows.value) : null;
                const paged: PagedMode | null = rows !== null
                    ? { kind: 'paged', pageSize: pageSizeFor(size, rows), totalRows: rows, totalBytes: size, pages: new Map(), loading: [] }
                    : await probe(api, ws, path, hash);
                if (paged === null) return;
                setMode(ws, path, hash, paged);
                // The first window around wherever the view sits (a restored top row may be deep).
                const s = store.getState();
                const shown = viewDataset(s);
                const top = shown !== null && shown.ws === ws && shown.path === path && (s.view.kind === 'task' || s.view.kind === 'input') ? s.view.tree.top : 0;
                loader.needRows(ws, path, Math.max(0, top - paged.pageSize), top + INITIAL_WINDOW_ROWS + paged.pageSize);
            } else if (size <= INLINE_LIMIT) {
                await loadInline(api, ws, path, hash, type);
            } else {
                setMode(ws, path, hash, { kind: 'too-large' });
            }
        },
        needRows(ws, path, startRow, endRow) {
            const d = current(ws, path);
            if (d === undefined || d.mode.kind !== 'paged' || d.hash === null || d.type === null) return;
            const { pageSize, totalRows } = d.mode;
            const pageCount = Math.ceil(totalRows / pageSize);
            if (pageCount === 0) return;
            const first = Math.max(0, Math.min(Math.floor(startRow / pageSize), pageCount - 1));
            const last = Math.max(first, Math.min(Math.ceil(endRow / pageSize) - 1, pageCount - 1));
            const w: PageWindow = { hash: d.hash, first, last };
            windows.set(datasetKey(ws, path), w);
            const kept = pruneRetainedPages(d.mode.pages, first, last, MAX_RETAINED_PAGES);
            const loading = wantedMissing(w, { ...d.mode, pages: kept });
            if (kept !== d.mode.pages || !sameList(loading, d.mode.loading)) setMode(ws, path, d.hash, { ...d.mode, pages: kept, loading });
            pump(ws, path);
        },
        async reload(ws, path) {
            const d = current(ws, path);
            if (d !== undefined && d.hash !== null) {
                // Drop the whole-value in-flight key so the reload fetches afresh.
                wholeInflight.delete(keyOf(ws, path, d.hash, 'whole'));
            }
            await loader.tick(ws, path, true);
        },
        async loadWhole(ws, path) {
            const api = deps.api();
            const d = current(ws, path);
            if (api === null || d === undefined || d.hash === null || d.type === null) return;
            if (d.mode.kind !== 'not-indexed' || !d.mode.loadable) return;
            store.dispatch({ type: 'data/dataset', ws, path, data: { ...d, mode: { kind: 'loading' }, forced: true } });
            await loadInline(api, ws, path, d.hash, d.type);
        },
        async findKey(ws, path, query) {
            const api = deps.api();
            const d = current(ws, path);
            if (api === null || d === undefined || d.type === null) return notFound;
            if (d.mode.kind === 'paged') {
                if (d.hash === null) return notFound;
                const r = await api.datasetFindKey(ws, treePathOf(path), { ...query, hash: d.hash });
                return { found: r.found, row: r.row, count: r.count };
            }
            if (d.mode.kind === 'inline') {
                const keyType = keyTypeOf(d.type);
                const keys = collectionKeys(d.type, d.mode.value);
                if (keyType === null || keys === null) return notFound;
                return findKeyInline(keyType, keys, query);
            }
            return notFound;
        },
        async bytes(ws, path) {
            const api = deps.api();
            if (api === null) throw new Error('no session is open');
            return (await api.datasetGet(ws, treePathOf(path))).data;
        },
        reset() {
            wholeInflight.clear();
            cache.clear();
            windows.clear();
            inflight.clear();
            retryAt.clear();
            for (const { timer } of retryPump.values()) clearTimeout(timer);
            retryPump.clear();
        },
    };
    return loader;
}
