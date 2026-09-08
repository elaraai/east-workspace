/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The feeds — which pollers run is derived from the store (the session and
 * the current view), so a feed runs only while a view that needs it is
 * mounted: `workspaceStatus` 1 s and the execution state 1 s (5 s idle) for
 * the open workspace, `workspaceList` 5 s once a repository is bound,
 * `repoList` 5 s on a bare origin, dataset types 5 s, task kinds and the
 * deployed state 30 s, per-workspace summaries 5 s in the workspaces view,
 * task details once, executions 5 s on the runs tab. Each result becomes a
 * `data/*` action; the connection pill is derived from the pollers after
 * every result and failure.
 *
 * @packageDocumentation
 */

import type { DataflowEvent, DataflowExecutionState } from '@elaraai/e3-api-client';
import { formatError } from '@elaraai/e3-cli/internal';
import type { Api } from '../api.js';
import { isApiCode } from '../api.js';
import type { TuiState } from '../state/actions.js';
import { connectionState, createPoller, type PollClock, type Poller } from '../state/poll.js';
import type { Store } from '../state/store.js';

/** A feed's description: its key, interval, and how it runs. */
interface FeedSpec {
    key: string;
    intervalMs: number;
    run: (signal: AbortSignal) => Promise<void>;
}

/** The running feeds. */
export interface Feeds {
    /** Starts deriving feeds from the store. */
    start(): void;
    /** Stops every poller and the derivation. */
    stop(): void;
    /** Fires every running poller now (`/refresh`, `R`). */
    refresh(): void;
    /** The running pollers (for the connection pill and tests). */
    pollers(): Poller[];
    /** Re-derives the feed set now (after a session change). */
    sync(): void;
}

/** What {@link createFeeds} needs. */
export interface FeedsDeps {
    store: Store;
    /** The API of the current session (may change when `/repo` rebinds). */
    api: () => Api | null;
    clock?: PollClock | undefined;
    /** A logger for feed failures (the debug log). */
    log?: ((line: string) => void) | undefined;
}

/** The workspace a view is about, if any. */
export function viewWorkspace(state: TuiState): string | null {
    const v = state.view;
    if (v.kind === 'dashboard' || v.kind === 'task' || v.kind === 'input') return v.ws;
    return null;
}

/**
 * Creates the feed manager.
 *
 * @param deps - The store, the API accessor, timers
 * @returns The feeds (not started)
 */
