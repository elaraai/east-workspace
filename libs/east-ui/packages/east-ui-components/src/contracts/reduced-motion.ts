/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `usePrefersReducedMotion` — React hook for the `prefers-reduced-motion`
 * media query.
 *
 * Every renderer that emits animation (via `toAnimationProps` from
 * `east-ui-components/src/style/animation.ts`, or any bespoke keyframe) calls
 * this hook and degrades to `none` when the return value is `true`. Enforces
 * §0.2 a11y contract.
 *
 * Uses `useSyncExternalStore` so the value stays consistent across concurrent
 * renders and updates automatically if the user toggles the OS setting.
 * SSR-safe: the server snapshot returns `false`; the client corrects on
 * hydration if the browser reports `reduce`.
 */

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void): () => void {
    if (typeof window === "undefined") return () => { /* no-op on SSR */ };
    const mql = window.matchMedia(QUERY);
    mql.addEventListener("change", callback);
    return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
    if (typeof window === "undefined") return false;
    return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
    return false;
}

/**
 * Returns `true` when the user has asked the OS for reduced motion.
 *
 * @returns `true` if `prefers-reduced-motion: reduce` matches; `false` otherwise.
 */
export function usePrefersReducedMotion(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
