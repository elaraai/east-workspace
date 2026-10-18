/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A linked entry holds still while the rows above it change size, whichever
 * way the doc list last scrolled. A row above the fold that grows or shrinks
 * moves the list's scroll by as much, so what shows at the fold stays put: a
 * live example above the link that grows as it renders, and shrinks once it
 * has, leaves the link where it was. The virtualizer's default skipped that
 * for a row measured before while the list was scrolling backward; a
 * correction of a few pixels upward, then a row above shrinking by thousands,
 * left the list past its link at the end of the page, and each spec that
 * opens an entry by its link failed waiting for it.
 *
 * The list's step backward and the row's change land in one frame, as they
 * did then: a frame dispatches its scroll events before its resize
 * observations.
 *
 * And the linked entry stays mounted however far the list scrolls from it.
 * A pointer scrolling a control of the entry into view, while the rows
 * around it measured, once carried the list past the virtualizer's window,
 * which dropped the entry, and nothing scrolled it back: the spec driving it
 * waited for its control until it timed out.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test doc-list-anchor --project desktop`.
 */

import { test, expect, type Page } from "playwright/test";
import { settled } from "./settle";

const FILE = "e3/sheet/sheet";
const NAME = "sheetWorkshop";
/** How much the row above the link grows, and then shrinks: thousands, as a
 *  live example's first render can. */
const GROWTH = 6000;

/** The linked entry: the one row of the doc list holding its anchor. */
const ENTRY = `[data-index]:has(a[href="#${FILE}/${NAME}"])`;

/** Where the linked entry starts below the top of the list's frame, in
 *  pixels; `null` once the list no longer renders it. */
function entryTop(page: Page): Promise<number | null> {
    return page.evaluate((selector) => {
        const row = document.querySelector(selector);
        if (row === null) return null;
        const list = row.parentElement!.parentElement!;
        return Math.round(row.getBoundingClientRect().top - list.getBoundingClientRect().top);
    }, ENTRY);
}

/**
 * In one frame: scroll the list back a pixel, then change the size of a row
 * wholly above the fold — the one the list renders two above the linked
 * entry, since the step back puts the fold a pixel into the row just above
 * it — by appending a spacer to it, or removing the one appended before.
 */
function backThenResize(page: Page, grow: boolean): Promise<void> {
    return page.evaluate(({ selector, grow, growth }) => {
        const row = document.querySelector(selector)!;
        const list = row.parentElement!.parentElement!;
        const above = row.parentElement!.querySelector(`:scope > [data-index="${Number(row.getAttribute("data-index")) - 2}"]`)!;
        list.scrollTop -= 1;
        if (grow) {
            const spacer = document.createElement("div");
            spacer.setAttribute("data-anchor-spacer", "");
            spacer.style.height = `${growth}px`;
            above.appendChild(spacer);
        } else {
            above.querySelector("[data-anchor-spacer]")!.remove();
        }
    }, { selector: ENTRY, grow, growth: GROWTH });
}

test.describe("the doc list keeps a linked entry where the link put it", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "the list's anchoring, measured once at the desktop width");

    test("a row above the fold grows, then shrinks, each just after the list scrolled backward", async ({ page }) => {
        await page.goto(`/#${FILE}/${NAME}`);
        await page.waitForSelector("header", { timeout: 20_000 });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.locator(ENTRY).scrollIntoViewIfNeeded();
        await settled(page);
        const at = await entryTop(page);
        expect(at, "the link opened its entry").not.toBeNull();

        await backThenResize(page, true);
        await settled(page);
        await expect.poll(() => entryTop(page), { message: `a row above grew ${GROWTH}px` }).toBe(at! + 1);

        await backThenResize(page, false);
        await settled(page);
        await expect.poll(() => entryTop(page), { message: `a row above shrank ${GROWTH}px` }).toBe(at! + 2);
    });

    test("scrolled far from it, the linked entry stays mounted, and scrolling to it shows it again", async ({ page }) => {
        const link = "#e3/roster/roster/rosterWarehouse";
        const entry = page.locator("[data-doc-scroll] > div > [data-index]", { has: page.locator(`a[href="${link}"]`) });
        await page.goto(`/${link}`);
        await expect(entry).toHaveCount(1, { timeout: 20_000 });
        // Rows enough above it that the list's top is well past its overscan
        expect(Number(await entry.getAttribute("data-index")), "rows above the linked entry").toBeGreaterThan(4);

        await entry.evaluate((row) => { row.parentElement!.parentElement!.scrollTop = 0; });
        await expect(page.locator("[data-doc-scroll] > div > [data-index=\"0\"]"), "the list renders its top").toHaveCount(1);
        await expect(entry, "the linked entry, the list scrolled far from it").toHaveCount(1);

        await entry.locator(`a[href="${link}"]`).scrollIntoViewIfNeeded();
        await expect(entry.locator(`a[href="${link}"]`)).toBeInViewport();
    });
});

test("a cold deep link starts visible examples, then loads an overscan preview when scrolled into view", async ({ page }) => {
    await page.addInitScript(() => {
        const started = new Set<string>();
        Object.assign(window, { startedExamples: started });
        new MutationObserver(() => {
            for (const gate of document.querySelectorAll("[data-e3-start]")) {
                const href = gate.closest("[data-index]")?.querySelector("a[href]")?.getAttribute("href");
                if (href !== undefined && href !== null) started.add(href);
            }
        }).observe(document, { childList: true, subtree: true });
    });
    const file = "e3/roster/roster";
    await page.goto(`/#${file}/rosterMinimal`);
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${file}/rosterMinimal"]`) });
    await expect(entry.locator("[data-builder-frame]")).toBeVisible({ timeout: 20_000 });
    await settled(page);
    const started = await page.evaluate(() => [...(window as unknown as { startedExamples: Set<string> }).startedExamples]);
    expect(started).toContain(`#${file}/rosterMinimal`);
    expect(started.filter(href => href.startsWith("#e3/roster/roster-records/"))).toEqual([]);

    const previous = page.locator("[data-index]", { has: page.locator(`a[href="#${file}/rosterCustomInspector"]`) });
    await expect(previous.locator("[data-example-deferred]")).toHaveCount(1);
    await previous.scrollIntoViewIfNeeded();
    await expect(previous.locator("[data-builder-frame]")).toBeVisible({ timeout: 20_000 });
    await settled(page);
    await expect(previous.locator("[data-example-deferred], [data-builder-loading]")).toHaveCount(0);
});
