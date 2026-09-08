/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The value tree widget — rows from the row model `@elaraai/east-ui`
 * shares with the browser (`flattenRows` inline, `flattenPaged` paged), so
 * a value reads identically in both: the same labels, summaries, row ids
 * and expand semantics. This module renders a window of rows with the
 * scrollbar and the footer, and drives the tree from the keyboard and the
 * command box: move / expand-or-next / collapse-or-parent / toggle / deep
 * collapse, `/find` (server-side for paged values, in memory inline) with
 * `n` / `N` and a held highlight, `/goto <row|N%>`, `/save`, the paged
 * window requests, and the expand-set + top row persisted per
 * `${ws}:${path}`.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseFor, printFor, StringType, type EastTypeValue } from '@elaraai/east';
import {
    fmtLeaf,
    keySignature,
    pageOfFlat,
    parseKeyInput,
    type DatasetKeyQuery,
    type ParsedKeyInput,
    type RowModel,
} from '@elaraai/east-ui/internal';
import type { Controller } from '../../controller.js';
import type { ParsedCommand } from '../../input/commands.js';
import type { KeyAction } from '../../input/keymap.js';
import { layoutOf } from '../../model/index.js';
import { PAGE_SIZE, treeModel, viewDataset, type TreeModel } from '../../model/tree.js';
import type { Glyphs } from '../../render/glyphs.js';
import { labelWidth, scrollIntoView } from '../../render/layout.js';
import { formatInt, formatSize, padEnd, percent } from '../../render/text.js';
import type { DatasetData, MatchUi, TreeUi, TuiState, View } from '../../state/actions.js';
import { repoEntry } from '../../state/persist.js';
import { b, d, t, type Line } from '../lines.js';
import { withScrollbar } from '../shell/widgets.js';

export { treeModel, type TreeModel };

/** Context rows kept above a jump target. */
const JUMP_CONTEXT_ROWS = 2;
/** Rows the header lines, the dashed rule and the footer take in a tree view. */
export const TREE_CHROME_ROWS = 4;
/** How long a jump waits for its page. */
const JUMP_WAIT_MS = 10_000;

/** A leaf's display text: strings quoted, the rest as the row model prints them. */
export function leafText(leaf: NonNullable<RowModel['leaf']>): string {
    return leaf.type === 'string' ? JSON.stringify(leaf.value) : fmtLeaf(leaf);
}

/** The value cell of a row. */
export function valueText(row: RowModel): string {
    if (row.leaf !== undefined) return leafText(row.leaf);
    if (row.opaque !== undefined) return row.opaque;
    if (row.kind === 'appendArray' || row.kind === 'appendDict') return '';
    const summary = row.summary ?? '';
    if (row.variantCtl !== undefined && !summary.startsWith(row.variantCtl.tag)) return summary === '' ? row.variantCtl.tag : `${row.variantCtl.tag} · ${summary}`;
    return summary;
}

/** Whether a root row is inside the held match. */
function inMatch(row: RowModel, match: MatchUi | null): boolean {
    if (match === null || row.depth !== 0) return false;
    const root = row.posinset - 1;
    return root >= match.row && root < match.row + match.count;
}

/**
 * Renders the visible window of a tree with its scrollbar.
 *
 * @param model - The tree model
 * @param tree - The tree UI (selection, top, held match)
 * @param loading - Pages being loaded (the first placeholder of each says so)
 * @param visible - Rows in the window
 * @param width - The row width including the scrollbar column
 * @param g - The glyph set
 * @param changed - Row ids with pending edits (`┆` in the gutter)
 * @returns The lines
 */
