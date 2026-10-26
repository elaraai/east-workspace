/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Plan's keyboard over rows not read on a slow e3 (#1398, CL10): every
 * read of the rows answered 2.5 s after it is asked (the showcase's e3 fault
 * hook's slowing, `e3-faults.ts`), in a page zoomed to 137% — a fractional
 * device pixel ratio — the view sent far among rows not read and a click into
 * the run that stands for them there, so the run holds the keyboard:
 *
 * - As the run's rows land, the first of them in view takes the keyboard, and
 *   the view stays where it was in every frame — never moved by the rows
 *   landing, as the browser's own scroll anchoring moved it, anchored on the
 *   focused run.
 * - PageDown pressed on the run meanwhile waits for its rows, then goes a page
 *   on from the first of them in view: the view moves only then, and less than
 *   a page.
 * - The keyboard is never on the page's body.
 *
 * Each frame of the Plan is recorded in the page from the click until a row
 * holds the keyboard.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { visitBuilder } from "./builder-page";
import { RECORD_READS, installE3Faults, releaseE3, slowE3 } from "./e3-faults";
import { settled } from "./settle";

const ROUTE = "e3/plan/plan-records/planRecordIndexes";

/** A page zoomed to 137%: a fractional device pixel ratio. */
test.use({ deviceScaleFactor: 1.37 });

/** How long e3 takes to answer each read of the rows. */
const SLOW_MS = 2_500;

/** Where the page's recorder keeps what it saw. */
const RECORDER = "__planRunFocus";

/** One frame of the Plan, as the recorder reads it. */
interface Frame {
    /** The rows' scroll offset, and the view's height under the header. */
    readonly top: number;
    readonly view: number;
    /** Whether a run not read shows in the view, and how many rows read do. */
    readonly run: boolean;
    readonly rows: number;
    /** Where the keyboard is: the page's body, a run, the canvas's surface, a row — a group's band among them — or elsewhere. */
    readonly focus: "body" | "run" | "canvas" | "row" | "elsewhere";
    /** The focused row's place in the view: px from the view's top under the header to its top, whether it shows whole, and how many rows the view shows whole above it. */
    readonly at: number;
    readonly whole: boolean;
    readonly above: number;
}

/** The rows' scroller in the Plan's main. */
function scrollerOf(entry: Locator): Locator {
    return entry.locator("[data-frame-slot='main'] [data-virtual-rows]").first();
}

/** Starts recording each frame of the Plan in which anything it reads changes. */
async function record(entry: Locator): Promise<void> {
    await entry.evaluate((root, name) => {
        const scroller = root.querySelector<HTMLElement>("[data-frame-slot='main'] [data-virtual-rows]")!;
        const body = root.querySelector<HTMLElement>("[data-plan-body]")!;
        const frames: Frame[] = [];
        let last = "";
        let on = true;
        const read = (): Frame => {
            const box = scroller.getBoundingClientRect();
            const head = scroller.querySelector("[data-plan-header]")?.getBoundingClientRect().bottom ?? box.top;
            const bottom = box.top + scroller.clientHeight;
            const shows = (el: Element) => { const r = el.getBoundingClientRect(); return r.bottom > head + 1 && r.top < bottom - 1; };
            const active = document.activeElement;
            const focus: Frame["focus"] = active === null || active === document.body ? "body"
                : active === body ? "canvas"
                    : active.hasAttribute("data-plan-window-band") ? "run"
                        : active.getAttribute("data-plan-item")?.startsWith("r:") === true ? "row" : "elsewhere";
            const r = focus === "row" ? active!.getBoundingClientRect() : undefined;
            const whole = (el: Element) => { const b = el.getBoundingClientRect(); return b.top >= head - 1 && b.bottom <= bottom + 1; };
            return {
                top: scroller.scrollTop,
                view: bottom - head,
                run: [...scroller.querySelectorAll("[data-plan-window-band]")].some(shows),
                rows: [...scroller.querySelectorAll('[role="treegrid"] [data-plan-item^="r:"]')].filter(shows).length,
                focus,
                at: r === undefined ? 0 : r.top - head,
                whole: r !== undefined && r.top >= head - 1 && r.bottom <= bottom + 1,
                above: r === undefined ? 0 : [...scroller.querySelectorAll('[role="treegrid"] [data-plan-item^="r:"]')].filter((el) => whole(el) && el.getBoundingClientRect().top < r.top - 1).length,
            };
        };
        const tick = () => {
            if (!on) return;
            const frame = read();
            const said = JSON.stringify(frame);
            if (said !== last) { frames.push(frame); last = said; }
            requestAnimationFrame(tick);
        };
        tick();
        (window as unknown as Record<string, unknown>)[name] = { frames, stop: () => { on = false; } };
    }, RECORDER);
}

/** Stops the recorder: what it saw, frame by frame. */
function recorded(page: Page): Promise<Frame[]> {
    return page.evaluate((name) => {
        const recorder = (window as unknown as Record<string, { frames: Frame[]; stop: () => void }>)[name]!;
        recorder.stop();
        return recorder.frames;
    }, RECORDER);
}

/** The Plan's frames, in words. */
function told(frames: readonly Frame[]): string {
    return frames.map((f) => `top=${f.top.toFixed(1)} run=${f.run} rows=${f.rows} focus=${f.focus}${f.focus === "row" ? `@${f.at.toFixed(1)}${f.whole ? "" : " (cut)"} below ${f.above}` : ""}`).join("\n");
}

/** Waits for a row to hold the keyboard: on a timeout, every frame the recorder saw is the failure's message. */
async function rowFocused(page: Page): Promise<void> {
    try {
        await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-plan-item")?.startsWith("r:") === true), { timeout: 30_000 }).toBe(true);
    } catch (error) {
        throw new Error(`a row takes the keyboard\n${told(await recorded(page))}`, { cause: error });
    }
}

/** Sends the view to a part of the rows not read — `at` of the way down — clicks into the run that stands for them there, and records each frame from then on. */
async function clickRunAt(page: Page, entry: Locator, at: number): Promise<number> {
    const sent = await scrollerOf(entry).evaluate((el, part) => {
        el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * part);
        return el.scrollTop;
    }, at);
    const run = entry.locator("[data-plan-window-band]").first();
    await expect(run, "a run stands for the rows the view was sent among").toBeVisible();
    const box = await scrollerOf(entry).boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-plan-window-band") === true), "the click puts the keyboard on the run").toBe(true);
    // Every frame from here on: the run holding the keyboard, until a row takes it.
    await record(entry);
    return sent;
}

