/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Flowchart's zoom in a real browser (#1519, `Flowchart Records Spec.md`
 * R42), on the parcel depot's flowchart over the app's records, whose cards
 * draw their details: wider and taller than main in each frame here, where
 * Zoom out, Zoom in and Fit stand in the toolbar's row after LR · TD.
 *
 * - **Fit** puts the whole flowchart inside main — every card, + LANE and the
 *   legend — its lanes filling main across and down, nothing left to scroll:
 *   Zoom out is off there, and Zoom in steps back up, ×1.5 a click, to the
 *   cards' own size, where it is off.
 * - **At a zoom** the canvas draws at its scale: each card's box and each lane
 *   header's — where it stands and its size — and the box main scrolls are
 *   their own times the zoom.
 * - **The view's middle** stays put: across Zoom out and Zoom in, each card's
 *   offset from main's middle scales with the zoom. With a state selected,
 *   Zoom out and Zoom in bring it to main's middle instead, at each zoom; and
 *   find state, at a zoom, scrolls the state it picks to main's middle.
 * - **Gestures, zoomed out**, land where the pointer is: a step's card carried
 *   over the Sort lane says where it lands, the lane's wash is its band's box
 *   and the landing line lies across the state's footprint in the middle of
 *   the gap under the chutes, at the zoom; dropped, the new state is drawn in
 *   that row. A state dragged into another lane lands in the lane under the
 *   pointer, and a transition dragged from one state's handle onto another
 *   state's card joins those two states.
 * - **On a phone** the strip leaves the row for the View beside Search
 *   Records; zoomed out there, the window holds more whole lanes, the pager
 *   stepping a lane's zoomed width and its readout counting the lanes in view.
 *
 * Layout and geometry, in the light theme, as every layout check is. Every
 * measurement is polled until it holds, on a page at rest; nothing reads a
 * screenshot.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test flowchart-zoom`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { escapeLayer, settled } from "./settle";
import {
    CARRY_WINDOW, FLOWCHARTS, boxOf, boxesOf, captionOf, cardOf, carryTo, centreInMain, dragState, laneOf, middleOf, openFlowchart, openTab, paneOpen, pickUp, sizeTo,
} from "./flowchart-page";

/**
 * The depot's frame: too narrow to pin the library, which opens over main,
 * and wide enough that its row holds the strip, find state's box among the
 * rest. Main shows less than two of the depot's lanes.
 */
const FRAME = 700;

/** The Sort lane's band. */
const SORT = "[data-flowchart-band='sort']";

/** The step a click of Zoom out or Zoom in takes: ×1.5. */
const STEP = 1.5;

/** The zoom's strip in the toolbar's row. */
const stripOf = (root: Locator): Locator => root.locator("[data-frame-slot='toolbar'] [data-flowchart-zoom]");

/** Whether each of Zoom out, Zoom in and Fit takes a click. */
function stripOn(strip: Locator): Promise<boolean[]> {
    return strip.evaluate((group) => ["Zoom out", "Zoom in", "Fit"].map((name) => !group.querySelector<HTMLButtonElement>(`button[aria-label='${name}']`)!.disabled));
}

/** Clicks one of the strip's buttons, and waits for the page at rest. */
async function zoomWith(page: Page, strip: Locator, name: "Zoom out" | "Zoom in" | "Fit"): Promise<void> {
    await strip.getByRole("button", { name, exact: true }).click();
    await settled(page);
}

/** The zoom the canvas draws at: the scale of its drawing, 1 at the cards' own size. */
function zoomOf(root: Locator): Promise<number> {
    return root.evaluate((el) => {
        const transform = getComputedStyle(el.querySelector("[data-flowchart-zoom-box]")!.firstElementChild!).transform;
        return transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
    });
}

/** Whether the canvas reaches past main, across and down. */
function reach(root: Locator): Promise<[boolean, boolean]> {
    return root.locator("[data-flowchart-scroll]").evaluate((el) => [el.scrollWidth > el.clientWidth, el.scrollHeight > el.clientHeight]);
}

/**
 * What is wrong with a canvas at Fit, each in words: anything it draws outside
 * main — a card, + LANE, the legend — anything left to scroll, and main not
 * filled: across to within a px a lane, as each lane takes whole px, and down
 * its whole height.
 */
function fitFaults(root: Locator): Promise<string[]> {
    return root.evaluate((el) => {
        const faults: string[] = [];
        const scroll = el.querySelector<HTMLElement>("[data-flowchart-scroll]")!;
        const view = scroll.getBoundingClientRect();
        const main = { left: view.left + scroll.clientLeft, top: view.top + scroll.clientTop, width: scroll.clientWidth, height: scroll.clientHeight };
        const drawn = el.querySelector("[data-flowchart-zoom-box]")!.getBoundingClientRect();
        const lanes = el.querySelectorAll("[data-flowchart-lane]").length;
        if (scroll.scrollWidth > scroll.clientWidth || scroll.scrollHeight > scroll.clientHeight) {
            faults.push(`it scrolls: ${scroll.scrollWidth} × ${scroll.scrollHeight} in ${scroll.clientWidth} × ${scroll.clientHeight}`);
        }
        if (drawn.width > main.width + 0.5 || drawn.width < main.width - lanes) faults.push(`drawn ${drawn.width} across a main of ${main.width}`);
        if (Math.abs(drawn.height - main.height) > 0.5) faults.push(`drawn ${drawn.height} down a main of ${main.height}`);
        for (const part of el.querySelectorAll("[data-flowchart-node], [data-flowchart-addlane], [data-flowchart-legend]")) {
            const r = part.getBoundingClientRect();
            const name = part.getAttribute("data-flowchart-node") ?? (part.hasAttribute("data-flowchart-addlane") ? "+ LANE" : "the legend");
            if (r.left < main.left - 0.5 || r.right > main.left + main.width + 0.5 || r.top < main.top - 0.5 || r.bottom > main.top + main.height + 0.5) {
                faults.push(`${name} outside main`);
            }
        }
        return faults;
    });
}

/** What the canvas draws: each card's box and each lane header's, from the corner of the box main scrolls, and that box's size. */
interface Drawn {
    /** Each, by name: its left and top from the box's corner, its width and its height. */
    readonly parts: Readonly<Record<string, readonly number[]>>;
    /** The box main scrolls: its width and its height. */
    readonly box: readonly number[];
}

/** {@link Drawn}, read at one moment. */
function drawnOf(root: Locator): Promise<Drawn> {
    return root.evaluate((el) => {
        const box = el.querySelector("[data-flowchart-zoom-box]")!.getBoundingClientRect();
        const parts: Record<string, number[]> = {};
        for (const part of el.querySelectorAll("[data-flowchart-node], [data-flowchart-lane]")) {
            const r = part.getBoundingClientRect();
            const name = part.hasAttribute("data-flowchart-node") ? `state ${part.getAttribute("data-flowchart-node")}` : `lane ${part.getAttribute("data-flowchart-lane")}`;
            parts[name] = [r.left - box.left, r.top - box.top, r.width, r.height];
        }
        return { parts, box: [box.width, box.height] };
    });
}

/** Where what the canvas draws at a zoom is not what it draws at the cards' own size times the zoom, to half a px: each, in words. */
function unscaled(own: Drawn, at: Drawn, zoom: number): string[] {
    const faults: string[] = [];
    const sides = ["left", "top", "width", "height"];
    for (const [name, was] of Object.entries(own.parts)) {
        const now = at.parts[name];
        if (now === undefined) {
            faults.push(`${name} not drawn`);
            continue;
        }
        was.forEach((v, i) => { if (Math.abs(now[i]! - v * zoom) > 0.5) faults.push(`${name}'s ${sides[i]}: ${now[i]}, where its own ${v} times the zoom is ${v * zoom}`); });
    }
    own.box.forEach((v, i) => { if (Math.abs(at.box[i]! - v * zoom) > 0.5) faults.push(`the box main scrolls, ${sides[i + 2]}: ${at.box[i]}, where its own ${v} times the zoom is ${v * zoom}`); });
    return faults;
}

