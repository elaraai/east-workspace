/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Sheet's far moves through fifty thousand rows on a slow e3 (#1398): every
 * read of the rows answered a second after it is asked (the showcase's e3
 * fault hook's slowing, `e3-faults.ts`), in a page zoomed to 110% — a
 * fractional device pixel ratio, where a row measures a fraction of a pixel
 * off its estimate, as the frame draws it on the device's pixels, so every
 * window that lands is measured anew:
 *
 * - The scrollbar dragged to the middle: the row at the view's top is the same
 *   row, by its number, from the drag until its window has landed, and once the
 *   placeholders' shapes show it stays where it is on screen, each row landing
 *   where its placeholder stood; and the footer's line says what is read
 *   whenever the placeholders' shapes show.
 * - Ctrl+End: the last rows are read, then the view goes to them and the ring
 *   lands on the last row, and both stay there; Ctrl+Home likewise to the
 *   first. The keyboard stays in the grid throughout.
 *
 * Each frame of the Sheet is recorded in the page from the move until it rests.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { visitBuilder } from "./builder-page";
import { RECORD_READS, installE3Faults, releaseE3, slowE3 } from "./e3-faults";
import { settled } from "./settle";

const ROUTE = "e3/sheet/sheet-records/sheetRecordIndexes";

/** A page zoomed to 110%: a fractional device pixel ratio, where a row measures off its estimate. */
test.use({ deviceScaleFactor: 1.1 });

/** How long e3 takes to answer each read of the rows. */
const SLOW_MS = 1_000;

/** Where the page's recorder keeps what it saw. */
const RECORDER = "__sheetFarMoves";

/** One frame of the Sheet, as the recorder reads it. */
interface Frame {
    /** The rows' scroll offset, and the furthest it can go. */
    readonly top: number;
    readonly max: number;
    /** The number of the first row the view shows under its head, and whether that row is read or a placeholder. */
    readonly first: string;
    readonly read: boolean;
    /** Where that row starts, px below the head. */
    readonly offset: number;
    /** Whether the view shows a run's rows, and whether their shapes show. */
    readonly run: boolean;
    readonly revealed: boolean;
    /** The footer's line: idle, loading or failed, and its words. */
    readonly line: string;
    readonly words: string;
    /** Where the keyboard is: in the grid, on the page's body, or elsewhere. */
    readonly focus: "grid" | "body" | "elsewhere";
    /** The number of the ring's row, or "" while the ring is on no drawn cell; and whether that row shows whole in the view. */
    readonly ring: string;
    readonly ringShown: boolean;
}

/**
 * Whether the view is at the rows' end: at a fractional device pixel ratio the
 * furthest the scroll goes is a fraction of a pixel short of what the frame's
 * whole-pixel scroll height and client height say.
 */
const atEnd = (frame: Frame): boolean => frame.max - frame.top < 2;

/** The rows' scroller in the Sheet's main. */
function scrollerOf(entry: Locator): Locator {
    return entry.locator("[data-frame-slot='main'] [data-virtual-rows]").first();
}

/** Starts recording each frame of the Sheet in which anything it reads changes. */
async function record(entry: Locator): Promise<void> {
    await entry.evaluate((root, name) => {
        const scroller = root.querySelector<HTMLElement>("[data-frame-slot='main'] [data-virtual-rows]")!;
        const frames: Frame[] = [];
        let last = "";
        let on = true;
        const read = (): Frame => {
            const box = scroller.getBoundingClientRect();
            const head = scroller.querySelector('[data-slot="header"]')?.getBoundingClientRect().bottom ?? box.top;
            const shows = (el: Element) => { const r = el.getBoundingClientRect(); return r.bottom > head + 1 && r.top < box.top + scroller.clientHeight - 1; };
            const rows = [...scroller.querySelectorAll('[data-slot="row"][data-row-id], [data-run-row]:not([data-run-band])')].filter(shows)
                .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            const first = rows[0];
            const runs = [...scroller.querySelectorAll<HTMLElement>("[data-unloaded-run]")].filter(shows);
            const line = root.querySelector<HTMLElement>("[data-frame-slot='footer'] [data-footer-line]");
            const card = root.querySelector("[data-sheet-card]");
            const active = document.activeElement;
            const ringCell = document.getElementById(card?.getAttribute("aria-activedescendant") ?? "");
            const ringRow = ringCell?.closest('[data-slot="row"]')?.getBoundingClientRect();
            return {
                top: scroller.scrollTop,
                max: scroller.scrollHeight - scroller.clientHeight,
                first: first === undefined ? "" : (first.querySelector('[data-slot="gutterNumber"], [data-shape="rowNumber"]')?.textContent ?? ""),
                read: first?.matches('[data-slot="row"]') ?? false,
                offset: first === undefined ? 0 : first.getBoundingClientRect().top - head,
                run: runs.length > 0,
                revealed: runs.some((run) => run.hasAttribute("data-filled") && run.querySelector("[data-unrevealed]") === null),
                line: line === null ? "" : line.hasAttribute("data-idle") ? "idle" : line.getAttribute("data-loading-line") ?? "",
                words: line?.querySelector("[data-line-text]")?.textContent ?? "",
                focus: active === null || active === document.body ? "body" : card?.contains(active) === true ? "grid" : "elsewhere",
                ring: ringCell?.closest('[data-slot="row"]')?.querySelector('[data-slot="gutterNumber"]')?.textContent ?? "",
                ringShown: ringRow !== undefined && ringRow.top >= head - 1 && ringRow.bottom <= box.top + scroller.clientHeight + 1,
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

/** The Sheet's frame now, in words, as the recorder last read it. */
function now(page: Page): Promise<string> {
    return page.evaluate((name) => JSON.stringify((window as unknown as Record<string, { frames: Frame[] }>)[name]!.frames.at(-1) ?? null), RECORDER)
        .then((said) => {
            const frame = JSON.parse(said) as Frame | null;
            return frame === null ? "" : told([frame]);
        });
}

/**
 * Waits until the Sheet's last frame, in words, matches: on a timeout, every frame the recorder saw is the failure's
 * message.
 */
async function until(page: Page, pattern: RegExp, message: string): Promise<void> {
    try {
        await expect.poll(() => now(page), { message, timeout: 30_000 }).toMatch(pattern);
    } catch (error) {
        throw new Error(`${message}\n${told(await recorded(page))}`, { cause: error });
    }
}

/** The Sheet's All tab, its fifty thousand rows unnarrowed, at rest. */
async function openAll(page: Page): Promise<Locator> {
    await installE3Faults(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const entry = await visitBuilder(page, ROUTE, "[data-builder-frame]", "light");
    await entry.locator('[data-slot="tab"][data-tab="all"]').click();
    await settled(page);
    return entry;
}

/** Frames, in words: the first row in view's number (`?` a placeholder) and place, the run (`+` its shapes shown), the line, the keyboard, the ring. */
function told(frames: readonly Frame[]): string {
    return frames.map((f) => `top=${f.top.toFixed(1)}/${f.max.toFixed(1)}${atEnd(f) ? " end" : ""} first=${f.first}${f.read ? "" : "?"}@${f.offset.toFixed(1)} run=${f.run}${f.revealed ? "+" : ""} line=${f.line} focus=${f.focus} ring=${f.ring}${f.ringShown ? "" : " (hidden)"}`).join("\n");
}

test("the scrollbar dragged far through rows not read on a slow e3: the row at the view's top stays where it was as the windows land, each row where its placeholder stood, and the line says what is read whenever the placeholders show (#1398) @desktop", async ({ page }) => {
    const entry = await openAll(page);
    const slowing = await slowE3(page, { kinds: [...RECORD_READS] }, SLOW_MS);
    await record(entry);
    // The scrollbar dragged to the middle: far past the rows read as the Sheet opened.
    const sent = await scrollerOf(entry).evaluate((el) => {
        el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2);
        return el.scrollTop;
    });
    // The rows in view land, and the line goes idle.
    await until(page, /first=\d+@.* run=false line=idle /, "the rows in view land");
    await settled(page);
    const frames = await recorded(page);
    await releaseE3(page, slowing);
    const after = frames.slice(frames.findIndex((f) => Math.abs(f.top - sent) < 2));
    expect(after.length, told(frames)).toBeGreaterThan(0);
    // Placeholders stood in the view first: the row at its top stays that row in every frame, and once their shapes show
    // it stays where it is on screen as the rows land in their place.
    const held = after.find((f) => f.run && !f.read && f.first !== "");
    expect(held, `placeholders in the view before the rows land\n${told(after)}`).toBeDefined();
    expect(after.filter((f) => f.first !== "" && f.first !== held!.first), told(after)).toEqual([]);
    const shown = after.findIndex((f) => f.revealed);
    expect(shown, `the placeholders' shapes show before the rows land\n${told(after)}`).toBeGreaterThanOrEqual(0);
    expect(after.slice(shown).filter((f) => Math.abs(f.offset - after[shown]!.offset) >= 1), told(after)).toEqual([]);
    expect(after.at(-1)!.read, told(after)).toBe(true);
    // Whenever the placeholders' shapes show, the line says what is read.
    expect(after.filter((f) => f.revealed && f.line !== "loading"), told(after)).toEqual([]);
    expect(after.some((f) => f.revealed && /^Loading /.test(f.words)), `the line names what is read\n${told(after)}`).toBe(true);
});

test("Ctrl+End and Ctrl+Home on a slow e3: the last rows are read, then the view goes to them and the ring lands on the last row, and they stay; Ctrl+Home the same to the first; the keyboard never leaves the grid (#1398) @desktop", async ({ page }) => {
    const entry = await openAll(page);
    // A few thousand rows down, read at e3's own speed; the ring on a row in the middle of the view.
    await scrollerOf(entry).evaluate((el) => { el.scrollTop = 6_000 * 36; });
    await settled(page);
    const at = await scrollerOf(entry).evaluate((el) => {
        const box = el.getBoundingClientRect();
        const middle = box.top + el.clientHeight / 2;
        const row = [...el.querySelectorAll('[data-slot="row"][data-row-id]')].find((r) => {
            const b = r.getBoundingClientRect();
            return b.top <= middle && b.bottom > middle;
        })!;
        const cell = row.querySelectorAll<HTMLElement>('[data-slot="cell"]')[1]!.getBoundingClientRect();
        return { x: cell.left + cell.width / 2, y: cell.top + cell.height / 2 };
    });
    await page.mouse.click(at.x, at.y);
    await settled(page);
    const slowing = await slowE3(page, { kinds: [...RECORD_READS] }, SLOW_MS);
    await record(entry);
    expect(await now(page), "the keyboard in the grid, the ring on the row pressed").toMatch(/focus=grid ring=\d+$/);

    await page.keyboard.press("Control+End");
    await until(page, / focus=grid ring=50000$/, "the ring on the last row, in the view");
    await settled(page);
    const toEnd = await recorded(page);
    // The view goes to the last row with the ring on it, and from then on the last row stays whole in the view under the
    // ring — whatever lands meanwhile; the keyboard is in the grid in every frame.
    const arrived = toEnd.findIndex((f) => f.ring === "50000" && f.ringShown);
    expect(arrived, `the ring on the last row, in the view\n${told(toEnd)}`).toBeGreaterThanOrEqual(0);
    expect(toEnd.slice(arrived).filter((f) => f.ring !== "50000" || !f.ringShown), told(toEnd)).toEqual([]);
    expect(toEnd.filter((f) => f.focus !== "grid"), told(toEnd)).toEqual([]);

    await record(entry);
    await page.keyboard.press("Control+Home");
    await until(page, /^top=0\.0\/.* focus=grid ring=1$/, "the ring on the first row, the view at the top");
    await settled(page);
    const toTop = await recorded(page);
    // Likewise to the top: from the frame it arrives in, the view stays there, the ring on the first row.
    const home = toTop.findIndex((f) => f.top < 1 && f.ring === "1");
    expect(home, `the view at the top, the ring on the first row\n${told(toTop)}`).toBeGreaterThanOrEqual(0);
    expect(toTop.slice(home).filter((f) => f.top >= 1 || f.ring !== "1" || !f.ringShown), told(toTop)).toEqual([]);
    expect(toTop.filter((f) => f.focus !== "grid"), told(toTop)).toEqual([]);
    await releaseE3(page, slowing);
});
