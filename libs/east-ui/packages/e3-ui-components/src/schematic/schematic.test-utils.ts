/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the Schematic's jsdom tests give its canvas that jsdom leaves out (#1401):
 * the box a page lays the canvas out in, pointer capture and the element at a
 * point; and the gestures and lookups they share — the camera the canvas fits
 * a drawing with and the one it stands at, a world point on the canvas, a tap
 * there, a zoom into a box, an item's card, whether changes wait on Save and
 * the drawing's counts.
 *
 * @packageDocumentation
 */

import { afterEach, beforeEach, vi } from "vitest";
import { act, fireEvent, within } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import { slot } from "../e3-web-mount.test-utils.js";
import { fitView, project, type ScreenCamera } from "./canvas/camera.js";
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
 * The camera the canvas stands at once it has fitted a drawing (#1393): the
 * drawing's extent inside the canvas's 1080 × 540 px less Fit's margin, and
 * centred — as the canvas fits it (`fitView`).
 *
 * @param width - The drawing's extent's width, in world units
 * @param height - Its height
 * @returns The camera: px a world unit, and where the world's origin stands on the canvas
 */
export function fitted(width: number, height: number): ScreenCamera {
    const { fit, home } = fitView(CANVAS.clientWidth, CANVAS.clientHeight, width, height);
    return { ppu: fit * home.zoom, tx: home.tx, ty: home.ty };
}

/**
 * The camera the canvas stands at now, as its card layer carries it — what a
 * test that zooms or flies taps through.
 *
 * @param container - What the Schematic is mounted in
 * @returns The camera
 * @throws {Error} While the canvas has no size to lay its cards out in
 */
export function cameraOf(container: HTMLElement): ScreenCamera {
    const layer = container.querySelector<HTMLElement>("[data-schematic-cards]");
    if (layer === null) throw new Error("the canvas lays out no cards: it has no size yet");
    const read = (name: string) => Number.parseFloat(layer.style.getPropertyValue(name));
    return { ppu: read("--cam-ppu"), tx: read("--cam-tx"), ty: read("--cam-ty") };
}

/**
 * A world point on the canvas, in px from its corner — jsdom puts the canvas at
 * the page's — under a camera.
 *
 * @param cam - The camera: the one the canvas fits the drawing with ({@link fitted}), or the one it stands at ({@link cameraOf})
 * @param x - The point's world x
 * @param y - The point's world y
 * @returns The pointer event's client coordinates
 */
export function at(cam: ScreenCamera, x: number, y: number): { clientX: number; clientY: number } {
    const { sx, sy } = project(x, y, cam);
    return { clientX: sx, clientY: sy };
}

/**
 * Whether a point on the canvas lies within 4 px of a world point under a
 * camera: where a page hits what is drawn there.
 *
 * @param cam - The camera
 * @param px - The point's x, in px from the canvas's corner
 * @param py - Its y
 * @param x - The world point's x
 * @param y - Its y
 * @returns Whether it lies within 4 px
 */
export function near(cam: ScreenCamera, px: number, py: number, x: number, y: number): boolean {
    const { sx, sy } = project(x, y, cam);
    return Math.hypot(px - sx, py - sy) < 4;
}

/**
 * A tap on the canvas at a world point: a press and a release where nothing moved.
 *
 * @param canvas - The canvas, `[data-schematic-canvas]`
 * @param cam - The camera the canvas stands at
 * @param x - The point's world x
 * @param y - The point's world y
 */
export async function tap(canvas: Element, cam: ScreenCamera, x: number, y: number): Promise<void> {
    await act(async () => {
        fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(cam, x, y) });
        fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(cam, x, y) });
    });
}

/** Longer than a fly takes (350 ms): run on the test's clock, it lands. */
const FLY_MS = 400;

/**
 * Zooms into a world box as a viewer does: Ctrl held over the canvas holds the
 * Zoom box tool, a drag from the box's one corner to the other flies the view
 * to it, and the fly runs on the test's clock, so it lands however busy the
 * machine running it is. The tool held stays the one it was.
 *
 * @param canvas - The canvas, `[data-schematic-canvas]`
 * @param cam - The camera the canvas stands at
 * @param box - The box, in world units
 */
export async function zoomInto(canvas: Element, cam: ScreenCamera, box: { minX: number; minY: number; maxX: number; maxY: number }): Promise<void> {
    fireEvent.pointerEnter(canvas);
    await act(async () => { fireEvent.keyDown(window, { key: "Control", ctrlKey: true }); });
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
        await act(async () => {
            fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(cam, box.minX, box.minY) });
            fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, ...at(cam, box.maxX, box.maxY) });
            fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(cam, box.maxX, box.maxY) });
        });
        await act(async () => { vi.advanceTimersByTime(FLY_MS); });
    } finally {
        vi.useRealTimers();
    }
    await act(async () => { fireEvent.keyUp(window, { key: "Control" }); });
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

/**
 * Whether changes wait on Save, as the history says it (#1388): its Discard,
 * which drops them, is on. The footer says nothing of them (ruled 23 Oct 2026).
 *
 * @param container - What the Schematic is mounted in: one that edits, its history in the toolbar
 * @returns Whether the history holds changes not yet saved
 */
export function unsaved(container: HTMLElement): boolean {
    return !within(slot(container, "toolbar")).getByRole<HTMLButtonElement>("button", { name: editingMessages.discard() }).disabled;
}

/**
 * The drawing's counts, as the inspector's Details says them with nothing
 * selected (#1391): each count, by what it counts — an item kind's slot,
 * `zones`, `links` or `nets`.
 *
 * @param container - What the Schematic is mounted in: one given `inspector`, nothing selected
 * @returns Each count, as Details prints it
 * @throws {Error} When Details shows something else than the drawing
 */
export function drawingCounts(container: HTMLElement): Record<string, string> {
    const counts = slot(container, "end").querySelector("[role='tabpanel']:not([hidden]) [data-schematic-inspector='drawing'] [data-inspector-counts]");
    if (counts === null) throw new Error("the inspector's Details shows no drawing: something is selected, or it is on another tab");
    return Object.fromEntries([...counts.querySelectorAll("[data-count]")].map((el) => [el.getAttribute("data-count") ?? "", el.children[0]?.textContent ?? ""]));
}
