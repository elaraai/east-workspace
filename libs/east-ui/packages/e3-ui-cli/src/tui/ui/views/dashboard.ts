/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The workspace dashboard — the title line, then one scrolling column:
 * the TASKS / DATASETS counts with the accounted bar, the execution panel
 * (the last run's failures; while it runs, the budget in use and the live
 * feed: each task's latest event, the units requeued and what waits for
 * room), the tasks table, the inputs table and, when the workspace holds
 * records, the records table. `⏎` opens the task, the input, the record,
 * or a failed task's logs. Status detail is inline
 * (`✗ failed · exit 2`, `◐ waiting`, `◔ in-progress`).
 *
 * The column is built in two steps. {@link dashboardModel} derives what
 * follows from the data and the width — the counts, the rows the panel
 * lists, the latest event per task, the dataset map, the fitted table
 * plans, each row's cells and where each selectable row sits — once per
 * data change: a single-entry cache keyed on the identity of the status,
 * the execution, the dataset list, the task list, the records read, the
 * width and the breakpoint. {@link dashboardLines} then renders only the lines on
 * screen, restyling the selected row and stamping the clock and the
 * spinner. A selection move costs the window, not the workspace.
 *
 * @packageDocumentation
 */

import type { DataflowEvent, RecordCommitInfo, WorkspaceStatusResult } from '@elaraai/e3-api-client';
import type { WorkspaceState } from '@elaraai/e3-types';
import type { Glyphs } from '../../render/glyphs.js';
import { breakpoint, columnPlan, scrollIntoView, type Breakpoint, type ColumnSpec } from '../../render/layout.js';
import { agoShort, formatDuration, formatInt, formatSize, hashShort, padEnd, padStart, timeAgo } from '../../render/text.js';
import type { Tone } from '../../render/theme.js';
import type { DataState, ExecutionData, NavOp, TuiState } from '../../state/actions.js';
import { layoutOf, registerListModel } from '../../model/index.js';
import { datasetEntries } from '../../model/catalogue.js';
import {
    datasetStatusCell, eventCell, executionDuration, executionStatusCell, splitPlace, statusText, taskStatusCell, unitPlace, waitCell, type StatusCell,
} from '../../model/status.js';
import { registerViewHooks, type Controller } from '../../controller.js';
import { isRunLive, lockHolderText } from '../../data/dataflow.js';
import { recordEntries } from '../../data/records.js';
import type { Hit, Pane } from '../frame.js';
import { b, blank, d, lineWidth, lrLine, t, type Line, type RenderCtx } from '../lines.js';
import { centredBlock, sectionLine, tableLine, tablePlan, withScrollbar, type TableRow } from '../shell/widgets.js';
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
    kind: 'logs' | 'task' | 'input' | 'record';
    name: string;
    line: number;
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
// The model
// ---------------------------------------------------------------------------

/**
 * The latest event of each task, in order of first appearance. A unit's
 * requeue is not a task's event, so it never stands for its task.
 *
 * @param events - The execution's events
 * @returns One event per task
 */
