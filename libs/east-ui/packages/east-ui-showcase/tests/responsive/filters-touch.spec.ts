/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A phone's Filters view at touch size (`Mobile Filters Spec.md` SL7, SL9.7):
 * on the Plan's orders, whose rail holds every kind of field — choices, a date
 * range, a prefix, a number range, yes / no and one of a set — each field's row
 * and every button and field its editor opens is 44px or more, and nothing is
 * wider than the view.
 *
 * Run: `pnpm exec playwright test filters-touch`.
 */

import { expect } from "playwright/test";
import { test } from "./kept-page";
import { sizeBuilder, visitBuilder } from "./builder-page";

const ROOT = "[data-builder-frame]";

test("every field's row and its editor's controls are 44px or more, inside the view @mobile", async ({ page }) => {
    const entry = await visitBuilder(page, "e3/plan/plan-records/planRecordIndexesMobile", ROOT, "light");
    await sizeBuilder(page, entry, ROOT, 390);
    await entry.locator("[data-rail-phone]").first().click();
    const view = page.locator("[data-slice-filters-view]").first();
    await expect(view).toBeVisible();
    const rows = view.locator("button[data-slice-section]");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const name = await row.getAttribute("data-slice-section");
        expect(Math.round((await row.boundingBox())!.height), `${name}'s row`).toBeGreaterThanOrEqual(44);
        await row.click();
        const editor = view.locator(`[data-slice-filters-editor='${name}']`);
        await expect(editor).toBeVisible();
        const faults = await editor.evaluate((el) => {
            const right = el.getBoundingClientRect().right;
            return [...el.querySelectorAll<HTMLElement>("button, input")].flatMap((control) => {
                const box = control.getBoundingClientRect();
                if (box.width === 0) return [];
                // An input fills its field: the field's box is its target.
                const target = control.tagName === "INPUT" ? control.parentElement!.getBoundingClientRect().height : box.height;
                const name = control.getAttribute("aria-label") ?? control.textContent ?? "";
                return [...(Math.round(target) < 44 ? [`${name} is ${target}px tall`] : []), ...(box.right > right + 1 ? [`${name} runs past the view`] : [])];
            });
        });
        expect(faults, `${name}'s editor`).toEqual([]);
        await row.click();
    }
});
