/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Layout's geometry, measured in a real browser (#989): rows of tiles on
 * the 12-column grid with 12px gaps, a row that passes 12 continuing below,
 * a row as tall as its tallest tile, the tile frame, the widths the spans
 * answer to, and the wireframe. The grid's width is set on the page — its
 * container queries answer to it — so each width is measured on one example:
 * 1440, 960, 600 and 390px. Every measurement is polled until it holds, on a
 * page at rest; no screenshot is read.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test layout-geometry --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** A cell's box, relative to the grid. */
interface CellBox { x: number; y: number; w: number; h: number }

/** Open a Layout example's page and return its entry, at rest. */
async function openLayout(page: Page, name: string): Promise<Locator> {
    await page.goto(`/?theme=light#collections/layout/${name}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#collections/layout/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-layout]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry;
}

/** Every cell's box, relative to the grid, by key, rounded to a tenth of a pixel. */
function boxes(entry: Locator): Promise<Record<string, CellBox>> {
    return entry.evaluate((root) => {
        const grid = root.querySelector("[data-layout-grid]")!.getBoundingClientRect();
        const round = (n: number) => Math.round(n * 10) / 10;
        return Object.fromEntries([...root.querySelectorAll("[data-layout-cell]")].map((el) => {
            const b = el.getBoundingClientRect();
            return [el.getAttribute("data-layout-cell")!, { x: round(b.left - grid.left), y: round(b.top - grid.top), w: round(b.width), h: round(b.height) }];
        }));
    });
}

/** Set the grid's width. */
function widthTo(entry: Locator, px: number): Promise<void> {
    return entry.evaluate((root, w) => {
        (root.querySelector("[data-layout-grid]") as HTMLElement).style.width = `${w}px`;
    }, px);
}

/** Set one cell's inline style property, or an attribute when `attr` names one. */
function setCell(entry: Locator, key: string, change: { style?: Record<string, string>; attr?: [string, string | null] }): Promise<void> {
    return entry.evaluate((root, { key, change }) => {
        const el = root.querySelector(`[data-layout-cell="${key}"]`) as HTMLElement;
        for (const [name, v] of Object.entries(change.style ?? {})) el.style.setProperty(name, v);
        if (change.attr !== undefined) {
            const [name, v] = change.attr;
            if (v === null) el.removeAttribute(name); else el.setAttribute(name, v);
        }
    }, { key, change });
}

/** A span's width on a row `width` px wide with `gap` px gaps: its columns and the gaps between them. */
const spanWidth = (width: number, span: number, gap = 12) => Math.round((((width - 11 * gap) / 12) * span + (span - 1) * gap) * 10) / 10;

/** Whether two boxes overlap. */
const overlap = (a: CellBox, b: CellBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test.describe("Layout geometry (#989)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width; the grid's width is set per case");

    test("at 1440px the resting page: the KPI rail 12, the revenue trend 8 beside the breakdown 4, the assignment board 12 — 12px between columns and rows", async ({ page }) => {
        const entry = await openLayout(page, "layoutPage");
        await expect.poll(async () => {
            const b = await boxes(entry);
            const kpi = b["kpi-rail"]!, trend = b["revenue-trend"]!, bars = b["breakdown-bars"]!, board = b["assignment-board"]!;
            return {
                kpi: [kpi.x, kpi.w], trend: [trend.x, trend.w, trend.h], bars: [bars.x, bars.w, bars.h], board: [board.x, board.w],
                middleGap: trend.y - (kpi.y + kpi.h), sameRow: trend.y === bars.y, boardGap: board.y - (trend.y + trend.h),
            };
        }).toEqual({
            kpi: [0, 1440], trend: [0, spanWidth(1440, 8), 280], bars: [spanWidth(1440, 8) + 12, spanWidth(1440, 4), 280], board: [0, 1440],
            middleGap: 12, sameRow: true, boardGap: 12,
        });
    });

    test("a row whose spans pass 12 continues on a line below, and nothing overlaps", async ({ page }) => {
        const entry = await openLayout(page, "layoutPage");
        await setCell(entry, "revenue-trend", { style: { "--layout-span": "10" } });
        await expect.poll(async () => {
            const b = await boxes(entry);
            const trend = b["revenue-trend"]!, bars = b["breakdown-bars"]!, board = b["assignment-board"]!;
            return { barsX: bars.x, barsBelow: bars.y - (trend.y + trend.h), boardBelow: board.y > bars.y + bars.h, overlaps: overlap(trend, bars) || overlap(bars, board) };
        }).toEqual({ barsX: 0, barsBelow: 12, boardBelow: true, overlaps: false });
    });

    test("a row is as tall as its tallest tile, and align places a shorter one at the top, the centre, or the full height", async ({ page }) => {
        const entry = await openLayout(page, "layoutPage");
        const at = () => entry.evaluate((root) => {
            const grid = root.querySelector("[data-layout-grid]")!.getBoundingClientRect();
            const row = root.querySelector('[data-layout-row="middle"]')!.getBoundingClientRect();
            const bars = root.querySelector('[data-layout-cell="breakdown-bars"]')!.getBoundingClientRect();
            const trend = root.querySelector('[data-layout-cell="revenue-trend"]')!.getBoundingClientRect();
            return { rowTop: row.top - grid.top, rowH: row.height, trendH: trend.height, y: bars.top - grid.top, h: bars.height };
        });
        // The row is its tallest tile's height.
        await expect.poll(async () => { const m = await at(); return m.rowH === Math.max(m.trendH, m.h); }, "tallest").toBe(true);
        // A shorter breakdown at the top, then centred.
        await setCell(entry, "breakdown-bars", { style: { height: "200px" }, attr: ["data-align", "top"] });
        await expect.poll(async () => { const m = await at(); return [m.y - m.rowTop, m.h]; }, "top").toEqual([0, 200]);
        await setCell(entry, "breakdown-bars", { attr: ["data-align", "center"] });
        await expect.poll(async () => { const m = await at(); return [m.y - m.rowTop, m.h]; }, "center").toEqual([(280 - 200) / 2, 200]);
        // Without a height, stretch takes the row's full height.
        await setCell(entry, "breakdown-bars", { style: { height: "" }, attr: ["data-align", "stretch"] });
        await expect.poll(async () => { const m = await at(); return [m.y - m.rowTop, m.h === m.rowH]; }, "stretch").toEqual([0, true]);
    });

    test("a framed tile is paper with a 1px strong rule, a 10px radius and its content clipped — no header strip; a bare tile draws nothing, nor does the Layout", async ({ page }) => {
        const entry = await openLayout(page, "layoutPage");
        const frame = () => entry.evaluate((root) => {
            const el = root.querySelector('[data-layout-cell="assignment-board"]')!;
            const s = getComputedStyle(el);
            const layout = getComputedStyle(root.querySelector("[data-layout]")!);
            return {
                border: `${s.borderTopWidth} ${s.borderTopStyle}`, radius: s.borderTopLeftRadius, overflow: s.overflow,
                paper: s.backgroundColor !== "rgba(0, 0, 0, 0)", children: el.children.length,
                layoutBorder: layout.borderTopWidth,
            };
        });
        await expect.poll(frame).toEqual({ border: "1px solid", radius: "10px", overflow: "hidden", paper: true, children: 1, layoutBorder: "0px" });
        await setCell(entry, "assignment-board", { attr: ["data-frame", null] });
        await expect.poll(() => entry.evaluate((root) => {
            const s = getComputedStyle(root.querySelector('[data-layout-cell="assignment-board"]')!);
            return { border: s.borderTopWidth, background: s.backgroundColor };
        })).toEqual({ border: "0px", background: "rgba(0, 0, 0, 0)" });
    });

    test("the spans answer to the grid's width: declared from 960px, 6 or 12 from 480px, the full width under it", async ({ page }) => {
        const entry = await openLayout(page, "layoutPage");
        // 960: the declared spans.
        await widthTo(entry, 960);
        await expect.poll(async () => {
            const b = await boxes(entry);
            return [b["revenue-trend"]!.w, b["breakdown-bars"]!.x, b["breakdown-bars"]!.w];
        }, "960").toEqual([spanWidth(960, 8), spanWidth(960, 8) + 12, spanWidth(960, 4)]);
        // 600: the trend (8) takes 12, the breakdown (4) takes 6 on the line below.
        await widthTo(entry, 600);
        await expect.poll(async () => {
            const b = await boxes(entry);
            const trend = b["revenue-trend"]!, bars = b["breakdown-bars"]!;
            return { trend: trend.w, bars: [bars.x, bars.w], below: bars.y - (trend.y + trend.h), kpi: b["kpi-rail"]!.w };
        }, "600").toEqual({ trend: 600, bars: [0, spanWidth(600, 6)], below: 12, kpi: 600 });
        // 390: every tile the full width, in row order.
        await widthTo(entry, 390);
        await expect.poll(async () => {
            const b = await boxes(entry);
            const order = ["kpi-rail", "revenue-trend", "breakdown-bars", "assignment-board"].map((k) => b[k]!);
            return { widths: order.map((c) => c.w), ordered: order.every((c, i) => i === 0 || c.y > order[i - 1]!.y) };
        }, "390").toEqual({ widths: [390, 390, 390, 390], ordered: true });
    });

    test("a wireframe draws each cell as an outline at its tile's size and leaves its content out, at its declared spans", async ({ page }) => {
        const entry = await openLayout(page, "layoutWireframe");
        const inner = 480 - 2 * 8;
        await expect.poll(async () => {
            const b = await boxes(entry);
            return {
                kpis: ["kpi-1", "kpi-2", "kpi-3", "kpi-4"].map((k) => [b[k]!.w, b[k]!.h]),
                sameLine: new Set(["kpi-1", "kpi-2", "kpi-3", "kpi-4"].map((k) => b[k]!.y)).size,
                trend: [b["trend"]!.w, b["trend"]!.h], bars: [b["bars"]!.w, b["bars"]!.h], board: [b["board"]!.w, b["board"]!.h],
            };
        }).toEqual({
            kpis: Array.from({ length: 4 }, () => [spanWidth(inner, 3, 4), 48]),
            sameLine: 1,
            trend: [spanWidth(inner, 8, 4), 120], bars: [spanWidth(inner, 4, 4), 120], board: [inner, 24],
        });
        await expect.poll(() => entry.evaluate((root) => {
            const cells = [...root.querySelectorAll("[data-layout-cell]")];
            const s = getComputedStyle(cells[0]!);
            return { border: `${s.borderTopWidth} ${s.borderTopStyle}`, radius: s.borderTopLeftRadius, empty: cells.every((c) => c.children.length === 0) };
        })).toEqual({ border: "1px solid", radius: "2px", empty: true });
    });
});
