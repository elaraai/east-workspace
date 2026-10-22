/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the Schematic's jsdom tests give its canvas that jsdom leaves out (#1401):
 * the box a page lays the canvas out in, pointer capture and the element at a
 * point; and the gestures and lookups they share — a world point on the canvas,
 * a tap there, and an item's card.
 *
 * @packageDocumentation
 */

import { afterEach, beforeEach } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { entityId } from "./canvas/drawn.js";

/** The box a page gives the canvas: 1080 × 540 px. */
const CANVAS = { clientWidth: 1080, clientHeight: 540 } as const;

/** The element at a point, as the page would hit it: what `document.elementFromPoint` answers. */
export type ElementAt = (x: number, y: number) => Element | null;

/**
 * Lays the canvas out for each of the file's tests: a box of 1080 × 540 px,
 * pointer capture, and the element at a point, which hits nothing until a test
 * says what it hits. An element scrolls into view, as the index scrolls to
 * what is selected, though jsdom scrolls nothing.
 *
 * @returns What says, for the test it is called in, which element a point hits
 */
export function layOutCanvas(): { hits: (elementAt: ElementAt) => void } {
    Element.prototype.scrollIntoView ??= function scrollIntoView() {};
    let elementAt: ElementAt = () => null;
    beforeEach(() => {
        for (const [name, px] of Object.entries(CANVAS)) {
            Object.defineProperty(HTMLElement.prototype, name, {
                configurable: true,
                get(this: HTMLElement) { return this.hasAttribute("data-schematic-canvas") ? px : 0; },
            });
        }
        Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
        Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, value: () => undefined });
        elementAt = () => null;
        (document as unknown as { elementFromPoint: ElementAt }).elementFromPoint = (x, y) => elementAt(x, y);
    });
    afterEach(() => {
        for (const name of [...Object.keys(CANVAS), "setPointerCapture", "releasePointerCapture"]) {
            delete (HTMLElement.prototype as unknown as { [name: string]: unknown })[name];
        }
        delete (document as unknown as { [name: string]: unknown })["elementFromPoint"];
    });
    return { hits: (find) => { elementAt = find; } };
}

/**
 * A world point on the canvas, in px from its corner — jsdom puts the canvas at
 * the page's — for a drawing of twice its height's width, which the canvas fits
 * exactly, the camera at rest.
 *
 * @param ppu - The canvas's px a world unit: its 1080 px over the drawing's width
 * @param x - The point's world x
 * @param y - The point's world y
 * @returns The pointer event's client coordinates
 */
export function at(ppu: number, x: number, y: number): { clientX: number; clientY: number } {
    return { clientX: x * ppu, clientY: y * ppu };
}

/**
 * A tap on the canvas at a world point: a press and a release where nothing moved.
 *
 * @param canvas - The canvas, `[data-schematic-canvas]`
 * @param ppu - The canvas's px a world unit
 * @param x - The point's world x
 * @param y - The point's world y
 */
export async function tap(canvas: Element, ppu: number, x: number, y: number): Promise<void> {
    await act(async () => {
        fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(ppu, x, y) });
        fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(ppu, x, y) });
    });
}

/**
 * An item's card, by its kind and key.
 *
 * @param container - What the Schematic is mounted in
 * @param kind - The item's kind's slot
 * @param key - The item's key
 * @returns Its card; `null` while it draws none
 */
export function card(container: HTMLElement, kind: string, key: string): HTMLElement | null {
    return container.querySelector<HTMLElement>(`[data-card-key=${JSON.stringify(entityId({ kind, key }))}]`);
}
