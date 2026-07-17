/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Adaptive contract — the shared container-width and pointer-capability
 * hooks behind the responsive/mobile behaviour of every renderer (#346).
 *
 * @remarks
 * Two orthogonal signals drive adaptation:
 *
 * - **Container width** (`useContainerBreakpoint` / `useContainerBelow`):
 *   components adapt to the box they render in — a splitter pane, a task
 *   preview, a webview — never to the viewport. Both hooks observe the
 *   referenced element with a shared, rAF-coalesced `ResizeObserver` and
 *   re-render only when the derived value crosses a threshold (not on
 *   every pixel).
 * - **Pointer capability** (`useCoarsePointer` / `useHoverCapable`): a
 *   global media fact, mirroring the theme conditions `_coarse`
 *   (`@media (pointer: coarse)`) and `_hoverNone` (`@media (hover: none)`)
 *   so renderer logic and recipe CSS key off the same predicates.
 *
 * Environments without `ResizeObserver`/`matchMedia` (SSR, jsdom) resolve
 * to the desktop defaults: `"regular"`, `false` for `useContainerBelow`,
 * `false` for coarse, `true` for hover-capable.
 */

import { useLayoutEffect, useState, useSyncExternalStore, type RefObject } from "react";

/** Container width class: `compact < compactBelow ≤ regular < wideAbove ≤ wide`. */
export type ContainerBreakpoint = "compact" | "regular" | "wide";

/** Threshold overrides for {@link useContainerBreakpoint}. */
export interface ContainerBreakpointThresholds {
    /** Widths strictly below this are `"compact"` (default 480). */
    compactBelow?: number;
    /** Widths at or above this are `"wide"` (default 900). */
    wideAbove?: number;
}

const DEFAULT_COMPACT_BELOW = 480;
const DEFAULT_WIDE_ABOVE = 900;

function classify(width: number, compactBelow: number, wideAbove: number): ContainerBreakpoint {
    if (width < compactBelow) return "compact";
    if (width >= wideAbove) return "wide";
    return "regular";
}

/**
 * Observe an element's inline size and call `onWidth` (rAF-coalesced) when
 * it changes. Shared plumbing for the two public container hooks.
 */
function useContainerWidthEffect(
    ref: RefObject<HTMLElement | null>,
    onWidth: (width: number) => void,
): void {
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        let frame = 0;
        const measure = () => {
            frame = 0;
            const width = el.getBoundingClientRect().width;
            if (width > 0) onWidth(width);
        };
        const ro = new ResizeObserver(() => {
            if (frame === 0) frame = requestAnimationFrame(measure);
        });
        ro.observe(el);
        measure();
        return () => {
            ro.disconnect();
            if (frame !== 0) cancelAnimationFrame(frame);
        };
        // The consumer's callback identity is intentionally not a dependency:
        // both public hooks pass stable setters derived from state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ref]);
}

/**
 * Classify the referenced element's width as `"compact"`, `"regular"` or
 * `"wide"`, re-rendering only when the class changes.
 *
 * @param ref - the element whose inline size drives the classification
 * @param thresholds - optional threshold overrides (defaults 480 / 900)
 * @returns the current {@link ContainerBreakpoint}; `"regular"` when the
 * element is unmounted or `ResizeObserver` is unavailable (SSR, jsdom)
 */
export function useContainerBreakpoint(
    ref: RefObject<HTMLElement | null>,
    thresholds?: ContainerBreakpointThresholds,
): ContainerBreakpoint {
    const compactBelow = thresholds?.compactBelow ?? DEFAULT_COMPACT_BELOW;
    const wideAbove = thresholds?.wideAbove ?? DEFAULT_WIDE_ABOVE;
    const [breakpoint, setBreakpoint] = useState<ContainerBreakpoint>("regular");
    useContainerWidthEffect(ref, (width) => {
        setBreakpoint(classify(width, compactBelow, wideAbove));
    });
    return breakpoint;
}

/**
 * `true` while the referenced element's width is strictly below `px`.
 *
 * The single-threshold form used by narrow-mode components (DecisionQueue's
 * 560 px rail rows, Story's 720 px stack) — re-renders only on crossings.
 *
 * @param ref - the element whose inline size is watched
 * @param px - the threshold in CSS pixels
 * @returns `true` below the threshold; `false` when unmounted or
 * `ResizeObserver` is unavailable (SSR, jsdom)
 */
export function useContainerBelow(ref: RefObject<HTMLElement | null>, px: number): boolean {
    const [below, setBelow] = useState(false);
    useContainerWidthEffect(ref, (width) => {
        setBelow(width < px);
    });
    return below;
}

const COARSE_QUERY = "(pointer: coarse)";
const HOVER_QUERY = "(hover: hover)";

function subscribeMedia(query: string): (callback: () => void) => () => void {
    return (callback) => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
            return () => { /* no-op without matchMedia */ };
        }
        const mql = window.matchMedia(query);
        mql.addEventListener("change", callback);
        return () => mql.removeEventListener("change", callback);
    };
}

function mediaMatches(query: string, fallback: boolean): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return fallback;
    return window.matchMedia(query).matches;
}

const subscribeCoarse = subscribeMedia(COARSE_QUERY);
const subscribeHover = subscribeMedia(HOVER_QUERY);

/**
 * `true` when the primary pointer is coarse (touch). Mirrors the theme's
 * `_coarse` condition so JS behaviour (long-press drag, tap-to-open) and
 * recipe CSS (hit-area inflation) key off the same predicate.
 *
 * @returns `true` if `(pointer: coarse)` matches; `false` otherwise (and on SSR/jsdom)
 */
export function useCoarsePointer(): boolean {
    return useSyncExternalStore(
        subscribeCoarse,
        () => mediaMatches(COARSE_QUERY, false),
        () => false,
    );
}

/**
 * `true` when the device can hover (`(hover: hover)`). Hover-to-open
 * primitives (Tooltip, HoverCard, menu-on-hover) must not arm hover timers
 * when this is `false` — they switch to tap/long-press equivalents.
 *
 * @returns `true` if `(hover: hover)` matches (and on SSR/jsdom); `false` on hover-incapable devices
 */
export function useHoverCapable(): boolean {
    return useSyncExternalStore(
        subscribeHover,
        () => mediaMatches(HOVER_QUERY, true),
        () => true,
    );
}
