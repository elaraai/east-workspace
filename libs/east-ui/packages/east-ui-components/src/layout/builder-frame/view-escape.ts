/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Esc closes a phone's view wherever the focus is. A view hears the key as it
 * bubbles from a control in it; a control that goes off as it is pressed — a
 * Clear with nothing left to clear — drops the focus on the page's body, where
 * the key never reaches the view, so it hears the document too, as a popover's
 * dismissal does. A key something in the view took first is left alone — a
 * layer it closed, a field it put back — but a search box's own: a combobox
 * takes every Esc in its input, its list open or not, and with its list closed
 * that Esc is the view's, or the view's search box would hold it open for good.
 *
 * @packageDocumentation
 */

import { useEffect, useRef } from "react";

/** A combobox's or a popover's or a menu's content, open. Portaled out of the frame, it is a layer over the view, and the Esc is its own; one laid in the view, a pane's Chooser, always shows and holds no Esc. */
const OPEN_CONTENT = '[data-part="content"][data-state="open"]:is([data-scope="combobox"], [data-scope="popover"], [data-scope="menu"], [data-scope="select"])';

/** A combobox's input, which takes every Esc. */
const SEARCH_INPUT = '[data-scope="combobox"][data-part="input"]';

/**
 * Whether a layer portaled out of every frame is open over a view: the Esc is its own.
 *
 * @returns Whether one is open
 */
export function layerOpen(): boolean {
    return [...document.querySelectorAll(OPEN_CONTENT)].some((el) => el.closest("[data-builder-frame]") === null);
}

/**
 * Closes a view on an Esc from anywhere while it shows.
 *
 * @param open - Whether the view shows
 * @param onClose - Closes it
 */
export function useViewEscape(open: boolean, onClose: () => void): void {
    const close = useRef(onClose);
    close.current = onClose;
    useEffect(() => {
        if (!open) return undefined;
        // Read before anything hears the key: by the time it bubbles, the layer it closed is closed.
        let layered = false;
        const beforeAll = (event: KeyboardEvent) => {
            if (event.key === "Escape") layered = layerOpen();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || layered) return;
            const search = event.target instanceof Element && event.target.matches(SEARCH_INPUT);
            if (event.defaultPrevented && !search) return;
            event.preventDefault();
            close.current();
        };
        document.addEventListener("keydown", beforeAll, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("keydown", beforeAll, true);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);
}