export function latestPerTask(events: readonly DataflowEvent[]): DataflowEvent[] {
    const order: string[] = [];
    const latest = new Map<string, DataflowEvent>();
    for (const event of events) {
        if (event.type === 'requeued') continue;
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

/** Whether an event's row opens the task's logs. */
function opensLogs(event: DataflowEvent): boolean {
    return event.type === 'failed' || event.type === 'error';
}

/**
 * A row of the execution panel: a task's latest event, a unit requeued, or a
 * task or unit waiting for room in the server's budget.
 *
 * @property cell - The glyph, tone and word, and the detail at the row's right
 * @property task - The task
 * @property place - After the task's name: the unit, or a split task's progress (`piece 5 of 8`); `''` for none
 * @property timestamp - When it happened, or began
 * @property running - Whether it is a running task's start, whose right shows the spinner and its age
 * @property logs - Whether `⏎` opens the task's logs
 */
export interface FeedRow {
    cell: StatusCell;
    task: string;
    place: string;
    timestamp: string;
    running: boolean;
    logs: boolean;
}

/** An event's row, with nothing after the task's name. */
function eventRow(event: DataflowEvent, g: Glyphs): FeedRow {
    const cell = eventCell(event, g);
    return { cell, task: cell.task, place: '', timestamp: cell.timestamp, running: event.type === 'start', logs: opensLogs(event) };
}

/**
 * The rows of the live panel, in the order each happened or began: each
 * task's latest event, a split task's start naming its progress; each unit's
 * latest requeue; and each task or unit waiting for room, whose wait takes the
 * place of the start of a task that waits whole.
 *
 * @param execution - The execution
 * @param latest - Each task's latest event
 * @param g - The glyph set
 * @returns The rows
 */
export function liveRows(execution: ExecutionData, latest: readonly DataflowEvent[], g: Glyphs): FeedRow[] {
    const state = execution.state;
    const budget = state !== null && state.budget.type === 'some' ? state.budget.value : null;
    const waiting = state?.waiting ?? [];
    const splits = new Map((state?.splits ?? []).map(split => [split.task, split] as const));
    const waitsWhole = new Set(waiting.filter(wait => wait.unit.type === 'none').map(wait => wait.task));
    const rows: FeedRow[] = [];
    for (const event of latest) {
        if (event.type === 'start' && waitsWhole.has(event.value.task)) continue;
        const split = event.type === 'start' ? splits.get(event.value.task) : undefined;
        rows.push({ ...eventRow(event, g), place: split === undefined ? '' : splitPlace(split, g.sep) });
    }
    // A unit requeued more than once shows its latest.
    const requeues = new Map<string, FeedRow>();
    for (const event of execution.events) {
        if (event.type !== 'requeued') continue;
        const place = unitPlace(event.value.unit, g.sep);
        requeues.set(`${event.value.task} ${place}`, { ...eventRow(event, g), place });
    }
    rows.push(...requeues.values());
    for (const wait of waiting) {
        rows.push({
            cell: waitCell(wait, budget, g),
            task: wait.task,
            place: wait.unit.type === 'some' ? unitPlace(wait.unit.value, g.sep) : '',
            timestamp: wait.since,
            running: false,
            logs: false,
        });
    }
    return rows.sort((a, c) => Date.parse(a.timestamp) - Date.parse(c.timestamp));
}

/** A task's row: the cells that follow from the data, and what the `SIZE · LAST RUN` cell is stamped from per frame. */
export interface TaskRowModel {
    task: TaskInfo;
    /** The cells the data decides (`size` is stamped at render — it carries the clock and the spinner while the task runs). */
    cells: TableRow['cells'];
    /** The output's size text (`12.1 MB` / `—`). */
    size: string;
    /** The task's latest dataflow event, if any. */
    event: DataflowEvent | undefined;
}

/** A record's row: the cells the data decides, and the newest commit the `LAST COMMIT` cell is stamped from per frame. */
export interface RecordRowModel {
    /** The cells the data decides (`lastCommit` carries the clock, so it is stamped at render). */
    cells: TableRow['cells'];
    /** The record's newest commit, once read. */
    head: RecordCommitInfo | null;
}

/**
 * The data-derived column: everything that follows from the workspace's
 * data and the terminal width. Built by {@link dashboardModel}, rendered
 * by {@link dashboardLines}.
 *
 * @property status - The status the model follows (undefined → `placeholder` is the whole column)
 * @property placeholder - The column while there is no status: nothing deployed, an error, or loading
 * @property counts - The counts block (the two stat groups and the accounted bar)
 * @property execution - The execution the panel shows
 * @property live - Whether the panel shows the live feed
 * @property done - Tasks the run has ended (the live feed's `N of M tasks`)
 * @property feed - The rows the panel lists: while live, the last of the rows {@link liveRows} gives; after, each task's failure
 * @property latest - The latest event per task
 * @property taskPlan - The tasks table's fitted column plan
 * @property tasks - The task rows
 * @property inputPlan - The inputs table's fitted column plan
 * @property inputs - The input rows
 * @property inputNames - The input names, in row order
 * @property recordPlan - The records table's fitted column plan
 * @property records - The record rows
 * @property recordNames - The record names, in row order
 * @property rows - The selectable rows in column order (failures, tasks, inputs, records) with their line indices
 * @property total - Lines in the column
 * @property panelAt - The execution panel's first line
 * @property tasksAt - The TASKS section line (the header follows, then the rows)
 * @property inputsAt - The INPUTS section line
 * @property recordsAt - The RECORDS section line, or -1 when the workspace holds no record
 */
export interface DashboardModel {
    status: WorkspaceStatusResult | undefined;
    placeholder: Line[];
    counts: Line[];
    execution: ExecutionData | undefined;
    live: boolean;
    done: number;
    feed: FeedRow[];
    latest: ReadonlyMap<string, DataflowEvent>;
    taskPlan: ColumnSpec[];
    tasks: TaskRowModel[];
    inputPlan: ColumnSpec[];
    inputs: TableRow[];
    inputNames: string[];
    recordPlan: ColumnSpec[];
    records: RecordRowModel[];
    recordNames: string[];
    rows: DashboardRow[];
    total: number;
    panelAt: number;
    tasksAt: number;
    inputsAt: number;
    recordsAt: number;
}

/** What the model is keyed on — identities, so a poll that replaces a value rebuilds and a selection move does not. */
interface DashboardKey {
    ws: string;
    status: WorkspaceStatusResult | undefined;
    statusError: string | undefined;
    workspaceState: WorkspaceState | null | undefined;
    execution: ExecutionData | undefined;
    datasets: DataState['datasets'][string] | undefined;
    taskList: DataState['taskList'][string] | undefined;
    records: DataState['records'][string] | undefined;
    columns: number;
    bp: Breakpoint;
    g: Glyphs;
}

let cached: { key: DashboardKey; model: DashboardModel } | null = null;

function sameKey(a: DashboardKey, b: DashboardKey): boolean {
    return a.ws === b.ws && a.status === b.status && a.statusError === b.statusError && a.workspaceState === b.workspaceState
        && a.execution === b.execution && a.datasets === b.datasets && a.taskList === b.taskList && a.records === b.records
        && a.columns === b.columns && a.bp === b.bp && a.g === b.g;
}

/**
 * The dashboard model for a workspace — built once per data change and
 * returned as the same object until the status, the execution, the
 * dataset list, the task list, the records read, the width or the
 * breakpoint changes. The
 * clock, the spinner and the selection are not inputs: they restyle lines
 * at render ({@link dashboardLines}).
 *
 * @param state - The store state
 * @param ws - The workspace
 * @param dctx - The dashboard context (its width and breakpoint key the cache)
 * @returns The model
 */
export function dashboardModel(state: TuiState, ws: string, dctx: DashboardCtx): DashboardModel {
    const key: DashboardKey = {
        ws,
        status: state.data.status[ws]?.result,
        statusError: state.data.statusError[ws],
        workspaceState: state.data.workspaceState[ws],
        execution: state.data.execution[ws],
        datasets: state.data.datasets[ws],
        taskList: state.data.taskList[ws],
        records: state.data.records[ws],
        columns: dctx.columns,
        bp: dctx.bp,
        g: dctx.g,
    };
    if (cached !== null && sameKey(cached.key, key)) return cached.model;
    const model = buildModel(state, ws, dctx, key);
    cached = { key, model };
    return model;
}

/** Builds the model (the cache's miss path). */
function buildModel(state: TuiState, ws: string, dctx: DashboardCtx, key: DashboardKey): DashboardModel {
    const g = dctx.g;
    const width = dctx.columns - 1;
    const status = key.status;
    const execution = key.execution;
    const empty: DashboardModel = {
        status, placeholder: [], counts: [], execution, live: false, done: 0, feed: [], latest: new Map(),
        taskPlan: [], tasks: [], inputPlan: [], inputs: [], inputNames: [], recordPlan: [], records: [], recordNames: [],
        rows: [], total: 0, panelAt: 0, tasksAt: 0, inputsAt: 0, recordsAt: -1,
    };
    if (status === undefined) {
        const placeholder: Line[] = [];
        if (key.workspaceState === null) {
            placeholder.push(...centredBlock(g.empty, 'muted', 'NOTHING DEPLOYED', [`${ws} has no package yet`, `e3 workspace deploy <repo> ${ws} <package>[@version]   deploy one`, '/workspaces   pick another workspace'], width));
        } else if (key.statusError !== undefined) {
            placeholder.push([t(' '), b(`${g.cross} ${key.statusError}`, 'neg')]);
        } else {
            placeholder.push([t(' '), d('loading…')]);
        }
        return { ...empty, placeholder, total: placeholder.length };
    }
    // The dataset map and the latest event per task: once per build, shared by every row.
    const entries = datasetEntries(state, ws);
    const latestEvents = latestPerTask(execution?.events ?? []);
    const latest = new Map(latestEvents.map(e => [e.value.task, e] as const));
    const live = isLive(execution);
    // A requeue is a unit's, and ends no task.
    const done = execution === undefined ? 0 : execution.events.filter(e => e.type !== 'start' && e.type !== 'requeued').length;
    const feed = execution === undefined || execution.state === null ? []
        : live ? liveRows(execution, latestEvents, g).slice(-MAX_EVENT_ROWS)
        : latestEvents.filter(opensLogs).map(event => eventRow(event, g));
    const tasks: TaskRowModel[] = status.tasks.map(task => {
        const cell = taskStatusCell(task.status, g);
        // The reason / pid / cached detail lives in the last column; only a failure's exit code / message stays inline.
        const bare = task.status.type !== 'failed' && task.status.type !== 'error';
        const inputs = task.inputs.filter(p => p.startsWith('.inputs.')).map(p => p.slice('.inputs.'.length));
        const entry = entries.get(task.output);
        return {
            task,
            event: latest.get(task.name),
            size: entry?.size != null ? formatSize(entry.size) : '—',
            cells: {
                name: task.name,
                status: { text: bare ? `${cell.glyph} ${cell.word}` : statusText(cell), tone: cell.tone },
                dependsOn: task.dependsOn.length > 0 ? task.dependsOn.join(', ') : '—',
                inputs: inputs.length > 0 ? inputs.join(', ') : '—',
                output: entry?.type ?? '—',
                peak: task.peakBytes.type === 'some' ? formatSize(Number(task.peakBytes.value)) : '—',
            },
        };
    });
    const inputDatasets = status.datasets.filter(ds => !ds.isTaskOutput && ds.path.startsWith('.inputs.'));
    const inputNames = inputDatasets.map(ds => ds.path.slice('.inputs.'.length));
    const inputs: TableRow[] = inputDatasets.map((ds, i) => {
        const cell = datasetStatusCell(ds.status.type, g);
        const entry = entries.get(ds.path);
        return {
            cells: {
                name: inputNames[i]!,
                status: { text: statusText(cell), tone: cell.tone },
                type: entry?.type ?? '—',
                size: entry?.size != null ? formatSize(entry.size) : '—',
                hash: ds.hash.type === 'some' ? hashShort(ds.hash.value) : '—',
            },
        };
    });
    // The dataset list names the records; what the records loader read of each fills its row.
    const recordNames = recordEntries(key.datasets ?? []).map(entry => entry.name);
    const records: RecordRowModel[] = recordNames.map(name => {
        const facts = key.records?.[name];
        const entry = entries.get(`.records.${name}`);
        const indexes = facts?.signature?.indexes.map(index => index.name) ?? null;
        return {
            head: facts?.head ?? null,
            cells: {
                name,
                rows: facts?.rows != null ? formatInt(facts.rows) : '—',
                size: entry?.size != null ? formatSize(entry.size) : '—',
                indexes: indexes === null ? '…' : indexes.length > 0 ? indexes.join(', ') : '—',
            },
        };
    });
    const taskPlan = tablePlan(columnPlan('tasks', dctx.bp), tasks, width);
    const inputPlan = tablePlan(columnPlan('inputs', dctx.bp), inputs, width);
    const recordPlan = records.length > 0 ? tablePlan(columnPlan('records', dctx.bp), records, width) : [];
    const counts = countsLines(status, dctx);
    // The geometry: every selectable row's line, numbered in column order — failures, tasks, inputs, records.
    const rows: DashboardRow[] = [];
    let line = counts.length + 1;
    const panelAt = line;
    const shown = feed.slice(0, MAX_EVENT_ROWS);
    shown.forEach((row, i) => {
        if (row.logs) rows.push({ kind: 'logs', name: row.task, line: panelAt + 1 + i });
    });
    line += 1 + shown.length + (feed.length > shown.length ? 1 : 0) + 1;
    const tasksAt = line;
    line += 2;
    status.tasks.forEach((task, i) => rows.push({ kind: 'task', name: task.name, line: line + i }));
    line += Math.max(1, tasks.length) + 1;
    const inputsAt = line;
    line += 2;
    inputNames.forEach((name, i) => rows.push({ kind: 'input', name, line: line + i }));
    line += Math.max(1, inputs.length);
    // A workspace without records has no RECORDS section at all.
    let recordsAt = -1;
    if (records.length > 0) {
        line += 1;
        recordsAt = line;
        line += 2;
        recordNames.forEach((name, i) => rows.push({ kind: 'record', name, line: line + i }));
        line += records.length;
    }
    return {
        ...empty, counts, live, done, feed, latest, taskPlan, tasks, inputPlan, inputs, inputNames, recordPlan, records, recordNames,
        rows, total: line, panelAt, tasksAt, inputsAt, recordsAt,
    };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** The execution panel: a header line, then the event rows (the header and the ages carry the clock and the spinner). */
function executionLines(model: DashboardModel, sel: DashboardRow | undefined, dctx: DashboardCtx): Line[] {
    const g = dctx.g;
    const sep = g.sep;
    const width = dctx.columns - 1;
    const spin = g.spinner[dctx.spinner % g.spinner.length]!;
    const execution = model.execution;
    const tasksTotal = model.status?.tasks.length ?? 0;
    const lines: Line[] = [];
    let title = 'LAST EXECUTION';
    let right: Line;
    if (execution === undefined) {
        right = [d('…')];
    } else if (execution.state === null) {
        right = execution.settling ? [b(`${g.quarter} STARTING`, 'info'), d(` ${sep} ${spin}`)] : [d(`${g.empty} never run ${sep} r run`)];
        if (execution.settling) title = 'EXECUTION';
    } else if (model.live) {
        title = 'EXECUTION';
        const head = execution.stopping ? b(`${g.square} STOPPING`, 'warn') : b(`${g.quarter} RUNNING`, 'info');
        // What the server's budget holds now, where it has one: `memory 9.4 of 14 GB`, the unit once when both share it.
        const budget = execution.state.budget.type === 'some' ? execution.state.budget.value : null;
        let room = '';
        if (budget !== null) {
            const memory = formatSize(Number(budget.memory));
            const inUse = formatSize(Number(budget.memoryInUse));
            const unit = memory.slice(memory.indexOf(' '));
            room = ` ${sep} cores ${budget.coresInUse} of ${budget.cores} ${sep} memory ${inUse.endsWith(unit) ? inUse.slice(0, -unit.length) : inUse} of ${memory}`;
        }
        const age = ` ${sep} started ${timeAgo(execution.state.startedAt, dctx.now)}`;
        const count = ` ${sep} ${model.done} of ${tasksTotal} tasks`;
        const end = ` ${sep} ${spin}`;
        // Short of room, the run's age gives way to the budget (each feed row carries its own age), then the budget to the age.
        const detail = [age + count + room, count + room, age + count].find(text => lineWidth([t(` ${title} `), head, t(`${text}${end} `)]) <= width) ?? age + count;
        right = [head, d(detail + end)];
    } else {
        const state = execution.state;
        const cell = executionStatusCell(state.status.type, g);
        let detail = ` ${sep} started ${timeAgo(state.startedAt, dctx.now)}`;
        if (state.summary.type === 'some') {
            const s = state.summary.value;
            detail += ` ${sep} ${formatDuration(executionDuration(state) ?? s.duration)} ${sep} executed ${s.executed} ${sep} cached ${s.cached} ${sep} failed ${s.failed} ${sep} skipped ${s.skipped}`;
        }
        right = [b(`${cell.glyph} ${cell.word}`, cell.tone), d(detail)];
    }
    lines.push(lrLine([t(' '), b(title)], [...right, t(' ')], width));
    const shown = model.feed.slice(0, MAX_EVENT_ROWS);
    for (const row of shown) {
        const selected = row.logs && sel?.kind === 'logs' && sel.name === row.task;
        const left: Line = [
            t(' '),
            selected ? b(g.sel, 'brand') : t(' '),
            t(padStart(ageBare(row.timestamp, dctx.now), 4)),
            t('  '),
            b(row.cell.glyph, row.cell.tone),
            t(padEnd(` ${row.cell.word}`, 13)),
            selected ? b(row.task) : t(row.task),
        ];
        if (row.place !== '') left.push(d(` ${sep} ${row.place}`));
        const detail: Line = [];
        if (row.running) detail.push(d(`${spin} ${ageBare(row.timestamp, dctx.now)}`));
        else if (row.cell.detail !== '') detail.push(d(row.cell.detail));
        if (row.logs) detail.push(t('     '), b(`${g.enter} logs`, 'brand'));
        lines.push(lrLine(left, [...detail, t(' ')], width));
    }
    if (model.feed.length > shown.length) {
        lines.push([t('   '), d(`… ${model.feed.length - shown.length} more failed ${sep} /logs <task>`)]);
    }
    return lines;
}

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

/** The `LAST COMMIT` cell of a record row: `set_status · alice · 3m ago`. */
function lastCommitText(head: RecordCommitInfo | null, dctx: DashboardCtx): string {
    if (head === null) return '—';
    return `${head.mutation} ${dctx.g.sep} ${head.actor} ${dctx.g.sep} ${timeAgo(head.at, dctx.now)}`;
}

/**
 * The column's lines in `[top, top + visible)` — the window the screen
 * shows, rendered from the model with the selected row restyled and the
 * clock and the spinner stamped in.
 *
 * @param model - The dashboard model
 * @param dctx - The dashboard context
 * @param sel - The selected row index
 * @param top - The first line
 * @param visible - Lines in the window
 * @returns The lines (fewer when the column ends first)
 */
export function dashboardLines(model: DashboardModel, dctx: DashboardCtx, sel: number, top: number, visible: number): Line[] {
    const g = dctx.g;
    const width = dctx.columns - 1;
    const first = Math.max(0, top);
    const end = Math.min(model.total, first + visible);
    if (model.status === undefined) return model.placeholder.slice(first, end);
    const selected = model.rows[Math.max(0, Math.min(sel, model.rows.length - 1))];
    const panel = executionLines(model, selected, dctx);
    const taskSel = selected?.kind === 'task' ? model.tasks.findIndex(row => row.task.name === selected.name) : -1;
    const inputSel = selected?.kind === 'input' ? model.inputNames.indexOf(selected.name) : -1;
    const recordSel = selected?.kind === 'record' ? model.recordNames.indexOf(selected.name) : -1;
    const tasksFirst = model.tasksAt + 2;
    const inputsFirst = model.inputsAt + 2;
    const recordsFirst = model.recordsAt + 2;
    const out: Line[] = [];
    for (let i = first; i < end; i++) {
        if (i < model.counts.length) out.push(model.counts[i]!);
        else if (i < model.panelAt) out.push(blank(width));
        else if (i < model.panelAt + panel.length) out.push(panel[i - model.panelAt]!);
        else if (i < model.tasksAt) out.push(blank(width));
        else if (i === model.tasksAt) out.push(sectionLine('TASKS', '', width));
        else if (i === model.tasksAt + 1) out.push(tableLine(model.taskPlan, null, false, width, g));
        else if (i < model.inputsAt - 1) {
            const row = model.tasks[i - tasksFirst];
            if (row === undefined) out.push([t('  '), d('no tasks')]);
            else out.push(tableLine(model.taskPlan, { cells: { ...row.cells, size: lastRunText(row.task, row.event, row.size, dctx) } }, i - tasksFirst === taskSel, width, g));
        }
        else if (i < model.inputsAt) out.push(blank(width));
        else if (i === model.inputsAt) out.push(sectionLine('INPUTS', '', width));
        else if (i === model.inputsAt + 1) out.push(tableLine(model.inputPlan, null, false, width, g));
        else if (model.recordsAt === -1 || i < model.recordsAt - 1) {
            const row = model.inputs[i - inputsFirst];
            if (row === undefined) out.push([t('  '), d('no inputs')]);
            else out.push(tableLine(model.inputPlan, row, i - inputsFirst === inputSel, width, g));
        }
        else if (i < model.recordsAt) out.push(blank(width));
        else if (i === model.recordsAt) out.push(sectionLine('RECORDS', '', width));
        else if (i === model.recordsAt + 1) out.push(tableLine(model.recordPlan, null, false, width, g));
        else {
            const row = model.records[i - recordsFirst]!;
            out.push(tableLine(model.recordPlan, { cells: { ...row.cells, lastCommit: lastCommitText(row.head, dctx) } }, i - recordsFirst === recordSel, width, g));
        }
    }
    return out;
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
    const dctx = dashboardCtx(state, ctx);
    const model = dashboardModel(state, ws, dctx);
    const visible = Math.max(1, ctx.layout.bodyRows - 1);
    const total = model.total;
    const top = Math.max(0, Math.min(state.view.list.top, Math.max(0, total - visible)));
    const window = dashboardLines(model, dctx, state.view.list.sel, top, visible);
    while (window.length < visible) window.push(blank(width - 1));
    out.push(...withScrollbar(window, width, total, visible, top, ctx.g));
    const hits: Hit[] = model.rows
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
    const { model, visible } = nav;
    const total = model.total;
    const current = state.view.list.top;
    const top = Math.max(0, Math.min('delta' in to ? current + to.delta : to.top, Math.max(0, total - visible)));
    let sel = state.view.list.sel;
    if (model.rows.length > 0) {
        const line = model.rows[Math.max(0, Math.min(sel, model.rows.length - 1))]!.line;
        if (line < top || line >= top + visible) {
            // The selection follows the window: the first (or last) row inside it.
            const inside = model.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.line >= top && r.line < top + visible);
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

/** The model and the window geometry for navigation (no theme needed; the model comes from the cache). */
function navigation(state: TuiState, controller: Controller): { model: DashboardModel; visible: number } | null {
    if (state.view.kind !== 'dashboard') return null;
    const layout = layoutOf(state);
    const dctx: DashboardCtx = { g: controller.deps.glyphs, now: controller.deps.now(), columns: layout.columns, bp: breakpoint(state.size), spinner: 0 };
    return { model: dashboardModel(state, state.view.ws, dctx), visible: Math.max(1, layout.bodyRows - 1) };
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
    const { model, visible } = nav;
    if (model.rows.length === 0) return;
    const sel = Math.max(0, Math.min(index, model.rows.length - 1));
    const top = scrollIntoView(state.view.list.top, model.rows[sel]!.line, visible, model.total);
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
    const { model, visible } = nav;
    const total = model.total;
    const count = model.rows.length;
    const page = Math.max(1, visible - 1);
    if (count === 0) {
        const delta = op === 'up' ? -1 : op === 'down' ? 1 : op === 'pageUp' ? -page : op === 'pageDown' ? page : op === 'home' ? -total : total;
        const top = Math.max(0, Math.min(state.view.list.top + delta, Math.max(0, total - visible)));
        controller.dispatch({ type: 'view/set', view: { ...state.view, list: { sel: 0, top } } });
        return;
    }
    const last = count - 1;
    const current = Math.max(0, Math.min(state.view.list.sel, last));
    const line = model.rows[current]!.line;
    let sel = current;
    switch (op) {
        case 'up': sel = Math.max(0, current - 1); break;
        case 'down': sel = Math.min(last, current + 1); break;
        case 'home': sel = 0; break;
        case 'end': sel = last; break;
        case 'pageUp': {
            const target = line - page;
            let i = current;
            while (i > 0 && model.rows[i - 1]!.line >= target) i--;
            sel = i === current ? Math.max(0, current - 1) : i;
            break;
        }
        case 'pageDown': {
            const target = line + page;
            let i = current;
            while (i < last && model.rows[i + 1]!.line <= target) i++;
            sel = i === current ? Math.min(last, current + 1) : i;
            break;
        }
    }
    // Home shows the column from its start and End from its end; the other moves scroll minimally.
    const top = op === 'home' ? 0
        : op === 'end' ? Math.max(0, total - visible)
        : scrollIntoView(state.view.list.top, model.rows[sel]!.line, visible, total);
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
        const row = nav.model.rows[Math.max(0, Math.min(state.view.list.sel, nav.model.rows.length - 1))];
        if (row === undefined) return;
        const ws = state.view.ws;
        if (row.kind === 'logs') controller.openTask(ws, row.name, 'stdout');
        else if (row.kind === 'task') controller.openTask(ws, row.name);
        else if (row.kind === 'record') controller.openRecord(ws, row.name);
        else controller.openInput(ws, row.name);
    },
    key: (action, state, controller) => {
        if (action.kind !== 'move' || state.view.kind !== 'dashboard') return false;
        moveDashboard(state, controller, action.op);
        return true;
    },
});
