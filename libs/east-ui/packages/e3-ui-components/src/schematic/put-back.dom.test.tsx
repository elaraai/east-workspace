/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic over racks read whole, through a Save another session puts
 * back exactly before the canvas reads the racks again (#1599), on e3 itself —
 * the check every builder runs (`shared/remote-rows.test-utils.ts`'
 * `putBackAfterSave`): a rack moved here and saved, moved back by another
 * session, stands where it stood before the Save, the Save never left saving
 * and nothing saved again. The racks are read whole: the Save is read back at
 * what the page holds of them once it has read them since e3 answered.
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { putBackAfterSave } from "../shared/remote-rows.test-utils.js";
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

test("schematicConflicts: a rack moved here and saved, moved back by another session before the canvas reads the racks again, stands where it stood before the Save — the Save never left saving, nothing asked, nothing left to save", async () => {
    const { container } = await h.mount(ex.schematicConflicts);
    await settle();
    await waitFor(() => expect(card(container, "racks", "A03")).not.toBeNull());
    hits(container);
    const canvas = container.querySelector<HTMLElement>("[data-schematic-canvas]")!;
    fireEvent.pointerEnter(canvas);
    const before = await h.read(ex.schematicConflictRacks);
    await putBackAfterSave({
        container,
        // A03 into the open floor to its right, clear of every other rack.
        change: [
            () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("radio", { name: "Move" })); },
            async () => {
                await act(async () => {
                    pointer(canvas, "pointerDown", 9.6, 2.9);
                    pointer(canvas, "pointerMove", 13.0, 2.9);
                    pointer(canvas, "pointerUp", 13.0, 2.9);
                });
            },
        ],
        // Where the canvas places each rack's card.
        look: () => RACKS.map(([key]) => [key, card(container, "racks", key)?.getAttribute("style") ?? null]),
        held: async () => [...(await h.read(ex.schematicConflictRacks))],
        savedThenPutBack: (save) => h.followed(ex.schematicConflictRacks, save, () => before),
    });
});