test("a run holding the keyboard on a slow e3 hands it to the first of its rows in view as they land — the view where it was, in every frame — and PageDown pressed on it goes a page on from there; never the page's body (#1398) @desktop", async ({ page }) => {
    await installE3Faults(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const entry = await visitBuilder(page, ROUTE, "[data-plan-frame]", "light");
    await settled(page);
    const slowing = await slowE3(page, { kinds: [...RECORD_READS] }, SLOW_MS);

    // Far down, the run clicked: its rows land, and the first of them in view takes the keyboard.
    const sent = await clickRunAt(page, entry, 0.6);
    await rowFocused(page);
    await settled(page, { holding: true });
    const landed = await recorded(page);
    expect(landed.filter((f) => f.focus === "body" || f.focus === "elsewhere"), told(landed)).toEqual([]);
    expect(landed.filter((f) => Math.abs(f.top - sent) >= 1), `the view stays where it was sent\n${told(landed)}`).toEqual([]);
    expect(landed.at(-1)!.rows, told(landed)).toBeGreaterThan(0);
    expect(landed.filter((f) => f.focus === "row" && (!f.whole || f.above > 0)), `the first row the view shows whole takes it\n${told(landed)}`).toEqual([]);

    // Up among rows not read again, the run clicked, and PageDown pressed on it while its rows are on their way.
    const again = await clickRunAt(page, entry, 0.3);
    await page.keyboard.press("PageDown");
    await rowFocused(page);
    await settled(page, { holding: true });
    const paged = await recorded(page);
    expect(paged.filter((f) => f.focus === "body" || f.focus === "elsewhere"), told(paged)).toEqual([]);
    // The view stays until a row has the keyboard: the rows landing move nothing.
    const first = paged.findIndex((f) => f.focus === "row");
    expect(paged.slice(0, first).filter((f) => Math.abs(f.top - again) >= 1), `the view stays while the rows land\n${told(paged)}`).toEqual([]);
    // A page on from the first row in view: the row the keyboard lands on is whole in the view, in its lower half, and the
    // view moved less than a page to show it.
    const end = paged.at(-1)!;
    expect(end.focus === "row" && end.whole && end.at >= end.view / 2, `a page on, in view\n${told(paged)}`).toBe(true);
    expect(Math.abs(end.top - again), told(paged)).toBeLessThan(end.view);
    await releaseE3(page, slowing);
});
