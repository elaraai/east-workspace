/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Plan's far moves through its thousands of work orders on a slow e3
 * (#1398): every read of the rows answered a second after it is asked (the
 * showcase's e3 fault hook's slowing, `e3-faults.ts`), in a page zoomed to 110%
 * — a fractional device pixel ratio — as `sheet-far-moves.spec.ts` holds the
 * Sheet's:
 *
 * - The scrollbar dragged to the middle: the row at the view's top is the same
 *   row, by its place, from the drag until its window has landed, and once the
 *   placeholders' shapes show it stays where it is on screen, each row landing
 *   where its placeholder stood.
 * - End, from rows far from the last: the rows shown stay where they are,
 *   retained — the canvas `aria-disabled`, main `aria-busy` — the keyboard on
 *   the row it was on, in every frame until the last window has landed; then
 *   the last rows, the keyboard on the last of them, whole in the view. Home
 *   likewise to the first — whose window the rows' runtime may still hold from
 *   when the Plan opened (it keeps the windows read last), and then the first
 *   rows show in the frame after the key, nothing to wait for.
 *
 * Each frame of the Plan is recorded in the page from the move until it rests.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { visitBuilder } from "./builder-page";
import { RECORD_READS, installE3Faults, releaseE3, slowE3 } from "./e3-faults";
import { settled } from "./settle";

const ROUTE = "e3/plan/plan-records/planRecordIndexes";

/** A page zoomed to 110%: a fractional device pixel ratio. */
test.use({ deviceScaleFactor: 1.1 });

/** How long e3 takes to answer each read of the rows. */
const SLOW_MS = 1_000;

/** Where the page's recorder keeps what it saw. */
const RECORDER = "__planFarMoves";

