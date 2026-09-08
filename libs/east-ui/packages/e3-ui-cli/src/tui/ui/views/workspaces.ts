/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The workspaces view — `workspaceList` enriched with each workspace's
 * status summary and last execution (fetched lazily, one at a time);
 * `⏎` opens one as the new root.
 *
 * @packageDocumentation
 */

import { breakpoint, columnPlan } from '../../render/layout.js';
import { formatDuration, timeAgo } from '../../render/text.js';
import type { TuiState } from '../../state/actions.js';
import { registerListModel } from '../../model/index.js';
import { executionStatusCell } from '../../model/status.js';
import { registerViewHooks } from '../../controller.js';
import type { Line, RenderCtx } from '../lines.js';
import { blank } from '../lines.js';
import { renderTable, sectionLine, withScrollbar, type TableRow } from '../shell/widgets.js';
import { registerView } from './index.js';

/** The `● 4  ◐ 1  ✗ 1` task summary of a workspace, or `○ 6 ready`, or `—`. */
export function taskSummary(state: TuiState, ws: string, ctx: RenderCtx): string {
    const g = ctx.g;
    const status = state.data.status[ws]?.result;
    if (status === undefined) return '…';
    const s = status.summary.tasks;
    const total = Number(s.total);
    if (total === 0) return '—';
    const running = Number(s.inProgress);
    const upToDate = Number(s.upToDate);
    const waiting = Number(s.waiting);
    const failed = Number(s.failed) + Number(s.error) + Number(s.staleRunning);
    const ready = Number(s.ready);
    if (ready === total) return `${g.empty} ${total} ready`;
    const parts: string[] = [];
    if (upToDate > 0) parts.push(`${g.dot} ${upToDate}`);
    if (running > 0) parts.push(`${g.quarter} ${running}`);
    if (waiting > 0) parts.push(`${g.half} ${waiting}`);
    if (failed > 0) parts.push(`${g.cross} ${failed}`);
    if (ready > 0) parts.push(`${g.empty} ${ready}`);
    return parts.join('  ');
}

/** The `✗ failed · 2m ago · 38.4s` last-run cell of a workspace. */
export function lastRun(state: TuiState, ws: string, ctx: RenderCtx): { text: string; tone: 'pos' | 'neg' | 'warn' | 'info' | 'muted' } {
    const g = ctx.g;
    const execution = state.data.execution[ws];
    if (execution === undefined) return { text: '…', tone: 'muted' };
    if (execution.state === null) return { text: `${g.empty} never run`, tone: 'muted' };
    const cell = executionStatusCell(execution.state.status.type, g);
    const duration = execution.state.summary.type === 'some' ? ` ${g.sep} ${formatDuration(execution.state.summary.value.duration * 1000)}` : '';
    return { text: `${cell.glyph} ${cell.word.toLowerCase()} ${g.sep} ${timeAgo(execution.state.startedAt, ctx.now)}${duration}`, tone: cell.tone as 'pos' | 'neg' | 'warn' | 'info' };
}

/** The rows of the workspaces table. */
export function workspaceRows(state: TuiState, ctx: RenderCtx): TableRow[] {
    const g = ctx.g;
    return (state.data.workspaces ?? []).map(w => {
        const pkg = w.packageName.type === 'some' ? `${w.packageName.value}${w.packageVersion.type === 'some' ? `@${w.packageVersion.value}` : ''}` : '—';
        const run = w.deployed ? lastRun(state, w.name, ctx) : { text: '—', tone: 'muted' as const };
        return {
            cells: {
                name: w.name,
                state: w.deployed ? { text: `${g.dot} DEPLOYED`, tone: 'pos' as const } : { text: `${g.empty} EMPTY`, tone: 'muted' as const },
                package: pkg,
                tasks: w.deployed ? taskSummary(state, w.name, ctx) : '—',
                lastRun: { text: run.text, tone: run.tone },
            },
        };
    });
}

const CHROME_ROWS = 3;

registerListModel('workspaces', (state, layout) => ({
    count: state.data.workspaces?.length ?? 0,
    visible: Math.max(1, layout.bodyRows - CHROME_ROWS),
}));

registerView('workspaces', (state, ctx) => {
    if (state.view.kind !== 'workspaces') return { body: [], hints: { left: '', right: '' } };
    const width = ctx.layout.columns;
    const rows = workspaceRows(state, ctx);
    const total = rows.length;
    const body: Line[] = [
        sectionLine(`WORKSPACES ${ctx.g.sep} ${state.session?.label ?? ''}`, `${total} of ${total}`, width),
        blank(width),
    ];
    const visible = Math.max(1, ctx.layout.bodyRows - CHROME_ROWS);
    const { sel, top } = state.view.list;
    const table = renderTable(columnPlan('workspaces', breakpoint(state.size)), rows, sel, top, visible, width - 1, ctx.g);
    const dataRows = table.slice(1);
    while (dataRows.length < visible) dataRows.push(blank(width - 1));
    body.push(table[0]!, ...withScrollbar(dataRows, width, total, visible, top, ctx.g));
    if (state.data.workspaces === null) body[3] = [{ text: '  loading workspaces…', dim: true }];
    else if (total === 0) body[3] = [{ text: '  no workspaces — e3 workspace create <repo> <name>', dim: true }];
    return {
        body,
        hints: { left: `${ctx.g.up}${ctx.g.down} move   ${ctx.g.enter} open   /workspace <name>`, right: 'q quit' },
    };
});

registerViewHooks('workspaces', {
    open: (state, controller) => {
        if (state.view.kind !== 'workspaces') return;
        const ws = state.data.workspaces?.[state.view.list.sel];
        if (ws === undefined) return;
        controller.openWorkspace(ws.name);
    },
});
