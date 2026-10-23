/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What scrolling and a page landing cost the main thread (#1398, CL9) —
 * `E3_UI_PERF=1`, never in CI: a timing on a shared runner is no deterministic
 * signal. On the built showcase and its in-page e3, each a scripted scroll, a
 * frame at a time:
 *
 * - the stress Sheet's two thousand jobs (`sheetStress`, its All tab), down
 *   their rows at 1,500 px/s for 3 s, and again over the same rows. Every one
 *   of its rows is in already: the lens it opens on reads the record's one
 *   segment, and that read answers each window after it, so no window lands
 *   as it scrolls — the cost of scrolling resident rows;
 * - the indexed Sheet's fifty thousand work orders (`sheetRecordIndexes`, its
 *   All tab), from the middle down at 1,500 px/s for 3 s, the windows it reads
 *   ahead landing as it goes; flung at 12,000 px/s for 3 s, over windows not
 *   read, to rest where it stops and the windows there land; and one landing —
 *   its rows sent on with their reads held (the e3 fault hook), then let go:
 *   what the windows landing cost, from their bytes to their rows on screen;
 * - the Calendar's 12,000 events (`calendarRecordIndexes`) across its
 *   Timeline at 1,500 px/s for 3 s.
 *
 * Each records the frames (how many, the longest, how many took longer than one
 * and two 60 Hz frames), the long animation frames — the browser's
 * `long-animation-frame` entries: how many, their total and blocking time, the
 * longest, the time in script, in forced style and layout, in the rendering
 * phase and in style and layout, and the script time by what invoked it — and
 * the page reads the page made meanwhile. It prints them as JSON and holds no
 * budget.
 *
 * Run (from the showcase, over its build):
 * `E3_UI_PERF=1 pnpm exec playwright test perf-scroll --project desktop --workers 1`.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { visitBuilder } from "./builder-page";
import { e3Requests, heldE3, holdE3, installE3Faults, releaseE3 } from "./e3-faults";
import { settled } from "./settle";

/** Whether the measurement runs: `E3_UI_PERF=1`, as the renderers' benchmarks are asked for. */
const PERF = process.env["E3_UI_PERF"] === "1";

/** A scripted scroll's speeds, px/s, and its length. */
const SPEED = 1_500;
const FLING = 12_000;
const SECONDS = 3;

/** What a stretch of the page's work cost the main thread. */
interface Cost {
    readonly ms: number;
    readonly frames: number;
    readonly fps: number;
    readonly longestFrame: number;
    readonly over16: number;
    readonly over33: number;
    readonly loaf: {
        readonly count: number;
        readonly total: number;
        readonly blocking: number;
        readonly longest: number;
        readonly script: number;
        readonly forcedStyleAndLayout: number;
        readonly rendering: number;
        readonly styleAndLayout: number;
        readonly byInvoker: readonly string[];
    };
}

/** The measurement's state on the page's window. */
const PROBE = "__cl9Probe";

/**
 * The page's main-thread cost while `work` runs: the frames it drew and the
 * long animation frames the browser reported, the last delivered after `work`
 * is done.
 */
