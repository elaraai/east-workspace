/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Studio's page library, measured in a real browser (#997), against the
 * mock's markup: one 44px toolbar row, the 300px search at its start and the
 * primary action at its end after a rule (D1); the 224px pane beside the
 * rows, its rows 32px tall and the shown project in the brand (D2); the
 * templates four across 12px apart, each with an 80px wireframe on top and
 * Blank grid's the blank page (D3); the pages two across 14px apart, each at
 * least 140px tall with a 156px wireframe at its start, and the dashed card
 * last (D4). The frame is set to the mock's width, 1240px. Every measurement is
 * polled until it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-page-library --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** Open the page library example and return its frame, at rest, as wide as the mock's (1240px). */
async function openLibrary(page: Page): Promise<Locator> {
    await page.goto("/?theme=light#e3/studio/studio/studioLibrary");
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator('a[href="#e3/studio/studio/studioLibrary"]') });
    await entry.scrollIntoViewIfNeeded();
    const frame = entry.locator("[data-studio-page-library]").first();
    await expect(frame.locator("[data-library-card]").first()).toBeVisible({ timeout: 20_000 });
    await frame.evaluate((root) => { (root as HTMLElement).style.width = "1240px"; });
    await settled(page);
    return frame;
}

/** A gallery's cards — and its dashed card, as `+` — each box relative to the gallery's grid, to a tenth of a pixel. */
function cards(frame: Locator, row: "templates" | "pages"): Promise<Array<{ key: string; x: number; y: number; w: number; h: number }>> {
    return frame.evaluate((root, row) => {
        const gallery = root.querySelector(`[data-library$=".${row}"]`)!;
        const grid = gallery.querySelector("[data-layout]")!.getBoundingClientRect();
        const tenth = (n: number) => Math.round(n * 10) / 10;
        return [...gallery.querySelectorAll("[data-library-card], [data-library-add]")].map((el) => {
            const b = el.getBoundingClientRect();
            return {
                key: el.getAttribute("data-library-card") ?? "+",
                x: tenth(b.left - grid.left), y: tenth(b.top - grid.top), w: tenth(b.width), h: tenth(b.height),
            };
        });
    }, row);
}

test.describe("Studio page library (#997)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("D1: one 44px toolbar row — the 300px search at its start, the primary action at its end after a 1px rule", async ({ page }) => {
        const frame = await openLibrary(page);
        await expect.poll(() => frame.evaluate((root) => {
            const band = root.firstElementChild!.getBoundingClientRect();
            const search = root.querySelector("[data-toolbar-item=search]")!.getBoundingClientRect();
            const rule = root.querySelector("[data-toolbar-item=rule] > *")!.getBoundingClientRect();
            const action = root.querySelector("[data-page-library-new]")!.getBoundingClientRect();
            return {
                band: Math.round(band.height), rows: root.querySelectorAll("[data-toolbar]").length,
                search: [Math.round(search.left - band.left), Math.round(search.width)],
                rule: [Math.round(rule.width), Math.round(rule.height)], afterRule: rule.right <= action.left,
                action: [Math.round(band.right - action.right), Math.round(action.height)],
            };
        })).toEqual({ band: 44, rows: 1, search: [16, 300], rule: [1, 18], afterRule: true, action: [16, 28] });
    });

    test("D2: the pane is 224px wide beside the rows, its rows 32px tall; the shown project in the brand", async ({ page }) => {
        const frame = await openLibrary(page);
        await expect.poll(() => frame.evaluate((root) => {
            const pane = root.querySelector("[data-page-library-pane]")!.getBoundingClientRect();
            const rows = [...root.querySelectorAll("[data-page-library-project], [data-page-library-page]")].map((r) => Math.round(r.getBoundingClientRect().height));
            const active = root.querySelector("[data-page-library-project][data-active]")!;
            const idle = root.querySelector("[data-page-library-project]:not([data-active])")!;
            return {
                pane: Math.round(pane.width), rows: [...new Set(rows)],
                tinted: getComputedStyle(active).backgroundColor !== getComputedStyle(idle).backgroundColor,
                legendAtFoot: Math.round(pane.bottom - root.querySelector("[data-page-library-legend]")!.getBoundingClientRect().bottom),
            };
        })).toEqual({ pane: 224, rows: [32], tinted: true, legendAtFoot: 16 });
    });

    test("D3: the templates four across, 12px apart, each with an 80px wireframe on top; Blank grid's is the blank page", async ({ page }) => {
        const frame = await openLibrary(page);
        await expect.poll(async () => {
            const b = await cards(frame, "templates");
            return {
                keys: b.map((c) => c.key), line: new Set(b.map((c) => c.y)).size, widths: new Set(b.map((c) => c.w)).size,
                gaps: b.slice(1).map((c, i) => Math.round(c.x - (b[i]!.x + b[i]!.w))),
            };
        }).toEqual({ keys: ["", "Ops board", "Report brief", "Summary"], line: 1, widths: 1, gaps: [12, 12, 12] });
        await expect.poll(() => frame.evaluate((root) => {
            const card = root.querySelector('[data-library$=".templates"] [data-library-card=""]')!;
            const media = card.querySelector("[data-library-media]")!.getBoundingClientRect();
            const band = card.querySelector('[data-snap-grid-blank="band"]')!;
            const body = card.querySelector('[data-snap-grid-blank="body"]')!.getBoundingClientRect();
            return {
                media: Math.round(media.height), top: Math.round(media.top - card.getBoundingClientRect().top),
                band: [Math.round(band.getBoundingClientRect().height), getComputedStyle(band).borderTopStyle],
                bodyToFoot: Math.round(media.bottom - body.bottom),
            };
        })).toEqual({ media: 80, top: 1, band: [12, "dashed"], bodyToFoot: 13 });
    });

    test("D4: the pages two across, 14px apart, each at least 140px tall with a 156px wireframe at its start; the dashed card last", async ({ page }) => {
        const frame = await openLibrary(page);
        await expect.poll(async () => {
            const b = await cards(frame, "pages");
            return {
                keys: b.map((c) => c.key),
                columns: [...new Set(b.map((c) => c.x))].length,
                gapX: Math.round(b[1]!.x - (b[0]!.x + b[0]!.w)), gapY: Math.round(b[2]!.y - (b[0]!.y + b[0]!.h)),
                tall: b.every((c) => c.h >= 140),
            };
        }).toEqual({ keys: ["Account detail", "Overview", "Regional rollup", "Weekly export", "+"], columns: 2, gapX: 14, gapY: 14, tall: true });
        await expect.poll(() => frame.evaluate((root) => {
            const card = root.querySelector('[data-library$=".pages"] [data-library-card="Overview"]')!;
            const media = card.querySelector("[data-library-media]")!.getBoundingClientRect();
            const c = card.getBoundingClientRect();
            const cells = [...card.querySelectorAll("[data-snap-grid-cell]")].map((cell) => cell.getBoundingClientRect());
            return {
                media: [Math.round(media.left - c.left), Math.round(media.width)],
                // The wireframe fills the media's box, 14px in — the media's rule on its right.
                inset: [Math.round(Math.min(...cells.map((b) => b.left)) - media.left), Math.round(media.right - Math.max(...cells.map((b) => b.right)))],
            };
        })).toEqual({ media: [1, 156], inset: [14, 15] });
    });
});
