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
 * (Array / Set / Dict) → *paged* through `datasetGetPage` in 500-row
 * windows, read-only, at every size; any other root ≤ 200 KB → fetched
 * whole, decoded and materialized into the tree (*inline*); larger → *too
 * large* (`/save` still works). The server's refusals map to states:
 * `dataset_not_indexed` (a legacy blob) → *not indexed* with a `⏎ load
 * whole value` fallback up to 64 MB, `dataset_too_large` → *too large*,
 * `dataset_hash_mismatch` → the status is refetched.
 *
 * Pages are keyed `(ws, path, hash, page)`: raw bytes stay in a small
 * cache so a page that was evicted from the eight retained around the
 * window re-materializes without a request; one fetch is in flight per
 * key. Decoding and materializing yield to the renderer first.
 *
 * @packageDocumentation
 */

import { decodeBeast2For, variant, type EastTypeValue } from '@elaraai/east';
import { ValueTree } from '@elaraai/east-ui';
import { findKeyInline, pruneRetainedPages, type DatasetKeyMatchRange, type DatasetKeyQuery, type ValueTreePagedRow } from '@elaraai/east-ui/internal';
import { apiCode, describeError, treePathOf, type Api } from '../api.js';
import { PAGE_SIZE, applyAnchor, captureAnchor, collectionKeys, isCollectionType, keyTypeOf, viewDataset } from '../model/tree.js';
import type { DatasetData, DatasetMode } from '../state/actions.js';
import type { Store } from '../state/store.js';

export { PAGE_SIZE, collectionKeys, isCollectionType, keyTypeOf, viewDataset };

/** Non-collection values up to this many bytes are fetched whole. */
export const INLINE_LIMIT = 200 * 1024;
/** `⏎ load whole value` on a not-indexed collection is offered up to this size. */
export const WHOLE_LIMIT = 64 * 1024 * 1024;
/** Loaded pages retained around the window. */
export const MAX_RETAINED_PAGES = 8;
/** Raw page bytes kept per session (a return re-materializes without a request). */
export const MAX_CACHED_PAGES = 32;
/** Root rows requested around the first window before the view has scrolled. */
const INITIAL_WINDOW_ROWS = 60;

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
    if (type.type === 'Array') {
        const elemType = type.value as EastTypeValue;
        return (decoded as unknown[]).map((el, i) => ({ node: ValueTree.materialize(elemType, el), step: variant('index', BigInt(offset + i)) }));
    }
    if (type.type === 'Dict') {
        const { key: keyType, value: valueType } = type.value as { key: EastTypeValue; value: EastTypeValue };
        const stringKeys = keyType.type === 'String';
        return Array.from((decoded as Map<unknown, unknown>).entries()).map(([k, v], i) => ({
            node: ValueTree.materialize(valueType, v),
            step: stringKeys ? variant('key', k as string) : variant('index', BigInt(offset + i)),
            label: stringKeys ? (k as string) : ValueTree.keyLabel(keyType, k),
        }));
    }
    const elemType = type.value as EastTypeValue;
    return Array.from((decoded as Set<unknown>).values()).map((el, i) => ({ node: ValueTree.materialize(elemType, el), step: variant('index', BigInt(offset + i)) }));
}

/** What the loader needs. */
export interface DatasetLoaderDeps {
    store: Store;
    api: () => Api | null;
    log?: ((line: string) => void) | undefined;
}

/** The dataset loader. */
export interface DatasetLoader {
    /** Polls the status and (re)loads the content on a new hash (`force` also past a pending edit's conflict). */
    tick(ws: string, path: string, force?: boolean): Promise<void>;
    /** Reloads the content now, past any conflict (`/reload`). */
    reload(ws: string, path: string): Promise<void>;
    /** Requests the pages covering root rows `[startRow, endRow)` (with retention). */
    needRows(ws: string, path: string, startRow: number, endRow: number): void;
    /** `⏎ load whole value` on a not-indexed collection. */
    loadWhole(ws: string, path: string): Promise<void>;
    /** Locates a key query: server-side for a paged value, in memory for an inline one. */
    findKey(ws: string, path: string, query: DatasetKeyQuery): Promise<DatasetKeyMatchRange>;
    /** The stored bytes (`/save`). */
    bytes(ws: string, path: string): Promise<Uint8Array>;
    /** Drops the caches and in-flight bookkeeping. */
    reset(): void;
}

const yieldToRender = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

/**
 * Creates the loader.
 *
 * @param deps - The store, the API accessor, the log
 * @returns The loader
 */