export function renderTreeRows(model: TreeModel, tree: TreeUi, loading: readonly number[], visible: number, width: number, g: Glyphs, changed?: ReadonlySet<string>): Line[] {
    const lw = labelWidth(width);
    const vw = Math.max(1, width - lw - 2);
    const top = Math.max(0, Math.min(tree.top, Math.max(0, model.total - visible)));
    const lines: Line[] = [];
    const noted = new Set<number>();
    for (let i = top; i < top + visible; i++) {
        const at = model.at(i);
        if (at === null) {
            lines.push([t(' '.repeat(width - 1))]);
            continue;
        }
        const selected = i === tree.sel;
        if (at.kind === 'placeholder') {
            const page = Math.floor(at.globalRow / PAGE_SIZE);
            let note = '';
            if (loading.includes(page) && !noted.has(page)) {
                noted.add(page);
                note = `   loading p${page}`;
            }
            lines.push([
                selected ? b(g.sel, 'brand') : t(' '),
                d(padEnd(`${g.placeholder} ${g.placeholder.repeat(26)}`, lw)),
                d(padEnd(`${g.placeholder.repeat(36)}${note}`, vw)),
            ]);
            continue;
        }
        const row = at.row;
        const twist = row.kind === 'appendArray' || row.kind === 'appendDict' ? g.add
            : row.expandable ? (row.expanded ? g.expanded : g.collapsed)
            : g.leaf;
        const label = padEnd(`${'  '.repeat(row.depth)}${twist} ${row.label}`, lw);
        const value = padEnd(valueText(row), vw);
        const matched = inMatch(row, tree.match);
        const marker = selected ? b(g.sel, 'brand') : changed?.has(row.id) === true ? b(g.edited, 'warn') : t(' ');
        const labelSpan = selected ? b(label, matched ? 'brand' : undefined) : matched ? b(label, 'brand') : t(label);
        const isValue = row.leaf !== undefined;
        const valueSpan = isValue ? (selected ? b(value) : t(value)) : d(value);
        lines.push([marker, labelSpan, valueSpan]);
    }
    return withScrollbar(lines, width, model.total, visible, top, g);
}

/**
 * The footer line: `rows a–b of N · p% · pK ▒ loading · match held until esc`
 * with the toolbar words flush right.
 *
 * @param model - The tree model
 * @param tree - The tree UI
 * @param loading - Pages being loaded
 * @param visible - Rows in the window
 * @param width - The row width
 * @param g - The glyph set
 * @param saveHint - The save word (`s save .beast2`), or empty
 * @returns The line
 */
export function treeFooter(model: TreeModel, tree: TreeUi, loading: readonly number[], visible: number, width: number, g: Glyphs, saveHint: string): Line {
    const total = model.total;
    const top = Math.max(0, Math.min(tree.top, Math.max(0, total - visible)));
    const first = total === 0 ? 0 : top + 1;
    const last = Math.min(total, top + visible);
    const parts: string[] = [`rows ${formatInt(first)}–${formatInt(last)} of ${formatInt(total)}`];
    if (model.paged !== null && total > visible) parts.push(percent(first, total));
    if (loading.length > 0) parts.push(`p${loading[0]} ${g.loading} loading`);
    if (tree.match !== null) parts.push('match held until esc');
    const left = ` ${parts.join(` ${g.sep} `)}`;
    const right = `${g.expanded} expand all  ${g.collapsed} collapse all${saveHint === '' ? '' : `  ${saveHint}`} `;
    const gap = Math.max(1, width - left.length - right.length);
    return [d(left), t(' '.repeat(gap)), d(right)];
}

// ---------------------------------------------------------------------------
// Driving the tree
// ---------------------------------------------------------------------------

/** The tree a view shows: where it is, its UI state, and how to write it back. */
export interface TreeContext {
    ws: string;
    path: string;
    editable: boolean;
    tree: TreeUi;
    data: DatasetData | undefined;
    visible: number;
    setTree: (tree: TreeUi) => View;
}

/**
 * The tree context of the current view (the task view's Output tab or an
 * input view).
 *
 * @param state - The store state
 * @returns The context, or null
 */
export function treeContext(state: TuiState): TreeContext | null {
    const shown = viewDataset(state);
    const v = state.view;
    if (shown === null || (v.kind !== 'task' && v.kind !== 'input')) return null;
    const visible = Math.max(1, layoutOf(state).bodyRows - TREE_CHROME_ROWS);
    return {
        ws: shown.ws,
        path: shown.path,
        editable: shown.editable,
        tree: v.tree,
        data: state.data.dataset[shown.ws]?.[shown.path],
        visible,
        setTree: (tree) => ({ ...v, tree }),
    };
}

/** The persisted-state key of a tree. */
export function treeStorageKey(ws: string, path: string): string {
    return `${ws}:${path}`;
}

