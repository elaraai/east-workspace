/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A shaped zone's eyebrow on the outline it draws, in a real browser (#1546), on the floor of shaped units: Hall 3, a
 * polygon whose corners stand in from its box's, and the duct bank, a band whose run starts below its box's top-left.
 * At Fit, zoomed into the zone, and zoomed in close on where its eyebrow stands, the eyebrow the canvas paints stands
 * within 1px of its outline's point nearest its box's top-left — that point of the drawing on the screen, as the cards'
 * layer places a point of the drawing — never at the box's corner, which stands further off the outline the further
 * the view zooms in. Desktop, light theme: the check holds no colour.
 *
 * What the canvas paints is read through its 2D context: every text the page draws on a canvas, recorded from before
 * the page loads with where the context's transform put it; nothing reads a screenshot. Every wait is a poll on the
 * page's state, never a fixed pause.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-eyebrow`.
 */

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { SHAPES, openSchematic, restsOn, screenPoint, zoomInto, type Point, type WorldBox } from "./schematic-page";
import { settled } from "./settle";

/** A text the page drew on a canvas, the last time it drew it: where, and its context's transform then. */
interface DrawnText {
    readonly x: number;
    readonly y: number;
    readonly m: readonly [number, number, number, number, number, number];
}

/** The texts each canvas of the page drew, each by its words. */
type CanvasTexts = WeakMap<HTMLCanvasElement, Map<string, DrawnText>>;

/**
 * Records, from before the page loads, every text the page draws on a canvas: by the canvas and its words, the last
 * time each was drawn, where the context drew it and its transform then (`__canvasTexts`).
 */
function recordTexts(): void {
    const texts: CanvasTexts = new WeakMap();
    (window as unknown as { __canvasTexts?: CanvasTexts }).__canvasTexts = texts;
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number): void {
        const m = this.getTransform();
        let drawn = texts.get(this.canvas);
        if (drawn === undefined) {
            drawn = new Map();
            texts.set(this.canvas, drawn);
        }
        drawn.set(text, { x, y, m: [m.a, m.b, m.c, m.d, m.e, m.f] });
        if (maxWidth === undefined) fillText.call(this, text, x, y);
        else fillText.call(this, text, x, y, maxWidth);
    };
}

/**
 * Where the canvas painted a zone's eyebrow, in client px: the point its words start 9px to the right of, through its
 * context's transform and the canvas's box.
 *
 * @param root - The Schematic's root
 * @param words - The eyebrow's words
 * @returns The point; `null` while the canvas has painted none
 */
function eyebrowAt(root: Locator, words: string): Promise<Point | null> {
    return root.locator("[data-schematic-canvas] > canvas").evaluate((canvas: HTMLCanvasElement, text) => {
        const drawn = (window as unknown as { __canvasTexts?: CanvasTexts }).__canvasTexts?.get(canvas)?.get(text);
        if (drawn === undefined) return null;
        const [a, b, c, d, e, f] = drawn.m;
        const x = drawn.x - 9, y = drawn.y;
        const box = canvas.getBoundingClientRect();
        return {
            x: box.left + canvas.clientLeft + (a * x + c * y + e) * canvas.clientWidth / canvas.width,
            y: box.top + canvas.clientTop + (b * x + d * y + f) * canvas.clientHeight / canvas.height,
        };
    }, words);
}

/**
 * The point of a run of straight stretches nearest a point, the run closed back to its first corner where it is a
 * polygon's.
 *
 * @param p - The point
 * @param corners - The run's corners, in the drawing's units
 * @param closed - Whether it closes
 * @returns Its point nearest `p`
 */
function nearestOn(p: Point, corners: readonly Point[], closed: boolean): Point {
    let best = corners[0]!;
    const stretches = closed ? corners.length : corners.length - 1;
    for (let i = 0; i < stretches; i++) {
        const a = corners[i]!, b = corners[(i + 1) % corners.length]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
        const q = { x: a.x + dx * t, y: a.y + dy * t };
        if (Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y)) best = q;
    }
    return best;
}

