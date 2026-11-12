/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic's canvas under fingers, on e3 itself (`canvas/CLAUDE.md`
 * invariants 33 and 34): the fingers it holds (the shared pointer core's, east-ui-components' `src/pointer/`) and the
 * one gesture in flight.
 *
 * - A finger is gone as it lifts, as the browser takes it back, and as the
 *   canvas loses its capture — and, whatever a phone never says, as the next
 *   first finger lands or the window loses the page. One remembered past its
 *   end made every later finger a second one: a pinch that never ended, the
 *   canvas zooming under one finger until the page was loaded again.
 * - Every finger the canvas holds is captured by it, so its end is heard here
 *   whatever becomes of the element it landed on.
 * - A second finger starts a pinch, and what the first began is let go of,
 *   recording nothing: no marquee selects, no zoom box flies, no Move keeps its
 *   preview. A third starts nothing, and its lift taps nothing.
 * - A pinch keeps each finger on the point of the drawing it touched: drawn
 *   apart they zoom it, carried together they pan it. One in from a closer zoom
 *   that ends at the least zoom lands on Fit's camera as it ends; one begun at
 *   Fit leaves the drawing where its fingers carried it.
 * - The gesture in flight is its pointer's: another pointer's release ends
 *   none of it, and a mouse moved with no button held has let go of it.
 * - After any run of fingers put down, moved, lifted, taken back, lost and
 *   never heard of again, the next finger alone pans, and never zooms.
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin.
 */

import { expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { at, card, cameraOf, fitted, layOutCanvas, unsaved } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

const canvasLayout = layOutCanvas();

/** The camera the canvas fits the data centre's 28 × 14 m drawing with. */
const CAM = fitted(28, 14);

/** The racks that draw as cards at Fit, by key and centre in metres, each 3.2 m wide and 60 px tall as the canvas reckons it. */
const RACKS: readonly (readonly [key: string, x: number, y: number])[] = [
    ["A01", 2.4, 2.9], ["A02", 6.0, 2.9], ["A03", 9.6, 2.9], ["A04", 13.2, 2.9], ["A05", 16.8, 2.9],
];

/** The hot aisle's floor, clear of every item: a press there is on nothing. */
const FLOOR = { x: 10.0, y: 13.3 } as const;

/** The canvas. */
const canvasOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** Lets each rack's card answer anywhere in its box, as a page would hit it. */
function hits(container: HTMLElement) {
    const found = RACKS.flatMap(([key, x, y]) => {
        const el = card(container, "racks", key);
        if (el === null) return [];
        const { clientX, clientY } = at(CAM, x, y);
        return [[el, clientX, clientY, (3.2 * CAM.ppu) / 2, 30] as const];
    });
    canvasLayout.hits((px, py) => found.find(([, x, y, hw, hh]) => Math.abs(px - x) <= hw && Math.abs(py - y) <= hh)?.[0] ?? null);
}

/** Mounts the data centre, and waits until its racks are drawn and laid out for a press. */
async function open() {
    const ui = await h.mount(ex.schematicDataCentre);
    await settle();
    await waitFor(() => expect(card(ui.container, "racks", "A01")).not.toBeNull());
    hits(ui.container);
    fireEvent.pointerEnter(canvasOf(ui.container));
    return ui;
}

/** Picks a tool from the toolbar. */
async function tool(container: HTMLElement, name: string) {
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("radio", { name })); });
}

type FingerEvent = "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel" | "lostPointerCapture";

/**
 * A finger's event on the canvas, at a point in px from its corner. `primary` is what the browser says of it: down
 * while no other finger was on the page.
 */
function finger(canvas: Element, type: FingerEvent, id: number, x = 0, y = 0, primary = false) {
    const held = type === "pointerDown" || type === "pointerMove";
    fireEvent[type](canvas, { pointerId: id, pointerType: "touch", isPrimary: primary, button: 0, buttons: held ? 1 : 0, clientX: x, clientY: y });
}

