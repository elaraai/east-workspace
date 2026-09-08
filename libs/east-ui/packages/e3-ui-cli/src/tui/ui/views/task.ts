/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The task view — the tab strip and the title lines, then the tab's body.
 * The Output tab is the value tree widget over `.tasks.<task>.output` with
 * its states (no output yet, too large, not indexed, loading, error); the
 * Logs / Runs / Reads tabs follow in #726.
 *
 * @packageDocumentation
 */

import { compactType } from '../../model/types.js';
import { eventCell, taskStatusCell } from '../../model/status.js';
import { registerListModel } from '../../model/index.js';
import { registerViewHooks } from '../../controller.js';
import { latestPerTask } from './dashboard.js';
import { formatDuration, formatInt, formatSize, hashMid, hashShort, hashTiny } from '../../render/text.js';
import type { DatasetData, TuiState } from '../../state/actions.js';
import { blank, d, b, lrLine, rule, t, type Line, type RenderCtx } from '../lines.js';
import { centredBlock, tabStrip } from '../shell/widgets.js';
import { renderTreeRows, treeCommand, treeContext, treeFooter, treeKey, treeModel, treeOpen, TREE_CHROME_ROWS } from '../widgets/tree.js';
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
    const event = latestPerTask(state.data.execution[ws]?.events ?? []).find(e => e.value.task === task);
    if (event !== undefined && (event.type === 'complete' || event.type === 'failed')) out.push(d(` ${g.sep} ${formatDuration(event.value.duration * 1000)}`));
    else if (event !== undefined && event.type === 'cached' && cell.detail !== 'cached') out.push(d(` ${g.sep} ${eventCell(event, g).word}`));
    const executions = state.data.executions[ws]?.[task];
    if (executions !== undefined && executions.length > 0) out.push(d(` ${g.sep} inputs ${hashMid(executions[0]!.inputsHash)}`));
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
    if (tab === 'output') {
        body.push(...renderOutput(state, ws, task, ctx));
        const data = state.data.dataset[ws]?.[`.tasks.${task}.output`];
        const shown = data?.mode.kind === 'inline' || data?.mode.kind === 'paged';
        const other = tabs.map((label, i) => `${i + 1} ${label.toLowerCase()}`).filter((_, i) => i !== 0).join('   ');
        return {
            body,
            hints: {
                left: shown ? `${g.up}${g.down} move   ${g.right} expand   ${g.left} collapse   pgup pgdn   /find <key>   /goto <row|%>   s save   ${other}` : `${other}   esc back`,
                right: state.mouse ? `wheel ${g.sep} drag ${g.thumb}` : '',
            },
        };
    }
    body.push(blank(width), [t(' '), d(`${tabs[active] ?? tab} — coming with the next change`)]);
    return { body, hints: { left: tabs.map((label, i) => `${i + 1} ${label.toLowerCase()}`).join('   '), right: '' } };
});

registerViewHooks('task', {
    open: (state, controller) => {
        if (state.view.kind !== 'task' || state.view.tab !== 'output') return;
        treeOpen(state, controller);
    },
    tree: (action, state, controller) => (state.view.kind === 'task' && state.view.tab === 'output' ? treeKey(action, state, controller) : false),
    key: (action, state, controller) => {
        if (state.view.kind !== 'task' || state.view.tab !== 'output') return false;
        if (action.kind === 'back' || action.kind === 'save' || action.kind === 'next' || action.kind === 'prev') return treeKey(action, state, controller);
        if (action.kind === 'toggle' && state.data.dataset[state.view.ws]?.[`.tasks.${state.view.task}.output`]?.mode.kind === 'not-indexed') return treeOpen(state, controller);
        return false;
    },
    command: async (command, state, controller) => (state.view.kind === 'task' && state.view.tab === 'output' ? treeCommand(command, state, controller) : false),
});
