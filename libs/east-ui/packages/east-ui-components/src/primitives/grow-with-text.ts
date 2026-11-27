/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A textarea as tall as its text (east-workspace#1779): never shorter than its
 * rows, and within its `max-height`, past which it scrolls. Its height is set
 * as its text is drawn, before it paints, and again as its width changes — a
 * phone turned, a pane resized — or the page's fonts land, which break its
 * lines anew.
 *
 * Only the box's height is written, never its text. Zag's
 * `autoresizeTextarea` (Ark's and Chakra's `autoresize`) takes the box's
 * `value` property over to hear its text set, which leaves React's own
 * tracking of a controlled box behind: a value its host set from code — a
 * query's Use generated — came back to the host's `onChange` as typing. Here
 * React's render tells of the text instead.
 *
 * @packageDocumentation
 */

import { useEffect, useLayoutEffect } from "react";

/** A computed length in pixels: none where the page gives none. */
function px(length: string): number {
    const n = parseFloat(length);
    return Number.isNaN(n) ? 0 : n;
}

/**
 * Sets a textarea's height to hold its text: the height it lays out at with
 * none of its own — never under its rows — up to its `max-height`, past which
 * it scrolls. A box laid out nowhere (hidden, or out of the page) is left as it
 * is, to be fitted once it lays out.
 *
 * @param box - The textarea
 */
export function fitTextHeight(box: HTMLTextAreaElement): void {
    const style = box.ownerDocument.defaultView?.getComputedStyle(box);
    if (style === undefined) return;
    // Measured with no height of its own and no scrollbar, which would take width from its lines.
    box.style.height = "auto";
    box.style.overflowY = "hidden";
    const tall = box.scrollHeight;
    if (tall === 0) {
        box.style.height = "";
        box.style.overflowY = "";
        return;
    }
    const height = style.boxSizing === "content-box"
        ? tall - px(style.paddingTop) - px(style.paddingBottom)
        : tall + px(style.borderTopWidth) + px(style.borderBottomWidth);
    const max = parseFloat(style.maxHeight);
    const over = !Number.isNaN(max) && height > max;
    box.style.height = `${over ? max : height}px`;
    if (over) box.style.overflowY = "auto";
}

/**
 * Keeps a textarea as tall as its text — see the module docs. Its host keeps
 * the box as its ref gives it (`ref={setBox}`), so the box is fitted as it
 * mounts, in a popover that opens, too.
 *
 * @param box - The textarea, once it is in the page
 * @param text - What it holds: each change fits it again, before it paints
 * @param grows - Whether it grows; turned off, its height is its own again
 */
export function useGrowWithText(box: HTMLTextAreaElement | null, text: unknown, grows = true): void {
    useLayoutEffect(() => {
        if (box === null) return;
        if (grows) fitTextHeight(box);
        else {
            box.style.height = "";
            box.style.overflowY = "";
        }
    }, [box, text, grows]);
    useEffect(() => {
        if (box === null || !grows) return undefined;
        const win = box.ownerDocument.defaultView;
        // Its own height changes as it is fitted: only a change of its width breaks its lines anew.
        let width = box.clientWidth;
        const observer = win !== null && "ResizeObserver" in win
            ? new win.ResizeObserver(() => {
                if (box.clientWidth === width) return;
                width = box.clientWidth;
                fitTextHeight(box);
            })
            : undefined;
        observer?.observe(box);
        const fonts = box.ownerDocument.fonts;
        const onFonts = () => fitTextHeight(box);
        fonts?.addEventListener?.("loadingdone", onFonts);
        return () => {
            observer?.disconnect();
            fonts?.removeEventListener?.("loadingdone", onFonts);
        };
    }, [box, grows]);
}