/** A world point of the fitted drawing, in px from the canvas's corner. */
const px = (x: number, y: number) => { const p = at(CAM, x, y); return { x: p.clientX, y: p.clientY }; };

/** The frames a camera move waits on, drawn. */
async function frames() {
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}

/** One finger put down, dragged and lifted: a pan, where nothing is under it and the Select tool is held. */
async function dragFinger(canvas: Element, id: number, from: { x: number; y: number }, dx: number, dy: number, primary: boolean) {
    await act(async () => {
        finger(canvas, "pointerDown", id, from.x, from.y, primary);
        finger(canvas, "pointerMove", id, from.x + dx / 2, from.y + dy / 2);
        finger(canvas, "pointerMove", id, from.x + dx, from.y + dy);
        finger(canvas, "pointerUp", id, from.x + dx, from.y + dy);
    });
    await frames();
}

/** That one finger pans the drawing by its drag, and zooms it by nothing: where the camera stood, and where it stands. */
async function pansByOneFinger(container: HTMLElement, id: number, primary: boolean, what: string) {
    const before = cameraOf(container);
    await dragFinger(canvasOf(container), id, px(FLOOR.x, FLOOR.y), 60, -20, primary);
    const after = cameraOf(container);
    expect([after.ppu, Math.round(after.tx - before.tx), Math.round(after.ty - before.ty)], what).toEqual([before.ppu, 60, -20]);
}

/** The racks whose cards are selected. */
const selected = (container: HTMLElement) => RACKS.map(([key]) => key).filter((key) => card(container, "racks", key)?.hasAttribute("data-selected") === true);

// ── A finger's end ──────────────────────────────────────────────────────────

test("a finger the browser takes back is gone: the next finger alone pans the drawing, and zooms it by nothing", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    const p = px(FLOOR.x - 4, FLOOR.y);
    // A finger put down, which the system takes for a gesture of its own — an edge swipe, a palm — before it lifts.
    await act(async () => { finger(canvas, "pointerDown", 11, p.x, p.y, true); finger(canvas, "pointerCancel", 11, p.x, p.y); });
    // The next is no first finger of the page — another rests off the canvas — so nothing but the cancel lets go of the last.
    await pansByOneFinger(container, 12, false, "after a finger the browser took back");
});

test("a finger whose capture the canvas loses is gone: the next finger alone pans the drawing", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    const p = px(FLOOR.x - 4, FLOOR.y);
    await act(async () => { finger(canvas, "pointerDown", 13, p.x, p.y, true); finger(canvas, "lostPointerCapture", 13, p.x, p.y); });
    await pansByOneFinger(container, 14, false, "after a finger whose capture was lost");
});

test("a finger whose end the canvas never hears is let go of as the next first finger lands, and as the window loses the page", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    const p = px(FLOOR.x - 4, FLOOR.y);
    // Never lifted, as far as the canvas hears. The next finger is the page's first: no other is on it.
    await act(async () => { finger(canvas, "pointerDown", 15, p.x, p.y, true); });
    await pansByOneFinger(container, 16, true, "after a finger never heard of again, the next the page's first");
    // And one still held as the window loses the page: let go of there, so even a finger that is not the page's first pans.
    await act(async () => { finger(canvas, "pointerDown", 17, p.x, p.y, true); });
    await act(async () => { fireEvent.blur(window); });
    await pansByOneFinger(container, 18, false, "after the window lost the page");
});

test("every finger the canvas holds is captured by it: its end is heard here whatever becomes of what it landed on", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    const captured: (readonly [Element, number])[] = [];
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
        configurable: true, value(this: Element, id: number) { captured.push([this, id]); },
    });
    const a = px(FLOOR.x, FLOOR.y), b = px(16.8, 2.9);
    await act(async () => {
        finger(canvas, "pointerDown", 21, a.x, a.y, true);
        // The second lands on A05's card, which a zoom out takes from under it.
        finger(card(container, "racks", "A05")!, "pointerDown", 22, b.x, b.y);
        finger(canvas, "pointerUp", 22, b.x, b.y);
        finger(canvas, "pointerUp", 21, a.x, a.y);
    });
    expect(captured.map(([el, id]) => [el === canvas, id])).toEqual([[true, 21], [true, 22]]);
});

