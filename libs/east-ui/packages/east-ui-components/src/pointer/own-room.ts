/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A press on a part's own room — a docked pane's open row, its rail — that the
 * part takes for itself: anywhere in it but on what takes a press of its own —
 * a button, a field, a link, a label, a summary, what is typed into, and every
 * role that takes a press (a tab, a checkbox, an option, a menu's choices) —
 * never on what a portal draws for it (the part's in React's tree, never on the
 * page), and never the end of a selection gesture in its words: a drag that
 * selected them, or a shift-click that extended a selection into them.
 *
 * @packageDocumentation
 */

/** What takes a press of its own — the elements that do, and the roles that say so: a press on one, or in one, is never its part's. */
const OWN_PRESS = [
    "button", "a[href]", "input", "select", "textarea", "label", "summary", "[contenteditable]:not([contenteditable=false])",
    "[role=button]", "[role=link]", "[role=tab]", "[role=checkbox]", "[role=switch]", "[role=radio]", "[role=option]",
    "[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]",
].join(", ");

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
    // A selection that begins or ends in the part is the gesture's: one elsewhere leaves the press the part's.
    const selection = part.ownerDocument.getSelection();
    return selection === null || selection.isCollapsed || (!part.contains(selection.anchorNode) && !part.contains(selection.focusNode));
}
