/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The controller — every key and every command lands here. It resolves
 * keys through the keymap, drives the store, runs commands against the
 * session's API, and owns the side effects (feeds, persistence, exit).
 * Views stay pure; the frame specs drive this with the in-memory API.
 *
 * @packageDocumentation
 */

import type { Key } from 'ink';
import { describeError, type Api } from './api.js';
import { cancelRun, startRun } from './data/dataflow.js';
import { viewWorkspace, type Feeds } from './data/feeds.js';
import { complete } from './input/completion.js';
import { parseCommand, type ParsedCommand } from './input/commands.js';
import { resolve as resolveKey, type KeyAction, type KeyContext } from './input/keymap.js';
import { buildCatalogue } from './model/catalogue.js';
import { helpTabFor } from './model/help.js';
import { listModel } from './model/index.js';
import type { Glyphs } from './render/glyphs.js';
import type { Size } from './render/layout.js';
import type { Tone } from './render/theme.js';
import { inputView, taskView, type Action, type TaskTab, type TuiState, type View } from './state/actions.js';
import { dirtyCount } from './state/reducer.js';
import type { Persister } from './state/persist.js';
import { repoEntry } from './state/persist.js';
import type { Store } from './state/store.js';
import { restoreTree } from './ui/widgets/tree.js';

/** What the controller acts through. */
export interface ControllerDeps {
    store: Store;
    glyphs: Glyphs;
    /** The current session's API (null before a session opens). */
    api: () => Api | null;
    feeds: Feeds;
    persist: Persister | null;
    /** Ends the app with an exit code. */
    exit: (code: number) => void;
    /** Opens another repository (`/repo`, a refusal retry). */
    openTarget: (target: string) => Promise<void>;
    /** Runs the device-flow login for an origin (`/login`). */
    login: (url: string) => Promise<void>;
    now: () => number;
    /** The debug log. */
    log: (line: string) => void;
}

/** Hooks later views register: what `⏎` opens on the current row, tree operations, and the like. */
export interface ViewHooks {
    /** `⏎` / `→` on a list view. */
    open?: (state: TuiState, controller: Controller) => void;
    /** A tree operation on a tree view. */
    tree?: (action: KeyAction, state: TuiState, controller: Controller) => boolean;
    /** Every other key action a view handles (logs, editing). */
    key?: (action: KeyAction, state: TuiState, controller: Controller) => boolean;
    /** Commands a view handles (`/find`, `/goto`, `/save`, `/tag`, …); true when handled. */
    command?: (command: ParsedCommand, state: TuiState, controller: Controller) => Promise<boolean>;
    /** Variant tags `/tag` offers on the selected row. */
    tags?: (state: TuiState) => string[] | undefined;
}

const hooks = new Map<string, ViewHooks>();

/**
 * Registers a view's hooks (called by each view module on load).
 *
 * @param kind - The view kind
 * @param viewHooks - The hooks
 */
export function registerViewHooks(kind: string, viewHooks: ViewHooks): void {
    hooks.set(kind, { ...hooks.get(kind), ...viewHooks });
}

/** The controller. */
export interface Controller {
    /** Handles one Ink key event. */
    onKey(input: string, key: Key): void;
    /** Runs a command line (`/task forecast`, or a fuzzy jump). */
    execute(text: string): Promise<void>;
    /** Shows a toast for three seconds (with the tone's glyph, or `glyph`). */
    toast(text: string, tone?: Tone, glyph?: string): void;
    /** Replaces the view (or pushes it onto the history). */
    navigate(view: View, push?: boolean): void;
    /** Opens a task view. */
    openTask(ws: string, task: string, tab?: TaskTab): void;
    /** Opens an input view. */
    openInput(ws: string, name: string): void;
    /** Opens a workspace's dashboard as the new root. */
    openWorkspace(ws: string): void;
    /** Goes back one view. */
    back(): void;
    /** Quits (asking first while edits are pending). */
    quit(force: boolean): void;
    /** Records the terminal size. */
    setSize(size: Size): void;
    /** Records the output stream (mouse enable / disable). */
    attachStdout(stdout: NodeJS.WriteStream): void;
    /** Recomputes the completion list for the current box text. */
    updateCompletion(): void;
    /** The dependencies (for view hooks). */
    readonly deps: ControllerDeps;
    /** Dispatches an action. */
    dispatch(action: Action): void;
    /** The current state. */
    state(): TuiState;
    /** The current workspace, if the view has one. */
    workspace(): string | null;
}

