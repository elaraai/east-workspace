/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The words of the builders' bars stand with their capitals at the middle of their room (east-workspace#1748), in a
 * real browser: the Record's and the Sheet's strip under the grid — the Record's label, words and keys, the Sheet's
 * label, chips, meta, keys and page count — and every builder's footer, one rail and one look (ruled 24 Nov 2026): the
 * Record's, the Sheet's, the Plan's, the Roster's, the Calendar's, the Allocation's, the Flowchart's and the
 * Schematic's, their counts, notes, legends, hints and notices. Every run of words a bar draws is read, the room it
 * stands in the bar's under its rule or a chip's inside its edge, and as many whole rows of the room stand over its
 * capitals as under them; and every mark beside them — a legend's swatch, icon or chip — stands on whole pixels, as
 * near the rail's middle as its height lets it (`bar-capitals.ts`).
 *
 * The boxes stood centred before: each part's line a whole number of pixels, centred under the rule (#1638). Their
 * words did not. A browser lays a line out by its face's ascent and descent, rounded to the pixel, and Chivo Mono's
 * capitals stand high in its 10px line: the Record's strip drew its label 11 rows under the rule and 13 over its foot,
 * beside words 11 and 11, and the Sheet's its label 13 and 15 beside chips 13 and 14. The footers were each their own
 * — 28, 36 and 38px tall, the Plan's, the Calendar's and the Roster's words 9 rows over and 11 under — and the
 * Calendar's icons stood at half a pixel beside their names.
 *
 * Run: `make test-responsive` (libs/east-ui), or `pnpm exec playwright test bar-capitals`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { barReads, marksOffCentre, offCentre } from "./bar-capitals";
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
 * Holds a bar's words at the middle of their rooms, and its marks as near it as whole pixels stand them: once it draws
 * at least so many runs of words, none stands with more rows of its room over its capitals than under them, or fewer,
 * or a fraction of a row either side; and none of its marks stands at a fraction, or a row further off the middle than
 * its height must.
 *
 * @param bar - The bar
 * @param what - What it is, for a failure to say
 * @param least - The runs of words it draws at least
 * @param marks - The marks it draws at least
 */
async function expectCentred(bar: Locator, what: string, least: number, marks = 0): Promise<void> {
    await expect(bar).toBeVisible();
    // What a footer says lands with its builder's reads: its legend, its counts, a notice.
    await expect.poll(async () => (await bar.evaluate(barReads)).words.length, `${what}: its runs of words`).toBeGreaterThanOrEqual(least);
    await settled(bar.page());
    const reads = await bar.evaluate(barReads);
    expect(reads.marks.length, `${what}: its marks, ${JSON.stringify(reads.marks)}`).toBeGreaterThanOrEqual(marks);
    expect(offCentre(reads.words), `${what}: words whose capitals stand off their room's middle`).toEqual([]);
    expect(marksOffCentre(reads.marks), `${what}: marks off its room's middle`).toEqual([]);
}

/** The rail a frame's footer holds, by its builder's own slot. */
const RAIL = "[data-frame-slot='footer'] [data-slot='footer']";

/**
 * Each builder's footer by its example at rest: the root its example's box holds, its rail, and the runs of words and
 * the marks it draws there at least. The Schematic's floor of 20,000 racks says its density on the rail as it fits.
 */
const FOOTERS = [
    { builder: "Record", route: "e3/record/record/recordBasic", root: ROOT, rail: RAIL, words: 2, marks: 1 },
    { builder: "Sheet", route: "e3/sheet/sheet/sheetWorkshop", root: ROOT, rail: RAIL, words: 1, marks: 0 },
    { builder: "Plan", route: "e3/plan/plan-windows/planWindows", root: "[data-plan-frame]", rail: RAIL, words: 1, marks: 0 },
    { builder: "Roster", route: "e3/roster/roster/rosterWarehouse", root: "[data-roster-frame]", rail: "[data-roster-footer]", words: 1, marks: 1 },
    { builder: "Calendar", route: "e3/calendar/calendar/calendarOperations", root: "[data-calendar-frame]", rail: "[data-calendar-footer]", words: 1, marks: 1 },
    { builder: "Allocation", route: "e3/allocation/allocation/allocationKilnYard", root: "[data-allocation-frame]", rail: "[data-allocation-footer]", words: 1, marks: 1 },
    { builder: "Flowchart", route: "e3/flowchart/flowchart/flowchartDepot", root: "[data-flowchart-root]", rail: "[data-flowchart-footer]", words: 2, marks: 0 },
    { builder: "Schematic", route: "e3/schematic/schematic-records/schematicRecordIndexes", root: "[data-schematic]", rail: "[data-schematic-footer]", words: 1, marks: 0 },
] as const;

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

    test("@desktop the Sheet's strip, a cell open: its label and its chips", async ({ page }) => {
        const entry = await open(page, "e3/sheet/sheet/sheetWorkshop");
        await entry.locator('[data-slot="row"] [data-slot="cell"]').nth(1).click();
        await page.keyboard.press("Enter");
        const strip = entry.locator('[data-slot="strip"]');
        await expect(strip.locator('[data-slot="stripLabel"]')).toBeVisible();
        await settled(page);
        await expectCentred(strip, "the Sheet's strip", 2);
    });

    // A phone's footers draw no words at rest: the frame's band says what is live over main's foot.
    for (const { builder, route, root, rail, words, marks } of FOOTERS) {
        test(`@desktop the ${builder}'s footer: every builder's rail, its words and its marks at its middle`, async ({ page }) => {
            const entry = await visitBuilder(page, route, root, "light");
            const bar = entry.locator(rail).first();
            // One rail: 28px tall on the panel's paper, under its 1px rule.
            await expect(bar).toBeVisible({ timeout: 30_000 });
            const box = await bar.evaluate((el) => {
                const s = getComputedStyle(el);
                return { height: el.getBoundingClientRect().height, rule: s.borderTopWidth };
            });
            expect(box, `the ${builder}'s rail`).toEqual({ height: 28, rule: "1px" });
            await expectCentred(bar, `the ${builder}'s footer`, words, marks);
        });
    }
});
