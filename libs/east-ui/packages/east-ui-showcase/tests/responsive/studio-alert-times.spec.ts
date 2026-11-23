/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * When a Studio page's alerts fired, on the reader's own clock (ruled 23
 * November 2026): the showcase's alerts page in a browser set to Sydney's time,
 * whose check fires two alerts as the page loads. The bar's list says when
 * each fired, the banner when the one opened fired, and a visual's bell list
 * since when it fires — each the minute it fired as Sydney's clock reads it,
 * never as UTC's, which every other date the page prints keeps. (The second
 * manual test of the showcase read the alerts' times in UTC, with nothing to
 * say so.)
 *
 * A page of its own: a browser in its own time zone (`test.use`), not a spec
 * file's kept page (`kept-page.ts`).
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-alert-times --project desktop`.
 */

import { expect, test } from "playwright/test";
import { settled } from "./settle";

/** The showcase's alerts page. */
const HASH = "e3/studio/alerts/studioAlertsPage";

/** The reader's time zone: ahead of UTC all year, so no minute reads alike on the two clocks. */
const ZONE = "Australia/Sydney";

test.use({ timezoneId: ZONE });

/** A minute as the page prints a date and its time, in the browser's English, on a zone's clock: `Nov 23, 2026, 14:24`. */
const clock = (zone: string) => new Intl.DateTimeFormat("en-US", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone,
});

/**
 * Each minute from one instant to another, with one either side: the minutes the page's check may have fired in.
 *
 * @param from - When the page was asked for, ms
 * @param to - When it had fired its alerts, ms
 * @returns The minutes
 */
function minutes(from: number, to: number): Date[] {
    const step = 60_000;
    const out: Date[] = [];
    for (let at = Math.floor(from / step) * step - step; at <= to + step; at += step) out.push(new Date(at));
    return out;
}

/** What a line says after the words that lead to its time: `Visuals · fired Nov 23, 2026, 14:24`, after `fired `. */
const after = (said: string, words: string): string => said.slice(said.indexOf(words) + words.length);

test.describe("When a Studio page's alerts fired, on the reader's own clock (ruled 23 Nov 2026)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("the bar's list, the banner and a visual's bell list each say the minute its alert fired as the reader's clock reads it, never UTC's", async ({ page }) => {
        const asked = Date.now();
        await page.goto(`/?theme=light#${HASH}`);
        await page.waitForSelector("header", { timeout: 20_000 });
        const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
        await entry.scrollIntoViewIfNeeded();
        await expect.poll(() => entry.locator("[data-studio-alert-bell][data-firing]").count(), { timeout: 60_000 }).toBe(2);
        await settled(page);
        const span = minutes(asked, Date.now());
        const local = new Set(span.map((at) => clock(ZONE).format(at)));
        const utc = new Set(span.map((at) => clock("UTC").format(at)));
        expect([...local].filter((said) => utc.has(said))).toEqual([]);
        const popover = page.locator('[data-scope="popover"][data-part="content"][data-state="open"]');
        const lines = () => popover.locator("[data-studio-alert] [data-status]").allTextContents();

        // The bar's list: each alert firing, its page and when it fired.
        await entry.locator("[data-studio-alert-bar]").click();
        await expect(popover.locator("[data-studio-alert]")).toHaveCount(2);
        const fired = await lines();
        expect(fired.map((said) => [said.startsWith("Visuals · fired "), local.has(after(said, "fired "))]), fired.join(" | "))
            .toEqual([[true, true], [true, true]]);

        // The banner over the page opened for one.
        await popover.locator('[data-studio-alert="Month under goal"]').click();
        await expect(popover).toHaveCount(0);
        const banner = page.getByText(/^Month under goal fired at /);
        await expect(banner).toBeVisible();
        const title = (await banner.textContent()) ?? "";
        expect(local.has(after(title, "fired at ")), title).toBe(true);

        // A visual's bell: since when its alert fires.
        const revenue = entry.locator('[data-studio-placement="v-revenue"]');
        await revenue.scrollIntoViewIfNeeded();
        await revenue.locator("[data-studio-alert-bell]").click();
        await expect(popover.locator('[data-studio-alert="Quarter under goal"]')).toBeVisible();
        const [since] = await lines();
        expect([since?.startsWith("Firing since "), local.has(after(since ?? "", "since "))], since).toEqual([true, true]);
    });
});
