/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A Studio page's filter rail (#1673), measured in a real browser over the
 * showcase's page of visuals and its builder:
 *
 *  - F1 on a page the rail is a toolbar row over the grid: 28px, the grid 12
 *    under it, no border of its own; with no filter it is its `+ FILTER` chip
 *    after the rail's icon.
 *  - F2 a filter is written with the query builder's condition rows, in the
 *    chip's popover: a field, then a value from the values the source holds
 *    with how many rows hold each, read from e3 — and the chooser stands
 *    whole inside the popover, never cut by it.
 *  - F3 the filter is a chip in the rows' words, and every visual of its
 *    source narrows: the tiles ask again, on e3.
 *  - F4 the chip's × takes the filter out, and the tiles are as they were.
 *  - F5 in the builder the rail is an item of its one toolbar, before the
 *    row's end items, 28px as every control of the row.
 *  - F6 as the page narrows the rail folds its chips one at a time into
 *    `+N more` — every filter a chip or counted, the row 28px and never wider
 *    than its page — and `+N more` opens one popover that lists them all,
 *    whose Clear all takes every one out.
 *  - F7 on a phone the builder's toolbar holds the rail's Filters button, a
 *    44px target named by what is set; it opens the Filters view over the
 *    whole builder, whose Filters row opens the chips and `+ add filter`.
 *
 * Every measurement is taken from the laid-out page.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-filters --project desktop`.
 */

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
import { openVisuals } from "./studio-visuals-page";

/** The showcase's builder over a page of content, whose visuals read one source. */
const BUILDER = "e3/studio/studio/studioContent";

/** The page's first KPI's value: the quarter's revenue. */
const revenue = (grid: Locator) => grid.locator('[data-snap-grid-cell="v-revenue"] [data-studio-kpi-value]');

test.describe("A Studio page's filter rail (#1673)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("F1: on a page the rail is a 28px toolbar row over the grid, 12 above it, with no border; with no filter, its + FILTER chip after its icon", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        const read = await grid.evaluate((root) => {
            const rail = root.parentElement!.querySelector("[data-studio-filters]")!;
            const box = rail.getBoundingClientRect();
            const style = getComputedStyle(rail);
            const add = rail.querySelector("[data-slice-add=filter]")!.getBoundingClientRect();
            return {
                h: box.height, toGrid: root.getBoundingClientRect().top - box.bottom, sameStart: box.left === root.getBoundingClientRect().left,
                borders: [style.borderTopWidth, style.borderBottomWidth, style.borderLeftWidth, style.borderRightWidth],
                chips: rail.querySelectorAll("[data-slice-clause]").length, add: [add.height, add.left > box.left],
            };
        });
        expect(read).toEqual({ h: 28, toGrid: 12, sameStart: true, borders: ["0px", "0px", "0px", "0px"], chips: 0, add: [28, true] });
    });

    test("F2, F3, F4: a filter written with the condition rows — a field, a value from the source's own with its count, the chooser whole inside the popover — is a chip in words that narrows every visual of its source; its × puts them back", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const grid = await openVisuals(page, "light");
        const rail = grid.locator("xpath=..").locator("[data-studio-filters]");
        const all = await revenue(grid).textContent();
        await rail.locator("[data-slice-add=filter]").click();
        const rows = page.locator("[data-studio-filter-rows]");
        await expect(rows).toBeVisible();
        await settled(page);
        // The rows alone: no step card, number or toolbar of the query builder's.
        expect(await rows.locator("[data-step-id], [data-query-shape-text]").count()).toBe(0);
        await rows.locator("[aria-haspopup=listbox]").first().click();
        const chooser = page.locator("[data-query-autocomplete]");
        await expect(chooser).toBeVisible();
        await settled(page);
        /** Whether the chooser stands whole inside the rows' block, on top, tall enough for its offers. */
        const whole = () => chooser.evaluate((el) => {
            const box = el.getBoundingClientRect();
            const within = document.querySelector("[data-studio-filter-rows]")!.getBoundingClientRect();
            const hit = document.elementFromPoint(box.left + box.width / 2, box.bottom - 8);
            return {
                inside: box.left >= within.left && box.right <= within.right && box.top >= within.top && box.bottom <= within.bottom + 0.5,
                onTop: hit !== null && el.contains(hit), tall: box.height >= 200,
            };
        });
        expect(await whole()).toEqual({ inside: true, onTop: true, tall: true });
        await chooser.locator("[role=option]", { hasText: "region" }).first().click();
        // The field's value opens next: the values the orders hold, each with its rows.
        await expect(chooser.locator("[role=option]", { hasText: "SA" })).toBeVisible({ timeout: 20_000 });
        await settled(page);
        const offers = await chooser.locator("[role=option]").allTextContents();
        expect(offers.every((offer) => /\d+ orders?$/.test(offer)), offers.join(" | ")).toBe(true);
        expect(await whole()).toEqual({ inside: true, onTop: true, tall: true });
        await chooser.locator("[role=option]", { hasText: "SA" }).first().click();

        // The filter is a chip in the rows' words, and the page's revenue is South Australia's alone.
        await expect(rail.locator("[data-slice-clause]")).toHaveAttribute("title", "region is SA");
        await expect(revenue(grid)).not.toHaveText(all ?? "");
        const narrowed = await revenue(grid).textContent();
        expect(narrowed).toBe("6,484.00");
        // Its ×: the filter out, the tiles as they were.
        await page.keyboard.press("Escape");
        await rail.locator("[data-slice-clause] [data-chip-remove]").click();
        await expect(rail.locator("[data-slice-clause]")).toHaveCount(0);
        await expect(revenue(grid)).toHaveText(all ?? "");
    });

    test("F5: in the builder the rail is an item of its one toolbar, before the row's end items, 28px as every control of the row — its chips, or its Filters chip where the row is short of room", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.goto(`/?theme=light#${BUILDER}`);
        await page.waitForSelector("header", { timeout: 20_000 });
        const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${BUILDER}"]`) });
        await entry.scrollIntoViewIfNeeded();
        await expect(entry.locator("[data-slice-rail='studio-filters']")).toBeVisible({ timeout: 30_000 });
        await settled(page);
        const read = await entry.evaluate((root) => {
            const rail = root.querySelector<HTMLElement>("[data-slice-rail='studio-filters']")!;
            const box = rail.getBoundingClientRect();
            // The row's end: Preview, or the chip the end items fold into.
            const end = (root.querySelector<HTMLElement>("[data-studio-preview]") ?? root.querySelector<HTMLElement>("[data-studio-more]"))!.getBoundingClientRect();
            return {
                h: box.height, beforeEnd: box.right <= end.left,
                sameRow: Math.abs((box.top + box.bottom) / 2 - (end.top + end.bottom) / 2) <= 0.5,
                drawn: rail.querySelector("[data-slice-add=filter], [data-slot=railTrigger]") !== null,
            };
        });
        expect(read).toEqual({ h: 28, beforeEnd: true, sameRow: true, drawn: true });
    });
    test("F6: as the page narrows the rail folds its chips one at a time into +N more, 28px and never wider than its page; +N more lists every filter, and its Clear all takes them out", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const grid = await openVisuals(page, "light");
        const rail = grid.locator("xpath=..").locator("[data-studio-filters]");
        /** Adds a filter through the rail: a field, then one of its source's values. */
        const add = async (field: string, value: string) => {
            await rail.locator("[data-slice-add=filter]").click();
            const rows = page.locator("[data-studio-filter-rows]");
            await expect(rows).toBeVisible();
            await rows.locator("[aria-haspopup=listbox]").first().click();
            const chooser = page.locator("[data-query-autocomplete]");
            await chooser.locator("[role=option]", { hasText: field }).first().click();
            await expect(chooser.locator("[role=option]", { hasText: value }).first()).toBeVisible({ timeout: 20_000 });
            await chooser.locator("[role=option]", { hasText: value }).first().click();
            await page.keyboard.press("Escape");
            await settled(page);
        };
        await add("region", "SA");
        await add("category", "Tools");
        await add("customer", "Northwind");
        /** The rail as drawn: its width, its chips, how many `+N more` counts, and whether anything runs past it. */
        const read = () => rail.evaluate((el) => {
            const more = el.querySelector("[data-slice-more]")?.textContent ?? "";
            return {
                width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
                chips: el.querySelectorAll("[data-slice-clause]").length, folded: Number(/\d+/.exec(more)?.[0] ?? 0),
                add: el.querySelector("[data-slice-add=filter]") !== null,
                fits: el.scrollWidth <= el.clientWidth && document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            };
        });
        const drawn: Awaited<ReturnType<typeof read>>[] = [];
        for (const width of [1440, 900, 480, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await settled(page);
            // The toolbar chooses its form by its measured room: read it once it has.
            await expect.poll(async () => { const now = await read(); return now.chips + now.folded; }).toBe(3);
            const now = await read();
            expect([now.height, now.add, now.fits], `at ${width}px`).toEqual([28, true, true]);
            drawn.push(now);
        }
        // The wider the rail, the more chips it shows; at its widest every one, at a phone's none.
        const byWidth = [...drawn].sort((a, b) => a.width - b.width);
        expect(byWidth.every((now, at) => at === 0 || now.chips >= byWidth[at - 1]!.chips)).toBe(true);
        expect([byWidth[byWidth.length - 1]!.chips, byWidth[0]!.chips, byWidth[0]!.folded]).toEqual([3, 0, 3]);

        // +N more: one popover that lists every filter, and clears them.
        await rail.locator("[data-slice-more]").click();
        const popover = page.getByRole("dialog").filter({ hasText: "3 active filters" });
        await expect(popover).toBeVisible();
        for (const words of ["region is SA", "category is Tools", "customer is Northwind"]) await expect(popover).toContainText(words);
        await popover.getByRole("button", { name: "Clear all" }).click();
        await expect.poll(async () => { const now = await read(); return [now.chips, now.folded]; }).toEqual([0, 0]);
    });

    test("F7: on a phone the builder's toolbar holds the rail's Filters button — 44px, named by what is set — which opens the Filters view over the builder, its Filters row opening the chips' editor", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/?theme=light#${BUILDER}`);
        await page.waitForSelector("header", { timeout: 20_000 });
        const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${BUILDER}"]`) });
        await entry.scrollIntoViewIfNeeded();
        const builder = entry.locator("[data-studio-builder]");
        const button = builder.locator("[data-slice-rail='studio-filters'] [data-rail-phone]");
        await expect(button).toBeVisible({ timeout: 30_000 });
        await settled(page);
        const drawn = await button.evaluate((el) => {
            const box = el.getBoundingClientRect();
            const frame = el.closest("[data-studio-builder]")!.getBoundingClientRect();
            return { w: box.width, h: box.height, name: el.getAttribute("aria-label"), inside: box.left >= frame.left && box.right <= frame.right, fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
        });
        expect(drawn).toEqual({ w: 44, h: 44, name: "Filters: No filters", inside: true, fits: true });
        await button.click();
        const view = page.locator("[data-slice-filters-view]");
        await expect(view).toBeVisible();
        await settled(page);
        // The view covers the builder: as wide as it, its head saying nothing is set.
        const frame = await builder.boundingBox();
        const panel = await view.boundingBox();
        expect([Math.round(panel!.width), Math.round(panel!.x)]).toEqual([Math.round(frame!.width), Math.round(frame!.x)]);
        await expect(view.locator("[data-filters-active]")).toHaveText("none active");
        // Its one field, Filters: Any until one is set; opened, the chips' editor with its add.
        const row = view.locator("[data-slice-section=filter]");
        await expect(row).toContainText("Any");
        await row.click();
        const editor = view.locator("[data-slice-filters-editor=filter]");
        await expect(editor.locator("[data-slice-add=filter]")).toBeVisible();
        expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        await view.locator("[data-filters-done]").click();
        await expect(view).toHaveCount(0);
    });
});
