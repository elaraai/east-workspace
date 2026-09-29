/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Status words — the dot + word (+ inline detail) every table shows for
 * a task, a dataset, a file or a record a deploy is deploying, a workspace,
 * an execution or a connection: the cloud
 * UI's `formatStatusDetail` cases made inline, and the same words
 * `formatTaskStatus` (`e3 workspace status`) prints.
 *
 * @packageDocumentation
 */

import type {
    DataflowBudget, DataflowExecutionState, ExecutionHistoryStatus, ExecutionStatus, IntakeFile, RecordDeployState, TaskStatus, DataflowEvent,
    SplitProgress, StageUnit, UnitWait,
} from '@elaraai/e3-api-client';
import type { Glyphs } from '../render/glyphs.js';
import type { Tone } from '../render/theme.js';
import { formatDuration, formatSize } from '../render/text.js';
import type { ConnectionState } from '../state/poll.js';

/** A status cell: its glyph, its tone, the word and an inline detail. */
export interface StatusCell {
    glyph: string;
    tone: Tone;
    word: string;
    detail: string;
}

/** `● up-to-date`, `✗ failed · exit 2`, … */
export function statusText(cell: StatusCell, sep = ' · '): string {
    return `${cell.glyph} ${cell.word}${cell.detail !== '' ? `${sep}${cell.detail}` : ''}`;
}

/**
 * A task's status cell.
 *
 * @param status - The task status variant
 * @param g - The glyph set
 * @returns The cell
 */
export function taskStatusCell(status: TaskStatus, g: Glyphs): StatusCell {
    switch (status.type) {
        case 'up-to-date':
            return { glyph: g.dot, tone: 'pos', word: 'up-to-date', detail: status.value.cached ? 'cached' : '' };
        case 'ready':
            return { glyph: g.empty, tone: 'muted', word: 'ready', detail: '' };
        case 'waiting':
            return { glyph: g.half, tone: 'warn', word: 'waiting', detail: status.value.reason };
        case 'in-progress':
            return { glyph: g.quarter, tone: 'info', word: 'in-progress', detail: status.value.pid.type === 'some' ? `pid ${status.value.pid.value}` : '' };
        case 'failed':
            return { glyph: g.cross, tone: 'neg', word: 'failed', detail: `exit ${status.value.exitCode}` };
        case 'error':
            return { glyph: g.cross, tone: 'neg', word: 'error', detail: status.value.message };
        case 'stale-running':
            return { glyph: g.half, tone: 'warn', word: 'stale-running', detail: status.value.pid.type === 'some' ? `pid ${status.value.pid.value} gone` : '' };
    }
}

/**
 * A dataset's status cell.
 *
 * @param status - `unset` / `stale` / `up-to-date`
 * @param g - The glyph set
 * @returns The cell
 */
export function datasetStatusCell(status: 'unset' | 'stale' | 'up-to-date', g: Glyphs): StatusCell {
    switch (status) {
        case 'up-to-date': return { glyph: g.dot, tone: 'pos', word: 'up-to-date', detail: '' };
        case 'stale': return { glyph: g.half, tone: 'warn', word: 'stale', detail: '' };
        default: return { glyph: g.empty, tone: 'muted', word: 'unset', detail: '' };
    }
}

/** Cells of the bar a file's status carries while it moves. */
const BAR_CELLS = 10;

/**
 * A file source's status cell while a deploy takes it in: `○ waiting`, then
 * `◔ hashing` and `◔ taking in`, each with a bar of how far it has got — a
 * collection's moves as each piece of it is taken in — then `● taken in by`
 * the runner that took it in, `● unchanged` or `● carried` once it is in.
 *
 * @param file - The file, as the deploy reports it
 * @param g - The glyph set
 * @returns The cell (its detail is the bar: join it with a space, not the separator)
 */
export function intakeCell(file: IntakeFile, g: Glyphs): StatusCell {
    const total = Number(file.total);
    const fraction = total > 0 ? Math.min(1, Number(file.bytes) / total) : 0;
    const filled = Math.round(fraction * BAR_CELLS);
    const bar = `${g.thumb.repeat(filled)}${g.placeholder.repeat(BAR_CELLS - filled)} ${Math.floor(fraction * 100)}%`;
    switch (file.step.type) {
        case 'waiting': return { glyph: g.empty, tone: 'muted', word: 'waiting', detail: '' };
        case 'hashing': return { glyph: g.quarter, tone: 'info', word: 'hashing', detail: bar };
        case 'taking_in': return { glyph: g.quarter, tone: 'info', word: 'taking in', detail: bar };
        case 'done': {
            const taken = file.step.value;
            if (taken.type === 'taken') {
                return taken.value.length === 0
                    ? { glyph: g.dot, tone: 'pos', word: 'taken in', detail: '' }
                    : { glyph: g.dot, tone: 'pos', word: 'taken in by', detail: taken.value.join(' and ') };
            }
            return { glyph: g.dot, tone: 'pos', word: taken.type === 'known' ? 'unchanged' : 'carried', detail: '' };
        }
    }
}