/** Remembers a tree's expand-set and top row. */
function persistTree(controller: Controller, ctx: TreeContext, tree: TreeUi): void {
    const persist = controller.deps.persist;
    const session = controller.state().session;
    if (persist === null || session === null) return;
    persist.update(s => {
        repoEntry(s, session.stateKey).trees[treeStorageKey(ctx.ws, ctx.path)] = { open: tree.open, topRow: tree.top, baseDepth: tree.baseDepth, touched: controller.deps.now() };
    });
}

/**
 * Restores a tree's remembered expand-set and top row into the current view.
 *
 * @param controller - The controller
 * @param ws - The workspace
 * @param dataset - The dataset path
 */
export function restoreTree(controller: Controller, ws: string, dataset: string): void {
    const persist = controller.deps.persist;
    const session = controller.state().session;
    if (persist === null || session === null) return;
    const remembered = persist.state.repos[session.stateKey]?.trees[treeStorageKey(ws, dataset)];
    if (remembered === undefined) return;
    controller.dispatch({ type: 'tree/restore', open: remembered.open, top: remembered.topRow, baseDepth: remembered.baseDepth });
}

/** Requests the pages around the window (one page of margin each side). */
function requestWindow(controller: Controller, ctx: TreeContext, model: TreeModel, top: number): void {
    if (model.paged === null || model.total === 0) return;
    const { flat, paging } = model.paged;
    const startFlat = Math.max(0, Math.min(top, model.total - 1));
    const endFlat = Math.min(model.total - 1, startFlat + ctx.visible);
    const firstPage = Math.max(0, pageOfFlat(flat.prefix, startFlat) - 1);
    const lastPage = Math.min(flat.pageCount - 1, pageOfFlat(flat.prefix, endFlat) + 1);
    controller.deps.feeds.datasets.needRows(ctx.ws, ctx.path, firstPage * paging.pageSize, Math.min(paging.totalRows, (lastPage + 1) * paging.pageSize));
}

/** Writes a tree UI back, persists it, and requests the window's pages. */
function commit(controller: Controller, ctx: TreeContext, model: TreeModel | null, tree: TreeUi): void {
    const total = model?.total ?? 0;
    const top = Math.max(0, Math.min(tree.top, Math.max(0, total - ctx.visible)));
    const sel = Math.max(0, Math.min(tree.sel, Math.max(0, total - 1)));
    const next = { ...tree, sel, top };
    controller.dispatch({ type: 'view/set', view: ctx.setTree(next) });
    persistTree(controller, ctx, next);
    if (model !== null) requestWindow(controller, ctx, model, top);
}

/** Selects a flat row, scrolling minimally (or to `top` when given). */
function select(controller: Controller, ctx: TreeContext, model: TreeModel, sel: number, top?: number): void {
    const clamped = Math.max(0, Math.min(sel, Math.max(0, model.total - 1)));
    commit(controller, ctx, model, { ...ctx.tree, sel: clamped, top: top ?? scrollIntoView(ctx.tree.top, clamped, ctx.visible, model.total) });
}

/** Jumps to a root row: it lands two rows below the top of the window (the anchor keeps it there as pages arrive). */
function jumpToRoot(controller: Controller, ctx: TreeContext, model: TreeModel, root: number): boolean {
    const flat = model.flatOfRoot(root);
    if (flat === undefined) return false;
    select(controller, ctx, model, flat, Math.max(0, flat - JUMP_CONTEXT_ROWS));
    return true;
}

/** `G`: requests the last page, waits for it, then selects the very last row. */
async function jumpToEnd(controller: Controller, first: TreeContext, firstModel: TreeModel): Promise<void> {
    if (firstModel.paged !== null) {
        const lastRoot = Math.max(0, firstModel.rootCount - 1);
        controller.deps.feeds.datasets.needRows(first.ws, first.path, Math.max(0, lastRoot - PAGE_SIZE), lastRoot + 1);
        const deadline = Date.now() + JUMP_WAIT_MS;
        for (;;) {
            const ctx = treeContext(controller.state());
            if (ctx === null || ctx.ws !== first.ws || ctx.path !== first.path) return;
            const model = treeModel(ctx.data, ctx.tree, ctx.editable);
            if (model === null) return;
            const flat = model.flatOfRoot(lastRoot);
            if (flat === undefined || model.at(flat)?.kind === 'model' || Date.now() > deadline) {
                select(controller, ctx, model, model.total - 1, Math.max(0, model.total - ctx.visible));
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 15));
        }
    }
    select(controller, first, firstModel, firstModel.total - 1, Math.max(0, firstModel.total - first.visible));
}

