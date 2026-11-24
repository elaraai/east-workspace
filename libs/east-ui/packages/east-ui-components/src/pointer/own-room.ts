/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A press on a part's own room — a docked pane's open row, its rail — that the
 * part takes for itself: anywhere in it but on what takes a press of its own (a
 * button, a field, a link, a tab, a menu's item), never on what a portal draws
 * for it (the part's in React's tree, never on the page), and never the end of
 * a drag that selected its words.
 *
 * @packageDocumentation
 */

/** What takes a press of its own: a press on it, or in it, is never its part's. */
const OWN_PRESS = "button, a[href], input, select, textarea, [role=tab], [role=menuitem]";

/**
 * Whether a press is on a part's own room — see the module docs.
 *
 * @param part - The part pressed: the element its handler is on
 * @param target - What the press landed on
 * @returns Whether the part takes the press
 */
export function pressedOwnRoom(part: Element, target: EventTarget | null): boolean {
    if (!(target instanceof Element) || !part.contains(target)) return false;
    const own = target.closest(OWN_PRESS);
    if (own !== null && part.contains(own)) return false;
    const selection = part.ownerDocument.getSelection();
    return selection === null || selection.isCollapsed || !part.contains(selection.anchorNode);
}
