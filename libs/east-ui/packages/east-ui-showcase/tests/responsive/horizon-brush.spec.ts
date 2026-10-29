/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The horizon brush (#1438) measured in a real browser: the shared strip
 * behind the Slice rail's brush and the Plan's horizon band, on the rail
 * example's datetime strip (`sliceRail`), whose window is seeded. Its bars
 * stand on the track's bottom at whole pixels, one width, the tallest 4 short
 * of the track; the window's layer is clipped to it over the band; each edge
 * has a 9px tab 2 in from the track's top and bottom, centred on it; a bar's
 * hover stands its Tooltip 8 above the track, inside it; and the keys move
 * the window and clear it. jsdom lays nothing out, so what the strip's DOM
 * tests cannot see is measured here.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test horizon-brush`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

const ROUTE = "slice/slice/sliceRail";

/** The rail example's first strip that holds a window, drawn and at rest — by its place, so it is the same strip once its window clears. */
async function openStrip(page: Page): Promise<Locator> {
    await page.goto(`/?theme=light#${ROUTE}`);
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${ROUTE}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const tracks = entry.locator("[data-brush-track]");
    await expect(tracks.locator("[data-brush-band]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    const at = await tracks.evaluateAll((all) => all.findIndex((t) => t.querySelector("[data-brush-band]") !== null));
    const strip = tracks.nth(at);
    await expect(strip.locator("[data-brush-bar]").first()).toBeVisible();
    return strip;
}

test.describe("the horizon brush (#1438)", { tag: "@desktop" }, () => {
    test("sliceRail: bars of one width on whole pixels from the track's bottom, the window's layer clipped to it, and a 9px tab centred on each edge, 2 in from the track's top and bottom", async ({ page }) => {
        const strip = await openStrip(page);
        const read = await strip.evaluate((track) => {
            const t = track.getBoundingClientRect();
            const band = track.querySelector("[data-brush-band]")!.getBoundingClientRect();
            const bars = [...track.querySelectorAll("[data-brush-bars=''] > [data-brush-bar]")].map((b) => b.getBoundingClientRect());
            const whole = (n: number) => Math.abs(n - Math.round(n)) < 0.01;
            return {
                widths: [...new Set(bars.map((b) => Math.round(b.width * 100) / 100))],
                onWholePixels: bars.every((b) => whole(b.left - t.left) && whole(b.width) && whole(b.height)),
                onTheBottom: bars.every((b) => Math.abs(b.bottom - t.bottom) < 0.5),
                tallest: Math.max(...bars.map((b) => b.height)),
                trackHeight: t.height,
                masks: track.querySelectorAll("[data-brush-mask]").length,
                clip: getComputedStyle(track.querySelector("[data-brush-bars='in']")!).clipPath,
                handles: [...track.querySelectorAll("[data-brush-handle]")].map((h) => {
                    const r = h.getBoundingClientRect();
                    return { width: r.width, top: r.top - t.top, bottom: t.bottom - r.bottom, centre: (r.left + r.right) / 2 };
                }),
                edges: [band.left, band.right],
            };
        });
        expect(read.widths).toHaveLength(1);
        expect(read.onWholePixels).toBe(true);
        expect(read.onTheBottom).toBe(true);
        expect(read.tallest).toBeLessThanOrEqual(read.trackHeight - 4);
        expect(read.masks).toBe(0);
        expect(read.clip).toMatch(/^inset\(/);
        expect(read.handles.map((h) => [h.width, h.top, h.bottom])).toEqual([[9, 2, 2], [9, 2, 2]]);
        expect(Math.abs(read.handles[0]!.centre - read.edges[0]!)).toBeLessThan(0.75);
        expect(Math.abs(read.handles[1]!.centre - read.edges[1]!)).toBeLessThan(0.75);
    });

    test("sliceRail: a bar's hover stands its Tooltip 8 above the track, inside it, saying its bucket and its count; a gesture hides it", async ({ page }) => {
        const strip = await openStrip(page);
        const t = (await strip.boundingBox())!;
        const bar = (await strip.locator("[data-brush-bars=''] > [data-brush-bar]").first().boundingBox())!;
        await page.mouse.move(bar.x + bar.width / 2, t.y + t.height - 2);
        const tip = page.locator("[data-brush-tip]");
        await expect(tip).toBeVisible();
        await expect(tip).toHaveText(/ · \d/);
        const r = (await tip.boundingBox())!;
        expect(Math.abs(t.y - (r.y + r.height) - 8)).toBeLessThan(1.5);
        expect(r.x).toBeGreaterThanOrEqual(t.x - 0.5);
        expect(r.x + r.width).toBeLessThanOrEqual(t.x + t.width + 0.5);
        await page.mouse.down();
        await page.mouse.move(bar.x + bar.width / 2 + 40, t.y + t.height - 2, { steps: 4 });
        await expect(tip).toHaveCount(0);
        await page.mouse.up();
    });

    test("sliceRail: the start handle, the window and the end handle are three tab stops; an arrow moves the window, and Escape clears it", async ({ page }) => {
        const strip = await openStrip(page);
        const band = strip.locator("[data-brush-band]");
        const left = async () => (await band.boundingBox())!.x;
        const was = await left();
        await strip.locator("[data-brush-handle='lo']").focus();
        await page.keyboard.press("Tab");
        await expect(strip.locator("[data-brush-window]")).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(strip.locator("[data-brush-handle='hi']")).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("ArrowLeft");
        await expect.poll(left).toBeLessThan(was);
        await page.keyboard.press("Escape");
        await expect(band).toHaveCount(0);
    });
});
