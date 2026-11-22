/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Measured rows under a scaled ancestor, in a real browser: a Table, a Matrix
 * and a Library — the three virtualizers that measure the rows they mount —
 * each mounted while an ancestor draws it at nine tenths of its size, as a
 * popover on its way in does, or a zoomed canvas. A row's place is the sum of
 * the heights above it, in the layout's own pixels, so each row must stand
 * its own layout height under the one before: measured by its drawn box
 * instead, every row stood a tenth short, over the next — and stayed there
 * once the popover was in, as nothing measures a row again that has not
 * changed size.
 *
 * The scale is set by a rule the page holds before it loads, so the rows
 * first mount under it. Every measurement is polled until it holds; no
 * screenshot is read. Its own page: it installs a script before the page
 * loads.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test rows-under-scale --project desktop`.
 */

import { expect, test, type Page } from "playwright/test";

/** How an ancestor draws the rows: nine tenths of their size. */
const SCALE = 0.9;

/** One collection's rows: its example, the element of it the rule scales, and the rows it measures. */
interface ScaledRows {
    readonly name: string;
    readonly route: string;
    /** The element scaled, inside the example: an ancestor of every row. */
    readonly scaled: string;
    /** The rows the collection measures, each placed by a `translateY`. */
    readonly rows: string;
}

const COLLECTIONS: readonly ScaledRows[] = [
    { name: "Table", route: "collections/table/tableBasic", scaled: "table", rows: "tbody > div[data-index]" },
    { name: "Matrix", route: "collections/matrix/matrixVariants", scaled: "[data-virtual-rows]", rows: "[data-virtual-rows] [data-slot=virtualRow][data-index]" },
    { name: "Library", route: "collections/library/libraryLarge", scaled: "[data-library]", rows: "[data-library] [data-virtual] [data-index]" },
];

/** A row as the page holds it: its index, where it is placed, its layout height and its drawn one. */
interface RowRead { readonly index: number; readonly top: number; readonly laid: number; readonly drawn: number }

/** Opens an example with the element scaled from its first mount, and reads its rows in order. */
async function readRows(page: Page, at: ScaledRows): Promise<RowRead[]> {
    const entry = `[data-index]:has(a[href="#${at.route}"])`;
    return page.locator(entry).first().evaluate((root, rows) => [...root.querySelectorAll<HTMLElement>(rows)].map((row) => ({
        index: Number(row.getAttribute("data-index")),
        top: Number(/translateY\((-?[\d.]+)px\)/.exec(row.style.transform)?.[1] ?? Number.NaN),
        laid: row.offsetHeight,
        drawn: row.getBoundingClientRect().height,
    })).sort((a, b) => a.index - b.index), at.rows);
}

/** What is wrong with the rows' places: each row that does not stand its own layout height under the one before. */
function faults(rows: readonly RowRead[]): string[] {
    const bad: string[] = [];
    if (rows.length < 3) bad.push(`${rows.length} rows read`);
    for (let i = 0; i + 1 < rows.length; i++) {
        const [row, next] = [rows[i]!, rows[i + 1]!];
        if (next.index !== row.index + 1) continue;
        // The rule holds: the row is drawn at nine tenths of its layout height.
        if (Math.abs(row.drawn - row.laid * SCALE) > 0.6) bad.push(`row ${row.index} is drawn ${row.drawn} for ${row.laid} laid out: not under the scale`);
        // A layout height is whole to within a half as `offsetHeight` says it.
        const pitch = next.top - row.top;
        if (!(Math.abs(pitch - row.laid) <= 0.5)) bad.push(`row ${next.index} stands ${pitch} under row ${row.index}, which is ${row.laid} tall`);
    }
    return bad;
}

test.describe("Measured rows under a scaled ancestor", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    for (const at of COLLECTIONS) {
        test(`${at.name}: each row stands its own layout height under the one before, though an ancestor draws them at nine tenths`, async ({ page }) => {
            const entry = `[data-index]:has(a[href="#${at.route}"])`;
            await page.addInitScript((css) => {
                document.addEventListener("DOMContentLoaded", () => {
                    const style = document.createElement("style");
                    style.textContent = css;
                    document.head.append(style);
                });
            }, `${entry} ${at.scaled} { transform: scale(${SCALE}); transform-origin: 0 0; }`);
            await page.goto(`/?theme=light#${at.route}`);
            await page.waitForSelector("header", { timeout: 20_000 });
            await page.locator(entry).first().scrollIntoViewIfNeeded();
            await expect(page.locator(entry).first().locator(at.rows).first()).toBeAttached({ timeout: 30_000 });
            await expect.poll(async () => faults(await readRows(page, at)), { timeout: 5_000 }).toEqual([]);
        });
    }
});
