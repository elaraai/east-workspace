/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Whether a one-line part's words are cut for want of room: wider than the box that draws them, so they end in an
 * ellipsis. What a host that says the same words elsewhere, where there is room, asks — the Record's status line, which
 * takes only its toolbar's slack, says its words in its footer where the toolbar cuts them.
 *
 * Measured as the part is laid out and again whenever its box changes size; `false` where nothing can be measured.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useState } from "react";

/** A part's ref, and whether its words are cut. */
export interface CutOff {
    /** The ref the part's element takes. */
    readonly ref: (element: HTMLElement | null) => void;
    /** Whether its words are wider than its box. */
    readonly cut: boolean;
}

/**
 * Whether a one-line part's words are cut (see the module docs).
 *
 * @param words - The words it draws: measured again as they change
 * @returns The part's ref, and whether its words are cut
 */
export function useCutOff(words: string): CutOff {
    const [element, setElement] = useState<HTMLElement | null>(null);
    const [cut, setCut] = useState(false);
    const ref = useCallback((el: HTMLElement | null) => setElement(el), []);
    useLayoutEffect(() => {
        if (element === null) { setCut(false); return undefined; }
        const measure = () => setCut(element.scrollWidth > element.clientWidth + 0.5);
        measure();
        if (typeof ResizeObserver === "undefined") return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [element, words]);
    return { ref, cut };
}
