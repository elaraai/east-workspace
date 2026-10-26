/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A period builder's view — the page's own (#1398): the Calendar's layout,
 * period and date, the Roster's week and the Allocation's day. Each is held
 * for as long as the page's UI store holds what the builder keeps beside it —
 * the window it writes into its sources — so a step moves the two together and
 * every render reads them together. Storage keeps the view the viewer left
 * for a reload: written as the view moves, and read once, as the page's first
 * builder under its key mounts — never followed while the page runs.
 *
 * Followed, storage moved a page's view from outside it: another page writing
 * it — a second tab on the same builder, the browser's own storage editor —
 * reached this page's view and never what the page holds beside it. The
 * Calendar's window then put its date back at the window's first day, and its
 * timeline, centred there, re-centred a window back, writing a date the other
 * page heard in turn: a board stepped on in one tab ran back a window at a
 * time in both. The Roster's week and the Allocation's day moved under the
 * viewer, with what the toolbar's Publish and the history act on.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { UIStoreInterface } from "@elaraai/east-ui-components";
import { getStore } from "@elaraai/east-ui-components/internal";

/** A view as its page holds it, and what hears it move. */
interface HeldView {
    view: unknown;
    readonly listeners: Set<() => void>;
}

/** Each page's views, by the UI store what they read beside them lives in, then by their storage key: they go as it goes. */
const pages = new WeakMap<UIStoreInterface, Map<string, HeldView>>();

/**
 * What storage keeps under a key, as JSON: `undefined` for nothing kept, for storage the page cannot reach, or for text
 * that is no JSON.
 *
 * @param key - The storage key
 * @returns What it keeps
 */
function kept(key: string): unknown {
    let text: string | null;
    try { text = localStorage.getItem(key); } catch { return undefined; }
    if (text === null) return undefined;
    try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

/**
 * A view in a page: the one its page holds already, else the one storage keeps, else the author's.
 *
 * @param store - The page's UI store
 * @param key - The view's storage key
 * @param initial - The author's view
 * @param viewOf - The view storage keeps, read defensively: `undefined` for anything this version does not write
 * @returns The page's view
 */
function heldIn<V>(store: UIStoreInterface, key: string, initial: V, viewOf: (stored: unknown) => V | undefined): HeldView {
    let views = pages.get(store);
    if (views === undefined) { views = new Map(); pages.set(store, views); }
    let held = views.get(key);
    if (held === undefined) {
        held = { view: viewOf(kept(key)) ?? initial, listeners: new Set() };
        views.set(key, held);
    }
    return held;
}

/**
 * A builder's view, the page's own (see the module docs). Setting it keeps it for a reload; another page's keeping it
 * moves nothing here. Every builder under the key in the page shares it.
 *
 * @param key - The view's storage key
 * @param initial - The author's view: what a page with nothing held and nothing kept opens on
 * @param viewOf - The view storage keeps, read defensively — storage outlives versions, and anything may write it: the
 *   view, taken only in the shape this version writes; `undefined` for anything else. The same function for a key.
 * @returns The view, and what moves it
 */
export function usePageView<V>(key: string, initial: V, viewOf: (stored: unknown) => V | undefined): { view: V; setView: (next: V) => void } {
    const store = getStore();
    // The author's view is a page's first only: once the page holds a view, it is the page's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const held = useMemo(() => heldIn(store, key, initial, viewOf), [store, key]);
    const subscribe = useCallback((cb: () => void) => {
        held.listeners.add(cb);
        return () => { held.listeners.delete(cb); };
    }, [held]);
    const get = useCallback(() => held.view as V, [held]);
    const view = useSyncExternalStore(subscribe, get, get);
    const setView = useCallback((next: V) => {
        held.view = next;
        // Storage may be unavailable (private browsing, a full quota): the page keeps its view, and a reload starts from the author's.
        try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* the page's view stands */ }
        for (const cb of [...held.listeners]) cb();
    }, [held, key]);
    return { view, setView };
}
