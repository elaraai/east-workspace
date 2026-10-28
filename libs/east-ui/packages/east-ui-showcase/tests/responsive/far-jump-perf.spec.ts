/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What a far jump costs the main thread as its rows land (#1398) —
 * `E3_UI_PERF=1`, never in CI: a timing on a shared runner is no deterministic
 * signal. On the built showcase and its in-page e3, at e3's own speed:
 *
 * - the Plan's paged work orders (`planRecordIndexes`, the Ready orders due in
 *   the first fortnight): End from a row a third of the way down, past rows not
 *   read, then Home, and the scrollbar dragged to the middle, past rows not
 *   read; and over the works' 2,000 presses, paged 200 to a window
 *   (`planWindows`, whose rows the key search seeks), a pick of Search Records
 *   from the first rows to the last press — each until the rows it goes to
 *   have landed, the keyboard on its row where it sends it;
 * - the Sheet's fifty thousand work orders under its lens (`sheetRecordIndexes`,
 *   the jobs ready, as it opens): ⌘End from a row a third of the way down, then
 *   ⌘Home, and the scrollbar dragged to the middle of the narrowing's rows —
 *   each until the stretch it goes to has landed, the ring on its row.
 *
 * Each records what it cost the main thread (`main-thread-cost.ts`' `costOf`:
 * the frames, and the browser's long animation frames by what invoked their
 * scripts and where their code is) and the page's reads of its e3 meanwhile,
 * and prints them as JSON; then holds each to the Schematic's budget: no frame
 * over 50 ms and no long animation frame.
 *
 * Run (from the showcase, over its build):
 * `E3_UI_PERF=1 pnpm exec playwright test far-jump-perf --project desktop --workers 1`.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { visitBuilder } from "./builder-page";
import { e3Requests, installE3Faults } from "./e3-faults";
import { costOf, type Cost } from "./main-thread-cost";
import { settled } from "./settle";

/** Whether the measurement runs: `E3_UI_PERF=1`, as the renderers' benchmarks are asked for. */
const PERF = process.env["E3_UI_PERF"] === "1";

/** What each stretch cost, by its name, as the run prints it. */
type Results = Record<string, unknown>;

/** The page's reads of its e3 since a mark, by kind. */
async function readsSince(page: Page, mark: number): Promise<Record<string, number>> {
    const kinds: Record<string, number> = {};
    for (const request of (await e3Requests(page)).slice(mark)) kinds[request.kind] = (kinds[request.kind] ?? 0) + 1;
    return kinds;
}

/** Measures a stretch of work: what it cost the main thread and the page's reads of its e3 meanwhile, kept by its name. */
async function measure(page: Page, results: Results, name: string, work: () => Promise<unknown>): Promise<Cost> {
    const mark = (await e3Requests(page)).length;
    const cost = await costOf(page, work);
    results[name] = { reads: await readsSince(page, mark), ...cost };
    return cost;
}

/** What is over the budget in a stretch: a frame over 50 ms, a long animation frame. */
function overBudget(cost: Cost): string[] {
    const over: string[] = [];
    if (cost.over50 > 0) over.push(`${cost.over50} frames over 50 ms, the longest ${cost.longestFrame} ms`);
    if (cost.loaf.count > 0) over.push(`${cost.loaf.count} long animation frames, the longest ${cost.loaf.longest} ms: ${cost.loaf.longestScripts.map((s) => `${s.ms} ms ${s.invoker} ${s.source}`).join("; ")}`);
    return over;
}

/** The rows' scroller in a builder's main. */
function scrollerOf(entry: Locator): Locator {
    return entry.locator("[data-frame-slot='main'] [data-virtual-rows]").first();
}

// ── The Plan ────────────────────────────────────────────────────────────────

/** Where the Plan's keyboard is and what its view shows: the row holding the keyboard (its place and label, and whether it shows whole), whether the view shows a run not read, and the footer's line. */
interface PlanAt {
    readonly focus: number;
    readonly label: string;
    readonly focusShown: boolean;
    readonly run: boolean;
    readonly readInView: boolean;
    readonly idle: boolean;
    readonly retained: boolean;
}