/**
 * A record's status cell while a deploy deploys it: what the deploy decided
 * for it while it waits (`○ migrate · 2 steps · waiting`), the step it is at
 * (`◔ migrating · add_owner · 1 of 2`, `◔ building by_owner · 1 of 1`), and
 * what it did once it is done (`● migrated`).
 *
 * @param record - The record, as the deploy reports it
 * @param g - The glyph set
 * @returns The cell
 */
export function recordDeployCell(record: RecordDeployState, g: Glyphs): StatusCell {
    const action = record.plan.action;
    switch (record.step.type) {
        case 'waiting': {
            const steps = action.type === 'migrate' ? action.value.steps.length : 0;
            return { glyph: g.empty, tone: 'muted', word: action.type, detail: steps > 0 ? `${steps} step${steps === 1 ? '' : 's'} ${g.sep} waiting` : 'waiting' };
        }
        case 'migrating': {
            const { name, step, steps } = record.step.value;
            return { glyph: g.quarter, tone: 'info', word: 'migrating', detail: `${name} ${g.sep} ${step} of ${steps}` };
        }
        case 'indexing': {
            const { index, build, builds } = record.step.value;
            return { glyph: g.quarter, tone: 'info', word: `building ${index}`, detail: `${build} of ${builds}` };
        }
        case 'done': {
            const done: Record<typeof action.type, string> = { mint: 'minted', keep: 'kept', migrate: 'migrated', reset: 'reset', drop: 'dropped', refused: 'refused' };
            return { glyph: g.dot, tone: 'pos', word: done[action.type], detail: '' };
        }
    }
}

/**
 * An execution's status cell (`✗ FAILED`, `◔ RUNNING`, `● COMPLETED`, `■ ABORTED`).
 *
 * @param status - The execution status
 * @param g - The glyph set
 * @returns The cell
 */
export function executionStatusCell(status: ExecutionStatus['type'], g: Glyphs): StatusCell {
    switch (status) {
        case 'running': return { glyph: g.quarter, tone: 'info', word: 'RUNNING', detail: '' };
        case 'completed': return { glyph: g.dot, tone: 'pos', word: 'COMPLETED', detail: '' };
        case 'failed': return { glyph: g.cross, tone: 'neg', word: 'FAILED', detail: '' };
        case 'aborted': return { glyph: g.square, tone: 'warn', word: 'ABORTED', detail: '' };
    }
}

/**
 * A run-history item's status cell.
 *
 * @param status - The history status
 * @param g - The glyph set
 * @returns The cell
 */
export function historyStatusCell(status: ExecutionHistoryStatus['type'], g: Glyphs): StatusCell {
    switch (status) {
        case 'running': return { glyph: g.quarter, tone: 'info', word: 'running', detail: '' };
        case 'success': return { glyph: g.dot, tone: 'pos', word: 'success', detail: '' };
        case 'failed': return { glyph: g.cross, tone: 'neg', word: 'failed', detail: '' };
        case 'error': return { glyph: g.half, tone: 'warn', word: 'error', detail: '' };
        case 'cancelled': return { glyph: g.square, tone: 'warn', word: 'cancelled', detail: '' };
        case 'interrupted': return { glyph: g.half, tone: 'warn', word: 'interrupted', detail: '' };
    }
}

/**
 * The connection pill.
 *
 * @param connection - The connection state
 * @param g - The glyph set
 * @returns The cell (`● CONNECTED`, `◐ RECONNECTING 3/4`, `✗ OFFLINE`)
 */
export function connectionCell(connection: ConnectionState, g: Glyphs): StatusCell | null {
    switch (connection.kind) {
        case 'connected': return { glyph: g.dot, tone: 'pos', word: 'CONNECTED', detail: '' };
        case 'reconnecting': return { glyph: g.half, tone: 'warn', word: `RECONNECTING ${connection.attempt}/${connection.of}`, detail: '' };
        case 'offline': return { glyph: g.cross, tone: 'neg', word: 'OFFLINE', detail: '' };
        default: return null;
    }
}

/**
 * An execution's wall-clock duration in milliseconds: the summary's, or
 * `completedAt − startedAt` when the summary reports none (the server
 * only times the runs it launched itself).
 *
 * @param state - The execution state
 * @returns The duration, or `null` while it is still running
 */
