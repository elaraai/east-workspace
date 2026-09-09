/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The workspace dashboard — the title line, then one scrolling column:
 * the TASKS / DATASETS counts with the accounted bar, the execution panel
 * (the last run's failures, or the live per-task feed while it runs), the
 * tasks table and the inputs table. `⏎` opens the task, the input, or a
 * failed task's logs. Status detail is inline (`✗ failed · exit 2`,
 * `◐ waiting`, `◔ in-progress`).
 *
 * @packageDocumentation
 */

import type { DataflowEvent, WorkspaceStatusResult } from '@elaraai/e3-api-client';
import type { Glyphs } from '../../render/glyphs.js';
import { breakpoint, columnPlan, scrollIntoView, type Breakpoint } from '../../render/layout.js';
import { agoShort, formatDuration, formatSize, hashShort, padEnd, padStart, timeAgo } from '../../render/text.js';
import type { Tone } from '../../render/theme.js';
import type { ExecutionData, NavOp, TuiState } from '../../state/actions.js';
import { layoutOf, registerListModel } from '../../model/index.js';
import { datasetEntries } from '../../model/catalogue.js';
import { datasetStatusCell, eventCell, executionDuration, executionStatusCell, statusText, taskStatusCell } from '../../model/status.js';
import { registerViewHooks, type Controller } from '../../controller.js';
import { isRunLive, lockHolderText } from '../../data/dataflow.js';
import type { Hit, Pane } from '../frame.js';
import { b, blank, d, lineWidth, lrLine, t, type Line, type RenderCtx } from '../lines.js';
import { centredBlock, renderTable, sectionLine, withScrollbar, type TableRow } from '../shell/widgets.js';
import { registerView } from './index.js';

type TaskInfo = WorkspaceStatusResult['tasks'][number];

/** What the column builder needs from the render context. */
export interface DashboardCtx {
    g: Glyphs;
    now: number;
    columns: number;
    bp: Breakpoint;
    spinner: number;
}

/** A selectable row of the column: what `⏎` opens, and its line index. */
export interface DashboardRow {
    kind: 'logs' | 'task' | 'input';
    name: string;
    line: number;
}

/** The column under the title: its lines and the selectable rows. */
export interface DashboardColumn {
    lines: Line[];
    rows: DashboardRow[];
}

/** Event rows the execution panel shows at most. */
export const MAX_EVENT_ROWS = 6;

/** Cells of the accounted bar at most (longer workspaces are sampled). */
const MAX_BAR_CELLS = 40;

/**
 * The column builder's context from a render context.
 *
 * @param state - The store state
 * @param ctx - The render context
 * @returns The dashboard context
 */
export function dashboardCtx(state: TuiState, ctx: RenderCtx): DashboardCtx {
    return { g: ctx.g, now: ctx.now, columns: ctx.layout.columns, bp: breakpoint(state.size), spinner: ctx.spinner };
}

/** `12s` / `1m` / `3h` — an event's age without the `ago`. */
function ageBare(then: string, now: number): string {
    const ago = timeAgo(then, now);
    return ago === 'just now' ? '0s' : ago.replace(/ ago$/, '');
}

/** The reason with its first letter lowered (`Waiting for task 'x'` → `waiting for task 'x'`). */
function lowerFirst(text: string): string {
    return text.length === 0 ? text : text[0]!.toLowerCase() + text.slice(1);
}

