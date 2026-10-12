/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A combobox's list closed on a touch screen when the focus moves to anything
 * outside it (#1228), as Zag closes it on a desktop.
 *
 * Zag closes an open list when the focus moves outside it only on a device
 * without touch: `@zag-js/interact-outside` listens for `focusin` on the
 * document, in the capture phase, only `if (!isTouchDevice())`, and the
 * combobox handles no blur while its list is open. On a touch screen, ⏎
 * handing the focus on (a sheet's rail search hands it to the sheet), Tab on
 * an attached keyboard, or a host moving the focus by script left the list
 * open over what lay under it, until a tap outside.
 *
 * So on a touch screen — only there, told as Zag tells one
 * ({@link isTouchDevice}) — the combobox hears what Zag hears on a desktop:
 * while its list is open, a `focusin` on its box's document, in the capture
 * phase. A focus moved while a pointer is down is the pointer's, as Zag
 * leaves it (`isPointerDown`), and a frame later, as Zag looks (`defer`), a
 * focus moved outside ({@link isFocusOutside}) closes the list as Zag's
 * outside interaction would (`LAYER.INTERACT_OUTSIDE`): text no item holds
 * reverted where custom values are refused ({@link closedText}). A tap
 * outside stays Zag's own dismissal: its tap closes the list first, and a
 * close by any way stops the listening, the frame's look with it. A blur to
 * nothing — the phone's keyboard dismissed, the page losing the focus, a
 * script's `blur()` — moves the focus to nothing, so it closes nothing, as
 * on a desktop; a focus moved outside after it still does. On any other
 * device Zag's own close runs, untouched.
 *
 * A pointer is down from its `pointerdown` until its `pointerup` or its
 * `pointercancel`. Zag waits for the `pointerup` alone, its focus path never
 * running on a touch screen; there a touch that pans the page ends in
 * `pointercancel`, and the focus would never be heard again.
 *
 * Every way Zag closes an open list but an outside interaction puts the focus
 * back in the box (its `setFinalFocus`, which a controlled `open` takes too),
 * which would take it from where it went; so the combobox's root is keyed by
 * `epoch`, and the close starts it again, closed, with the focus where it
 * went. A focus back in the combobox by the time it looks — Zag's own
 * `setInitialFocus` takes it into the box a frame after the list opens —
 * stays in it, as Zag's outside interaction leaves it: in the box started
 * again. The listening stops when the list closes, by any way, and when the
 * box goes.
 *
 * A combobox that keeps text no item holds (`allowCustomValue`: the rail's
 * search, and the key search, which also `preserve`s its query) reverts
 * nothing on any device; only one that refuses it does, as Zag's does.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { StringType, equalFor } from "@elaraai/east";

const stringEqual = equalFor(StringType);

/**
 * Whether this is a touch device as Zag tells one: `@zag-js/dom-query`'s
 * `isTouchDevice`, mirrored exactly (dist/platform.mjs:
 * `isDom() && !!navigator.maxTouchPoints`, where `isDom` is
 * `typeof document !== "undefined"`). Only on one does
 * `@zag-js/interact-outside` leave a focus moved outside an open list unheard.
 *
 * @returns Whether the device has touch, as Zag reads it
 */
export function isTouchDevice(): boolean {
    return typeof document !== "undefined" && !!navigator.maxTouchPoints;
}

/** How a combobox treats its box's text on a pick, and on an outside close: Zag's `selectionBehavior`. */
export type ComboboxSelectionBehavior = "replace" | "preserve" | "clear";

/**
 * The box's text once an outside interaction closes the list, as Zag leaves it
 * (`LAYER.INTERACT_OUTSIDE` in `@zag-js/combobox`'s machine). Text no item
 * holds — not the selected items' labels (`isCustomValue`) — where custom
 * values are refused (not `allowCustomValue`) is reverted (`revertInputValue`)
 * by the root's `selectionBehavior`: to the selected items' labels
 * (`replace`, "" with none selected), kept (`preserve`), or emptied (`clear`).
 * Any other text stays.
 *
 * @param text - The box's text
 * @param selected - The selected items' labels, joined as Zag joins them (its collection's `stringifyMany`): "" with none
 * @param behavior - The root's `selectionBehavior`
 * @param allowCustomValue - Whether the root keeps text no item holds
 * @returns The box's text after the close
 */
export function closedText(text: string, selected: string, behavior: ComboboxSelectionBehavior, allowCustomValue: boolean): string {
    if (stringEqual(text, selected) || allowCustomValue) return text;
    switch (behavior) {
        case "replace": return selected;
        case "preserve": return text;
        case "clear": return "";
    }
}

/** Whether `target` is an element, as Zag tells one (`@zag-js/dom-query`'s `isHTMLElement`: a node of the element type). */
function isElement(target: EventTarget | null): target is Element {
    return target !== null && (target as Partial<Node>).nodeType === Node.ELEMENT_NODE;
}

/**
 * Whether a focus moved to `target` is outside the combobox whose box is
 * `box`, as Zag's dismissable layer tells it on a desktop (`isEventOutside`
 * in `@zag-js/interact-outside`, with the `exclude` of `@zag-js/combobox`'s
 * `trackDismissableLayer`): an element still in the page, not in the list
 * (the box's `aria-controls`, wherever it is portalled), and not the box, the
 * trigger or the clear trigger. Zag's tests of a pointer — its point within
 * the list, on a scrollbar — are no focus's, and none of these comboboxes
 * opens a layer of its own over its list.
 *
 * @param box - The combobox's box
 * @param target - What the focus moved to
 * @returns Whether it is outside
 */
export function isFocusOutside(box: HTMLInputElement, target: EventTarget | null): boolean {
    if (!isElement(target) || !target.isConnected) return false;
    const listId = box.getAttribute("aria-controls");
    const list = listId === null ? null : box.ownerDocument.getElementById(listId);
    if (list?.contains(target) === true) return false;
    const root = box.closest('[data-scope="combobox"][data-part="root"]');
    const excluded = [
        box,
        root?.querySelector('[data-scope="combobox"][data-part="trigger"]'),
        root?.querySelector('[data-scope="combobox"][data-part="clear-trigger"]'),
    ];
    return !excluded.some((part) => part?.contains(target) === true);
}

/** What {@link useListClosesOnFocusOutside} gives a combobox. */
export interface ListClosesOnFocusOutside {
    /** The combobox root's `key`: a new one starts it again, closed. */
    epoch: number;
    /** The root's `onOpenChange`: while its list is open, on a touch screen, the focus is heard. */
    onOpenChange: (details: { open: boolean }) => void;
    /** The box's `ref`. */
    box: (element: HTMLInputElement | null) => void;
}

/**
 * Closes a combobox's list on a touch screen when the focus moves to anything
 * outside it — see the module docs.
 *
 * @param onClose - Told when it closes the list, to do what else Zag's outside interaction does — revert the box's text ({@link closedText}) and tell the host of the close: Zag, started again, says nothing of it
 * @returns The root's key and its `onOpenChange`, and the box's `ref`
 */
export function useListClosesOnFocusOutside(onClose?: () => void): ListClosesOnFocusOutside {
    const [epoch, setEpoch] = useState(0);
    const boxEl = useRef<HTMLInputElement | null>(null);
    const unwatch = useRef<(() => void) | null>(null);
    // Whether the focus was back in the combobox when it last closed it.
    const refocus = useRef(false);
    // The close a frame after a focus reads what the box holds then, not when the list opened.
    const closed = useRef(onClose);
    useLayoutEffect(() => { closed.current = onClose; });
    // The box started again takes a focus that was back in the combobox when it closed.
    useLayoutEffect(() => { if (refocus.current) boxEl.current?.focus({ preventScroll: true }); }, [epoch]);

    const stop = useCallback(() => {
        unwatch.current?.();
        unwatch.current = null;
    }, []);

    const onOpenChange = useCallback((details: { open: boolean }) => {
        stop();
        const input = boxEl.current;
        if (!details.open || input === null || !isTouchDevice()) return;
        const doc = input.ownerDocument;
        const win = doc.defaultView;
        if (win === null) return;
        let pointerDown = false;
        const frames = new Set<number>();
        const later = (run: () => void) => { const frame = win.requestAnimationFrame(() => { frames.delete(frame); run(); }); frames.add(frame); };
        const down = () => { pointerDown = true; };
        const up = () => { pointerDown = false; };
        const focusIn = (event: FocusEvent) => {
            if (pointerDown) return;
            const target = event.composedPath()[0] ?? event.target;
            later(() => {
                if (!isFocusOutside(input, target)) return;
                stop();
                refocus.current = doc.activeElement !== null && !isFocusOutside(input, doc.activeElement);
                setEpoch((n) => n + 1);
                closed.current?.();
            });
        };
        doc.addEventListener("pointerdown", down, true);
        doc.addEventListener("pointerup", up, true);
        doc.addEventListener("pointercancel", up, true);
        doc.addEventListener("focusin", focusIn, true);
        unwatch.current = () => {
            doc.removeEventListener("pointerdown", down, true);
            doc.removeEventListener("pointerup", up, true);
            doc.removeEventListener("pointercancel", up, true);
            doc.removeEventListener("focusin", focusIn, true);
            for (const frame of frames) win.cancelAnimationFrame(frame);
        };
    }, [stop]);

    const box = useCallback((element: HTMLInputElement | null) => {
        if (element === null) stop();
        boxEl.current = element;
    }, [stop]);

    return { epoch, onOpenChange, box };
}