/** Each card's middle against main's middle: across and down, in px. */
function offMiddle(root: Locator): Promise<Record<string, readonly number[]>> {
    return root.evaluate((el) => {
        const scroll = el.querySelector<HTMLElement>("[data-flowchart-scroll]")!;
        const view = scroll.getBoundingClientRect();
        const x = view.left + scroll.clientLeft + scroll.clientWidth / 2;
        const y = view.top + scroll.clientTop + scroll.clientHeight / 2;
        return Object.fromEntries([...el.querySelectorAll("[data-flowchart-node]")].map((card) => {
            const r = card.getBoundingClientRect();
            return [card.getAttribute("data-flowchart-node")!, [r.left + r.width / 2 - x, r.top + r.height / 2 - y]];
        }));
    });
}

/** Where a card's offset from main's middle is not its offset before a zoom times the zoom's change, to a px: each, in words. */
function drift(before: Record<string, readonly number[]>, after: Record<string, readonly number[]>, change: number): string[] {
    return Object.entries(before).flatMap(([key, was]) => {
        const now = after[key];
        if (now === undefined) return [`${key} not drawn`];
        return was.flatMap((v, i) => (Math.abs(now[i]! - v * change) > 1 ? [`${key} ${now[i]} ${i === 0 ? "across" : "down"} from main's middle, where ${v} times ${change} is ${v * change}`] : []));
    });
}

