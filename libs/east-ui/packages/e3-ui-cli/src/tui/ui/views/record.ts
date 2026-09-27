/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The record view — a record's state and its history. `1 State` is the
 * record's rows as a read-only paged tree, as a task's output is, and
 * `/index <name>` pages through one of its indexes instead, each entry a
 * row labelled by its index key, `/index primary` back; `2 History` lists
 * its commits newest first, the next page read as the selection nears the
 * last one read.
 *
 * @packageDocumentation
 */

import type { RecordCommitInfo } from '@elaraai/e3-api-client';
import { registerViewHooks, type Controller } from '../../controller.js';
import { listModel, registerListModel } from '../../model/index.js';
import { recordSource } from '../../model/tree.js';
import { compactType } from '../../model/types.js';
import { breakpoint, columnPlan } from '../../render/layout.js';
import { formatInt, formatSize, formatStamp, hashMid } from '../../render/text.js';
import type { Glyphs } from '../../render/glyphs.js';
import { RECORD_TABS, type RecordData, type RecordTab, type TuiState } from '../../state/actions.js';
import type { Hit, Pane } from '../frame.js';
import { blank, d, lrLine, rule, t, type Line } from '../lines.js';
import { centredBlock, renderTable, tabStrip, tabStripHits, withScrollbar, type TableRow } from '../shell/widgets.js';
import { clickTree, renderTreeRows, restoreTree, scrollTree, treeCommand, treeContext, treeFooter, treeKey, treeModel, treeToolbar, TREE_CHROME_ROWS } from '../widgets/tree.js';
import { datasetLine } from './task.js';
import { registerView } from './index.js';

const TAB_LABELS: Record<RecordTab, string> = { state: 'State', history: 'History' };

/** Rows the header lines, the dashed rule and the history table's header take. */
export const HISTORY_CHROME_ROWS = 4;

/** How close to the last commit read the selection comes before the next page is read. */
const MORE_WITHIN = 5;

/**
 * The title line's right side: `RECORD · 200,000 rows · 3 mutations · 1 index`.
 *
 * @param facts - What is known of the record
 * @param g - The glyph set
 * @returns The line
 */
export function recordTitle(facts: RecordData | undefined, g: Glyphs): Line {
    const parts = ['RECORD'];
    if (facts?.rows != null) parts.push(`${formatInt(facts.rows)} rows`);
    const signature = facts?.signature ?? null;
    if (signature !== null) {
        const m = signature.mutations.length;
        const i = signature.indexes.length;
        parts.push(`${m} mutation${m === 1 ? '' : 's'}`, `${i} ind${i === 1 ? 'ex' : 'exes'}`);
    }
    return [d(parts.join(` ${g.sep} `))];
}

/**
 * The line under the tabs while an index is shown:
 * `.records.ledger · index by_site · String key · joins each row · 200,000 entries · 3.1 MB`.
 *
 * @param state - The store state
 * @param ws - The workspace
 * @param name - The record
 * @param index - The index shown
 * @param g - The glyph set
 * @returns The line
 */
function indexLine(state: TuiState, ws: string, name: string, index: string, g: Glyphs): Line {
    const data = state.data.dataset[ws]?.[recordSource(name, index)];
    const declared = state.data.records[ws]?.[name]?.signature?.indexes.find(i => i.name === index);
    const parts = [`.records.${name}`, `index ${index}`];
    if (declared !== undefined) {
        parts.push(`${compactType(declared.keyType)} key${declared.multi ? 's' : ''}`);
        parts.push(declared.valueType.type === 'Null' ? 'joins each row' : `projects ${compactType(declared.valueType)}`);
    }
    if (data?.mode.kind === 'paged') parts.push(`${formatInt(data.mode.totalRows)} entries`, formatSize(data.mode.totalBytes));
    return [t(' '), d(parts.join(` ${g.sep} `))];
}

/**
 * The commits of a record the History tab lists, newest first.
 *
 * @param state - The store state
 * @param ws - The workspace
 * @param name - The record
 * @returns The commits read so far
 */
export function commitsOf(state: TuiState, ws: string, name: string): RecordCommitInfo[] {
    return state.data.records[ws]?.[name]?.history ?? [];
}

/** The history table's rows: e3's own commits (`$deploy`, `$compact`, …) muted, the newest marked. */
function historyRows(commits: readonly RecordCommitInfo[], g: Glyphs): TableRow[] {
    return commits.map((commit, i) => ({
        cells: {
            when: formatStamp(commit.at),
            mutation: { text: commit.mutation, tone: commit.mutation.startsWith('$') ? 'muted' : undefined },
            actor: commit.actor,
            commit: `${hashMid(commit.hash)}${i === 0 ? `   ${g.left} head` : ''}`,
        },
    }));
}