let toastSeq = 0;

/**
 * Creates the controller.
 *
 * @param deps - The dependencies
 * @returns The controller
 */
export function createController(deps: ControllerDeps): Controller {
    const { store } = deps;
    let stdout: NodeJS.WriteStream | null = null;

    const state = (): TuiState => store.getState();
    const dispatch = (action: Action): void => store.dispatch(action);
    const workspace = (): string | null => {
        const v = state().view;
        if (v.kind === 'dashboard' || v.kind === 'task' || v.kind === 'input') return v.ws;
        const persisted = deps.persist?.state;
        const session = state().session;
        if (persisted !== undefined && session !== null) return persisted.repos[session.stateKey]?.workspace ?? null;
        return null;
    };

    const remember = (view: View): void => {
        const session = state().session;
        if (deps.persist === null || session === null) return;
        deps.persist.update(s => {
            const entry = repoEntry(s, session.stateKey);
            if (view.kind === 'dashboard' || view.kind === 'task' || view.kind === 'input') entry.workspace = view.ws;
            entry.view = view.kind === 'task' ? `task:${view.task}` : view.kind === 'input' ? `input:${view.name}` : view.kind;
        });
    };

    const controller: Controller = {
        deps,
        dispatch,
        state,
        workspace,
        onKey(input, key) {
            const s = state();
            const v = s.view;
            const viewHooks = hooks.get(v.kind);
            const ctx: KeyContext = {
                commandMode: s.command.mode,
                editingLeaf: v.kind === 'input' && v.editing !== null,
                scope: v.kind === 'repos' || v.kind === 'workspaces' || v.kind === 'dashboard' ? 'list'
                    : v.kind === 'task' ? (v.tab === 'output' ? 'tree' : v.tab === 'logs' ? 'logs' : 'list')
                    : v.kind === 'input' ? 'tree'
                    : 'none',
                editable: v.kind === 'input',
                tabs: v.kind === 'task' ? (v.reads !== undefined && (s.data.taskList[v.ws] ?? []).some(t => t.name === v.task && t.kind.type === 'some' && t.kind.value === 'ui') ? 4 : 3) : v.kind === 'help' ? 6 : 0,
                pendingKey: s.pendingKey,
            };
            const action = resolveKey(input, key, ctx);
            if (s.pendingKey !== null) dispatch({ type: 'pendingKey', key: null });
            if (action === null) return;
            deps.log(`key ${JSON.stringify(input)} → ${action.kind}`);
            if (viewHooks?.key?.(action, s, controller) === true) return;
            handleAction(action, s, viewHooks);
        },
        async execute(text) {
            const trimmed = text.trim();
            if (trimmed === '') {
                dispatch({ type: 'command/clear' });
                return;
            }
            if (!trimmed.startsWith('/')) {
                const candidates = complete(trimmed, buildCatalogue(state(), deps.glyphs));
                const first = candidates[0];
                if (first === undefined) {
                    controller.toast(`no match for ${trimmed}`, 'warn');
                    return;
                }
                await controller.execute(first.insert);
                return;
            }
            const parsed = parseCommand(trimmed);
            if (!parsed.ok) {
                controller.toast(parsed.error, 'neg');
                return;
            }
            dispatch({ type: 'command/clear' });
            try {
                await runCommand(parsed.command);
            } catch (err) {
                deps.log(`command ${trimmed} failed: ${describeError(err)}`);
                controller.toast(describeError(err), 'neg');
            }
        },
        toast(text, tone = 'pos', glyph) {
            const id = ++toastSeq;
            dispatch({ type: 'toast', toast: { id, text, tone, ...(glyph !== undefined ? { glyph } : {}), until: deps.now() + 3_000 } });
            const timer = setTimeout(() => dispatch({ type: 'toast/clear', id }), 3_000);
            timer.unref?.();
        },
        navigate(view, push = false) {
            dispatch(push ? { type: 'view/push', view } : { type: 'view/set', view });
            remember(view);
        },
        openTask(ws, task, tab = 'output') {
            const s = state();
            const v = s.view;
            if (v.kind === 'task' && v.ws === ws && v.task === task) {
                dispatch({ type: 'task/tab', tab });
                return;
            }
            controller.navigate(taskView(ws, task, tab), v.kind === 'dashboard' || v.kind === 'task' || v.kind === 'input');
            restoreTree(controller, ws, `.tasks.${task}.output`);
        },
        openInput(ws, name) {
            const v = state().view;
            controller.navigate(inputView(ws, name), v.kind === 'dashboard' || v.kind === 'task' || v.kind === 'input');
            restoreTree(controller, ws, `.inputs.${name}`);
        },
        openWorkspace(ws) {
            dispatch({ type: 'view/root', view: { kind: 'dashboard', ws, list: { sel: 0, top: 0 } } });
            remember({ kind: 'dashboard', ws, list: { sel: 0, top: 0 } });
        },
        back() {
            const s = state();
            if (s.command.mode !== 'idle') {
                dispatch({ type: 'command/clear' });
                return;
            }
            if (s.history.length > 0) {
                dispatch({ type: 'view/pop' });
                remember(state().view);
                return;
            }
            const v = s.view;
            if (v.kind === 'task' || v.kind === 'input') controller.openWorkspace(v.ws);
        },
        quit(force) {
            const dirty = dirtyCount(state());
            if (dirty > 0 && !force) {
                dispatch({ type: 'command/confirm', confirm: { question: `quit with ${dirty} unsaved edit${dirty === 1 ? '' : 's'}?`, command: '/quit --force' } });
                return;
            }
            deps.exit(0);
        },
        setSize(size) {
            const current = state().size;
            if (current.columns !== size.columns || current.rows !== size.rows) dispatch({ type: 'size', size });
        },
        attachStdout(stream) {
            stdout = stream;
            void stdout;
        },
        updateCompletion() {
            const s = state();
            if (s.command.mode !== 'edit') return;
            const tags = hooks.get(s.view.kind)?.tags?.(s);
            dispatch({ type: 'command/completion', items: complete(s.command.text, buildCatalogue(s, deps.glyphs, tags)) });
        },
    };

    const startTyping = (text: string): void => {
        dispatch({ type: 'command/edit', text });
        controller.updateCompletion();
    };

    const handleAction = (action: KeyAction, s: TuiState, viewHooks: ViewHooks | undefined): void => {
        switch (action.kind) {
            case 'quit': controller.quit(false); return;
            case 'help': controller.navigate({ kind: 'help', tab: helpTabFor(s.view.kind) }, true); return;
            case 'back': controller.back(); return;
            case 'refresh': deps.feeds.refresh(); return;
            case 'type': startTyping(action.text); return;
            case 'prefill': startTyping(action.text); return;
            case 'pending': dispatch({ type: 'pendingKey', key: action.key }); return;
            case 'paste': {
                if (s.command.mode === 'edit') dispatch({ type: 'command/insert', text: action.text });
                else dispatch({ type: 'command/edit', text: action.text });
                controller.updateCompletion();
                if (action.submit) void controller.execute(state().command.text);
                return;
            }
            case 'nextPane': return;
            case 'tab': {
                if (s.view.kind === 'help') {
                    const tabs = ['everywhere', 'repos', 'workspaces', 'dashboard', 'task', 'input'] as const;
                    dispatch({ type: 'help/tab', tab: tabs[action.index] ?? 'everywhere' });
                } else if (s.view.kind === 'task') {
                    const tabs: TaskTab[] = ['output', 'logs', 'runs', 'reads'];
                    dispatch({ type: 'task/tab', tab: tabs[action.index] ?? 'output' });
                }
                return;
            }
            case 'move': {
                if (s.view.kind === 'help') {
                    const tabs = ['everywhere', 'repos', 'workspaces', 'dashboard', 'task', 'input'] as const;
                    const i = tabs.indexOf(s.view.tab);
                    if (action.op === 'up' || action.op === 'down') return;
                    return void i;
                }
                if (viewHooks?.tree?.(action, s, controller) === true) return;
                const model = listModel(s);
                dispatch({ type: 'list/move', op: action.op, count: model.count, visible: model.visible });
                return;
            }
            case 'open': viewHooks?.open?.(s, controller); return;
            case 'expand': case 'collapse': case 'toggle': case 'collapseDeep': case 'next': case 'prev': case 'save':
                viewHooks?.tree?.(action, s, controller);
                return;
            case 'retry': {
                if (s.view.kind === 'refusal') void deps.openTarget(s.session?.target ?? refusalTarget(s));
                return;
            }
            // -- the command box ------------------------------------------
            case 'cmd.char': dispatch({ type: 'command/insert', text: action.text }); controller.updateCompletion(); return;
            case 'cmd.backspace': {
                if (s.command.text.length <= 1) { dispatch({ type: 'command/clear' }); return; }
                dispatch({ type: 'command/backspace' });
                controller.updateCompletion();
                return;
            }
            case 'cmd.delete': dispatch({ type: 'command/delete' }); controller.updateCompletion(); return;
            case 'cmd.left': dispatch({ type: 'command/cursor', to: 'left' }); return;
            case 'cmd.right': dispatch({ type: 'command/cursor', to: 'right' }); return;
            case 'cmd.home': dispatch({ type: 'command/cursor', to: 'home' }); return;
            case 'cmd.end': dispatch({ type: 'command/cursor', to: 'end' }); return;
            case 'cmd.up': dispatch({ type: 'command/completionMove', delta: -1 }); return;
            case 'cmd.down': dispatch({ type: 'command/completionMove', delta: 1 }); return;
            case 'cmd.cancel': dispatch({ type: 'command/clear' }); return;
            case 'cmd.complete': {
                const completion = s.command.completion;
                const item = completion?.items[completion.index];
                if (item === undefined) return;
                dispatch({ type: 'command/edit', text: item.insert });
                controller.updateCompletion();
                return;
            }
            case 'cmd.submit': {
                if (s.command.mode === 'confirm' && s.command.confirm !== null) {
                    const command = s.command.confirm.command;
                    dispatch({ type: 'command/clear' });
                    void controller.execute(command);
                    return;
                }
                const completion = s.command.completion;
                const item = completion?.items[completion.index];
                // A picked completion row runs that item; a fully typed command runs as typed.
                if (item !== undefined && (!s.command.text.startsWith('/') || item.kind !== 'command' && item.kind !== 'flag' && !parseCommand(s.command.text).ok)) {
                    void controller.execute(item.insert);
                    return;
                }
                if (item !== undefined && item.kind !== 'command' && item.kind !== 'flag' && parseCommand(s.command.text).ok) {
                    const parsed = parseCommand(s.command.text);
                    // `/task fore` with a highlighted row opens the row, not the literal.
                    if (parsed.ok && 'target' in parsed.command && item.insert !== s.command.text) {
                        void controller.execute(item.insert);
                        return;
                    }
                }
                void controller.execute(s.command.text);
                return;
            }
            default:
                return;
        }
    };

    const refusalTarget = (s: TuiState): string => {
        if (s.view.kind !== 'refusal') return '.';
        const r = s.view.refusal;
        if (r.kind === 'not-repo') return r.target;
        if (r.kind === 'not-logged-in') return r.repo !== null ? `${r.origin}/repos/${r.repo}` : r.origin;
        if (r.kind === 'unreachable') return r.url.replace(/\/api\/repos(\/[^/]+)?.*$/, (_m, repo: string | undefined) => (repo !== undefined ? `/repos${repo}` : ''));
        return '.';
    };

    const runCommand = async (command: ParsedCommand): Promise<void> => {
        const s = state();
        const ws = workspace();
        const viewHooks = hooks.get(s.view.kind);
        if (viewHooks?.command !== undefined && await viewHooks.command(command, s, controller)) return;
        switch (command.name) {
            case 'task': {
                if (ws === null) { controller.toast('open a workspace first', 'warn'); return; }
                controller.openTask(ws, command.target);
                return;
            }
            case 'input': {
                if (ws === null) { controller.toast('open a workspace first', 'warn'); return; }
                controller.openInput(ws, command.target);
                return;
            }
            case 'dataset': {
                if (ws === null) { controller.toast('open a workspace first', 'warn'); return; }
                const path = `.${command.target.replace(/^\./, '')}`;
                const input = /^\.inputs\.([^.]+)$/.exec(path);
                const task = /^\.tasks\.([^.]+)\.output$/.exec(path);
                if (input !== null) controller.openInput(ws, input[1]!);
                else if (task !== null) controller.openTask(ws, task[1]!);
                else controller.toast(`${path} is not an input or a task output`, 'warn');
                return;
            }
            case 'workspace': {
                const known = s.data.workspaces;
                if (known !== null && !known.some(w => w.name === command.target)) {
                    controller.toast(`no workspace ${command.target}`, 'warn');
                    return;
                }
                controller.openWorkspace(command.target);
                return;
            }
            case 'workspaces': controller.navigate({ kind: 'workspaces', list: { sel: 0, top: 0 } }, s.view.kind !== 'workspaces'); return;
            case 'repos': {
                if (s.session?.origin === null) { controller.toast('a local repository has no repository list', 'warn'); return; }
                controller.navigate({ kind: 'repos', list: { sel: 0, top: 0 } }, s.view.kind !== 'repos');
                return;
            }
            case 'repo': {
                const dirty = dirtyCount(s);
                if (dirty > 0) {
                    dispatch({ type: 'command/confirm', confirm: { question: `discard ${dirty} unsaved edit${dirty === 1 ? '' : 's'} and open ${command.target}?`, command: `/discard --then "/repo ${command.target}"` } });
                    return;
                }
                await deps.openTarget(command.target);
                return;
            }
            case 'login': await deps.login(command.url); return;
            case 'run': {
                const here = viewWorkspace(s);
                if (here === null) { controller.toast('open a workspace first', 'warn'); return; }
                await startRun(controller, here, { force: command.force, filter: command.filter, concurrency: command.concurrency });
                return;
            }
            case 'stop': {
                const here = viewWorkspace(s);
                if (here === null) { controller.toast('open a workspace first', 'warn'); return; }
                await cancelRun(controller, here);
                return;
            }
            case 'logs': {
                if (ws === null) { controller.toast('open a workspace first', 'warn'); return; }
                controller.openTask(ws, command.task, 'logs');
                if (command.stream !== undefined) dispatch({ type: 'logs/stream', stream: command.stream });
                return;
            }
            case 'runs': {
                if (ws === null) { controller.toast('open a workspace first', 'warn'); return; }
                controller.openTask(ws, command.task, 'runs');
                return;
            }
            case 'refresh': deps.feeds.refresh(); controller.toast('polling every feed now', 'info'); return;
            case 'help': controller.navigate({ kind: 'help', tab: helpTabFor(s.view.kind) }, true); return;
            case 'about': controller.navigate({ kind: 'about' }, true); return;
            case 'quit': controller.quit(command.force); return;
            default:
                controller.toast(`/${command.name} does nothing here`, 'warn');
                return;
        }
    };

    return controller;
}
