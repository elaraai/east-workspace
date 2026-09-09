/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The value tree's model — the flat rows a dataset's content becomes
 * (`flattenRows` inline, `flattenPaged` paged, from the row model
 * `@elaraai/east-ui` shares with the browser), and the *anchor* that keeps
 * the selection on the same logical row while pages arrive and leave: a
 * paged tree's flat indices shift whenever a placeholder root becomes its
 * expanded rows (or the reverse), so the selection is remembered as a
 * global root row plus an offset into its subtree and re-applied after
 * every page change. The model is memoized on what the flatten reads, so
 * a keypress that only moves the selection never re-flattens the value
 * ({@link treeModel}).
 *
 * @packageDocumentation
 */

import type { EastTypeValue } from '@elaraai/east';
import {
    DEFAULT_OPEN_DEPTH,
    flatIndexOfRoot,
    flattenPaged,
    flattenRows,
    pagedFlatIndexOfRoot,
    pagedRowAt,
    type PagedFlat,
    type RowModel,
    type ValueTreePaging,
} from '@elaraai/east-ui/internal';
import type { DatasetData, TreeUi, TuiState, View } from '../state/actions.js';

/** Root rows fetched per page. */
export const PAGE_SIZE = 500;

/** Whether a dataset root type pages (Array / Set / Dict). */
export function isCollectionType(type: EastTypeValue): boolean {
    return type.type === 'Array' || type.type === 'Set' || type.type === 'Dict';
}

/**
 * The key type of a keyed collection (`/find` works over it).
 *
 * @param type - The dataset's root type
 * @returns The Dict key type / Set element type, or null
 */
export function keyTypeOf(type: EastTypeValue): EastTypeValue | null {
    if (type.type === 'Dict') return (type.value as { key: EastTypeValue; value: EastTypeValue }).key;
    if (type.type === 'Set') return type.value as EastTypeValue;
    return null;
}

/**
 * The keys of a decoded keyed collection in canonical order (the inline
 * counterpart of the server's row space).
 *
 * @param type - The dataset's root type
 * @param decoded - The decoded value
 * @returns The keys, or null for a non-keyed root
 */
export function collectionKeys(type: EastTypeValue, decoded: unknown): unknown[] | null {
    if (type.type === 'Dict') return [...(decoded as Map<unknown, unknown>).keys()];
    if (type.type === 'Set') return [...(decoded as Set<unknown>).values()];
    return null;
}

/** The dataset a view shows, if any. */
export function viewDataset(state: TuiState): { ws: string; path: string; editable: boolean } | null {
    const v = state.view;
    if (v.kind === 'task' && v.tab === 'output') return { ws: v.ws, path: `.tasks.${v.task}.output`, editable: false };
    if (v.kind === 'input') return { ws: v.ws, path: `.inputs.${v.name}`, editable: true };
    return null;
}

/** The tree's flat rows: inline (all loaded) or paged (loaded pages + placeholders). */
export interface TreeModel {
    /** Flat rows in total. */
    total: number;
    /** The loaded rows in flat order (every row when inline). */
    rows: RowModel[];
    paged: { flat: PagedFlat; paging: ValueTreePaging } | null;
    /** Root rows (depth 0) in total. */
    rootCount: number;
    /** The row at a flat index. */
    at(index: number): { kind: 'model'; row: RowModel } | { kind: 'placeholder'; globalRow: number } | null;
    /** The flat index of a root row ordinal. */
    flatOfRoot(root: number): number | undefined;
    /** The flat index of a row id, when loaded. */
    flatOfId(id: string): number | undefined;
    keyType: EastTypeValue | null;
}

/** The content a tree model is built from (an inline root or the loaded pages). */
type TreeContent = Extract<DatasetData['mode'], { kind: 'inline' | 'paged' }>;

