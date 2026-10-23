/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic's lit link on e3 itself (#1403, `Schematic Builder Spec.md`
 * §4.3): the run under the pointer lights — the canvas names it in
 * `data-lit-link`, and paints it last, in the strong ink, its ends ringed — and
 * nothing opens on dwell (invariant 12). The pointer over nothing lights
 * nothing, nor over an item drawn over a run — a tap there selects the item —
 * leaving the canvas lets the lit run go, and while a press's gesture is
 * under way nothing lights. Which run is under the pointer is read from the
 * links' R-tree, never every link (`selection.test.ts`).
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin.
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { entityId } from "./canvas/drawn.js";
import { at, card, fitted, layOutCanvas } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
layOutCanvas();

/** The camera the canvas fits the data centre's 28 × 14 m drawing with. */
const CAM = fitted(28, 14);

/** u1, A01's uplink: it runs down from A01's foot to ODF-1's top, along x = 2.4 m. */
const U1 = entityId({ kind: "fibre", key: "u1" });

/** A point on u1's line, midway down. */
const ON_U1 = [2.4, 6.0] as const;

/** A point of the floor nothing is drawn on: between the network room and the hot aisle, east of the cooling units. */
const BARE = [20.0, 12.3] as const;

/** The canvas. */
const canvasOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** The run the canvas names lit, by its id; `null` while none is. */
const litOf = (container: HTMLElement) => canvasOf(container).getAttribute("data-lit-link");

/** Mounts the data centre, waits until its racks are drawn, and puts the pointer over its canvas. */
async function open() {
    const ui = await h.mount(ex.schematicDataCentre);
    await settle();
    await waitFor(() => expect(card(ui.container, "racks", "A01")).not.toBeNull());
    fireEvent.pointerEnter(canvasOf(ui.container));
    return ui;
}

/** A pointer event on the canvas at a world point: no button held, unless one is pressed. */
function pointer(canvas: Element, type: "pointerDown" | "pointerMove" | "pointerUp", x: number, y: number, held = false) {
    fireEvent[type](canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: held ? 1 : 0, ...at(CAM, x, y) });
}

test("the run under the pointer lights — the canvas names it — over nothing nothing is lit, and leaving the canvas lets it go (#1403)", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    expect(litOf(container)).toBeNull();
    await act(async () => { pointer(canvas, "pointerMove", ...ON_U1); });
    expect(litOf(container)).toBe(U1);
    await act(async () => { pointer(canvas, "pointerMove", ...BARE); });
    expect(litOf(container)).toBeNull();
    // Back over it, then off the canvas.
    await act(async () => { pointer(canvas, "pointerMove", ...ON_U1); });
    expect(litOf(container)).toBe(U1);
    await act(async () => { fireEvent.pointerLeave(canvas); });
    expect(litOf(container)).toBeNull();
});

test("while a press's gesture is under way nothing lights — a pan held over a run — and the next move with no button lights it again (#1403)", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    await act(async () => { pointer(canvas, "pointerMove", ...ON_U1); });
    expect(litOf(container)).toBe(U1);
    // A press on the run is a gesture: it lets the run go; a pan drags the floor with the pointer, the run under it still.
    await act(async () => { pointer(canvas, "pointerDown", ...ON_U1, true); });
    expect(litOf(container)).toBeNull();
    await act(async () => { pointer(canvas, "pointerMove", ON_U1[0] + 0.5, ON_U1[1], true); });
    expect(litOf(container)).toBeNull();
    await act(async () => { pointer(canvas, "pointerUp", ON_U1[0] + 0.5, ON_U1[1]); });
    await act(async () => { pointer(canvas, "pointerMove", ON_U1[0] + 0.5, ON_U1[1]); });
    expect(litOf(container)).toBe(U1);
});

test("an item drawn over a run keeps it unlit, as a tap there selects the item: u1 passes beside PDU-A, under its pin (#1403)", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    // At Fit PDU-A's 1.2 m holds no card's words: it draws as its pin, its dot on PDU-A and its words east of it, over u1.
    expect(card(container, "pdus", "PDU-A")).toBeNull();
    await act(async () => { pointer(canvas, "pointerMove", 2.4, 4.2); });
    expect(litOf(container)).toBeNull();
    // Further down u1, clear of every item: lit.
    await act(async () => { pointer(canvas, "pointerMove", ...ON_U1); });
    expect(litOf(container)).toBe(U1);
});
