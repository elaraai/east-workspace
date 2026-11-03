/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A builder's own control opening one of its frame's panes where what it just
 * asked for shows: the issues chip opening Issues, a Find a fit opening the
 * Library's answer (`Mobile Builder Frame Spec.md` FR6.3). On a wider frame the
 * pane's rail expands it where it is collapsed; on a phone's frame its strip
 * tab opens its view. A tap selecting something opens neither: on a phone the
 * tab says what is selected, and the selection leaves main in view.
 *
 * @packageDocumentation
 */

/**
 * Opens a pane of the frame inside `root`, where it is closed.
 *
 * @param root - The element holding the builder's frame
 * @param label - The pane's name, as its rail's Expand control names it
 * @param side - Which side of the frame the pane is on
 */
export function openFramePane(root: Element | null, label: string, side: "start" | "end"): void {
    root?.querySelector<HTMLButtonElement>(`button[aria-label="Expand ${label}"], [data-pane-tab="${side}"][aria-selected="false"]`)?.click();
}