/**
 * Scrolls the tree by rows (the wheel) or to a row (a thumb drag), keeping
 * the selection inside the window.
 *
 * @param state - The store state
 * @param controller - The controller
 * @param to - `{ delta }` rows, or `{ top }` absolute
 */
export function scrollTree(state: TuiState, controller: Controller, to: { delta: number } | { top: number }): void {
    const ctx = treeContext(state);
    if (ctx === null) return;
    const model = treeModel(ctx.data, ctx.tree, ctx.editable);
    if (model === null) return;
    const max = Math.max(0, model.total - ctx.visible);
    if ('top' in to && to.top >= max && model.paged !== null) {
        // The bottom of the track means the end of the collection, which is
        // further than the placeholders suggest until the last page lands.
        void jumpToEnd(controller, ctx, model);
        return;
    }
    const top = Math.max(0, Math.min('delta' in to ? ctx.tree.top + to.delta : to.top, max));
    const sel = Math.max(top, Math.min(ctx.tree.sel, top + ctx.visible - 1, Math.max(0, model.total - 1)));
    commit(controller, ctx, model, { ...ctx.tree, sel, top });
}

/**
 * A click on a tree row: selects it; on its twist, toggles it.
 *
 * @param state - The store state
 * @param controller - The controller
 * @param flat - The flat row clicked
 * @param onTwist - Whether the twist cell was clicked
 */
export function clickTree(state: TuiState, controller: Controller, flat: number, onTwist: boolean): void {
    const ctx = treeContext(state);
    if (ctx === null) return;
    const model = treeModel(ctx.data, ctx.tree, ctx.editable);
    if (model === null) return;
    const at = model.at(flat);
    if (at === null) return;
    commit(controller, ctx, model, { ...ctx.tree, sel: flat });
    if (onTwist && at.kind === 'model' && at.row.expandable) {
        controller.dispatch({ type: 'tree/toggle', id: at.row.id, expanded: !at.row.expanded });
        afterToggle(controller, ctx);
    }
}

/**
 * The footer toolbar: expand all / collapse all.
 *
 * @param state - The store state
 * @param controller - The controller
 * @param action - Which word was clicked
 */
export function treeToolbar(state: TuiState, controller: Controller, action: 'expandAll' | 'collapseAll'): void {
    const ctx = treeContext(state);
    if (ctx === null) return;
    controller.dispatch({ type: action === 'expandAll' ? 'tree/expandAll' : 'tree/collapseAll' });
    afterToggle(controller, ctx);
}

/**
 * Handles a key action on the tree.
 *
 * @param action - The action
 * @param state - The store state
 * @param controller - The controller
 * @returns `true` when handled
 */
