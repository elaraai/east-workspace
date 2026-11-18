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
 *  - T3 a KPI is its mock (KPI-1, KPI-3): its number mono 26 / 600 at the
 *    body's top with its unit a small label 4px after it; its change a
 *    DeltaPill at the end of that row — 20 tall, no edge, on its valence's
 *    wash, a 10px caret; then its goal's square 6px bar with a 1 × 12 tick at
 *    its end, its trend 36 tall, and ONE line of annotation in mono 10
 *    `--ink-4` — each 8px under the last.
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

    test("T3: a KPI is its number and unit, its change a pill at the row's end, its goal bar, its trend and one line of annotation, 8 apart", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        // The KPI that draws every part: a goal, a change and a trend.
        const kpi = grid.locator("[data-studio-kpi]", { has: page.locator("[data-studio-kpi-goal]") }).filter({ has: page.locator("[data-studio-kpi-change]") }).first();
        await expect(kpi.locator("[data-studio-kpi-trend] svg path").first()).toBeVisible();
        const read = await kpi.evaluate((root) => {
            const probe = (color: string) => { const el = document.createElement("span"); el.style.color = color; root.append(el); const out = getComputedStyle(el).color; el.remove(); return out; };
            const subtle = probe("var(--chakra-colors-fg-subtle)");
            const box = (el: Element) => el.getBoundingClientRect();
            const body = root.closest("[data-studio-visual-body]")!;
            const number = root.querySelector("[data-studio-kpi-value]")!;
            const unit = root.querySelector("[data-studio-kpi-unit]")!;
            const row = number.parentElement!.parentElement!;
            const pill = root.querySelector("[data-studio-kpi-change]")!.firstElementChild!;
            const goal = root.querySelector("[data-studio-kpi-goal]")!;
            const track = goal.querySelector("[data-part=track]") ?? goal.firstElementChild!.firstElementChild!;
            const tick = root.querySelector("[data-studio-kpi-goal-tick]")!;
            const trend = root.querySelector("[data-studio-kpi-trend]")!;
            const note = root.querySelector("[data-studio-kpi-note]")!;
            const type = (el: Element) => { const s = getComputedStyle(el); return [s.fontFamily.includes("Mono"), s.fontSize, s.fontWeight]; };
            const pillLook = getComputedStyle(pill);
            return {
                // At the body's top, inside its 20px of padding.
                top: Math.round((box(row).top - box(body).top) * 64) / 64,
                number: [...type(number), getComputedStyle(number).lineHeight],
                unit: [...type(unit), getComputedStyle(unit).color === subtle, Math.round(box(unit).left - box(number).right)],
                pill: {
                    atEnd: Math.round(box(row).right - box(pill).right), height: box(pill).height, type: type(pill),
                    edge: pillLook.borderTopColor, washed: pillLook.backgroundColor !== "rgba(0, 0, 0, 0)",
                    icon: Math.round(box(pill.querySelector("svg")!).height),
                },
                goal: { height: box(track).height, radius: getComputedStyle(track).borderTopLeftRadius, tick: [box(tick).width, box(tick).height, Math.round(box(track).right - box(tick).right), box(tick).top - box(track).top] },
                trend: box(trend).height,
                note: [...type(note), getComputedStyle(note).color === subtle],
                // Each part 8px under the last: the row, the bar, the trend, the annotation.
                gaps: [box(track).top - box(row).bottom, box(trend).top - box(track).bottom, box(note).top - box(trend).bottom].map((gap) => Math.round(gap * 64) / 64),
                // Nothing else says anything: the number, the unit, the pill and the one line.
                words: [...root.querySelectorAll("*")].filter((el) => el.children.length === 0 && (el.textContent ?? "").trim() !== "" && el.closest("svg") === null).length,
            };
        });
        expect(read).toEqual({
            top: 20,
            number: [true, "26px", "600", "26px"],
            unit: [true, "10.5px", "400", true, 4],
            pill: { atEnd: 0, height: 20, type: [true, "10.5px", "600"], edge: "rgba(0, 0, 0, 0)", washed: true, icon: 10 },
            goal: { height: 6, radius: "0px", tick: [1, 12, 0, -3] },
            trend: 36,
            note: [true, "10px", "400", true],
            gaps: [8, 8, 8],
            words: 4,
        });
    });
});
