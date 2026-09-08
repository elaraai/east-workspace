/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The pure reducer: `reduce(state, action)` → the next state. Selection and
 * scroll math is generic over the current view's primary list (a table, a
 * value tree, the runs list); the caller passes the row count and the
 * visible rows, which are derived from data + layout outside the store.
 *
 * @packageDocumentation
 */

import { scrollIntoView } from '../render/layout.js';
import {
    type Action,
    type CommandUi,
    type ListUi,
    type TreeUi,
    type TuiState,
    type View,
    emptyCommand,
} from './actions.js';

/** A nested record with one inner entry replaced. */
function nested<T>(outer: Record<string, Record<string, T>>, key: string, inner: string, value: T): Record<string, Record<string, T>> {
    return { ...outer, [key]: { ...(outer[key] ?? {}), [inner]: value } };
}

/** Applies a list navigation to a list UI. */
function moveList(list: ListUi, op: Action & { type: 'list/move' }): ListUi {
    const { count, visible } = op;
    if (count <= 0) return { sel: 0, top: 0 };
    const last = count - 1;
    let sel = Math.max(0, Math.min(list.sel, last));
    switch (op.op) {
        case 'up': sel = Math.max(0, sel - 1); break;
        case 'down': sel = Math.min(last, sel + 1); break;
        case 'pageUp': sel = Math.max(0, sel - Math.max(1, visible - 1)); break;
        case 'pageDown': sel = Math.min(last, sel + Math.max(1, visible - 1)); break;
        case 'home': sel = 0; break;
        case 'end': sel = last; break;
    }
    return { sel, top: scrollIntoView(list.top, sel, visible, count) };
}

/** The current view's primary list, and a setter that writes it back. */
function primaryList(view: View): { list: ListUi; set: (list: ListUi) => View } | null {
    switch (view.kind) {
        case 'repos':
        case 'workspaces':
        case 'dashboard':
            return { list: view.list, set: (list) => ({ ...view, list }) };
        case 'task':
            if (view.tab === 'output') return { list: view.tree, set: (list) => ({ ...view, tree: { ...view.tree, ...list } }) };
            if (view.tab === 'runs') return { list: view.runs, set: (list) => ({ ...view, runs: { ...view.runs, ...list } }) };
            if (view.tab === 'reads') return { list: view.reads, set: (list) => ({ ...view, reads: list }) };
            return null;
        case 'input':
            return { list: view.tree, set: (list) => ({ ...view, tree: { ...view.tree, ...list } }) };
        default:
            return null;
    }
}

/** The current view's tree, and a setter. */
function primaryTree(view: View): { tree: TreeUi; set: (tree: TreeUi) => View } | null {
    if (view.kind === 'task' && view.tab === 'output') return { tree: view.tree, set: (tree) => ({ ...view, tree }) };
    if (view.kind === 'input') return { tree: view.tree, set: (tree) => ({ ...view, tree }) };
    return null;
}

function reduceCommand(command: CommandUi, action: Action): CommandUi {
    switch (action.type) {
        case 'command/edit': {
            const text = action.text;
            return { ...command, mode: 'edit', text, cursor: Math.max(0, Math.min(action.cursor ?? text.length, text.length)), confirm: null };
        }
        case 'command/insert': {
            const text = command.text.slice(0, command.cursor) + action.text + command.text.slice(command.cursor);
            return { ...command, mode: 'edit', text, cursor: command.cursor + action.text.length, confirm: null };
        }
        case 'command/backspace': {
            if (command.mode !== 'edit') return command;
            if (command.cursor === 0) return command;
            const text = command.text.slice(0, command.cursor - 1) + command.text.slice(command.cursor);
            return { ...command, text, cursor: command.cursor - 1 };
        }
        case 'command/delete': {
            if (command.mode !== 'edit') return command;
            const text = command.text.slice(0, command.cursor) + command.text.slice(command.cursor + 1);
            return { ...command, text };
        }
        case 'command/cursor': {
            if (command.mode !== 'edit') return command;
            const to = action.to;
            const cursor = to === 'home' ? 0
                : to === 'end' ? command.text.length
                : to === 'left' ? command.cursor - 1
                : to === 'right' ? command.cursor + 1
                : to;
            return { ...command, cursor: Math.max(0, Math.min(cursor, command.text.length)) };
        }
        case 'command/completion':
            return { ...command, completion: action.items.length > 0 ? { items: action.items, index: 0 } : null };
        case 'command/completionMove': {
            if (command.completion === null) return command;
            const n = command.completion.items.length;
            const index = ((command.completion.index + action.delta) % n + n) % n;
            return { ...command, completion: { ...command.completion, index } };
        }
        case 'command/clear':
            return emptyCommand();
        case 'command/confirm':
            return { mode: 'confirm', text: '', cursor: 0, completion: null, confirm: action.confirm };
        default:
            return command;
    }
}

