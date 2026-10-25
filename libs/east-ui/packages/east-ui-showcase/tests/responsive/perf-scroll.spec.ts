/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What scrolling and a page landing cost the main thread (#1398, CL9) —
 * `E3_UI_PERF=1`, never in CI: a timing on a shared runner is no deterministic
 * signal. On the built showcase and its in-page e3, each a scripted scroll, a
 * frame at a time, the browser drawing as fast as the page lets it (no frame
 * cap, no vsync), so a frame's length is the page's own work:
 *
 * - the stress Sheet's two thousand jobs (`sheetStress`, its All tab), down
 *   their rows at 1,500 px/s for 3 s, and again over the same rows. Every one
 *   of its rows is in already: the lens it opens on reads the record's one
 *   segment, and that read answers each window after it, so no window lands
 *   as it scrolls — the cost of scrolling resident rows;
 * - the indexed Sheet's fifty thousand work orders (`sheetRecordIndexes`, its
 *   All tab), from 30% down at 1,500 px/s for 3 s, the windows it reads ahead
 *   landing as it goes; flung at 12,000 px/s for 3 s, over windows not read,
 *   to rest where it stops and the windows there land; and one landing — its
 *   rows sent on with their reads held (the e3 fault hook), then let go: what
 *   the windows landing cost, from their bytes to their rows on screen;
 * - the Calendar's 12,000 events (`calendarRecordIndexes`) across its
 *   Timeline at 1,500 px/s for 3 s;
 * - the Roster's People over its 500 staff (`rosterRecordIndexes`, the rail's
 *   team cleared) down at 1,500 px/s for 3 s — and how far the view was
 *   pulled back against the scroll meanwhile.
 *
 * Each records what it cost the main thread (`main-thread-cost.ts`' `costOf`:
 * the frames, and the browser's long animation frames by what invoked their
 * scripts) and the page reads the page made meanwhile, and prints them as JSON.
 * Then it holds each to the render budget (CL9): no frame over 50 ms and no
 * long animation frame, scrolling loaded content and as windows land.
 *
 * Run (from the showcase, over its build):
 * `E3_UI_PERF=1 pnpm exec playwright test perf-scroll --project desktop --workers 1`.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { visitBuilder } from "./builder-page";
import { e3Requests, heldE3, holdE3, installE3Faults, releaseE3 } from "./e3-faults";
import { costOf, type Cost } from "./main-thread-cost";
import { recordField } from "./record-slice";
import { settled } from "./settle";

/** Whether the measurement runs: `E3_UI_PERF=1`, as the renderers' benchmarks are asked for. */
const PERF = process.env["E3_UI_PERF"] === "1";

/** The browser this suite runs, drawing as fast as the page lets it: a frame's length is the page's own work. */
const executablePath = process.env["PW_EXECUTABLE_PATH"] ?? process.env["E3_UI_CHROMIUM_PATH"];
test.use({ launchOptions: { ...(executablePath === undefined ? {} : { executablePath }), args: ["--no-sandbox", "--disable-frame-rate-limit", "--disable-gpu-vsync"] } });

/** A scripted scroll's speeds, px/s, and its length. */
const SPEED = 1_500;
const FLING = 12_000;
const SECONDS = 3;

/** A scripted scroll: how far it moved, and how far the view was pulled back against it meanwhile. */
interface Scrolled {
    readonly moved: number;
    readonly pulledBack: number;
    readonly pulls: number;
}

/**
 * A scroll of `target` at `speed` px/s for {@link SECONDS}, along `axis`, a frame at a time: how far it moved, and
 * how far — and how often — the view stood short of where the last frame put it.
 */
function scroll(target: Locator, axis: "x" | "y", speed: number): Promise<Scrolled> {
    return target.evaluate(async (el, { axis, speed, seconds }) => {
        const read = () => (axis === "y" ? el.scrollTop : el.scrollLeft);
        const max = () => (axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth);
        const from = read();
        const start = performance.now();
        let set: number | undefined;
        let pulledBack = 0;
        let pulls = 0;
        await new Promise<void>((resolve) => {
            const tick = (now: number) => {
                // Where the last frame put the view, and where it stands now: short of it, it was pulled back.
                if (set !== undefined) {
                    const at = read();
                    const meant = Math.min(set, max());
                    if (at < meant - 1) { pulledBack += meant - at; pulls += 1; }
                }
                const t = Math.min(seconds, (now - start) / 1000);
                set = from + speed * t;
                if (axis === "y") el.scrollTop = set; else el.scrollLeft = set;
                if (t < seconds) requestAnimationFrame(tick);
                else resolve();
            };
            requestAnimationFrame(tick);
        });
        return { moved: Math.round(Math.abs(read() - from)), pulledBack: Math.round(pulledBack), pulls };
    }, { axis, speed, seconds: SECONDS });
}

