/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The frame-test harness — mounts the real `App` through
 * `ink-testing-library` over a store, a controller and the in-memory API,
 * and exposes the frame as plain text lines (ANSI stripped) plus key
 * helpers. No PTY, no timers: the specs pre-populate the store and press
 * keys.
 *
 * @packageDocumentation
 */

import { createElement } from 'react';
import { render } from 'ink-testing-library';
import { App } from '../ui/App.js';
import { createController, type Controller } from '../controller.js';
import { createFeeds, type Feeds } from '../data/feeds.js';
import { FakeApi, fakeRepo } from '../api.fake.js';
import { UNICODE, type Glyphs } from '../render/glyphs.js';
import { createTheme } from '../render/theme.js';
import type { Size } from '../render/layout.js';
import { initialState, type Action, type SessionInfo, type TuiState, type View } from '../state/actions.js';
import { createStore, StoreContext, type Store } from '../state/store.js';
import { realClock, type PollClock } from '../state/poll.js';
import type { Persister } from '../state/persist.js';
import '../ui/views/all.js';

/** ANSI SGR / cursor sequences, stripped from frames before assertions. */
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** Strips ANSI sequences. */
export function stripAnsi(text: string): string {
    return text.replace(ANSI, '');
}

/** Two macrotask turns — enough for React, Ink and the store to settle. */
export async function settle(turns = 3): Promise<void> {
    for (let i = 0; i < turns; i++) await new Promise(resolve => setImmediate(resolve));
}

/** A local session over the fake repository. */
export function fakeSession(over: Partial<SessionInfo> = {}): SessionInfo {
    return {
        kind: 'local',
        label: 'demo-repo',
        repo: 'default',
        apiUrl: 'http://127.0.0.1:41823',
        path: '/home/u/demo-repo',
        origin: null,
        identity: null,
        stateKey: '/home/u/demo-repo',
        target: './demo-repo',
        ...over,
    };
}

/** A mounted app. */
export interface Mounted {
    store: Store;
    controller: Controller;
    api: FakeApi;
    feeds: Feeds;
    /** Everything the controller asked to exit with. */
    exits: number[];
    /** Targets `/repo` asked to open. */
    opened: string[];
    /** URLs `/login` asked for. */
    logins: string[];
    /** Texts `c` copied. */
    copied: string[];
    /** The last frame, ANSI stripped. */
    frame(): string;
    /** The last frame's lines. */
    lines(): string[];
    /** Sends raw input (a key sequence) and settles. */
    press(input: string): Promise<void>;
    /** Types printable text one character at a time. */
    type(text: string): Promise<void>;
    /** Dispatches and settles. */
    dispatch(action: Action): Promise<void>;
    /** Re-mounts at a new size. */
    resize(size: Size): Promise<void>;
    /** Settles until `predicate` holds (at most `turns` turns), failing otherwise. */
    waitFor(predicate: () => boolean, turns?: number): Promise<void>;
    unmount(): void;
}

/** Options for {@link mountApp}. */
export interface MountOptions {
    size?: Size | undefined;
    api?: FakeApi | undefined;
    /** The initial view (with a session set). */
    view?: View | undefined;
    session?: SessionInfo | null | undefined;
    /** Actions applied before the first render. */
    actions?: Action[] | undefined;
    glyphs?: Glyphs | undefined;
    now?: (() => number) | undefined;
    clock?: PollClock | undefined;
    /** Whether the feeds start (default: no — specs pre-populate the store). */
    feeds?: boolean | undefined;
    /** A state-file persister (default: none). */
    persist?: Persister | undefined;
    /** Whether mouse reporting counts as on (default: off). */
    mouse?: boolean | undefined;
}

/** The fixed clock the specs render at. */
export const NOW = Date.UTC(2026, 8, 8, 12, 0, 0);

/**
 * Mounts the app.
 *
 * @param options - The size, API, initial view / session / actions
 * @returns The mounted app
 */
