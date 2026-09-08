/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The focus ring — `Tab` / `⇧Tab` cycle the panes a view has (the body,
 * then the command box; the task view adds its tabs). Focus is transient
 * UI state kept outside the store.
 *
 * @packageDocumentation
 */

/** A focusable pane. */
export type Pane = 'body' | 'command';

/**
 * The next pane in the ring.
 *
 * @param current - The focused pane
 * @param reverse - Cycle backwards
 * @returns The next pane
 */
export function nextPane(current: Pane, reverse: boolean): Pane {
    const ring: Pane[] = ['body', 'command'];
    const index = ring.indexOf(current);
    const step = reverse ? -1 : 1;
    return ring[((index + step) % ring.length + ring.length) % ring.length]!;
}
