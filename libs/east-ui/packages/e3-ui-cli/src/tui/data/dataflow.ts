/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Running the dataflow — `/run` → `dataflowExecuteLaunch` (the client
 * keeps its own `workspace_locked` retry), with a *settling* flag from the
 * launch until the execution poll shows the run, so a second `⏎` cannot
 * start two; `/stop` → `dataflowCancel` with a *stopping* flag until the
 * poll shows it stopped. Failures become toasts: the lock holder for a
 * locked workspace, and the remote caveat when the run belongs to another
 * server process.
 *
 * @packageDocumentation
 */

import type { DataflowOptions } from '@elaraai/e3-api-client';
import { apiCode, describeError } from '../api.js';
import type { Controller } from '../controller.js';
import type { Glyphs } from '../render/glyphs.js';
import { timeAgo } from '../render/text.js';
import type { TuiState } from '../state/actions.js';

/** A workspace lock's holder, as the status / the locked error report it. */
export interface LockHolder {
    pid: bigint;
    acquiredAt: string;
    command: { type: 'some'; value: string } | { type: 'none'; value: null };
}

/**
 * Whether a run is live in a workspace: running, launched and not yet seen
 * running (settling), or cancelled and not yet seen stopped (stopping).
 *
 * @param state - The store state
 * @param ws - The workspace
 * @returns `true` while live
 */
export function isRunLive(state: TuiState, ws: string): boolean {
    const execution = state.data.execution[ws];
    return execution !== undefined && (execution.state?.status.type === 'running' || execution.settling || execution.stopping);
}

/**
 * The lock holder line: `pid 4242 · e3 dataflow run · 12s ago`.
 *
 * @param holder - The holder
 * @param now - Epoch milliseconds
 * @param g - The glyph set
 * @returns The text
 */
export function lockHolderText(holder: LockHolder, now: number, g: Glyphs): string {
    const command = holder.command.type === 'some' ? holder.command.value : 'another process';
    return `pid ${holder.pid} ${g.sep} ${command} ${g.sep} ${timeAgo(holder.acquiredAt, now)}`;
}

/** The message of an error's details (`{ message }` or a string). */
function detailMessage(err: unknown): string {
    const details = (err as { details?: unknown }).details;
    if (typeof details === 'string') return details;
    if (typeof details === 'object' && details !== null && typeof (details as { message?: unknown }).message === 'string') return (details as { message: string }).message;
    return '';
}

/**
 * The toast for a failed launch: the lock holder for `workspace_locked`,
 * else the formatted error.
 *
 * @param err - The error
 * @param ws - The workspace
 * @param now - Epoch milliseconds
 * @param g - The glyph set
 * @returns The toast text
 */
export function launchFailureText(err: unknown, ws: string, now: number, g: Glyphs): string {
    if (apiCode(err) === 'workspace_locked') {
        const details = (err as { details?: { holder?: { type: string; value: LockHolder | null } } }).details;
        const holder = details?.holder;
        if (holder !== undefined && holder.type === 'known' && holder.value !== null) return `workspace ${ws} is locked by ${lockHolderText(holder.value, now, g)}`;
        return `workspace ${ws} is locked by another process`;
    }
    return describeError(err);
}

/**
 * Starts the dataflow in a workspace.
 *
 * @param controller - The controller
 * @param ws - The workspace
 * @param options - `--force`, `--filter`, `--concurrency`
 */
export async function startRun(controller: Controller, ws: string, options: { force: boolean; filter: string | undefined; concurrency: number | undefined }): Promise<void> {
    const s = controller.state();
    const g = controller.deps.glyphs;
    if (isRunLive(s, ws)) {
        controller.toast('a run is already in progress — /stop first', 'warn');
        return;
    }
    const api = controller.deps.api();
    if (api === null) {
        controller.toast('no session is open', 'neg');
        return;
    }
    const dataflowOptions: DataflowOptions = { force: options.force };
    if (options.filter !== undefined) dataflowOptions.filter = options.filter;
    if (options.concurrency !== undefined) dataflowOptions.concurrency = options.concurrency;
    controller.dispatch({ type: 'data/executionFlag', ws, settling: true });
    try {
        await api.dataflowExecuteLaunch(ws, dataflowOptions);
    } catch (err) {
        controller.dispatch({ type: 'data/executionFlag', ws, settling: false });
        controller.deps.log(`run ${ws} failed: ${describeError(err)}`);
        controller.toast(launchFailureText(err, ws, controller.deps.now(), g), 'neg');
        return;
    }
    const taskCount = s.data.status[ws]?.result.tasks.length ?? 0;
    const queued = options.filter !== undefined ? `tasks matching ${options.filter} queued` : `${taskCount} task${taskCount === 1 ? '' : 's'} queued`;
    controller.toast(`Dataflow started ${g.sep} ${ws} ${g.sep} ${queued}`, 'pos');
    controller.deps.feeds.fire(`execution:${ws}`);
    controller.deps.feeds.fire(`status:${ws}`);
}

/**
 * Cancels the dataflow running in a workspace.
 *
 * @param controller - The controller
 * @param ws - The workspace
 */
export async function cancelRun(controller: Controller, ws: string): Promise<void> {
    const s = controller.state();
    const g = controller.deps.glyphs;
    if (!isRunLive(s, ws)) {
        controller.toast('no run in progress', 'warn');
        return;
    }
    const api = controller.deps.api();
    if (api === null) {
        controller.toast('no session is open', 'neg');
        return;
    }
    controller.dispatch({ type: 'data/executionFlag', ws, stopping: true });
    try {
        await api.dataflowCancel(ws);
    } catch (err) {
        controller.dispatch({ type: 'data/executionFlag', ws, stopping: false });
        controller.deps.log(`stop ${ws} failed: ${describeError(err)}`);
        if (apiCode(err) === 'internal' && /no active execution/i.test(detailMessage(err))) {
            controller.toast('nothing to cancel here — the run was started by another server process; stop it from there', 'warn');
        } else {
            controller.toast(describeError(err), 'neg');
        }
        return;
    }
    controller.toast('Dataflow cancelled', 'warn', g.square);
    controller.deps.feeds.fire(`execution:${ws}`);
    controller.deps.feeds.fire(`status:${ws}`);
}
