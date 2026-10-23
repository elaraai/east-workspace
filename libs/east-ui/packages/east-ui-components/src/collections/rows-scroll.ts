/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What scrolls a frame's rows (#1398, CL2), for a row taller than the view —
 * an unloaded run — to draw only the part of itself the view shows. A virtual
 * frame redraws its rows only as its mounted range moves, never while the view
 * moves inside one tall row, so such a row follows the view itself: the frame
 * places what scrolls its rows after every commit — and how much of the
 * view's top a pinned header covers — and the row asks what of it is in view
 * ({@link RowsScroll.view}) and hears whenever that may have moved
 * ({@link RowsScroll.listen}): a scroll, a resize, the frame laid out again.
 *
 * A virtual frame also says where it placed each row it draws
 * ({@link useRowTop}), and what of its rows the view shows from its scroll
 * offset alone ({@link RowsScroll.viewAt}): a row reads its part in view as it
 * renders, so a commit that moves it — a window landing above it — draws it
 * there in that commit, never in a second one after it.
 *
 * @packageDocumentation
 */

import { createContext, useContext } from "react";
import type { RunView } from "./loading/run-rows.js";

/** What scrolls a frame's rows, as a row taller than the view reads it. */
export interface RowsScroll {
    /**
     * What of `el` the view shows now, px from `el`'s own top — under a pinned
     * header, which covers the view's top. A frame that scrolls nothing of its
     * own (its rows in flow on the page) is seen through the window.
     *
     * @param el - A row of the frame
     * @returns Its part in view; negative at the top while it starts below the view's top
     */
    view(el: Element): RunView;
    /**
     * What of a row the view shows, px from the row's own top, the row placed
     * `top` px down the frame's rows ({@link useRowTop}) — from the frame's
     * scroll offset and view, as its virtualizer last read them, so a row
     * reads it as it renders, with no layout read. `undefined` before the
     * frame has placed its rows, and where it places none (its rows in flow).
     *
     * @param top - Where the frame placed the row, px down its rows
     * @returns Its part in view
     */
    viewAt(top: number): RunView | undefined;
    /**
     * Hears whenever what the view shows of the rows may have moved.
     *
     * @param cb - Called on a scroll, a resize, and every commit of the frame
     * @returns Stops hearing
     */
    listen(cb: () => void): () => void;
}

/** A frame's {@link RowsScroll}, placed by the frame. */
export interface PlacedRowsScroll extends RowsScroll {
    /**
     * Where the rows scroll now, and a word to every listener: the frame calls
     * it after every commit, and with nothing once it unmounts.
     *
     * @param scroller - What scrolls the rows: the frame's own scroll element, the ancestor it watches, or the window; `null` for none
     * @param inset - How many px of the view's top a pinned header covers
     * @param edges - The view's top and foot in the rows' own coordinates, as the frame's virtualizer reads them (its scroll offset, its view less the header); absent where it places no rows
     */
    place(scroller: HTMLElement | Window | null, inset: number, edges?: (() => RunView) | undefined): void;
}

function isWindow(target: HTMLElement | Window): target is Window {
    return (target as Window).window === target;
}

/**
 * The view's top and bottom in client coordinates: the window's, or an
 * element's padding box — its height where the page lays nothing out (a test's
 * stubbed box).
 */
function viewport(target: HTMLElement | Window): { top: number; bottom: number } {
    if (isWindow(target)) return { top: 0, bottom: target.innerHeight };
    const box = target.getBoundingClientRect();
    const top = box.top + target.clientTop;
    return { top, bottom: top + (target.clientHeight > 0 ? target.clientHeight : box.height) };
}

/**
 * A frame's rows' scroll: what it scrolls in, followed for each row that
 * listens — the scroll element's scroll events and the window's resizes, held
 * only while something listens.
 *
 * @returns The scroll, for the frame to place
 */
export function createRowsScroll(): PlacedRowsScroll {
    let scroller: HTMLElement | Window | null = null;
    let inset = 0;
    let edges: (() => RunView) | undefined;
    let heard: HTMLElement | Window | null = null;
    const listeners = new Set<() => void>();
    const notify = () => { for (const cb of [...listeners]) cb(); };
    // The scroll events of what scrolls the rows, and the window's resizes, while anything listens.
    const hear = () => {
        const next = listeners.size > 0 ? scroller ?? (typeof window !== "undefined" ? window : null) : null;
        if (next === heard) return;
        heard?.removeEventListener("scroll", notify);
        if (heard !== null && typeof window !== "undefined") window.removeEventListener("resize", notify);
        heard = next;
        heard?.addEventListener("scroll", notify, { passive: true });
        if (heard !== null && typeof window !== "undefined") window.addEventListener("resize", notify);
    };
    return {
        view(el) {
            const target = scroller ?? (typeof window !== "undefined" ? window : null);
            if (target === null) return { top: 0, bottom: 0 };
            const { top, bottom } = viewport(target);
            const at = el.getBoundingClientRect().top;
            return { top: top + (scroller === null ? 0 : inset) - at, bottom: bottom - at };
        },
        viewAt(top) {
            if (edges === undefined) return undefined;
            const at = edges();
            return { top: at.top - top, bottom: at.bottom - top };
        },
        listen(cb) {
            listeners.add(cb);
            hear();
            return () => {
                listeners.delete(cb);
                hear();
            };
        },
        place(next, nextInset, nextEdges) {
            scroller = next;
            inset = nextInset;
            edges = next === null ? undefined : nextEdges;
            hear();
            notify();
        },
    };
}

/** The scroll of the frame around: `null` outside one. */
export const RowsScrollContext = createContext<RowsScroll | null>(null);

/**
 * What scrolls the rows of the frame around (`VirtualRows`), for a row taller
 * than the view to draw what of it is in view.
 *
 * @returns The frame's rows' scroll, or `null` outside a frame
 */
export function useRowsScroll(): RowsScroll | null {
    return useContext(RowsScrollContext);
}

/** Where a virtual frame placed the row being rendered, px down its rows: `undefined` for a row in flow. */
export const RowTopContext = createContext<number | undefined>(undefined);

/**
 * Where the frame around placed the row being rendered, px down its rows —
 * what {@link RowsScroll.viewAt} reads its part in view from.
 *
 * @returns Its top, or `undefined` for a row the frame lays out in flow
 */
export function useRowTop(): number | undefined {
    return useContext(RowTopContext);
}
