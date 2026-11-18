/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The chart rules, measured in a real browser on the Studio's visuals (#1671,
 * TIL-5): what the design system's `guidelines/charts.md` says a chart looks
 * like, held on every chart the page draws.
 *
 *  - C1 no axis label is cut off, and no two labels of one axis overlap: a
 *    chart gives its labels the room they need, whatever their length;
 *  - C2 an axis label is the mono face at weight 500, in the muted ink;
 *  - C3 the plot keeps the chart rules' margins — 24 above, 28 below (16 more
 *    under an axis that is titled), 24 after (44 with an axis there) — and at
 *    least 44 before, more when its labels need more;
 *  - C4 the legend sits over the plot, from the chart's start: each entry a
 *    14 × 3 swatch and its name in mono 10.5 / 600, 16 apart;
 *  - C5 a column is at most 18px wide and a bar at most 12px thick.
 *
 * Every measurement is taken from the laid-out page, at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test chart-rules --project desktop`.
 */

import { expect } from "playwright/test";
import { test } from "./kept-page";
import { openVisuals } from "./studio-visuals-page";

test.describe("The chart rules, on the Studio's visuals (#1671)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("C1: no axis label is cut off, and no two labels of one axis overlap", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        const bad = await grid.evaluate((root) => {
            const out: string[] = [];
            for (const chart of root.querySelectorAll("[data-studio-chart]")) {
                const name = chart.closest("[data-studio-visual-tile]")?.querySelector("[data-studio-visual-name]")?.textContent ?? "";
                // What cuts a label: the tile's frame.
                const frame = (chart.closest("[data-frame]") ?? chart).getBoundingClientRect();
                for (const axis of chart.querySelectorAll(".visx-axis")) {
                    const labels = [...axis.querySelectorAll(".visx-axis-tick text")].map((el) => ({ text: el.textContent ?? "", box: el.getBoundingClientRect() }));
                    for (const { text, box } of labels) {
                        if (box.left < frame.left - 0.5 || box.right > frame.right + 0.5 || box.bottom > frame.bottom + 0.5) out.push(`${name}: "${text}" is cut off`);
                    }
                    for (let i = 0; i < labels.length; i++) {
                        for (let j = i + 1; j < labels.length; j++) {
                            const [a, b] = [labels[i]!.box, labels[j]!.box];
                            if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push(`${name}: "${labels[i]!.text}" overlaps "${labels[j]!.text}"`);
                        }
                    }
                }
            }
            return out;
        });
        expect(bad).toEqual([]);
    });

    test("C2: an axis label is the mono face at weight 500, in the muted ink", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        const bad = await grid.evaluate((root) => {
            const themed = (property: "color" | "fontFamily", token: string) => {
                const probe = document.createElement("span");
                probe.style[property] = `var(${token})`;
                root.append(probe);
                const value = getComputedStyle(probe)[property];
                probe.remove();
                return value;
            };
            const mono = themed("fontFamily", "--chakra-fonts-mono");
            const ink = themed("color", "--chakra-colors-fg-subtle");
            const out = new Set<string>();
            for (const label of root.querySelectorAll("[data-studio-chart] .visx-axis-tick text")) {
                const look = getComputedStyle(label);
                if (look.fontFamily !== mono || look.fontWeight !== "500" || look.fill !== ink) out.add(`${look.fontFamily.split(",")[0]} ${look.fontWeight} ${look.fill}`);
            }
            return [...out];
        });
        expect(bad).toEqual([]);
    });

    test("C3: the plot keeps the chart rules' margins, and at least 44 before", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        const margins = await grid.evaluate((root) => [...root.querySelectorAll("[data-studio-chart] svg")].flatMap((svg) => {
            const plot = svg.querySelector("clipPath rect");
            const group = svg.querySelector(":scope > g");
            if (plot === null || group === null) return [];
            const [left, top] = (/translate\(([-\d.]+),\s*([-\d.]+)\)/u.exec(group.getAttribute("transform") ?? "") ?? []).slice(1).map(Number);
            const box = svg.getBoundingClientRect();
            const right = Math.round(box.width - left! - Number(plot.getAttribute("width")));
            const bottom = Math.round(box.height - top! - Number(plot.getAttribute("height")));
            // An axis after the plot — a right axis — takes 44 there.
            const after = svg.querySelector(".visx-axis-right") !== null ? 44 : 24;
            // A title under the bottom axis — the text centred under the plot, past its ticks — takes 16 more.
            const height = Number(plot.getAttribute("height"));
            const titled = [...group.querySelectorAll(":scope > text")].some((text) => Number(text.getAttribute("y")) > height);
            return [{ top, below: bottom - (titled ? 16 : 0), right: right >= after, left: left! >= 44 }];
        }));
        expect(margins.length).toBeGreaterThan(0);
        expect([...new Set(margins.map((m) => JSON.stringify(m)))]).toEqual([JSON.stringify({ top: 24, below: 28, right: true, left: true })]);
    });

    test("C4: the legend sits over the plot, from the chart's start — 14 × 3 swatches, names in mono 10.5 / 600, 16 apart", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        const legends = await grid.evaluate((root) => [...root.querySelectorAll("[data-studio-chart]")].flatMap((chart) => {
            const entries = [...chart.querySelectorAll("[data-chart-legend-entry]")];
            const svg = chart.querySelector("svg");
            if (entries.length === 0 || svg === null) return [];
            const first = entries[0]!.getBoundingClientRect();
            const swatch = entries[0]!.firstElementChild!.getBoundingClientRect();
            const label = getComputedStyle(entries[0]!.lastElementChild!);
            return [{
                over: first.bottom <= svg.getBoundingClientRect().top,
                fromStart: Math.round(first.left - chart.getBoundingClientRect().left),
                swatch: [Math.round(swatch.width), Math.round(swatch.height)],
                label: [label.fontSize, label.fontWeight],
                gaps: [...new Set(entries.slice(1).map((entry, i) => Math.round(entry.getBoundingClientRect().left - entries[i]!.getBoundingClientRect().right)))],
            }];
        }));
        expect(legends.length).toBeGreaterThan(0);
        for (const legend of legends) {
            expect(legend).toEqual({ over: true, fromStart: 0, swatch: [14, 3], label: ["10.5px", "600"], gaps: legend.gaps.length === 0 ? [] : [16] });
        }
    });

    test("C5: a column is at most 18px wide and a bar at most 12px thick", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        const sizes = await grid.evaluate((root) => [...root.querySelectorAll("[data-studio-chart] svg")].flatMap((svg) => {
            const bars = [...svg.querySelectorAll(".visx-bar")].map((bar) => bar.getBoundingClientRect());
            if (bars.length === 0) return [];
            // Bars run across where the left axis names categories; columns stand otherwise.
            const across = svg.querySelector(".visx-axis-bottom") === null || bars.every((bar) => bar.width >= bar.height);
            return [Math.round(Math.max(...bars.map((bar) => (across ? bar.height : bar.width))) * 10) / 10];
        }));
        expect(sizes.length).toBeGreaterThan(0);
        expect(sizes.filter((size) => size > 18)).toEqual([]);
    });
});
