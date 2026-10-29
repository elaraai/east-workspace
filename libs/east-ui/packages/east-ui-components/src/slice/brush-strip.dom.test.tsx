/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

/**
 * The horizon brush (#1438) as the strip draws it: its layers — the band,
 * the baseline, the bars on the heat ramp dimmed outside the window and whole
 * inside it — its states, its three stops and their keys, the hover's
 * Tooltip, and a narrow window's zones. Geometry is the brush-math's (its own
 * tests); what lands on the page is checked in a browser by the showcase's
 * `plan-geometry.spec.ts`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme/index.js";
import { declaredStyle } from "../testing/styles.js";
import { BrushStrip, type BrushBucket, type BrushStripProps } from "./brush-strip.js";

/** The track's width as the page would lay it out: 400px. */
const TRACK_PX = 400;

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

beforeEach(() => {
    globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
    const was = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        if (!this.hasAttribute("data-brush-track")) return was.call(this);
        return { left: 0, top: 0, right: TRACK_PX, bottom: 32, width: TRACK_PX, height: 32, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** Eight buckets of 50px, their counts given, each its hover's words. */
const eight = (counts: readonly number[]): BrushBucket[] =>
    counts.map((count, i) => ({ from: i / 8, to: (i + 1) / 8, count, label: `Bucket ${i + 1} · ${count} items` }));

function strip(props: Partial<BrushStripProps> = {}) {
    const onCommit = vi.fn();
    const onClear = vi.fn();
    const view = render(
        <ChakraProvider value={system}>
            <BrushStrip buckets={() => eight([10, 20, 0, 40, 30, 20, 10, 5])} window={{ from: 0.25, to: 0.5 }} nowFrac={0.4}
                height={32} barHeight={28} onCommit={onCommit} onClear={onClear} step={(f, n) => f + n / 8}
                valueText={(f) => `at ${f}`} {...props} />
        </ChakraProvider>,
    );
    const q = (sel: string) => view.container.querySelectorAll<HTMLElement>(sel);
    const track = q("[data-brush-track]")[0]!;
    return { view, q, track, onCommit, onClear };
}

describe("the horizon brush's layers (#1438)", () => {
    test("the band behind the bars, the baseline under them, nothing masking outside the window", () => {
        const { q } = strip();
        expect(q("[data-brush-band]")).toHaveLength(1);
        expect([declaredStyle(q("[data-brush-band]")[0]!, "left"), declaredStyle(q("[data-brush-band]")[0]!, "width")]).toEqual(["25%", "25%"]);
        expect(q("[data-brush-baseline]")).toHaveLength(1);
        expect(q("[data-brush-mask]")).toHaveLength(0);
        expect(declaredStyle(q("[data-brush-now]")[0]!, "left")).toBe("40%");
    });

    test("each bucket counting anything a bar, toned on the heat ramp by its count, at 0.45 outside the window and whole on a layer clipped to it", () => {
        const { q } = strip();
        const [all, inside] = [...q("[data-brush-bars]")];
        expect(all!.hasAttribute("data-dim")).toBe(true);
        expect(inside!.getAttribute("data-brush-bars")).toBe("in");
        expect(declaredStyle(inside!, "clip-path")).toBe("inset(0 50% 0 25%)");
        // Seven buckets count something; the third counts nothing and draws no bar.
        const bars = [...all!.querySelectorAll<HTMLElement>("[data-brush-bar]")];
        expect(bars.map((b) => b.getAttribute("data-step"))).toEqual(["2", "3", "5", "4", "3", "2", "1"]);
        expect(bars.map((b) => declaredStyle(b, "left"))).toEqual(["0px", "50px", "150px", "200px", "250px", "300px", "350px"]);
        expect(bars.map((b) => declaredStyle(b, "width"))).toEqual(Array.from({ length: 7 }, () => "48px"));
        expect(bars.map((b) => declaredStyle(b, "height"))).toEqual(["7px", "14px", "28px", "21px", "14px", "7px", "4px"]);
        expect(inside!.querySelectorAll("[data-brush-bar]")).toHaveLength(7);
    });

    test("with no window: no band, no handles, and every bar at full strength on one layer", () => {
        const { q } = strip({ window: undefined });
        expect(q("[data-brush-band]")).toHaveLength(0);
        expect(q("[data-brush-handle]")).toHaveLength(0);
        expect(q("[data-brush-bars]")).toHaveLength(1);
        expect(q("[data-brush-bars]")[0]!.hasAttribute("data-dim")).toBe(false);
    });

    test("while the counts are read, the baseline alone, the window and its handles live", () => {
        const { q, track } = strip({ buckets: () => "loading" });
        expect(track.getAttribute("data-state")).toBe("loading");
        expect(q("[data-brush-bar]")).toHaveLength(0);
        expect(q("[data-brush-baseline]")).toHaveLength(1);
        expect(q("[data-brush-handle]")).toHaveLength(2);
    });

    test("nothing counted, or no counts at all: the baseline alone", () => {
        expect(strip({ buckets: () => eight([0, 0, 0, 0, 0, 0, 0, 0]) }).track.getAttribute("data-state")).toBe("empty");
        cleanup();
        const { q, track } = strip({ buckets: undefined });
        expect(track.getAttribute("data-state")).toBe("empty");
        expect(q("[data-brush-bar]")).toHaveLength(0);
    });
});

describe("the horizon brush's stops and keys (#1438)", () => {
    test("three sliders in tab order — the start handle, the window, the end handle — each saying where it is", () => {
        const { q } = strip();
        const stops = [...q("[tabindex='0']")];
        expect(stops.map((s) => [s.getAttribute("role"), s.getAttribute("aria-label"), s.getAttribute("aria-valuetext")])).toEqual([
            ["slider", "Window start", "at 0.25"],
            ["slider", "Window", "at 0.25 – at 0.5"],
            ["slider", "Window end", "at 0.5"],
        ]);
    });

    test("an arrow moves a handle a period, Shift ten, Home and End go to the track's ends, and Escape clears the range", () => {
        const { q, onCommit, onClear } = strip();
        const [lo, win, hi] = [...q("[tabindex='0']")];
        fireEvent.keyDown(lo!, { key: "ArrowRight" });
        expect(onCommit).toHaveBeenLastCalledWith(0.375, 0.5);
        fireEvent.keyDown(hi!, { key: "ArrowRight", shiftKey: true });
        expect(onCommit).toHaveBeenLastCalledWith(0.25, 1);
        fireEvent.keyDown(win!, { key: "End" });
        expect(onCommit).toHaveBeenLastCalledWith(0.75, 1);
        fireEvent.keyDown(win!, { key: "ArrowLeft" });
        expect(onCommit).toHaveBeenLastCalledWith(0.125, 0.375);
        fireEvent.keyDown(lo!, { key: "Escape" });
        expect(onClear).toHaveBeenCalledTimes(1);
        // A key the brush does not take does nothing.
        onCommit.mockClear();
        fireEvent.keyDown(win!, { key: "Enter" });
        expect(onCommit).not.toHaveBeenCalled();
    });

    test("a key's window lands where the host snaps it, and one the host snaps back where it was commits nothing", () => {
        const { q, onCommit } = strip({ snapWindow: () => ({ from: 0.25, to: 0.5 }) });
        fireEvent.keyDown(q("[tabindex='0']")[0]!, { key: "ArrowRight" });
        expect(onCommit).not.toHaveBeenCalled();
    });
});

describe("the horizon brush's hover and gestures (#1438)", () => {
    test("a mouse over a bucket shows its Tooltip — its bucket, then its count — which hides while a gesture is in hand", () => {
        const { track } = strip();
        fireEvent.pointerMove(track, { clientX: 220, pointerType: "mouse" });
        expect(document.querySelector("[data-brush-tip]")?.textContent).toBe("Bucket 5 · 30 items");
        // The anchor is the bucket's slot, which the Tooltip stands above.
        const anchor = track.querySelector<HTMLElement>("[data-brush-anchor]")!;
        expect([declaredStyle(anchor, "left"), declaredStyle(anchor, "width")]).toEqual(["50%", "12.5%"]);
        fireEvent.pointerDown(track, { clientX: 220, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 260, pointerId: 1, buttons: 1, pointerType: "mouse" });
        expect(document.querySelector("[data-brush-tip]")).toBeNull();
        fireEvent.pointerUp(track, { pointerId: 1 });
        fireEvent.pointerMove(track, { clientX: 20, pointerType: "mouse" });
        expect(document.querySelector("[data-brush-tip]")?.textContent).toBe("Bucket 1 · 10 items");
        fireEvent.pointerLeave(track, { pointerType: "mouse" });
        expect(document.querySelector("[data-brush-tip]")).toBeNull();
    });

    test("a touch shows no Tooltip", () => {
        const { track } = strip();
        fireEvent.pointerMove(track, { clientX: 220, pointerType: "touch" });
        expect(document.querySelector("[data-brush-tip]")).toBeNull();
    });

    test("a resize presses the handle it drags, which a drag past the other edge swaps", () => {
        const { q, track } = strip();
        fireEvent.pointerDown(track, { clientX: 100, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 140, pointerId: 1, buttons: 1 });
        expect(q("[data-brush-handle][data-pressed]")[0]!.getAttribute("data-brush-handle")).toBe("lo");
        fireEvent.pointerMove(track, { clientX: 300, pointerId: 1, buttons: 1 });
        expect(q("[data-brush-handle][data-pressed]")[0]!.getAttribute("data-brush-handle")).toBe("hi");
        fireEvent.pointerUp(track, { pointerId: 1 });
        expect(q("[data-brush-handle][data-pressed]")).toHaveLength(0);
    });

    test("a window narrower than its two zones marks the track narrow and sets each zone, its tab over it, beside its edge — outside it, or against the track's end just inside it", () => {
        const placed = (from: number, to: number) => {
            const { q, track } = strip({ window: { from, to } });
            const read = { narrow: track.hasAttribute("data-narrow"), sides: [...q("[data-brush-zone]")].map((zone) => zone.getAttribute("data-side")) };
            cleanup();
            return read;
        };
        expect(placed(0.5, 0.55)).toEqual({ narrow: true, sides: ["out", "out"] });
        // 388–396px of 400: no room for the end's zone outside.
        expect(placed(0.97, 0.99)).toEqual({ narrow: true, sides: ["out", "in"] });
        expect(placed(0.5, 0.6)).toEqual({ narrow: false, sides: [null, null] });
    });
});