/** The dashboard title line: ` main   ● DEPLOYED · demand@1.4.2 · deployed 3d ago · lock: none`. */
export function dashboardTitle(state: TuiState, ws: string, ctx: RenderCtx): Line {
    const g = ctx.g;
    const info = (state.data.workspaces ?? []).find(w => w.name === ws);
    const wsState = state.data.workspaceState[ws];
    const status = state.data.status[ws]?.result;
    const right: Line = [];
    if (info === undefined || !info.deployed) {
        right.push(b(`${g.empty} EMPTY`, 'muted'));
    } else {
        const pkg = info.packageName.type === 'some' ? `${info.packageName.value}${info.packageVersion.type === 'some' ? `@${info.packageVersion.value}` : ''}` : '';
        right.push(b(`${g.dot} DEPLOYED`, 'pos'), d(` ${g.sep} ${pkg}`));
        if (wsState !== undefined && wsState !== null) right.push(d(` ${g.sep} deployed ${timeAgo(wsState.deployedAt, ctx.now)}`));
    }
    const lock = status?.lock;
    if (lock !== undefined) {
        if (lock.type === 'some') {
            right.push(t(` ${g.sep} `), b(`lock: ${lockHolderText(lock.value, ctx.now, g)}`, 'warn'));
        } else {
            right.push(d(` ${g.sep} lock: none`));
        }
    }
    right.push(t(' '));
    return lrLine([t(' '), b(ws)], right, ctx.layout.columns);
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/** One stat cell. */
interface Stat {
    glyph: string;
    tone: Tone;
    word: string;
    count: number;
}

/** The task stats: the four the design shows, plus in-progress / stale-running when non-zero. */
function taskStats(s: WorkspaceStatusResult['summary']['tasks'], g: Glyphs): Stat[] {
    const stats: Stat[] = [
        { glyph: g.dot, tone: 'pos', word: 'up-to-date', count: Number(s.upToDate) },
        { glyph: g.half, tone: 'warn', word: 'waiting', count: Number(s.waiting) },
        { glyph: g.cross, tone: 'neg', word: 'failed', count: Number(s.failed) + Number(s.error) },
        { glyph: g.empty, tone: 'muted', word: 'ready', count: Number(s.ready) },
    ];
    if (Number(s.inProgress) > 0) stats.push({ glyph: g.quarter, tone: 'info', word: 'in-progress', count: Number(s.inProgress) });
    if (Number(s.staleRunning) > 0) stats.push({ glyph: g.half, tone: 'warn', word: 'stale-running', count: Number(s.staleRunning) });
    return stats;
}

/** The dataset stats. */
function datasetStats(s: WorkspaceStatusResult['summary']['datasets'], g: Glyphs): Stat[] {
    return [
        { glyph: g.dot, tone: 'pos', word: 'up-to-date', count: Number(s.upToDate) },
        { glyph: g.half, tone: 'warn', word: 'stale', count: Number(s.stale) },
        { glyph: g.empty, tone: 'muted', word: 'unset', count: Number(s.unset) },
    ];
}

/** A two-wide grid of stat cells (`● up-to-date         4   ◐ waiting        1`). */
function statGrid(stats: Stat[]): Line[] {
    const lines: Line[] = [];
    for (let i = 0; i < stats.length; i += 2) {
        const first = stats[i]!;
        const second = stats[i + 1];
        const line: Line = [b(first.glyph, first.tone), t(padEnd(` ${first.word}`, 17)), t(padStart(String(first.count), 4))];
        if (second !== undefined) line.push(t('   '), b(second.glyph, second.tone), t(padEnd(` ${second.word}`, 13)), t(padStart(String(second.count), 4)));
        lines.push(line);
    }
    return lines;
}

/**
 * The accounted bar: one cell per task (sampled past 40), lowest first —
 * `✗` failed / error, `▁` ready, `▃` waiting, `▅` in progress, `▇`
 * up-to-date — and `N of M accounted`, where a task is accounted for once
 * the dataflow has touched it (anything but `ready`).
 *
 * @param tasks - The workspace's tasks
 * @param g - The glyph set
 * @returns The bar's spans and the counts
 */
export function accountedBar(tasks: readonly TaskInfo[], g: Glyphs): { bar: Line; accounted: number; total: number } {
    const height = (status: TaskInfo['status']['type']): number =>
        status === 'ready' ? 0 : status === 'waiting' ? 1 : status === 'in-progress' || status === 'stale-running' ? 2 : status === 'up-to-date' ? 3 : -1;
    const heights = tasks.map(task => height(task.status.type)).sort((x, y) => x - y);
    const n = Math.min(heights.length, MAX_BAR_CELLS);
    const bar: Line = [];
    for (let i = 0; i < n; i++) {
        const h = heights[Math.floor((i * heights.length) / n)]!;
        bar.push(h < 0 ? b(g.cross, 'neg') : b(g.bars[h]!, 'brand'));
    }
    return { bar, accounted: tasks.filter(task => task.status.type !== 'ready').length, total: tasks.length };
}

/** The counts block: the two headed groups side by side (or stacked when narrow) and the accounted bar. */
function countsLines(status: WorkspaceStatusResult, dctx: DashboardCtx): Line[] {
    const g = dctx.g;
    const tasks = statGrid(taskStats(status.summary.tasks, g));
    const datasets = statGrid(datasetStats(status.summary.datasets, g));
    const taskHead: Line = [b(`TASKS ${status.summary.tasks.total}`)];
    const datasetHead: Line = [b(`DATASETS ${status.summary.datasets.total}`)];
    const colL = Math.floor((dctx.columns - 2) / 2);
    const out: Line[] = [];
    if (colL >= 44) {
        const left = [taskHead, ...tasks];
        const right = [datasetHead, ...datasets];
        const n = Math.max(left.length, right.length);
        for (let i = 0; i < n; i++) {
            const l = left[i] ?? [];
            const r = right[i] ?? [];
            out.push([t(' '), ...l, t(' '.repeat(Math.max(0, colL - lineWidth(l)))), ...r]);
        }
    } else {
        for (const line of [taskHead, ...tasks, datasetHead, ...datasets]) out.push([t(' '), ...line]);
    }
    const { bar, accounted, total } = accountedBar(status.tasks, g);
    out.push([t(' '), ...bar, d(`${bar.length > 0 ? '  ' : ''}${accounted} of ${total} accounted`)]);
    return out;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * The latest event of each task, in order of first appearance.
 *
 * @param events - The execution's events
 * @returns One event per task
 */
export function latestPerTask(events: readonly DataflowEvent[]): DataflowEvent[] {
    const order: string[] = [];
    const latest = new Map<string, DataflowEvent>();
    for (const event of events) {
        const task = event.value.task;
        if (!latest.has(task)) order.push(task);
        latest.set(task, event);
    }
    return order.map(task => latest.get(task)!);
}

/** Whether an execution is live (running, launched and not yet seen running, or being stopped). */
function isLive(execution: ExecutionData | undefined): boolean {
    return execution !== undefined && (execution.state?.status.type === 'running' || execution.settling || execution.stopping);
}

/** The execution panel: a header line, the event rows, and which rows open logs. */
function executionLines(execution: ExecutionData | undefined, tasksTotal: number, sel: DashboardRow | undefined, dctx: DashboardCtx): { lines: Line[]; logs: { task: string; at: number }[] } {
    const g = dctx.g;
    const sep = g.sep;
    const width = dctx.columns - 1;
    const spin = g.spinner[dctx.spinner % g.spinner.length]!;
    const lines: Line[] = [];
    const logs: { task: string; at: number }[] = [];
    let title = 'LAST EXECUTION';
    let right: Line;
    let events: DataflowEvent[] = [];
    if (execution === undefined) {
        right = [d('…')];
    } else if (execution.state === null) {
        right = execution.settling ? [b(`${g.quarter} STARTING`, 'info'), d(` ${sep} ${spin}`)] : [d(`${g.empty} never run ${sep} r run`)];
        if (execution.settling) title = 'EXECUTION';
    } else if (isLive(execution)) {
        title = 'EXECUTION';
        const state = execution.state;
        const done = execution.events.filter(e => e.type !== 'start').length;
        const head = execution.stopping ? b(`${g.square} STOPPING`, 'warn') : b(`${g.quarter} RUNNING`, 'info');
        right = [head, d(` ${sep} started ${timeAgo(state.startedAt, dctx.now)} ${sep} ${done} of ${tasksTotal} tasks ${sep} ${spin}`)];
        events = latestPerTask(execution.events).slice(-MAX_EVENT_ROWS);
    } else {
        const state = execution.state;
        const cell = executionStatusCell(state.status.type, g);
        let detail = ` ${sep} started ${timeAgo(state.startedAt, dctx.now)}`;
        if (state.summary.type === 'some') {
            const s = state.summary.value;
            detail += ` ${sep} ${formatDuration(executionDuration(state) ?? s.duration)} ${sep} executed ${s.executed} ${sep} cached ${s.cached} ${sep} failed ${s.failed} ${sep} skipped ${s.skipped}`;
        }
        right = [b(`${cell.glyph} ${cell.word}`, cell.tone), d(detail)];
        events = latestPerTask(execution.events).filter(e => e.type === 'failed' || e.type === 'error');
    }
    lines.push(lrLine([t(' '), b(title)], [...right, t(' ')], width));
    const shown = events.slice(0, MAX_EVENT_ROWS);
    for (const event of shown) {
        const cell = eventCell(event, g);
        const opensLogs = event.type === 'failed' || event.type === 'error';
        const selected = opensLogs && sel?.kind === 'logs' && sel.name === cell.task;
        const left: Line = [
            t(' '),
            selected ? b(g.sel, 'brand') : t(' '),
            t(padStart(ageBare(cell.timestamp, dctx.now), 4)),
            t('  '),
            b(cell.glyph, cell.tone),
            t(padEnd(` ${cell.word}`, 13)),
            selected ? b(cell.task) : t(cell.task),
        ];
        const detail: Line = [];
        if (event.type === 'start') detail.push(d(`${spin} ${ageBare(cell.timestamp, dctx.now)}`));
        else if (cell.detail !== '') detail.push(d(cell.detail));
        if (opensLogs) {
            logs.push({ task: cell.task, at: lines.length });
            detail.push(t('     '), b(`${g.enter} logs`, 'brand'));
        }
        lines.push(lrLine(left, [...detail, t(' ')], width));
    }
    if (events.length > shown.length) {
        lines.push([t('   '), d(`… ${events.length - shown.length} more failed ${sep} /logs <task>`)]);
    }
    return { lines, logs };
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** The `SIZE · LAST RUN` cell of a task row. */
function lastRunText(task: TaskInfo, event: DataflowEvent | undefined, size: string, dctx: DashboardCtx): string {
    const g = dctx.g;
    const spin = g.spinner[dctx.spinner % g.spinner.length]!;
    switch (task.status.type) {
        case 'in-progress': {
            const since = task.status.value.startedAt.type === 'some' ? task.status.value.startedAt.value : event?.type === 'start' ? event.value.timestamp : null;
            return `${spin} ${since !== null ? ageBare(since, dctx.now) : 'running'}`;
        }
        case 'waiting':
            return `— ${g.sep} ${lowerFirst(task.status.value.reason)}`;
        default: {
            const run = event === undefined ? (task.status.type === 'ready' ? 'never' : '—')
                : event.type === 'complete' || event.type === 'failed' ? formatDuration(event.value.duration)
                : event.type === 'cached' ? 'cached'
                : event.type === 'error' ? 'error'
                : event.type === 'input_unavailable' ? 'skipped'
                : '—';
            return `${size} ${g.sep} ${run}`;
        }
    }
}

/**
 * The tasks table rows.
 *
 * @param state - The store state
 * @param ws - The workspace
 * @param status - Its status
 * @param dctx - The dashboard context
 * @returns The rows, in the status order
 */
export function taskRows(state: TuiState, ws: string, status: WorkspaceStatusResult, dctx: DashboardCtx): TableRow[] {
    const g = dctx.g;
    const entries = datasetEntries(state, ws);
    const latest = new Map(latestPerTask(state.data.execution[ws]?.events ?? []).map(e => [e.value.task, e] as const));
    return status.tasks.map(task => {
        const cell = taskStatusCell(task.status, g);
        // The reason / pid / cached detail lives in the last column; only a failure's exit code / message stays inline.
        const bare = task.status.type !== 'failed' && task.status.type !== 'error';
        const inputs = task.inputs.filter(p => p.startsWith('.inputs.')).map(p => p.slice('.inputs.'.length));
        const entry = entries.get(task.output);
        const size = entry?.size != null ? formatSize(entry.size) : '—';
        return {
            cells: {
                name: task.name,
                status: { text: bare ? `${cell.glyph} ${cell.word}` : statusText(cell), tone: cell.tone },
                dependsOn: task.dependsOn.length > 0 ? task.dependsOn.join(', ') : '—',
                inputs: inputs.length > 0 ? inputs.join(', ') : '—',
                output: entry?.type ?? '—',
                size: lastRunText(task, latest.get(task.name), size, dctx),
            },
        };
    });
}

/**
 * The inputs table rows (`.inputs.*` datasets that no task produces).
 *
 * @param state - The store state
 * @param ws - The workspace
 * @param status - Its status
 * @param dctx - The dashboard context
 * @returns The rows, in the status order
 */
export function inputRows(state: TuiState, ws: string, status: WorkspaceStatusResult, dctx: DashboardCtx): TableRow[] {
    const entries = datasetEntries(state, ws);
    return status.datasets.filter(ds => !ds.isTaskOutput && ds.path.startsWith('.inputs.')).map(ds => {
        const cell = datasetStatusCell(ds.status.type, dctx.g);
        const entry = entries.get(ds.path);
        return {
            cells: {
                name: ds.path.slice('.inputs.'.length),
                status: { text: statusText(cell), tone: cell.tone },
                type: entry?.type ?? '—',
                size: entry?.size != null ? formatSize(entry.size) : '—',
                hash: ds.hash.type === 'some' ? hashShort(ds.hash.value) : '—',
            },
        };
    });
}

// ---------------------------------------------------------------------------
// The column
// ---------------------------------------------------------------------------

/**
 * Builds the column under the title.
 *
 * @param state - The store state
 * @param ws - The workspace
 * @param dctx - The dashboard context
 * @param sel - The selected row index
 * @returns The lines and the selectable rows
 */
export function dashboardColumn(state: TuiState, ws: string, dctx: DashboardCtx, sel: number): DashboardColumn {
    const g = dctx.g;
    const width = dctx.columns - 1;
    const lines: Line[] = [];
    const rows: DashboardRow[] = [];
    const status = state.data.status[ws]?.result;
    if (status === undefined) {
        const error = state.data.statusError[ws];
        const wsState = state.data.workspaceState[ws];
        if (wsState === null) {
            lines.push(...centredBlock(g.empty, 'muted', 'NOTHING DEPLOYED', [`${ws} has no package yet`, `e3 workspace deploy <repo> ${ws} <package>[@version]   deploy one`, '/workspaces   pick another workspace'], width));
        } else if (error !== undefined) {
            lines.push([t(' '), b(`${g.cross} ${error}`, 'neg')]);
        } else {
            lines.push([t(' '), d('loading…')]);
        }
        return { lines, rows };
    }
    // The selectable rows are numbered in column order: failures, tasks, inputs — so the
    // selected row is resolved from a first pass over the same data.
    const tasks = taskRows(state, ws, status, dctx);
    const inputs = inputRows(state, ws, status, dctx);
    const execution = state.data.execution[ws];
    const probe = executionLines(execution, status.tasks.length, undefined, dctx);
    const order: { kind: DashboardRow['kind']; name: string }[] = [
        ...probe.logs.map(l => ({ kind: 'logs' as const, name: l.task })),
        ...status.tasks.map(task => ({ kind: 'task' as const, name: task.name })),
        ...status.datasets.filter(ds => !ds.isTaskOutput && ds.path.startsWith('.inputs.')).map(ds => ({ kind: 'input' as const, name: ds.path.slice('.inputs.'.length) })),
    ];
    const selected = order[Math.max(0, Math.min(sel, order.length - 1))];
    const selectedRow: DashboardRow | undefined = selected === undefined ? undefined : { ...selected, line: -1 };

    lines.push(...countsLines(status, dctx));
    lines.push(blank(width));
    const panel = executionLines(execution, status.tasks.length, selectedRow, dctx);
    const panelStart = lines.length;
    for (const l of panel.logs) rows.push({ kind: 'logs', name: l.task, line: panelStart + l.at });
    lines.push(...panel.lines);
    lines.push(blank(width));

    lines.push(sectionLine('TASKS', '', width));
    const taskSel = selectedRow?.kind === 'task' ? status.tasks.findIndex(task => task.name === selectedRow.name) : -1;
    const taskTable = renderTable(columnPlan('tasks', dctx.bp), tasks, taskSel, 0, tasks.length, width, g);
    lines.push(taskTable[0]!);
    status.tasks.forEach((task, i) => {
        rows.push({ kind: 'task', name: task.name, line: lines.length });
        lines.push(taskTable[i + 1]!);
    });
    if (tasks.length === 0) lines.push([t('  '), d('no tasks')]);
    lines.push(blank(width));

    lines.push(sectionLine('INPUTS', '', width));
    const inputNames = order.filter(r => r.kind === 'input').map(r => r.name);
    const inputSel = selectedRow?.kind === 'input' ? inputNames.indexOf(selectedRow.name) : -1;
    const inputTable = renderTable(columnPlan('inputs', dctx.bp), inputs, inputSel, 0, inputs.length, width, g);
    lines.push(inputTable[0]!);
    inputNames.forEach((name, i) => {
        rows.push({ kind: 'input', name, line: lines.length });
        lines.push(inputTable[i + 1]!);
    });
    if (inputs.length === 0) lines.push([t('  '), d('no inputs')]);
    return { lines, rows };
}

/**
 * The dashboard body: the fixed title, then the column window with its
 * scrollbar — plus the window's clickable rows and pane for the mouse.
 *
 * @param state - The store state
 * @param ctx - The render context
 * @returns The body lines, hits and pane
 */
export function renderDashboard(state: TuiState, ctx: RenderCtx): { body: Line[]; hits: Hit[]; pane: Pane | null } {
    if (state.view.kind !== 'dashboard') return { body: [], hits: [], pane: null };
    const ws = state.view.ws;
    const width = ctx.layout.columns;
    const out: Line[] = [dashboardTitle(state, ws, ctx)];
    const column = dashboardColumn(state, ws, dashboardCtx(state, ctx), state.view.list.sel);
    const visible = Math.max(1, ctx.layout.bodyRows - 1);
    const total = column.lines.length;
    const top = Math.max(0, Math.min(state.view.list.top, Math.max(0, total - visible)));
    const window = column.lines.slice(top, top + visible);
    while (window.length < visible) window.push(blank(width - 1));
    out.push(...withScrollbar(window, width, total, visible, top, ctx.g));
    const hits: Hit[] = column.rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.line >= top && row.line < top + visible)
        .map(({ row, index }) => ({ row: 1 + (row.line - top), x0: 0, x1: width, target: { kind: 'dashboard' as const, index } }));
    return { body: out, hits, pane: { top: 1, rows: visible, total, visible, scrollTop: top } };
}

/**
 * Scrolls the column by lines (the wheel), or to a line (a thumb drag),
 * keeping the selection inside the window.
 *
 * @param state - The store state
 * @param controller - The controller
 * @param to - `{ delta }` lines, or `{ top }` absolute
 */
export function scrollDashboard(state: TuiState, controller: Controller, to: { delta: number } | { top: number }): void {
    const nav = navigation(state, controller);
    if (nav === null || state.view.kind !== 'dashboard') return;
    const { column, visible } = nav;
    const total = column.lines.length;
    const current = state.view.list.top;
    const top = Math.max(0, Math.min('delta' in to ? current + to.delta : to.top, Math.max(0, total - visible)));
    let sel = state.view.list.sel;
    if (column.rows.length > 0) {
        const line = column.rows[Math.max(0, Math.min(sel, column.rows.length - 1))]!.line;
        if (line < top || line >= top + visible) {
            // The selection follows the window: the first (or last) row inside it.
            const inside = column.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.line >= top && r.line < top + visible);
            const pick = line < top ? inside[0] : inside[inside.length - 1];
            if (pick !== undefined) sel = pick.i;
        }
    }
    controller.dispatch({ type: 'view/set', view: { ...state.view, list: { sel, top } } });
}

registerView('dashboard', (state, ctx) => {
    const { body, hits, pane } = renderDashboard(state, ctx);
    return { body, hits, pane: pane ?? undefined, hints: dashboardHints(state, ctx) };
});

/** The dashboard hints. */
export function dashboardHints(state: TuiState, ctx: RenderCtx): { left: string; right: string } {
    const polled = state.data.polledAt;
    const ws = state.view.kind === 'dashboard' ? state.view.ws : null;
    const running = ws !== null && isRunLive(state, ws);
    return {
        left: running ? '↑↓ move   ⏎ open   x stop   / commands' : '↑↓ move   ⏎ open   r run   x stop   w workspaces   / commands',
        right: polled !== null ? `polled ${agoShort(polled, ctx.now)}` : '',
    };
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** The column and the window geometry for navigation (no theme needed). */
function navigation(state: TuiState, controller: Controller): { column: DashboardColumn; visible: number } | null {
    if (state.view.kind !== 'dashboard') return null;
    const layout = layoutOf(state);
    const dctx: DashboardCtx = { g: controller.deps.glyphs, now: controller.deps.now(), columns: layout.columns, bp: breakpoint(state.size), spinner: 0 };
    return { column: dashboardColumn(state, state.view.ws, dctx, state.view.list.sel), visible: Math.max(1, layout.bodyRows - 1) };
}

/**
 * Selects a row of the column (by index) and scrolls it into view.
 *
 * @param state - The store state
 * @param controller - The controller
 * @param index - The row index
 */
export function selectDashboardRow(state: TuiState, controller: Controller, index: number): void {
    const nav = navigation(state, controller);
    if (nav === null || state.view.kind !== 'dashboard') return;
    const { column, visible } = nav;
    if (column.rows.length === 0) return;
    const sel = Math.max(0, Math.min(index, column.rows.length - 1));
    const top = scrollIntoView(state.view.list.top, column.rows[sel]!.line, visible, column.lines.length);
    controller.dispatch({ type: 'view/set', view: { ...state.view, list: { sel, top } } });
}

/**
 * Moves the selection (or scrolls the column when it has no selectable
 * rows); page moves step by a window of lines.
 *
 * @param state - The store state
 * @param controller - The controller
 * @param op - The navigation
 */
export function moveDashboard(state: TuiState, controller: Controller, op: NavOp): void {
    const nav = navigation(state, controller);
    if (nav === null || state.view.kind !== 'dashboard') return;
    const { column, visible } = nav;
    const total = column.lines.length;
    const count = column.rows.length;
    const page = Math.max(1, visible - 1);
    if (count === 0) {
        const delta = op === 'up' ? -1 : op === 'down' ? 1 : op === 'pageUp' ? -page : op === 'pageDown' ? page : op === 'home' ? -total : total;
        const top = Math.max(0, Math.min(state.view.list.top + delta, Math.max(0, total - visible)));
        controller.dispatch({ type: 'view/set', view: { ...state.view, list: { sel: 0, top } } });
        return;
    }
    const last = count - 1;
    const current = Math.max(0, Math.min(state.view.list.sel, last));
    const line = column.rows[current]!.line;
    let sel = current;
    switch (op) {
        case 'up': sel = Math.max(0, current - 1); break;
        case 'down': sel = Math.min(last, current + 1); break;
        case 'home': sel = 0; break;
        case 'end': sel = last; break;
        case 'pageUp': {
            const target = line - page;
            let i = current;
            while (i > 0 && column.rows[i - 1]!.line >= target) i--;
            sel = i === current ? Math.max(0, current - 1) : i;
            break;
        }
        case 'pageDown': {
            const target = line + page;
            let i = current;
            while (i < last && column.rows[i + 1]!.line <= target) i++;
            sel = i === current ? Math.min(last, current + 1) : i;
            break;
        }
    }
    // Home shows the column from its start and End from its end; the other moves scroll minimally.
    const top = op === 'home' ? 0
        : op === 'end' ? Math.max(0, total - visible)
        : scrollIntoView(state.view.list.top, column.rows[sel]!.line, visible, total);
    controller.dispatch({ type: 'view/set', view: { ...state.view, list: { sel, top } } });
}

// The generic list model is not used: the column's rows sit at irregular
// line offsets, so the view moves and scrolls itself (`moveDashboard`).
registerListModel('dashboard', () => ({ count: 0, visible: 0 }));

registerViewHooks('dashboard', {
    click: (target, _event, state, controller) => {
        if (target.kind !== 'dashboard') return false;
        selectDashboardRow(state, controller, target.index);
        return true;
    },
    scroll: (to, state, controller) => {
        scrollDashboard(state, controller, to);
        return true;
    },
    open: (state, controller) => {
        const nav = navigation(state, controller);
        if (nav === null || state.view.kind !== 'dashboard') return;
        const row = nav.column.rows[Math.max(0, Math.min(state.view.list.sel, nav.column.rows.length - 1))];
        if (row === undefined) return;
        const ws = state.view.ws;
        if (row.kind === 'logs') controller.openTask(ws, row.name, 'stdout');
        else if (row.kind === 'task') controller.openTask(ws, row.name);
        else controller.openInput(ws, row.name);
    },
    key: (action, state, controller) => {
        if (action.kind !== 'move' || state.view.kind !== 'dashboard') return false;
        moveDashboard(state, controller, action.op);
        return true;
    },
});