/** One frame of the Plan, as the recorder reads it. */
interface Frame {
    /** The rows' scroll offset, and the furthest it can go. */
    readonly top: number;
    readonly max: number;
    /** The place, among all the rows, of the first row the view shows under its header, and whether that row is read or a placeholder. */
    readonly first: number;
    readonly read: boolean;
    /** Where that row starts, px below the header. */
    readonly offset: number;
    /** Whether the view shows a run's rows, and whether their shapes show. */
    readonly run: boolean;
    readonly revealed: boolean;
    /** The footer's line: idle, loading or failed, and its words. */
    readonly line: string;
    readonly words: string;
    /** The place of the row holding the keyboard, 0 while none does; and whether it shows whole in the view. */
    readonly focus: number;
    readonly focusShown: boolean;
    /** Where the keyboard is otherwise: on a row, the canvas's surface, the page's body, or elsewhere. */
    readonly on: "row" | "canvas" | "body" | "elsewhere";
    /** Whether the rows shown are retained: the canvas `aria-disabled`, its main `aria-busy`. */
    readonly retained: boolean;
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
        const main = root.querySelector<HTMLElement>("[data-frame-slot='main']")!;
        const frames: Frame[] = [];
        let last = "";
        let on = true;
        const read = (): Frame => {
            const box = scroller.getBoundingClientRect();
            const head = scroller.querySelector("[data-plan-header]")?.getBoundingClientRect().bottom ?? box.top;
            const bottom = box.top + scroller.clientHeight;
            const shows = (el: Element) => { const r = el.getBoundingClientRect(); return r.bottom > head + 1 && r.top < bottom - 1; };
            // A row read says its place itself; a placeholder of a run, the run's first row's place and how far into the run it is.
            const placeOf = (el: Element): number => {
                if (el.hasAttribute("data-run-row")) {
                    const run = el.closest("[data-plan-window-band]");
                    return Number(run?.getAttribute("aria-rowindex")) + Number(el.getAttribute("data-run-row"));
                }
                return Number(el.getAttribute("aria-rowindex"));
            };
            const rows = [...scroller.querySelectorAll('[role="treegrid"] [data-plan-item^="r:"], [data-plan-window-band] [data-run-row]')].filter(shows)
                .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            const first = rows[0];
            const runs = [...scroller.querySelectorAll<HTMLElement>("[data-unloaded-run]")].filter(shows);
            const line = root.querySelector<HTMLElement>("[data-frame-slot='footer'] [data-footer-line]");
            const active = document.activeElement;
            const row = active !== null && active.getAttribute("data-plan-item")?.startsWith("r:") === true ? active : null;
            const at = row?.getBoundingClientRect();
            return {
                top: scroller.scrollTop,
                max: scroller.scrollHeight - scroller.clientHeight,
                first: first === undefined ? 0 : placeOf(first),
                read: first?.hasAttribute("data-plan-item") ?? false,
                offset: first === undefined ? 0 : first.getBoundingClientRect().top - head,
                run: runs.length > 0,
                revealed: runs.some((run) => run.hasAttribute("data-filled") && run.querySelector("[data-unrevealed]") === null),
                line: line === null ? "" : line.hasAttribute("data-idle") ? "idle" : line.getAttribute("data-loading-line") ?? "",
                words: line?.querySelector("[data-line-text]")?.textContent ?? "",
                focus: row === null ? 0 : Number(row.getAttribute("aria-rowindex")),
                focusShown: at !== undefined && at.top >= head - 1 && at.bottom <= bottom + 1,
                on: row !== null ? "row" : active === body ? "canvas" : active === null || active === document.body ? "body" : "elsewhere",
                retained: body.getAttribute("aria-disabled") === "true" && main.getAttribute("aria-busy") === "true",
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

/** The Plan's frame now, as the recorder last read it. */
function latest(page: Page): Promise<Frame | null> {
    return page.evaluate((name) => (window as unknown as Record<string, { frames: Frame[] }>)[name]!.frames.at(-1) ?? null, RECORDER);
}

/** Frames, in words: the first row in view's place (`?` a placeholder) and where, the run (`+` its shapes shown), the line, the keyboard. */
function told(frames: readonly Frame[]): string {
    return frames.map((f) => `top=${f.top.toFixed(1)}/${f.max.toFixed(1)} first=${f.first}${f.read ? "" : "?"}@${f.offset.toFixed(1)} run=${f.run}${f.revealed ? "+" : ""} line=${f.line}${f.words === "" ? "" : ` "${f.words}"`} ${f.retained ? "retained " : ""}on=${f.on}${f.on === "row" ? ` ${f.focus}${f.focusShown ? "" : " (hidden)"}` : ""}`).join("\n");
}

/** Waits until the Plan's last frame says what `ready` asks: on a timeout, every frame the recorder saw is the failure's message. */
async function until(page: Page, ready: (frame: Frame) => boolean, message: string): Promise<void> {
    try {
        await expect.poll(async () => { const f = await latest(page); return f !== null && ready(f); }, { message, timeout: 30_000 }).toBe(true);
    } catch (error) {
        throw new Error(`${message}\n${told(await recorded(page))}`, { cause: error });
    }
}

/** The Plan of work orders, at rest, in a frame tall enough for a screenful of rows. */
async function openPlan(page: Page): Promise<Locator> {
    await installE3Faults(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const entry = await visitBuilder(page, ROUTE, "[data-plan-frame]", "light");
    await settled(page);
    return entry;
}

test("the scrollbar dragged far through rows not read on a slow e3: the row at the view's top stays that row as the windows land, each where its placeholder stood (#1398) @desktop", async ({ page }) => {
    const entry = await openPlan(page);
    const slowing = await slowE3(page, { kinds: [...RECORD_READS] }, SLOW_MS);
    await record(entry);
    // The scrollbar dragged to the middle: far past the rows read as the Plan opened.
    const sent = await scrollerOf(entry).evaluate((el) => {
        el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2);
        return el.scrollTop;
    });
    // The rows in view land, and the line goes idle — in a frame of the view where the drag left it, never the frame
    // before the drag, which the recorder may not have followed yet.
    await until(page, (f) => Math.abs(f.top - sent) < 2 && f.read && !f.run && f.line === "idle", "the rows in view land");
    await settled(page);
    const frames = await recorded(page);
    await releaseE3(page, slowing);
    const after = frames.slice(frames.findIndex((f) => Math.abs(f.top - sent) < 2));
    expect(after.length, told(frames)).toBeGreaterThan(0);
    // Placeholders stood in the view first: the row at its top stays that row in every frame, and once their shapes show
    // it stays where it is on screen as the rows land in their place.
    const held = after.find((f) => f.run && !f.read && f.first > 0);
    expect(held, `placeholders in the view before the rows land\n${told(after)}`).toBeDefined();
    expect(after.filter((f) => f.first > 0 && f.first !== held!.first), told(after)).toEqual([]);
    const shown = after.findIndex((f) => f.revealed);
    expect(shown, `the placeholders' shapes show before the rows land\n${told(after)}`).toBeGreaterThanOrEqual(0);
    expect(after.slice(shown).filter((f) => Math.abs(f.offset - after[shown]!.offset) >= 1), told(after)).toEqual([]);
    expect(after.at(-1)!.read, told(after)).toBe(true);
});

test("End and Home from rows far from either end on a slow e3: the rows shown stay where they are, retained, the keyboard on its row, in every frame until the far window lands; then the far rows, the keyboard on the last (or first) of them (#1398, CL10) @desktop", async ({ page }) => {
    const entry = await openPlan(page);
    // A third of the way down, read at e3's own speed; the keyboard on a row in the middle of the view, once it is read.
    await scrollerOf(entry).evaluate((el) => { el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 3); });
    /** The middle of the gutter of the row read that the view's middle is on, if one is. */
    const middleRow = () => scrollerOf(entry).evaluate((el) => {
        const box = el.getBoundingClientRect();
        const middle = box.top + el.clientHeight / 2;
        const row = [...el.querySelectorAll('[role="treegrid"] [data-plan-item^="r:"]')].find((r) => {
            const b = r.getBoundingClientRect();
            return b.top <= middle && b.bottom > middle;
        });
        const gutter = row?.querySelector<HTMLElement>("[role='rowheader']")?.getBoundingClientRect();
        return gutter === undefined ? null : { x: gutter.left + gutter.width / 2, y: gutter.top + gutter.height / 2 };
    });
    await expect.poll(middleRow, { message: "the rows a third of the way down are read" }).not.toBeNull();
    await settled(page);
    const at = (await middleRow())!;
    await page.mouse.click(at.x, at.y);
    await settled(page);
    const count = Number(await entry.locator('[role="treegrid"]').first().getAttribute("aria-rowcount"));
    expect(count, "the source has counted its rows").toBeGreaterThan(1_000);
    const slowing = await slowE3(page, { kinds: [...RECORD_READS] }, SLOW_MS);

    /**
     * Presses a key that goes to a far end, and holds every frame from it on: until a frame shows another first row,
     * the rows shown — the same first row, read, where it was — retained, and the keyboard on the row it was on; from it
     * on, the far rows, read, the keyboard on the row `landing` names, whole in the view. Where the far window is surely
     * not read (`unread`), the rows shown stand in for at least a frame.
     */
    const far = async (key: "End" | "Home", landing: number, unread: boolean) => {
        await record(entry);
        const before = (await latest(page))!;
        expect(before.on === "row" && before.read && !before.retained, `the keyboard on a row read\n${told([before])}`).toBe(true);
        await page.keyboard.press(key);
        await until(page, (f) => f.on === "row" && f.focus === landing && f.focusShown, `the keyboard on row ${landing}, in the view`);
        await settled(page);
        const frames = await recorded(page);
        const moved = frames.findIndex((f) => f.first !== before.first);
        expect(moved, `the far rows show\n${told(frames)}`).toBeGreaterThan(0);
        // Until the far window lands: the rows shown, where they were, the keyboard where it was — retained from the key on.
        expect(frames.slice(0, moved).filter((f) => !f.read || Math.abs(f.offset - before.offset) >= 1 || f.on !== "row" || f.focus !== before.focus), told(frames)).toEqual([]);
        expect(frames.slice(1, moved).filter((f) => !f.retained), `retained while they stand in\n${told(frames)}`).toEqual([]);
        if (unread) expect(frames.slice(1, moved).length, `the rows shown stand in while the far window is read\n${told(frames)}`).toBeGreaterThan(0);
        // Then the far rows, read, the keyboard on the row it went to, whole in the view, and nothing retained.
        expect(frames.slice(moved).filter((f) => !f.read || f.retained || f.on !== "row" || f.focus !== landing || !f.focusShown), told(frames)).toEqual([]);
    };
    // The last window: never read, so its read on the slow e3 is waited for.
    await far("End", count, true);
    // The first: read as the Plan opened, which the runtime may hold yet.
    await far("Home", 1, false);
    await releaseE3(page, slowing);
});