/** Where a state's card stands off main's middle, across or down, by more than a px — but where the canvas stops at an end: each, in words. */
function middleFaults(root: Locator, key: string): Promise<string[]> {
    return root.evaluate((el, k) => {
        const scroll = el.querySelector<HTMLElement>("[data-flowchart-scroll]")!;
        const view = scroll.getBoundingClientRect();
        const card = el.querySelector(`[data-flowchart-node="${k}"]`)!.getBoundingClientRect();
        const across = card.left + card.width / 2 - (view.left + scroll.clientLeft + scroll.clientWidth / 2);
        const down = card.top + card.height / 2 - (view.top + scroll.clientTop + scroll.clientHeight / 2);
        const stopped = (off: number, at: number, reach: number) => (off < 0 && at <= 0) || (off > 0 && at >= reach - 1);
        const faults: string[] = [];
        if (Math.abs(across) > 1 && !stopped(across, scroll.scrollLeft, scroll.scrollWidth - scroll.clientWidth)) faults.push(`${k} ${across}px across from main's middle`);
        if (Math.abs(down) > 1 && !stopped(down, scroll.scrollTop, scroll.scrollHeight - scroll.clientHeight)) faults.push(`${k} ${down}px down from main's middle`);
        return faults;
    }, key);
}

/** The transitions the canvas draws: each one's key. */
function linksOf(root: Locator): Promise<string[]> {
    return root.evaluate((el) => [...el.querySelectorAll("[data-flowchart-link]")].map((path) => path.getAttribute("data-flowchart-link")!));
}

/**
 * The states a transition's line joins: the card each of its ends stands at,
 * in the drawing's own px — its handle, on the card's edge, within 6px — or
 * `null`.
 */
function endsOf(root: Locator, key: string): Promise<(string | null)[]> {
    return root.evaluate((el, k) => {
        const path = el.querySelector<SVGPathElement>(`[data-flowchart-link="${k}"]`)!;
        const cards = [...el.querySelectorAll<HTMLElement>("[data-flowchart-node]")];
        const at = (p: DOMPoint): string | null => cards.find((card) => {
            const x = parseFloat(card.style.left), y = parseFloat(card.style.top);
            const w = parseFloat(card.style.width), h = parseFloat(card.style.height);
            return Math.hypot(Math.max(x - p.x, 0, p.x - x - w), Math.max(y - p.y, 0, p.y - y - h)) <= 6;
        })?.getAttribute("data-flowchart-node") ?? null;
        return [at(path.getPointAtLength(0)), at(path.getPointAtLength(path.getTotalLength()))];
    }, key);
}

/**
 * Drags a transition from a state's handle onto another state's card:
 * puts the pointer down on the handle on the side given, carries it to the card's
 * middle and lets go there; the page at rest after.
 */
