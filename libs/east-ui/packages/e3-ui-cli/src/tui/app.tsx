/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The terminal UI entry — `runTui(options)`: detect the theme and glyphs,
 * load the state file, create the store / feeds / controller, mount Ink on
 * the alternate screen, open the session (the launch screen shows its
 * steps), route to the first view, and exit cleanly on every path (quit,
 * Ctrl-C, SIGTERM, a fatal error), stopping the embedded server and
 * flushing the state file.
 *
 * @packageDocumentation
 */

import * as os from 'node:os';
import { createRequire } from 'node:module';
import { render, type Instance } from 'ink';
import { createElement } from 'react';
import { formatError } from '@elaraai/e3-cli/internal';
import type { TuiOptions } from '../commands/tui.js';
import { App } from './ui/App.js';
import { createController, type Controller } from './controller.js';
import { createFeeds } from './data/feeds.js';
import { createDebugLogger, describeTerminal, EXIT_SOFTWARE, fatalText, installLifecycle } from './lifecycle.js';
import { selectGlyphs } from './render/glyphs.js';
import { createTheme, detectColorLevel } from './render/theme.js';
import { initialState, type View } from './state/actions.js';
import { createPersister, loadState, repoEntry, statePath, type Persister } from './state/persist.js';
import { createStore, StoreContext } from './state/store.js';
import { openSession, SessionRefusal, type Session } from './session.js';
import { suspendTerminal } from './suspend.js';
import type { RepoFacts } from './ui/views/about.js';
import './ui/views/all.js';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json') as { version: string };

/** A running app, for the integration harness. */
export interface TuiHandle {
    controller: Controller;
    session: () => Session | null;
    /** Resolves with the exit code. */
    done: Promise<number>;
}

/**
 * Runs the terminal UI and resolves with the process exit code.
 *
 * @param options - The resolved root-action options
 * @returns The exit code
 */
