/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the workspace dashboard's column holds — the model its view draws.
 * While a deploy holds the workspace, the column is the deploy: its header,
 * and the INPUTS and RECORDS tables with the step it is at with each file
 * source and record. Otherwise it is the counts with the accounted bar, the
 * execution panel's rows (the last run's failures; while it runs, each
 * task's latest event, the units requeued and what waits for room), and the
 * tasks, inputs and records tables.
 *
 * {@link dashboardModel} derives it from the data and the width — the
 * counts, the rows the panel lists, the latest event per task, the dataset
 * map, the fitted table plans, each row's cells and where each selectable
 * row sits — once per data change: a single-entry cache keyed on the
 * identity of the status, the execution, the dataset list, the task list,
 * the records read, the width and the breakpoint. The view
 * (`dashboard.ts`) renders only the lines on screen from it.
 *
 * @packageDocumentation
 */

import type { DataflowEvent, DeployProgress, LockStatus, RecordCommitInfo, WorkspaceStatusResult } from '@elaraai/e3-api-client';
import type { WorkspaceState } from '@elaraai/e3-types';
import type { Glyphs } from '../../render/glyphs.js';
import { breakpoint, columnPlan, type Breakpoint, type ColumnSpec } from '../../render/layout.js';
import { compareInstants, formatDuration, formatInt, formatSize, hashShort, padEnd, padStart } from '../../render/text.js';
import type { Tone } from '../../render/theme.js';
import type { DataState, ExecutionData, TuiState } from '../../state/actions.js';
import { datasetEntries } from '../../model/catalogue.js';
import {
    datasetStatusCell, eventCell, intakeCell, recordDeployCell, splitPlace, statusText, taskStatusCell, unitPlace, waitCell, type StatusCell,
} from '../../model/status.js';
import { recordEntries } from '../../data/records.js';
import { b, blank, d, lineWidth, lrLine, t, type Line, type RenderCtx } from '../lines.js';
import { centredBlock, sectionLine, tableLine, tablePlan, type TableRow } from '../shell/widgets.js';

export type TaskInfo = WorkspaceStatusResult['tasks'][number];

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


// ---------------------------------------------------------------------------
// A deploy in progress
// ---------------------------------------------------------------------------

/** The lock, when a deploy holds the workspace; null otherwise. */
export function deployOf(lock: LockStatus | null | undefined): LockStatus | null {
    return lock !== undefined && lock !== null && lock.state.operation.type === 'deployment' ? lock : null;
}

/** How far a deploy says it has got, once it has reported. */
export function deployProgressOf(lock: LockStatus): DeployProgress | null {
    return lock.progress.type === 'some' && lock.progress.value.type === 'deployment' ? lock.progress.value.value : null;
}

/**
 * The DEPLOY header's right side — what the deploy is doing and how far it has
 * got: `◔ TAKING IN · 2 of 6 files · 134.9 of 202.4 MB · 14.3 MB/s · ~5.2s left`
 * while its files come in, then `◔ MIGRATING` or `◔ BUILDING INDEXES` while a
 * record's step runs, and `◔ FINISHING` once its files and records are done.
 *
 * @param progress - What the deploy last reported
 * @param dctx - The dashboard context
 * @returns The spans
 */
