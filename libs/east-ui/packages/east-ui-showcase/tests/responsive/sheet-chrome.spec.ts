/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Sheet's chrome where a cell edits.
 *
 * Editing: the selected cell's ring is the field's chrome (`Sheet Spec.md`
 * §7): while a cell edits, its editor's 2 px ring is the one ring — no field
 * inside it casts the page's focus glow, carries an outline or draws a box of
 * its own, in every kind of cell and in a group band's title, and the date
 * segment being typed into is marked by the brand's tint alone.
 *
 * Measured in the page, with a fine pointer; never a screenshot.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** One example's entry, its sheet drawn and at rest. */
async function entryOf(page: Page, route: string): Promise<Locator> {
    await page.goto(`/?theme=dark#${route}`);
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-sheet-card]")).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}

/** What a cell's editor draws: its own ring, and each part inside it that rings, outlines or boxes itself, or tints the segment being typed into. */
function editing(cell: Locator) {
    return cell.evaluate((el) => {
        const editor = el.querySelector<HTMLElement>("[data-slot=editor]");
        if (editor === null) return { ring: null, faults: ["no editor"], segment: null };
        const name = (part: Element) => part.getAttribute("data-slot") ?? part.getAttribute("data-part") ?? part.getAttribute("role") ?? part.tagName.toLowerCase();
        const clear = (color: string) => color === "transparent" || /rgba\(\d+, \d+, \d+, 0\)/.test(color);
        const faults: string[] = [];
        for (const part of editor.querySelectorAll("*")) {
            if (part.getBoundingClientRect().width === 0 || part.closest("[data-slot^=chip]") !== null) continue;
            const s = getComputedStyle(part);
            if (s.boxShadow !== "none") faults.push(`${name(part)} casts ${s.boxShadow}`);
            if (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) faults.push(`${name(part)} is outlined ${s.outlineWidth}`);
            const sides = (["Top", "Right", "Bottom", "Left"] as const)
                .filter((side) => parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== "none" && !clear(s[`border${side}Color`]));
            if (sides.length === 4) faults.push(`${name(part)} draws a box`);
        }
        const focused = document.activeElement;
        const segment = focused?.getAttribute("role") === "spinbutton" && editor.contains(focused) ? getComputedStyle(focused).backgroundColor : null;
        return { ring: getComputedStyle(editor).boxShadow, faults, segment };
    });
}

/** A theme token's colour, as the page resolves it. */
function tokenColor(page: Page, token: string) {
    return page.evaluate((name) => {
        const probe = document.createElement("span");
        probe.style.backgroundColor = `var(${name})`;
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
    }, token);
}

// Double-click edits with a fine pointer; the chrome is the same on a touch.
test("a cell that edits draws one ring, its editor's: no field inside it glows, outlines or boxes itself, and a date's segment being typed into is tinted @desktop", async ({ page }) => {
    const weeks = await entryOf(page, "e3/sheet/sheet/sheetWeeks");
    const main = weeks.locator("[data-frame-slot=main]");
    const tint = await tokenColor(page, "--chakra-colors-brand-tint");
    const kinds = ["text", "date", "quantity", "integer", "reference", "enum", "set"];
    for (const kind of kinds) {
        const cell = main.locator(`[data-slot=row]:not([data-blank]) [data-slot=cell][data-editable][data-kind="${kind}"]`).first();
        await cell.dblclick();
        await expect(cell.locator("[data-slot=editor]")).toBeVisible();
        const drawn = await editing(cell);
        expect(drawn.ring, kind).toMatch(/inset/);
        expect(drawn.faults, kind).toEqual([]);
        if (kind === "date") expect(drawn.segment, "the date's focused segment").toBe(tint);
        await page.keyboard.press("Escape");
        await expect(cell.locator("[data-slot=editor]")).toHaveCount(0);
    }
    // A group band's title edits in the same ring.
    const workshop = await entryOf(page, "e3/sheet/sheet/sheetWorkshop");
    const title = workshop.locator("[data-frame-slot=main] [data-band-row] [data-slot=cell][data-kind=text]").first();
    await title.dblclick();
    await expect(title.locator("[data-slot=editor]")).toBeVisible();
    const band = await editing(title);
    expect(band.ring).toMatch(/inset/);
    expect(band.faults).toEqual([]);
});