/** A shaped zone, as the example's record places it. */
interface Shaped {
    /** Its eyebrow's words. */
    readonly words: string;
    /** Its box. */
    readonly box: WorldBox;
    /** Where its eyebrow stands: its outline's point nearest its box's top-left. */
    readonly at: Point;
    /** A box inside its own about that point, close in. */
    readonly close: WorldBox;
}

/** Its corners, about its box's centre, placed. */
const placed = (box: WorldBox, corners: readonly (readonly [number, number])[]): Point[] =>
    corners.map(([x, y]) => ({ x: (box.minX + box.maxX) / 2 + x, y: (box.minY + box.maxY) / 2 + y }));

/** Hall 3: a polygon of four straight edges about its box's centre. */
const HALL_3_BOX: WorldBox = { minX: 1.6, minY: 1.4, maxX: 10.9, maxY: 8.0 };
const HALL_3: Shaped = {
    words: "HALL 3",
    box: HALL_3_BOX,
    at: nearestOn({ x: HALL_3_BOX.minX, y: HALL_3_BOX.minY }, placed(HALL_3_BOX, [[-4.65, -2.5], [4.15, -3.3], [4.65, 2.7], [-4.25, 3.3]]), true),
    close: { minX: 1.6, minY: 1.6, maxX: 4.6, maxY: 3.6 },
};

/**
 * The duct bank: a band along a run of five bends about its box's centre, its first stretch straight. The run's bowed
 * stretches past its second bend stand further from its box's corner than every point of its first, so the first holds
 * the point nearest it.
 */
const DUCT_BANK_BOX: WorldBox = { minX: 1.0, minY: 9.1, maxX: 24.8, maxY: 12.5 };
const DUCT_BANK: Shaped = {
    words: "DUCT BANK",
    box: DUCT_BANK_BOX,
    at: nearestOn({ x: DUCT_BANK_BOX.minX, y: DUCT_BANK_BOX.minY }, placed(DUCT_BANK_BOX, [[-11.7, 1.0], [-6.3, -0.8]]), false),
    close: { minX: 1.0, minY: 10.4, maxX: 4.0, maxY: 12.4 },
};

/**
 * Holds a zone's eyebrow to where its outline's point nearest its box's top-left stands on the screen: within 1px, as
 * the canvas paints at the camera's rest.
 *
 * @param root - The Schematic's root
 * @param zone - The zone
 * @param view - Where the view stands, for the message
 */
async function standsOnOutline(root: Locator, zone: Shaped, view: string): Promise<void> {
    await expect.poll(async () => {
        const painted = await eyebrowAt(root, zone.words);
        if (painted === null) return Number.POSITIVE_INFINITY;
        const at = await screenPoint(root, zone.at.x, zone.at.y);
        return Math.hypot(painted.x - at.x, painted.y - at.y);
    }, { message: `${zone.words} ${view}: px from its outline's point nearest its box's top-left` }).toBeLessThanOrEqual(1);
}

test.describe("A shaped zone's eyebrow stands on its outline (#1546)", { tag: "@desktop" }, () => {
    test("Hall 3's and the duct bank's eyebrows stand on their outlines, at the point nearest their boxes' top-left, at Fit, zoomed into the zone and close in on that point", async ({ page }) => {
        await page.addInitScript(recordTexts);
        await page.setViewportSize({ width: 1440, height: 900 });
        const root = await openSchematic(page, SHAPES);
        const fit = root.locator("[data-frame-slot='toolbar']").getByRole("button", { name: "Fit" });

        for (const zone of [HALL_3, DUCT_BANK]) {
            await test.step(`${zone.words} at Fit`, async () => {
                await fit.click();
                await restsOn(root, zone.box);
                await settled(page);
                await standsOnOutline(root, zone, "at Fit");
            });
            await test.step(`${zone.words} zoomed into its box`, async () => {
                await zoomInto(page, root, zone.box);
                await standsOnOutline(root, zone, "zoomed into its box");
            });
            await test.step(`${zone.words} zoomed in close on where it stands`, async () => {
                await zoomInto(page, root, zone.close);
                await standsOnOutline(root, zone, "close in");
            });
        }
    });
});