registerListModel('record', (state, layout) => {
    if (state.view.kind !== 'record') return { count: 0, visible: 0 };
    const { ws, name, tab } = state.view;
    if (tab === 'history') return { count: commitsOf(state, ws, name).length, visible: Math.max(1, layout.bodyRows - HISTORY_CHROME_ROWS) };
    const tctx = treeContext(state);
    if (tctx === null) return { count: 0, visible: 0 };
    const model = treeModel(tctx.data, tctx.tree, tctx.editable);
    return { count: model?.total ?? 0, visible: Math.max(1, layout.bodyRows - TREE_CHROME_ROWS) };
});

registerView('record', (state, ctx) => {
    if (state.view.kind !== 'record') return { body: [], hints: { left: '', right: '' } };
    const { ws, name, tab, index } = state.view;
    const g = ctx.g;
    const width = ctx.layout.columns;
    const labels = RECORD_TABS.map(x => TAB_LABELS[x]);
    const facts = state.data.records[ws]?.[name];
    const rowsPath = recordSource(name, null);
    const body: Line[] = [
        lrLine(tabStrip(name, labels, RECORD_TABS.indexOf(tab), g), [...recordTitle(facts, g), t(' ')], width),
        index === null || tab === 'history' ? datasetLine(state.data.dataset[ws]?.[rowsPath], rowsPath, false, ctx) : indexLine(state, ws, name, index, g),
        rule(width, g.dashed),
    ];
    const hits: Hit[] = tabStripHits(name, labels, g).map(h => ({ row: 0, x0: h.x0, x1: h.x1, target: { kind: 'tab', index: h.index } }));
    if (tab === 'history') {
        const commits = commitsOf(state, ws, name);
        const visible = Math.max(1, ctx.layout.bodyRows - HISTORY_CHROME_ROWS);
        const list = state.view.history;
        // A chain rewritten under the view is shorter than where it was scrolled to.
        const top = Math.max(0, Math.min(list.top, Math.max(0, commits.length - visible)));
        const table = renderTable(columnPlan('history', breakpoint(state.size)), historyRows(commits, g), list.sel, top, visible, width - 1, g);
        const rows = table.slice(1);
        if (commits.length === 0) rows.push([t('  '), d(facts?.history == null ? 'loading…' : 'no commits')]);
        while (rows.length < visible) rows.push(blank(width - 1));
        body.push(table[0]!, ...withScrollbar(rows.slice(0, visible), width, commits.length, visible, top, g));
        for (let i = top; i < Math.min(commits.length, top + visible); i++) hits.push({ row: HISTORY_CHROME_ROWS + (i - top), x0: 0, x1: width - 1, target: { kind: 'list', index: i } });
        const pane: Pane = { top: HISTORY_CHROME_ROWS, rows: visible, total: commits.length, visible, scrollTop: top };
        // Nothing is counted until the first page is read.
        const count = facts?.history == null ? ''
            : `${formatInt(commits.length)}${facts.complete === false && commits.length > 0 ? '+' : ''} commit${commits.length === 1 ? '' : 's'}`;
        return { body, hits, pane, hints: { left: `${g.up}${g.down} move   1 state   esc back`, right: count } };
    }
    const data = state.data.dataset[ws]?.[recordSource(name, index)];
    const rows = Math.max(1, ctx.layout.bodyRows - TREE_CHROME_ROWS);
    const screen = (glyph: string, tone: 'muted' | 'warn' | 'neg', title: string, lines: string[]): void => {
        const block = centredBlock(glyph, tone, title, lines, width);
        while (block.length < rows + 1) block.push(blank(width));
        body.push(...block.slice(0, rows + 1));
    };
    const idle = { left: '2 history   esc back', right: '' };
    if (data === undefined || data.mode.kind === 'loading') {
        screen(g.loading, 'muted', 'LOADING', [data === undefined ? 'reading the record' : index === null ? 'fetching its rows' : `fetching index ${index}`]);
        return { body, hits, hints: idle };
    }
    switch (data.mode.kind) {
        case 'unset':
        case 'null':
            screen(g.empty, 'muted', 'NO STATE', [`${name} holds no state yet`]);
            return { body, hits, hints: idle };
        case 'error':
            screen(g.cross, 'neg', 'COULD NOT LOAD', [data.mode.message, index === null ? 'R  retry' : 'R  retry    /index primary  the rows']);
            return { body, hits, hints: idle };
        case 'too-large':
        case 'not-indexed':
            screen(g.half, 'warn', 'TOO LARGE TO SHOW INLINE', [
                `${name} ${g.sep} ${data.type !== null ? compactType(data.type) : '?'} ${g.sep} ${formatSize(data.size)} — not a collection, so it cannot be paged`,
                `s  save to ${ws}.${name}.beast2`,
            ]);
            return { body, hits, hints: idle };
        default:
            break;
    }
    const tctx = treeContext(state);
    const model = tctx === null ? null : treeModel(tctx.data, tctx.tree, tctx.editable);
    const left = `${g.up}${g.down} move   ${g.right} expand   ${g.left} collapse   /find <key>   /goto <row|%>   /index <name>   s save   2 history`;
    if (tctx === null || model === null) return { body, hits, hints: { left, right: '' } };
    const loading = data.mode.kind === 'paged' ? data.mode.loading : [];
    body.push(...renderTreeRows(model, tctx.tree, loading, rows, width, g));
    body.push(treeFooter(model, tctx.tree, loading, rows, width, g, 's save .beast2'));
    const top = Math.max(0, Math.min(tctx.tree.top, Math.max(0, model.total - rows)));
    for (let i = top; i < Math.min(model.total, top + rows); i++) {
        const at = model.at(i);
        hits.push({ row: 3 + (i - top), x0: 0, x1: width - 1, target: { kind: 'tree', flat: i, twistX: at?.kind === 'model' ? 1 + 2 * at.row.depth : null } });
    }
    const footer = 3 + rows;
    const toolbar = `${g.expanded} expand all  ${g.collapsed} collapse all  s save .beast2 `;
    const start = width - toolbar.length;
    for (const [text, action] of [[`${g.expanded} expand all`, 'expandAll'], [`${g.collapsed} collapse all`, 'collapseAll'], ['s save .beast2', 'save']] as const) {
        const at = toolbar.indexOf(text);
        if (at >= 0) hits.push({ row: footer, x0: start + at, x1: start + at + text.length, target: { kind: 'toolbar', action } });
    }
    const pane: Pane = { top: 3, rows, total: model.total, visible: rows, scrollTop: top };
    return { body, hits, pane, hints: { left, right: '' } };
});