async function connect(page: Page, root: Locator, from: string, side: "left" | "right" | "top" | "bottom", to: string): Promise<void> {
    const handle = middleOf(await boxOf(root.locator(`[data-flowchart-ports="${from}"] [data-flowchart-handle="${side}"]`)));
    const card = middleOf(await boxOf(root.locator(`[data-flowchart-node="${to}"]`)));
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(card.x, card.y, { steps: 12 });
    await page.mouse.up();
    await settled(page);
}

test.describe("The Flowchart's zoom (#1519, R42)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "driven by the mouse at the desktop width; the phone's below");
    test.beforeEach(async ({ page }) => { await page.setViewportSize(CARRY_WINDOW); });

    test("Fit puts the whole flowchart inside main — every card, + LANE and the legend — its lanes filling main across and down, nothing left to scroll; Zoom out is off there, and Zoom in steps back up, ×1.5 a click, to the cards' own size, where it is off", async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartDepot");
        await sizeTo(page, root, FRAME);
        const strip = stripOf(root);
        // At the cards' own size the canvas reaches past main both ways: Zoom in is off.
        expect([await zoomOf(root), await reach(root), await stripOn(strip)]).toEqual([1, [true, true], [true, false, true]]);
        await zoomWith(page, strip, "Fit");
        await expect.poll(() => fitFaults(root)).toEqual([]);
        expect(await stripOn(strip)).toEqual([false, true, true]);
        const fit = await zoomOf(root);
        expect(fit).toBeLessThan(1 / STEP);
        await zoomWith(page, strip, "Zoom in");
        expect(await zoomOf(root)).toBeCloseTo(fit * STEP, 6);
        expect(await stripOn(strip)).toEqual([true, true, true]);
        for (let clicks = 0; clicks < 6 && (await stripOn(strip))[1]; clicks++) await zoomWith(page, strip, "Zoom in");
        expect([await zoomOf(root), await stripOn(strip)]).toEqual([1, [true, false, true]]);
    });

    test("at a zoom the canvas draws at its scale: each card's box and each lane header's — where it stands and its size — and the box main scrolls are their own times the zoom", async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartDepot");
        await sizeTo(page, root, FRAME);
        const own = await drawnOf(root);
        await zoomWith(page, stripOf(root), "Zoom out");
        const zoom = await zoomOf(root);
        expect(zoom).toBeCloseTo(1 / STEP, 6);
        // Still wider and taller than main: laid out as at the cards' own size, so the whole of it scales.
        expect(await reach(root)).toEqual([true, true]);
        expect(unscaled(own, await drawnOf(root), zoom)).toEqual([]);
    });

    test("Zoom out and Zoom in keep the view's middle: each card's offset from main's middle scales with the zoom, and comes back", async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartDepot");
        await sizeTo(page, root, FRAME);
        // The middle of the canvas's reach both ways: ×1.5 smaller, it still reaches past main, so its middle can be held.
        await root.locator("[data-flowchart-scroll]").evaluate((el) => {
            el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
            el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
        });
        await settled(page);
        const strip = stripOf(root);
        const before = await offMiddle(root);
        await zoomWith(page, strip, "Zoom out");
        const zoom = await zoomOf(root);
        expect([zoom, await reach(root)]).toEqual([expect.closeTo(1 / STEP, 6), [true, true]]);
        expect(drift(before, await offMiddle(root), zoom)).toEqual([]);
        await zoomWith(page, strip, "Zoom in");
        expect(await zoomOf(root)).toBe(1);
        expect(drift(before, await offMiddle(root), 1)).toEqual([]);
    });

    test("with a state selected, Zoom out and Zoom in bring it to main's middle, at each zoom", async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartDepot");
        await sizeTo(page, root, FRAME);
        // The sorted state's card, clicked where main shows it: right of main's middle and below it.
        const sorted = root.locator("[data-flowchart-node='SRD']");
        const card = await boxOf(sorted);
        await centreInMain(page, root, { x: card.x + card.width / 2 - 150, y: card.y + card.height / 2 - 120 }, true);
        await sorted.click();
        await expect(sorted).toHaveAttribute("data-selected", "true");
        expect(await middleFaults(root, "SRD")).not.toEqual([]);
        const strip = stripOf(root);
        await zoomWith(page, strip, "Zoom out");
        expect(await zoomOf(root)).toBeCloseTo(1 / STEP, 6);
        await expect.poll(() => middleFaults(root, "SRD")).toEqual([]);
        await zoomWith(page, strip, "Zoom in");
        expect(await zoomOf(root)).toBe(1);
        await expect.poll(() => middleFaults(root, "SRD")).toEqual([]);
    });

    test("find state, at a zoom, scrolls the state it picks to main's middle", async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartDepot");
        await sizeTo(page, root, FRAME);
        await zoomWith(page, stripOf(root), "Zoom out");
        const box = root.locator("[data-toolbar-item='seek'] input");
        await box.pressSequentially("sorted");
        await expect(box).toHaveValue("sorted");
        await page.getByRole("option", { name: "SRD · Sorted" }).click();
        await expect(root.locator("[data-flowchart-node='SRD']")).toHaveAttribute("data-selected", "true");
        await expect.poll(() => middleFaults(root, "SRD")).toEqual([]);
        expect(await zoomOf(root)).toBeCloseTo(1 / STEP, 6);
    });

    test("zoomed out, a step's card carried over the Sort lane says where it lands, the lane's wash is its band's box and the landing line lies across the state's footprint in the middle of the gap under the chutes, at the zoom; dropped, the new state is drawn in that row, selected", async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartDepot");
        await sizeTo(page, root, FRAME);
        await zoomWith(page, stripOf(root), "Zoom out");
        const zoom = await zoomOf(root);
        expect(zoom).toBeCloseTo(1 / STEP, 6);
        // The library opens over main, and slides off it once a card is carried; the canvas is scrolled across till the
        // Sort lane stands in main's middle.
        await paneOpen(page, root, "overlay");
        await openTab(page, root, "Steps");
        await centreInMain(page, root, middleOf(await boxOf(root.locator(SORT))));
        await pickUp(page, cardOf(root, "desk"));
        // Below the chutes' middle, 20px of the drawing under their card: after them.
        await carryTo(page, root, async () => {
            const [chutes, band] = await boxesOf(root, ["[data-flowchart-node='CH*']", SORT]);
            return { x: band!.x + band!.width / 2, y: chutes!.y + chutes!.height + 20 * zoom };
        });
        await expect.poll(() => captionOf(page)).toEqual({ text: "after CH* in Sort", refused: false });
        const marks = await root.evaluate((el) => {
            const at = (e: Element) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
            return {
                lane: el.querySelector("[data-flowchart-droplane]")!.getAttribute("data-flowchart-droplane"),
                wash: at(el.querySelector("[data-flowchart-droplane]")!),
                band: at(el.querySelector("[data-flowchart-band='sort']")!),
                line: at(el.querySelector("[data-flowchart-landing]")!),
                row: el.querySelector("[data-flowchart-landing]")!.getAttribute("data-flowchart-landing"),
                chutes: at(el.querySelector("[data-flowchart-node='CH*']")!),
            };
        });
        expect([marks.lane, marks.row]).toEqual(["sort", "1"]);
        // The wash is the band's box; the line 2px of the drawing, across the chutes' footprint, centred on the middle of
        // the 56px of the drawing under them — each at the zoom.
        marks.wash.forEach((v, i) => expect(v, `the wash's ${["x", "y", "width", "height"][i]}`).toBeCloseTo(marks.band[i]!, 1));
        const [cx, cy, cw, ch] = marks.chutes as [number, number, number, number];
        expect(marks.line[0]).toBeCloseTo(cx, 1);
        expect(marks.line[2]).toBeCloseTo(cw, 1);
        expect(marks.line[3]).toBeCloseTo(2 * zoom, 1);
        expect(marks.line[1]! + marks.line[3]! / 2).toBeCloseTo(cy + ch + 28 * zoom, 1);
        await page.mouse.up();
        // A new state, selected: in the chutes' lane, the next row down — the row each lane's second state stands in, the
        // scanned state's in the first lane, its cards centred in it.
        const added = root.locator("[data-flowchart-node][data-selected='true']");
        await expect(added).toHaveAttribute("data-flowchart-node", /^state-\d+$/);
        const key = (await added.getAttribute("data-flowchart-node"))!;
        const [drawn, above, second] = await boxesOf(root, [`[data-flowchart-node='${key}']`, "[data-flowchart-node='CH*']", "[data-flowchart-node='SCN']"]);
        expect(drawn!.x).toBeCloseTo(above!.x, 1);
        expect(drawn!.width).toBeCloseTo(above!.width, 1);
        expect(drawn!.y).toBeGreaterThan(above!.y + above!.height);
        expect(drawn!.y + drawn!.height / 2).toBeCloseTo(second!.y + second!.height / 2, 1);
        await expect(root.locator("[data-flowchart-pending]")).toHaveText(" · 1 pending");
    });

    test("zoomed out, a state dragged into another lane lands in the lane under the pointer", async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartDepot");
        await sizeTo(page, root, FRAME);
        await zoomWith(page, stripOf(root), "Zoom out");
        expect(await zoomOf(root)).toBeCloseTo(1 / STEP, 6);
        expect(await laneOf(root, "LDD")).toBe("dispatch");
        // Into the Sort band, at the card's height, in the part of the band main shows — the band two lanes off: the
        // canvas scrolled across under the carried card till it stands in main's middle, then read.
        await dragState(page, root, "LDD", async () => {
            await centreInMain(page, root, middleOf(await boxOf(root.locator(SORT))));
            const [loaded, band, main] = await boxesOf(root, ["[data-flowchart-node='LDD']", SORT, "[data-frame-slot='main']"]);
            const left = Math.max(band!.x, main!.x), right = Math.min(band!.x + band!.width, main!.x + main!.width);
            return { x: (left + right) / 2, y: loaded!.y + loaded!.height / 2 };
        });
        await expect.poll(() => laneOf(root, "LDD")).toBe("sort");
        await expect(root.locator("[data-flowchart-pending]")).toHaveText(" · 1 pending");
    });

    test("zoomed out, a transition dragged from one state's handle onto another state's card joins those two states", async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartDepot");
        await sizeTo(page, root, FRAME);
        await zoomWith(page, stripOf(root), "Zoom out");
        expect(await zoomOf(root)).toBeCloseTo(1 / STEP, 6);
        // The chutes and the hold, a lane apart and not joined yet: both in main, the gap between them in its middle.
        const before = await linksOf(root);
        const [chutes, hold] = await boxesOf(root, ["[data-flowchart-node='CH*']", "[data-flowchart-node='HLD']"]);
        await centreInMain(page, root, { x: (chutes!.x + chutes!.width + hold!.x) / 2, y: hold!.y + hold!.height / 2 });
        await connect(page, root, "CH*", "right", "HLD");
        const added = async () => (await linksOf(root)).filter((key) => !before.includes(key));
        await expect.poll(added).toHaveLength(1);
        expect(await endsOf(root, (await added())[0]!)).toEqual(["CH*", "HLD"]);
        await expect(root.locator("[data-flowchart-pending]")).toHaveText(" · 1 pending");
    });
});

