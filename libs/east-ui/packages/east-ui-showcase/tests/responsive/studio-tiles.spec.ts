/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Studio's visual tiles against their designed mocks, measured in a real
 * browser (#1671): each part as the spec draws it, on the showcase's page of
 * every form a visual draws.
 *
 *  - T1 a tile's menu is a bare 24 × 24 icon button at the eyebrow's end: no
 *    border, no fill, its ellipsis 14px in the muted ink (TIL-2) — and it and
 *    the strip's words stand a whole number of pixels under the strip's top
 *    edge (#1638): the mock centres them in the 35px over the strip's rule, half
 *    a pixel off, which a page paints a row higher or lower by where it stands
 *    the tile;
 *  - T2 a list's row with the ranking bar is 63px with the rule under it —
 *    its name's line 16, its caption's 15 a pixel under, padded 10 — over a
 *    square 4px bar of its first value against the largest, and its words
 *    start a whole number of pixels under its top edge (LST-1, LST-2).
 *
 * Every measurement is taken from the laid-out page, at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-tiles --project desktop`.
 */

import { expect } from "playwright/test";
import { boxWords } from "./box-words";
import { test } from "./kept-page";
import { openVisuals } from "./studio-visuals-page";

test.describe("Studio tiles, as designed (#1671)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("T1: a tile's menu is a bare 24 × 24 icon button — no border, no fill, a 14px ellipsis in the muted ink", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        const menus = await grid.evaluate((root) => {
            const probe = document.createElement("span");
            probe.style.color = "var(--chakra-colors-fg-muted)";
            root.append(probe);
            const muted = getComputedStyle(probe).color;
            probe.remove();
            return [...root.querySelectorAll("[data-studio-visual-menu]")].map((menu) => {
                const look = getComputedStyle(menu);
                const box = menu.getBoundingClientRect();
                const icon = menu.querySelector("svg")!;
                const head = menu.closest("[data-studio-visual-head]")!.getBoundingClientRect();
                return JSON.stringify({
                    size: [box.width, box.height], border: look.borderTopWidth, fill: look.backgroundColor, radius: look.borderTopLeftRadius,
                    ink: look.color === muted, icon: [icon.getAttribute("data-icon"), Math.round(icon.getBoundingClientRect().height)],
                    // At the strip's end, 20 in; 6 under its top edge, to the 64th of a pixel the page lays out in.
                    end: Math.round(head.right - box.right), above: Math.round((box.top - head.top) * 64) / 64,
                });
            });
        });
        expect(menus.length).toBeGreaterThan(0);
        expect([...new Set(menus)]).toEqual([JSON.stringify({
            size: [24, 24], border: "0px", fill: "rgba(0, 0, 0, 0)", radius: "6px", ink: true, icon: ["ellipsis", 14], end: 20, above: 6,
        })]);
        // The strip's words — its name and its meta — by the rule the small boxes hold, read over the strip's own 36px.
        const heads = grid.locator("[data-studio-visual-head]");
        const count = await heads.count();
        expect(count).toBeGreaterThan(0);
        let held = 0;
        for (let i = 0; i < count; i++) {
            const found = await heads.nth(i).evaluate(boxWords, 36);
            held += found.held;
            expect(found.faults, "words that start at a fraction of a pixel under the strip's top edge").toEqual([]);
        }
        expect(held).toBeGreaterThan(0);
    });

    test("T2: a list row with the ranking bar is 63px — lines of 16 and 15, padded 10 — over a square 4px bar", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        const rows = await grid.evaluate((root) => [...root.querySelectorAll("[data-studio-list-row][data-bar]")].slice(0, 2).map((row) => {
            const bar = row.querySelector("[data-studio-list-bar]")!;
            const fill = bar.firstElementChild!;
            const look = getComputedStyle(row);
            const top = row.getBoundingClientRect().top;
            const under = (part: string) => row.querySelector(part)!.getBoundingClientRect().top - top;
            return {
                // Each row with the rule under it; the last has none.
                height: Math.round(row.getBoundingClientRect().height),
                // How far under the row's top edge its name and its caption start: whole pixels, to the 64th the page lays out in.
                words: [under("[data-studio-list-name]"), under("[data-studio-list-caption]")],
                pad: [look.paddingTop, look.paddingInlineStart],
                name: Math.round(row.querySelector("[data-studio-list-name]")!.getBoundingClientRect().height),
                caption: Math.round(row.querySelector("[data-studio-list-caption]")!.getBoundingClientRect().height),
                bar: [Math.round(bar.getBoundingClientRect().height), getComputedStyle(bar).borderTopLeftRadius],
                fill: [Math.round(fill.getBoundingClientRect().height), getComputedStyle(fill).borderTopLeftRadius, fill.getBoundingClientRect().width > 0],
            };
        }));
        expect(rows.length).toBe(2);
        for (const row of rows) {
            expect(row).toEqual({ height: 63, words: [10, 27], pad: ["10px", "20px"], name: 16, caption: 15, bar: [4, "0px"], fill: [4, "0px", true] });
        }
    });
});
