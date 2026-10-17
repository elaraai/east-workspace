/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Whether a builder's footer rail wraps (the shared `builder-footer` rail):
 * its items do not fit on one line. The rail can be wider than main, and its
 * labels are translated, so it fits its actual items rather than assume a
 * breakpoint does.
 *
 * What it measures is the same whichever form the rail is in: the items' own
 * widths (they never shrink or wrap), the rail's unwrapped gap, which the
 * recipe keeps in `--builder-footer-gap` while the rail wraps at a narrower
 * one, and its inline padding and borders. Measured with the wrapped gap, a
 * rail between the two would fit once wrapped, unwrap, and no longer fit —
 * a render loop.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Whether the rail's items need more than one line (see the module docs).
 *
 * @param ref - The rail
 * @param items - What its items are: measured again when it changes
 * @returns Whether it wraps
 */
export function useRailWrap(ref: RefObject<HTMLElement | null>, items: unknown): boolean {
    const [wrap, setWrap] = useState(false);
    useLayoutEffect(() => {
        const rail = ref.current;
        if (rail === null) return undefined;
        const measure = () => {
            const children = [...rail.children];
            const css = getComputedStyle(rail);
            const px = (value: string) => Number.parseFloat(value) || 0;
            const gap = px(css.getPropertyValue("--builder-footer-gap")) || px(css.columnGap);
            const required = children.reduce((n, item) => n + item.getBoundingClientRect().width, 0) + Math.max(0, children.length - 1) * gap
                + px(css.paddingInlineStart) + px(css.paddingInlineEnd) + px(css.borderInlineStartWidth) + px(css.borderInlineEndWidth);
            setWrap(required > rail.getBoundingClientRect().width);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(rail);
        for (const item of rail.children) observer.observe(item);
        return () => observer.disconnect();
    }, [ref, items]);
    return wrap;
}
