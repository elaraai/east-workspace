/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What a Studio placement holds, measured in a real browser (#1669): on the
 * content example's canvas a text block is its heading — a card title's: the
 * heading face, 18px, semibold, in the primary ink — over its paragraphs in
 * the body's size and the secondary ink, each 8px under the last, a line
 * break inside one kept; it is drawn with no frame, where the visual under it
 * is in a tile's. Every measurement is polled until it holds, on a page at
 * rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-content --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";

/** Open the content example and return its builder, at rest. */
async function openContent(page: Page): Promise<Locator> {
    await page.goto("/?theme=light#e3/studio/studio/studioContent");
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator('a[href="#e3/studio/studio/studioContent"]') });
    await entry.scrollIntoViewIfNeeded();
    const builder = entry.locator("[data-studio-builder]").first();
    await expect(builder.locator('[data-snap-grid-tile="s-note"] [data-studio-text]')).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return builder;
}

test.describe("Studio content (#1669)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("a text block is a card title's heading over body paragraphs in the secondary ink, 8px apart, with no frame; a visual is in a tile's", async ({ page }) => {
        const builder = await openContent(page);
        await expect.poll(() => builder.evaluate((root) => {
            const note = root.querySelector('[data-snap-grid-tile="s-note"]')!;
            const heading = note.querySelector("[data-studio-text-heading]")!;
            const paragraphs = [...note.querySelectorAll("[data-studio-text-paragraph]")];
            // The theme's own inks and heading face, read off the page.
            const themed = (property: "color" | "fontFamily", token: string) => {
                const probe = document.createElement("span");
                probe.style[property] = `var(${token})`;
                root.appendChild(probe);
                const value = getComputedStyle(probe)[property];
                probe.remove();
                return value;
            };
            const h = getComputedStyle(heading);
            const p = paragraphs.map((paragraph) => getComputedStyle(paragraph));
            const box = (el: Element) => el.getBoundingClientRect();
            return {
                heading: [h.fontSize, h.fontWeight, h.fontFamily === themed("fontFamily", "--chakra-fonts-heading"), h.color === themed("color", "--chakra-colors-fg")],
                paragraphs: p.map((style) => [style.fontSize, style.whiteSpace, style.color === themed("color", "--chakra-colors-fg-muted")]),
                // The heading, then each paragraph, 8px under the last.
                gaps: paragraphs.map((paragraph, at) => Math.round(box(paragraph).top - box(at === 0 ? heading : paragraphs[at - 1]!).bottom)),
                // Bare where a visual is framed.
                framed: [note.querySelector("[data-frame]") !== null, root.querySelector('[data-snap-grid-tile="s-revenue"] [data-frame]') !== null],
            };
        })).toEqual({
            heading: ["18px", "600", true, true],
            paragraphs: [["13px", "pre-line", true], ["13px", "pre-line", true]],
            gaps: [8, 8],
            framed: [false, true],
        });
    });

    test("the KPI rail's four figures stand in full rows — four abreast, or two and two — never three and one beside an empty block", async ({ page }) => {
        const builder = await openContent(page);
        await expect.poll(() => builder.evaluate((root) => {
            // The rail's grid, the first element in its tile laid out as one: each of its items a figure.
            const grid = [...root.querySelectorAll('[data-snap-grid-tile="s-kpi"] *')].find((el) => getComputedStyle(el).display === "grid");
            const figures = grid === undefined ? [] : [...grid.children];
            // The figures in each row, by where they stand.
            const rows = new Map<number, number>();
            for (const figure of figures) {
                const top = Math.round(figure.getBoundingClientRect().top);
                rows.set(top, (rows.get(top) ?? 0) + 1);
            }
            return { figures: figures.length, rows: [...rows.values()] };
        })).toEqual({ figures: 4, rows: [2, 2] });
    });
});
