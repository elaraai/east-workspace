/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The SnapGrid's geometry, measured in a real browser (#989): rows of tiles on
 * the 12-column grid with 12px gaps, a row that passes 12 continuing below,
 * a row as tall as its tallest tile, the tile frame, the widths the spans
 * answer to, and the wireframe. The grid's width is set on the page — its
 * container queries answer to it — so each width is measured on one example:
 * 1440, 960, 600 and 390px. Every measurement is polled until it holds, on a
 * page at rest; no screenshot is read.
 *
 * The editing canvas (#990), on the builder example: the column ruler and
 * the bands, the end zone and the stage a drag resting on it draws, a height
 * drag snapping to a neighbour's edge (the guide) and to 40px steps, and a
 * span drag under a design width and a zoom — pointer gestures a real
 * browser lays out, where the DOM tests fake the layout.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test snap-grid-geometry --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** A cell's box, relative to the grid. */
interface CellBox { x: number; y: number; w: number; h: number }

/** The page example's tiles, in the order its placements hold them. */
const PAGE = ["revenue", "orders", "avg-ticket", "fill-rate", "revenue-trend", "breakdown", "accounts"];

/** Open a SnapGrid example's page and return its first grid, at rest. */
async function openGrid(page: Page, name: string): Promise<Locator> {
    await page.goto(`/?theme=light#layout/snap-grid/${name}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#layout/snap-grid/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const grid = entry.locator("[data-snap-grid]").first();
    await expect(grid).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return grid;
}

/** Every cell's box, relative to the grid, by key, rounded to a tenth of a pixel. */
function boxes(grid: Locator): Promise<Record<string, CellBox>> {
    return grid.evaluate((root) => {
        const body = root.querySelector("[data-snap-grid-body]")!.getBoundingClientRect();
        const round = (n: number) => Math.round(n * 10) / 10;
        return Object.fromEntries([...root.querySelectorAll("[data-snap-grid-cell]")].map((el) => {
            const b = el.getBoundingClientRect();
            return [el.getAttribute("data-snap-grid-cell")!, { x: round(b.left - body.left), y: round(b.top - body.top), w: round(b.width), h: round(b.height) }];
        }));
    });
}

/** Set the grid's width. */
function widthTo(grid: Locator, px: number): Promise<void> {
    return grid.evaluate((root, w) => {
        (root.querySelector("[data-snap-grid-body]") as HTMLElement).style.width = `${w}px`;
    }, px);
}

/** Set one cell's inline style property, or an attribute when `attr` names one. */
function setCell(grid: Locator, key: string, change: { style?: Record<string, string>; attr?: [string, string | null] }): Promise<void> {
    return grid.evaluate((root, { key, change }) => {
        const el = root.querySelector(`[data-snap-grid-cell="${key}"]`) as HTMLElement;
        for (const [name, v] of Object.entries(change.style ?? {})) el.style.setProperty(name, v);
        if (change.attr !== undefined) {
            const [name, v] = change.attr;
            if (v === null) el.removeAttribute(name); else el.setAttribute(name, v);
        }
    }, { key, change });
}

/** A span's width on a row `width` px wide with `gap` px gaps: its columns and the gaps between them. */
const spanWidth = (width: number, span: number, gap = 12) => Math.round((((width - 11 * gap) / 12) * span + (span - 1) * gap) * 10) / 10;

/** A difference of rounded boxes, rounded again — subtraction leaves float noise. */
const tenth = (n: number) => Math.round(n * 10) / 10;

/** Whether two boxes overlap. */
const overlap = (a: CellBox, b: CellBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test.describe("SnapGrid geometry (#989)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width; the grid's width is set per case");

    test("at 1440px the page: four KPI tiles of 3, the revenue trend 8 beside the breakdown 4, the accounts 12 — 12px between columns and rows", async ({ page }) => {
        const grid = await openGrid(page, "snapGridPage");
        await widthTo(grid, 1440);
        const kpi = spanWidth(1440, 3);
        await expect.poll(async () => {
            const b = await boxes(grid);
            const trend = b["revenue-trend"]!, bars = b["breakdown"]!, accounts = b["accounts"]!;
            const kpis = PAGE.slice(0, 4).map((k) => b[k]!);
            return {
                kpis: kpis.map((c) => [c.x, c.w]), kpiLine: new Set(kpis.map((c) => c.y)).size,
                trend: [trend.x, trend.w, trend.h], bars: [bars.x, bars.w, bars.h], accounts: [accounts.x, accounts.w],
                chartsGap: tenth(trend.y - (kpis[0]!.y + Math.max(...kpis.map((c) => c.h)))), sameRow: trend.y === bars.y,
                accountsGap: tenth(accounts.y - (trend.y + trend.h)),
            };
        }).toEqual({
            kpis: [0, 1, 2, 3].map((i) => [i * (kpi + 12), kpi]), kpiLine: 1,
            trend: [0, spanWidth(1440, 8), 220], bars: [spanWidth(1440, 8) + 12, spanWidth(1440, 4), 220], accounts: [0, 1440],
            chartsGap: 12, sameRow: true, accountsGap: 12,
        });
    });

    test("a row whose spans pass 12 continues on a line below, and nothing overlaps", async ({ page }) => {
        const grid = await openGrid(page, "snapGridPage");
        await widthTo(grid, 1440);
        await setCell(grid, "revenue-trend", { style: { "--snap-grid-span": "10" } });
        await expect.poll(async () => {
            const b = await boxes(grid);
            const trend = b["revenue-trend"]!, bars = b["breakdown"]!, accounts = b["accounts"]!;
            return { barsX: bars.x, barsBelow: tenth(bars.y - (trend.y + trend.h)), accountsBelow: accounts.y > bars.y + bars.h, overlaps: overlap(trend, bars) || overlap(bars, accounts) };
        }).toEqual({ barsX: 0, barsBelow: 12, accountsBelow: true, overlaps: false });
    });

    test("a row is as tall as its tallest tile, and align places a shorter one at the top, the centre, or the full height", async ({ page }) => {
        const grid = await openGrid(page, "snapGridPage");
        await widthTo(grid, 1440);
        const at = () => grid.evaluate((root) => {
            const body = root.querySelector("[data-snap-grid-body]")!.getBoundingClientRect();
            const row = root.querySelector('[data-snap-grid-row="charts"]')!.getBoundingClientRect();
            const bars = root.querySelector('[data-snap-grid-cell="breakdown"]')!.getBoundingClientRect();
            const trend = root.querySelector('[data-snap-grid-cell="revenue-trend"]')!.getBoundingClientRect();
            return { rowTop: row.top - body.top, rowH: row.height, trendH: trend.height, y: bars.top - body.top, h: bars.height };
        });
        // The row is its tallest tile's height, and the breakdown stretches to it.
        await expect.poll(async () => { const m = await at(); return [m.rowH, m.h, m.y - m.rowTop]; }, "stretched").toEqual([220, 220, 0]);
        // A shorter breakdown at the top, then centred.
        await setCell(grid, "breakdown", { style: { height: "200px" }, attr: ["data-align", "top"] });
        await expect.poll(async () => { const m = await at(); return [m.y - m.rowTop, m.h]; }, "top").toEqual([0, 200]);
        await setCell(grid, "breakdown", { attr: ["data-align", "center"] });
        await expect.poll(async () => { const m = await at(); return [m.y - m.rowTop, m.h]; }, "center").toEqual([(220 - 200) / 2, 200]);
        // Without a height, stretch takes the row's full height again.
        await setCell(grid, "breakdown", { style: { height: "" }, attr: ["data-align", "stretch"] });
        await expect.poll(async () => { const m = await at(); return [m.y - m.rowTop, m.h === m.rowH]; }, "stretch").toEqual([0, true]);
    });

    test("a framed tile is paper with a 1px strong rule, a 10px radius and its content clipped — no header strip; a bare tile draws nothing, nor does the SnapGrid", async ({ page }) => {
        const grid = await openGrid(page, "snapGridPage");
        const frame = () => grid.evaluate((root) => {
            const el = root.querySelector('[data-snap-grid-cell="accounts"]')!;
            const s = getComputedStyle(el);
            const own = getComputedStyle(root);
            return {
                border: `${s.borderTopWidth} ${s.borderTopStyle}`, radius: s.borderTopLeftRadius, overflow: s.overflow,
                paper: s.backgroundColor !== "rgba(0, 0, 0, 0)", children: el.children.length,
                gridBorder: own.borderTopWidth,
            };
        });
        await expect.poll(frame).toEqual({ border: "1px solid", radius: "10px", overflow: "hidden", paper: true, children: 1, gridBorder: "0px" });
        await setCell(grid, "accounts", { attr: ["data-frame", null] });
        await expect.poll(() => grid.evaluate((root) => {
            const s = getComputedStyle(root.querySelector('[data-snap-grid-cell="accounts"]')!);
            return { border: s.borderTopWidth, background: s.backgroundColor };
        })).toEqual({ border: "0px", background: "rgba(0, 0, 0, 0)" });
    });

    test("the spans answer to the grid's width: declared from 960px, 6 or 12 from 480px, the full width under it", async ({ page }) => {
        const grid = await openGrid(page, "snapGridPage");
        // 960: the declared spans.
        await widthTo(grid, 960);
        await expect.poll(async () => {
            const b = await boxes(grid);
            return [b["revenue"]!.w, b["revenue-trend"]!.w, b["breakdown"]!.x, b["breakdown"]!.w];
        }, "960").toEqual([spanWidth(960, 3), spanWidth(960, 8), spanWidth(960, 8) + 12, spanWidth(960, 4)]);
        // 600: a KPI (3) takes 6, two to a line; the trend (8) takes 12, the breakdown (4) 6 on the line below.
        await widthTo(grid, 600);
        await expect.poll(async () => {
            const b = await boxes(grid);
            const trend = b["revenue-trend"]!, bars = b["breakdown"]!;
            return {
                kpis: [b["revenue"]!.x, b["orders"]!.x, b["avg-ticket"]!.x].concat(b["revenue"]!.w), secondLine: b["avg-ticket"]!.y > b["revenue"]!.y,
                trend: trend.w, bars: [bars.x, bars.w], below: tenth(bars.y - (trend.y + trend.h)), accounts: b["accounts"]!.w,
            };
        }, "600").toEqual({
            kpis: [0, spanWidth(600, 6) + 12, 0, spanWidth(600, 6)], secondLine: true,
            trend: 600, bars: [0, spanWidth(600, 6)], below: 12, accounts: 600,
        });
        // 390: every tile the full width, in the order the placements hold them.
        await widthTo(grid, 390);
        await expect.poll(async () => {
            const b = await boxes(grid);
            const order = PAGE.map((k) => b[k]!);
            return { widths: order.map((c) => c.w), ordered: order.every((c, i) => i === 0 || c.y > order[i - 1]!.y) };
        }, "390").toEqual({ widths: PAGE.map(() => 390), ordered: true });
    });

    test("a wireframe draws each cell as an outline at its declared size and leaves its content out; an auto-height cell is as tall as its row", async ({ page }) => {
        const grid = await openGrid(page, "snapGridWireframe");
        // 14px in, 3px between columns (the page library's thumbnail).
        const inner = 160 - 2 * 14;
        await expect.poll(async () => {
            const b = await boxes(grid);
            const kpis = PAGE.slice(0, 4).map((k) => b[k]!);
            return {
                kpis: kpis.map((c) => [c.w, c.h]), sameLine: new Set(kpis.map((c) => c.y)).size,
                trend: [b["revenue-trend"]!.w, b["revenue-trend"]!.h], bars: [b["breakdown"]!.w, b["breakdown"]!.h],
                accounts: [b["accounts"]!.w, b["accounts"]!.h],
            };
        }).toEqual({
            kpis: Array.from({ length: 4 }, () => [spanWidth(inner, 3, 3), 12]),
            sameLine: 1,
            trend: [spanWidth(inner, 8, 3), 64], bars: [spanWidth(inner, 4, 3), 64], accounts: [inner, 20],
        });
        await expect.poll(() => grid.evaluate((root) => {
            const cells = [...root.querySelectorAll("[data-snap-grid-cell]")];
            const s = getComputedStyle(cells[0]!);
            return { border: `${s.borderTopWidth} ${s.borderTopStyle}`, radius: s.borderTopLeftRadius, empty: cells.every((c) => c.children.length === 0) };
        })).toEqual({ border: "1px solid", radius: "2px", empty: true });
        // With no content drawn to size it, an auto-height cell keeps the wireframe's row height.
        await setCell(grid, "accounts", { style: { height: "" }, attr: ["data-auto-height", ""] });
        await expect.poll(async () => (await boxes(grid))["accounts"]!.h, "auto").toBe(24);
    });
});

/** Open the builder example and return its canvas's editor, at rest. */
async function openEditor(page: Page): Promise<Locator> {
    await page.goto("/?theme=light#layout/snap-grid/snapGridEditor");
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator('a[href="#layout/snap-grid/snapGridEditor"]') });
    await entry.scrollIntoViewIfNeeded();
    const editor = entry.locator("[data-snap-grid-editor]").first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return editor;
}

/** An element's box, in client px. */
function boxOf(el: Locator): Promise<{ x: number; y: number; w: number; h: number }> {
    return el.evaluate((node) => {
        const b = node.getBoundingClientRect();
        return { x: b.left, y: b.top, w: b.width, h: b.height };
    });
}

/** A tile's frame height, in layout px. */
const frameHeight = (editor: Locator, key: string) =>
    editor.locator(`[data-snap-grid-tile="${key}"] > [data-frame]`).evaluate((el) => (el as HTMLElement).offsetHeight);

test.describe("SnapGrid editing canvas (#990)", () => {
    // Keyed on the device, not the width: the viewport below is this block's own —
    // tall enough that the builder's frame (#995) holds the end zone clear of
    // the window's edge, where a resting drag would scroll the page.
    test.skip(({ isMobile }) => isMobile, "the builder is a desktop surface, measured with a mouse");
    test.use({ viewport: { width: 1600, height: 1200 } });

    test("guides: a 24px ruler of 12 columns over the rows with a 2px top rule, the selected tile's columns in brand at 600, and a band behind each column", async ({ page }) => {
        const editor = await openEditor(page);
        await expect.poll(() => editor.evaluate((root) => {
            const marks = [...root.querySelector("[data-snap-grid-ruler]")!.children] as HTMLElement[];
            const bands = [...root.querySelector("[data-snap-grid-bands]")!.children] as HTMLElement[];
            const round = (n: number) => Math.round(n * 10) / 10;
            return {
                n: marks.length,
                heights: [...new Set(marks.map((m) => round(m.getBoundingClientRect().height)))],
                rules: [...new Set(marks.map((m) => getComputedStyle(m).borderTopWidth))],
                on: marks.map((m) => m.hasAttribute("data-on")),
                onWeight: [...new Set(marks.filter((m) => m.hasAttribute("data-on")).map((m) => getComputedStyle(m).fontWeight))],
                bandsUnder: bands.length === 12 && bands.every((b, i) => {
                    const bb = b.getBoundingClientRect(), mb = marks[i]!.getBoundingClientRect();
                    return Math.abs(bb.left - mb.left) < 0.5 && Math.abs(bb.width - mb.width) < 0.5 && bb.top >= mb.bottom;
                }),
            };
        })).toEqual({
            n: 12, heights: [24], rules: ["2px"],
            // The trend, selected, spans columns 1–8.
            on: [true, true, true, true, true, true, true, true, false, false, false, false],
            onWeight: ["600"], bandsUnder: true,
        });
    });

    test("the end zone: 64px, dashed, a 10px radius, 12px under the last row; resting a tile on it makes it the target, and the tile takes a row of its own", async ({ page }) => {
        const editor = await openEditor(page);
        const zone = editor.locator("[data-snap-grid-end]");
        const box = zone.locator(":scope > *").first();
        const words = () => zone.evaluate((z) => [...z.querySelectorAll("span")].filter((s) => getComputedStyle(s).display !== "none").map((s) => s.textContent));
        await expect.poll(() => box.evaluate((el) => {
            const s = getComputedStyle(el);
            return { h: el.getBoundingClientRect().height, border: `${s.borderTopWidth} ${s.borderTopStyle}`, radius: s.borderTopLeftRadius };
        })).toEqual({ h: 64, border: "1px dashed", radius: "10px" });
        await expect.poll(async () => {
            const last = await boxOf(editor.locator("[data-snap-grid-row]").last());
            const b = await boxOf(box);
            return tenth(b.y - (last.y + last.h));
        }).toBe(12);
        await expect.poll(words).toEqual(["Drag from the library · new 12-col row"]);
        const rest = await box.evaluate((el) => getComputedStyle(el).backgroundColor);
        // Pick the breakdown up by its body and rest it on the end zone.
        const tile = await boxOf(editor.locator('[data-snap-grid-tile="region"]'));
        const target = await boxOf(box);
        await page.mouse.move(tile.x + tile.w / 2, tile.y + tile.h / 2);
        await page.mouse.down();
        await page.mouse.move(tile.x + tile.w / 2 + 20, tile.y + tile.h / 2 + 20, { steps: 4 });
        await page.mouse.move(target.x + target.w / 2, target.y + target.h / 2, { steps: 8 });
        await expect.poll(words).toEqual(["▾ Drop component here · snaps to a new 12-col row"]);
        expect(await box.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(rest);
        await page.mouse.up();
        await expect.poll(() => editor.evaluate((root) =>
            [...root.querySelectorAll("[data-snap-grid-row]")].map((r) => [...r.querySelectorAll("[data-snap-grid-tile]")].map((t) => t.getAttribute("data-snap-grid-tile"))),
        )).toEqual([["kpi"], ["trend"], ["board"], ["region"]]);
        await expect.poll(words).toEqual(["Drag from the library · new 12-col row"]);
    });

    test("a height drag snaps to a neighbour's bottom edge within 16px, drawing the dashed guide while it holds, and to 40px steps past it", async ({ page }) => {
        const editor = await openEditor(page);
        await editor.locator('[data-snap-grid-tile="region"]').click();
        const handle = editor.locator('[data-snap-grid-tile="region"] [data-handle="height"]');
        await expect(handle).toBeVisible();
        const trendH = await frameHeight(editor, "trend");
        const regionH = await frameHeight(editor, "region");
        expect(trendH).not.toBe(regionH);
        const h = await boxOf(handle);
        const x = h.x + h.w / 2, y = h.y + h.h / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        // 6px past the trend's bottom edge: it snaps to it, and the guide runs across the row there.
        await page.mouse.move(x, y + (trendH - regionH) + 6, { steps: 4 });
        await expect.poll(() => frameHeight(editor, "region")).toBe(trendH);
        await expect.poll(() => editor.evaluate((root) => {
            const guide = root.querySelector<HTMLElement>("[data-snap-grid-guide]");
            return guide === null ? null : { top: Number.parseFloat(guide.style.top), style: getComputedStyle(guide).borderTopStyle };
        })).toEqual({ top: trendH, style: "dashed" });
        // Well past it: a 40px step, and no guide.
        await page.mouse.move(x, y + (trendH - regionH) + 70, { steps: 4 });
        const stepped = Math.round((trendH + 70) / 40) * 40;
        await expect.poll(() => frameHeight(editor, "region")).toBe(stepped);
        await expect.poll(() => editor.locator("[data-snap-grid-guide]").count()).toBe(0);
        await page.mouse.up();
        // Released, it stays — a draft the history can undo.
        await expect.poll(() => frameHeight(editor, "region")).toBe(stepped);
        await expect(editor.getByRole("button", { name: "Undo" })).toBeEnabled();
    });

    test("under a design width and a zoom the canvas draws at the width times the zoom, scrolls in its host, and a span drag snaps per zoomed column", async ({ page }) => {
        const editor = await openEditor(page);
        const canvas = editor.locator("[data-snap-grid-canvas]");
        await canvas.evaluate((el) => { (el as HTMLElement).style.width = "1440px"; (el as HTMLElement).style.setProperty("zoom", "0.5"); });
        await expect.poll(async () => tenth((await boxOf(canvas)).w)).toBe(720);
        await expect.poll(() => editor.evaluate((root) => {
            const viewport = root.querySelector("[data-snap-grid-canvas]")!.parentElement!;
            return viewport.scrollWidth > viewport.clientWidth;
        })).toBe(true);
        const handle = editor.locator('[data-snap-grid-tile="trend"] [data-handle="span"]');
        await handle.scrollIntoViewIfNeeded();
        const row = await boxOf(editor.locator('[data-snap-grid-row="charts"]'));
        const tile = await boxOf(editor.locator('[data-snap-grid-tile="trend"]'));
        const h = await boxOf(handle);
        // The zoomed row's columns: its width less 11 gaps of 12 × 0.5, over 12.
        const gap = 6, column = (row.w - 11 * gap) / 12;
        const at6 = tile.x + 6 * (column + gap) - gap;
        await page.mouse.move(h.x + h.w / 2, h.y + h.h / 2);
        await page.mouse.down();
        await page.mouse.move(at6, h.y + h.h / 2, { steps: 6 });
        await page.mouse.up();
        await expect.poll(() => editor.locator('[data-snap-grid-tile="trend"]').evaluate((el) => (el as HTMLElement).style.getPropertyValue("--snap-grid-span"))).toBe("6");
    });
});
