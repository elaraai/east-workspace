/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The shared stepper's colours (its slot recipe, `stepper.ts`), measured in
 * the page in both themes (#1398): its strip's border and the two rules either
 * side of its value — the neutral tone's (the Studio's zoom) the subtle rule
 * inside the strong strip, the brand tone's (the inspector's column span) the
 * brand's solid — each side resolved from its token on its own property. A
 * colour token on the `borderInlineColor` shorthand is never resolved, and the
 * rules then took the value's ink.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";
import { token } from "./tokens";

const ROUTE = "e3/studio/studio/studioBuilder";

/** The Studio's builder at rest, 1440px wide: its toolbar holds the zoom, folded into nothing. */
async function openBuilder(page: Page, theme: "light" | "dark"): Promise<Locator> {
    await page.setViewportSize({ width: 2160, height: 1200 });
    await page.goto(`/?theme=${theme}#${ROUTE}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${ROUTE}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const builder = entry.locator("[data-studio-builder]").first();
    await expect(builder.locator("[data-snap-grid-tile]").first()).toBeVisible({ timeout: 20_000 });
    await builder.evaluate((root) => { (root as HTMLElement).style.width = "1440px"; });
    await settled(page);
    await expect(builder.locator("[data-snap-grid-zoom]")).toBeVisible();
    return builder;
}

/** A stepper's colours: its strip's border, and each rule beside its value with its width. */
function colours(stepper: Locator) {
    return stepper.evaluate((root) => {
        const value = root.querySelector<HTMLElement>("output")!;
        const v = getComputedStyle(value);
        return {
            strip: getComputedStyle(root).borderTopColor,
            start: v.borderLeftColor, end: v.borderRightColor, widths: [v.borderLeftWidth, v.borderRightWidth],
        };
    });
}

for (const theme of ["light", "dark"] as const) {
    test(`the stepper's rules beside its value are its tone's, each side from its token: the zoom's the subtle rule in the strong strip, the column span's the brand's solid (${theme}) @desktop`, async ({ page }) => {
        const builder = await openBuilder(page, theme);
        const [subtle, strong, brand] = await Promise.all([token(page, "border-subtle"), token(page, "border-strong"), token(page, "brand-solid")]);
        expect(new Set([subtle, strong, brand]).size, "three distinct tokens to tell apart").toBe(3);
        expect(await colours(builder.locator("[data-snap-grid-zoom]"))).toEqual({ strip: strong, start: subtle, end: subtle, widths: ["1px", "1px"] });
        // The inspector's column span is the selected tile's: select one, if none is.
        const span = builder.getByRole("group", { name: "Column span" });
        if (!(await span.isVisible())) {
            await builder.locator("[data-snap-grid-tile]").first().click();
            await settled(page);
        }
        await expect(span).toBeVisible();
        expect(await colours(span)).toEqual({ strip: brand, start: brand, end: brand, widths: ["1px", "1px"] });
    });
}
