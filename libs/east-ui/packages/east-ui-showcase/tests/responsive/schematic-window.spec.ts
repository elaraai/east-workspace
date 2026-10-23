/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Schematic read a window at a time, in a real browser (#1393, `Schematic
 * Builder Spec.md` §10.4, D25), on the floor of 20,000 racks: fitted, the
 * whole floor in view holds more racks than a window draws, so the canvas
 * shades their density and the footer says how many it shades and that
 * zooming in draws them — `Density: 20,000 racks — zoom in to draw them`, the
 * count exact while every cell it shades lies in view (ruled 23 Oct 2026) —
 * the rail's one item, and on a phone, at 390 and 360px and in a 294px parent,
 * its words wrapping inside the rail, nothing past its edge. A tap on the
 * density zooms in about it, and once the racks there are read the footer
 * says nothing: they draw as themselves.
 *
 * Every wait is a poll on the page's state, never a fixed pause.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-window`.
 */

import { test, expect, type Locator } from "playwright/test";
import { RECORD_INDEXES, openSchematic, screenPoint, sizeTo } from "./schematic-page";
import { settled } from "./settle";

/** The density's words. */
const notice = (root: Locator) => root.locator("[data-schematic-footer] [data-schematic-density='racks']");

/** What passes an edge: the density's words past the rail's inner box, the rail past the frame's, or the page wider than the window. */
function overflow(root: Locator): Promise<string[]> {
    return root.evaluate((el) => {
        const rail = el.querySelector<HTMLElement>("[data-schematic-footer]")!;
        const words = rail.querySelector("[data-schematic-density]")!.getBoundingClientRect();
        const r = rail.getBoundingClientRect(), frame = el.querySelector("[data-builder-frame]")!.getBoundingClientRect();
        const css = getComputedStyle(rail);
        const inner = { left: r.left + parseFloat(css.paddingLeft), right: r.right - parseFloat(css.paddingRight) };
        const out: string[] = [];
        if (words.left < inner.left - 0.5 || words.right > inner.right + 0.5) out.push(`the words span ${Math.round(words.left)}–${Math.round(words.right)}, the rail ${Math.round(inner.left)}–${Math.round(inner.right)}`);
        if (r.right > frame.right + 0.5) out.push(`the rail ends at ${Math.round(r.right)}, the frame at ${Math.round(frame.right)}`);
        const doc = document.documentElement;
        if (doc.scrollWidth > doc.clientWidth) out.push(`the page is ${doc.scrollWidth}px wide in a ${doc.clientWidth}px window`);
        return out;
    });
}

test("fitted, the floor's density: the footer says how many racks it shades and that zooming in draws them, its rail's one item, nothing past the rail's edge (#1393)", async ({ page, isMobile }) => {
    const root = await openSchematic(page, RECORD_INDEXES);
    await expect(notice(root)).toHaveText("Density: 20,000 racks — zoom in to draw them");
    await expect(root.locator("[data-schematic-footer] > *")).toHaveCount(1);
    expect(await overflow(root)).toEqual([]);
    if (!isMobile) return;
    // On a phone, narrower still: the words wrap inside the rail.
    await page.setViewportSize({ width: 360, height: 740 });
    await settled(page);
    await expect(notice(root)).toBeVisible();
    expect(await overflow(root), "at 360px").toEqual([]);
    await sizeTo(page, root, 294);
    await expect(notice(root)).toBeVisible();
    expect(await overflow(root), "in a 294px parent").toEqual([]);
});

test.describe("A tap on the density (#1393)", () => {
    test.skip(({ isMobile }) => isMobile, "a desktop's canvas, whose tap zooms in to fewer racks than a window draws");

    test("zooms in about it, and once the racks there are read — main busy no more — the footer says nothing", async ({ page }) => {
        const root = await openSchematic(page, RECORD_INDEXES);
        await expect(notice(root)).toBeVisible();
        // Hall 1's front rows: the canvas flies in about the tap, eight of its cells across, and reads the window there.
        const front = await screenPoint(root, 20.0, 10.0);
        await page.mouse.click(front.x, front.y);
        const main = root.locator("[data-frame-slot='main']");
        await expect.poll(async () => (await main.getAttribute("aria-busy")) === "true" || (await notice(root).count()) === 0,
            "the window there read, or reading").toBe(true);
        await settled(page);
        await expect(notice(root)).toHaveCount(0);
        await expect(root.locator("[data-schematic-footer] > *")).toHaveCount(0);
    });
});
