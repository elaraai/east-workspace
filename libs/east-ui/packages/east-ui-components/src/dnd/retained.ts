/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Retained content (#1398, CL8): what a builder keeps on screen while what it
 * shows is read again — a period stepped to, a narrowing, a new revision —
 * marked `aria-disabled`, as the loading design's stale card has it: readable,
 * focusable and selectable, and taking no gesture that edits. The drag layer
 * picks nothing up in it and takes no drop in it, and a Library's card in it
 * places nothing on ⏎ and takes nothing back by its ×. A builder's own
 * commands refuse their edits there too, so every route is off, not only the
 * pointer's.
 *
 * @packageDocumentation
 */

/** What marks retained content: a region `aria-disabled`, and everything in it. */
export const RETAINED = '[aria-disabled="true"]';

/**
 * Whether a node lies in retained content ({@link RETAINED}).
 *
 * @param node - An event's target, or an element
 * @returns Whether it, or an element around it, is aria-disabled
 */
export function inRetained(node: EventTarget | null): boolean {
    const el = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
    return el !== null && el.closest(RETAINED) !== null;
}
