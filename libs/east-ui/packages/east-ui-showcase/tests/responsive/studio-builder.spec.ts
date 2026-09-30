/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Studio's builder, measured in a real browser (#1000): one 44px toolbar
 * across its frame, over the palette's 264px pane under its 44px tab row, the
 * canvas column — whose selection bar is 44px — and the inspector's 300px
 * pane; each pane collapses to a 44px rail and the column takes the room (B1,
 * B13, B15). The palette's cards sit 6px apart, each with a 30px icon tile
 * (B3). The toolbar folds by one ladder — the grid chip first, then the width
 * readout, then the widths to their icons, the history item last — so
 * whatever a narrower frame folds is the ladder's first steps (B8). Preview
 * opens the publish preview in the canvas's place: its 44px bar across the
 * frame and its 320px aside (E1, E3); the page on its panel, 24 / 28px in, at
 * most each device's width — Desktop and Tablet laying the page out at its
 * declared spans, Mobile stacking its placements in row order at 390px (E2).
 * The builder is set to the Studio's width, 1440px, and measured on the page
 * it opens at rest. Every measurement is polled until it holds, on a page at
 * rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-builder --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** Open the builder example and return the builder, at rest, as wide as the Studio's (1440px). */
async function openBuilder(page: Page): Promise<Locator> {
    await page.goto("/?theme=light#e3/studio/studio/studioBuilder");
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator('a[href="#e3/studio/studio/studioBuilder"]') });
    await entry.scrollIntoViewIfNeeded();
    const builder = entry.locator("[data-studio-builder]").first();
    await expect(builder.locator("[data-snap-grid-tile]").first()).toBeVisible({ timeout: 20_000 });
    await builder.evaluate((root) => { (root as HTMLElement).style.width = "1440px"; });
    await settled(page);
    return builder;
}

/** Open the builder's publish preview from its toolbar, and return it. */
async function openPreview(page: Page): Promise<Locator> {
    const builder = await openBuilder(page);
    await builder.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = builder.locator("[data-studio-publish]");
    await expect(preview.locator("[data-snap-grid-cell]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return preview;
}

/** A part's rounded box within the builder. */
function box(builder: Locator, selector: string): Promise<{ w: number; h: number }> {
    return builder.evaluate((root, sel) => {
        const b = root.querySelector(sel)!.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height) };
    }, selector);
}

