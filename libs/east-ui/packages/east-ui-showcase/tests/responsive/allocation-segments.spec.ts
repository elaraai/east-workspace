/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Allocation's layouts, Table · Timeline, a segment strip: each icon at
 * its segment's middle on whole pixels, as an icon button's is — as many
 * rows above it as below, each a whole number — wherever the strip stands.
 *
 *  - S1 in its toolbar's row: a 10px glyph in the 26px inside the strip's
 *    edge, 8 rows either side.
 *  - S2 on a phone, in its View, outside a row: a 14px glyph in a phone's
 *    44px segment, 15 rows either side. (Outside a row on a wider screen the
 *    strip's 13px line takes an 11px glyph: the theme's test holds that.)
 *
 * Every measurement is taken from the laid-out page.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test allocation-segments --project desktop`.
 */

import { expect } from "playwright/test";
import { open } from "./allocation-page";
import { test } from "./kept-page";
import { iconRows, offCentre } from "./segment-rows";
import { settled } from "./settle";

/** A segment that holds its icon before its words. */
const SEGMENT = "button:has(svg[data-seg-icon])";

test.describe("the Allocation's layouts: each icon at its segment's middle", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "desktop");

    test("S1: in its toolbar's row, its icons stand at their segments' middles on whole pixels", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        const entry = await open(page, "allocationViews");
        const row = entry.locator("[data-builder-frame] > [data-frame-slot='toolbar']").first();
        await expect(row.locator(SEGMENT).first()).toBeVisible({ timeout: 30_000 });
        await settled(page);
        const rows = await iconRows(row, SEGMENT);
        expect(rows.map((one) => one.label.trim())).toEqual(["Table", "Timeline"]);
        expect(offCentre(rows)).toEqual([]);
        expect(rows.map((one) => [one.glyph, one.above])).toEqual([[10, 8], [10, 8]]);
    });

    test("S2: on a phone its View holds them outside a row: their icons at their segments' middles on whole pixels", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        const entry = await open(page, "allocationMobile");
        await page.setViewportSize({ width: 390, height: 844 });
        const row = entry.locator("[data-builder-frame] > [data-frame-slot='toolbar']").first();
        await expect(row.getByRole("button", { name: "View", exact: true })).toBeVisible({ timeout: 30_000 });
        await settled(page);
        await row.getByRole("button", { name: "View", exact: true }).click();
        // The View's layouts, outside the toolbar's row.
        const outside = `${SEGMENT}:not([data-toolbar] *)`;
        await expect(page.locator(outside).first()).toBeVisible();
        await settled(page);
        const rows = await iconRows(page.locator("body"), outside);
        expect(rows.map((one) => one.label.trim())).toEqual(["Table", "Timeline"]);
        expect(offCentre(rows)).toEqual([]);
        expect(rows.map((one) => [one.glyph, one.above])).toEqual([[14, 15], [14, 15]]);
    });
});
