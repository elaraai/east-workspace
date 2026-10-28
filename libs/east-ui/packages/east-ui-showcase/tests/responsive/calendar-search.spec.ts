/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * Search Records over the Calendar's events (#1398) on the real in-page e3: a
 * pick at 1440 — the frame's Inspector, on its rail for lack of room, opened
 * over main by the pick — brings its event into the part of main the viewer
 * sees: clear of the Inspector laid over it, and of the timeline's sticky
 * column of resources (the hand retest, 27 Oct 2026), in both themes.
 */
import { expect, test, type Locator, type Page } from "playwright/test";
import { visitBuilder } from "./builder-page";

const ROUTE = "e3/calendar/calendar-windows/calendarWindowsByHall";
const ROOT = "[data-calendar-frame]";

/** Search Records' input: the box in the row, or — folded to its icon — the one its popover opens. */
async function searchInput(page: Page, frame: Locator): Promise<Locator> {
    const item = frame.locator("[data-frame-slot='toolbar'] [data-toolbar-item='seek']");
    const icon = item.locator("[data-key-search='icon']");
    if (await icon.isVisible()) {
        await icon.click();
        return page.locator("[data-key-search='popover'] input");
    }
    return item.locator("[data-part='dataset-key-search'] input");
}

/** The lines the box lists — the listbox its input controls — as they read. */
const lines = (input: Locator) => input.evaluate((el) => {
    const list = document.getElementById(el.getAttribute("aria-controls") ?? "");
    return list === null ? [] : [...list.querySelectorAll('[role="option"]')].map((option) => option.textContent ?? "");
});

for (const theme of ["light", "dark"] as const) {
    test(`a pick at 1440 brings its event clear of the Inspector it opens over main, beside the timeline's column of resources (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const entry = await visitBuilder(page, ROUTE, ROOT, theme);
        const frame = entry.locator(ROOT).first();
        // The menu cards, on Wednesday's Press 1001.
        const input = await searchInput(page, frame);
        await input.pressSequentially("W-0006");
        await expect.poll(() => lines(input), { timeout: 15_000 }).toEqual([expect.stringMatching(/^W-0006 · Menu cards/)]);
        await input.press("Enter");
        const picked = frame.locator('[data-calendar-event][aria-pressed="true"]');
        await expect(picked).toHaveCount(1);
        // The Inspector the pick opened floats over main for lack of room: the part of main left to see is between the
        // rows' sticky column and the Inspector's edge, and the event stands in it, whole.
        await expect.poll(() => frame.evaluate((root) => {
            const end = root.querySelector<HTMLElement>('[data-frame-slot="end"]')!;
            const sheet = end.hasAttribute("data-collapsed") ? undefined : (end.firstElementChild as HTMLElement).getBoundingClientRect();
            const main = root.querySelector('[data-frame-slot="main"]')!.getBoundingClientRect();
            const head = root.querySelector("[data-calendar-row-head]")!.getBoundingClientRect();
            const event = root.querySelector('[data-calendar-event][aria-pressed="true"]')!.getBoundingClientRect();
            const left = Math.max(main.left, head.right), right = Math.min(main.right, sheet?.left ?? main.right);
            return { overlay: end.getAttribute("data-pane-mode") === "overlay" && sheet !== undefined, clear: event.left >= left - 0.5 && event.right <= right + 0.5 };
        }), { message: "the picked event, clear of the Inspector over main and of the rows' column" }).toEqual({ overlay: true, clear: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
}
