/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * When a layout measured as the page lays it out is measured again, before
 * the browser paints (#1210, #1269, east-workspace#1741) — a docked pane's tab
 * row (`layout/dock`), and in e3-ui-components a ruler's labels, a cell's
 * chips and a bucket cell's tiles: as it mounts, as what it lays out changes
 * (its signature), as the element it fits changes width — in the
 * ResizeObserver's delivery — and as fonts arrive, which change what it holds
 * and not its width. The element is as wide as its host leaves it, whatever it
 * holds, so a fold never changes what is observed. The caller measures while
 * the flag stands, and lowers it as it does.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

/** Whether a measured layout is to be measured now, and the call that lowers it once it is. */
export interface MeasureAgain {
    /** Whether to measure now: what the layout draws then is never painted, as the measure lands first. Never while the layout is not measured at all. */
    readonly measuring: boolean;
    /** Lowers the flag: the layout is measured. */
    readonly measured: () => void;
}

/**
 * Whether a measured layout is to be measured — see the module docs.
 *
 * @param ref - The element whose width the layout fits
 * @param signature - What the layout depends on: a change of it is measured again
 * @param enabled - Whether the layout is measured at all; one measured again after a time it was not is measured as it comes back
 * @returns Whether to measure now, and the call that lowers it
 */
export function useMeasureAgain(ref: RefObject<HTMLElement | null>, signature: string, enabled = true): MeasureAgain {
    const [measuring, setMeasuring] = useState(true);
    useLayoutEffect(() => { if (enabled) setMeasuring(true); }, [signature, enabled]);
    // The element's width changed: measured again in the observer's delivery, before the frame paints.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!enabled || el === null || typeof ResizeObserver === "undefined") return undefined;
        let width = el.getBoundingClientRect().width;
        const ro = new ResizeObserver(() => {
            const now = el.getBoundingClientRect().width;
            if (Math.abs(now - width) < 0.01) return;
            width = now;
            flushSync(() => setMeasuring(true));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [ref, enabled]);
    // Fonts arriving change what the layout holds, not the element's width.
    useEffect(() => {
        const fonts = typeof document === "undefined" ? undefined : document.fonts;
        if (!enabled || fonts === undefined) return undefined;
        const again = () => setMeasuring(true);
        fonts.addEventListener("loadingdone", again);
        return () => fonts.removeEventListener("loadingdone", again);
    }, [enabled]);
    const measured = useCallback(() => setMeasuring(false), []);
    return { measuring: enabled && measuring, measured };
}
