/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The task view — the tab strip and the title lines, then the tab's body:
 * Output (the value tree over `.tasks.<task>.output` with its states — no
 * output yet, too large, not indexed, loading, error), Logs (the log view),
 * Runs (the execution history) and, for a `ui` task, Reads (its manifest).
 *
 * @packageDocumentation
 */

import { compactType } from '../../model/types.js';
import { eventCell, taskStatusCell } from '../../model/status.js';
import { registerListModel } from '../../model/index.js';
import { registerViewHooks } from '../../controller.js';
import { latestPerTask } from './dashboard.js';
import { agoShort, formatDuration, formatInt, formatSize, hashMid, hashShort, hashTiny } from '../../render/text.js';
import type { DatasetData, TuiState } from '../../state/actions.js';
import { blank, d, b, lrLine, rule, t, type Line, type RenderCtx } from '../lines.js';
import { centredBlock, tabStrip, tabStripHits } from '../shell/widgets.js';
import type { Hit, Pane } from '../frame.js';
import { clickTree, renderTreeRows, scrollTree, treeCommand, treeContext, treeFooter, treeKey, treeModel, treeOpen, treeToolbar, TREE_CHROME_ROWS } from '../widgets/tree.js';
import { logsCommand, logsContext, logsFooter, logsKey, logsTop, renderLogLines, scrollLogs, streamLine } from '../widgets/logs.js';
import { RUNS_CHROME_ROWS, renderRuns, runsOf } from '../widgets/runs.js';
import { manifestOf, manifestSummary, openRead, readRows, renderReads } from '../widgets/reads.js';
import { registerView } from './index.js';

/** The tab labels of a task (`Reads` only for a `ui` task). */
export function taskTabs(state: TuiState, ws: string, task: string): string[] {
    const ui = (state.data.taskList[ws] ?? []).some(x => x.name === task && x.kind.type === 'some' && x.kind.value === 'ui');
    return ui ? ['Output', 'Logs', 'Runs', 'Reads'] : ['Output', 'Logs', 'Runs'];
}

/** The title line's right side: `DATA TASK · ● UP-TO-DATE · cached · 38.4s · inputs 4be1…a9`. */
export function taskTitle(state: TuiState, ws: string, task: string, ctx: RenderCtx): Line {
    const g = ctx.g;
    const ui = taskTabs(state, ws, task).length === 4;
    const info = state.data.status[ws]?.result.tasks.find(x => x.name === task);
    const out: Line = [d(`${ui ? 'UI' : 'DATA'} TASK`)];
    if (info === undefined) {
        out.push(d(` ${g.sep} `), t('…'));
        return out;
    }
    const cell = taskStatusCell(info.status, g);
    out.push(d(` ${g.sep} `), b(`${cell.glyph} ${cell.word.toUpperCase()}`, cell.tone));
    if (cell.detail !== '') out.push(d(` ${g.sep} ${cell.detail}`));
    if (ui) {
        const manifest = manifestOf(state.data.taskDetails[ws]?.[task]);
        if (manifest !== null) out.push(d(` ${g.sep} ${manifestSummary(manifest, g)}`));
        return out;
    }
    const event = latestPerTask(state.data.execution[ws]?.events ?? []).find(e => e.value.task === task);
    if (event !== undefined && (event.type === 'complete' || event.type === 'failed')) out.push(d(` ${g.sep} ${formatDuration(event.value.duration)}`));
    else if (event !== undefined && event.type === 'cached' && cell.detail !== 'cached') out.push(d(` ${g.sep} ${eventCell(event, g).word}`));
    const newest = runsOf(state, ws, task)[0];
    if (newest !== undefined) out.push(d(` ${g.sep} inputs ${hashMid(newest.inputsHash)}`));
    return out;
}

