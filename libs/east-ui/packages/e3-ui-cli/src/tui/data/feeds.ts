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
 * task details once, executions 5 s on the runs tab, the shown log stream
 * 1 s and stderr 5 s on every task tab (the Stderr tab's line count). Each
 * result becomes a
 * `data/*` action; the connection pill is derived from the pollers after
 * every result and failure.
 *
 * @packageDocumentation
 */

import type { DataflowEvent, DataflowExecutionState } from '@elaraai/e3-api-client';
import type { Api } from '../api.js';
import { describeError, isApiCode } from '../api.js';
import { createDatasetLoader, viewDataset, type DatasetLoader } from './dataset.js';
import { createLogsLoader } from './logs.js';
import { isLogTab, type TuiState } from '../state/actions.js';
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
    /** Fires one poller now, by key (`execution:<ws>` after a launch); unknown keys are ignored. */
    fire(key: string): void;
    /** The running pollers (for the connection pill and tests). */
    pollers(): Poller[];
    /** Re-derives the feed set now (after a session change). */
    sync(): void;
    /** The dataset loader behind the value tree (pages, key search, saves). */
    datasets: DatasetLoader;
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
    const datasets = createDatasetLoader({ store, api: deps.api, log: deps.log });
    const logs = createLogsLoader({ store, api: deps.api, log: deps.log });

    /** A repository's counts and its latest deployment (the repositories view's lazy columns). */
    const repoFacts = async (api: Api, name: string): Promise<void> => {
        const status = await api.repoStatus(name);
        store.dispatch({ type: 'data/repoStatus', repo: name, status });
        const bound = api.withRepo(name);
        let latest: { workspace: string; packageName: string; packageVersion: string; deployedAt: Date } | null = null;
        try {
            const workspaces = await bound.workspaceList();
            for (const ws of workspaces) {
                if (!ws.deployed) continue;
                const wsState = await bound.workspaceGet(ws.name);
                if (wsState === null) continue;
                if (latest === null || wsState.deployedAt.getTime() > latest.deployedAt.getTime()) {
                    latest = { workspace: ws.name, packageName: wsState.packageName, packageVersion: wsState.packageVersion, deployedAt: wsState.deployedAt };
                }
            }
        } catch (err) {
            deps.log?.(`repo ${name} facts failed: ${describeError(err)}`);
        }
        store.dispatch({ type: 'data/repoDeploy', repo: name, deploy: latest });
    };

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
                        void repoFacts(api, name)
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
                    let workspaces = store.getState().data.workspaces;
                    if (workspaces === null) {
                        workspaces = await api.workspaceList();
                        if (signal.aborted) return;
                        store.dispatch({ type: 'data/workspaces', workspaces });
                    }
                    for (const ws of workspaces.map(w => w.name)) {
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
                        // The last run, for the LAST RUN column (never run is not an error).
                        try {
                            const execution = await api.dataflowExecutePoll(ws, 0);
                            if (signal.aborted) return;
                            executionCursor.set(ws, { startedAt: execution.startedAt, events: [...execution.events] });
                            store.dispatch({ type: 'data/execution', ws, state: execution, events: [...execution.events], startedAt: execution.startedAt });
                        } catch (err) {
                            if (!isApiCode(err, 'execution_not_found')) throw err;
                            store.dispatch({ type: 'data/execution', ws, state: null, events: [], startedAt: null });
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
                        store.dispatch({ type: 'data/statusError', ws, error: describeError(err) });
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
        const shown = viewDataset(state);
        if (shown !== null) {
            out.push({
                key: `dataset:${shown.ws}:${shown.path}`,
                intervalMs: 5_000,
                run: () => datasets.tick(shown.ws, shown.path),
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
            // The runs tab lists them; the title line's inputs hash reads the newest on every tab.
            out.push({
                key: `executions:${ws}/${task}`,
                intervalMs: view.tab === 'runs' ? 5_000 : 30_000,
                run: async () => {
                    const executions = await api.taskExecutionList(view.ws, task);
                    store.dispatch({ type: 'data/executions', ws: view.ws, task, executions });
                },
            });
            // The shown stream every second; stderr every five seconds on every tab, so the
            // Stderr tab's line count is there before the tab is visited.
            const logTab = isLogTab(view.tab) ? view.tab : null;
            for (const stream of ['stdout', 'stderr'] as const) {
                if (stream !== logTab && stream === 'stdout') continue;
                out.push({ key: `logs:${ws}/${task}/${stream}`, intervalMs: stream === logTab ? 1_000 : 5_000, run: () => logs.tick(view.ws, task, stream) });
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
                    deps.log?.(`feed ${spec.key} failed (${failures}): ${describeError(error)}`);
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
            datasets.reset();
            logs.reset();
        },
        refresh() {
            for (const poller of running.values()) poller.fireNow();
        },
        fire(key) {
            running.get(key)?.fireNow();
        },
        pollers: () => [...running.values()],
        sync,
        datasets,
    };
}
