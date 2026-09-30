/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The popover arrow, measured in a real browser (#1037). The design system's
 * arrow — 12 wide, 6 deep, its tip 4 from the trigger, in the content's paper
 * and edge — shows on `<Popover>` (PA1), `<HoverCard>` (PA2) and the edit
 * popover (PA3, the Studio's New page); tall content scrolls in the body and
 * the arrow still shows (PA4); the edit popover's foot keeps the content's
 * rounded corners (PA5); a ToggleTip's arrow is its chip's ink, with no rule
 * (PA6). Shown means the page's own hit test finds the tip just inside its
 * point: clipped, it finds the page beneath. Every measurement is polled until
 * it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test popover-arrow --project desktop`.
 */

import { test, expect, type Page } from "playwright/test";
import { settled } from "./settle";

/** Open an example's entry at rest, and press a button in it. */
async function pressIn(page: Page, hash: string, button: RegExp): Promise<void> {
    await page.goto(`/?theme=light#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const trigger = entry.getByRole("button", { name: button }).first();
    await expect(trigger).toBeVisible({ timeout: 20_000 });
    await settled(page);
    await trigger.click();
}

/** The open arrow against its content and its trigger, on whichever side it hangs, and whether it is shown. */
function arrow(page: Page) {
    return page.evaluate(() => {
        const content = [...document.querySelectorAll('[data-part="content"][data-state="open"]')]
            .find((el) => el.querySelector('[data-part="arrow-tip"]'));
        if (content === undefined) return null;
        const tip = content.querySelector('[data-part="arrow-tip"]')!;
        const trigger = document.querySelector(`[data-scope="${content.getAttribute("data-scope")}"][data-part="trigger"][data-state="open"]`)!;
        const t = tip.getBoundingClientRect();
        const c = content.getBoundingClientRect();
        const g = trigger.getBoundingClientRect();
        // The popover flips above its trigger when there is no room below.
        const above = t.top + t.height / 2 > c.top + c.height / 2;
        const depth = above ? t.bottom - c.bottom : c.top - t.top;
        const hit = document.elementFromPoint(t.left + t.width / 2, above ? t.bottom - 2 : t.top + 2);
        const body = [...content.children].find((el) => getComputedStyle(el).overflowY === "auto");
        // The positioner sits on whole pixels, so against a trigger that ends
        // between two, the tip's distance holds to half a pixel — and the
        // tip's own sub-pixel layout a hundredth more.
        const gap = above ? g.top - t.bottom : t.top - g.bottom;
        return {
            // What shows beyond the content's edge is a right angle: twice as wide as it is deep.
            width: Math.round(2 * depth), depth: Math.round(depth),
            tip: Math.abs(gap - 4) <= 0.52 ? 4 : Math.round(gap * 100) / 100,
            shown: hit !== null && (hit === tip || tip.contains(hit)),
            paper: getComputedStyle(tip).backgroundColor === getComputedStyle(content).backgroundColor,
            edge: getComputedStyle(tip).borderTopColor === getComputedStyle(content).borderTopColor,
            fits: c.top >= 0 && c.bottom <= window.innerHeight,
            scrolls: body !== undefined && body.scrollHeight > body.clientHeight,
        };
    });
}

test.describe("the popover arrow (#1037)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("PA1: <Popover>'s arrow shows — 12 wide, 6 deep, its tip 4 from the trigger, in the content's paper and edge", async ({ page }) => {
        await pressIn(page, "overlays/popover/popoverBasic", /^Open Popover$/);
        await expect.poll(async () => {
            const a = await arrow(page);
            return a && { width: a.width, depth: a.depth, tip: a.tip, shown: a.shown, paper: a.paper, edge: a.edge };
        }).toEqual({ width: 12, depth: 6, tip: 4, shown: true, paper: true, edge: true });
    });

    test("PA2: <HoverCard>'s arrow shows, the same", async ({ page }) => {
        await pressIn(page, "overlays/hover-card/hoverCardOpenFromState", /^Pin the preview$/);
        await expect.poll(async () => {
            const a = await arrow(page);
            return a && { width: a.width, depth: a.depth, tip: a.tip, shown: a.shown, paper: a.paper, edge: a.edge };
        }).toEqual({ width: 12, depth: 6, tip: 4, shown: true, paper: true, edge: true });
    });

    test("PA3: the edit popover's arrow shows, the same — the Studio's New page", async ({ page }) => {
        await pressIn(page, "e3/studio/library/studioPageLibrary", /^New page/);
        await expect.poll(async () => {
            const a = await arrow(page);
            return a && { width: a.width, depth: a.depth, tip: a.tip, shown: a.shown, paper: a.paper, edge: a.edge };
        }).toEqual({ width: 12, depth: 6, tip: 4, shown: true, paper: true, edge: true });
    });

    test("PA4: tall content scrolls in the body, the content held within the viewport, and the arrow still shows", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 320 });
        await pressIn(page, "overlays/popover/popoverVariants", /^View Stats$/);
        await expect.poll(async () => {
            const a = await arrow(page);
            return a && { shown: a.shown, fits: a.fits, scrolls: a.scrolls };
        }).toEqual({ shown: true, fits: true, scrolls: true });
    });

    test("PA5: the edit popover's foot keeps the content's rounded corners", async ({ page }) => {
        await pressIn(page, "e3/studio/library/studioPageLibrary", /^New page/);
        await expect.poll(() => page.evaluate(() => {
            const content = document.querySelector('[data-scope="popover"][data-part="content"][data-state="open"]');
            if (content === null) return null;
            const foot = content.lastElementChild!;
            const corner = (el: Element) => [getComputedStyle(el).borderBottomLeftRadius, getComputedStyle(el).borderBottomRightRadius];
            return { content: corner(content), foot: corner(foot), rounded: corner(content)[0] !== "0px" };
        })).toEqual({ content: ["4px", "4px"], foot: ["4px", "4px"], rounded: true });
    });

    test("PA6: a ToggleTip's arrow is its chip's ink, with no rule", async ({ page }) => {
        await pressIn(page, "overlays/toggle-tip/toggleTipBasic", /^What is this$/);
        await expect.poll(() => page.evaluate(() => {
            const content = document.querySelector('[data-scope="popover"][data-part="content"][data-state="open"]');
            const tip = content?.querySelector('[data-part="arrow-tip"]');
            if (content === null || content === undefined || tip === null || tip === undefined) return null;
            const chip = getComputedStyle(content).backgroundColor;
            return { fill: getComputedStyle(tip).backgroundColor === chip, rule: getComputedStyle(tip).borderTopColor === chip };
        })).toEqual({ fill: true, rule: true });
    });
});
