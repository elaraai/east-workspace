/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The horizon brush (#1438) measured in a real browser: the shared strip
 * behind the Slice rail's brush and the Plan's horizon band, on the rail
 * example's datetime strip (`sliceRail`), whose window is seeded. Its bars
 * stand on the track's bottom at whole pixels, one width, the tallest 4 short
 * of the track; the window's layer is clipped to it over the band; each edge
 * has a 9px tab 2 in from the track's top and bottom, centred on it — or,
 * where the edge is at an end of the track, inside it, flush with it; a bar's
 * hover stands its Tooltip 8 above the track, inside it; and the keys move
 * the window and clear it. jsdom lays nothing out, so what the strip's DOM
 * tests cannot see is measured here. And the Plan's horizon over a source
 * whose data fills a few days of the window (`planPressTasks`): it holds the
 * window the canvas shows, saying the navigator's dates — its four weeks
 * drawn as weeks, a week of them as days (#1740) — and keeps a window
 * once one steps past the data (#1680's review); a window at the track's ends
 * draws each tab inside it, every point of a tab its own handle's — the
 * resource column's resize, beside the track's start, never under it.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test horizon-brush`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";

const ROUTE = "slice/slice/sliceRail";

/** The rail example's first strip that holds a window, drawn and at rest — by its place, so it is the same strip once its window clears. */
async function openStrip(page: Page): Promise<Locator> {
    await page.goto(`/?theme=light#${ROUTE}`);
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${ROUTE}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const tracks = entry.locator("[data-brush-track]");
    await expect(tracks.locator("[data-brush-band]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    const at = await tracks.evaluateAll((all) => all.findIndex((t) => t.querySelector("[data-brush-band]") !== null));
    const strip = tracks.nth(at);
    await expect(strip.locator("[data-brush-bar]").first()).toBeVisible();
    return strip;
}

test.describe("the horizon brush (#1438)", { tag: "@desktop" }, () => {
    test("sliceRail: bars of one width on whole pixels from the track's bottom, the window's layer clipped to it, and a 9px tab on each edge, 2 in from the track's top and bottom — centred on it, or at an end of the track inside it", async ({ page }) => {
        const strip = await openStrip(page);
        const read = await strip.evaluate((track) => {
            const t = track.getBoundingClientRect();
            const band = track.querySelector("[data-brush-band]")!.getBoundingClientRect();
            const bars = [...track.querySelectorAll("[data-brush-bars=''] > [data-brush-bar]")].map((b) => b.getBoundingClientRect());
            const whole = (n: number) => Math.abs(n - Math.round(n)) < 0.01;
            return {
                widths: [...new Set(bars.map((b) => Math.round(b.width * 100) / 100))],
                onWholePixels: bars.every((b) => whole(b.left - t.left) && whole(b.width) && whole(b.height)),
                onTheBottom: bars.every((b) => Math.abs(b.bottom - t.bottom) < 0.5),
                tallest: Math.max(...bars.map((b) => b.height)),
                trackHeight: t.height,
                masks: track.querySelectorAll("[data-brush-mask]").length,
                clip: getComputedStyle(track.querySelector("[data-brush-bars='in']")!).clipPath,
                handles: [...track.querySelectorAll("[data-brush-handle]")].map((h) => {
                    const r = h.getBoundingClientRect();
                    return { width: r.width, top: r.top - t.top, bottom: t.bottom - r.bottom, right: r.right - t.left, centre: (r.left + r.right) / 2 - t.left };
                }),
                edges: [band.left - t.left, band.right - t.left],
                trackWidth: t.width,
            };
        });
        expect(read.widths).toHaveLength(1);
        expect(read.onWholePixels).toBe(true);
        expect(read.onTheBottom).toBe(true);
        expect(read.tallest).toBeLessThanOrEqual(read.trackHeight - 4);
        expect(read.masks).toBe(0);
        expect(read.clip).toMatch(/^inset\(/);
        expect(read.handles.map((h) => [h.width, h.top, h.bottom])).toEqual([[9, 2, 2], [9, 2, 2]]);
        // The seeded window starts inside the strip and runs to its last instant: its start's tab centred on the edge,
        // its end's inside the track, flush with the edge — nothing of the strip past its track (#1680's review).
        const [from, to] = read.edges as [number, number];
        expect(from, "the window starts more than half a zone into the strip").toBeGreaterThan(6);
        expect(read.trackWidth - to, "the window runs to the strip's end").toBeLessThan(6);
        expect(Math.abs(read.handles[0]!.centre - from)).toBeLessThan(0.75);
        expect(Math.abs(read.handles[1]!.right - to)).toBeLessThan(0.75);
        expect(read.handles[1]!.right).toBeLessThanOrEqual(read.trackWidth + 0.5);
    });

    test("sliceRail: a bar's hover stands its Tooltip 8 above the track, inside it, saying its bucket and its count; a gesture hides it", async ({ page }) => {
        const strip = await openStrip(page);
        const t = (await strip.boundingBox())!;
        const bar = (await strip.locator("[data-brush-bars=''] > [data-brush-bar]").first().boundingBox())!;
        await page.mouse.move(bar.x + bar.width / 2, t.y + t.height - 2);
        const tip = page.locator("[data-brush-tip]");
        await expect(tip).toBeVisible();
        await expect(tip).toHaveText(/ · \d/);
        const r = (await tip.boundingBox())!;
        expect(Math.abs(t.y - (r.y + r.height) - 8)).toBeLessThan(1.5);
        expect(r.x).toBeGreaterThanOrEqual(t.x - 0.5);
        expect(r.x + r.width).toBeLessThanOrEqual(t.x + t.width + 0.5);
        await page.mouse.down();
        await page.mouse.move(bar.x + bar.width / 2 + 40, t.y + t.height - 2, { steps: 4 });
        await expect(tip).toHaveCount(0);
        await page.mouse.up();
    });

    test("sliceRail: the start handle, the window and the end handle are three tab stops; an arrow moves the window, and Escape clears it", async ({ page }) => {
        const strip = await openStrip(page);
        const band = strip.locator("[data-brush-band]");
        const left = async () => (await band.boundingBox())!.x;
        const was = await left();
        await strip.locator("[data-brush-handle='lo']").focus();
        await page.keyboard.press("Tab");
        await expect(strip.locator("[data-brush-window]")).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(strip.locator("[data-brush-handle='hi']")).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("ArrowLeft");
        await expect.poll(left).toBeLessThan(was);
        await page.keyboard.press("Escape");
        await expect(band).toHaveCount(0);
    });

    test("planPressTasks: the Plan's horizon holds the window the canvas shows, though the tasks fill four days of it — saying the navigator's dates, its four weeks drawn as weeks — and a narrower window, a week of days, stepped past the tasks stays on it (#1680's review, #1740)", async ({ page }) => {
        const route = "e3/plan/plan-events/planPressTasks";
        await page.goto(`/?theme=light#${route}`);
        await page.waitForSelector("header");
        const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
        await entry.scrollIntoViewIfNeeded();
        const horizon = entry.locator("[data-slot='horizon']");
        const window = horizon.locator("[data-brush-window]");
        await expect(window).toBeVisible({ timeout: 45_000 });
        await settled(page);
        // The navigator, compact here: its label names the window's first day to its last, its title the range
        // (#1680's review) — never its first day alone.
        const navigator = entry.locator("[data-frame-slot='toolbar'] [data-time-navigation='plan']").first();
        /** A range as the browser's own Intl spaces it: its ends apart by a space, plain or thin, either side of the dash. */
        const ranged = (from: string, to: string) => new RegExp(`^${from}\\s–\\s${to}$`);
        const names = (label: RegExp, title: RegExp) => Promise.all([
            expect(navigator.locator("[data-time-label]")).toHaveText(label),
            expect(navigator.locator("[data-time-trigger]")).toHaveAttribute("title", title),
        ]);
        // The stated four weeks, more days than this plot holds at a column's floor: its columns are weeks, which the
        // navigator's label names, its title their dates (#1740). The tasks fall on 6 to 9 October.
        await expect(window).toHaveAttribute("aria-valuetext", "Oct 5, 2026 – Nov 1, 2026");
        await names(ranged("W41", "W44"), ranged("Oct 5", "Nov 1, 2026"));
        await expect(horizon.locator("[data-brush-handle='lo']")).toHaveAttribute("aria-valuenow", "0");
        await expect(horizon.locator("[data-brush-handle='hi']")).toHaveAttribute("aria-valuenow", "100");
        // Ten columns off its end from the end handle, committed: it keeps the one a window must, a week, and a week's
        // columns are days.
        await horizon.locator("[data-brush-handle='hi']").focus();
        await page.keyboard.press("Shift+ArrowLeft");
        await expect(window).toHaveAttribute("aria-valuetext", "Oct 5, 2026 – Oct 11, 2026");
        await settled(page);
        await names(ranged("Oct 5", "11"), ranged("Oct 5", "11, 2026"));
        await expect(entry.locator("[data-slot='rulerTick']")).toHaveCount(7);
        // Moved by the navigator to the week after, past every task — its calendar, as the toolbar draws it compact
        // here, open on its weeks, the window being a whole one: the window is the canvas's still, its days kept, and on
        // the strip.
        await entry.locator("[data-frame-slot='toolbar'] [data-time-trigger]").first().click();
        await page.locator(`[data-time-picker='plan'] [data-time-week='${Date.UTC(2026, 9, 12)}']`).click();
        await settled(page);
        await expect(window).toHaveAttribute("aria-valuetext", "Oct 12, 2026 – Oct 18, 2026");
        await names(ranged("Oct 12", "18"), ranged("Oct 12", "18, 2026"));
        await expect(entry.locator("[data-slot='rulerTick']")).toHaveCount(7);
    });

    test("planPressTasks: a window at the track's ends draws each tab inside the track, every point of it its own handle's — the start's never the resource column's resize beside it (#1680's review)", async ({ page }) => {
        const route = "e3/plan/plan-events/planPressTasks";
        await page.goto(`/?theme=light#${route}`);
        await page.waitForSelector("header");
        const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
        await entry.scrollIntoViewIfNeeded();
        const horizon = entry.locator("[data-slot='horizon']");
        const lo = horizon.locator("[data-brush-handle='lo']");
        await expect(lo).toBeVisible({ timeout: 45_000 });
        await settled(page);
        await entry.evaluate((el) => { el.scrollIntoView({ block: "start" }); });
        await settled(page);
        // The stated window fills the track: each edge at one of its ends.
        await expect(lo).toHaveAttribute("aria-valuenow", "0");
        await expect(horizon.locator("[data-brush-handle='hi']")).toHaveAttribute("aria-valuenow", "100");
        const read = await horizon.evaluate((root) => {
            const track = root.querySelector("[data-brush-track]")!.getBoundingClientRect();
            /** What a press lands on, named. */
            const named = (hit: Element | null) => hit === null ? "nothing"
                : hit.closest("[data-gutter-handle]") !== null ? "the column's resize"
                    : hit.closest("[data-brush-window]") !== null ? "the window" : hit.tagName;
            return {
                track: { left: track.left, right: track.right },
                tabs: [...root.querySelectorAll<HTMLElement>("[data-brush-handle]")].map((tab) => {
                    const r = tab.getBoundingClientRect(), y = (r.top + r.bottom) / 2;
                    // What a press at each whole pixel across the tab lands on: its own zone — its edge's resize, its
                    // cursor and its hover — or what is over it.
                    const missed: string[] = [];
                    for (let x = Math.ceil(r.left); x < r.right; x++) {
                        const hit = document.elementFromPoint(x, y);
                        if (hit === null || hit.closest("[data-brush-zone]") !== tab.parentElement) missed.push(`${x}: ${named(hit)}`);
                    }
                    return { edge: tab.getAttribute("data-brush-handle"), left: r.left, right: r.right, missed };
                }),
            };
        });
        for (const tab of read.tabs) {
            expect(tab.left, `the ${tab.edge} tab inside the track`).toBeGreaterThanOrEqual(read.track.left - 0.5);
            expect(tab.right, `the ${tab.edge} tab inside the track`).toBeLessThanOrEqual(read.track.right + 0.5);
            expect(tab.missed, `every point of the ${tab.edge} tab its own handle's`).toEqual([]);
        }
        // A drag from the start tab moves the window's start, and leaves the resource column as wide as it was.
        const column = entry.locator("[data-gutter-handle]");
        const edge = async () => { const b = (await column.boundingBox())!; return b.x + b.width; };
        const wide = await edge();
        const tab = (await lo.boundingBox())!;
        await page.mouse.move(tab.x + 2, tab.y + tab.height / 2);
        await page.mouse.down();
        await page.mouse.move(tab.x + 62, tab.y + tab.height / 2, { steps: 10 });
        await page.mouse.up();
        await settled(page);
        await expect.poll(async () => Number(await lo.getAttribute("aria-valuenow")), { message: "the window's start moved" }).toBeGreaterThan(0);
        expect(Math.abs(await edge() - wide), "the resource column's width").toBeLessThan(0.5);
    });
});