export async function mountApp(options: MountOptions = {}): Promise<Mounted> {
    const size = options.size ?? { columns: 120, rows: 36 };
    const api = options.api ?? fakeRepo();
    const store = createStore(initialState(size, './demo-repo'));
    const session = options.session === undefined ? fakeSession() : options.session;
    if (session !== null) store.dispatch({ type: 'session', session });
    if (options.view !== undefined) store.dispatch({ type: 'view/root', view: options.view });
    if (session !== null && options.view !== undefined) store.dispatch({ type: 'connection', connection: { kind: 'connected' } });
    if (options.mouse === true) store.dispatch({ type: 'mouse', enabled: true });
    for (const action of options.actions ?? []) store.dispatch(action);
    const exits: number[] = [];
    const opened: string[] = [];
    const logins: string[] = [];
    const copied: string[] = [];
    const now = options.now ?? (() => NOW);
    const feeds = createFeeds({ store, api: () => api, clock: options.clock ?? realClock });
    const controller = createController({
        store,
        glyphs: options.glyphs ?? UNICODE,
        api: () => api,
        feeds,
        persist: options.persist ?? null,
        exit: (code) => { exits.push(code); },
        openTarget: async (target) => { opened.push(target); },
        login: async (url) => { logins.push(url); },
        copy: (text) => { copied.push(text); return true; },
        now,
        log: () => undefined,
    });
    if (options.feeds === true) feeds.start();
    const element = (s: Size) => createElement(StoreContext.Provider, { value: store },
        createElement(App, {
            controller,
            theme: createTheme(0),
            glyphs: options.glyphs ?? UNICODE,
            version: '1.0.72',
            about: { statePath: '~/.local/state/e3-ui/state.json', terminal: 'kitty 0.36 · 120×36 · truecolor · mouse ●' },
            facts: () => ({ objects: 12408, packages: 2, workspaces: 3 }),
            size: s,
            now,
        }));
    const instance = render(element(size));
    await settle();
    const mounted: Mounted = {
        store, controller, api, feeds, exits, opened, logins, copied,
        frame: () => stripAnsi(instance.lastFrame() ?? ''),
        lines: () => mounted.frame().split('\n'),
        async press(input) {
            instance.stdin.write(input);
            // A lone ESC sits in Ink's pending-escape buffer for 20 ms before
            // it is delivered as the escape key.
            if (input === '\x1b') await new Promise(resolve => setTimeout(resolve, 40));
            await settle();
        },
        async type(text) {
            for (const ch of text) {
                instance.stdin.write(ch);
                await settle(1);
            }
            await settle();
        },
        async dispatch(action) {
            store.dispatch(action);
            await settle();
        },
        async resize(next) {
            instance.rerender(element(next));
            await settle();
        },
        async waitFor(predicate, turns = 200) {
            for (let i = 0; i < turns; i++) {
                if (predicate()) { await settle(); return; }
                await new Promise(resolve => setTimeout(resolve, 5));
                await settle(1);
            }
            throw new Error(`waitFor: the condition did not hold within ${turns} turns\n${mounted.frame()}`);
        },
        unmount() {
            feeds.stop();
            api.dispose();
            instance.unmount();
        },
    };
    return mounted;
}

/** Key sequences. */
export const KEY = {
    enter: '\r',
    escape: '\x1b',
    tab: '\t',
    shiftTab: '\x1b[Z',
    backspace: '\x7f',
    up: '\x1b[A',
    down: '\x1b[B',
    right: '\x1b[C',
    left: '\x1b[D',
    pageUp: '\x1b[5~',
    pageDown: '\x1b[6~',
    home: '\x1b[H',
    end: '\x1b[F',
    ctrlC: '\x03',
    ctrlU: '\x15',
    ctrlD: '\x04',
    shiftLeft: '\x1b[1;2D',
} as const;

/** A view state for the dashboard of `ws`. */
export function dashboardView(ws = 'main'): View {
    return { kind: 'dashboard', ws, list: { sel: 0, top: 0 } };
}

/** The shape of a frame: its line count and each line's cell count (Ink
 *  trims trailing spaces, so widths are at most the column count). */
export function frameShape(frame: string): { rows: number; widths: number[] } {
    const lines = frame.split('\n');
    return { rows: lines.length, widths: lines.map(l => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(l)].length) };
}

export type { TuiState };