/** The second line: `.tasks.forecast.output · Dict<String, Struct> · 1,240,000 entries · 84.2 MB · c71e0d92aa10`. */
export function datasetLine(data: DatasetData | undefined, path: string, ui: boolean, ctx: RenderCtx): Line {
    const g = ctx.g;
    const parts: string[] = [path];
    if (data?.type != null) {
        parts.push(compactType(data.type, ui));
        const mode = data.mode;
        const noun = data.type.type === 'Dict' ? 'entries' : 'items';
        if (mode.kind === 'paged') parts.push(`${formatInt(mode.totalRows)} ${noun}`);
        else if (mode.kind === 'inline' && (mode.root.type === 'array' || mode.root.type === 'dict')) {
            const n = mode.root.type === 'array' ? mode.root.value.items.length : mode.root.value.entries.length;
            parts.push(`${formatInt(n)} ${noun}`);
        }
    }
    if (data !== undefined && data.hash !== null) {
        parts.push(formatSize(data.size));
        parts.push(ui ? hashTiny(data.hash) : hashShort(data.hash));
    }
    return [t(' '), d(parts.join(` ${g.sep} `))];
}

/** The Output tab body under the dashed rule: the tree window and its footer, or a state screen. */
export function renderOutput(state: TuiState, ws: string, task: string, ctx: RenderCtx): Line[] {
    const g = ctx.g;
    const width = ctx.layout.columns;
    const rows = Math.max(1, ctx.layout.bodyRows - TREE_CHROME_ROWS);
    const tctx = treeContext(state);
    const data = tctx?.data;
    const name = task;
    const screen = (glyph: string, tone: 'pos' | 'neg' | 'warn' | 'muted' | 'info', title: string, body: string[]): Line[] => {
        const block = centredBlock(glyph, tone, title, body, width);
        while (block.length < rows + 1) block.push(blank(width));
        return block.slice(0, rows + 1);
    };
    if (data === undefined || data.mode.kind === 'loading') return screen(g.loading, 'muted', 'LOADING', [data === undefined ? 'reading the dataset status' : 'fetching the value']);
    const typeText = data.type !== null ? compactType(data.type) : '?';
    switch (data.mode.kind) {
        case 'unset':
            return screen(g.empty, 'muted', 'NO OUTPUT YET', [`${name} has not produced a value`, 'r  run the dataflow']);
        case 'null':
            return screen(g.empty, 'muted', 'NULL', [`${name} produced a null value`]);
        case 'too-large':
            return screen(g.half, 'warn', 'TOO LARGE TO SHOW INLINE', [
                `${name} ${g.sep} ${typeText} ${g.sep} ${formatSize(data.size)} — not a collection, so it cannot be paged`,
                `s  save to ${name}.beast2        e3 dataset get ${ws}.${name}`,
            ]);
        case 'not-indexed':
            return screen(g.half, 'warn', 'NOT INDEXED', [
                `${name} ${g.sep} this value predates paged storage (dataset_not_indexed)`,
                `re-run the producing task to re-write it    s save${data.mode.loadable ? `    ${g.enter} load whole value (${formatSize(data.size)})` : ''}`,
            ]);
        case 'error':
            return screen(g.cross, 'neg', 'COULD NOT LOAD', [data.mode.message, 'R  retry    s save']);
        default:
            break;
    }
    if (tctx === null) return [];
    const model = treeModel(data, tctx.tree, tctx.editable);
    if (model === null) return screen(g.cross, 'neg', 'COULD NOT LOAD', ['the value is not a tree']);
    const loading = data.mode.kind === 'paged' ? data.mode.loading : [];
    const body = renderTreeRows(model, tctx.tree, loading, rows, width, g);
    body.push(treeFooter(model, tctx.tree, loading, rows, width, g, 's save .beast2'));
    return body;
}

registerListModel('task', (state, layout) => {
    if (state.view.kind !== 'task') return { count: 0, visible: 0 };
    const { ws, task, tab } = state.view;
    if (tab === 'runs') return { count: runsOf(state, ws, task).length, visible: Math.max(1, layout.bodyRows - RUNS_CHROME_ROWS) };
    if (tab === 'reads') {
        const manifest = manifestOf(state.data.taskDetails[ws]?.[task]);
        return { count: manifest === null ? 0 : readRows(manifest).length, visible: Math.max(1, layout.bodyRows - TREE_CHROME_ROWS + 1) };
    }
    const tctx = treeContext(state);
    if (tctx === null) return { count: 0, visible: 0 };
    const model = treeModel(tctx.data, tctx.tree, tctx.editable);
    return { count: model?.total ?? 0, visible: Math.max(1, layout.bodyRows - TREE_CHROME_ROWS) };
});