export function treeKey(action: KeyAction, state: TuiState, controller: Controller): boolean {
    const ctx = treeContext(state);
    if (ctx === null) return false;
    const model = treeModel(ctx.data, ctx.tree, ctx.editable);
    if (action.kind === 'back') {
        if (ctx.tree.match === null) return false;
        controller.dispatch({ type: 'tree/match', match: null });
        return true;
    }
    if (action.kind === 'save') {
        void controller.execute('/save');
        return true;
    }
    if (model === null) return action.kind === 'move' || action.kind === 'expand' || action.kind === 'collapse' || action.kind === 'toggle' || action.kind === 'collapseDeep' || action.kind === 'next' || action.kind === 'prev';
    const at = model.at(ctx.tree.sel);
    const row = at?.kind === 'model' ? at.row : null;
    switch (action.kind) {
        case 'move': {
            if (action.op === 'end') {
                void jumpToEnd(controller, ctx, model);
                return true;
            }
            const last = Math.max(0, model.total - 1);
            const page = Math.max(1, ctx.visible - 1);
            const sel = ctx.tree.sel;
            const next = action.op === 'up' ? sel - 1 : action.op === 'down' ? sel + 1
                : action.op === 'pageUp' ? sel - page : action.op === 'pageDown' ? sel + page
                : 0;
            select(controller, ctx, model, Math.max(0, Math.min(next, last)), action.op === 'home' ? 0 : undefined);
            return true;
        }
        case 'expand': {
            if (row !== null && row.expandable && !row.expanded) {
                controller.dispatch({ type: 'tree/toggle', id: row.id, expanded: true });
                afterToggle(controller, ctx);
            } else {
                select(controller, ctx, model, ctx.tree.sel + 1);
            }
            return true;
        }
        case 'collapse': {
            if (row !== null && row.expandable && row.expanded) {
                controller.dispatch({ type: 'tree/toggle', id: row.id, expanded: false });
                afterToggle(controller, ctx);
            } else if (row !== null && row.parentId !== undefined) {
                const parent = model.flatOfId(row.parentId);
                if (parent !== undefined) select(controller, ctx, model, parent);
            }
            return true;
        }
        case 'toggle': {
            if (row !== null && row.expandable) {
                controller.dispatch({ type: 'tree/toggle', id: row.id, expanded: !row.expanded });
                afterToggle(controller, ctx);
            }
            return true;
        }
        case 'collapseDeep': {
            if (row !== null && row.expandable) {
                const descendants: string[] = [];
                for (let i = ctx.tree.sel + 1; i < model.total; i++) {
                    const next = model.at(i);
                    if (next === null || next.kind !== 'model' || next.row.depth <= row.depth) break;
                    if (next.row.expandable) descendants.push(next.row.id);
                }
                controller.dispatch({ type: 'tree/toggle', id: row.id, expanded: false, descendants });
                afterToggle(controller, ctx);
            }
            return true;
        }
        case 'next':
        case 'prev': {
            const match = ctx.tree.match;
            if (match === null || match.count === 0) {
                controller.toast('no match held — /find <key> first', 'warn');
                return true;
            }
            const index = ((match.index + (action.kind === 'next' ? 1 : -1)) % match.count + match.count) % match.count;
            controller.dispatch({ type: 'tree/match', match: { ...match, index } });
            const after = treeContext(controller.state());
            if (after !== null) jumpToRoot(controller, after, treeModel(after.data, after.tree, after.editable) ?? model, match.row + index);
            return true;
        }
        default:
            return false;
    }
}

/** After an expand-set change: persist and refresh the window's pages. */
function afterToggle(controller: Controller, before: TreeContext): void {
    const ctx = treeContext(controller.state());
    if (ctx === null) return;
    const model = treeModel(ctx.data, ctx.tree, ctx.editable);
    commit(controller, ctx, model, ctx.tree);
    void before;
}

/**
 * Parses `/find` text for a key type: a quoted string is an exact key,
 * `a|b` are struct-key fields, anything else goes to the shared grammar.
 *
 * @param keyType - The collection's key type
 * @param text - The typed text
 * @returns The wire query, or the hint to show
 */
export function parseFindText(keyType: EastTypeValue, text: string): ParsedKeyInput {
    const trimmed = text.trim();
    if (keyType.type === 'String' && /^".*"$/.test(trimmed)) {
        const parsed = parseFor(StringType)(trimmed);
        if (parsed.success) return { kind: 'query', query: { key: printFor(StringType)(parsed.value) } };
    }
    if (keyType.type === 'Struct') return parseKeyInput(keyType, trimmed.replace(/\|/g, ','));
    return parseKeyInput(keyType, trimmed);
}

/** The query's form word for the footer / toast. */
function formOf(query: DatasetKeyQuery): MatchUi['form'] {
    return 'key' in query ? 'exact' : 'fields' in query ? 'fields' : 'prefix';
}

/** The `/save` target: `<ws>.<name>.beast2` in the working directory unless a file is given. */
export function saveTarget(ws: string, dataset: string, file: string | undefined): string {
    if (file !== undefined) return path.resolve(file);
    const name = dataset.replace(/^\.(inputs|tasks)\./, '').replace(/\.output$/, '');
    return path.resolve(`${ws}.${name}.beast2`);
}

