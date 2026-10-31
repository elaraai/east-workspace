/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic's conflicts example, on e3 itself: a rack moved here, then
 * Someone else saves — every rack half a metre to the right — is one conflict
 * to choose, named by the rack, the rack wearing the ring until it is chosen.
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { conflictCards, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { at, card, fitted, layOutCanvas } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, and the hall's extent fits it.
const canvasLayout = layOutCanvas();
const CAM = fitted(18, 12);

/** The racks' cards where the hall draws them, 3.2 m wide and 60 px tall. */
const RACKS: readonly (readonly [key: string, x: number, y: number])[] = [["A01", 2.4, 2.9], ["A02", 6.0, 2.9], ["A03", 9.6, 2.9], ["B01", 2.4, 8.6], ["B02", 6.0, 8.6]];

function hits(container: HTMLElement) {
    const found = RACKS.flatMap(([key, x, y]) => {
        const el = card(container, "racks", key);
        if (el === null) return [];
        const { clientX, clientY } = at(CAM, x, y);
        return [[el, clientX, clientY, (3.2 * CAM.ppu) / 2, 30] as const];
    });
    canvasLayout.hits((px, py) => found.find(([, x, y, hw, hh]) => Math.abs(px - x) <= hw && Math.abs(py - y) <= hh)?.[0] ?? null);
}

/** A pointer event on the canvas at a world point. */
function pointer(canvas: Element, type: "pointerDown" | "pointerMove" | "pointerUp", x: number, y: number) {
    fireEvent[type](canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: type === "pointerUp" ? 0 : 1, ...at(CAM, x, y) });
}

test("a rack moved sideways here, then Someone else saves, is one conflict named by the rack, the rack wearing the ring until it is chosen", async () => {
    const { container } = await h.mount(ex.schematicConflicts);
    await settle();
    await waitFor(() => expect(card(container, "racks", "A03")).not.toBeNull());
    hits(container);
    const canvas = container.querySelector<HTMLElement>("[data-schematic-canvas]")!;
    fireEvent.pointerEnter(canvas);
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("radio", { name: "Move" })); });
    // A03 into the open floor to its right, clear of every other rack, whose cards a collision would fold away.
    await act(async () => {
        pointer(canvas, "pointerDown", 9.6, 2.9);
        pointer(canvas, "pointerMove", 13.0, 2.9);
        pointer(canvas, "pointerUp", 13.0, 2.9);
    });
    await settle();
    // Someone else's save puts every rack half a metre to the right: theirs and the move here differ.
    await act(async () => { fireEvent.click(within(container).getByRole("button", { name: "Someone else saves" })); });
    await settle();
    const [conflict, ...more] = await conflictCards(container);
    expect(more).toEqual([]);
    expect(conflict!.item).toBe("A03");
    expect(card(container, "racks", "A03")!.hasAttribute("data-conflict")).toBe(true);
    await act(async () => { fireEvent.click(conflict!.radio("source")); });
    await settle();
    expect(card(container, "racks", "A03")!.hasAttribute("data-conflict")).toBe(false);
});