/**
 * The reducer.
 *
 * @param state - The current state
 * @param action - The action
 * @returns The next state (the same object when nothing changed)
 */
export function reduce(state: TuiState, action: Action): TuiState {
    switch (action.type) {
        case 'size':
            return { ...state, size: action.size };
        case 'session':
            return { ...state, session: action.session };
        case 'connection':
            return state.connection.kind === action.connection.kind
                && (state.connection.kind !== 'reconnecting' || action.connection.kind !== 'reconnecting'
                    || state.connection.attempt === action.connection.attempt)
                ? state
                : { ...state, connection: action.connection };
        case 'mouse':
            return { ...state, mouse: action.enabled };
        case 'pendingKey':
            return { ...state, pendingKey: action.key };

        // -- views ---------------------------------------------------------
        case 'view/set':
            return { ...state, view: action.view, pendingKey: null };
        case 'view/root':
            return { ...state, view: action.view, history: [], pendingKey: null, command: state.command.mode === 'confirm' ? emptyCommand() : state.command };
        case 'view/push':
            return { ...state, view: action.view, history: [...state.history, state.view], pendingKey: null };
        case 'view/pop': {
            const previous = state.history[state.history.length - 1];
            if (previous === undefined) return state;
            return { ...state, view: previous, history: state.history.slice(0, -1), pendingKey: null };
        }
        case 'view/launchStep':
            return state.view.kind === 'launch' ? { ...state, view: { ...state.view, step: action.step } } : state;
        case 'list/move': {
            const primary = primaryList(state.view);
            if (primary === null) return state;
            return { ...state, view: primary.set(moveList(primary.list, action)) };
        }
        case 'list/select': {
            const primary = primaryList(state.view);
            if (primary === null || action.count <= 0) return state;
            const sel = Math.max(0, Math.min(action.index, action.count - 1));
            return { ...state, view: primary.set({ sel, top: scrollIntoView(primary.list.top, sel, action.visible, action.count) }) };
        }
        case 'list/scroll': {
            const primary = primaryList(state.view);
            if (primary === null || action.count <= 0) return state;
            const maxTop = Math.max(0, action.count - action.visible);
            const top = Math.max(0, Math.min(primary.list.top + action.delta, maxTop));
            // The selection stays inside the window as it scrolls.
            const sel = Math.max(top, Math.min(primary.list.sel, top + Math.max(1, action.visible) - 1, action.count - 1));
            return { ...state, view: primary.set({ sel, top }) };
        }
        case 'tree/toggle': {
            const primary = primaryTree(state.view);
            if (primary === null) return state;
            const open = { ...primary.tree.open, [action.id]: action.expanded };
            if (!action.expanded && action.descendants !== undefined) {
                for (const id of action.descendants) open[id] = false;
            }
            return { ...state, view: primary.set({ ...primary.tree, open }) };
        }
        case 'tree/expandAll': {
            const primary = primaryTree(state.view);
            if (primary === null) return state;
            return { ...state, view: primary.set({ ...primary.tree, open: {}, baseDepth: Number.MAX_SAFE_INTEGER }) };
        }
        case 'tree/collapseAll': {
            const primary = primaryTree(state.view);
            if (primary === null) return state;
            return { ...state, view: primary.set({ ...primary.tree, open: {}, baseDepth: 0, sel: 0, top: 0 }) };
        }
        case 'tree/restore': {
            const primary = primaryTree(state.view);
            if (primary === null) return state;
            return { ...state, view: primary.set({ ...primary.tree, open: action.open, top: action.top, sel: action.top, baseDepth: action.baseDepth }) };
        }
        case 'tree/match': {
            const primary = primaryTree(state.view);
            if (primary === null) return state;
            return { ...state, view: primary.set({ ...primary.tree, match: action.match }) };
        }
        case 'task/tab':
            return state.view.kind === 'task' ? { ...state, view: { ...state.view, tab: action.tab } } : state;
        case 'runs/expand':
            return state.view.kind === 'task' ? { ...state, view: { ...state.view, runs: { ...state.view.runs, expanded: action.expanded } } } : state;
        case 'logs/stream':
            return state.view.kind === 'task'
                ? { ...state, view: { ...state.view, logs: { ...state.view.logs, stream: action.stream, top: 0, follow: true, match: null } } }
                : state;
        case 'logs/follow':
            return state.view.kind === 'task' ? { ...state, view: { ...state.view, logs: { ...state.view.logs, follow: action.follow } } } : state;
        case 'logs/scroll':
            return state.view.kind === 'task' ? { ...state, view: { ...state.view, logs: { ...state.view.logs, top: Math.max(0, action.top) } } } : state;
        case 'logs/match':
            return state.view.kind === 'task' ? { ...state, view: { ...state.view, logs: { ...state.view.logs, match: action.match } } } : state;
        case 'help/tab':
            return state.view.kind === 'help' ? { ...state, view: { ...state.view, tab: action.tab } } : state;
        case 'input/editing':
            return state.view.kind === 'input' ? { ...state, view: { ...state.view, editing: action.editing } } : state;

        // -- command box ---------------------------------------------------
        case 'command/edit':
        case 'command/insert':
        case 'command/backspace':
        case 'command/delete':
        case 'command/cursor':
        case 'command/completion':
        case 'command/completionMove':
        case 'command/clear':
        case 'command/confirm': {
            const command = reduceCommand(state.command, action);
            return command === state.command ? state : { ...state, command, pendingKey: null };
        }
        case 'toast':
            return { ...state, toast: action.toast };
        case 'toast/clear':
            return state.toast !== null && state.toast.id === action.id ? { ...state, toast: null } : state;

        // -- data ----------------------------------------------------------
        case 'data/repos':
            return { ...state, data: { ...state.data, repos: { names: action.names, status: state.data.repos?.status ?? {} } } };
        case 'data/repoStatus': {
            const repos = state.data.repos ?? { names: [], status: {} };
            return { ...state, data: { ...state.data, repos: { ...repos, status: { ...repos.status, [action.repo]: action.status } } } };
        }
        case 'data/workspaces':
            return { ...state, data: { ...state.data, workspaces: action.workspaces } };
        case 'data/workspaceState':
            return { ...state, data: { ...state.data, workspaceState: { ...state.data.workspaceState, [action.ws]: action.state } } };
        case 'data/status': {
            const statusError = { ...state.data.statusError };
            delete statusError[action.ws];
            return {
                ...state,
                data: {
                    ...state.data,
                    status: { ...state.data.status, [action.ws]: { result: action.result, at: action.at } },
                    statusError,
                    polledAt: action.at,
                },
            };
        }
        case 'data/statusError':
            return { ...state, data: { ...state.data, statusError: { ...state.data.statusError, [action.ws]: action.error } } };
        case 'data/execution': {
            const previous = state.data.execution[action.ws];
            const running = action.state !== null && action.state.status.type === 'running';
            return {
                ...state,
                data: {
                    ...state.data,
                    execution: {
                        ...state.data.execution,
                        [action.ws]: {
                            state: action.state,
                            events: action.events,
                            startedAt: action.startedAt,
                            settling: previous?.settling === true && !running && previous.startedAt === action.startedAt,
                            stopping: previous?.stopping === true && running,
                        },
                    },
                },
            };
        }
        case 'data/executionFlag': {
            const previous = state.data.execution[action.ws] ?? { state: null, events: [], startedAt: null, settling: false, stopping: false };
            return {
                ...state,
                data: {
                    ...state.data,
                    execution: {
                        ...state.data.execution,
                        [action.ws]: {
                            ...previous,
                            settling: action.settling ?? previous.settling,
                            stopping: action.stopping ?? previous.stopping,
                        },
                    },
                },
            };
        }
        case 'data/datasets':
            return { ...state, data: { ...state.data, datasets: { ...state.data.datasets, [action.ws]: action.entries } } };
        case 'data/taskList':
            return { ...state, data: { ...state.data, taskList: { ...state.data.taskList, [action.ws]: action.tasks } } };
        case 'data/taskDetails':
            return { ...state, data: { ...state.data, taskDetails: nested(state.data.taskDetails, action.ws, action.task, action.details) } };
        case 'data/executions':
            return { ...state, data: { ...state.data, executions: nested(state.data.executions, action.ws, action.task, action.executions) } };
        case 'data/dataset':
            return { ...state, data: { ...state.data, dataset: nested(state.data.dataset, action.ws, action.path, action.data) } };
        case 'data/datasetMode': {
            const current = state.data.dataset[action.ws]?.[action.path];
            if (current === undefined) return state;
            return { ...state, data: { ...state.data, dataset: nested(state.data.dataset, action.ws, action.path, { ...current, mode: action.mode }) } };
        }
        case 'data/logs': {
            const forTask = { ...(state.data.logs[action.ws]?.[action.task] ?? {}), [action.stream]: action.logs };
            return { ...state, data: { ...state.data, logs: nested(state.data.logs, action.ws, action.task, forTask) } };
        }
        case 'data/reset':
            return { ...state, data: { ...state.data, status: {}, statusError: {}, execution: {}, datasets: {}, taskList: {}, taskDetails: {}, executions: {}, dataset: {}, logs: {} } };

        // -- editing -------------------------------------------------------
        case 'edit/set':
            return { ...state, edit: action.edit };
        default:
            return state;
    }
}

/** Whether the state has pending input edits (the `◆ N DIRTY` pill). */
export function dirtyCount(state: TuiState): number {
    return state.edit === null ? 0 : state.edit.ops.length;
}