/**
 * Handles `/find`, `/goto` and `/save` on the tree.
 *
 * @param command - The parsed command
 * @param state - The store state
 * @param controller - The controller
 * @returns `true` when handled
 */
export async function treeCommand(command: ParsedCommand, state: TuiState, controller: Controller): Promise<boolean> {
    const ctx = treeContext(state);
    if (ctx === null) return false;
    const model = treeModel(ctx.data, ctx.tree, ctx.editable);
    switch (command.name) {
        case 'find': {
            if (model === null || model.keyType === null) {
                controller.toast('/find needs a Set or Dict value — /goto <row> moves by row', 'warn');
                return true;
            }
            const parsed = parseFindText(model.keyType, command.query);
            if (parsed.kind === 'hint') {
                controller.toast(`${parsed.hint} — key is ${keySignature(model.keyType)}`, 'warn');
                return true;
            }
            const result = await controller.deps.feeds.datasets.findKey(ctx.ws, ctx.path, parsed.query);
            const form = formOf(parsed.query);
            const after = treeContext(controller.state());
            const afterModel = after === null ? null : treeModel(after.data, after.tree, after.editable);
            if (after === null || afterModel === null) return true;
            if (!result.found) {
                controller.toast(`no ${form} match for ${command.query} — nearest row ${formatInt(Math.min(result.row, Math.max(0, afterModel.rootCount - 1)) + 1)}`, 'warn');
                controller.dispatch({ type: 'tree/match', match: null });
                jumpToRoot(controller, after, afterModel, Math.min(result.row, Math.max(0, afterModel.rootCount - 1)));
                return true;
            }
            controller.dispatch({ type: 'tree/match', match: { row: result.row, count: result.count, index: 0, text: command.query, form } });
            const held = treeContext(controller.state());
            if (held !== null) jumpToRoot(controller, held, afterModel, result.row);
            controller.toast(`${form} ${g(controller).sep} ${formatInt(result.count)} match${result.count === 1 ? '' : 'es'} from row ${formatInt(result.row + 1)} ${g(controller).sep} n N next/prev ${g(controller).sep} esc`, 'info');
            return true;
        }
        case 'goto': {
            if (model === null) {
                controller.toast('nothing to go to yet', 'warn');
                return true;
            }
            const roots = model.rootCount;
            const root = command.target.kind === 'row'
                ? command.target.row - 1
                : Math.round((command.target.percent / 100) * Math.max(0, roots - 1));
            if (root < 0 || root >= roots) {
                controller.toast(`row ${formatInt(root + 1)} is past the end — ${formatInt(roots)} rows`, 'warn');
                return true;
            }
            if (!jumpToRoot(controller, ctx, model, root)) controller.toast('that row is not loaded yet', 'warn');
            return true;
        }
        case 'save': {
            const target = saveTarget(ctx.ws, ctx.path, command.file);
            if (fs.existsSync(target) && !command.force) {
                controller.dispatch({ type: 'command/confirm', confirm: { question: `overwrite ${target}?`, command: `/save "${target}" --force` } });
                return true;
            }
            if (ctx.data === undefined || ctx.data.hash === null) {
                controller.toast('nothing to save — the dataset has no value', 'warn');
                return true;
            }
            const bytes = await controller.deps.feeds.datasets.bytes(ctx.ws, ctx.path);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, bytes);
            controller.toast(`saved ${formatSize(bytes.length)} to ${target}`, 'pos');
            return true;
        }
        default:
            return false;
    }
}

/** The glyphs of a controller (a shorthand). */
function g(controller: Controller): Glyphs {
    return controller.deps.glyphs;
}

/**
 * `⏎` on a not-indexed value loads it whole.
 *
 * @param state - The store state
 * @param controller - The controller
 * @returns `true` when a load was started
 */
export function treeOpen(state: TuiState, controller: Controller): boolean {
    const ctx = treeContext(state);
    if (ctx === null || ctx.data === undefined || ctx.data.mode.kind !== 'not-indexed') return false;
    if (!ctx.data.mode.loadable) {
        controller.toast(`too large to load whole (${formatSize(ctx.data.size)}) — /save writes the bytes`, 'warn');
        return true;
    }
    void controller.deps.feeds.datasets.loadWhole(ctx.ws, ctx.path);
    return true;
}
