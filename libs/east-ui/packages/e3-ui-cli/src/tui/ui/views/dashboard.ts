/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The workspace dashboard — the title line, then one scrolling column. While
 * a deploy holds the workspace, the column is the deploy: its header, and the
 * INPUTS and RECORDS tables with the step it is at with each file source and
 * record. Otherwise, the TASKS / DATASETS counts with the accounted bar, the execution panel
 * (the last run's failures; while it runs, the budget in use and the live
 * feed: each task's latest event, the units requeued and what waits for
 * room), the tasks table, the inputs table and, when the workspace holds
 * records, the records table. `⏎` opens the task, the input, the record,
 * or a failed task's logs. Status detail is inline
 * (`✗ failed · exit 2`, `◐ waiting`, `◔ in-progress`).
 *
 * The column is built in two steps. `dashboardModel` (`dashboard-model.ts`)
 * derives what follows from the data and the width, once per data change.
 * {@link dashboardLines} then renders only the lines on screen, restyling
 * the selected row and stamping the clock and the spinner. A selection move
 * costs the window, not the workspace.
 *
 * @packageDocumentation
 */

import type { RecordCommitInfo } from '@elaraai/e3-api-client';
import { breakpoint, scrollIntoView } from '../../render/layout.js';
import { agoShort, formatDuration, formatSize, padEnd, padStart, timeAgo } from '../../render/text.js';
import type { NavOp, TuiState } from '../../state/actions.js';
import { layoutOf, registerListModel } from '../../model/index.js';
import { executionDuration, executionStatusCell } from '../../model/status.js';
import { registerViewHooks, type Controller } from '../../controller.js';
import { isRunLive, lockHolderText, runProgressText } from '../../data/dataflow.js';
import type { Hit, Pane } from '../frame.js';
import { b, blank, d, lineWidth, lrLine, t, type Line, type RenderCtx } from '../lines.js';
import { sectionLine, tableLine, withScrollbar } from '../shell/widgets.js';
import {
    MAX_EVENT_ROWS, dashboardCtx, dashboardModel, deployOf, deployProgressOf,
    type DashboardCtx, type DashboardModel, type DashboardRow, type TaskRowModel,
} from './dashboard-model.js';
import { registerView } from './index.js';

/** `12s` / `1m` / `3h` — an event's age without the `ago`. */
function ageBare(then: Date, now: number): string {
    const ago = timeAgo(then, now);
    return ago === 'just now' ? '0s' : ago.replace(/ ago$/, '');
}

/** The reason with its first letter lowered (`Waiting for task 'x'` → `waiting for task 'x'`). */
function lowerFirst(text: string): string {
    return text.length === 0 ? text : text[0]!.toLowerCase() + text.slice(1);
}

/**
 * The dashboard title line: ` main   ● DEPLOYED · demand@1.4.2 · deployed 3d ago · lock: none`;
 * while a deploy holds the workspace, the package it deploys, who deploys it
 * and since when, in place of the lock (`◔ DEPLOYING · demand@1.5.0 · pid 4242 · started 9s ago`).
 */
