/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The options a Studio chart and a value take (#1672), measured in a real
 * browser over the showcase's page of them and its builder:
 *
 *  - O1 a pie whose legend names its slices: beside the pie, a 26px row a
 *    slice — its swatch and its name, no value, no share, no note under them —
 *    no name cut; each slice says its name, its value and its share where the
 *    pointer rests.
 *  - O2 a pie with no legend has its frame to itself: as large as the frame
 *    holds, an even number of pixels across, in the middle of it, a whole
 *    number of pixels from its edges; a donut keeps its total.
 *  - O3 a chart whose legend is hidden draws none, and its plot takes the
 *    frame's whole height.
 *  - O4 a value's own format prints its numbers in place of its field's: a
 *    currency as a plain number, a percentage as a plain number.
 *  - O5 in the builder a chart's Legend is an option under its Stack, the same
 *    24px segments, no name cut: Hidden takes the legend off the tile, and a
 *    pie offers its values, its names or none.
 *  - O6 a value's menu holds its Format after which way is better: four 24px
 *    segments side by side, no name cut, a help line under them; a currency's
 *    code in a 32px box in a block under them; the menu no wider for it, and
 *    the tile printing as the format says.
 *
 * Every measurement is taken from the laid-out page.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-chart-options --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
import { openConfigure } from "./studio-configure-page";

/** The showcase's page of chart options. */
const PAGE = "e3/studio/studio/studioChartOptions";

/** A box, as the page lays it out. */
interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/**
 * Opens the page of chart options, its two pies, its columns and its summary drawn, at rest.
 *
 * @param page - The browser's page
 * @returns The page's grid
 */
async function openOptions(page: Page): Promise<Locator> {
    await page.goto(`/?theme=light#${PAGE}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${PAGE}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const grid = entry.locator("[data-snap-grid]").first();
    await expect(grid).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => grid.evaluate((root) => root.querySelectorAll("[data-chart-pie], [data-studio-summary], [data-studio-chart] svg.visx-svg, [data-studio-chart] svg").length), { timeout: 60_000 }).toBeGreaterThanOrEqual(4);
    await expect(grid.locator('[data-snap-grid-cell="c-formats"] tbody tr').first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return grid;
}

/** A pie of the page, read: its frame, its plot, its legend and what each row and slice says. */
function readPie(grid: Locator, key: string) {
    return grid.evaluate((root, cell) => {
        const box = (el: Element): Box => {
            const b = el.getBoundingClientRect();
            return { x: b.left, y: b.top, w: b.width, h: b.height };
        };
        const pie = root.querySelector(`[data-snap-grid-cell="${cell}"] [data-chart-pie]`)!;
        const legend = pie.querySelector("[data-chart-pie-legend]");
        return {
            says: pie.getAttribute("data-legend"), layout: pie.getAttribute("data-layout"),
            frame: box(pie), plot: box(pie.querySelector("svg")!), legend: legend === null ? null : box(legend),
            rows: [...pie.querySelectorAll("[data-chart-slice-entry]")].map((row) => ({
                h: row.getBoundingClientRect().height,
                texts: [...row.querySelectorAll("span")].map((span) => span.textContent ?? ""),
                cut: [...row.querySelectorAll("span")].some((span) => span.scrollWidth > span.clientWidth),
            })),
            titles: [...pie.querySelectorAll("path[data-chart-slice]")].map((path) => path.querySelector("title")?.textContent ?? null),
            note: pie.querySelector("[data-chart-pie-note]") !== null,
            total: pie.querySelector("[data-chart-pie-total]")?.textContent ?? null,
        };
    }, key);
}

/** A group of segments, read: its box, each segment's height and words — the chosen one starred — and whether any name is cut. */
function readStrip(root: Locator, name: string) {
    return root.evaluate((el, strip) => {
        const group = el.querySelector(`[data-seg-strip="${strip}"]`);
        if (group === null) return null;
        const box = group.getBoundingClientRect();
        const segments = [...group.querySelectorAll("button")];
        return {
            w: box.width, h: box.height,
            heights: segments.map((segment) => segment.getBoundingClientRect().height),
            words: segments.map((segment) => `${segment.textContent}${segment.getAttribute("aria-pressed") === "true" ? "*" : ""}`),
            cut: segments.some((segment) => segment.scrollWidth > segment.clientWidth),
        };
    }, name);
}

test.describe("The options a Studio chart and a value take (#1672)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("O1: a pie whose legend names its slices — a 26px row a slice, its swatch and its name alone, no note, beside the pie; each slice says the rest where the pointer rests", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const pie = await readPie(await openOptions(page), "c-names");
        expect([pie.says, pie.layout, pie.note]).toEqual(["names", "side", false]);
        expect(pie.rows.map((row) => [row.h, row.texts, row.cut])).toEqual([
            [26, ["", "Tools"], false], [26, ["", "Electrical"], false], [26, ["", "Garden"], false],
        ]);
        // The legend after the pie, 20 apart, each in the middle of the frame's height.
        expect(pie.legend!.x - (pie.plot.x + pie.plot.w)).toBe(20);
        expect(pie.legend!.h).toBe(3 * 26);
        expect(pie.titles).toEqual(["Tools · 10.7k · 52%", "Electrical · 5.4k · 26%", "Garden · 4.3k · 21%"]);
    });

    test("O2: a pie with no legend has its frame to itself — as large as it holds, even across, in its middle, a whole number of pixels from its edges; a donut keeps its total", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const pie = await readPie(await openOptions(page), "c-alone");
        expect([pie.says, pie.legend, pie.rows.length, pie.note]).toEqual(["hidden", null, 0, false]);
        const most = 2 * Math.floor(Math.min(pie.frame.w, pie.frame.h) / 2);
        expect([pie.plot.w, pie.plot.h]).toEqual([most, most]);
        const before = pie.plot.x - pie.frame.x;
        const after = pie.frame.x + pie.frame.w - (pie.plot.x + pie.plot.w);
        const over = pie.plot.y - pie.frame.y;
        const under = pie.frame.y + pie.frame.h - (pie.plot.y + pie.plot.h);
        // Whole pixels from the frame's edges, the odd one after it.
        expect([Number.isInteger(before), Number.isInteger(over)], `before ${before}, over ${over}`).toEqual([true, true]);
        expect([after - before === 0 || after - before === 1, under - over === 0 || under - over === 1], `${before}|${after} ${over}|${under}`).toEqual([true, true]);
        expect(pie.total).toBe("20.4k");
        expect(pie.titles[0]).toBe("SA · 6,484.00 · 32%");
    });

    test("O3: a chart whose legend is hidden draws none, and its plot takes its frame's whole height", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const grid = await openOptions(page);
        const read = await grid.evaluate((root) => {
            const chart = root.querySelector('[data-snap-grid-cell="c-columns"] [data-studio-chart]')!;
            return {
                legends: chart.querySelectorAll("[data-chart-legend]").length,
                series: chart.querySelectorAll("rect.visx-bar").length,
                frame: chart.getBoundingClientRect().height, plot: chart.querySelector("svg")!.getBoundingClientRect().height,
            };
        });
        expect(read.legends).toBe(0);
        // Three months of five regions' revenue, stacked: more than one series, which a legend would name.
        expect(read.series).toBeGreaterThan(3);
        expect(read.plot).toBe(read.frame);
    });

    test("O4: a value's own format prints its numbers in place of its field's — a currency's amount whole, a percentage as a number", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const grid = await openOptions(page);
        const table = grid.locator('[data-snap-grid-cell="c-formats"]');
        expect(await table.locator("th").allTextContents()).toEqual(["Region", "Revenue AUD", "Revenue, whole", "Average margin", "Margin, as a number"]);
        expect(await table.locator("tbody tr").first().locator("td").allTextContents()).toEqual(["SA", "6,484.00", "6,484", "19%", "0.19"]);
    });

    test("O5: in the builder a chart's Legend is an option under its Stack — the same 24px segments, no name cut; Hidden takes the legend off the tile; a pie offers its values, its names or none", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const { tile, tab } = await openConfigure(page);
        const options = tab.locator("[data-configure=options]");
        const stack = (await readStrip(options, "stack"))!;
        const legend = (await readStrip(options, "legend"))!;
        expect(legend).toEqual({ w: stack.w, h: 24, heights: [22, 22], words: ["Auto*", "Hidden"], cut: false });
        expect(await options.locator("[data-field]").evaluateAll((fields) => fields.map((field) => field.getAttribute("data-field")))).toEqual(["stack", "legend"]);
        await expect(tile.locator("[data-chart-legend]")).toHaveCount(1);
        await options.locator("[data-seg-strip=legend]").getByRole("button", { name: "Hidden" }).click();
        await expect(tile.locator("[data-chart-legend]")).toHaveCount(0);
        await options.locator("[data-seg-strip=legend]").getByRole("button", { name: "Auto" }).click();
        await expect(tile.locator("[data-chart-legend]")).toHaveCount(1);

        // A pie's legend: its values unless it says otherwise.
        await tab.locator("[data-seg-strip=kinds]").getByRole("button", { name: "Pie" }).click();
        await expect(tile.locator("[data-chart-pie]")).toHaveAttribute("data-legend", "values");
        await settled(page);
        expect(await readStrip(options, "legend")).toEqual({ w: stack.w, h: 24, heights: [22, 22, 22], words: ["Values*", "Names", "Hidden"], cut: false });
        const rows = () => tile.locator("[data-chart-slice-entry]").evaluateAll((entries) => entries.map((entry) => [...entry.querySelectorAll("span")].map((span) => span.textContent)));
        expect(await rows()).toEqual([["", "North", "539k", "42%"], ["", "South", "398k", "31%"], ["", "West", "347k", "27%"]]);
        await options.locator("[data-seg-strip=legend]").getByRole("button", { name: "Names" }).click();
        await expect(tile.locator("[data-chart-pie]")).toHaveAttribute("data-legend", "names");
        expect(await rows()).toEqual([["", "North"], ["", "South"], ["", "West"]]);
        await options.locator("[data-seg-strip=legend]").getByRole("button", { name: "Hidden" }).click();
        await expect(tile.locator("[data-chart-pie-legend]")).toHaveCount(0);
        await expect(tile.locator("path[data-chart-slice]")).toHaveCount(3);
    });

    test("O6: a value's menu holds its Format after which way is better — four 24px segments side by side, no name cut, its help under them; a currency's code a 32px box in a block under them; the tile prints as it says", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const { tile, tab } = await openConfigure(page);
        await tab.locator("[data-seg-strip=kinds]").getByRole("button", { name: "Pie" }).click();
        await expect(tile.locator("[data-chart-pie-note]")).toHaveText("USD · share of 1.28M");
        await tab.locator("[data-well=value] [data-pill-open]").click();
        const menu = page.locator("[data-pill-menu=value]");
        await expect(menu).toBeVisible();
        await settled(page);
        // Its width, to the pixel: the popover's opening leaves a hair of scale.
        const width = Math.round((await menu.boundingBox())!.width);
        expect(await menu.locator("[data-field]").evaluateAll((fields) => fields.map((field) => field.getAttribute("data-field")))).toEqual(["period", "goal", "better", "format", "label"]);
        const better = (await readStrip(menu, "better"))!;
        expect(await readStrip(menu, "format")).toEqual({ w: better.w, h: 24, heights: [22, 22, 22, 22], words: ["Auto*", "Number", "Percent", "Money"], cut: false });
        await expect(menu.locator("[data-field=format]")).toContainText("Auto shows it as its field's format says.");

        // A plain number: no currency to name under the legend.
        await menu.locator("[data-seg-strip=format]").getByRole("button", { name: "Number" }).click();
        await expect(tile.locator("[data-chart-pie-note]")).toHaveText("share of 1.28M");
        // A currency of its own: its field's code to begin with, in a block under the choice.
        await menu.locator("[data-seg-strip=format]").getByRole("button", { name: "Money" }).click();
        const code = menu.locator('[data-field="format.currency"]').getByRole("textbox", { name: "Currency code" });
        await expect(code).toHaveValue("USD");
        await settled(page);
        const block = await menu.evaluate((el) => {
            const origin = el.getBoundingClientRect();
            const field = el.querySelector('[data-field="format.currency"]')!.getBoundingClientRect();
            const format = el.querySelector('[data-field="format"]')!.getBoundingClientRect();
            const input = el.querySelector('[data-field="format.currency"] input')!.getBoundingClientRect();
            return { inset: field.left - format.left, under: field.top >= format.bottom, input: input.height, within: field.right <= origin.right, over: el.scrollWidth > el.clientWidth };
        });
        expect(block.inset).toBeGreaterThan(0);
        expect([block.under, block.input, block.within, block.over]).toEqual([true, 32, true, false]);
        expect(Math.round((await menu.boundingBox())!.width)).toBe(width);
        await code.fill("aud");
        await code.press("Enter");
        await expect(code).toHaveValue("AUD");
        await expect(tile.locator("[data-chart-pie-note]")).toHaveText("AUD · share of 1.28M");
        await page.keyboard.press("Escape");
    });
});