/** A phone's builder frame. */
const ROOT = "[data-builder-frame]";

/** What a phone's View holds: the view it opens over the frame, in the frame's overlay slot. */
const heldBy = (frame: Locator): Locator => frame.locator("[data-frame-slot='overlay'] [data-frame-view] [data-flowchart-view]");

/** The cards the window of lanes cuts at its edges: each one's key. */
function cutCards(frame: Locator): Promise<string[]> {
    return frame.evaluate((el) => {
        const scroll = el.querySelector<HTMLElement>("[data-flowchart-scroll]")!;
        const left = scroll.getBoundingClientRect().left + scroll.clientLeft;
        const right = left + scroll.clientWidth;
        return [...el.querySelectorAll("[data-flowchart-node]")].filter((card) => {
            const r = card.getBoundingClientRect();
            return r.right > left + 0.5 && r.left < right - 0.5 && (r.left < left - 0.5 || r.right > right + 0.5);
        }).map((card) => card.getAttribute("data-flowchart-node")!);
    });
}

test.describe("The Flowchart's zoom on a phone (#1519, R42)", () => {
    test.skip(({ isMobile }) => !isMobile, "a touch pointer: the phone projects");

    test("the strip leaves the row for the View beside Search Records, with LR · TD where a rail folds it there; zoomed out from the View, the window holds more whole lanes, the pager stepping a lane's zoomed width and its readout counting the lanes in view", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        // Over the depot's records, narrowed by its rail: LR · TD and the strip in the View, neither in the row.
        let entry = await visitBuilder(page, `${FLOWCHARTS}/flowchartDepot`, ROOT, "light");
        await sizeBuilder(page, entry, ROOT, 390);
        let frame = entry.locator(ROOT).first();
        const row = (sel: string): Locator => frame.locator(`[data-frame-slot='toolbar'] ${sel}`);
        await expect(frame).toHaveAttribute("data-phone", "");
        await expect(row("[data-flowchart-zoom], [data-flowchart-seg='orientation']")).toHaveCount(0);
        let view = frame.locator("[data-phone-view]");
        await expect(view).toHaveAttribute("aria-label", "View");
        await view.tap();
        let held = heldBy(frame);
        await expect(held.locator("[data-flowchart-seg='orientation']")).toBeVisible();
        await expect(held.locator("[data-flowchart-zoom] button")).toHaveCount(3);
        await escapeLayer(page);
        await expect(view).toHaveAttribute("data-state", "closed");

        // Over the depot's records bound editable, which no rail narrows, its cards drawing no details: LR · TD keeps its
        // place in the row, the View holds the strip alone, and the window shows two lanes, each half of main.
        entry = await visitBuilder(page, `${FLOWCHARTS}/flowchartDepotEditing`, ROOT, undefined);
        await sizeBuilder(page, entry, ROOT, 390);
        frame = entry.locator(ROOT).first();
        await expect(row("[data-toolbar-item='orientation']")).toBeVisible();
        await expect(row("[data-flowchart-zoom]")).toHaveCount(0);
        const pager = frame.locator("[data-flowchart-lane-pager]");
        const readout = pager.locator("[data-slot='pagerReadout']");
        await expect(readout).toHaveText("Lanes 1–2 of 5");
        const scroll = frame.locator("[data-flowchart-scroll]");
        const width = await scroll.evaluate((el) => el.clientWidth);
        view = frame.locator("[data-phone-view]");
        await view.tap();
        held = heldBy(frame);
        await expect(held.locator("[data-flowchart-zoom] button")).toHaveCount(3);
        await expect(held.locator("[data-flowchart-seg]")).toHaveCount(0);
        await held.locator("[data-flowchart-zoom]").getByRole("button", { name: "Zoom out", exact: true }).tap();
        await escapeLayer(page);
        await expect(view).toHaveAttribute("data-state", "closed");
        await settled(page);

        // ×1.5 smaller: a lane, half of main at the cards' own size, is drawn at two thirds of that, and the window holds
        // as many whole lanes as fit; each step moves it a lane's zoomed width, cutting no card at its edges.
        expect(await zoomOf(frame)).toBeCloseTo(1 / STEP, 6);
        const lane = Math.floor(width / 2) / STEP;
        const shown = Math.floor(width / lane + 1e-6);
        expect(shown).toBe(3);
        await expect(readout).toHaveText(`Lanes 1–${shown} of 5`);
        expect(await cutCards(frame)).toEqual([]);
        for (const at of [1, 2]) {
            await pager.locator("[data-slot='pagerNext']").tap();
            await expect(readout).toHaveText(`Lanes ${at + 1}–${at + shown} of 5`);
            await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeCloseTo(at * lane, 0);
            expect(await cutCards(frame), `at lane ${at + 1}`).toEqual([]);
        }
        for (const at of [1, 0]) {
            await pager.locator("[data-slot='pagerPrevious']").tap();
            await expect(readout).toHaveText(`Lanes ${at + 1}–${at + shown} of 5`);
            await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeCloseTo(at * lane, 0);
        }
    });
});
