/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Ontology table's collapses (#1270), in a real browser: what a shut
 * collapse hides — a row's flow detail, a group's body, the graph warnings —
 * stays mounted, so it animates open and shut, and is inert: no control in it
 * takes the focus, from the keyboard or a script, none takes the pointer at its
 * place, and none is named to assistive technology — read from Chromium's own
 * accessibility tree, as Playwright's role queries do not leave an inert
 * element out. Opened, each does.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test ontology-table`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** The Ontology's examples file in the catalog: e3-ui's, under the e3 section's `e3/` prefix. */
const ONTOLOGY_EXAMPLES = "e3/ontology/ontology";

/** Opens an Ontology example's page at rest and returns its entry — the doc row holding its anchor and its editor. */
async function openOntology(page: Page, name: string): Promise<Locator> {
    await page.goto(`/?theme=light#${ONTOLOGY_EXAMPLES}/${name}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${ONTOLOGY_EXAMPLES}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-ontology-collapse]").first()).toBeAttached({ timeout: 20_000 });
    await settled(page);
    return entry;
}

/**
 * Each control a shut collapse hides that takes the focus when a script gives
 * it, or the pointer at its place, named by its collapse and its words.
 * Evaluated in the page: an empty list holds.
 */
const hiddenReach = (root: Element): string[] => {
    const out: string[] = [];
    for (const region of root.querySelectorAll("[data-ontology-collapse]:not([data-open])")) {
        for (const el of region.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]")) {
            const what = `${region.getAttribute("data-ontology-collapse")}'s "${(el.textContent ?? "").trim() || el.tagName}"`;
            el.focus();
            if (document.activeElement === el) out.push(`${what} takes the focus`);
            const r = el.getBoundingClientRect();
            const hit = r.width > 0 && r.height > 0 ? document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2) : null;
            if (hit !== null && el.contains(hit)) out.push(`${what} takes the pointer`);
        }
    }
    (document.activeElement as HTMLElement | null)?.blur();
    return out;
};

/** How many buttons of a name Chromium's accessibility tree holds — what assistive technology is told. The tree names
 *  a button as it draws, its text transformed: the name is matched whatever its case. */
async function namedButtons(page: Page, name: string): Promise<number> {
    const cdp = await page.context().newCDPSession(page);
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    await cdp.detach();
    return nodes.filter((n) => !n.ignored && n.role?.value === "button" && String(n.name?.value ?? "").toLowerCase() === name.toLowerCase()).length;
}

/** Whether a control takes the focus when a script gives it. */
const takesFocus = (el: HTMLElement): boolean => {
    el.focus();
    const took = document.activeElement === el;
    el.blur();
    return took;
};

test.describe("the Ontology table's collapses (#1270)", () => {
    test("ontologyTableCycleView: no control a shut row detail hides takes the focus or the pointer, nor is named; a row opened, its Open properties is named and takes the focus", async ({ page }) => {
        const entry = await openOntology(page, "ontologyTableCycleView");
        const name = "Open properties →";
        // At rest every row's detail is shut, and several hide an Open properties.
        await expect.poll(() => entry.locator("[data-ontology-collapse='detail']:not([data-open]) button", { hasText: "Open properties" }).count()).toBeGreaterThan(1);
        await expect.poll(() => entry.evaluate(hiddenReach)).toEqual([]);
        await expect.poll(() => namedButtons(page, name)).toBe(0);
        // The first row opened from its stage cell: its Open properties alone is named, and takes the focus.
        const detail = entry.locator("[data-ontology-collapse='detail']").first();
        await detail.locator("xpath=ancestor::tr[1]/preceding-sibling::tr[1]/td[1]").click();
        await expect(detail).toHaveAttribute("data-open", "");
        await expect.poll(() => namedButtons(page, name)).toBe(1);
        expect(await detail.getByRole("button", { name }).evaluate(takesFocus)).toBe(true);
        await expect.poll(() => entry.evaluate(hiddenReach)).toEqual([]);
    });

    test("ontologyTableCycleView: a group shut from its header hides its rows' controls from the focus and the pointer; opened again, they take the focus", async ({ page }) => {
        const entry = await openOntology(page, "ontologyTableCycleView");
        const body = entry.locator("[data-ontology-collapse='group']").first();
        // The header is the row above the group's body.
        const header = body.locator("xpath=../preceding-sibling::*[1]");
        const chip = body.locator("tbody > tr button").first();
        expect(await chip.evaluate(takesFocus)).toBe(true);
        await header.click();
        await expect(body).not.toHaveAttribute("data-open", "");
        expect(await chip.evaluate(takesFocus)).toBe(false);
        await expect.poll(() => entry.evaluate(hiddenReach)).toEqual([]);
        await header.click();
        await expect(body).toHaveAttribute("data-open", "");
        expect(await chip.evaluate(takesFocus)).toBe(true);
    });
});