// ── A second finger, and a third ────────────────────────────────────────────

test("a second finger on the Marquee tool starts a pinch and lets go of the box: nothing is selected, and no box is left", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    await tool(container, "Marquee");
    const a = px(1, 1), b = px(18.5, 5);
    await act(async () => {
        finger(canvas, "pointerDown", 31, a.x, a.y, true);
        finger(canvas, "pointerMove", 31, a.x + 40, a.y + 40);
    });
    expect(canvas.querySelector("[data-mode='marquee']"), "the box, one finger down").not.toBeNull();
    await act(async () => { finger(canvas, "pointerDown", 32, b.x, b.y); });
    expect(canvas.querySelector("[data-mode='marquee']"), "the box, the second finger down").toBeNull();
    // The fingers lift, the second first: a box from where the first began to where the second lifted would hold the racks.
    await act(async () => { finger(canvas, "pointerUp", 32, b.x, b.y); finger(canvas, "pointerUp", 31, a.x + 40, a.y + 40); });
    await frames();
    expect(selected(container)).toEqual([]);
});

test("a second finger on the Zoom box tool starts a pinch and lets go of the box: the view flies nowhere as the fingers lift", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    await tool(container, "Zoom box");
    const a = px(1, 1), b = px(18.5, 5);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
        await act(async () => {
            finger(canvas, "pointerDown", 33, a.x, a.y, true);
            finger(canvas, "pointerMove", 33, a.x + 40, a.y + 40);
            finger(canvas, "pointerDown", 34, b.x, b.y);
            finger(canvas, "pointerUp", 34, b.x, b.y);
            finger(canvas, "pointerUp", 33, a.x + 40, a.y + 40);
            vi.advanceTimersByTime(20);
        });
        const rested = cameraOf(container);
        // Longer than a fly takes: one begun as a finger lifted would have landed.
        await act(async () => { vi.advanceTimersByTime(400); });
        expect(cameraOf(container)).toEqual(rested);
    } finally {
        vi.useRealTimers();
    }
});

test("a second finger during a Move starts a pinch and lets go of the Move: its preview goes, and nothing is recorded", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    await tool(container, "Move");
    const a04 = card(container, "racks", "A04")!.style.transform;
    const from = px(13.2, 2.9), to = px(13.2, 6.0), b = px(FLOOR.x, FLOOR.y);
    await act(async () => { finger(canvas, "pointerDown", 35, from.x, from.y, true); finger(canvas, "pointerMove", 35, to.x, to.y); });
    expect(card(container, "racks", "A04")!.style.transform, "the preview, one finger dragging").not.toBe(a04);
    await act(async () => { finger(canvas, "pointerDown", 36, b.x, b.y); });
    expect(card(container, "racks", "A04")!.style.transform, "the preview, the second finger down").toBe(a04);
    await act(async () => { finger(canvas, "pointerUp", 36, b.x, b.y); finger(canvas, "pointerUp", 35, to.x, to.y); });
    await settle();
    expect(card(container, "racks", "A04")!.style.transform).toBe(a04);
    expect(unsaved(container)).toBe(false);
});

test("a third finger starts nothing and its lift taps nothing, the pinch going on between the two held", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    const a = px(FLOOR.x, FLOOR.y), b = px(FLOOR.x + 4, FLOOR.y), c = px(16.8, 2.9);
    await act(async () => {
        finger(canvas, "pointerDown", 41, a.x, a.y, true);
        finger(canvas, "pointerDown", 42, b.x, b.y);
        // The third lands on A05, and lifts where it landed: a tap there would select it.
        finger(canvas, "pointerDown", 43, c.x, c.y);
        finger(canvas, "pointerUp", 43, c.x, c.y);
    });
    await frames();
    expect(selected(container)).toEqual([]);
    // The two held draw apart to twice their distance: the zoom doubles.
    const before = cameraOf(container);
    await act(async () => { finger(canvas, "pointerMove", 42, b.x + (b.x - a.x), b.y); });
    await frames();
    expect(cameraOf(container).ppu / before.ppu).toBeCloseTo(2, 6);
    await act(async () => { finger(canvas, "pointerUp", 42, b.x + (b.x - a.x), b.y); finger(canvas, "pointerUp", 41, a.x, a.y); });
    await frames();
    expect(selected(container)).toEqual([]);
});