export function createDatasetLoader(deps: DatasetLoaderDeps): DatasetLoader {
    const { store } = deps;
    const inflight = new Set<string>();
    const cache = new Map<string, { bytes: Uint8Array; totalRows: number; totalBytes: number }>();
    const keyOf = (ws: string, path: string, hash: string, page: number | 'whole'): string => `${ws}\n${path}\n${hash}\n${page}`;
    const current = (ws: string, path: string): DatasetData | undefined => store.getState().data.dataset[ws]?.[path];
    const notFound: DatasetKeyMatchRange = { found: false, row: 0, count: 0 };

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

    const cachePut = (key: string, entry: { bytes: Uint8Array; totalRows: number; totalBytes: number }): void => {
        cache.delete(key);
        cache.set(key, entry);
        while (cache.size > MAX_CACHED_PAGES) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            cache.delete(oldest);
        }
    };

    const loadInline = async (api: Api, ws: string, path: string, hash: string, type: EastTypeValue): Promise<void> => {
        const key = keyOf(ws, path, hash, 'whole');
        if (inflight.has(key)) return;
        inflight.add(key);
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
            inflight.delete(key);
        }
    };

    const loadPage = async (api: Api, ws: string, path: string, hash: string, type: EastTypeValue, page: number): Promise<void> => {
        const key = keyOf(ws, path, hash, page);
        if (inflight.has(key)) return;
        inflight.add(key);
        const before = current(ws, path);
        if (before?.mode.kind === 'paged' && before.hash === hash && !before.mode.loading.includes(page)) {
            setMode(ws, path, hash, { ...before.mode, loading: [...before.mode.loading, page] });
        }
        try {
            let entry = cache.get(key);
            if (entry === undefined) {
                const p = await api.datasetGetPage(ws, treePathOf(path), { offset: page * PAGE_SIZE, limit: PAGE_SIZE, hash });
                entry = { bytes: p.data, totalRows: p.totalElements, totalBytes: p.totalBytes };
                cachePut(key, entry);
            }
            await yieldToRender();
            const rows = pageRows(type, decodeBeast2For(type)(entry.bytes), page * PAGE_SIZE);
            const now = current(ws, path);
            if (now === undefined || now.hash !== hash) return;
            if (now.mode.kind === 'paged') {
                const pages = new Map(now.mode.pages);
                pages.set(page, rows);
                setMode(ws, path, hash, { kind: 'paged', totalRows: entry.totalRows, totalBytes: entry.totalBytes, pages, loading: now.mode.loading.filter(p => p !== page) });
            } else {
                setMode(ws, path, hash, { kind: 'paged', totalRows: entry.totalRows, totalBytes: entry.totalBytes, pages: new Map([[page, rows]]), loading: [] });
            }
        } catch (err) {
            const code = apiCode(err);
            const now = current(ws, path);
            if (code === 'dataset_hash_mismatch') {
                deps.log?.(`dataset ${ws}${path} page ${page}: hash mismatch — refetching the status`);
                void loader.tick(ws, path);
            } else if (code === 'dataset_not_indexed') {
                setMode(ws, path, hash, { kind: 'not-indexed', loadable: (now?.size ?? 0) <= WHOLE_LIMIT });
            } else if (code === 'dataset_too_large') {
                setMode(ws, path, hash, { kind: 'too-large' });
            } else if (now?.mode.kind === 'paged') {
                deps.log?.(`dataset ${ws}${path} page ${page} failed: ${describeError(err)}`);
                setMode(ws, path, hash, { ...now.mode, loading: now.mode.loading.filter(p => p !== page) });
            } else {
                deps.log?.(`dataset ${ws}${path} first page failed: ${describeError(err)}`);
                setMode(ws, path, hash, { kind: 'error', message: describeError(err) });
            }
        } finally {
            inflight.delete(key);
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
                await loadPage(api, ws, path, hash, type, 0);
                // The first window around wherever the view sits (a restored top row may be deep).
                const s = store.getState();
                const shown = viewDataset(s);
                const top = shown !== null && shown.ws === ws && shown.path === path && (s.view.kind === 'task' || s.view.kind === 'input') ? s.view.tree.top : 0;
                loader.needRows(ws, path, Math.max(0, top - PAGE_SIZE), top + INITIAL_WINDOW_ROWS + PAGE_SIZE);
            } else if (size <= INLINE_LIMIT) {
                await loadInline(api, ws, path, hash, type);
            } else {
                setMode(ws, path, hash, { kind: 'too-large' });
            }
        },
        needRows(ws, path, startRow, endRow) {
            const api = deps.api();
            const d = current(ws, path);
            if (api === null || d === undefined || d.mode.kind !== 'paged' || d.hash === null || d.type === null) return;
            const pageCount = Math.ceil(d.mode.totalRows / PAGE_SIZE);
            const first = Math.max(0, Math.min(Math.floor(startRow / PAGE_SIZE), Math.max(0, pageCount - 1)));
            const last = Math.max(first, Math.min(Math.ceil(endRow / PAGE_SIZE) - 1, pageCount - 1));
            const missing: number[] = [];
            for (let p = first; p <= last; p++) if (!d.mode.pages.has(p)) missing.push(p);
            // Retention counts the pages about to land, so the cap holds after they do.
            const pruned = pruneRetainedPages(d.mode.pages, first, last, Math.max(1, MAX_RETAINED_PAGES - missing.length));
            if (pruned !== d.mode.pages) setMode(ws, path, d.hash, { ...d.mode, pages: pruned });
            for (const p of missing) void loadPage(api, ws, path, d.hash, d.type, p);
        },
        async reload(ws, path) {
            const d = current(ws, path);
            if (d !== undefined && d.hash !== null) {
                // Drop the whole-value in-flight key so the reload fetches afresh.
                inflight.delete(keyOf(ws, path, d.hash, 'whole'));
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
            inflight.clear();
            cache.clear();
        },
    };
    return loader;
}
