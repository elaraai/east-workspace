/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Studio tiles at every size (#1692), measured in a real browser over the
 * showcase's pages of tiles — each tile the Studio draws, in its
 * configurations, at a narrow, a small and a wide span — with the page's grid
 * set to each width a page could give it, a wide desktop's to a phone's (the
 * showcase's own frame, which holds an example to under a thousand pixels,
 * aside). From 960px the grid gives a tile its span — a narrow one 153px wide
 * at 960 — and under it half the grid or all of it, then under 480px all of
 * it: every width a tile can be drawn at on a page is read. In every tile,
 * every part:
 *
 *  - T1 lies inside its tile's frame;
 *  - T2 lies over no other part;
 *  - T3 stands on one line, its words whole, or ended in an ellipsis with
 *    the whole on hover;
 *  - T4 a number stands whole: never cut, never ended in an ellipsis;
 *  - T5 neither the tile nor anything in it scrolls sideways.
 *
 * Every measurement is taken from the laid-out page; a failure names the
 * tile, the page width, the rule and the part.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-tile-sizes --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";

/** The widths a page's grid is read at: a wide desktop's, through the grid's half and whole tiers, to a phone's. */
const WIDTHS = [1800, 1600, 1440, 1320, 1200, 1120, 1040, 960, 900, 800, 700, 600, 520, 480, 440, 390, 360, 320] as const;

/** A page of tiles: its example, how many tiles it places, and what a tile drawn from its answer is. */
interface TilePage {
    readonly hash: string;
    readonly tiles: number;
    readonly drawn: string;
}

/** Every KPI configuration, each at a narrow, a small and a wide span. */
const KPI_SIZES: TilePage = { hash: "e3/studio/tiles/studioKpiSizes", tiles: 36, drawn: "[data-studio-kpi]" };

/** The parts of a tile the rules read, by name: its eyebrow's, and a KPI's. */
const PARTS: Readonly<Record<string, string>> = {
    name: "[data-studio-visual-name]",
    meta: "[data-studio-visual-meta]",
    menu: "[data-studio-visual-menu]",
    value: "[data-studio-kpi-value]",
    unit: "[data-studio-kpi-unit]",
    change: "[data-studio-kpi-change]",
    goal: "[data-studio-kpi-goal]",
    trend: "[data-studio-kpi-trend]",
    note: "[data-studio-kpi-note]",
};

/** The parts whose words are numbers (T4). */
const NUMBERS: readonly string[] = ["value", "change"];

/** The parts drawn, not written: no line of words to read. */
const DRAWINGS: readonly string[] = ["menu", "goal", "trend"];

/**
 * Opens a page of tiles on a wide screen, every tile drawn from its answer, at rest.
 *
 * @param page - The browser's page
 * @param at - The page of tiles
 * @returns The page's grid
 */
async function openTiles(page: Page, at: TilePage): Promise<Locator> {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto(`/?theme=light#${at.hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${at.hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const grid = entry.locator("[data-snap-grid]").first();
    await expect(grid).toBeVisible({ timeout: 30_000 });
    // e3 in the page answers each tile's programs: every tile drawn.
    await expect.poll(() => grid.evaluate((root, drawn) => root.querySelectorAll(drawn).length, at.drawn), { timeout: 120_000 }).toBe(at.tiles);
    await settled(page);
    return grid;
}

/**
 * What is wrong with a page's tiles at a grid width: each a line naming the
 * tile, the width, the rule and the part — none when every tile stands whole.
 *
 * @param grid - The page's grid
 * @param width - The grid's width, as each line names it
 * @returns The faults
 */
function faultsOf(grid: Locator, width: number): Promise<string[]> {
    return grid.evaluate((root, { parts, numbers, drawings, width }) => {
        const bad: string[] = [];
        const r = (n: number) => Math.round(n * 10) / 10;
        const box = (b: DOMRect) => `${r(b.left)},${r(b.top)} ${r(b.width)}×${r(b.height)}`;
        /** The lines a part's words stand on: its text's boxes, a new line where one starts under the last line's foot. */
        const lines = (el: HTMLElement) => {
            const rects: DOMRect[] = [];
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
                if ((node.textContent ?? "").trim() === "") continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 0));
            }
            rects.sort((a, b) => a.top - b.top);
            let count = 0;
            let foot = -Infinity;
            for (const rect of rects) {
                if (rect.top >= foot - 1) {
                    count++;
                    foot = rect.bottom;
                } else foot = Math.max(foot, rect.bottom);
            }
            return count;
        };
        for (const cell of root.querySelectorAll<HTMLElement>("[data-snap-grid-cell]")) {
            const tile = `${cell.getAttribute("data-snap-grid-cell")} (${r(cell.getBoundingClientRect().width)}px) in a ${width}px grid`;
            const frame = cell.getBoundingClientRect();
            const found = Object.entries(parts).flatMap(([name, selector]) => [...cell.querySelectorAll<HTMLElement>(selector)]
                .map((el) => ({ name, el, at: el.getBoundingClientRect() })))
                .filter((part) => part.at.width > 0 && part.at.height > 0);
            for (const part of found) {
                const { name, el, at } = part;
                // T1: inside the tile's frame.
                if (at.left < frame.left - 0.5 || at.right > frame.right + 0.5 || at.top < frame.top - 0.5 || at.bottom > frame.bottom + 0.5) {
                    bad.push(`${tile}: T1 ${name} at ${box(at)} past the tile at ${box(frame)}`);
                }
                if (drawings.includes(name) || (el.textContent ?? "").trim() === "") continue;
                // T3, T4: its words on one line, whole — or, words not a number, ended in an ellipsis with the whole on hover.
                const n = lines(el);
                if (n > 1) bad.push(`${tile}: T3 ${name} “${el.textContent}” on ${n} lines`);
                if (el.scrollWidth > el.clientWidth + 0.5) {
                    const look = getComputedStyle(el);
                    const ended = look.textOverflow === "ellipsis" && look.overflowX !== "visible";
                    const whole = (el.closest("[title]")?.getAttribute("title") ?? "").includes((el.textContent ?? "").trim());
                    if (numbers.includes(name)) bad.push(`${tile}: T4 ${name} “${el.textContent}” cut, ${r(el.scrollWidth)} in ${r(el.clientWidth)}`);
                    else if (!ended || !whole) bad.push(`${tile}: T3 ${name} “${el.textContent}” cut ${ended ? "with no whole on hover" : "with no ellipsis"}, ${r(el.scrollWidth)} in ${r(el.clientWidth)}`);
                }
            }
            // T2: no part over another.
            for (let i = 0; i < found.length; i++) {
                for (let j = i + 1; j < found.length; j++) {
                    const a = found[i]!, b = found[j]!;
                    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
                    const w = Math.min(a.at.right, b.at.right) - Math.max(a.at.left, b.at.left);
                    const h = Math.min(a.at.bottom, b.at.bottom) - Math.max(a.at.top, b.at.top);
                    if (w > 0.5 && h > 0.5) bad.push(`${tile}: T2 ${a.name} at ${box(a.at)} over ${b.name} at ${box(b.at)}`);
                }
            }
            // T5: nothing scrolls sideways — the tile, or anything in it.
            for (const el of [cell, ...cell.querySelectorAll<HTMLElement>("*")]) {
                const look = getComputedStyle(el);
                const scrolls = el === cell || look.overflowX === "auto" || look.overflowX === "scroll";
                if (scrolls && el.scrollWidth > el.clientWidth + 0.5) {
                    bad.push(`${tile}: T5 ${el === cell ? "the tile" : el.tagName.toLowerCase()} scrolls sideways, ${r(el.scrollWidth)} in ${r(el.clientWidth)}`);
                }
            }
        }
        return bad;
    }, { parts: PARTS, numbers: NUMBERS, drawings: DRAWINGS, width });
}

/**
 * Reads a page of tiles with its grid at every width: what is wrong at each.
 *
 * @param page - The browser's page
 * @param at - The page of tiles
 * @returns Every fault, at every width
 */
async function readEveryWidth(page: Page, at: TilePage): Promise<string[]> {
    const grid = await openTiles(page, at);
    const found: string[] = [];
    for (const width of WIDTHS) {
        // The grid at the width a page that wide gives it: its tiers answer the grid's own width.
        await grid.evaluate((root, w) => { root.querySelector<HTMLElement>("[data-snap-grid-body]")!.style.width = `${w}px`; }, width);
        await settled(page);
        found.push(...await faultsOf(grid, width));
    }
    return found;
}

test.describe("Studio tiles at every size (#1692)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, from the desktop project, at every grid width");

    test("KPIs: every configuration at every span and grid width — inside its tile, over no other part, on one line whole or ended with the whole on hover, its numbers whole, nothing scrolling sideways", async ({ page }) => {
        expect(await readEveryWidth(page, KPI_SIZES)).toEqual([]);
    });
});
