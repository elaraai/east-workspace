/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * The work orders Plan's Filters editor (`planRecordIndexes`) on the e3 the
 * page runs, measured in a real browser: its head counts the rail's own
 * choices — the fields it lists that hold one — never the operations' date
 * window the date navigator writes into their source, which the rail leaves
 * out; and every line in it — the line counting the sources a narrowing hides
 * rows of, `2,778 of 50,000 work orders · 7,778 of 50,000 operation events`,
 * among them — wraps within it at its spaces, no word cut and nothing scrolled
 * sideways, at 1440 and 390 and in a 294px frame, in both themes.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-filters`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { openExample, sizePlanFrame } from "./plan-page";
import { settled } from "./settle";

/** The examples file of the Plans over the app's records, in the catalog. */
const RECORDS = "e3/plan/plan-records";

/** Opens the folded rail's Filters editor, and returns it. */
async function openFilters(page: Page, entry: Locator): Promise<Locator> {
    await entry.locator("[data-builder-frame]").first().getByRole("button", { name: /^Filters:/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveCount(1);
    await settled(page);
    return dialog;
}

/**
 * What is wrong with the lines of the editor's body, each a line saying what: the body scrolled sideways; a word cut
 * across two lines; a word past the body's content box, or past a box between it and the body that clips it (an
 * ellipsis's) — every word of every text drawn in it, measured where the browser lays it out.
 */
async function wrapFaults(dialog: Locator): Promise<string[]> {
    return dialog.evaluate((content) => {
        const faults: string[] = [];
        const body = [...content.children].find((child) => child.querySelector("[data-slice-section]") !== null) as HTMLElement | undefined;
        if (body === undefined) return ["the editor has no body of fields"];
        if (body.scrollWidth > body.clientWidth + 0.5) faults.push(`the body scrolls sideways: ${body.scrollWidth}px of lines in ${body.clientWidth}px`);
        const inside = (el: Element) => {
            const box = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return { left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight) };
        };
        const bounds = inside(body);
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            const text = node.textContent ?? "";
            // The boxes between the text and the body that clip what overflows them: an ellipsis's, a scroller's.
            const clips: Element[] = [];
            for (let el = node.parentElement; el !== null && el !== body; el = el.parentElement) {
                if (getComputedStyle(el).overflowX !== "visible") clips.push(el);
            }
            for (const match of text.matchAll(/\S+/g)) {
                const range = document.createRange();
                range.setStart(node, match.index);
                range.setEnd(node, match.index + match[0].length);
                const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
                if (rects.length === 0) continue;
                const word = match[0];
                if (new Set(rects.map((r) => Math.round(r.top))).size > 1) faults.push(`"${word}" is cut across two lines`);
                const left = Math.min(...rects.map((r) => r.left)), right = Math.max(...rects.map((r) => r.right));
                if (left < bounds.left - 0.5 || right > bounds.right + 0.5) {
                    faults.push(`"${word}" runs past the body's edge: ${Math.round(left)}–${Math.round(right)}px in ${Math.round(bounds.left)}–${Math.round(bounds.right)}px`);
                }
                for (const clip of clips) {
                    const box = inside(clip);
                    if (left < box.left - 0.5 || right > box.right + 0.5) faults.push(`"${word}" is clipped by its box: ${Math.round(left)}–${Math.round(right)}px in ${Math.round(box.left)}–${Math.round(box.right)}px`);
                }
            }
        }
        return faults;
    });
}

/** Opens the Filters editor once the line counting what a narrowing hides has its counts, and returns what is wrong with its lines. */
async function editorFaults(page: Page, entry: Locator): Promise<string[]> {
    const dialog = await openFilters(page, entry);
    await expect(dialog.locator("[data-record-slices-summary]")).toContainText("operation events");
    const faults = await wrapFaults(dialog);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    return faults;
}

for (const theme of ["light", "dark"] as const) {
    test(`planRecordIndexes: every line of the Filters editor wraps within it at its spaces — no word cut, nothing scrolled sideways — at 1440 and in a 294px frame (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const entry = await openExample(page, "planRecordIndexes", RECORDS, theme);
        await test.step("at 1440", async () => { expect(await editorFaults(page, entry)).toEqual([]); });
        await test.step("in a 294px frame", async () => {
            await sizePlanFrame(page, entry, 294);
            expect(await editorFaults(page, entry)).toEqual([]);
        });
    });

    test(`planRecordIndexes: every line of the Filters editor wraps within it at its spaces — no word cut, nothing scrolled sideways — at 390 (${theme}) @mobile`, async ({ page }) => {
        const entry = await openExample(page, "planRecordIndexes", RECORDS, theme);
        expect(await editorFaults(page, entry)).toEqual([]);
    });
}

/** The editor's rows marked as applied, by their words, and its head's count of what narrows. */
async function applied(dialog: Locator): Promise<{ rows: string[]; count: string }> {
    return {
        rows: await dialog.locator("[data-slice-section] [data-active]").allTextContents(),
        count: (await dialog.getByText(/^\d+ active$/).textContent()) ?? "",
    };
}

test("planRecordIndexes: the Filters editor's head counts the rail's own choices — the two it lists as applied — and none once Clear all clears them; the operations' date window, which the rail leaves out, is counted nowhere @desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const entry = await openExample(page, "planRecordIndexes", RECORDS);
    const dialog = await openFilters(page, entry);
    expect(await applied(dialog)).toEqual({ rows: ["Status: Ready", "Due: Oct 1 – Oct 15"], count: "2 active" });
    await dialog.getByRole("button", { name: "Clear all" }).click();
    await settled(page);
    expect(await applied(dialog)).toEqual({ rows: [], count: "0 active" });
});
