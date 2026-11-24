/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A Studio list, summary and pivot page their rows (#1667), measured in a
 * real browser on the showcase's page of visuals, e3 answering in the page.
 * The spec writes three visuals after the page's own, each of the quarter's
 * working days a row — more than one page of them — as another session's
 * publish would:
 *
 *  - PG1 a list of the days, highest revenue first, holds 50 a page: its foot
 *    says `Showing 1–50 of N` beside its pager, and the next page holds the
 *    rest, `Showing 51–N of N`; its ranking bars measure every day against the
 *    largest of all of them, so no bar of the second page is longer than any
 *    of the first.
 *  - PG2 a summary of the days pages alike, its total row every day's on both
 *    pages.
 *  - PG3 a pivot of the days by region pages its rows over the same columns,
 *    its heat legend the same on both pages: its ramp is every pair's.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-paging --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { some, variant } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import { installE3Faults } from "./e3-faults";
import { test } from "./kept-page";
import { settled } from "./settle";
import { HASH, writeVisuals, type Cells } from "./studio-visuals-page";

const vis = Studio.visual;
const day = vis.group("ordered_at", { bucket: "day" });

/** Three visuals of the quarter's days, a row each: a list, a summary with its total row, and a pivot by region. */
const PAGED: Cells = [
    { key: "p-list", row: "r8", span: 12n, height: some(420n), align: variant("stretch", null), title: some("Days by revenue"), content: vis.of("orders", vis.list({ item: vis.group("ordered_at", { bucket: "day", sort: "high" }), values: [vis.sum("revenue")], bar: true })) },
    { key: "p-summary", row: "r9", span: 12n, height: some(420n), align: variant("stretch", null), title: some("Revenue by day"), content: vis.of("orders", vis.summary({ rows: [day], values: [vis.sum("revenue")], total: true })) },
    { key: "p-pivot", row: "r10", span: 12n, height: some(420n), align: variant("stretch", null), title: some("Orders by day and region"), content: vis.of("orders", vis.pivot({ rows: day, columns: vis.group("region"), value: vis.count(), heat: true })) },
];

/** Opens the page of visuals with the three paged visuals written after its own, each drawn, at rest. */
async function openPaged(page: Page): Promise<Locator> {
    await installE3Faults(page);
    await page.goto(`/?theme=light#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const grid = entry.locator("[data-snap-grid]").first();
    await expect(grid).toBeVisible({ timeout: 20_000 });
    await writeVisuals(page, (seeded) => ({ ...seeded, cells: [...seeded.cells, ...PAGED] }));
    for (const cell of PAGED) await expect(footOf(grid, cell.key).locator("[data-studio-visual-note]")).toHaveText(/^Showing 1–50 of \d+$/, { timeout: 60_000 });
    await settled(page);
    return grid;
}

/** A placement's tile. */
function tileOf(grid: Locator, key: string): Locator {
    return grid.locator(`[data-studio-visual-tile][data-studio-placement="${key}"]`);
}

/** A placement's foot — the footer band every paged view draws: where its page stands, and its pager. */
function footOf(grid: Locator, key: string): Locator {
    return tileOf(grid, key).locator("[data-page-foot]");
}

/** How many rows a tile's foot says there are: the N of `Showing 1–50 of N`. */
async function totalOf(grid: Locator, key: string): Promise<number> {
    const said = await footOf(grid, key).locator("[data-studio-visual-note]").textContent();
    const total = Number(/of (\d+)$/u.exec(said ?? "")?.[1]);
    expect(total, `${key}'s rows`).toBeGreaterThan(50);
    return total;
}

/** Turns a tile to its second page with its pager, and waits for it to land. */
async function secondPage(grid: Locator, key: string, total: number): Promise<void> {
    await footOf(grid, key).locator("[data-scope=pagination] [data-part=item]", { hasText: /^2$/u }).click();
    await expect(footOf(grid, key).locator("[data-studio-visual-note]")).toHaveText(`Showing 51–${total} of ${total}`, { timeout: 60_000 });
    await expect(tileOf(grid, key).locator("[data-waiting]")).toHaveCount(0, { timeout: 60_000 });
}

test.describe("Studio visuals page their rows (#1667)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("PG1: a list holds 50 days a page, the next page the rest, every bar against the largest of all of them", async ({ page }) => {
        const grid = await openPaged(page);
        const total = await totalOf(grid, "p-list");
        const bars = () => tileOf(grid, "p-list").locator("[data-studio-list-bar] > *").evaluateAll((fills) => fills.map((fill) => Number.parseFloat((fill as HTMLElement).style.width)));
        const first = await bars();
        expect([first.length, first[0]]).toEqual([50, 100]);
        await secondPage(grid, "p-list", total);
        const second = await bars();
        expect(second).toHaveLength(total - 50);
        // Highest first, against the largest of every day: the second page's longest is no longer than the first's shortest.
        expect(Math.max(...second)).toBeLessThanOrEqual(Math.min(...first));
    });

    test("PG2: a summary pages alike, its total row every day's on both pages", async ({ page }) => {
        const grid = await openPaged(page);
        const total = await totalOf(grid, "p-summary");
        const tile = tileOf(grid, "p-summary");
        const totalRow = () => tile.locator("tfoot tr[data-table-total]").textContent();
        const firstRow = () => tile.locator("tbody tr").first().textContent();
        const [sum, opening] = [await totalRow(), await firstRow()];
        await secondPage(grid, "p-summary", total);
        expect(await totalRow()).toBe(sum);
        expect(await firstRow()).not.toBe(opening);
    });

    test("PG3: a pivot pages its rows over the same columns, its heat legend the same on both pages", async ({ page }) => {
        const grid = await openPaged(page);
        const total = await totalOf(grid, "p-pivot");
        const tile = tileOf(grid, "p-pivot");
        const columns = () => tile.locator("[data-slot=headerCell]").allTextContents();
        const legend = () => tile.locator("[data-studio-heat]").textContent();
        const firstRow = () => tile.locator("[data-slot=rowHeaderName]").first().textContent();
        const [heads, ramp, opening] = [await columns(), await legend(), await firstRow()];
        expect(heads.length).toBeGreaterThan(1);
        await secondPage(grid, "p-pivot", total);
        expect([await columns(), await legend()]).toEqual([heads, ramp]);
        expect(await firstRow()).not.toBe(opening);
    });
});