registerView('task', (state, ctx) => {
    if (state.view.kind !== 'task') return { body: [], hints: { left: '', right: '' } };
    const { ws, task, tab } = state.view;
    const g = ctx.g;
    const width = ctx.layout.columns;
    const tabs = taskTabs(state, ws, task);
    const ui = tabs.length === 4;
    const active = ['output', 'logs', 'runs', 'reads'].indexOf(tab);
    const body: Line[] = [
        lrLine(tabStrip(task, tabs, active, g), [...taskTitle(state, ws, task, ctx), t(' ')], width),
        datasetLine(state.data.dataset[ws]?.[`.tasks.${task}.output`], `.tasks.${task}.output`, ui, ctx),
        rule(width, g.dashed),
    ];
    const hits: Hit[] = tabStripHits(task, tabs, g).map(h => ({ row: 0, x0: h.x0, x1: h.x1, target: { kind: 'tab', index: h.index } }));
    const others = (except: number): string => tabs.map((label, i) => `${i + 1} ${label.toLowerCase()}`).filter((_, i) => i !== except).join('   ');
    const polled = state.data.polledAt !== null ? `polled ${agoShort(state.data.polledAt, ctx.now)}` : '';
    if (tab === 'output') {
        body.push(...renderOutput(state, ws, task, ctx));
        const data = state.data.dataset[ws]?.[`.tasks.${task}.output`];
        const shown = data?.mode.kind === 'inline' || data?.mode.kind === 'paged';
        const tctx = treeContext(state);
        const model = tctx === null ? null : treeModel(tctx.data, tctx.tree, tctx.editable);
        let pane: Pane | undefined;
        if (tctx !== null && model !== null) {
            const rows = Math.max(1, ctx.layout.bodyRows - TREE_CHROME_ROWS);
            const top = Math.max(0, Math.min(tctx.tree.top, Math.max(0, model.total - rows)));
            for (let i = top; i < Math.min(model.total, top + rows); i++) {
                const at = model.at(i);
                hits.push({ row: 3 + (i - top), x0: 0, x1: width - 1, target: { kind: 'tree', flat: i, twistX: at?.kind === 'model' ? 1 + 2 * at.row.depth : null } });
            }
            pane = { top: 3, rows, total: model.total, visible: rows, scrollTop: top };
            const footer = 3 + rows;
            const toolbar = `${g.expanded} expand all  ${g.collapsed} collapse all  s save .beast2 `;
            const start = width - toolbar.length;
            const word = (text: string, action: 'expandAll' | 'collapseAll' | 'save'): void => {
                const at = toolbar.indexOf(text);
                if (at >= 0) hits.push({ row: footer, x0: start + at, x1: start + at + text.length, target: { kind: 'toolbar', action } });
            };
            word(`${g.expanded} expand all`, 'expandAll');
            word(`${g.collapsed} collapse all`, 'collapseAll');
            word('s save .beast2', 'save');
        }
        return {
            body,
            hits,
            pane,
            hints: {
                left: shown ? `${g.up}${g.down} move   ${g.right} expand   ${g.left} collapse   pgup pgdn   /find <key>   /goto <row|%>   s save   ${others(0)}` : `${others(0)}   esc back`,
                right: state.mouse ? `wheel ${g.sep} drag ${g.thumb}` : '',
            },
        };
    }
    if (tab === 'logs') {
        const lctx = logsContext(state);
        if (lctx !== null) {
            body.push(streamLine(lctx, state, width, g));
            body.push(...renderLogLines(lctx, width, g));
            body.push(logsFooter(lctx, width, g));
            const follow = lctx.ui.follow ? `${g.dot} on` : `${g.empty} off`;
            const active0 = 1 + lctx.ui.stream.length + 2;
            const otherName = lctx.ui.stream === 'stdout' ? 'stderr' : 'stdout';
            hits.push({ row: 3, x0: 1, x1: active0, target: { kind: 'stream', stream: lctx.ui.stream } });
            hits.push({ row: 3, x0: active0 + 3, x1: active0 + 3 + otherName.length + 8, target: { kind: 'stream', stream: otherName } });
            const pane: Pane = { top: 4, rows: lctx.visible, total: lctx.lines.length, visible: lctx.visible, scrollTop: logsTop(lctx) };
            return { body, hits, pane, hints: { left: `${g.up}${g.down} scroll   G end   F follow ${follow}   o stdout  e stderr   s save   c copy   ${others(1)}`, right: polled } };
        }
    }
    if (tab === 'runs') {
        const runs = runsOf(state, ws, task);
        const visible = Math.max(1, ctx.layout.bodyRows - RUNS_CHROME_ROWS);
        body.push(...renderRuns(state, ws, task, visible, width, g));
        const top = state.view.runs.top;
        for (let i = top; i < Math.min(runs.length, top + visible); i++) hits.push({ row: 4 + (i - top), x0: 0, x1: width - 1, target: { kind: 'list', index: i } });
        const pane: Pane = { top: 4, rows: visible, total: runs.length, visible, scrollTop: top };
        return { body, hits, pane, hints: { left: `${g.up}${g.down} move   ${g.enter} inputs   ${others(2)}`, right: `${formatInt(runs.length)} execution${runs.length === 1 ? '' : 's'}` } };
    }
    if (tab === 'reads') {
        const manifest = manifestOf(state.data.taskDetails[ws]?.[task]);
        const visible = Math.max(1, ctx.layout.bodyRows - TREE_CHROME_ROWS + 1);
        const reads = renderReads(manifest, state.view.reads.sel, state.view.reads.top, visible, width, g);
        body.push(...reads.lines);
        reads.rowLines.forEach((line, index) => {
            if (line >= reads.top && line < reads.top + visible) hits.push({ row: 3 + (line - reads.top), x0: 0, x1: width - 1, target: { kind: 'list', index } });
        });
        const pane: Pane = { top: 3, rows: visible, total: reads.total, visible, scrollTop: reads.top };
        return { body, hits, pane, hints: { left: `${g.up}${g.down} move   ${g.enter} open   ${others(3)}`, right: '' } };
    }
    body.push(blank(width));
    return { body, hits, hints: { left: others(-1), right: '' } };
});

