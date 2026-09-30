/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Studio's publish preview, measured in a real browser (#998), against the
 * mock's markup: the 44px bar and the 320px aside (E1, E3); the page on its
 * panel, 24 / 28px in, at most each device's width — Desktop and Tablet
 * laying the page out at its declared spans, Mobile stacking its placements
 * in row order at 390px (E2). The frame is set to the Studio's width, full
 * bleed at 1440px. Every measurement is polled until it holds, on a page at
 * rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-publish --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** Open the publish preview example and return its frame, at rest, as wide as the Studio's (1440px). */
async function openPreview(page: Page): Promise<Locator> {
    await page.goto("/?theme=light#e3/studio/publish/studioPublishPreview");
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator('a[href="#e3/studio/publish/studioPublishPreview"]') });
    await entry.scrollIntoViewIfNeeded();
    const frame = entry.locator("[data-studio-publish]").first();
    await expect(frame.locator("[data-snap-grid-cell]").first()).toBeVisible({ timeout: 20_000 });
    await frame.evaluate((root) => { (root as HTMLElement).style.width = "1440px"; });
    await settled(page);
    return frame;
}

/** Where the page sits in its panel, and its placements — each box relative to the page frame, to the pixel. */
function measure(frame: Locator) {
    return frame.evaluate((root) => {
        const main = root.querySelector("[data-publish-main]")!;
        const pageFrame = root.querySelector("[data-publish-frame]")!;
        const m = main.getBoundingClientRect();
        const f = pageFrame.getBoundingClientRect();
        const style = getComputedStyle(main);
        const cells = [...pageFrame.querySelectorAll("[data-snap-grid-cell]")].map((cell) => {
            const b = cell.getBoundingClientRect();
            return { key: cell.getAttribute("data-snap-grid-cell"), x: Math.round(b.left - f.left), y: Math.round(b.top - f.top), w: Math.round(b.width) };
        });
        return {
            padding: [Number.parseFloat(style.paddingTop), Number.parseFloat(style.paddingLeft)],
            column: Math.round(m.width - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)),
            frame: Math.round(f.width),
            centred: Math.abs((f.left - m.left) - (m.right - f.right)) <= 1,
            cells,
        };
    });
}

test.describe("Studio publish preview (#998)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("E1, E3: the bar is 44px tall across the frame; the aside is 320px wide beside the page", async ({ page }) => {
        const frame = await openPreview(page);
        await expect.poll(() => frame.evaluate((root) => {
            const r = root.getBoundingClientRect();
            const bar = root.querySelector("[data-publish-bar]")!.getBoundingClientRect();
            const aside = root.querySelector("[data-publish-aside]")!.getBoundingClientRect();
            return { bar: [Math.round(bar.height), Math.round(bar.width)], aside: Math.round(aside.width), asideAtRight: Math.round(r.right - aside.right) };
        })).toEqual({ bar: [44, 1438], aside: 320, asideAtRight: 1 });
    });

    test("E2: Desktop — the page 24 / 28px into its panel, as wide as the panel lets it be, at its declared spans", async ({ page }) => {
        const frame = await openPreview(page);
        await expect.poll(async () => {
            const at = await measure(frame);
            const row2 = at.cells.filter((c) => c.key === "o-trend" || c.key === "o-bars");
            return {
                padding: at.padding, frameIsColumn: at.frame === at.column,
                // The trend's 8 columns beside the bars' 4, on one line.
                row2: row2.map((c) => c.key), oneLine: new Set(row2.map((c) => c.y)).size === 1, twice: Math.abs(row2[0]!.w / row2[1]!.w - 2) < 0.1,
            };
        }).toEqual({ padding: [24, 28], frameIsColumn: true, row2: ["o-trend", "o-bars"], oneLine: true, twice: true });
    });

    test("E2: Tablet — the page at most 1024px, centred in its panel, still at its declared spans", async ({ page }) => {
        const frame = await openPreview(page);
        await frame.locator('[data-publish-device="tablet"]').click();
        await expect.poll(async () => {
            const at = await measure(frame);
            const row2 = at.cells.filter((c) => c.key === "o-trend" || c.key === "o-bars");
            return { frame: at.frame, centred: at.centred, oneLine: new Set(row2.map((c) => c.y)).size === 1 };
        }).toEqual({ frame: 1024, centred: true, oneLine: true });
    });

    test("E2: Mobile — the page 390px wide, centred in its panel, every placement the page's width, in row order", async ({ page }) => {
        const frame = await openPreview(page);
        await frame.locator('[data-publish-device="mobile"]').click();
        await expect.poll(async () => {
            const at = await measure(frame);
            const ys = at.cells.map((c) => c.y);
            return {
                frame: at.frame, centred: at.centred,
                keys: at.cells.map((c) => c.key),
                full: at.cells.every((c) => c.x === 0 && c.w === 390),
                stacked: ys.every((y, i) => i === 0 || y > ys[i - 1]!),
            };
        }).toEqual({ frame: 390, centred: true, keys: ["o-kpi", "o-trend", "o-bars"], full: true, stacked: true });
    });
});
