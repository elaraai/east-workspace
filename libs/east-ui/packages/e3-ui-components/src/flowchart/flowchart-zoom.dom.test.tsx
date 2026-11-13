/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart's zoom (#1519, `Flowchart Records Spec.md` R42), over the
 * depot's records on e3 itself (`flowchart.test-utils.tsx`): the toolbar's
 * Zoom out, Zoom in and Fit zoom the canvas through its handle, and the canvas
 * tells them where the zoom stands. jsdom lays nothing out, so main's size is
 * given where the canvas measures it, its body; what the zoom draws is read
 * off the canvas's own geometry — the drawing's size, the size of the box main
 * scrolls, and the scale between them. The depot draws its details on its
 * cards, five lanes of them, wider and taller than a main of 600 × 400. A
 * phone's main windows the lanes (R40): never more of them than the flow has.
 */

import { describe, expect, test, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { Data, Flowchart } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { enabled, flowchartHarness, press } from "./flowchart.test-utils.js";

const h = flowchartHarness();

/**
 * Gives main a size: the canvas's body measures it, every other element as
 * jsdom does. Until the test ends.
 *
 * @param width - Its width, px
 * @param height - Its height, px
 */
function mainOf(width: number, height: number): void {
    const client = { w: Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!.get!, h: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!.get! };
    const isBody = (element: Element) => element.hasAttribute("data-flowchart-body");
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
        return isBody(this) ? width : client.w.call(this) as number;
    });
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
        return isBody(this) ? height : client.h.call(this) as number;
    });
}

/** What the canvas draws: the drawing's own size, the box main scrolls at the zoom, the zoom between them, and the drawing's scale. */
function drawn(c: HTMLElement): { width: number; height: number; boxWidth: number; boxHeight: number; zoom: number; transform: string } {
    const box = c.querySelector<HTMLElement>("[data-flowchart-zoom-box]")!;
    const wrap = box.firstElementChild as HTMLElement;
    const width = parseFloat(wrap.style.width);
    const boxWidth = parseFloat(box.style.width);
    return { width, height: parseFloat(wrap.style.height), boxWidth, boxHeight: parseFloat(box.style.height), zoom: boxWidth / width, transform: wrap.style.transform };
}

/** Zoom out, Zoom in and Fit: whether each is on. */
const strip = (): boolean[] => ["Zoom out", "Zoom in", "Fit"].map(enabled);

describe("the zoom (R42)", () => {
    test("a flowchart larger than main opens at the cards' own size, Zoom in off; Zoom out draws it ×1.5 smaller; Fit puts the whole of it in main, its lanes filling it, Zoom out off; Zoom in steps back up to the cards' own size", async () => {
        mainOf(600, 400);
        const { container } = await h.mountExample(ex.flowchartDepot);
        await waitFor(() => expect(container.querySelector("[data-flowchart-node]")).not.toBeNull());

        // At the cards' own size: nothing scaled, the drawing larger than main both ways.
        let at = drawn(container);
        expect([at.zoom, at.transform]).toEqual([1, ""]);
        expect([at.width > 600 * 1.5 * 1.5, at.height > 400 * 1.5 * 1.5]).toEqual([true, true]);
        expect(strip()).toEqual([true, false, true]);

        // Zoom out: ×1.5 smaller, drawn scaled from its corner; both ways on.
        await press("Zoom out");
        at = drawn(container);
        expect(at.zoom).toBeCloseTo(1 / 1.5, 9);
        expect(at.transform).toBe(`scale(${1 / 1.5})`);
        expect(strip()).toEqual([true, true, true]);

        // Fit: the whole flowchart in main, laid out to fill it — its lanes across its width and down its height — Zoom out off.
        await press("Fit");
        at = drawn(container);
        expect(at.boxWidth).toBeLessThanOrEqual(600 + 1e-6);
        expect(at.boxHeight).toBeLessThanOrEqual(400 + 1e-6);
        expect([at.boxWidth > 600 - 5, at.boxHeight > 400 - 1]).toEqual([true, true]);
        expect(at.zoom).toBeLessThan(1 / 1.5);
        expect(strip()).toEqual([false, true, true]);
        const fit = at.zoom;

        // Zoom in: ×1.5 from Fit; and on up to the cards' own size, where it is off and nothing is scaled.
        await press("Zoom in");
        expect(drawn(container).zoom).toBeCloseTo(fit * 1.5, 9);
        for (let presses = 0; presses < 4 && enabled("Zoom in"); presses++) await press("Zoom in");
        at = drawn(container);
        expect([at.zoom, at.transform]).toEqual([1, ""]);
        expect(strip()).toEqual([true, false, true]);
    });

    test("a flowchart that fits main stands at Fit at the cards' own size: Zoom out and Zoom in off, Fit on and changing nothing", async () => {
        mainOf(4000, 3000);
        const { container } = await h.mountExample(ex.flowchartDepot);
        await waitFor(() => expect(container.querySelector("[data-flowchart-node]")).not.toBeNull());
        expect([drawn(container).zoom, drawn(container).transform]).toEqual([1, ""]);
        expect(strip()).toEqual([false, false, true]);
        await press("Fit");
        expect([drawn(container).zoom, drawn(container).transform]).toEqual([1, ""]);
        expect(strip()).toEqual([false, false, true]);
    });
});

describe("a phone's window of lanes (R40)", () => {
    test("a flow with fewer lanes than the window holds fills it, never ending at an empty slot: its one lane takes the whole of main's width, and no pager steps it", async () => {
        mainOf(324, 600);
        // One lane, every state in it.
        const lanes = await h.read(ex.depotLanes);
        await h.patch(ex.depotLanes, new Map([["sort", lanes.get("sort")!]]));
        const states = await h.read(ex.depotStates);
        await h.patch(ex.depotStates, new Map([...states].map(([key, state]) => [key, { ...state, phase: "sort" }] as const)));
        // Read whole, with no details on the cards: the window holds two lanes of a phone's 324.
        const { container } = await h.mountFlowchart(($) => {
            const stateRows = $.let(Data.bind(ex.depotStates));
            const laneRows = $.let(Data.bind(ex.depotLanes));
            return {
                states: Flowchart.states(stateRows, { label: "name", lane: "phase", order: "seq" }),
                lanes: Flowchart.lanes(laneRows, { label: "label", order: "seq" }),
            };
        });
        await waitFor(() => expect(container.querySelector("[data-flowchart-node]")).not.toBeNull());
        // The lane's header strip runs its band's width.
        const head = container.querySelector("[data-flowchart-lane-head='sort'] rect")!;
        expect(Number(head.getAttribute("width"))).toBe(324);
        expect(container.querySelector("[data-flowchart-lane-pager]")).toBeNull();
    });
});
