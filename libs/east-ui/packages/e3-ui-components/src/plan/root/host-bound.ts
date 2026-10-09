/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Whether the host the Plan renders in bounds it (#1193). A Plan fills its
 * parent, as every builder's frame does: given a height by its host, the
 * frame takes it, and the canvas fills main and scrolls its own rows. In a
 * host that gives it none — a page that grows with what it holds — the frame
 * grows with its canvas, which keeps growing with its rows and mounts what
 * the page shows of them (#812).
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Whether the host bounds the canvas: read from the canvas as laid out,
 * before it paints, and again whenever it or the main it sits in changes
 * size. A canvas growing with its rows that is taller than its main is cut
 * off by a host that bounds the frame. Once bounded, it stays bounded: a
 * canvas that fills main is never taller than it, so nothing could say
 * otherwise. A declared bound (`style.height` / `maxHeight`) is the Plan's
 * own, and asks nothing of the host.
 *
 * @param bodyRef - The canvas's body, the child of the frame's main
 * @param declared - Whether the Plan declares a bound
 * @returns `true` once the host is seen to bound the canvas
 */
export function useHostBound(bodyRef: RefObject<HTMLElement | null>, declared: boolean): boolean {
    const [bounded, setBounded] = useState(false);
    useLayoutEffect(() => {
        if (declared || bounded) return undefined;
        const body = bodyRef.current;
        const main = body?.parentElement ?? null;
        if (body === null || main === null) return undefined;
        // Whole pixels both: a canvas a pixel taller than its main is a rounding, not a host's bound.
        const check = () => { if (body.offsetHeight > main.clientHeight + 1) setBounded(true); };
        check();
        if (typeof ResizeObserver === "undefined") return undefined;
        const ro = new ResizeObserver(check);
        ro.observe(body);
        ro.observe(main);
        return () => ro.disconnect();
    }, [bodyRef, declared, bounded]);
    return bounded;
}
