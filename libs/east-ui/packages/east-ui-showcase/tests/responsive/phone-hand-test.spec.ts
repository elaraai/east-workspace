/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What the hand test of every builder on a phone found (PR #1481, 4 Nov 2026),
 * held in a real touch browser at 390 × 844: a builder's example stands whole
 * under the showcase's one-row header; a card's actions, a Library's search and
 * its menus take a finger by their boxes, and its search counts what it searches;
 * the drafts' count shows its number however little room the row leaves it;
 * Search Records' lines are read whole; a row the Plan's search finds is selected
 * in the list's middle; and a Select's view is headed with its field's name.
 *
 * Run: `pnpm exec playwright test phone-hand-test --project mobile`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { escapeLayer, settled } from "./settle";

/** Opens a builder's example at a phone's size, its frame at rest. */
async function open(page: Page, route: string): Promise<Locator> {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?theme=light#${route}`);
    await page.waitForSelector("header");
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const frame = entry.locator("[data-builder-frame]").first();
    await expect(frame).toHaveAttribute("data-phone", "", { timeout: 30_000 });
    await settled(page);
    return frame;
}

/** The buttons in an element under 44px tall, by their words. */
const shortButtons = (root: Locator) => root.evaluate((el) => [...el.querySelectorAll<HTMLElement>("button")]
    .filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 43.5)
    .map((b) => `${b.getAttribute("aria-label") ?? b.textContent ?? ""}: ${b.getBoundingClientRect().height.toFixed(1)}`));