registerViewHooks('task', {
    click: (target, event, state, controller) => {
        if (state.view.kind !== 'task') return false;
        if (state.view.tab === 'output') {
            if (target.kind === 'tree') { clickTree(state, controller, target.flat, target.twistX !== null && event.x === target.twistX); return true; }
            if (target.kind === 'toolbar') {
                if (target.action === 'save') void controller.execute('/save');
                else treeToolbar(state, controller, target.action);
                return true;
            }
        }
        if (state.view.tab === 'logs' && target.kind === 'stream') {
            if (target.stream !== state.view.logs.stream) controller.dispatch({ type: 'logs/stream', stream: target.stream });
            return true;
        }
        return false;
    },
    scroll: (to, state, controller) => {
        if (state.view.kind !== 'task') return false;
        if (state.view.tab === 'output') { scrollTree(state, controller, to); return true; }
        if (state.view.tab === 'logs') { scrollLogs(state, controller, to); return true; }
        return false;
    },
    open: (state, controller) => {
        if (state.view.kind !== 'task') return;
        if (state.view.tab === 'output') treeOpen(state, controller);
        else if (state.view.tab === 'runs') controller.dispatch({ type: 'runs/expand', expanded: !state.view.runs.expanded });
        else if (state.view.tab === 'reads') openRead(state, controller);
    },
    tree: (action, state, controller) => (state.view.kind === 'task' && state.view.tab === 'output' ? treeKey(action, state, controller) : false),
    key: (action, state, controller) => {
        if (state.view.kind !== 'task') return false;
        if (state.view.tab === 'logs') return logsKey(action, state, controller);
        if (state.view.tab !== 'output') return false;
        if (action.kind === 'back' || action.kind === 'save' || action.kind === 'next' || action.kind === 'prev') return treeKey(action, state, controller);
        if (action.kind === 'toggle' && state.data.dataset[state.view.ws]?.[`.tasks.${state.view.task}.output`]?.mode.kind === 'not-indexed') return treeOpen(state, controller);
        return false;
    },
    command: async (command, state, controller) => {
        if (state.view.kind !== 'task') return false;
        if (state.view.tab === 'output') return treeCommand(command, state, controller);
        if (state.view.tab === 'logs') return logsCommand(command, state, controller);
        return false;
    },
});