function planAt(entry: Locator): Promise<PlanAt> {
    return entry.evaluate((root) => {
        const scroller = root.querySelector<HTMLElement>("[data-frame-slot='main'] [data-virtual-rows]")!;
        const box = scroller.getBoundingClientRect();
        const head = scroller.querySelector("[data-plan-header]")?.getBoundingClientRect().bottom ?? box.top;
        const bottom = box.top + scroller.clientHeight;
        const shows = (el: Element) => { const r = el.getBoundingClientRect(); return r.bottom > head + 1 && r.top < bottom - 1; };
        const active = document.activeElement;
        const row = active !== null && active.getAttribute("data-plan-item")?.startsWith("r:") === true ? active : null;
        const at = row?.getBoundingClientRect();
        const line = root.querySelector<HTMLElement>("[data-frame-slot='footer'] [data-footer-line]");
        const body = root.querySelector<HTMLElement>("[data-plan-body]");
        return {
            focus: row === null ? 0 : Number(row.getAttribute("aria-rowindex")),
            label: row?.querySelector("[data-plan-gutter='label']")?.textContent ?? "",
            focusShown: at !== undefined && at.top >= head - 1 && at.bottom <= bottom + 1,
            run: [...scroller.querySelectorAll("[data-unloaded-run]")].some(shows),
            readInView: [...scroller.querySelectorAll('[role="treegrid"] [data-plan-item^="r:"]')].some(shows),
            idle: line?.hasAttribute("data-idle") ?? false,
            retained: body?.getAttribute("aria-disabled") === "true",
        };
    });
}

/** Whether the Plan draws the row labelled `label` whole in its view. */
function planShows(entry: Locator, label: string): Promise<boolean> {
    return entry.evaluate((root, label) => {
        const scroller = root.querySelector<HTMLElement>("[data-frame-slot='main'] [data-virtual-rows]")!;
        const box = scroller.getBoundingClientRect();
        const head = scroller.querySelector("[data-plan-header]")?.getBoundingClientRect().bottom ?? box.top;
        const bottom = box.top + scroller.clientHeight;
        return [...scroller.querySelectorAll('[role="treegrid"] [data-plan-item^="r:"]')].some((row) => {
            const r = row.getBoundingClientRect();
            return row.querySelector("[data-plan-gutter='label']")?.textContent === label && r.top >= head - 1 && r.bottom <= bottom + 1;
        });
    }, label);
}

/** Waits until the Plan's keyboard is on the row at `place`, whole in the view, nothing retained and the line idle. */
async function planLanded(entry: Locator, place: number, message: string): Promise<void> {
    await expect.poll(async () => {
        const at = await planAt(entry);
        return at.focus === place && at.focusShown && !at.retained && at.idle;
    }, { message, timeout: 60_000 }).toBe(true);
}

/** The middle of the gutter of the row read that the view's middle is on, if one is. */
function middleRow(entry: Locator): Promise<{ x: number; y: number } | null> {
    return scrollerOf(entry).evaluate((el) => {
        const box = el.getBoundingClientRect();
        const middle = box.top + el.clientHeight / 2;
        const row = [...el.querySelectorAll('[role="treegrid"] [data-plan-item^="r:"]')].find((r) => {
            const b = r.getBoundingClientRect();
            return b.top <= middle && b.bottom > middle;
        });
        const gutter = row?.querySelector<HTMLElement>("[role='rowheader']")?.getBoundingClientRect();
        return gutter === undefined ? null : { x: gutter.left + gutter.width / 2, y: gutter.top + gutter.height / 2 };
    });
}

/** Search Records' input: the box in the row, or — folded to its icon — the one its popover opens. */
async function searchInput(page: Page, frame: Locator): Promise<Locator> {
    const item = frame.locator("[data-frame-slot='toolbar'] [data-toolbar-item='seek']");
    const icon = item.locator("[data-key-search='icon']");
    if (await icon.isVisible()) {
        await icon.click();
        return page.locator("[data-key-search='popover'] input");
    }
    return item.locator("[data-part='dataset-key-search'] input");
}

// ── The Sheet ───────────────────────────────────────────────────────────────

