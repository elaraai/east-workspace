/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Every builder's panes, measured in a real browser (#1210): a pane's tab row
 * draws each of its tabs inside the row and clear of its collapse control —
 * the counts leave the row first, then the trailing tabs fold into a `+n`
 * menu, the open tab always on the row — on each builder the showcase holds:
 * Studio's, the query builder's and the Sheet builder's. At the desktop width
 * the panes are measured open, as they rest; on a phone each is opened from
 * its rail and measured over main. In both themes; every measurement is
 * polled until it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test builder-panes --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/**
 * A builder the showcase holds: its example, what shows once it is at rest,
 * the box its own spec sizes (the frame's parent when `null`) and to what
 * width, and its panes by name.
 */
interface BuilderPage {
    readonly name: string;
    readonly hash: string;
    readonly ready: string;
    readonly box: string | null;
    readonly width: number;
    readonly panes: readonly string[];
}

const BUILDERS: readonly BuilderPage[] = [
    { name: "Studio's builder", hash: "e3/studio/studio/studioBuilder", ready: "[data-snap-grid-tile]", box: "[data-studio-builder]", width: 1440, panes: ["Components", "Inspector"] },
    { name: "the query builder", hash: "e3/query/query/queryBuilder", ready: "[data-query-results-view]", box: "[data-query-builder]", width: 1240, panes: ["Query"] },
    { name: "the Sheet builder", hash: "e3/sheet/sheet-builder/sheetBuilderWorkshop", ready: "[data-sheet-card]", box: null, width: 1440, panes: ["Library", "Inspector"] },
];

/**
 * Open a builder's example and return its frame, at rest: sized as its own
 * spec sizes it, where its panes are pinned open beside main, or, with
 * `sized` false, as the page lays it out.
 */
async function openFrame(page: Page, builder: BuilderPage, theme: "light" | "dark", sized = true): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${builder.hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${builder.hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const frame = entry.locator("[data-builder-frame]").first();
    await expect(frame.locator(builder.ready).first()).toBeVisible({ timeout: 20_000 });
    if (sized) {
        const box = builder.box === null ? frame.locator("xpath=..") : entry.locator(builder.box).first();
        await box.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, builder.width);
    }
    await settled(page);
    return frame;
}

/**
 * Each open pane's tab row, as the page draws it: the pane, by its collapse
 * control's name, the tabs on the row, and what runs past the row — a tab or
 * the `+n` menu starting before the row or ending under the collapse control,
 * or a tab list wider than its box.
 */
function tabRowsOf(frame: Locator) {
    return frame.evaluate((root) => [...root.querySelectorAll("[data-frame-slot=start], [data-frame-slot=end]")].flatMap((slot) => {
        const pane = slot.querySelector("[data-orientation][data-side][data-surface]");
        if (pane === null || pane.hasAttribute("data-collapsed")) return [];
        const row = pane.firstElementChild!;
        const toggle = row.querySelector(":scope > button[aria-expanded]");
        const r = row.getBoundingClientRect();
        // The row ends where its collapse control begins.
        const end = toggle === null ? r.right : toggle.getBoundingClientRect().left;
        const tabs = [...row.querySelectorAll('[role="tab"]')];
        const more = row.querySelector("[data-dock-more]");
        const past: string[] = [];
        for (const el of more === null ? tabs : [...tabs, more]) {
            const b = el.getBoundingClientRect();
            const what = el === more ? "the +n menu" : `"${el.textContent}"`;
            if (b.left < r.left - 0.5) past.push(`${what} starts ${Math.round(r.left - b.left)}px before the row`);
            if (b.right > end + 0.5) past.push(`${what} runs ${Math.round(b.right - end)}px under the collapse control`);
        }
        const list = row.querySelector('[role="tablist"]');
        if (list !== null && list.scrollWidth > list.clientWidth + 0.5) past.push(`the tab list is ${list.scrollWidth - list.clientWidth}px wider than its box`);
        return [{ pane: toggle?.getAttribute("aria-label") ?? "", tabs: tabs.map((t) => t.getAttribute("aria-label") ?? t.textContent), past }];
    }));
}

test.describe("every builder pane's tab row fits its pane (#1210)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured open at the desktop width; the phone's are measured below");

    for (const builder of BUILDERS) {
        for (const theme of ["light", "dark"] as const) {
            test(`${builder.name}: each open pane's tabs inside its tab row, clear of the collapse control (${theme})`, async ({ page }) => {
                const frame = await openFrame(page, builder, theme);
                await expect.poll(async () => (await tabRowsOf(frame)).map(({ pane, past }) => ({ pane, past })))
                    .toEqual(builder.panes.map((name) => ({ pane: `Collapse ${name}`, past: [] })));
            });
        }
    }
});

test.describe("every builder pane's tab row fits its pane, on a phone (#1210)", () => {
    test.skip(({ isMobile }) => !isMobile, "measured on the phone");

    for (const builder of BUILDERS) {
        test(`${builder.name}: each pane, opened from its rail, its tabs inside its tab row, clear of the collapse control`, async ({ page }) => {
            const frame = await openFrame(page, builder, "light", false);
            for (const name of builder.panes) {
                await frame.getByRole("button", { name: `Expand ${name}` }).click();
                await settled(page);
                await expect.poll(async () => (await tabRowsOf(frame)).map(({ pane, past }) => ({ pane, past })))
                    .toEqual([{ pane: `Collapse ${name}`, past: [] }]);
                await frame.getByRole("button", { name: `Collapse ${name}` }).click();
                await settled(page);
            }
        });
    }
});