export function executionDuration(state: DataflowExecutionState): number | null {
    if (state.summary.type === 'some' && state.summary.value.duration > 0) return state.summary.value.duration;
    if (state.completedAt.type === 'some') {
        const ms = Date.parse(state.completedAt.value) - Date.parse(state.startedAt);
        if (Number.isFinite(ms) && ms >= 0) return ms;
    }
    return state.summary.type === 'some' ? state.summary.value.duration : null;
}

/**
 * A unit of a split task, as the feed names it: `piece 5 of 8`, or
 * `merge 3 of 4 · level 1 of 2`.
 *
 * @param unit - The unit, by its place in its task
 * @param sep - The separator
 * @returns The text
 */
export function unitPlace(unit: StageUnit, sep = '·'): string {
    const of = `${unit.index + 1n} of ${unit.units}`;
    return unit.merge.type === 'none' ? `piece ${of}` : `merge ${of} ${sep} level ${unit.merge.value.level} of ${unit.merge.value.levels}`;
}

/**
 * How far a split task has got through its stage, as its start row names it:
 * `3 of 8 pieces`, or `level 1 of 2 · 2 of 4 merges`.
 *
 * @param split - The task's progress
 * @param sep - The separator
 * @returns The text
 */
export function splitPlace(split: SplitProgress, sep = '·'): string {
    const of = `${split.done} of ${split.units}`;
    return split.merge.type === 'none' ? `${of} pieces` : `level ${split.merge.value.level} of ${split.merge.value.levels} ${sep} ${of} merges`;
}

/**
 * A task or unit waiting for room in the server's budget, as the feed shows
 * it: what it waits to reserve, and what the budget has free of it.
 *
 * @param wait - The wait
 * @param budget - The server's budget, when it has one
 * @param g - The glyph set
 * @returns The cell
 */
export function waitCell(wait: UnitWait, budget: DataflowBudget | null, g: Glyphs): StatusCell {
    let detail: string;
    if (wait.needs > 0n) {
        detail = `needs ${formatSize(Number(wait.needs))}`;
        if (budget !== null) detail += ` ${g.sep} ${formatSize(Math.max(0, Number(budget.memory - budget.memoryInUse)))} free`;
    } else {
        detail = 'needs a core';
        if (budget !== null) detail += ` ${g.sep} ${budget.coresInUse} of ${budget.cores} in use`;
    }
    return { glyph: g.half, tone: 'warn', word: 'waiting', detail };
}

/**
 * One dataflow event as the feed shows it — the cloud UI's
 * `formatEventMessage` cases: the dot + word, the task, and the detail
 * (duration and peak, exit code, message, reason); and a unit requeued,
 * with why and the most it was measured using.
 *
 * @param event - The event
 * @param g - The glyph set
 * @returns The cell plus the task name
 */
export function eventCell(event: DataflowEvent, g: Glyphs): StatusCell & { task: string; timestamp: string } {
    switch (event.type) {
        case 'start':
            return { glyph: g.quarter, tone: 'info', word: 'start', detail: '', task: event.value.task, timestamp: event.value.timestamp };
        case 'complete': {
            const peak = event.value.peakBytes.type === 'some' ? ` ${g.sep} peak ${formatSize(Number(event.value.peakBytes.value))}` : '';
            return { glyph: g.dot, tone: 'pos', word: 'complete', detail: `${formatDuration(event.value.duration)}${peak}`, task: event.value.task, timestamp: event.value.timestamp };
        }
        case 'cached':
            return { glyph: g.dot, tone: 'pos', word: 'cached', detail: '', task: event.value.task, timestamp: event.value.timestamp };
        case 'failed':
            return { glyph: g.cross, tone: 'neg', word: 'failed', detail: `exit ${event.value.exitCode} · ${formatDuration(event.value.duration)}`, task: event.value.task, timestamp: event.value.timestamp };
        case 'error':
            return { glyph: g.cross, tone: 'neg', word: 'error', detail: event.value.message, task: event.value.task, timestamp: event.value.timestamp };
        case 'input_unavailable':
            return { glyph: g.half, tone: 'warn', word: 'waiting', detail: event.value.reason, task: event.value.task, timestamp: event.value.timestamp };
        case 'requeued': {
            const peak = formatSize(Number(event.value.peak));
            const detail = event.value.reason.type === 'budget' ? `over budget at ${peak}`
                : event.value.reason.type === 'machine' ? `machine low at ${peak}`
                : `outgrew its cap of ${peak}`;
            return { glyph: g.requeue, tone: 'warn', word: 'requeued', detail, task: event.value.task, timestamp: event.value.timestamp };
        }
    }
}