export function dashboardTitle(state: TuiState, ws: string, ctx: RenderCtx): Line {
    const g = ctx.g;
    const info = (state.data.workspaces ?? []).find(w => w.name === ws);
    const wsState = state.data.workspaceState[ws];
    const status = state.data.status[ws]?.result;
    const deploying = deployOf(state.data.lock[ws]);
    const right: Line = [];
    if (info === undefined || !info.deployed) {
        if (deploying === null) right.push(b(`${g.empty} EMPTY`, 'muted'));
    } else {
        const pkg = info.packageName.type === 'some' ? `${info.packageName.value}${info.packageVersion.type === 'some' ? `@${info.packageVersion.value}` : ''}` : '';
        right.push(b(`${g.dot} DEPLOYED`, 'pos'), d(` ${g.sep} ${pkg}`));
        if (wsState !== undefined && wsState !== null) right.push(d(` ${g.sep} deployed ${timeAgo(wsState.deployedAt, ctx.now)}`));
    }
    const lock = status?.lock;
    if (deploying !== null) {
        if (right.length > 0) right.push(t(` ${g.sep} `));
        right.push(b(`${g.quarter} DEPLOYING`, 'info'));
        const progress = deployProgressOf(deploying);
        const holder = deploying.state.holder;
        // The process's pid, not its command: the command is the whole argv, paths and all.
        const who = holder.type === 'process' ? `pid ${holder.value.pid}` : holder.value.functionName;
        const pkg = progress !== null ? ` ${g.sep} ${progress.package.name}@${progress.package.version}` : '';
        right.push(d(`${pkg} ${g.sep} ${who} ${g.sep} started ${timeAgo(deploying.state.acquiredAt, ctx.now)}`));
    } else if (lock !== undefined) {
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
// Rendering
// ---------------------------------------------------------------------------

/** The execution panel: a header line, then the event rows (the header and the ages carry the clock and the spinner). */
function executionLines(model: DashboardModel, sel: DashboardRow | undefined, dctx: DashboardCtx): Line[] {
    const g = dctx.g;
    const sep = g.sep;
    const width = dctx.columns - 1;
    const spin = g.spinner[dctx.spinner % g.spinner.length]!;
    const execution = model.execution;
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
        const count = ` ${sep} ${runProgressText({ done: model.done, total: model.steps, loads: model.loads })}`;
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
            // The tasks the run left waiting on an input nothing has set, when it left any
            if (s.waiting > 0n) detail += ` ${sep} waiting ${s.waiting}`;
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

/** The `SIZE · LAST RUN` cell of a row of the tasks table: a task's, or a load's. */
function lastRunText(row: TaskRowModel, dctx: DashboardCtx): string {
    const g = dctx.g;
    const spin = g.spinner[dctx.spinner % g.spinner.length]!;
    const { phase, event } = row;
    switch (phase.kind) {
        case 'running':
            return `${spin} ${phase.since !== null ? ageBare(phase.since, dctx.now) : 'running'}`;
        case 'waiting':
            return `— ${g.sep} ${lowerFirst(phase.reason)}`;
        default: {
            const run = event === undefined ? (phase.never ? 'never' : '—')
                : event.type === 'complete' || event.type === 'failed' ? formatDuration(event.value.duration)
                : event.type === 'cached' ? 'cached'
                : event.type === 'error' ? 'error'
                : event.type === 'input_unavailable' ? 'skipped'
                : '—';
            return `${row.size} ${g.sep} ${run}`;
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
    const taskSel = selected?.kind === 'task' || selected?.kind === 'load' ? model.tasks.findIndex(row => row.name === selected.name) : -1;
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
            else out.push(tableLine(model.taskPlan, { cells: { ...row.cells, size: lastRunText(row, dctx) } }, i - tasksFirst === taskSel, width, g));
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
            // A record's row, or a line of one of a composite record's sources under it
            const at = model.recordLines[i - recordsFirst]!;
            const row = model.records[at.record]!;
            if (at.source !== null) out.push(row.sources[at.source]!);
            else out.push(tableLine(model.recordPlan, { cells: { ...row.cells, lastCommit: lastCommitText(row.head, dctx) } }, at.record === recordSel, width, g));
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
        // A load's page has its logs and its runs, and no output of its own: its record has a row of the records table
        else if (row.kind === 'load') controller.openTask(ws, row.name, 'stdout');
        else if (row.kind === 'record') controller.openRecord(ws, row.name);
        else controller.openInput(ws, row.name);
    },
    key: (action, state, controller) => {
        if (action.kind !== 'move' || state.view.kind !== 'dashboard') return false;
        moveDashboard(state, controller, action.op);
        return true;
    },
});