/** Where the Sheet's ring is and what its view shows: the ring's row number and whether it shows whole, the view's top, whether it shows a run not read, and the footer's line. */
interface SheetAt {
    readonly ring: string;
    readonly ringShown: boolean;
    readonly top: number;
    readonly run: boolean;
    readonly readInView: boolean;
    readonly idle: boolean;
    readonly retained: boolean;
}

function sheetAt(entry: Locator): Promise<SheetAt> {
    return entry.evaluate((root) => {
        const scroller = root.querySelector<HTMLElement>("[data-frame-slot='main'] [data-virtual-rows]")!;
        const box = scroller.getBoundingClientRect();
        const head = scroller.querySelector('[data-slot="header"]')?.getBoundingClientRect().bottom ?? box.top;
        const bottom = box.top + scroller.clientHeight;
        const shows = (el: Element) => { const r = el.getBoundingClientRect(); return r.bottom > head + 1 && r.top < bottom - 1; };
        const card = root.querySelector("[data-sheet-card]");
        const ringCell = document.getElementById(card?.getAttribute("aria-activedescendant") ?? "");
        const ringRow = ringCell?.closest('[data-slot="row"]');
        const r = ringRow?.getBoundingClientRect();
        const line = root.querySelector<HTMLElement>("[data-frame-slot='footer'] [data-footer-line]");
        return {
            ring: ringRow?.querySelector('[data-slot="gutterNumber"]')?.textContent ?? "",
            ringShown: r !== undefined && r.top >= head - 1 && r.bottom <= bottom + 1,
            top: scroller.scrollTop,
            run: [...scroller.querySelectorAll("[data-unloaded-run]")].some(shows),
            readInView: [...scroller.querySelectorAll('[data-slot="row"][data-row-id]')].some(shows),
            idle: line?.hasAttribute("data-idle") ?? false,
            retained: card?.getAttribute("aria-disabled") === "true",
        };
    });
}

/** Waits until the Sheet's ring is on the row numbered `ring`, whole in the view, nothing retained and the line idle. */
async function sheetLanded(entry: Locator, ring: string, message: string): Promise<void> {
    await expect.poll(async () => {
        const at = await sheetAt(entry);
        return at.ring === ring && at.ringShown && !at.retained && at.idle;
    }, { message, timeout: 60_000 }).toBe(true);
}