async function costOf(page: Page, work: () => Promise<unknown>): Promise<Cost> {
    await page.evaluate((name) => {
        const probe = { loafs: [] as PerformanceEntry[], frames: [] as number[], drawing: true, start: performance.now(), observer: undefined as PerformanceObserver | undefined };
        probe.observer = new PerformanceObserver((list) => { probe.loafs.push(...list.getEntries()); });
        probe.observer.observe({ type: "long-animation-frame", buffered: false });
        const frame = (now: number) => { probe.frames.push(now); if (probe.drawing) requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
        (window as unknown as Record<string, unknown>)[name] = probe;
    }, PROBE);
    await work();
    return page.evaluate(async (name): Promise<Cost> => {
        type Script = { duration: number; invoker: string; invokerType: string; forcedStyleAndLayoutDuration: number };
        type Loaf = PerformanceEntry & { blockingDuration: number; renderStart: number; styleAndLayoutStart: number; scripts: Script[] };
        const probe = (window as unknown as Record<string, { loafs: Loaf[]; frames: number[]; drawing: boolean; start: number; observer: PerformanceObserver }>)[name]!;
        const end = performance.now();
        probe.drawing = false;
        // The last frames' entries are delivered after them.
        await new Promise((resolve) => setTimeout(resolve, 500));
        probe.observer.disconnect();
        const frames = probe.frames.filter((t) => t <= end);
        const gaps = frames.slice(1).map((t, i) => t - frames[i]!);
        const during = probe.loafs.filter((l) => l.startTime + l.duration >= probe.start && l.startTime <= end);
        const byInvoker = new Map<string, number>();
        let script = 0;
        let forced = 0;
        let rendering = 0;
        let styleAndLayout = 0;
        for (const l of during) {
            const frameEnd = l.startTime + l.duration;
            if (l.renderStart > 0) rendering += frameEnd - l.renderStart;
            if (l.styleAndLayoutStart > 0) styleAndLayout += frameEnd - l.styleAndLayoutStart;
            for (const s of l.scripts) {
                script += s.duration;
                forced += s.forcedStyleAndLayoutDuration;
                const key = `${s.invokerType} ${s.invoker}`;
                byInvoker.set(key, (byInvoker.get(key) ?? 0) + s.duration);
            }
        }
        const round = (n: number) => Math.round(n);
        const seconds = (end - probe.start) / 1000;
        return {
            ms: round(end - probe.start),
            frames: frames.length,
            fps: Math.round((frames.length / seconds) * 10) / 10,
            longestFrame: round(Math.max(0, ...gaps)),
            over16: gaps.filter((g) => g > 1000 / 60 + 0.5).length,
            over33: gaps.filter((g) => g > 2000 / 60 + 0.5).length,
            loaf: {
                count: during.length,
                total: round(during.reduce((sum, l) => sum + l.duration, 0)),
                blocking: round(during.reduce((sum, l) => sum + l.blockingDuration, 0)),
                longest: round(Math.max(0, ...during.map((l) => l.duration))),
                script: round(script),
                forcedStyleAndLayout: round(forced),
                rendering: round(rendering),
                styleAndLayout: round(styleAndLayout),
                byInvoker: [...byInvoker.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}: ${round(v)} ms`),
            },
        };
    }, PROBE);
}

/** A scroll of `target` at `speed` px/s for {@link SECONDS}, along `axis`, a frame at a time: the px it moved. */
function scroll(target: Locator, axis: "x" | "y", speed: number): Promise<number> {
    return target.evaluate(async (el, { axis, speed, seconds }) => {
        const from = axis === "y" ? el.scrollTop : el.scrollLeft;
        const start = performance.now();
        await new Promise<void>((resolve) => {
            const tick = (now: number) => {
                const t = Math.min(seconds, (now - start) / 1000);
                if (axis === "y") el.scrollTop = from + speed * t;
                else el.scrollLeft = from + speed * t;
                if (t < seconds) requestAnimationFrame(tick);
                else resolve();
            };
            requestAnimationFrame(tick);
        });
        return Math.round(Math.abs((axis === "y" ? el.scrollTop : el.scrollLeft) - from));
    }, { axis, speed, seconds: SECONDS });
}

/** The rows' scroller in a builder's main. */
function rowsOf(entry: Locator): Locator {
    return entry.locator("[data-frame-slot='main'] [data-virtual-rows]").first();
}

test.describe("what scrolling and a landing cost the main thread (#1398, CL9; E3_UI_PERF=1, not a CI gate)", () => {
    test.skip(!PERF, "E3_UI_PERF=1 only: a timing on a shared runner is no CI gate");

    test("the stress Sheet, the indexed Sheet and the Calendar's Timeline, scrolled, flung and landing @desktop", async ({ page }) => {
        test.setTimeout(420_000);
        await installE3Faults(page);
        await page.setViewportSize({ width: 1440, height: 1000 });
        const results: Record<string, unknown> = {};
        const pageReads = async () => (await e3Requests(page)).filter((request) => request.kind === "page").length;
        /** A stretch's cost, and the page reads made while it ran. */
        const measure = async (name: string, work: () => Promise<unknown>, extra: Record<string, unknown> = {}) => {
            const before = await pageReads();
            const cost = await costOf(page, work);
            results[name] = { ...extra, pageReads: (await pageReads()) - before, ...cost };
        };

        // The stress Sheet, its rows unnarrowed: every one of them in already.
        const stress = await visitBuilder(page, "e3/sheet/sheet/sheetStress", "[data-builder-frame]", "light");
        await stress.locator('[data-slot="tab"][data-tab="all"]').click();
        await settled(page);
        const stressRows = rowsOf(stress);
        await measure("sheetStress: down its jobs at 1,500 px/s", () => scroll(stressRows, "y", SPEED));
        await settled(page);
        await stressRows.evaluate((el) => { el.scrollTop = 0; });
        await settled(page);
        await measure("sheetStress: down them again", () => scroll(stressRows, "y", SPEED));
        await settled(page);

        // The indexed Sheet, its rows unnarrowed: past the lens's first segment, windows not read.
        const indexed = await visitBuilder(page, "e3/sheet/sheet-records/sheetRecordIndexes", "[data-builder-frame]", undefined);
        await indexed.locator('[data-slot="tab"][data-tab="all"]').click();
        await settled(page);
        const indexedRows = rowsOf(indexed);
        const main = indexed.locator("[data-frame-slot='main']").first();
        await indexedRows.evaluate((el) => { el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * 0.3); });
        await settled(page);
        await measure("sheetRecordIndexes: down from 30% at 1,500 px/s, reads ahead landing", () => scroll(indexedRows, "y", SPEED));
        await settled(page);
        await measure("sheetRecordIndexes: flung at 12,000 px/s over windows not read, to rest and land", async () => {
            await scroll(indexedRows, "y", FLING);
            await expect(main).toHaveAttribute("aria-busy", "false");
            await settled(page);
        });
        // One landing: further on, every page read held, then let go.
        const hold = await holdE3(page, { kinds: ["page"] });
        await indexedRows.evaluate((el) => { el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * 0.8); });
        await expect(indexedRows.locator("[data-unloaded-run][data-filled]").first()).toBeAttached();
        await settled(page, { holding: true });
        const held = await heldE3(page, hold);
        await measure("sheetRecordIndexes: windows landing at 80%", async () => {
            await releaseE3(page, hold);
            await expect(main).toHaveAttribute("aria-busy", "false");
            await settled(page);
        }, { held });

        // The Calendar's Timeline, across its days.
        const calendar = await visitBuilder(page, "e3/calendar/calendar-records/calendarRecordIndexes", "[data-calendar-frame]", undefined);
        const frame = calendar.locator("[data-calendar-frame]").first();
        const radio = frame.getByRole("radio", { name: "Timeline", exact: true });
        if (await radio.isVisible()) await radio.click();
        else {
            await frame.getByRole("button", { name: "View", exact: true }).click();
            await page.getByRole("menuitem", { name: "Timeline", exact: true }).click();
        }
        await settled(page);
        const timeline = frame.locator("[data-calendar-timeline]").first();
        await measure("calendarRecordIndexes: across the Timeline at 1,500 px/s", () => scroll(timeline, "x", SPEED));
        await settled(page);

        console.log(`CL9 ${JSON.stringify(results, null, 2)}`);
        test.info().annotations.push({ type: "CL9", description: JSON.stringify(results) });
    });
});
