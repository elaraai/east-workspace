/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A tile's height on the snap grid, measured in a real browser over the
 * Studio's builder and its page of visuals:
 *
 *  - H1 a tile made taller by its height handle is made shorter by it again:
 *    240 dragged down to 480 and back up 160 stands at 320, its plot taking
 *    each height — never thrown back to its content's own height, which is
 *    only where a drag below it ends.
 *  - H2 a tile that stretches is as tall as its row, whatever height it has
 *    of its own: beside the tile dragged to 480, the stretched list's frame
 *    and its rows stand at the row's 480 while the handle is held and once it
 *    is let go, and at its own 240 again once the row is.
 *  - H3 the page draws the same: beside a taller tile of its row, a stretched
 *    tile with a height of its own stands as tall as the row, its plot with
 *    it.
 *
 * Every measurement is taken from the laid-out page.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-heights --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
import { openVisuals } from "./studio-visuals-page";

/** The showcase's builder over a page whose second row is a chart, 240 tall at its row's top, beside a list, 240 tall and stretched. */
const HASH = "e3/studio/studio/studioContent";

/** What is read of the builder's second row: its height, the chart's frame and plot, and the list's frame and rows. */
interface RowRead {
    readonly row: number;
    readonly chart: { readonly frame: number; readonly plot: number };
    readonly list: { readonly frame: number; readonly rows: number };
}

/**
 * Opens the builder, its second row drawn, at rest.
 *
 * @param page - The browser's page
 * @returns The showcase's entry
 */
async function openBuilder(page: Page): Promise<Locator> {
    await page.goto(`/?theme=light#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator('[data-snap-grid-tile="s-revenue"] [data-studio-chart] svg').first()).toBeVisible({ timeout: 30_000 });
    await expect(entry.locator('[data-snap-grid-tile="s-top"] [data-studio-list]')).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}

/** The builder's second row, as it is laid out. */
function readRow(entry: Locator): Promise<RowRead> {
    return entry.evaluate((root): RowRead => {
        const height = (el: Element | null): number => (el === null ? -1 : Math.round(el.getBoundingClientRect().height));
        const chart = root.querySelector('[data-snap-grid-tile="s-revenue"]')!;
        const list = root.querySelector('[data-snap-grid-tile="s-top"]')!;
        return {
            row: height(chart.parentElement),
            chart: { frame: height(chart.firstElementChild), plot: height(chart.querySelector("[data-studio-chart] svg")) },
            list: { frame: height(list.firstElementChild), rows: height(list.querySelector("[data-studio-list]")) },
        };
    });
}

/**
 * Presses the selected tile's height handle and drags it.
 *
 * @param page - The browser's page
 * @param entry - The showcase's entry
 * @param by - How far down, in px; negative drags up
 */
async function holdHeight(page: Page, entry: Locator, by: number): Promise<void> {
    const handle = entry.locator("[data-snap-grid-tile][data-selected] [data-handle=height]");
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) await page.mouse.move(x, y + (by * step) / 12);
}

test.describe("A tile's height on the snap grid", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("H1, H2: a tile dragged taller is dragged shorter again, its plot following — and the stretched tile beside it stands as tall as the row throughout", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const entry = await openBuilder(page);
        const rest = await readRow(entry);
        expect([rest.row, rest.chart.frame, rest.list.frame], "at rest the row and its two tiles are 240").toEqual([240, 240, 240]);

        await entry.locator('[data-snap-grid-tile="s-revenue"]').click({ position: { x: 30, y: 60 } });
        await settled(page);

        // Down 240: the chart is 480 while the handle is held, and the stretched list with it.
        await holdHeight(page, entry, 240);
        await expect.poll(() => readRow(entry), { message: "held 240 down" }).toEqual({
            row: 480,
            chart: { frame: 480, plot: rest.chart.plot + 240 },
            list: { frame: 480, rows: rest.list.rows + 240 },
        });
        await page.mouse.up();
        await settled(page);
        await expect.poll(() => readRow(entry), { message: "let go at 480" }).toEqual({
            row: 480,
            chart: { frame: 480, plot: rest.chart.plot + 240 },
            list: { frame: 480, rows: rest.list.rows + 240 },
        });

        // Back up 160: 320 — a height above its content's own stands where it is dragged to.
        await holdHeight(page, entry, -160);
        await page.mouse.up();
        await settled(page);
        await expect.poll(() => readRow(entry), { message: "dragged back up to 320" }).toEqual({
            row: 320,
            chart: { frame: 320, plot: rest.chart.plot + 80 },
            list: { frame: 320, rows: rest.list.rows + 80 },
        });

        // Up to 240 again: the row is as it began, the list at its own height.
        await holdHeight(page, entry, -80);
        await page.mouse.up();
        await settled(page);
        await expect.poll(() => readRow(entry), { message: "dragged back up to 240" }).toEqual(rest);
    });

    test("H3: on the page a stretched tile with a height of its own stands as tall as a taller tile of its row, its plot with it", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        // Wide enough for the row's two tiles to stand side by side, at their declared spans.
        await grid.evaluate((root) => { root.querySelector<HTMLElement>("[data-snap-grid-body]")!.style.width = "1200px"; });
        const read = () => grid.evaluate((root) => {
            const height = (el: Element | null): number => (el === null ? -1 : Math.round(el.getBoundingClientRect().height));
            const beside = root.querySelector('[data-snap-grid-cell="v-customers"]')!;
            return { row: height(beside.parentElement), cell: height(beside), plot: height(beside.querySelector("[data-studio-chart] svg")) };
        });
        await expect.poll(async () => { const at = await read(); return [at.row, at.cell]; }, { message: "side by side, the row and the tile are 240" }).toEqual([240, 240]);
        await settled(page);
        const rest = await read();
        // The tile beside it, taller: the row is, and the stretched tile with it.
        await grid.evaluate((root) => { root.querySelector<HTMLElement>('[data-snap-grid-cell="v-months"]')!.style.minHeight = "400px"; });
        await expect.poll(read).toEqual({ row: 400, cell: 400, plot: rest.plot + 160 });
    });
});
