/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An element's size as laid out, read before the browser paints (#1735).
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

/** An element's size as laid out, in px, fractions kept. */
export interface LaidOutSize {
    readonly width: number;
    readonly height: number;
}

/** The one observer every measured element shares, with what reads each — made again for another `ResizeObserver`. */
let shared: {
    readonly ctor: typeof ResizeObserver;
    readonly observer: ResizeObserver;
    readonly readers: Map<Element, Set<() => void>>;
} | undefined;

/**
 * Observes an element's size with the observer every measured element shares: a resize the browser delivers before it
 * paints, every element's reading set in one synchronous render, so the frame paints what they lay out — never the
 * places the width before had (#1267's rule, for the whole-pixel geometry).
 *
 * @param el - The element
 * @param read - What reads it again
 * @returns What stops observing it
 */
function observe(el: Element, read: () => void): () => void {
    const Ctor = globalThis.ResizeObserver;
    if (Ctor === undefined) return () => undefined;
    if (shared === undefined || shared.ctor !== Ctor) {
        const readers = new Map<Element, Set<() => void>>();
        const observer = new Ctor((entries) => {
            flushSync(() => {
                for (const entry of entries) for (const reader of readers.get(entry.target) ?? []) reader();
            });
        });
        shared = { ctor: Ctor, observer, readers };
    }
    const { observer, readers } = shared;
    const reading = readers.get(el) ?? new Set<() => void>();
    if (reading.size === 0) observer.observe(el);
    reading.add(read);
    readers.set(el, reading);
    return () => {
        reading.delete(read);
        if (reading.size > 0) return;
        readers.delete(el);
        observer.unobserve(el);
    };
}

/**
 * Track an element's size as laid out, fractions kept — read before the browser paints, and again as it resizes, in
 * the render the resize is delivered in: what places whole-pixel geometry — a time grid's rules, a ruler's ticks, a
 * Plan's bucket tiles (#1735) — where a passive reading would paint it once unplaced as each row mounts, and once
 * where the width before had it as each resizes. A reading that moves nothing sets no state, so it schedules nothing —
 * not even the update React would set aside and render later, a commit of its own, under a canvas whose every commit
 * is counted (#815).
 *
 * @param ref - The element to measure
 * @param active - Skip observing entirely when false: the element is not drawn
 * @returns Its size; `undefined` before it is laid out, and wherever nothing lays it out (jsdom's 0 × 0)
 */
export function useLaidOutSize(ref: RefObject<HTMLElement | null>, active: boolean): LaidOutSize | undefined {
    const [size, setSize] = useState<LaidOutSize | undefined>(undefined);
    // What the last reading set: what a reading is held against before it sets anything.
    const last = useRef<LaidOutSize | undefined>(undefined);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!active || el === null) return undefined;
        const read = () => {
            const { width, height } = el.getBoundingClientRect();
            const was = last.current;
            const same = width <= 0 ? was === undefined : was !== undefined && was.width === width && was.height === height;
            if (same) return;
            const next = width <= 0 ? undefined : { width, height };
            last.current = next;
            setSize(next);
        };
        read();
        return observe(el, read);
    }, [ref, active]);
    return size;
}
