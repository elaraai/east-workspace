/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `resolveHoverIntent` — pure delay resolver for `HoverIntentType`.
 *
 * All hover-to-open primitives (Tooltip, ToggleTip, HoverCard, Menu-on-hover)
 * call this helper with their `hoverIntent` prop value to obtain the open /
 * close delay pair. Enforces §0.5 contract: one hover-timing policy across
 * the catalogue, no per-component drift.
 *
 * Delays are hard-coded (not theme-overridable) by design — uniform hover
 * feel is part of the design system, not a consumer tuning knob.
 *
 * Hover parity (#347): on hover-incapable devices the hover-open primitives
 * bypass their hover machines entirely (Tooltip → long-press, HoverCard →
 * tap-to-toggle, both driven by `useHoverCapable()` from `./adaptive.js`),
 * so these delays only ever apply where hover exists.
 */

export type HoverIntent = "instant" | "brief" | "standard" | "patient";

export interface HoverIntentDelays {
    readonly openDelay: number;
    readonly closeDelay: number;
}

const DELAYS: Readonly<Record<HoverIntent, HoverIntentDelays>> = {
    instant:  { openDelay: 0,   closeDelay: 0 },
    brief:    { openDelay: 100, closeDelay: 50 },
    standard: { openDelay: 300, closeDelay: 100 },
    patient:  { openDelay: 700, closeDelay: 200 },
};

/**
 * Resolve a `HoverIntentType` token to `{ openDelay, closeDelay }` in ms.
 *
 * @param token - A `HoverIntent` literal
 * @returns The delay pair in milliseconds
 */
export function resolveHoverIntent(token: HoverIntent): HoverIntentDelays {
    return DELAYS[token];
}