/**
 * What the flatten reads: the parts of the data and the tree UI that decide
 * the rows. Everything else in the state — the selection, the top row, the
 * held match, the pages being loaded, the clock — leaves the rows as they
 * are, so the model is memoized on this key alone.
 */
interface TreeModelKey {
    type: EastTypeValue;
    kind: TreeContent['kind'];
    /** The materialized root (inline) — a new object whenever the value or the draft changes. */
    root: unknown;
    /** The loaded pages (paged) — a new map whenever a page arrives or leaves. */
    pages: unknown;
    totalRows: number;
    open: TreeUi['open'];
    baseDepth: number | undefined;
    editable: boolean;
}

let memo: { key: TreeModelKey; model: TreeModel } | null = null;
let builds = 0;

function sameKey(a: TreeModelKey, b: TreeModelKey): boolean {
    return a.type === b.type && a.kind === b.kind && a.root === b.root && a.pages === b.pages && a.totalRows === b.totalRows
        && a.open === b.open && a.baseDepth === b.baseDepth && a.editable === b.editable;
}

/**
 * How many times the tree model has been flattened — the memo's misses.
 * A pure move (selection, scroll, page request) must not add to it; a
 * toggle, a page arriving, or a new value adds one.
 *
 * @returns The build count since the module loaded
 */
export function treeModelBuilds(): number {
    return builds;
}

/** Flattens the content into a model (the memo's miss path). */
function buildTreeModel(type: EastTypeValue, mode: TreeContent, tree: TreeUi, editable: boolean): TreeModel {
    const openDepth = tree.baseDepth ?? DEFAULT_OPEN_DEPTH;
    const keyType = keyTypeOf(type);
    if (mode.kind === 'inline') {
        const rows = flattenRows(mode.root, tree.open, openDepth, editable, editable);
        const roots = rows.filter(r => r.depth === 0).length;
        return {
            total: rows.length,
            rows,
            paged: null,
            rootCount: roots,
            at: (i) => (i >= 0 && i < rows.length ? { kind: 'model', row: rows[i]! } : null),
            flatOfRoot: (root) => flatIndexOfRoot(rows, root),
            flatOfId: (id) => { const i = rows.findIndex(r => r.id === id); return i === -1 ? undefined : i; },
            keyType,
        };
    }
    const paging: ValueTreePaging = { totalRows: mode.totalRows, pageSize: PAGE_SIZE, pages: mode.pages, onNeedRows: () => undefined };
    const flat = flattenPaged(paging, tree.open, openDepth);
    return {
        total: flat.totalFlat,
        rows: flat.loadedRows,
        paged: { flat, paging },
        rootCount: mode.totalRows,
        at: (i) => (i >= 0 && i < flat.totalFlat ? pagedRowAt(flat, paging, i) : null),
        flatOfRoot: (root) => pagedFlatIndexOfRoot(flat, paging, root),
        flatOfId: (id) => {
            for (const [p, models] of flat.pageModels) {
                const j = models.findIndex(r => r.id === id);
                if (j !== -1) return flat.prefix[p]! + j;
            }
            return undefined;
        },
        keyType,
    };
}

/**
 * The tree model for a dataset's current content — flattened once per
 * (content, expand-set, base depth, editable) and shared by everything
 * that reads it in one keypress: the key handler, the list model, the
 * rows renderer and the mouse pane. A single-entry memo suffices: the
 * TUI shows one tree at a time, and every reader asks for the same one.
 *
 * @param data - The dataset data
 * @param tree - The tree UI (expand-set, base depth)
 * @param editable - Whether append / remove rows are offered
 * @returns The model, or null when the content is not a tree
 */