export async function runTui(options: TuiOptions): Promise<number> {
    const env = process.env;
    const { log, file: debugFile } = createDebugLogger(env);
    const glyphs = selectGlyphs({ ascii: options.ascii, env });
    const level = detectColorLevel(env, process.stdout);
    const theme = createTheme(level);
    const stateFile = statePath(env, process.platform, os.homedir());
    const loaded = loadState(stateFile);
    const persist: Persister = createPersister(stateFile, loaded.state, { onError: (err) => log(`state write failed: ${formatError(err)}`) });
    if (loaded.recoveredFrom !== undefined) log(`state file was corrupt; moved to ${loaded.recoveredFrom}`);

    const size = { columns: process.stdout.columns || 80, rows: process.stdout.rows || 24 };
    const store = createStore(initialState(size, options.repo));
    let session = null as Session | null;
    let instance = null as Instance | null;
    let exitCode = 0;
    let exited = false;

    const feeds = createFeeds({ store, api: () => session?.api ?? null, log });

    const exit = (code: number): void => {
        if (exited) return;
        exited = true;
        exitCode = code;
        feeds.stop();
        instance?.unmount();
    };

    const openTarget = async (target: string): Promise<void> => {
        const previous = session;
        session = null;
        store.dispatch({ type: 'session', session: null });
        store.dispatch({ type: 'data/reset' });
        store.dispatch({ type: 'view/root', view: { kind: 'launch', target, step: 'starting' } });
        if (previous !== null) await previous.stop().catch(() => undefined);
        await open(target);
    };

    const login = async (url: string): Promise<void> => {
        // The device flow prints its code and URL and waits: hand the
        // terminal over, run `e3 auth login` in this process, take it back.
        const { createLoginCommand } = await import('@elaraai/e3-cli/internal');
        await suspendTerminal(async () => {
            const command = createLoginCommand();
            command.exitOverride();
            try {
                await command.parseAsync(['login', url], { from: 'user' });
            } catch (err) {
                process.stderr.write(`${formatError(err)}\n`);
            }
        });
        await openTarget(url === session?.info.origin ? session.info.target : url);
    };
    const controller = createController({
        store,
        glyphs,
        api: () => session?.api ?? null,
        feeds,
        persist,
        exit,
        openTarget,
        login,
        now: () => Date.now(),
        log,
    });

    const facts = (): RepoFacts | null => {
        const status = session?.status ?? null;
        if (status === null) return null;
        return { objects: Number(status.objectCount), packages: Number(status.packageCount), workspaces: Number(status.workspaceCount) };
    };

    const removeLifecycle = installLifecycle({
        onSignal: (signal) => {
            log(`signal ${signal}`);
            exit(signal === 'SIGINT' ? 130 : 0);
        },
        onFatal: (error) => {
            log(`fatal: ${fatalText(error)}`);
            exit(EXIT_SOFTWARE);
            process.stderr.write(`e3-ui: ${fatalText(error)}\n`);
            if (debugFile !== null) process.stderr.write(`(debug log: ${debugFile})\n`);
        },
    });

    // Where the launch lands: --task / --input, else the workspace given, else
    // the last used, else the only one, else the workspaces list.
    const firstView = async (opened: Session): Promise<View> => {
        if (opened.info.kind === 'origin') return { kind: 'repos', list: { sel: 0, top: 0 } };
        store.dispatch({ type: 'view/launchStep', step: 'reading workspaces' });
        const workspaces = await opened.api.workspaceList();
        store.dispatch({ type: 'data/workspaces', workspaces });
        store.dispatch({ type: 'view/launchStep', step: `reading ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}` });
        const remembered = persist.state.repos[opened.info.stateKey]?.workspace;
        const candidates = [options.workspace, remembered, workspaces.length === 1 ? workspaces[0]!.name : undefined];
        const ws = candidates.find(name => name !== undefined && workspaces.some(w => w.name === name));
        if (ws === undefined) {
            if (options.workspace !== undefined) controller.toast(`no workspace ${options.workspace}`, 'warn');
            return { kind: 'workspaces', list: { sel: 0, top: 0 } };
        }
        if (options.task !== undefined) return { kind: 'task', ws, task: options.task, tab: 'output', tree: { sel: 0, top: 0, open: {}, baseDepth: undefined, match: null }, logs: { stream: 'stdout', top: 0, follow: true, match: null }, runs: { sel: 0, top: 0, expanded: false }, reads: { sel: 0, top: 0 } };
        if (options.input !== undefined) return { kind: 'input', ws, name: options.input, tree: { sel: 0, top: 0, open: {}, baseDepth: undefined, match: null }, editing: null };
        return { kind: 'dashboard', ws, list: { sel: 0, top: 0 } };
    };

    const open = async (target: string): Promise<void> => {
        try {
            const opened = await openSession(target, { onStep: (step) => store.dispatch({ type: 'view/launchStep', step }) });
            if (exited) {
                await opened.stop();
                return;
            }
            session = opened;
            store.dispatch({ type: 'session', session: opened.info });
            persist.update(s => {
                s.lastRepo = target;
                repoEntry(s, opened.info.stateKey);
            });
            const view = await firstView(opened);
            store.dispatch({ type: 'view/root', view });
            if (view.kind === 'dashboard' || view.kind === 'task' || view.kind === 'input') {
                persist.update(s => { repoEntry(s, opened.info.stateKey).workspace = view.ws; });
            }
            feeds.sync();
        } catch (err) {
            if (err instanceof SessionRefusal) {
                log(`refusal: ${err.message}`);
                store.dispatch({ type: 'view/root', view: { kind: 'refusal', refusal: err.refusal } });
                if (err.refusal.kind === 'not-logged-in') {
                    store.dispatch({ type: 'command/edit', text: `/login ${err.refusal.origin}` });
                }
                return;
            }
            log(`open failed: ${fatalText(err)}`);
            store.dispatch({ type: 'view/root', view: { kind: 'refusal', refusal: { kind: 'error', message: formatError(err) } } });
        }
    };

    const about = {
        statePath: stateFile.replace(os.homedir(), '~'),
        terminal: describeTerminal(env, size, level, options.mouse, glyphs),
    };

    instance = render(
        createElement(StoreContext.Provider, { value: store },
            createElement(App, { controller, theme, glyphs, version: packageJson.version, about, facts })),
        {
            alternateScreen: true,
            exitOnCtrlC: false,
            patchConsole: true,
            kittyKeyboard: { mode: 'auto' },
            maxFps: 30,
        },
    );
    feeds.start();
    void open(options.repo);

    try {
        await instance.waitUntilExit();
    } catch (err) {
        log(`exited with error: ${fatalText(err)}`);
        exitCode = EXIT_SOFTWARE;
        process.stderr.write(`e3-ui: ${fatalText(err)}\n`);
    } finally {
        exited = true;
        removeLifecycle();
        feeds.stop();
        persist.flush();
        if (session !== null) await session.stop().catch(() => undefined);
    }
    return exitCode;
}