/** Where the page sits in the preview's panel, and its placements — each box relative to the page frame, to the pixel. */
function measure(preview: Locator) {
    return preview.evaluate((root) => {
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

test.describe("Studio builder (#1000)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("B1, B13: a 44px toolbar over the palette's 264px pane, under its 44px tab row, and the canvas column, whose selection bar is 44px; collapsed, the palette is a 44px rail and the column takes the room", async ({ page }) => {
        const builder = await openBuilder(page);
        await expect.poll(async () => ({
            toolbar: (await box(builder, "[data-snap-grid-toolbar-row]")).h,
            pane: (await box(builder, "[data-snap-grid-pane='start']")).w,
            tabs: (await box(builder, "[data-snap-grid-pane='start'] [data-surface=shell] > :first-child")).h,
            bar: (await box(builder, "[data-snap-grid-selection]")).h,
        })).toEqual({ toolbar: 44, pane: 264, tabs: 44, bar: 44 });
        const before = (await box(builder, "[data-snap-grid-main]")).w;

        await builder.getByRole("button", { name: "Collapse Components" }).click();
        await expect.poll(async () => (await box(builder, "[data-snap-grid-pane='start']")).w).toBe(44);
        await expect.poll(async () => (await box(builder, "[data-snap-grid-main]")).w).toBe(before + 220);
    });

    test("B15: the inspector's pane is 300px after the canvas column; collapsed, it is a 44px rail and the column takes the room", async ({ page }) => {
        const builder = await openBuilder(page);
        await expect.poll(async () => (await box(builder, "[data-snap-grid-pane='end']")).w).toBe(300);
        const before = (await box(builder, "[data-snap-grid-main]")).w;

        await builder.getByRole("button", { name: "Collapse Inspector" }).click();
        await expect.poll(async () => (await box(builder, "[data-snap-grid-pane='end']")).w).toBe(44);
        await expect.poll(async () => (await box(builder, "[data-snap-grid-main]")).w).toBe(before + 256);
    });

    test("B3: the palette's cards sit 6px apart, each with a 30px icon tile", async ({ page }) => {
        const builder = await openBuilder(page);
        await expect.poll(() => builder.evaluate((root) => {
            // The Display group's two cards: the KPI rail, then the breakdown bars.
            const cards = [...root.querySelectorAll("[data-library^='studio.components'] [data-clickable]")]
                .map((card) => card.getBoundingClientRect());
            const tile = root.querySelector("[data-library^='studio.components'] svg[data-icon='gauge-high']")!
                .parentElement!.getBoundingClientRect();
            return {
                gap: cards.length < 2 ? -1 : Math.round(cards[1]!.top - cards[0]!.bottom),
                tile: [Math.round(tile.width), Math.round(tile.height)],
            };
        })).toEqual({ gap: 6, tile: [30, 30] });
    });

    test("B8: the toolbar folds by one ladder — the grid chip, the width readout, the widths, the history item — and a narrower frame folds its first steps", async ({ page }) => {
        const builder = await openBuilder(page);
        const editor = builder.locator("[data-snap-grid-editor]");
        const toolbar = editor.locator("[data-snap-grid-toolbar-row] [data-toolbar]");
        await expect.poll(() => toolbar.getAttribute("data-toolbar-ladder")).toBe("grid>1 readout>1 widths>1 history>1");
        // At the mock's 1440px frame nothing folds.
        await expect.poll(() => toolbar.getAttribute("data-toolbar-folds")).toBe("0");
        const ladder = ["grid", "readout", "widths", "history"];
        for (const width of [1000, 900, 800, 700]) {
            await editor.evaluate((root, w) => { (root as HTMLElement).style.width = `${w}px`; }, width);
            await settled(page);
            const folded = await toolbar.evaluate((row) => (row.getAttribute("data-toolbar-state") ?? "").split(";")
                .map((s) => s.split("=")).filter(([, f]) => !f!.startsWith("0/")).map(([k]) => k));
            // What folds is always the ladder's first steps — the state lists
            // the items in the row's order, so they are put in the ladder's.
            folded.sort((a, b) => ladder.indexOf(a) - ladder.indexOf(b));
            expect(folded, `at ${width}px`).toEqual(ladder.slice(0, folded.length));
        }
        // At the narrowest the grid chip has folded.
        expect(await toolbar.evaluate((row) => row.getAttribute("data-toolbar-state"))).toContain("grid=1/2");
    });

    test("E1, E3: the preview's bar is 44px tall across the frame; the aside is 320px wide beside the page, at the frame's edge", async ({ page }) => {
        const preview = await openPreview(page);
        await expect.poll(() => preview.evaluate((root) => {
            const r = root.getBoundingClientRect();
            const bar = root.querySelector("[data-publish-bar]")!.getBoundingClientRect();
            const aside = root.querySelector("[data-publish-aside]")!.getBoundingClientRect();
            return { bar: [Math.round(bar.height), Math.round(bar.width)], aside: Math.round(aside.width), asideAtRight: Math.round(r.right - aside.right) };
        })).toEqual({ bar: [44, 1440], aside: 320, asideAtRight: 0 });
    });

    test("E2: Desktop — the page 24 / 28px into its panel, as wide as the panel lets it be, at its declared spans", async ({ page }) => {
        const preview = await openPreview(page);
        await expect.poll(async () => {
            const at = await measure(preview);
            const row2 = at.cells.filter((c) => c.key === "a-orders" || c.key === "a-bars");
            return {
                padding: at.padding, frameIsColumn: at.frame === at.column,
                // The orders' 8 columns beside the bars' 4, on one line.
                row2: row2.map((c) => c.key), oneLine: new Set(row2.map((c) => c.y)).size === 1, twice: Math.abs(row2[0]!.w / row2[1]!.w - 2) < 0.1,
            };
        }).toEqual({ padding: [24, 28], frameIsColumn: true, row2: ["a-orders", "a-bars"], oneLine: true, twice: true });
    });

    test("E2: Tablet — the page at most 1024px, centred in its panel, still at its declared spans", async ({ page }) => {
        const preview = await openPreview(page);
        await preview.locator('[data-publish-device="tablet"]').click();
        await expect.poll(async () => {
            const at = await measure(preview);
            const row2 = at.cells.filter((c) => c.key === "a-orders" || c.key === "a-bars");
            return { frame: at.frame, centred: at.centred, oneLine: new Set(row2.map((c) => c.y)).size === 1 };
        }).toEqual({ frame: 1024, centred: true, oneLine: true });
    });

    test("E2: Mobile — the page 390px wide, centred in its panel, every placement the page's width, in row order", async ({ page }) => {
        const preview = await openPreview(page);
        await preview.locator('[data-publish-device="mobile"]').click();
        await expect.poll(async () => {
            const at = await measure(preview);
            const ys = at.cells.map((c) => c.y);
            return {
                frame: at.frame, centred: at.centred,
                keys: at.cells.map((c) => c.key),
                full: at.cells.every((c) => c.x === 0 && c.w === 390),
                stacked: ys.every((y, i) => i === 0 || y > ys[i - 1]!),
            };
        }).toEqual({ frame: 390, centred: true, keys: ["a-kpi", "a-orders", "a-bars", "a-trend"], full: true, stacked: true });
    });
});