export function treeModel(data: DatasetData | undefined, tree: TreeUi, editable: boolean): TreeModel | null {
    if (data === undefined || data.type === null) return null;
    const mode = data.mode;
    if (mode.kind !== 'inline' && mode.kind !== 'paged') return null;
    const key: TreeModelKey = {
        type: data.type,
        kind: mode.kind,
        root: mode.kind === 'inline' ? mode.root : null,
        pages: mode.kind === 'paged' ? mode.pages : null,
        totalRows: mode.kind === 'paged' ? mode.totalRows : 0,
        open: tree.open,
        baseDepth: tree.baseDepth,
        editable,
    };
    if (memo !== null && sameKey(memo.key, key)) return memo.model;
    builds += 1;
    const model = buildTreeModel(data.type, mode, tree, editable);
    memo = { key, model };
    return model;
}

/** The selection of a paged tree as a logical position. */
export interface TreeAnchor {
    ws: string;
    path: string;
    /** The global root row the selection sits under. */
    root: number;
    /** Flat rows from that root to the selection. */
    offset: number;
    /** Flat rows from the window's top to the selection. */
    topOffset: number;
}

/**
 * Captures where the selection of the shown paged tree sits, before its
 * pages change.
 *
 * @param state - The store state
 * @param ws - The dataset's workspace
 * @param path - The dataset's path
 * @returns The anchor, or null when the view shows something else
 */
export function captureAnchor(state: TuiState, ws: string, path: string): TreeAnchor | null {
    const shown = viewDataset(state);
    const v = state.view;
    if (shown === null || shown.ws !== ws || shown.path !== path || (v.kind !== 'task' && v.kind !== 'input')) return null;
    const data = state.data.dataset[ws]?.[path];
    if (data?.mode.kind !== 'paged') return null;
    const model = treeModel(data, v.tree, shown.editable);
    if (model === null || model.total === 0) return null;
    const sel = Math.max(0, Math.min(v.tree.sel, model.total - 1));
    const at = model.at(sel);
    if (at === null) return null;
    if (at.kind === 'placeholder') return { ws, path, root: at.globalRow, offset: 0, topOffset: sel - v.tree.top };
    // The nearest depth-0 row at or before the selection is its root.
    for (let i = sel; i >= 0; i--) {
        const row = model.at(i);
        if (row === null) break;
        if (row.kind === 'placeholder') return { ws, path, root: row.globalRow, offset: 0, topOffset: sel - v.tree.top };
        if (row.row.depth === 0) return { ws, path, root: row.row.posinset - 1, offset: sel - i, topOffset: sel - v.tree.top };
    }
    return null;
}

/**
 * Re-applies an anchor after the pages changed: the selection lands on
 * the same root (at the same offset into its subtree, clamped) and the
 * window keeps it on the same screen line.
 *
 * @param state - The store state after the change
 * @param anchor - The captured anchor
 * @returns The view to set, or null when nothing moves
 */
export function applyAnchor(state: TuiState, anchor: TreeAnchor): View | null {
    const shown = viewDataset(state);
    const v = state.view;
    if (shown === null || shown.ws !== anchor.ws || shown.path !== anchor.path || (v.kind !== 'task' && v.kind !== 'input')) return null;
    const data = state.data.dataset[anchor.ws]?.[anchor.path];
    if (data?.mode.kind !== 'paged') return null;
    const model = treeModel(data, v.tree, shown.editable);
    if (model === null || model.total === 0) return null;
    const flat = model.flatOfRoot(anchor.root);
    if (flat === undefined) return null;
    let sel = flat;
    const at = model.at(flat);
    if (at !== null && at.kind === 'model') {
        // Stay inside the root's subtree.
        let end = flat;
        while (end + 1 < model.total) {
            const next = model.at(end + 1);
            if (next === null || next.kind === 'placeholder' || next.row.depth === 0) break;
            end++;
        }
        sel = Math.min(flat + anchor.offset, end);
    }
    const top = Math.max(0, Math.min(sel - anchor.topOffset, Math.max(0, model.total - 1)));
    if (sel === v.tree.sel && top === v.tree.top) return null;
    return { ...v, tree: { ...v.tree, sel, top } };
}
