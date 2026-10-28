/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * What gliding the Calendar's Timeline costs the main thread (#1398, CL9) —
 * `E3_UI_PERF=1`, never in CI: a timing on a shared runner is no deterministic
 * signal. As a tester glided it: the indexed Calendar's 12,000 events
 * (`calendarRecordIndexes`) on its Timeline at Month, its frame 1440px wide, light, its
 * scroll moved 50px a frame, to the right and to the left, each from where it
 * opened — 130 frames each way, the frames the tester's 6 s drew, so every
 * build glides over the same days — the browser drawing at the display's rate,
 * as a viewer's does, and the windows the glide re-centres onto read as it goes.
 *
 * Each glide twice: once as it is, for its frames (`main-thread-cost.ts`'
 * `costOf`); then again traced (`traceOf`), for what the main thread spent a
 * frame on — the self time in each phase, script, style, layout, paint and
 * garbage collection, the trace's events with the most of it, and the
 * functions that took it. It prints them as JSON, with the page reads each
 * glide made and the events and rows the timeline had mounted, and holds the
 * glide to the render budget (CL9): a frame at the display's rate, none over
 * 50 ms and no long animation frame.
 *
 * Run (from the showcase, over its build):
 * `E3_UI_PERF=1 pnpm exec playwright test calendar-glide --project desktop --workers 1`.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { e3Requests, installE3Faults } from "./e3-faults";
import { costOf, traceOf, type Cost, type Spent } from "./main-thread-cost";
import { settled } from "./settle";

/** Whether the measurement runs: `E3_UI_PERF=1`, as the renderers' benchmarks are asked for. */
const PERF = process.env["E3_UI_PERF"] === "1";

const ROUTE = "e3/calendar/calendar-records/calendarRecordIndexes";
const ROOT = "[data-calendar-frame]";
/** How far a frame of the glide moves the scroll, px, and its frames: the 130 the tester's 6 s drew. */
const STEP_PX = 50;
const FRAMES = 130;
/** A frame at the display's rate, ms: 60 Hz, and a vsync's slack. */
const FRAME_MS = 1000 / 60 + 0.5;

/**
 * A glide of the timeline's scroll, `px` a frame for {@link FRAMES} frames, each from where the scroll is — a
 * re-centre's move kept — as a trackpad's glide moves it.
 */
function glide(timeline: Locator, px: number): Promise<void> {
    return timeline.evaluate((el, { px, frames }) => new Promise<void>((resolve) => {
        let left = frames;
        const tick = () => {
            el.scrollLeft = el.scrollLeft + px;
            left -= 1;
            if (left > 0) requestAnimationFrame(tick);
            else resolve();
        };
        requestAnimationFrame(tick);
    }), { px, frames: FRAMES });
}

/** What a glide cost and spent: its frames, what its main thread spent them on, the page reads it made, and what the timeline had mounted. */
interface Glided {
    readonly cost: Cost;
    readonly spent: Spent & { readonly perFrame: Readonly<Record<string, number>> };
    readonly pageReads: number;
    readonly mounted: { readonly events: number; readonly rows: number };
}

test.describe("what gliding the Calendar's Timeline costs the main thread (#1398, CL9; E3_UI_PERF=1, not a CI gate)", () => {
    test.skip(!PERF, "E3_UI_PERF=1 only: a timing on a shared runner is no CI gate");

    test("the indexed Calendar's Timeline at Month, glided 50px a frame each way, inside the render budget @desktop", async ({ page }) => {
        test.setTimeout(300_000);
        await installE3Faults(page);
        await page.setViewportSize({ width: 2560, height: 1200 });
        const entry = await visitBuilder(page, ROUTE, ROOT, "light");
        await sizeBuilder(page, entry, ROOT, 1440);
        const frame = entry.locator(ROOT).first();
        const toolbar = frame.locator('[data-frame-slot="toolbar"]');
        await toolbar.getByRole("radio", { name: "Timeline", exact: true }).click();
        await settled(page);
        await toolbar.getByRole("radio", { name: "Month", exact: true }).click();
        await settled(page);
        const timeline = frame.locator("[data-calendar-timeline]").first();
        const pageReads = async (p: Page) => (await e3Requests(p)).filter((request) => request.kind === "page").length;
        const mounted = () => timeline.evaluate((el) => ({
            events: el.querySelectorAll("[data-calendar-event]").length, rows: el.querySelectorAll("[data-calendar-resource-row]").length,
        }));

        // Each way from where the Timeline opened, and back there after each glide.
        const results: Record<string, Glided> = {};
        for (const [name, px] of [["to the right", STEP_PX], ["to the left", -STEP_PX]] as const) {
            const reads = await pageReads(page);
            const cost = await costOf(page, () => glide(timeline, px));
            const read = (await pageReads(page)) - reads;
            const shown = await mounted();
            await settled(page);
            await glide(timeline, -px);
            await settled(page);
            // Again over the same days, traced: what a frame spent the main thread on.
            let frames = 0;
            const spent = await traceOf(page, async () => { frames = (await costOf(page, () => glide(timeline, px))).frames; });
            await settled(page);
            await glide(timeline, -px);
            await settled(page);
            const perFrame = Object.fromEntries(Object.entries(spent.phases).map(([phase, ms]) => [phase, Math.round((ms / Math.max(1, frames)) * 10) / 10]));
            results[`calendarRecordIndexes: the Timeline at Month, glided ${name}`] = { cost, spent: { ...spent, perFrame }, pageReads: read, mounted: shown };
        }

        console.log(`CL9 ${JSON.stringify(results, null, 2)}`);
        test.info().annotations.push({ type: "CL9", description: JSON.stringify(results) });
        // The render budget (CL9): a frame at the display's rate, none over 50 ms and no long animation frame.
        for (const [name, { cost }] of Object.entries(results)) {
            expect.soft({ median: cost.medianFrame <= FRAME_MS, over50: cost.over50, loaf: cost.loaf.count }, name).toEqual({ median: true, over50: 0, loaf: 0 });
        }
    });
});