// ── A pinch ─────────────────────────────────────────────────────────────────

/** The point of the drawing the canvas shows at a point of its box, in metres. */
const under = (container: HTMLElement, p: { x: number; y: number }) => {
    const cam = cameraOf(container);
    return { x: (p.x - cam.tx) / cam.ppu, y: (p.y - cam.ty) / cam.ppu };
};

test("a pinch keeps each finger on the point of the drawing it touched: one finger still, the other drawn away", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    const a = px(FLOOR.x, FLOOR.y), b = px(FLOOR.x + 4, FLOOR.y - 2);
    const b2 = { x: b.x + 150, y: b.y - 90 };
    await act(async () => { finger(canvas, "pointerDown", 61, a.x, a.y, true); finger(canvas, "pointerDown", 62, b.x, b.y); });
    const touched = [under(container, a), under(container, b)];
    const before = cameraOf(container);
    // In three moves, as a finger's drag arrives.
    await act(async () => {
        for (const t of [1 / 3, 2 / 3, 1]) finger(canvas, "pointerMove", 62, b.x + (b2.x - b.x) * t, b.y + (b2.y - b.y) * t);
    });
    await frames();
    const after = cameraOf(container);
    expect(after.ppu / before.ppu).toBeCloseTo(Math.hypot(b2.x - a.x, b2.y - a.y) / Math.hypot(b.x - a.x, b.y - a.y), 6);
    // The drawing turns for no pinch, so a finger drawn off the line through the two leaves its point by that turn alone:
    // the point midway between them is the one that holds, and the still finger's stays within the turn's reach of it.
    const mid = (p: { x: number; y: number }, q: { x: number; y: number }) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const held = under(container, mid(a, b2)), was = mid(touched[0]!, touched[1]!);
    expect([held.x, held.y].map((n) => n.toFixed(6))).toEqual([was.x, was.y].map((n) => n.toFixed(6)));
    await act(async () => { finger(canvas, "pointerUp", 62, b2.x, b2.y); finger(canvas, "pointerUp", 61, a.x, a.y); });
});

test("two fingers drawn apart along their line zoom the drawing under them: each stays on its point", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    const a = px(FLOOR.x, FLOOR.y), b = { x: a.x + 120, y: a.y };
    await act(async () => { finger(canvas, "pointerDown", 63, a.x, a.y, true); finger(canvas, "pointerDown", 64, b.x, b.y); });
    const touched = [under(container, a), under(container, b)];
    // One goes 30 left and the other 90 right, a move each: twice as far apart, their midpoint 30 right.
    const a2 = { x: a.x - 30, y: a.y }, b2 = { x: b.x + 90, y: b.y };
    await act(async () => { finger(canvas, "pointerMove", 63, a2.x, a2.y); finger(canvas, "pointerMove", 64, b2.x, b2.y); });
    await frames();
    for (const [i, now] of [a2, b2].entries()) {
        const at2 = under(container, now);
        expect([at2.x, at2.y].map((n) => n.toFixed(6)), `finger ${i + 1}`).toEqual([touched[i]!.x, touched[i]!.y].map((n) => n.toFixed(6)));
    }
    await act(async () => { finger(canvas, "pointerUp", 64, b2.x, b2.y); finger(canvas, "pointerUp", 63, a2.x, a2.y); });
});

