/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Studio's canvas, measured in a real browser (#995): one 44px toolbar
 * across the builder's frame, over the palette's 264px pane and the canvas
 * column, whose selection bar is 44px; the palette collapses to a 44px rail
 * and the canvas column takes the room (B13), and so does the inspector's
 * 300px pane after it (B15, #996). The toolbar folds by one
 * ladder — the grid chip first, then the width readout, then the widths to
 * their icons, the history item last — so whatever a narrower frame folds is
 * the ladder's first steps (B8). Every measurement is polled until it holds,
 * on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-canvas --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** Open the canvas example and return its builder frame, at rest. */
async function openCanvas(page: Page): Promise<Locator> {
    await page.goto("/?theme=light#e3/studio/canvas/studioCanvas");
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator('a[href="#e3/studio/canvas/studioCanvas"]') });
    await entry.scrollIntoViewIfNeeded();
    const editor = entry.locator("[data-snap-grid-editor]").first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return editor;
}

/** A part's rounded box within the frame. */
function box(editor: Locator, selector: string): Promise<{ w: number; h: number }> {
    return editor.evaluate((root, sel) => {
        const b = root.querySelector(sel)!.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height) };
    }, selector);
}

test.describe("Studio canvas (#995)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("B13: a 44px toolbar over the palette's 264px pane and the canvas column, whose selection bar is 44px; collapsed, the palette is a 44px rail and the column takes the room", async ({ page }) => {
        const editor = await openCanvas(page);
        await expect.poll(async () => ({
            toolbar: (await box(editor, "[data-snap-grid-toolbar-row]")).h,
            pane: (await box(editor, "[data-snap-grid-pane='start']")).w,
            bar: (await box(editor, "[data-snap-grid-selection]")).h,
        })).toEqual({ toolbar: 44, pane: 264, bar: 44 });
        const before = (await box(editor, "[data-snap-grid-main]")).w;

        await editor.getByRole("button", { name: "Collapse Components" }).click();
        await expect.poll(async () => (await box(editor, "[data-snap-grid-pane='start']")).w).toBe(44);
        await expect.poll(async () => (await box(editor, "[data-snap-grid-main]")).w).toBe(before + 220);
    });

    test("B15 (#996): the inspector's pane is 300px after the canvas column; collapsed, it is a 44px rail and the column takes the room", async ({ page }) => {
        const editor = await openCanvas(page);
        await expect.poll(async () => (await box(editor, "[data-snap-grid-pane='end']")).w).toBe(300);
        const before = (await box(editor, "[data-snap-grid-main]")).w;

        await editor.getByRole("button", { name: "Collapse Inspector" }).click();
        await expect.poll(async () => (await box(editor, "[data-snap-grid-pane='end']")).w).toBe(44);
        await expect.poll(async () => (await box(editor, "[data-snap-grid-main]")).w).toBe(before + 256);
    });

    test("B8: the toolbar folds by one ladder — the grid chip, the width readout, the widths, the history item — and a narrower frame folds its first steps", async ({ page }) => {
        const editor = await openCanvas(page);
        const toolbar = editor.locator("[data-snap-grid-toolbar-row] [data-toolbar]");
        await expect.poll(() => toolbar.getAttribute("data-toolbar-ladder")).toBe("grid>1 readout>1 widths>1 history>1");
        // At the mock's 1440px frame nothing folds.
        await editor.evaluate((root) => { (root as HTMLElement).style.width = "1440px"; });
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
});
