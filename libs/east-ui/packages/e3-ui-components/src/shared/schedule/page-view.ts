/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A period builder's view — the page's own (#1398): the Calendar's layout,
 * period and date, the Roster's week and the Allocation's day. It is kept
 * state (east-ui-components' `platform/kept.ts`): one view a key for the page's
 * life, every builder under the key reading it, so a step moves it and the
 * window the builder writes beside it together, and every render reads them
 * together. Storage keeps the view the viewer left for a reload: written as the
 * view moves, read before the page's first builder under its key draws — and
 * never followed while the page runs.
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

import { NOT_KEPT, keptJson, useKept } from "@elaraai/east-ui-components/internal";

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
    const [view, setView] = useKept(key, keptJson<V>((stored) => viewOf(stored) ?? NOT_KEPT), initial);
    return { view, setView };
}