/**
 * `/index <name>` pages through one of the record's indexes, and
 * `/index primary` through its rows again. An index the record does not
 * declare is refused once its signature is read; before then the loader
 * says so.
 *
 * @param state - The store state
 * @param controller - The controller
 * @param index - The index, or `primary`
 */
function switchIndex(state: TuiState, controller: Controller, index: string): void {
    if (state.view.kind !== 'record') return;
    const { ws, name } = state.view;
    const next = index === 'primary' ? null : index;
    const signature = state.data.records[ws]?.[name]?.signature ?? null;
    const declared = signature?.indexes.map(i => i.name) ?? [];
    if (next !== null && signature !== null && !declared.includes(next)) {
        controller.toast(declared.length > 0 ? `${name} has no index ${next} — it has ${declared.join(', ')}` : `${name} declares no index`, 'warn');
        return;
    }
    if (next !== state.view.index) controller.dispatch({ type: 'record/index', index: next });
    if (state.view.tab !== 'state') controller.dispatch({ type: 'record/tab', tab: 'state' });
    if (next !== state.view.index) restoreTree(controller, ws, recordSource(name, next));
}

/** Reads the next page of the history once the selection nears the last commit read. */
function historyMore(controller: Controller): void {
    const state = controller.state();
    if (state.view.kind !== 'record' || state.view.tab !== 'history') return;
    const { ws, name } = state.view;
    const facts = state.data.records[ws]?.[name];
    const commits = facts?.history ?? [];
    if (facts === undefined || facts.complete || commits.length === 0) return;
    if (state.view.history.sel >= commits.length - MORE_WITHIN) void controller.deps.feeds.records.history(ws, name, true);
}

registerViewHooks('record', {
    click: (target, event, state, controller) => {
        if (state.view.kind !== 'record') return false;
        if (state.view.tab === 'history') {
            if (target.kind !== 'list') return false;
            const model = listModel(state);
            controller.dispatch({ type: 'list/select', index: target.index, count: model.count, visible: model.visible });
            historyMore(controller);
            return true;
        }
        if (target.kind === 'tree') { clickTree(state, controller, target.flat, target.twistX !== null && event.x === target.twistX); return true; }
        if (target.kind === 'toolbar') {
            if (target.action === 'save') void controller.execute('/save');
            else treeToolbar(state, controller, target.action);
            return true;
        }
        return false;
    },
    scroll: (to, state, controller) => {
        if (state.view.kind !== 'record') return false;
        if (state.view.tab === 'state') {
            scrollTree(state, controller, to);
            return true;
        }
        const model = listModel(state);
        if (model.count === 0) return true;
        const delta = 'delta' in to ? to.delta : to.top - state.view.history.top;
        controller.dispatch({ type: 'list/scroll', delta, count: model.count, visible: model.visible });
        historyMore(controller);
        return true;
    },
    tree: (action, state, controller) => (state.view.kind === 'record' && state.view.tab === 'state' ? treeKey(action, state, controller) : false),
    key: (action, state, controller) => {
        if (state.view.kind !== 'record') return false;
        if (state.view.tab === 'history') {
            if (action.kind !== 'move') return false;
            const model = listModel(state);
            controller.dispatch({ type: 'list/move', op: action.op, count: model.count, visible: model.visible });
            historyMore(controller);
            return true;
        }
        if (action.kind === 'back' || action.kind === 'save' || action.kind === 'next' || action.kind === 'prev') return treeKey(action, state, controller);
        return false;
    },
    command: async (command, state, controller) => {
        if (state.view.kind !== 'record') return false;
        if (command.name === 'index') {
            switchIndex(state, controller, command.target);
            return true;
        }
        if (state.view.tab === 'state') return treeCommand(command, state, controller);
        return false;
    },
});
