/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Keeping the keyboard in a region as the control it is on goes (#1398): an
 * inspector's Delete, Unplace, Remove or Place takes away what its view shows,
 * and a link in it selects something else — the view the control was pressed
 * in is drawn no more, and the focus, on a control that went with it, would
 * fall to the page's body, where the next Tab starts again at the page's top.
 * The region keeps it: once what it shows has been drawn again, the focus
 * lands on its view's home ({@link FOCUS_HOME}) — its heading, focusable by
 * script and out of the tab order — which names what the region shows now, so
 * a screen reader says where the keyboard is and the next Tab goes on from
 * there. A focus that left the region — for another element, for the page with
 * the control it was on still there, or a press anywhere outside it — is let
 * be.
 *
 * The Schematic's and the Flowchart's Details are such regions.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useRef, type FocusEvent, type RefObject } from "react";

/** What marks a region's home: the element the keyboard lands on as the control it was on goes. */
export const FOCUS_HOME = "data-focus-home";

/** A home's attributes, as a view's heading spreads them: out of the tab order, focusable by script. */
export const FOCUS_HOME_PROPS = { tabIndex: -1, [FOCUS_HOME]: "" } as const;

/** What a region's element spreads: its ref, and its focus and blur listeners. */
export interface FocusHomeRegion<E extends HTMLElement> {
    /** The region's element. */
    readonly ref: RefObject<E | null>;
    /** Hears the focus enter the region, or move within it. */
    readonly onFocus: () => void;
    /** Hears the focus leave an element of the region. */
    readonly onBlur: (event: FocusEvent<E>) => void;
}

/**
 * Keeps the keyboard in a region (see the module docs).
 *
 * @returns What the region's element spreads
 */
export function useFocusHome<E extends HTMLElement = HTMLDivElement>(): FocusHomeRegion<E> {
    const ref = useRef<E | null>(null);
    // Whether the keyboard is the region's: set as the focus enters it; let go as the focus leaves for another element, or
    // for the page with the control it was on still there, and at a press outside it.
    const held = useRef(false);
    useEffect(() => {
        const region = ref.current;
        if (region === null || typeof MutationObserver === "undefined") return undefined;
        const doc = region.ownerDocument;
        // What the region shows drawn again: a control it held the focus on gone, the focus lands on the home it shows
        // now — or on the one a later drawing shows, while this one shows none.
        const observer = new MutationObserver(() => {
            if (!held.current) return;
            const active = doc.activeElement;
            if (active !== null && active !== doc.body) {
                if (!region.contains(active)) held.current = false;
                return;
            }
            region.querySelector<HTMLElement>(`[${FOCUS_HOME}]`)?.focus();
        });
        observer.observe(region, { childList: true, subtree: true });
        // A press outside the region is the viewer's move elsewhere, whatever it focuses — the page's body among it.
        const onDown = (event: PointerEvent) => {
            if (!(event.target instanceof Node) || !region.contains(event.target)) held.current = false;
        };
        doc.addEventListener("pointerdown", onDown, true);
        return () => {
            observer.disconnect();
            doc.removeEventListener("pointerdown", onDown, true);
        };
    }, []);
    const onFocus = useCallback(() => { held.current = true; }, []);
    const onBlur = useCallback((event: FocusEvent<E>) => {
        const next = event.relatedTarget;
        if (next instanceof Node && ref.current?.contains(next) === true) return;
        if (next !== null) {
            held.current = false;
            return;
        }
        // To the page: let go where the control is still there — a click on nothing — and kept where it went with its view.
        const left = event.target;
        queueMicrotask(() => { if (left.isConnected) held.current = false; });
    }, []);
    return { ref, onFocus, onBlur };
}