test.describe("A phone's hand test", () => {
    test.skip(({ isMobile }) => !isMobile, "a touch pointer: the phone projects");

    test("the example stands whole in the window under the one-row header, and opening a pane leaves the page where it is", async ({ page }) => {
        const frame = await open(page, "e3/roster/roster/rosterMobile");
        await frame.evaluate((el) => { el.scrollIntoView({ block: "center" }); });
        expect(await frame.evaluate((el) => {
            const box = el.getBoundingClientRect();
            return box.top >= document.querySelector("header")!.getBoundingClientRect().bottom - 0.5 && box.bottom <= window.innerHeight + 0.5;
        })).toBe(true);
        const scroller = page.locator("[data-doc-scroll]");
        const before = await scroller.evaluate((el) => el.scrollTop);
        await frame.locator("[data-pane-tab='start']").tap();
        await settled(page);
        expect(await scroller.evaluate((el) => el.scrollTop)).toBe(before);
        await page.keyboard.press("Escape");
        await settled(page);
        expect(await scroller.evaluate((el) => el.scrollTop)).toBe(before);
    });

    test("a card's actions and heads are 44px by their boxes; the Library's search and menus too, its search counting the people alone", async ({ page }) => {
        const frame = await open(page, "e3/allocation/allocation/allocationMobile");
        expect(await shortButtons(frame.locator("[data-frame-slot='main']"))).toEqual([]);
        const roster = await open(page, "e3/roster/roster/rosterMobile");
        await roster.locator("[data-pane-tab='start']").tap();
        await settled(page);
        const pane = roster.locator("[data-frame-slot='start']");
        const search = pane.getByRole("textbox", { name: "Search library" }).locator("visible=true").first();
        await expect(search).toHaveAttribute("placeholder", /^Search 69 people/u);
        expect(Math.round((await search.boundingBox())!.height)).toBeGreaterThanOrEqual(42);
        const menu = await pane.getByRole("button", { name: "Group by" }).locator("visible=true").first().boundingBox();
        expect([menu!.width >= 43.5, menu!.height >= 43.5]).toEqual([true, true]);
    });

    test("a draft's count shows its number in the room the history row leaves, the noun going whole", async ({ page }) => {
        const frame = await open(page, "e3/allocation/allocation/allocationMobile");
        const unlink = frame.locator("[data-frame-slot='main']").getByRole("button", { name: "Unlink", exact: true }).first();
        await unlink.tap();
        const count = frame.locator("[data-frame-slot='sessionRow'] [data-changes]");
        await expect(count).toHaveText("1 change");
        // At a phone's width, and at 360, where the row leaves a box too narrow for the noun.
        const shown = () => count.evaluate((el) => {
            const box = el.getBoundingClientRect();
            const number = el.children[0]!.getBoundingClientRect();
            return [number.top >= box.top - 0.5 && number.bottom <= box.bottom + 0.5, number.left >= box.left - 0.5 && number.right <= box.right + 0.5, number.width > 0];
        });
        expect(await shown()).toEqual([true, true, true]);
        await page.setViewportSize({ width: 360, height: 844 });
        await settled(page);
        expect(await shown()).toEqual([true, true, true]);
        await page.setViewportSize({ width: 390, height: 844 });
        await settled(page);
        await frame.locator("[data-frame-slot='sessionRow']").getByRole("button", { name: "Undo", exact: true }).tap();
        await expect(count).toHaveCount(0);
    });

    test("Search Records' lines are read whole, each at least 44px", async ({ page }) => {
        const frame = await open(page, "e3/calendar/calendar/calendarMobile");
        await frame.locator("[data-toolbar-item] [data-key-search='icon']").first().tap();
        const view = page.locator("[data-key-search-phone]");
        await view.getByRole("textbox").fill("job");
        const rows = view.locator("[data-key-search-row]");
        await expect(rows.first()).toBeVisible();
        const read = await rows.evaluateAll((els) => els.map((row) => ({
            tall: row.getBoundingClientRect().height >= 43.5,
            whole: [...row.children].every((part) => part.scrollWidth <= part.clientWidth + 1 && part.scrollHeight <= part.clientHeight + 1),
        })));
        expect(read.every((row) => row.tall && row.whole)).toBe(true);
        await view.locator("[data-key-search-cancel]").tap();
    });

    test("a row the Plan's search finds on a phone is selected, in the list's middle", async ({ page }) => {
        const frame = await open(page, "e3/plan/plan-nested/planNestedAll");
        await frame.locator("[data-toolbar-item] [data-key-search='icon']").first().tap();
        const view = page.locator("[data-key-search-phone]");
        await view.getByRole("textbox").fill("Works 10005");
        await view.locator("[data-key-search-row]").first().tap();
        const card = frame.locator("[data-plan-card][data-selected]");
        await expect(card).toHaveCount(1, { timeout: 30_000 });
        await settled(page);
        await expect(card).toContainText("Works 10005");
        const list = await frame.locator("[data-slot='narrowList']").boundingBox();
        const at = await card.boundingBox();
        expect(at!.y).toBeGreaterThanOrEqual(list!.y);
        expect(at!.y + at!.height).toBeLessThanOrEqual(list!.y + list!.height);
    });

    test("a Plan over a paged resource kind has Search Records: a hidden order's line says why, and a pick clears that and selects its card", async ({ page }) => {
        const frame = await open(page, "e3/plan/plan-records/planRecordIndexesMobile");
        await frame.locator("[data-toolbar-item] [data-key-search='icon']").first().tap();
        const view = page.locator("[data-key-search-phone]");
        await view.getByRole("textbox").fill("JOB-10001");
        const row = view.locator("[data-key-search-row]").first();
        await expect(row).toContainText("hidden by Status: Ready");
        await row.tap();
        const card = frame.locator("[data-plan-card][data-selected]");
        await expect(card).toHaveCount(1, { timeout: 30_000 });
        await expect(card).toContainText("JOB-10001");
    });

    test("a state Find picks in a phone's last lane opens on whole lanes, the lane before it uncut", async ({ page }) => {
        const frame = await open(page, "e3/flowchart/flowchart/flowchartFlowsMobile");
        await frame.locator("[data-toolbar-item='seek'] [data-key-search='icon']").first().tap();
        const view = page.locator("[data-key-search-phone]");
        await view.getByRole("textbox").fill("LDD");
        await view.locator("[data-key-search-row]").first().tap();
        await settled(page);
        await expect(frame.locator("[data-flowchart-lane-pager] [data-slot='pagerReadout']")).toHaveText("Lanes 2–3 of 3");
        const scroll = frame.locator("[data-flowchart-scroll]");
        const [left, width] = await scroll.evaluate((el) => [el.scrollLeft, el.clientWidth]);
        expect(left).toBe(Math.floor(width! / 2));
        const [node, box] = await Promise.all([frame.locator("[data-flowchart-node='LDD']").boundingBox(), scroll.boundingBox()]);
        expect(node!.x + node!.width).toBeLessThanOrEqual(box!.x + box!.width);
    });

    test("a Select in a form opens headed with its field's name", async ({ page }) => {
        const frame = await open(page, "e3/calendar/calendar/calendarMobile");
        await frame.locator("[data-frame-slot='main'] button[aria-pressed]").first().tap();
        await frame.locator("[data-pane-tab='end']").tap();
        await settled(page);
        const trigger = frame.locator("[data-frame-slot='end'] [data-scope='select'][data-part='trigger']").locator("visible=true").first();
        await trigger.tap();
        const head = page.locator("[data-frame-layer-head]").locator("visible=true").first();
        await expect(head).toBeVisible();
        await expect(head).not.toHaveText(/^Select$/u);
        await escapeLayer(page);
    });
});
