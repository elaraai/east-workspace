/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The query library, measured in a real browser (#940, `Query Editor Spec.md`
 * §5, §7 V2), as Studio's page library is: one 44px toolbar row across a
 * borderless frame — the 300px search at its start and the primary action at
 * its end after a 1px rule; the 224px pane beside the gallery, its rows 32px
 * tall, the one shown in the brand and Recent at its foot; the seven saved
 * queries three across, 12px apart, each with its 112px wireframe on top — the
 * source, then a bar per step, four at most and the rest counted — and in the
 * list a card a row, its wireframe at its start, 156px wide. The frame is set
 * to the mock's width, 1240px, and every measurement is polled until it holds,
 * on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test query-library --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

const HASH = "e3/query/query/queryLibrary";

/** Open the library example and return its frame, at rest, as wide as the mock's (1240px). */
async function openLibrary(page: Page, theme: "light" | "dark" = "light"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const frame = entry.locator("[data-query-library]").first();
    await expect(frame.locator("[data-library-card]").first()).toBeVisible({ timeout: 20_000 });
    await frame.evaluate((root) => { (root as HTMLElement).style.width = "1240px"; });
    await settled(page);
    return frame;
}

/** The gallery's cards, each box relative to its grid, to a tenth of a pixel. */
function cards(frame: Locator): Promise<Array<{ key: string; x: number; y: number; w: number; h: number }>> {
    return frame.evaluate((root) => {
        const grid = root.querySelector("[data-library] [data-layout]")!.getBoundingClientRect();
        const tenth = (n: number) => Math.round(n * 10) / 10;
        return [...root.querySelectorAll("[data-library-card]")].map((el) => {
            const b = el.getBoundingClientRect();
            return { key: el.getAttribute("data-library-card")!, x: tenth(b.left - grid.left), y: tenth(b.top - grid.top), w: tenth(b.width), h: tenth(b.height) };
        });
    });
}

test.describe("Query library (#940)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    for (const theme of ["light", "dark"] as const) {
        test(`one 44px toolbar row across a borderless frame — the 300px search at its start, the primary action at its end after a 1px rule (${theme})`, async ({ page }) => {
            const frame = await openLibrary(page, theme);
            await expect.poll(() => frame.evaluate((root) => {
                const band = root.firstElementChild!.getBoundingClientRect();
                const search = root.querySelector("[data-toolbar-item=search]")!.getBoundingClientRect();
                const rule = root.querySelector("[data-toolbar-item=rule] > *")!.getBoundingClientRect();
                const action = root.querySelector("[data-query-library-new]")!.getBoundingClientRect();
                const style = getComputedStyle(root);
                return {
                    border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
                    band: Math.round(band.height), rows: root.querySelectorAll("[data-toolbar]").length,
                    search: [Math.round(search.left - band.left), Math.round(search.width)],
                    rule: [Math.round(rule.width), Math.round(rule.height)], afterRule: rule.right <= action.left,
                    action: [Math.round(band.right - action.right), Math.round(action.height)],
                };
            })).toEqual({
                border: ["0px", "0px", "0px", "0px"],
                band: 44, rows: 1, search: [16, 300], rule: [1, 18], afterRule: true, action: [16, 28],
            });
        });
    }

    test("the pane is 224px wide beside the gallery, its rows 32px tall; the one shown in the brand; Recent at its foot", async ({ page }) => {
        const frame = await openLibrary(page);
        await expect.poll(() => frame.evaluate((root) => {
            const pane = root.querySelector("[data-query-library-pane]")!.getBoundingClientRect();
            const main = root.querySelector("[data-query-library-main]")!.getBoundingClientRect();
            const rows = [...root.querySelectorAll("[data-query-library-shows]")];
            const active = root.querySelector("[data-query-library-shows][data-active]")!;
            const idle = root.querySelector("[data-query-library-shows]:not([data-active])")!;
            const recent = root.querySelector("[data-query-library-shows=recent]")!.getBoundingClientRect();
            return {
                pane: Math.round(pane.width), beside: Math.round(main.left - pane.right),
                rows: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))],
                shown: active.getAttribute("data-query-library-shows"),
                tinted: getComputedStyle(active).backgroundColor !== getComputedStyle(idle).backgroundColor,
                recentAtFoot: Math.round(pane.bottom - recent.bottom),
            };
        })).toEqual({ pane: 224, beside: 0, rows: [32], shown: "all", tinted: true, recentAtFoot: 16 });
    });

    test("the saved queries three across, 12px apart, each with its 112px wireframe on top — the source, then a bar per step, four at most and the rest counted", async ({ page }) => {
        const frame = await openLibrary(page);
        await expect.poll(async () => {
            const b = await cards(frame);
            return {
                // Sort · Recent: the most recently saved first.
                keys: b.map((c) => c.key),
                columns: [...new Set(b.map((c) => c.x))].length,
                gapX: Math.round(b[1]!.x - (b[0]!.x + b[0]!.w)), gapY: Math.round(b[3]!.y - (b[0]!.y + b[0]!.h)),
            };
        }).toEqual({
            keys: [
                "Top shipped orders, 2026", "Revenue by region", "Shipped revenue by month", "Large orders with no discount",
                "Units by SKU", "Pump parts cost", "Demand at $10–$12, NSW",
            ],
            columns: 3, gapX: 12, gapY: 12,
        });
        await expect.poll(() => frame.evaluate((root) => {
            const card = root.querySelector('[data-library-card="Top shipped orders, 2026"]')!;
            const media = card.querySelector("[data-library-media]")!.getBoundingClientRect();
            const frameBox = card.querySelector("[data-query-wireframe]")!;
            const bars = [...frameBox.querySelectorAll("[data-wire]")];
            return {
                media: [Math.round(media.height), Math.round(media.top - card.getBoundingClientRect().top)],
                bars: bars.map((bar) => [bar.getAttribute("data-wire"), Math.round(bar.getBoundingClientRect().height)]),
                more: frameBox.lastElementChild!.textContent,
                // The wireframe sits inside its media's box.
                inside: bars.every((bar) => bar.getBoundingClientRect().bottom <= media.bottom),
            };
        })).toEqual({
            media: [112, 1],
            bars: [["source", 17], ["step", 17], ["step", 17], ["step", 17]],
            more: "+2 more",
            inside: true,
        });
    });

    test("List lays the cards a row each, each wireframe at its start, 156px wide", async ({ page }) => {
        const frame = await openLibrary(page);
        await frame.getByRole("radio", { name: "List view" }).click();
        await expect.poll(async () => {
            const b = await cards(frame);
            return { columns: [...new Set(b.map((c) => c.x))].length, rows: new Set(b.map((c) => c.y)).size };
        }).toEqual({ columns: 1, rows: 7 });
        await expect.poll(() => frame.evaluate((root) => {
            const card = root.querySelector('[data-library-card="Revenue by region"]')!;
            const media = card.querySelector("[data-library-media]")!.getBoundingClientRect();
            return [Math.round(media.left - card.getBoundingClientRect().left), Math.round(media.width)];
        })).toEqual([1, 156]);
    });
});
