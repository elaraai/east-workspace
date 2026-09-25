/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * DOM test helpers for the drag layer (#608) — the seams it measures through,
 * faked: `document.elementFromPoint` (jsdom has no layout), the client rects a
 * keyboard drag steps between, and the live region it speaks through.
 */

import { act, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

type Rect = { left: number; top: number; width: number; height: number };

/** Point `document.elementFromPoint` at one element, wherever the point is. */
export function pointAt(el: Element | null): void {
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => el;
}

/**
 * Lay elements out: each gets a client rect, and `document.elementFromPoint`
 * answers from them — the first listed element whose rect holds the point.
 *
 * @param rects - Each element's rect, in client px
 */
export function layOut(rects: ReadonlyMap<Element, Rect>): void {
    for (const [el, r] of rects) {
        vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
            left: r.left, top: r.top, width: r.width, height: r.height,
            right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top,
            toJSON: () => ({}),
        } as DOMRect);
    }
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = (x, y) => {
        for (const [el, r] of rects) {
            if (el.isConnected && x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height) return el;
        }
        return null;
    };
}

/** jsdom has no `scrollIntoView`; the keyboard sensor scrolls the draggable into view. */
export function stubScrollIntoView(): void {
    Element.prototype.scrollIntoView ??= function scrollIntoView() {};
}

/**
 * A key, on the focused element — the keyboard sensor reads `code`.
 *
 * @param code - The key's `code` (`"Space"`, `"ArrowRight"`, `"Escape"`)
 */
export function press(code: string): void {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: code === "Space" ? " " : code, code });
}

/** The keyboard sensor starts listening on the next task. */
export const tick = (): Promise<void> => act(() => new Promise<void>((resolve) => { setTimeout(resolve, 0); }));

/** What the drag layer last said to a screen reader. */
export function announced(): string {
    return document.querySelector("[id^='DndLiveRegion']")?.textContent ?? "";
}