export function createFeeds(deps: FeedsDeps): Feeds {
    const { store } = deps;
    const running = new Map<string, Poller>();
    let unsubscribe: (() => void) | null = null;
    let lastSignature = '';
    const executionCursor = new Map<string, { startedAt: string | null; events: DataflowEvent[] }>();
    const repoStatusRequested = new Set<string>();

    const dispatchConnection = (): void => {
        store.dispatch({ type: 'connection', connection: connectionState([...running.values()]) });
    };

    const specs = (state: TuiState, api: Api): FeedSpec[] => {
        const out: FeedSpec[] = [];
        const session = state.session;
        if (session === null) return out;
        const view = state.view;
        if (session.kind === 'origin' || view.kind === 'repos') {
            out.push({
                key: 'repos',
                intervalMs: 5_000,
                run: async () => {
                    const names = await api.repoList();
                    store.dispatch({ type: 'data/repos', names });
                    for (const name of names) {
                        if (repoStatusRequested.has(name)) continue;
                        repoStatusRequested.add(name);
                        void api.repoStatus(name)
                            .then(status => store.dispatch({ type: 'data/repoStatus', repo: name, status }))
                            .catch(() => repoStatusRequested.delete(name));
                    }
                },
            });
        }
        if (session.repo === null) return out;
        out.push({
            key: 'workspaces',
            intervalMs: 5_000,
            run: async () => {
                const workspaces = await api.workspaceList();
                store.dispatch({ type: 'data/workspaces', workspaces });
            },
        });
        if (view.kind === 'workspaces') {
            out.push({
                key: 'workspaces:summaries',
                intervalMs: 5_000,
                run: async (signal) => {
                    const names = (store.getState().data.workspaces ?? []).map(w => w.name);
                    for (const ws of names) {
                        if (signal.aborted) return;
                        try {
                            const [result, wsState] = await Promise.all([api.workspaceStatus(ws), api.workspaceGet(ws)]);
                            if (signal.aborted) return;
                            store.dispatch({ type: 'data/status', ws, result, at: (deps.clock?.now ?? Date.now)() });
                            store.dispatch({ type: 'data/workspaceState', ws, state: wsState });
                        } catch (err) {
                            if (isApiCode(err, 'workspace_not_deployed')) {
                                store.dispatch({ type: 'data/workspaceState', ws, state: null });
                                continue;
                            }
                            throw err;
                        }
                    }
                },
            });
        }
        const ws = viewWorkspace(state);
        if (ws !== null) {
            out.push({
                key: `status:${ws}`,
                intervalMs: 1_000,
                run: async () => {
                    try {
                        const result = await api.workspaceStatus(ws);
                        store.dispatch({ type: 'data/status', ws, result, at: (deps.clock?.now ?? Date.now)() });
                    } catch (err) {
                        store.dispatch({ type: 'data/statusError', ws, error: formatError(err) });
                        throw err;
                    }
                },
            });
            const execution = state.data.execution[ws];
            const active = execution?.state?.status.type === 'running' || execution?.settling === true || execution?.stopping === true;
            out.push({
                key: `execution:${ws}`,
                intervalMs: active ? 1_000 : 5_000,
                run: async () => {
                    const cursor = executionCursor.get(ws) ?? { startedAt: null, events: [] };
                    let result: DataflowExecutionState;
                    try {
                        result = await api.dataflowExecutePoll(ws, cursor.events.length);
                    } catch (err) {
                        if (isApiCode(err, 'execution_not_found')) {
                            executionCursor.set(ws, { startedAt: null, events: [] });
                            store.dispatch({ type: 'data/execution', ws, state: null, events: [], startedAt: null });
                            return;
                        }
                        throw err;
                    }
                    let events = cursor.events;
                    if (result.startedAt !== cursor.startedAt) {
                        // A new execution: its events restart at 0.
                        const fresh = cursor.events.length === 0 ? result : await api.dataflowExecutePoll(ws, 0);
                        events = [...fresh.events];
                        result = fresh;
                    } else {
                        events = [...cursor.events, ...result.events];
                    }
                    executionCursor.set(ws, { startedAt: result.startedAt, events });
                    store.dispatch({ type: 'data/execution', ws, state: result, events, startedAt: result.startedAt });
                },
            });
            out.push({
                key: `datasets:${ws}`,
                intervalMs: 5_000,
                run: async () => {
                    const entries = await api.datasetList(ws);
                    store.dispatch({ type: 'data/datasets', ws, entries });
                },
            });
            out.push({
                key: `taskList:${ws}`,
                intervalMs: 30_000,
                run: async () => {
                    const tasks = await api.taskList(ws);
                    store.dispatch({ type: 'data/taskList', ws, tasks });
                },
            });
            out.push({
                key: `workspaceState:${ws}`,
                intervalMs: 30_000,
                run: async () => {
                    const wsState = await api.workspaceGet(ws);
                    store.dispatch({ type: 'data/workspaceState', ws, state: wsState });
                },
            });
        }
        if (view.kind === 'task') {
            const { task } = view;
            out.push({
                key: `taskDetails:${ws}/${task}`,
                intervalMs: 60_000,
                run: async () => {
                    const details = await api.taskGet(view.ws, task);
                    store.dispatch({ type: 'data/taskDetails', ws: view.ws, task, details });
                },
            });
            if (view.tab === 'runs') {
                out.push({
                    key: `executions:${ws}/${task}`,
                    intervalMs: 5_000,
                    run: async () => {
                        const executions = await api.taskExecutionList(view.ws, task);
                        store.dispatch({ type: 'data/executions', ws: view.ws, task, executions });
                    },
                });
            }
        }
        return out;
    };

    const sync = (): void => {
        const state = store.getState();
        const api = deps.api();
        const wanted = api === null ? [] : specs(state, api);
        const signature = wanted.map(s => `${s.key}@${s.intervalMs}`).join('|');
        if (signature === lastSignature) return;
        lastSignature = signature;
        const wantedKeys = new Set(wanted.map(s => s.key));
        for (const [key, poller] of running) {
            if (!wantedKeys.has(key)) {
                poller.stop();
                running.delete(key);
            }
        }
        for (const spec of wanted) {
            const existing = running.get(spec.key);
            if (existing !== undefined) {
                existing.setInterval(spec.intervalMs);
                continue;
            }
            const poller = createPoller<void>({
                key: spec.key,
                intervalMs: spec.intervalMs,
                clock: deps.clock,
                run: spec.run,
                onResult: () => dispatchConnection(),
                onError: (error, failures) => {
                    deps.log?.(`feed ${spec.key} failed (${failures}): ${formatError(error)}`);
                    dispatchConnection();
                },
            });
            running.set(spec.key, poller);
            poller.start();
        }
        dispatchConnection();
    };

    return {
        start() {
            if (unsubscribe !== null) return;
            unsubscribe = store.subscribe(sync);
            sync();
        },
        stop() {
            unsubscribe?.();
            unsubscribe = null;
            for (const poller of running.values()) poller.stop();
            running.clear();
            lastSignature = '';
            executionCursor.clear();
            repoStatusRequested.clear();
        },
        refresh() {
            for (const poller of running.values()) poller.fireNow();
        },
        pollers: () => [...running.values()],
        sync,
    };
}