test.describe("what a far jump costs the main thread as its rows land (#1398; E3_UI_PERF=1, not a CI gate)", () => {
    test.skip(!PERF, "E3_UI_PERF=1 only: a timing on a shared runner is no CI gate");

    test("the Plan's paged work orders — End, Home, a pick of Search Records and a far scrollbar drag — no frame over 50 ms and no long animation frame @desktop", async ({ page }) => {
        test.setTimeout(600_000);
        await installE3Faults(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        const entry = await visitBuilder(page, "e3/plan/plan-records/planRecordIndexes", "[data-plan-frame]", "light");
        const results: Results = {};
        const costs: Record<string, Cost> = {};

        // A third of the way down, read; the keyboard on the row the view's middle is on.
        await scrollerOf(entry).evaluate((el) => { el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 3); });
        await expect.poll(() => middleRow(entry), { message: "the rows a third of the way down are read" }).not.toBeNull();
        await settled(page);
        const at = (await middleRow(entry))!;
        await page.mouse.click(at.x, at.y);
        await settled(page);
        const count = Number(await entry.locator('[role="treegrid"]').first().getAttribute("aria-rowcount"));
        expect(count, "the source has counted its rows").toBeGreaterThan(1_000);

        costs["End"] = await measure(page, results, "Plan: End, from a third of the way down", async () => {
            await page.keyboard.press("End");
            await planLanded(entry, count, "the keyboard on the last row, in the view");
            await settled(page);
        });
        costs["Home"] = await measure(page, results, "Plan: Home, from the last row", async () => {
            await page.keyboard.press("Home");
            await planLanded(entry, 1, "the keyboard on the first row, in the view");
            await settled(page);
        });

        // The scrollbar dragged to the middle: far past the rows read.
        costs["drag"] = await measure(page, results, "Plan: the scrollbar dragged to the middle", async () => {
            await scrollerOf(entry).evaluate((el) => { el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2); });
            await expect.poll(async () => {
                const now = await planAt(entry);
                return now.readInView && !now.run && now.idle;
            }, { message: "the rows in view land", timeout: 60_000 }).toBe(true);
            await settled(page);
        });

        // Search Records over the works' 2,000 presses, paged 200 to a window (`planWindows`): from the first rows, a
        // pick of the last press — its row far past the rows read.
        const presses = await visitBuilder(page, "e3/plan/plan-windows/planWindows", "[data-plan-frame]", undefined);
        const input = await searchInput(page, presses.locator("[data-plan-frame]").first());
        await input.fill("P-3000");
        await expect(input.locator("xpath=ancestor::*[@data-part='dataset-key-search'][1]")).toContainText(/\b1 match\b/, { timeout: 30_000 });
        await settled(page);
        costs["pick"] = await measure(page, results, "Plan: a pick of Search Records, the last press from the first", async () => {
            await input.press("Enter");
            await expect.poll(async () => (await planShows(presses, "Press 3000")) && (await planAt(presses)).idle,
                { message: "the press picked, whole in the view", timeout: 60_000 }).toBe(true);
            await settled(page);
        });

        console.log(`Plan far jumps ${JSON.stringify(results, null, 2)}`);
        test.info().annotations.push({ type: "Plan far jumps", description: JSON.stringify(results) });
        for (const [name, cost] of Object.entries(costs)) expect.soft(overBudget(cost), name).toEqual([]);
    });

    test("the Sheet under its lens — ⌘End, ⌘Home and a far scrollbar drag — no frame over 50 ms and no long animation frame @desktop", async ({ page }) => {
        test.setTimeout(600_000);
        await installE3Faults(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        const entry = await visitBuilder(page, "e3/sheet/sheet-records/sheetRecordIndexes", "[data-builder-frame]", "light");
        await expect(entry.locator("[data-frame-slot='main'] [data-sheet][data-lens]")).toBeVisible({ timeout: 30_000 });
        await settled(page);
        const results: Results = {};
        const costs: Record<string, Cost> = {};

        // A third of the way down the narrowing's rows, read; the ring on a row in the middle of the view.
        await scrollerOf(entry).evaluate((el) => { el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 3); });
        await expect.poll(async () => { const now = await sheetAt(entry); return now.readInView && !now.run && now.idle; },
            { message: "the rows a third of the way down are read", timeout: 60_000 }).toBe(true);
        await settled(page);
        const cell = await scrollerOf(entry).evaluate((el) => {
            const box = el.getBoundingClientRect();
            const middle = box.top + el.clientHeight / 2;
            const row = [...el.querySelectorAll('[data-slot="row"][data-row-id]')].find((r) => {
                const b = r.getBoundingClientRect();
                return b.top <= middle && b.bottom > middle;
            })!;
            const c = row.querySelectorAll<HTMLElement>('[data-slot="cell"]')[1]!.getBoundingClientRect();
            return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
        });
        await page.mouse.click(cell.x, cell.y);
        await settled(page);
        expect((await sheetAt(entry)).ring, "the ring on the row pressed").toMatch(/^\d+$/);

        costs["End"] = await measure(page, results, "Sheet lens: ⌘End, from a third of the way down", async () => {
            await page.keyboard.press("Control+End");
            await sheetLanded(entry, "49999", "the ring on the narrowing's last row, in the view");
            await settled(page);
        });
        costs["Home"] = await measure(page, results, "Sheet lens: ⌘Home, from the last row", async () => {
            await page.keyboard.press("Control+Home");
            await sheetLanded(entry, "1", "the ring on the first row, in the view");
            await settled(page);
        });
        costs["drag"] = await measure(page, results, "Sheet lens: the scrollbar dragged to the middle", async () => {
            await scrollerOf(entry).evaluate((el) => { el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2); });
            await expect.poll(async () => {
                const now = await sheetAt(entry);
                return now.top > 0 && now.readInView && !now.run && now.idle;
            }, { message: "the rows in view land", timeout: 60_000 }).toBe(true);
            await settled(page);
        });

        console.log(`Sheet far jumps ${JSON.stringify(results, null, 2)}`);
        test.info().annotations.push({ type: "Sheet far jumps", description: JSON.stringify(results) });
        for (const [name, cost] of Object.entries(costs)) expect.soft(overBudget(cost), name).toEqual([]);
    });
});