function deployPhase(progress: DeployProgress, dctx: DashboardCtx): Line {
    const { sep, quarter } = dctx.g;
    const files = progress.files;
    const done = files.filter(file => file.step.type === 'done').length;
    const total = files.reduce((sum, file) => sum + Number(file.total), 0);
    const plural = `${files.length} file${files.length === 1 ? '' : 's'}`;
    if (done < files.length) {
        // The bytes past their hash: a file taking in, and every file in.
        const moved = files.reduce((sum, file) => sum + (file.step.type === 'done' ? Number(file.total) : file.step.type === 'taking_in' ? Number(file.bytes) : 0), 0);
        // `134.9 of 202.4 MB`: the unit once when both share it.
        const whole = formatSize(total);
        const part = formatSize(moved);
        const unit = whole.slice(whole.indexOf(' '));
        const seconds = (dctx.now - progress.startedAt.getTime()) / 1000;
        const rate = seconds > 0 ? moved / seconds : 0;
        const pace = rate > 0 ? ` ${sep} ${formatSize(rate)}/s ${sep} ~${formatDuration(((total - moved) / rate) * 1000)} left` : '';
        return [b(`${quarter} TAKING IN`, 'info'), d(` ${sep} ${done} of ${plural} ${sep} ${part.endsWith(unit) ? part.slice(0, -unit.length) : part} of ${whole}${pace}`)];
    }
    const running = progress.records.find(record => record.step.type === 'migrating' || record.step.type === 'indexing')?.step.type;
    const head = running === 'migrating' ? 'MIGRATING' : running === 'indexing' ? 'BUILDING INDEXES' : 'FINISHING';
    return [b(`${quarter} ${head}`, 'info'), ...(files.length > 0 ? [d(` ${sep} took in ${plural} ${sep} ${formatSize(total)}`)] : [])];
}

/**
 * The column while a deploy holds the workspace: the DEPLOY header, then the
 * normal screen's tables by type — INPUTS, a row per file source the deploy
 * takes in, and RECORDS, a row per record it deploys — each row with the step
 * the deploy is at with it.
 *
 * @param lock - The deploy's lock
 * @param dctx - The dashboard context
 * @returns The lines
 */
function deployLines(lock: LockStatus, dctx: DashboardCtx): Line[] {
    const g = dctx.g;
    const width = dctx.columns - 1;
    const progress = deployProgressOf(lock);
    if (progress === null) return [lrLine([t(' '), b('DEPLOY')], [b(`${g.quarter} STARTING`, 'info'), t(' ')], width)];
    const lines: Line[] = [lrLine([t(' '), b('DEPLOY')], [...deployPhase(progress, dctx), t(' ')], width)];
    const table = (title: string, kind: 'deployInputs' | 'deployRecords', rows: TableRow[]): void => {
        if (rows.length === 0) return;
        const plan = tablePlan(columnPlan(kind, dctx.bp), rows, width);
        lines.push(blank(width), sectionLine(title, '', width), tableLine(plan, null, false, width, g), ...rows.map(row => tableLine(plan, row, false, width, g)));
    };
    table('INPUTS', 'deployInputs', progress.files.map(file => {
        const cell = intakeCell(file, g);
        return { cells: { name: file.path.split('/').pop() ?? file.path, status: { text: statusText(cell, ' '), tone: cell.tone }, size: formatSize(Number(file.total)) } };
    }));
    table('RECORDS', 'deployRecords', progress.records.map(record => {
        const cell = recordDeployCell(record, g);
        const path = record.plan.record;
        return { cells: { name: path.split('/').pop() ?? path, status: { text: statusText(cell), tone: cell.tone }, indexes: record.indexes.length > 0 ? record.indexes.join(', ') : '—' } };
    }));
    return lines;
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
    timestamp: Date;
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
    return rows.sort((a, c) => compareInstants(a.timestamp, c.timestamp));
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
    /** What holds the workspace: while a deploy does, the column is the deploy. */
    lock: LockStatus | null | undefined;
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
        && a.lock === b.lock && a.execution === b.execution && a.datasets === b.datasets && a.taskList === b.taskList && a.records === b.records
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
        lock: state.data.lock[ws],
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
    // While a deploy holds the workspace, the column is the deploy: what the
    // workspace held before is going, and a first deploy has nothing else.
    const deploying = deployOf(key.lock);
    if (deploying !== null) {
        const placeholder = deployLines(deploying, dctx);
        return { ...empty, status: undefined, placeholder, total: placeholder.length };
    }
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