test("two fingers carried together pan the drawing, its zoom as it was — and at Fit it stays where they carried it once they lift", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    const a = px(FLOOR.x, FLOOR.y), b = { x: a.x + 100, y: a.y + 40 };
    const before = cameraOf(container);
    await act(async () => {
        finger(canvas, "pointerDown", 65, a.x, a.y, true);
        finger(canvas, "pointerDown", 66, b.x, b.y);
        // Each finger 70 right and 25 up, one after the other, twice over.
        for (const t of [0.5, 1]) {
            finger(canvas, "pointerMove", 65, a.x + 70 * t, a.y - 25 * t);
            finger(canvas, "pointerMove", 66, b.x + 70 * t, b.y - 25 * t);
        }
    });
    await frames();
    const carried = cameraOf(container);
    expect(carried.ppu).toBeCloseTo(before.ppu, 9);
    expect([carried.tx - before.tx, carried.ty - before.ty].map((n) => n.toFixed(6))).toEqual([(70).toFixed(6), (-25).toFixed(6)]);
    await act(async () => { finger(canvas, "pointerUp", 66, b.x + 70, b.y - 25); finger(canvas, "pointerUp", 65, a.x + 70, a.y - 25); });
    await frames();
    // Begun at Fit: no zoom out to settle, the drawing where the fingers left it, as one finger's pan leaves it.
    expect(cameraOf(container)).toEqual(carried);
});

test("a pinch in from a closer zoom never zooms out past Fit, follows the fingers there, and lands on Fit's camera as it ends", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    const a = px(FLOOR.x, FLOOR.y), b = { x: a.x + 100, y: a.y };
    // Drawn apart to three times their distance: zoomed in.
    await act(async () => {
        finger(canvas, "pointerDown", 67, a.x, a.y, true);
        finger(canvas, "pointerDown", 68, b.x, b.y);
        finger(canvas, "pointerMove", 68, a.x + 300, a.y);
        finger(canvas, "pointerUp", 68, a.x + 300, a.y);
        finger(canvas, "pointerUp", 67, a.x, a.y);
    });
    await frames();
    expect(cameraOf(container).ppu / CAM.ppu).toBeCloseTo(3, 6);
    // Drawn together to a tenth of it, and carried 50 down meanwhile: the zoom stops at Fit's, and the drawing follows.
    await act(async () => {
        finger(canvas, "pointerDown", 69, a.x, a.y, true);
        finger(canvas, "pointerDown", 70, a.x + 300, a.y);
        finger(canvas, "pointerMove", 70, a.x + 30, a.y);
        finger(canvas, "pointerMove", 69, a.x, a.y + 50);
        finger(canvas, "pointerMove", 70, a.x + 30, a.y + 50);
    });
    await frames();
    const pinched = cameraOf(container);
    expect(pinched.ppu).toBeCloseTo(CAM.ppu, 9);
    expect([pinched.tx, pinched.ty]).not.toEqual([CAM.tx, CAM.ty]);
    // One finger lifts: the pinch is over at the least zoom, a full zoom out — Fit's camera, the drawing framed again.
    await act(async () => { finger(canvas, "pointerUp", 70, a.x + 30, a.y + 50); });
    await frames();
    expect(cameraOf(container)).toEqual({ ppu: CAM.ppu, tx: CAM.tx, ty: CAM.ty });
    await act(async () => { finger(canvas, "pointerUp", 69, a.x, a.y + 50); });
});

// ── The gesture in flight is its pointer's ──────────────────────────────────

test("another pointer's release ends none of a gesture: the marquee is its own pointer's to let go", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    await tool(container, "Marquee");
    const a = px(1, 1), b = px(18.5, 5), c = px(8, 5), far = px(27, 13.5);
    await act(async () => {
        fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: a.x, clientY: a.y });
        fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: b.x, clientY: b.y });
        // A finger pressed on one of the canvas's own buttons lifts over the canvas: no press of the canvas's, no release of it.
        finger(canvas, "pointerUp", 51, far.x, far.y);
    });
    await frames();
    // The box is in flight still: the finger's lift let go of nothing.
    expect(canvas.querySelector("[data-mode='marquee']"), "the box, another pointer released").not.toBeNull();
    // The mouse draws it back over A01 and A02 alone, and lets go there: what it holds is selected, as its own release left it.
    await act(async () => {
        fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: c.x, clientY: c.y });
        fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 0, clientX: c.x, clientY: c.y });
    });
    await frames();
    expect([canvas.querySelector("[data-mode='marquee']") !== null, selected(container)]).toEqual([false, ["A01", "A02"]]);
});

