/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Studio's visuals, measured in a real browser (#1671): the showcase's
 * page of every form a visual draws — its KPIs, its seven charts, its list
 * and its three tables, each answered by e3 in the page — with two tiles that
 * cannot draw, which the spec writes after them, each saying why — in both
 * themes:
 *
 *  - V1 every text a tile draws holds 4.5:1 on what it is drawn over (NFR-2);
 *  - V2 every numeral is mono and tabular (TIL-5) — a value, a cell, a tick;
 *  - V3 no part paints a colour of its own: every colour a tile sets on an
 *    element is a token's — the theme's variable — or none (TIL-4, NFR-2).
 *  - V4 a chart's tooltip says each value as its axis says what it is (a
 *    manual test's finding, 22 November 2026): a share a percent, to two
 *    decimals — never the fraction it is held as — and an amount whole.
 *  - V5 a table's number is drawn in the case it is written (a manual
 *    test's finding, 22 November 2026): a group's row is set in upper case,
 *    and its numbers are not — `117k`, never `117K`.
 *
 * A colour is read the way it is painted: resolved by the page, composited
 * over the grounds beneath it on a one-pixel canvas and read back as sRGB, so
 * a wash or a mix compares as the colour it renders. No image is kept or
 * compared.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-visuals --project desktop`.
 */

import { expect } from "playwright/test";
import { test } from "./kept-page";
import { MODES, openVisuals } from "./studio-visuals-page";

test.describe("Studio visuals (#1671)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    for (const mode of MODES) {
        test(`V1 (${mode}): every text a tile draws holds 4.5:1 on what it is drawn over`, async ({ page }) => {
            const grid = await openVisuals(page, mode, { cannotDraw: true });
            const bad = await grid.evaluate((root) => {
                const canvas = document.createElement("canvas");
                canvas.width = 1;
                canvas.height = 1;
                const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
                const alpha = (css: string) => {
                    ctx.clearRect(0, 0, 1, 1);
                    ctx.fillStyle = css;
                    ctx.fillRect(0, 0, 1, 1);
                    return ctx.getImageData(0, 0, 1, 1).data[3]!;
                };
                /** A colour drawn over the grounds under it, the outermost first, read back. */
                const painted = (layers: readonly string[]): number[] => {
                    ctx.clearRect(0, 0, 1, 1);
                    for (const layer of layers) {
                        ctx.fillStyle = layer;
                        ctx.fillRect(0, 0, 1, 1);
                    }
                    return [...ctx.getImageData(0, 0, 1, 1).data];
                };
                const lum = ([r, g, b]: number[]) => {
                    const lin = (x: number) => { const s = x / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
                    return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
                };
                const out: string[] = [];
                for (const el of root.querySelectorAll<HTMLElement>("[data-studio-visual-tile] *")) {
                    if (el instanceof SVGElement) continue;
                    const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? "").join("").trim();
                    if (own === "") continue;
                    const look = getComputedStyle(el);
                    if (look.visibility === "hidden" || look.display === "none" || el.getClientRects().length === 0) continue;
                    // The grounds under it, from itself out to the first that paints over everything.
                    const grounds: string[] = [];
                    for (let at: Element | null = el; at !== null; at = at.parentElement) {
                        const ground = getComputedStyle(at).backgroundColor;
                        if (alpha(ground) === 0) continue;
                        grounds.unshift(ground);
                        if (alpha(ground) === 255) break;
                    }
                    const under = painted(grounds);
                    const text = painted([...grounds, look.color]);
                    const [a, b] = [lum(text), lum(under)];
                    const k = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
                    if (k < 4.5) out.push(`"${own.slice(0, 40)}": ${k.toFixed(2)}:1`);
                }
                return out;
            });
            expect(bad).toEqual([]);
        });

        test(`V2 (${mode}): every numeral is mono and tabular — a value, a cell, a tick`, async ({ page }) => {
            const grid = await openVisuals(page, mode, { cannotDraw: true });
            const bad = await grid.evaluate((root) => {
                // The mono family, as the theme names it.
                const probe = document.createElement("span");
                probe.style.fontFamily = "var(--chakra-fonts-mono)";
                root.append(probe);
                const mono = getComputedStyle(probe).fontFamily.split(",")[0]!.trim();
                probe.remove();
                // A numeral: a text that is a number alone — its sign, its digits, its unit's mark.
                const numeral = /^[−+\-≥≤]?\s?[\d][\d.,\s]*[%kMB]?$/u;
                const out: string[] = [];
                for (const el of root.querySelectorAll<Element>("[data-studio-visual-tile] *")) {
                    const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? "").join("").trim();
                    if (!numeral.test(own)) continue;
                    const look = getComputedStyle(el);
                    const tabular = look.fontVariantNumeric.includes("tabular-nums") || look.fontFeatureSettings.includes("tnum");
                    const family = look.fontFamily.split(",")[0]!.trim();
                    if (family !== mono || !tabular) out.push(`"${own}" (${el.tagName.toLowerCase()}): ${family}${tabular ? "" : ", proportional"}`);
                }
                return out;
            });
            expect(bad).toEqual([]);
        });

        test(`V3 (${mode}): every colour a tile sets on an element is a token's`, async ({ page }) => {
            const grid = await openVisuals(page, mode, { cannotDraw: true });
            const bad = await grid.evaluate((root) => {
                // A token's, or none: the theme's variable, or a keyword that paints nothing of its own.
                const token = /^(transparent|inherit|initial|currentcolor|none|var\(--chakra-colors-[\w-]+.*\)|url\(#.+\))$/iu;
                const out: string[] = [];
                for (const el of root.querySelectorAll<HTMLElement | SVGElement>("[data-studio-visual-tile] *")) {
                    for (const property of [...el.style]) {
                        if (!/color|^background$|^fill$|^stroke$/u.test(property)) continue;
                        const value = el.style.getPropertyValue(property).trim();
                        if (!token.test(value)) out.push(`${el.tagName.toLowerCase()} style ${property}: ${value}`);
                    }
                    for (const attribute of ["fill", "stroke"]) {
                        const value = el.getAttribute(attribute)?.trim();
                        if (value !== undefined && !token.test(value)) out.push(`${el.tagName.toLowerCase()} ${attribute}: ${value}`);
                    }
                }
                return out;
            });
            expect(bad).toEqual([]);
        });
    }

    test("V4: a chart's tooltip says a share as a percent, to two decimals — never the fraction it is held as — and an amount whole, grouped", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        // The combo: each region's revenue in columns, and its average margin — a share — on the right axis.
        const plot = grid.locator('[data-studio-placement="v-combo"] svg[data-chart-plot]');
        await plot.scrollIntoViewIfNeeded();
        // Its plot's box in its chart, as the chart says it: the pointer over the plot's middle, on its third region of five.
        const [left, top, width, height] = (await plot.getAttribute("data-chart-plot"))!.split(" ").map(Number);
        await plot.hover({ position: { x: left! + width! / 2, y: top! + height! / 2 } });
        const tooltip = page.locator(".visx-tooltip");
        await expect(tooltip).toBeVisible();
        // Each row: its swatch, its series' name, its value.
        const rows = await tooltip.evaluate((el) => [...el.querySelectorAll(":scope > div > div")].map((row) => [...row.children].map((part) => part.textContent ?? "")));
        expect(rows.map((row) => row[1])).toEqual(["Revenue", "Average margin · right"]);
        expect(rows[0]![2], "an amount, whole").toMatch(/^\d{1,3}(,\d{3})*\.\d+$/u);
        expect(rows[1]![2], "a share").toMatch(/^\d+(\.\d{1,2})?%$/u);
    });

    test("V5: a table's number is drawn in the case it is written — a group's row in upper case, its numbers not: 117k, never 117K", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        // The summary: revenue by region and category, each region a group's row over its categories.
        const summary = grid.locator('[data-studio-placement="v-summary"]');
        await summary.scrollIntoViewIfNeeded();
        const read = await summary.evaluate((tile) => {
            const head = tile.querySelector("tbody tr[data-row-head]")!;
            const numbers = [...tile.querySelectorAll("tbody [data-numeric]")];
            return {
                // The group's row is the group-head voice: its name in upper case.
                head: getComputedStyle(head.querySelector("td")!).textTransform,
                // Its number, as written: a thousand's small `k`.
                said: head.querySelector("[data-numeric]")!.textContent,
                cased: numbers.filter((number) => getComputedStyle(number).textTransform !== "none").map((number) => number.textContent),
                count: numbers.length,
            };
        });
        expect(read.head).toBe("uppercase");
        expect(read.said).toMatch(/^\d+k$/u);
        expect([read.count > 0, read.cased]).toEqual([true, []]);
    });
});
