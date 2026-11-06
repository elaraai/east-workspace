/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * A Roster's coverage lines in a column too narrow for them: a skill's name takes the cell's whole width and breaks at
 * its spaces, never inside a word, and its figures keep together on the line under it, inside the cell. A column with
 * room keeps the name and its figures on one line.
 *
 * Run: `pnpm exec playwright test roster-coverage-lines`.
 */

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";

const ROUTE = "e3/roster/roster/rosterVocabulary";

/** Each line of a cell: whether its figures fit the cell, its name's top against theirs, and whether a word of its name was cut. */
async function linesOf(cell: Locator) {
    return cell.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const pen = document.createElement("canvas").getContext("2d")!;
        return [...el.querySelectorAll("[data-roster-coverage-line]")].map((line) => {
            const name = line.querySelector<HTMLElement>("[data-roster-coverage-name]")!;
            const figures = line.querySelector<HTMLElement>("[data-roster-coverage-figures]")!;
            const nameBox = name.getBoundingClientRect(), figuresBox = figures.getBoundingClientRect();
            const css = getComputedStyle(name);
            pen.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
            const widest = Math.max(...(name.lastChild?.textContent ?? "").split(/\s+/u).map((word) => pen.measureText(word).width));
            return { sameLine: Math.abs(nameBox.top - figuresBox.top) < 6, wordFits: widest <= nameBox.width + 1, inside: figuresBox.right <= box.right + 0.5 && figuresBox.left >= box.left - 0.5, figureLines: Math.round(figuresBox.height / parseFloat(getComputedStyle(figures).lineHeight)) };
        });
    });
}

test.describe("A Roster's coverage lines", () => {
    test("@desktop a narrow column breaks a name at its spaces, its figures whole beneath it; a wide one keeps one line", async ({ page }, info) => {
        test.skip(info.project.name !== "desktop");
        await page.setViewportSize({ width: 1920, height: 1000 });
        await page.goto(`/?theme=light#${ROUTE}`);
        await page.waitForSelector("header");
        const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${ROUTE}"]`) });
        await entry.scrollIntoViewIfNeeded();
        const cell = entry.locator("[data-roster-requirement]").first();
        await expect(cell.locator("[data-roster-coverage-line]").first()).toBeVisible({ timeout: 30_000 });
        await settled(page);
        const wide = await linesOf(cell);
        expect(wide.length).toBeGreaterThan(0);
        expect(wide.every((line) => line.sameLine && line.inside)).toBe(true);
        for (const width of [150, 110]) {
            await cell.evaluate((el, px) => { (el as HTMLElement).style.width = `${px}px`; }, width);
            const narrow = await linesOf(cell);
            expect(narrow.every((line) => line.wordFits && line.inside && line.figureLines === 1), JSON.stringify(narrow)).toBe(true);
            expect(narrow.some((line) => !line.sameLine)).toBe(true);
            if (width === 150 && process.env.COVERAGE_SHOT !== undefined) await cell.screenshot({ path: process.env.COVERAGE_SHOT });
        }
    });
});
