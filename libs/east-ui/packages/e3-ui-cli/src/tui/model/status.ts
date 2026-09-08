/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Status words — the dot + word (+ inline detail) every table shows for
 * a task, a dataset, a workspace, an execution or a connection: the cloud
 * UI's `formatStatusDetail` cases made inline, and the same words
 * `formatTaskStatus` (`e3 workspace status`) prints.
 *
 * @packageDocumentation
 */

import type { ExecutionHistoryStatus, ExecutionStatus, TaskStatus, DataflowEvent } from '@elaraai/e3-api-client';
import type { Glyphs } from '../render/glyphs.js';
import type { Tone } from '../render/theme.js';
import { formatDuration } from '../render/text.js';
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
 * One dataflow event as the feed shows it — the cloud UI's
 * `formatEventMessage` cases: the dot + word, the task, and the detail
 * (duration, exit code, message, reason).
 *
 * @param event - The event
 * @param g - The glyph set
 * @returns The cell plus the task name
 */
export function eventCell(event: DataflowEvent, g: Glyphs): StatusCell & { task: string; timestamp: string } {
    switch (event.type) {
        case 'start':
            return { glyph: g.quarter, tone: 'info', word: 'start', detail: '', task: event.value.task, timestamp: event.value.timestamp };
        case 'complete':
            return { glyph: g.dot, tone: 'pos', word: 'complete', detail: formatDuration(event.value.duration * 1000), task: event.value.task, timestamp: event.value.timestamp };
        case 'cached':
            return { glyph: g.dot, tone: 'pos', word: 'cached', detail: '', task: event.value.task, timestamp: event.value.timestamp };
        case 'failed':
            return { glyph: g.cross, tone: 'neg', word: 'failed', detail: `exit ${event.value.exitCode} · ${formatDuration(event.value.duration * 1000)}`, task: event.value.task, timestamp: event.value.timestamp };
        case 'error':
            return { glyph: g.cross, tone: 'neg', word: 'error', detail: event.value.message, task: event.value.task, timestamp: event.value.timestamp };
        case 'input_unavailable':
            return { glyph: g.half, tone: 'warn', word: 'waiting', detail: event.value.reason, task: event.value.task, timestamp: event.value.timestamp };
    }
}
