/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The words of the Record's and the Sheet's bars stand with their capitals at the middle of their room
 * (east-workspace#1748), in a real browser: the strip under the grid — the Record's label, words and keys, the
 * Sheet's label, chips, meta, keys and page count — and the footer under it, its counts, notes, legend and hints.
 * Every run of words a bar draws is read, the room it stands in the bar's under its rule or a chip's inside its edge,
 * and as many whole rows of the room stand over its capitals as under them (`bar-capitals.ts`).
 *
 * The boxes stood centred before: each part's line a whole number of pixels, centred under the rule (#1638). Their
 * words did not. A browser lays a line out by its face's ascent and descent, rounded to the pixel, and Chivo Mono's
 * capitals stand high in its 10px line: the Record's strip drew its label 11 rows under the rule and 13 over its foot,
 * beside words 11 and 11, and the Sheet's its label 13 and 15 beside chips 13 and 14.
 *
 * Run: `make test-responsive` (libs/east-ui), or `pnpm exec playwright test bar-capitals`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { barCapitals, offCentre } from "./bar-capitals";
import { test } from "./kept-page";
import { visitBuilder } from "./builder-page";
import { settled } from "./settle";

/** A builder's root in its example's entry. */
const ROOT = "[data-builder-frame]";

/** A builder's example on the page in the light theme, at rest with its rows drawn. */
async function open(page: Page, route: string): Promise<Locator> {
    const entry = await visitBuilder(page, route, ROOT, "light");
    await expect(entry.locator('[data-slot="row"]').first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}

/**
 * Holds a bar's words at the middle of their rooms: it draws at least so many runs of words, and none stands with
 * more rows of its room over its capitals than under them, or fewer, or a fraction of a row either side.
 *
 * @param bar - The bar
 * @param what - What it is, for a failure to say
 * @param least - The runs of words it draws at least
 */
async function expectCentred(bar: Locator, what: string, least: number): Promise<void> {
    await expect(bar).toBeVisible();
    const reads = await bar.evaluate(barCapitals);
    expect(reads.length, `${what}: its runs of words, ${JSON.stringify(reads)}`).toBeGreaterThanOrEqual(least);
    expect(offCentre(reads), `${what}: words whose capitals stand off their room's middle`).toEqual([]);
}

/** The frame's footer: the bar under the strip. */
const footerOf = (entry: Locator) => entry.locator(`${ROOT} [data-slot="footer"]`).first();

test.describe("a bar's words stand with their capitals at the middle of its room (east-workspace#1748)", () => {
    test("the Record's strip at rest: its label and its words", async ({ page }) => {
        const entry = await open(page, "e3/record/record/recordBasic");
        await expectCentred(entry.locator("[data-record-strip]"), "the Record's strip", 2);
    });

    test("@desktop the Record's strip on a cycle's cell: its label, its words and its keys", async ({ page }) => {
        const entry = await open(page, "e3/record/record/recordBasic");
        await entry.locator('[data-record] [data-slot="row"] [data-slot="cell"][data-steps]').first().click();
        await expect(entry.locator('[data-record-strip] [data-slot="stripKeys"]')).not.toBeEmpty();
        await settled(page);
        await expectCentred(entry.locator("[data-record-strip]"), "the Record's strip on a cycle", 3);
    });

    // A phone's footers draw no words at rest: the frame's band says the status line's over main's foot.
    test("@desktop the Record's footer: its counts and its legend", async ({ page }) => {
        const entry = await open(page, "e3/record/record/recordBasic");
        await expectCentred(footerOf(entry), "the Record's footer", 2);
    });

    test("@desktop the Sheet's strip, a cell open: its label and its chips", async ({ page }) => {
        const entry = await open(page, "e3/sheet/sheet/sheetWorkshop");
        await entry.locator('[data-slot="row"] [data-slot="cell"]').nth(1).click();
        await page.keyboard.press("Enter");
        const strip = entry.locator('[data-slot="strip"]');
        await expect(strip.locator('[data-slot="stripLabel"]')).toBeVisible();
        await settled(page);
        await expectCentred(strip, "the Sheet's strip", 2);
    });

    test("@desktop the Sheet's footer: its counts and its hints", async ({ page }) => {
        const entry = await open(page, "e3/sheet/sheet/sheetWorkshop");
        await expectCentred(footerOf(entry), "the Sheet's footer", 1);
    });
});
