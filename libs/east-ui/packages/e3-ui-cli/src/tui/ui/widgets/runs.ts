/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Runs tab — `taskExecutionList` (every attempt, `all=true`) newest
 * first: status, started, duration, exit code, the inputs hash (`← current`
 * on the newest when the task is up to date); `⏎` expands the selected
 * run's input hashes, paired with the task's input paths. A retry after a
 * failure and a forced re-run each add a row under the same inputs hash.
 *
 * @packageDocumentation
 */

import type { ExecutionListItem } from '@elaraai/e3-api-client';
import { dottedPath } from '../../api.js';
import { breakpoint, columnPlan } from '../../render/layout.js';
import { formatDuration, formatStamp, hashMid, hashTiny } from '../../render/text.js';
import type { Glyphs } from '../../render/glyphs.js';
import { historyStatusCell } from '../../model/status.js';
import type { TuiState } from '../../state/actions.js';
import { b, d, t, type Line } from '../lines.js';
import { renderTable, withScrollbar, type TableRow } from '../shell/widgets.js';

/** Rows the header lines, the dashed rule and the table header take. */
export const RUNS_CHROME_ROWS = 4;

/**
 * The runs of a task, newest first.
 *
 * @param state - The store state
 * @param ws - The workspace
 * @param task - The task
 * @returns The runs
 */
export function runsOf(state: TuiState, ws: string, task: string): ExecutionListItem[] {
    return [...(state.data.executions[ws]?.[task] ?? [])].sort((a, c) => (a.startedAt < c.startedAt ? 1 : a.startedAt > c.startedAt ? -1 : 0));
}

/**
 * The table rows.
 *
 * @param runs - The runs, newest first
 * @param current - Whether the newest run is the task's current output
 * @param g - The glyph set
 * @returns The rows
 */
export function runRows(runs: readonly ExecutionListItem[], current: boolean, g: Glyphs): TableRow[] {
    return runs.map((run, i) => {
        const cell = historyStatusCell(run.status.type, g);
        return {
            cells: {
                status: { text: `${cell.glyph} ${cell.word}`, tone: cell.tone },
                started: formatStamp(run.startedAt),
                duration: run.duration.type === 'some' ? formatDuration(Number(run.duration.value)) : '—',
                exit: run.exitCode.type === 'some' ? String(run.exitCode.value) : '—',
                inputs: hashMid(run.inputsHash),
                note: i === 0 && current ? `${g.left} current` : '',
            },
        };
    });
}

/**
 * Renders the Runs tab: the table, then the expanded run's input hashes.
 *
 * @param state - The store state
 * @param ws - The workspace
 * @param task - The task
 * @param visible - Rows under the table header
 * @param width - The row width including the scrollbar column
 * @param g - The glyph set
 * @returns The lines (the table header first)
 */
export function renderRuns(state: TuiState, ws: string, task: string, visible: number, width: number, g: Glyphs): Line[] {
    const v = state.view;
    const ui = v.kind === 'task' ? v.runs : { sel: 0, top: 0, expanded: false };
    const runs = runsOf(state, ws, task);
    const status = state.data.status[ws]?.result.tasks.find(x => x.name === task)?.status.type;
    const rows = runRows(runs, status === 'up-to-date', g);
    const table = renderTable(columnPlan('runs', breakpoint(state.size)), rows, ui.sel, ui.top, visible, width - 1, g);
    const header = table[0]!;
    const body = table.slice(1);
    if (runs.length === 0) body.push([t('  '), d(state.data.executions[ws]?.[task] === undefined ? 'loading…' : 'no runs yet — r runs the dataflow')]);
    if (ui.expanded) {
        const run = runs[ui.sel];
        if (run !== undefined) {
            const inputs = state.data.taskDetails[ws]?.[task]?.inputs ?? [];
            const pairs = run.inputHashes.map((h, i) => {
                const p = inputs[i];
                const name = p === undefined ? `#${i + 1}` : dottedPath(p).replace(/^\.inputs\./, '').replace(/^\.tasks\./, '.tasks.');
                return `${name} ${hashTiny(h)}`;
            });
            body.push([t(' ')]);
            body.push([t(' '), b(g.bullet, 'brand'), t(` ${hashMid(run.inputsHash)} = sha256 of the inputs (${pairs.join(', ')}) `), d(`${g.sep} ${g.enter} collapses`)]);
        }
    }
    while (body.length < visible) body.push([t(' '.repeat(width - 1))]);
    return [header, ...withScrollbar(body.slice(0, visible), width, runs.length, visible, ui.top, g)];
}
