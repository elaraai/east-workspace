/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A real-Ink mount for the byte and budget specs: the App rendered by
 * Ink's own `render()` — the throttle, the line diff, the writes — into a
 * byte-counting stdout that reads as a 120×40 TTY, rather than
 * ink-testing-library's debug output (which writes every frame whole).
 * Keys go straight to the controller, as Ink's `useInput` would hand them
 * over. Test-only.
 *
 * @packageDocumentation
 */

import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { render, type Key } from 'ink';
import { createElement } from 'react';
import { App } from '../ui/App.js';
import { createController, type Controller } from '../controller.js';
import { createFeeds } from '../data/feeds.js';
import { fakeRepo } from '../api.fake.js';
import { UNICODE } from '../render/glyphs.js';
import type { Size } from '../render/layout.js';
import { createTheme } from '../render/theme.js';
import { initialState, type Action, type View } from '../state/actions.js';
import { createStore, StoreContext, type Store } from '../state/store.js';
import { NOW, fakeSession } from './harness.js';
import '../ui/views/all.js';

/** A mounted app over the real frame writer. */
export interface InkProbe {
    store: Store;
    controller: Controller;
    /** Bytes written to the terminal since the last {@link InkProbe.mark}. */
    bytes(): number;
    /** Writes to the terminal since the last mark. */
    writes(): number;
    /** Forgets the writes so far. */
    mark(): void;
    /** Presses a key: straight into the controller, as Ink's `useInput` would deliver it. */
    key(over: Partial<Key>, input?: string): void;
    /** Waits past Ink's render throttle (30 fps) so the frame is written. */
    flush(): Promise<void>;
    unmount(): Promise<void>;
}

/** Options for {@link mountInk}. */
export interface InkProbeOptions {
    /** The terminal size (default 120×40, the design's budget size). */
    size?: Size | undefined;
    view?: View | undefined;
    /** Actions applied before the first render. */
    actions?: Action[] | undefined;
    /** The clock the App's tick samples (default: the harness's fixed instant). */
    now?: (() => number) | undefined;
    /** Ink's `incrementalRendering` (default true — as the app mounts). */
    incremental?: boolean | undefined;
}

/** No key at all. */
const NO_KEY: Key = {
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, pageDown: false, pageUp: false, home: false, end: false,
    return: false, escape: false, ctrl: false, shift: false, tab: false, backspace: false, delete: false, meta: false,
    super: false, hyper: false, capsLock: false, numLock: false,
};

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Mounts the app through Ink's real `render()`.
 *
 * @param options - The size, view, actions, clock and rendering mode
 * @returns The probe (mounted and settled)
 */
export async function mountInk(options: InkProbeOptions = {}): Promise<InkProbe> {
    const size = options.size ?? { columns: 120, rows: 40 };
    let bytes = 0;
    let writes = 0;
    const counting = new Writable({
        write(chunk: Buffer | string, _encoding, callback) {
            bytes += chunk.length;
            writes += 1;
            callback();
        },
    });
    const stdout = Object.assign(counting, { columns: size.columns, rows: size.rows, isTTY: true }) as unknown as NodeJS.WriteStream;
    const stderr = new Writable({ write(_chunk, _encoding, callback) { callback(); } }) as unknown as NodeJS.WriteStream;
    const stdin = Object.assign(new EventEmitter(), {
        isTTY: true,
        setRawMode: () => undefined,
        setEncoding: () => undefined,
        resume: () => undefined,
        pause: () => undefined,
        ref: () => undefined,
        unref: () => undefined,
        read: () => null,
    }) as unknown as NodeJS.ReadStream;

    const store = createStore(initialState(size, './demo-repo'));
    store.dispatch({ type: 'session', session: fakeSession() });
    if (options.view !== undefined) {
        store.dispatch({ type: 'view/root', view: options.view });
        store.dispatch({ type: 'connection', connection: { kind: 'connected' } });
    }
    for (const action of options.actions ?? []) store.dispatch(action);
    const now = options.now ?? (() => NOW);
    const api = fakeRepo();
    const feeds = createFeeds({ store, api: () => api });
    const controller = createController({
        store,
        glyphs: UNICODE,
        api: () => api,
        feeds,
        persist: null,
        exit: () => undefined,
        openTarget: async () => undefined,
        login: async () => undefined,
        copy: () => true,
        now,
        log: () => undefined,
    });
    const element = createElement(StoreContext.Provider, { value: store },
        createElement(App, {
            controller,
            theme: createTheme(3),
            glyphs: UNICODE,
            version: '1.0.72',
            about: { statePath: '~/.local/state/e3-ui/state.json', terminal: 'kitty 0.36 · 120×40 · truecolor · mouse ●' },
            facts: () => null,
            size,
            now,
        }));
    const instance = render(element, {
        stdout,
        stdin,
        stderr,
        exitOnCtrlC: false,
        patchConsole: false,
        alternateScreen: false,
        maxFps: 30,
        incrementalRendering: options.incremental ?? true,
        interactive: true,
    });
    await wait(120);
    return {
        store,
        controller,
        bytes: () => bytes,
        writes: () => writes,
        mark() {
            bytes = 0;
            writes = 0;
        },
        key(over, input = '') {
            controller.onKey(input, { ...NO_KEY, ...over });
        },
        flush: () => wait(80),
        async unmount() {
            feeds.stop();
            api.dispose();
            instance.unmount();
            await wait(20);
        },
    };
}
