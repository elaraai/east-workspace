/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a key a builder's canvas hears comes from (#1398): the Schematic's and
 * the Flowchart's canvases hear a key from inside their frame as it leaves the
 * frame, and one from the page itself — nothing focused — at the window. A key
 * from anywhere else on the page, a layer portaled out of the frame among it,
 * is never the canvas's: a key typed elsewhere never acts on it. And a control
 * in the frame keeps its own Space ({@link keepsSpace}): the Schematic's
 * canvas holds Space as its momentary Select only from itself, the page, or an
 * element that acts on none.
 *
 * @packageDocumentation
 */

/**
 * Whether a key comes from nowhere in particular — the page, its body, with nothing focused — and so passed through no
 * element of the frame: the window hears it for the canvas. One from inside the frame the frame hears as it leaves it,
 * and takes there (#1398).
 *
 * @param target - The key's target
 * @returns Whether it is the page's
 */
export function keyFromPage(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return true;
    const doc = target.ownerDocument;
    return target === doc.body || target === doc.documentElement;
}

/**
 * Whether a key the frame hears leave comes from the frame's own regions: never from a layer portaled out of it — a
 * popover, a menu, a Chooser's list — which is that layer's, as the frame leaves such a layer its Esc (`BuilderFrame`),
 * nor from another frame on the page. A key's way up the page's components runs through each portal to the part that
 * opened it, so the frame hears that layer's keys too: the page's own elements say whose they are.
 *
 * @param inside - An element of the frame: the canvas's
 * @param target - The key's target
 * @returns Whether the frame holds it
 */
export function keyInFrame(inside: Element | null, target: EventTarget | null): boolean {
    const frame = inside?.closest("[data-builder-frame]") ?? inside;
    return frame !== null && frame !== undefined && target instanceof Node && frame.contains(target);
}

/** What acts on Space itself: a control, a field, and every widget role's element. */
const OWN_SPACE = [
    "button", "a[href]", "input", "select", "textarea", "summary", "[contenteditable]:not([contenteditable=\"false\"])",
    ...["button", "checkbox", "radio", "switch", "tab", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "combobox", "slider",
        "spinbutton", "link", "textbox", "searchbox", "treeitem", "tree", "listbox", "grid", "gridcell", "radiogroup", "tablist", "menu",
        "menubar"].map((role) => `[role="${role}"]`),
].join(", ");

/**
 * Whether a key's target keeps its Space (#1398): a control a press of Space acts on — a button, a link, a field, a
 * checkbox, a radio, a Chooser's trigger, any widget role's element — as a browser activates a focused button on it. A
 * canvas holds Space as a momentary tool only from itself, from the page, or from an element that acts on none; from
 * a control in its frame it leaves Space to the control.
 *
 * @param target - The key's target
 * @param canvas - The canvas's element: its own Space is the canvas's
 * @returns Whether the target keeps its Space
 */
export function keepsSpace(target: EventTarget | null, canvas: Element | null): boolean {
    if (!(target instanceof Element) || target === canvas) return false;
    return target.closest(OWN_SPACE) !== null;
}
