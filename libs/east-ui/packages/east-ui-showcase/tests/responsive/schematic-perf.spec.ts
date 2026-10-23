/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What a wheel zoom costs the main thread as the Schematic's reads land
 * (#1393) — `E3_UI_PERF=1`, never in CI: a timing on a shared runner is no
 * deterministic signal. On the built showcase and its in-page e3, the floor of
 * 20,000 racks (`schematicRecordIndexes`) wheeled about Hall 3's front rows, a
 * notch every four frames — a notch of 100, as a mouse's wheel gives one — from
 * Fit to 40× and back, each stretch until the windows it asked for have landed.
 * Each records what it cost the main thread (`main-thread-cost.ts`' `costOf`)
 * and the page's reads of its e3 meanwhile, by kind, prints them as JSON, and
 * holds that no frame took longer than 50 ms and the browser reported no long
 * animation frame: a window's rows are made a budget a read, a frame drawing
 * between (`made-rows.ts`), and the frame draws what the reader read in a
 * task of its own.
 *
 * Run (from the showcase, over its build):
 * `E3_UI_PERF=1 pnpm exec playwright test schematic-perf --project desktop --workers 1`.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { e3Requests, installE3Faults } from "./e3-faults";
import { costOf } from "./main-thread-cost";
import { RECORD_INDEXES, openSchematic, screenPoint, type Point } from "./schematic-page";
import { settled } from "./settle";

/** Whether the measurement runs: `E3_UI_PERF=1`, as the renderers' benchmarks are asked for. */
const PERF = process.env["E3_UI_PERF"] === "1";

/** A notch of the wheel, as a mouse gives one, and the frames between notches. */
const NOTCH = 100;
const FRAMES_A_NOTCH = 4;
/** The notches from Fit to 40×: the canvas zooms by e^(0.0015 × 100) a notch. */
const NOTCHES = Math.ceil(Math.log(40) / (0.0015 * NOTCH));

/** The canvas's zoom: its camera's px a unit. */
function ppuOf(root: Locator): Promise<number> {
    return root.evaluate((el) => Number(el.querySelector<HTMLElement>("[data-schematic-canvas] [style*='--cam-ppu']")!.style.getPropertyValue("--cam-ppu")));
}

/** Wheels the canvas about a point, a notch of `delta` every {@link FRAMES_A_NOTCH} frames, `notches` times. */
function wheel(root: Locator, at: Point, delta: number, notches: number): Promise<void> {
    return root.evaluate(async (el, { at, delta, notches, every }) => {
        const canvas = el.querySelector<HTMLElement>("[data-schematic-canvas]")!;
        await new Promise<void>((resolve) => {
            let frame = 0, sent = 0;
            const tick = () => {
                if (frame++ % every === 0) {
                    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, deltaMode: 0, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }));
                    sent++;
                }
                if (sent < notches) requestAnimationFrame(tick);
                else resolve();
            };
            requestAnimationFrame(tick);
        });
    }, { at, delta, notches, every: FRAMES_A_NOTCH });
}

/** The page's reads of its e3 since a mark, by kind. */
async function readsSince(page: Page, mark: number): Promise<Record<string, number>> {
    const since = (await e3Requests(page)).slice(mark);
    const kinds: Record<string, number> = {};
    for (const request of since) kinds[request.kind] = (kinds[request.kind] ?? 0) + 1;
    return kinds;
}

test.describe("what a wheel zoom costs the main thread as the Schematic's reads land (#1393; E3_UI_PERF=1, not a CI gate)", () => {
    test.skip(!PERF, "E3_UI_PERF=1 only: a timing on a shared runner is no CI gate");

    test("the floor of 20,000 racks wheeled from Fit to 40× about Hall 3's front rows and back: no frame over 50 ms, and no long animation frame, as its windows land @desktop", async ({ page }) => {
        test.setTimeout(300_000);
        await installE3Faults(page);
        await page.setViewportSize({ width: 1440, height: 1000 });
        const root = await openSchematic(page, RECORD_INDEXES);
        const main = root.locator("[data-frame-slot='main']");
        const fit = await ppuOf(root);
        // Hall 3's front rows, held under the pointer as the wheel zooms about it.
        const at = await screenPoint(root, 190, 26);
        const results: Record<string, unknown> = {};
        const measure = async (name: string, delta: number) => {
            const mark = (await e3Requests(page)).length;
            const cost = await costOf(page, async () => {
                await wheel(root, at, delta, NOTCHES);
                await expect(main).toHaveAttribute("aria-busy", "false");
                await settled(page);
            });
            results[name] = { zoom: Math.round(((await ppuOf(root)) / fit) * 10) / 10, reads: await readsSince(page, mark), ...cost };
            return cost;
        };
        const zoomIn = await measure(`wheel in: Fit to 40×, ${NOTCHES} notches`, -NOTCH);
        expect((await ppuOf(root)) / fit).toBeGreaterThanOrEqual(40);
        const zoomOut = await measure(`wheel out: 40× to Fit, ${NOTCHES} notches`, NOTCH);
        console.log(`Schematic wheel ${JSON.stringify(results, null, 2)}`);
        test.info().annotations.push({ type: "Schematic wheel", description: JSON.stringify(results) });
        expect([zoomIn.over50, zoomOut.over50], "frames over 50 ms wheeling in, and out").toEqual([0, 0]);
        expect([zoomIn.loaf.count, zoomOut.loaf.count], "long animation frames wheeling in, and out").toEqual([0, 0]);
    });
});
