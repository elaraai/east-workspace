/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Plan's geometry, measured in a real browser (#817): every body item —
 * row, group band, rail, gap band — renders at exactly the height the model
 * laid it out at (`rowHeight`, which each item carries as `data-plan-h`), for
 * every row kind the Plan examples draw, at each density, with chart rows at
 * rest and expanded, and under both row focuses (R1 rails and gap bands, R2
 * context strips and the grown focal row).
 *
 * The model and the recipe read ONE geometry table — the model directly, the
 * recipe through the CSS variables the canvas writes — so a mismatch here
 * means they parted: the paging ledger's "band px == rendered px" invariant
 * rests on this.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-geometry --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";

/** The Plan examples, between them every row kind, group strips, pinned
 *  rows, number and ordinal axes. */
const EXAMPLES = [
    "planTargetState", "planSpanRows", "planBucketRows", "planChartRows", "planHeatRows", "planTableRows",
    "planCardRows", "planEventRows", "planGroupedRows", "planSeriesData", "planLiteralRows", "planReview",
    "planExpand", "planNumberAxis", "planOrdinalAxis",
];

/** Open one example's page and return its entry (the virtualized doc row
 *  holding its anchor and its live canvas). */
async function openExample(page: Page, name: string): Promise<Locator> {
    await page.goto(`/#collections/plan/${name}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#collections/plan/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-plan-body]").first()).toBeVisible({ timeout: 20_000 });
    // Charts and collections measure their containers before they settle.
    await page.waitForTimeout(500);
    return entry;
}

/** Every body item whose rendered height is not the model's. */
async function mismatches(entry: Locator): Promise<string[]> {
    return entry.evaluate((root) => [...root.querySelectorAll("[data-plan-h]")].flatMap((el) => {
        const model = Number(el.getAttribute("data-plan-h"));
        const rendered = el.getBoundingClientRect().height;
        if (Math.abs(model - rendered) <= 0.5) return [];
        const name = el.getAttribute("data-plan-row") ?? el.getAttribute("data-plan-group")
            ?? el.getAttribute("data-plan-rail") ?? `gap ${el.getAttribute("data-plan-gap")}`;
        return [`${name}: model ${model}px, rendered ${rendered}px`];
    }));
}

/** How many body items the entry measures. */
const measured = (entry: Locator) => entry.locator("[data-plan-h]").count();

/** Every row kind the Plan draws. */
const KINDS = ["buckets", "cards", "chart", "events", "heat", "span", "table"];

/** The row kinds among the entry's measured rows. */
async function kindsMeasured(entry: Locator): Promise<string[]> {
    return entry.evaluate((root) => [...new Set(
        [...root.querySelectorAll("[data-plan-h][data-plan-kind]")].map((el) => el.getAttribute("data-plan-kind") ?? ""),
    )].sort());
}

test.describe("Plan geometry (#817)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    for (const name of EXAMPLES) {
        test(`${name}: every body item renders at its model height`, async ({ page }) => {
            const entry = await openExample(page, name);
            expect(await measured(entry)).toBeGreaterThan(0);
            expect(await mismatches(entry)).toEqual([]);
        });
    }

    test("chart rows hold at rest and expanded", async ({ page }) => {
        const entry = await openExample(page, "planChartRows");
        const spark = entry.locator('[data-plan-row="spark"]');
        const rest = Number(await spark.getAttribute("data-plan-h"));
        // The expandable spark's gutter is its toggle.
        await spark.locator("> :first-child").click();
        await expect(spark).not.toHaveAttribute("data-plan-h", String(rest));
        expect(await mismatches(entry)).toEqual([]);
        await spark.locator("> :first-child").click();
        await expect(spark).toHaveAttribute("data-plan-h", String(rest));
        expect(await mismatches(entry)).toEqual([]);
    });

    test("every row kind holds at every density, its chart at rest and expanded", async ({ page }) => {
        // The configurator's canvas holds every row kind, and its density
        // control re-rhythms them all.
        const entry = await openExample(page, "planVariants");
        // The configurator's preview pane is phone-width, so the canvas lays
        // out as narrow cards (§10) — which have no rows. Widen the canvas
        // itself: it measures its own container, and lays out rows.
        await page.addStyleTag({ content: "[data-plan-body] { min-width: 960px; }" });
        await expect(entry.locator("[data-plan-row]").first()).toBeVisible();
        const chart = entry.locator('[data-plan-kind="chart"]');
        // The widened canvas overflows the pane on both sides, so the gutter
        // lies outside the pane's clip and a pointer there lands on the
        // controls beside it — the toggle is dispatched to the gutter itself.
        // (Layout boxes, which is all this measures, are not clipped.)
        const toggleChart = () => chart.locator("> :first-child").dispatchEvent("click");
        // A one-line span row — the shared row, which density sets.
        const spanRow = entry.locator('[data-plan-row="20-m04"]');
        const rowAt: Record<string, number> = {};
        for (const density of ["COMFORTABLE", "CONDENSED", "COMPACT"]) {
            await entry.getByText(density, { exact: true }).click();
            await expect(entry.getByRole("radio", { name: density })).toBeChecked();
            await expect.poll(() => kindsMeasured(entry), density).toEqual(KINDS);
            await expect.poll(() => mismatches(entry), density).toEqual([]);
            rowAt[density] = Number(await spanRow.getAttribute("data-plan-h"));
            // The spark's gutter is its toggle: the chart expanded, then back.
            const rest = await chart.getAttribute("data-plan-h") ?? "";
            await toggleChart();
            await expect(chart).not.toHaveAttribute("data-plan-h", rest);
            await expect.poll(() => mismatches(entry), `${density} · chart expanded`).toEqual([]);
            await toggleChart();
            await expect(chart).toHaveAttribute("data-plan-h", rest);
            await expect.poll(() => mismatches(entry), `${density} · chart at rest`).toEqual([]);
        }
        // The sweep reached the canvas: compact tightens the shared row, and
        // condensed keeps the default rhythm.
        expect(rowAt.COMPACT).toBeLessThan(rowAt.COMFORTABLE!);
        expect(rowAt.CONDENSED).toBe(rowAt.COMFORTABLE);
    });

    test("row focus holds — rails and gap bands (R1), context strips and the grown focal row (R2)", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
        await entry.locator('[data-plan-control="links"]').first().click();
        // Rails and gap bands are measured items too — they carry the model's height.
        await expect(entry.locator("[data-plan-rail][data-plan-h], [data-plan-gap][data-plan-h]").first()).toBeVisible();
        expect(await mismatches(entry)).toEqual([]);
        await entry.locator("[data-plan-focusback]").click();
        await entry.locator('[data-plan-control="expand"]').first().click();
        await expect(entry.locator("[data-plan-row][data-ctx][data-plan-h]").first()).toBeVisible();
        await expect(entry.locator("[data-plan-row][data-expanded][data-plan-h]")).toHaveCount(1);
        expect(await mismatches(entry)).toEqual([]);
    });
});
