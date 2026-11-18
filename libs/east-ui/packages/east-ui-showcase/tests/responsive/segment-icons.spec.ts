/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A segment's icon stands at its segment's middle on whole pixels, as an icon
 * button's does (the `iconButton` recipe's even glyph in its even square): as
 * many rows above it as below, each a whole number — wherever the strip
 * stands.
 *
 *  - I1 the Studio builder's design widths, Desktop · Tablet, in its toolbar's
 *    row: a 10px glyph in the 26px inside the strip's edge, 8 rows either side.
 *  - I2 the Preview's devices, Desktop · Tablet · Mobile, on its bar: a 10px
 *    glyph in its 26px segment.
 *  - I3 the Allocation's layouts, Table · Timeline, in its toolbar's row.
 *  - I4 the same strip in its View on a phone, outside a row: a 14px glyph
 *    in a phone's 44px segment, 15 rows either side. (Outside a row on a
 *    wider screen the strip's 13px line takes an 11px glyph: the theme's
 *    test holds that.)
 *
 * Every measurement is taken from the laid-out page.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test segment-icons --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";

/** An icon's rows above and below it, inside its segment's edge, and the glyph's height. */
interface Rows {
    readonly label: string;
    readonly glyph: number;
    readonly above: number;
    readonly below: number;
}

/** Each segment's icon, as `selector` finds the segments in `scope`. */
function iconRows(scope: Locator, selector: string): Promise<Rows[]> {
    return scope.locator(selector).evaluateAll((segments) => segments.map((segment) => {
        const box = segment.getBoundingClientRect();
        const look = getComputedStyle(segment);
        const top = box.top + parseFloat(look.borderTopWidth);
        const bottom = box.bottom - parseFloat(look.borderBottomWidth);
        const glyph = segment.querySelector("svg")!.getBoundingClientRect();
        const r = (n: number) => Math.round(n * 1000) / 1000;
        return { label: segment.getAttribute("aria-label") ?? segment.textContent ?? "", glyph: r(glyph.height), above: r(glyph.top - top), below: r(bottom - glyph.bottom) };
    }));
}

/** What is off of each icon: its label and its rows, where they differ or fall between pixels. */
const offCentre = (rows: readonly Rows[]) => rows.filter((row) => row.above !== row.below || !Number.isInteger(row.above));

/** Opens a showcase example, at rest. */
async function openExample(page: Page, hash: string): Promise<Locator> {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/?theme=light#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    return entry;
}

/** The Studio's builder, 1600 wide: its toolbar's row holds the design widths with their words. */
async function openBuilder(page: Page): Promise<Locator> {
    const entry = await openExample(page, "e3/studio/studio/studioBuilder");
    const builder = entry.locator("[data-studio-builder]").first();
    await expect(builder.locator("[data-snap-grid-tile]").first()).toBeVisible({ timeout: 20_000 });
    await builder.evaluate((root) => { (root as HTMLElement).style.width = "1600px"; });
    await settled(page);
    return builder;
}

test.describe("a segment's icon at its middle", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "desktop");

    test("I1: the Studio builder's design widths stand their icons at their segments' middles on whole pixels", async ({ page }) => {
        const builder = await openBuilder(page);
        const widths = builder.locator("[data-snap-grid-widths]").first();
        await expect(widths).toBeVisible();
        const rows = await iconRows(widths, "button");
        expect(rows.map((row) => row.label.trim()), "both widths, each with its icon").toEqual(["Desktop", "Tablet"]);
        expect(offCentre(rows)).toEqual([]);
        expect(rows.map((row) => [row.glyph, row.above])).toEqual([[10, 8], [10, 8]]);
    });

    test("I2: the Preview's devices stand their icons at their segments' middles on whole pixels", async ({ page }) => {
        const builder = await openBuilder(page);
        await builder.getByRole("button", { name: "Preview", exact: true }).click();
        const devices = builder.locator("[data-studio-publish] [data-publish-devices]").first();
        await expect(devices).toBeVisible({ timeout: 20_000 });
        await settled(page);
        const rows = await iconRows(devices, "[data-publish-device]");
        expect(rows.length).toBe(3);
        expect(offCentre(rows)).toEqual([]);
        expect(rows.map((row) => [row.glyph, row.above])).toEqual([[10, 8], [10, 8], [10, 8]]);
    });

    test("I3: the Allocation's layouts stand their icons at their segments' middles on whole pixels, in its toolbar's row", async ({ page }) => {
        const entry = await openExample(page, "e3/allocation/allocation/allocationViews");
        const row = entry.locator("[data-builder-frame] > [data-frame-slot='toolbar']").first();
        await expect(row.locator("button:has(svg[data-seg-icon])").first()).toBeVisible({ timeout: 30_000 });
        await settled(page);
        const inRow = await iconRows(row, "button:has(svg[data-seg-icon])");
        expect(inRow.map((one) => one.label.trim())).toEqual(["Table", "Timeline"]);
        expect(offCentre(inRow)).toEqual([]);
        expect(inRow.map((one) => [one.glyph, one.above])).toEqual([[10, 8], [10, 8]]);
    });

    test("I4: on a phone the Allocation's View holds its layouts outside a row: their icons at their segments' middles on whole pixels", async ({ page }) => {
        const entry = await openExample(page, "e3/allocation/allocation/allocationMobile");
        await page.setViewportSize({ width: 390, height: 844 });
        const row = entry.locator("[data-builder-frame] > [data-frame-slot='toolbar']").first();
        await expect(row.getByRole("button", { name: "View", exact: true })).toBeVisible({ timeout: 30_000 });
        await settled(page);
        await row.getByRole("button", { name: "View", exact: true }).click();
        // The View's layouts, outside the toolbar's row.
        const outside = "button:has(svg[data-seg-icon]):not([data-toolbar] *)";
        await expect(page.locator(outside).first()).toBeVisible();
        await settled(page);
        const rows = await iconRows(page.locator("body"), outside);
        expect(rows.map((one) => one.label.trim())).toEqual(["Table", "Timeline"]);
        expect(offCentre(rows)).toEqual([]);
        expect(rows.map((one) => [one.glyph, one.above])).toEqual([[14, 15], [14, 15]]);
    });
});