/** The rows' scroller in a builder's main. */
function rowsOf(entry: Locator): Locator {
    return entry.locator("[data-frame-slot='main'] [data-virtual-rows]").first();
}

/** A measured stretch: what it cost, the page reads it made, and what else the spec reads of it. */
type Measured = Cost & { readonly pageReads: number } & Record<string, unknown>;

/** What is over the render budget in a stretch (CL9): a frame over 50 ms, a long animation frame. */
function overBudget(at: Measured): string[] {
    const over: string[] = [];
    if (at.over50 > 0) over.push(`${at.over50} frames over 50 ms, the longest ${at.longestFrame} ms`);
    if (at.loaf.count > 0) over.push(`${at.loaf.count} long animation frames, ${at.loaf.total} ms, the longest ${at.loaf.longest} ms: ${at.loaf.longestScripts.map((s) => `${s.ms} ms ${s.invoker} ${s.source}`).join("; ")}`);
    return over;
}

test.describe("what scrolling and a landing cost the main thread (#1398, CL9; E3_UI_PERF=1, not a CI gate)", () => {
    test.skip(!PERF, "E3_UI_PERF=1 only: a timing on a shared runner is no CI gate");

    test("the stress Sheet, the indexed Sheet, the Calendar's Timeline and the Roster's People, scrolled, flung and landing, inside the render budget @desktop", async ({ page }) => {
        test.setTimeout(600_000);
        await installE3Faults(page);
        await page.setViewportSize({ width: 1440, height: 1000 });
        const results: Record<string, Measured> = {};
        const pageReads = async (p: Page) => (await e3Requests(p)).filter((request) => request.kind === "page").length;
        /** A stretch's cost, and the page reads made while it ran. */
        const measure = async (name: string, work: () => Promise<unknown>, extra: Record<string, unknown> = {}) => {
            const before = await pageReads(page);
            let out: unknown;
            const cost = await costOf(page, async () => { out = await work(); });
            results[name] = { ...extra, ...(typeof out === "object" && out !== null ? out as Record<string, unknown> : {}), pageReads: (await pageReads(page)) - before, ...cost };
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
            const flung = await scroll(indexedRows, "y", FLING);
            await expect(main).toHaveAttribute("aria-busy", "false");
            await settled(page);
            return flung;
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

        // The Roster's People, every one of its 500 staff: the rail's team cleared.
        const roster = await visitBuilder(page, "e3/roster/roster-records/rosterRecordIndexes", "[data-roster-frame]", undefined);
        const rosterFrame = roster.locator("[data-roster-frame]").first();
        const layout = rosterFrame.locator('[data-frame-slot="toolbar"]').getByRole("radio", { name: "People", exact: true });
        if (await layout.isVisible()) await layout.click();
        else {
            await rosterFrame.locator('[data-frame-slot="toolbar"]').getByRole("button", { name: "View", exact: true }).click();
            await page.getByRole("menuitem", { name: "People", exact: true }).click();
        }
        await settled(page);
        const team = await recordField(page, rosterFrame, "team", "people");
        await team.getByRole("button", { name: /^Clear / }).click();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await settled(page);
        const people = rosterFrame.locator("[data-roster-grid='people'] [data-virtual-rows]").first();
        const shown = await people.evaluate((el) => el.querySelectorAll("[data-roster-person-row]").length);
        await measure("rosterRecordIndexes: People down at 1,500 px/s", () => scroll(people, "y", SPEED), { mounted: shown });
        await settled(page);

        console.log(`CL9 ${JSON.stringify(results, null, 2)}`);
        test.info().annotations.push({ type: "CL9", description: JSON.stringify(results) });
        // The render budget (CL9): scrolling loaded content and windows landing, no frame over 50 ms and no long
        // animation frame; and the Roster's People never pulled back against the scroll.
        for (const [name, at] of Object.entries(results)) expect.soft(overBudget(at), name).toEqual([]);
        expect.soft(results["rosterRecordIndexes: People down at 1,500 px/s"]!["pulledBack"], "the People view pulled back against the scroll").toBe(0);
    });
});