test("a mouse moved with no button held has let go where the canvas could not hear it: its pan is over", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    const from = px(FLOOR.x, FLOOR.y);
    const before = cameraOf(container);
    await act(async () => {
        fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: from.x, clientY: from.y });
        fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: from.x + 30, clientY: from.y });
    });
    await frames();
    expect(Math.round(cameraOf(container).tx - before.tx)).toBe(30);
    await act(async () => {
        fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 0, clientX: from.x + 60, clientY: from.y });
        fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 0, clientX: from.x + 90, clientY: from.y });
    });
    await frames();
    expect(Math.round(cameraOf(container).tx - before.tx)).toBe(30);
});

test("the window losing the page lets go of a Move in flight, recording nothing", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    await tool(container, "Move");
    const a05 = card(container, "racks", "A05")!.style.transform;
    const from = px(16.8, 2.9), to = px(16.8, 6.0);
    await act(async () => {
        fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: from.x, clientY: from.y });
        fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: to.x, clientY: to.y });
    });
    expect(card(container, "racks", "A05")!.style.transform).not.toBe(a05);
    await act(async () => { fireEvent.blur(window); });
    expect(card(container, "racks", "A05")!.style.transform).toBe(a05);
    await act(async () => { fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 0, clientX: to.x, clientY: to.y }); });
    await settle();
    expect(unsaved(container)).toBe(false);
});

// ── Whatever the fingers do ─────────────────────────────────────────────────

test("after any run of fingers put down, moved, lifted, taken back, lost and never heard of again, one finger pans the drawing and zooms it by nothing", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    // A seeded run, the same each time it is run.
    let seed = 20261112;
    const random = (n: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
    const point = () => ({ x: 40 + random(1000), y: 40 + random(460) });
    const ends = ["pointerUp", "pointerCancel", "lostPointerCapture", "never heard"] as const;
    let next = 100;
    for (let run = 0; run < 40; run++) {
        // The fingers on the page, as the page has them: what the canvas is told of each is the run's to choose.
        const down = new Map<number, { x: number; y: number }>();
        const told: string[] = [];
        for (let step = 0; step < 14; step++) {
            const ids = [...down.keys()];
            const choice = ids.length === 0 ? 0 : ids.length >= 3 ? 1 + random(2) : random(3);
            if (choice === 0) {
                const id = next++, p = point();
                told.push(`down ${id}`);
                await act(async () => { finger(canvas, "pointerDown", id, p.x, p.y, down.size === 0); });
                down.set(id, p);
            } else if (choice === 1) {
                const id = ids[random(ids.length)]!, p = point();
                told.push(`move ${id}`);
                await act(async () => { finger(canvas, "pointerMove", id, p.x, p.y); });
                down.set(id, p);
            } else {
                const id = ids[random(ids.length)]!, how = ends[random(ends.length)]!, p = down.get(id)!;
                told.push(`${how} ${id}`);
                if (how !== "never heard") await act(async () => { finger(canvas, how, id, p.x, p.y); });
                down.delete(id);
            }
        }
        // The page's fingers all lift, the canvas hearing of every other one.
        for (const [i, [id, p]] of [...down].entries()) {
            told.push(i % 2 === 0 ? `pointerUp ${id}` : `never heard ${id}`);
            if (i % 2 === 0) await act(async () => { finger(canvas, "pointerUp", id, p.x, p.y); });
        }
        await frames();
        // Esc, twice: what a finger never heard of again left in flight, then what the run's taps selected — a selected
        // run's end takes a press for its own drag, and the probe's is a press on nothing.
        await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); fireEvent.keyDown(window, { key: "Escape" }); });
        await pansByOneFinger(container, next++, true, `run ${run}: ${told.join(", ")}`);
    }
});
