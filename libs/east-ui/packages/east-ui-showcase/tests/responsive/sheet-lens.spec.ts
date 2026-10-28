/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * The Sheet under a filter (#1349), a plain filtered spreadsheet, on the real
 * in-page e3: the indexed work orders (`sheetRecordIndexes`) open on the jobs
 * ready — every third of fifty thousand.
 *
 * - At 1440, 1024, 768, 390 and 360px, in both themes, in each pointer mode:
 *   only the rows the filter keeps, one after another, each flush with the
 *   one before — 1, 4, 7, their real row numbers, marked in the brand's ink at
 *   600 — no band between them and no context control on the toolbar; the
 *   count line, `16,667 matches`, in mono 10.5px in the subtle ink while the
 *   toolbar has room for it — on a 2160px window, beside the rail's every
 *   field — the row one 44px band with nothing past its edge, and the page no
 *   wider than the window.
 * - The scrollbar moved a long way with the reads of the segments there held
 *   (`e3-faults.ts`), then let go: as the rows land nothing moves — the scroll
 *   offset, the scroll height, the rows' extent and every row's top hold — and
 *   each row lands where its placeholder stood. At desktop and on a coarse
 *   pointer, whose rows are a touch's height.
 *
 * Measured in the page — never a screenshot.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { toolbarFaults } from "./builder-frame";
import { visitBuilder } from "./builder-page";
import { holdE3, installE3Faults, releaseE3 } from "./e3-faults";
import { settled } from "./settle";

const HASH = "e3/sheet/sheet-records/sheetRecordIndexes";

/** The widths the sheet is read at. */
const WIDTHS = [1440, 1024, 768, 390, 360] as const;

/** The first rows the filter keeps, by their ids: every third work order. */
const FIRST = ["JOB-10000", "JOB-10003", "JOB-10006"];

/** The first three rows the sheet draws, by their ids. */
const drawn = (entry: Locator) => entry.locator('[data-frame-slot="main"] [data-slot="row"][data-row-id]')
    .evaluateAll((rows) => rows.slice(0, 3).map((row) => row.getAttribute("data-row-id")));

/** Opens the indexed work orders in a theme, at rest, the filter's rows drawn. */
async function open(page: Page, theme: "light" | "dark"): Promise<Locator> {
    const entry = await visitBuilder(page, HASH, "[data-builder-frame]", theme);
    await expect(entry.locator("[data-builder-frame] [data-sheet-card]")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => drawn(entry), { timeout: 30_000 }).toEqual(FIRST);
    return entry;
}

/** The theme's tokens the rows are drawn in, as the page resolves them. */
function tokens(page: Page) {
    return page.evaluate(() => {
        const colour = (name: string) => {
            const probe = document.createElement("span");
            probe.style.color = `var(${name})`;
            document.body.appendChild(probe);
            const c = getComputedStyle(probe).color;
            probe.remove();
            return c;
        };
        return { brand: colour("--chakra-colors-brand-solid"), subtle: colour("--chakra-colors-fg-subtle") };
    });
}

/** What the sheet draws at the top of the record, and its toolbar's count, as the page lays them out. */
function readFiltered(entry: Locator) {
    return entry.evaluate((root) => {
        const main = root.querySelector('[data-frame-slot="main"]')!;
        const mono = (s: CSSStyleDeclaration) => /mono/i.test(s.fontFamily);
        const box = (el: Element) => el.getBoundingClientRect();
        /** To a tenth of a pixel, a negative zero made zero. */
        const tenth = (n: number) => Math.round(n * 10) / 10 + 0;
        const rows = [...main.querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]')].sort((a, b) => box(a).top - box(b).top).slice(0, 6);
        const numbers = rows.slice(0, 3).map((row) => {
            const number = row.querySelector('[data-slot="gutterNumber"]')!;
            const s = getComputedStyle(number);
            return { text: number.textContent, hit: number.hasAttribute("data-hit"), color: s.color, weight: s.fontWeight };
        });
        const count = root.querySelector<HTMLElement>('[data-frame-slot="toolbar"] [data-slot="toolbarCount"]');
        const cs = count === null || count.getBoundingClientRect().width === 0 ? null : getComputedStyle(count);
        return {
            lens: main.querySelector("[data-sheet]")?.hasAttribute("data-lens") ?? false,
            numbers,
            // How far each row sits below the one before it: flush is none.
            between: rows.slice(1).map((row, i) => tenth(box(row).top - box(rows[i]!).bottom)),
            // Any band drawn across the rows read: one would stand for rows the sheet leaves out.
            bands: [...main.querySelectorAll('[data-slot="band"]')].filter((band) => box(band).bottom > box(rows[0]!).top && box(band).top < box(rows[rows.length - 1]!).bottom).length,
            // A choice on the toolbar of the rows drawn beside the matches.
            context: root.querySelectorAll('[data-frame-slot="toolbar"] [role="radiogroup"]').length,
            count: cs === null ? null : { text: count!.textContent, mono: mono(cs), size: cs.fontSize, color: cs.color },
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
}

for (const theme of ["light", "dark"] as const) {
    test(`at every width the filter's rows stand one after another, each at its row number marked in the brand's ink, nothing between them, no context control, and the count line says the matches in its type (${theme})`, async ({ page }) => {
        // Wide, the row has room for the count line beside the rail's every field.
        await page.setViewportSize({ width: 2160, height: 900 });
        const entry = await open(page, theme);
        const frame = entry.locator("[data-builder-frame]").first();
        const T = await tokens(page);
        expect((await readFiltered(entry)).count, "2160px").toEqual({ text: "16,667 matches", mono: true, size: "10.5px", color: T.subtle });
        for (const width of WIDTHS) {
            await page.setViewportSize({ width, height: 900 });
            await settled(page);
            await expect.poll(() => drawn(entry), { message: `${width}px`, timeout: 30_000 }).toEqual(FIRST);
            const read = await readFiltered(entry);
            expect(read.lens, `${width}px: the sheet draws the filter's rows`).toBe(true);
            expect(read.numbers, `${width}px: each at its number, marked`).toEqual(["1", "4", "7"].map((text) => ({ text, hit: true, color: T.brand, weight: "600" })));
            expect(read.between, `${width}px: each row flush with the one before`).toEqual(read.between.map(() => 0));
            expect(read.bands, `${width}px: no band between the rows`).toBe(0);
            expect(read.context, `${width}px: no context control`).toBe(0);
            // The count line in its type while the toolbar has room for it; the row one band, nothing past its edge.
            if (read.count !== null) expect(read.count, `${width}px`).toEqual({ text: "16,667 matches", mono: true, size: "10.5px", color: T.subtle });
            expect(await toolbarFaults(frame), `${width}px`).toEqual([]);
            expect(read.overflow, `${width}px: the page no wider than the window`).toBeLessThanOrEqual(0);
        }
    });
}

/** The rows' scroller in the sheet's main. */
function scrollerOf(entry: Locator): Locator {
    return entry.locator("[data-frame-slot='main'] [data-virtual-rows]").first();
}

/** What the rows' scroller shows, every place px from its scroll top. */
interface RowsAt {
    readonly scrollTop: number;
    readonly scrollHeight: number;
    /** The rows' extent, as the virtual rows give it. */
    readonly extent: string | null;
    /** The view: its top under the pinned head, and its foot. */
    readonly view: { readonly top: number; readonly bottom: number };
    /** Each real row mounted, by its id: its top. */
    readonly rows: readonly (readonly [string, number])[];
    /** Each placeholder row of a run of rows not read: its top. */
    readonly placeholders: readonly number[];
    /** Whether a run of rows not read meets the view, its shapes shown. */
    readonly runInView: boolean;
}

/** Where the page keeps the reader {@link installRowsReader} gives it, and what {@link recordRows} samples. */
type RowsScope = { lensRead?: (el: Element) => RowsAt; lensFrames?: RowsAt[]; lensRecording?: boolean };

/**
 * Gives the page its reader of the rows' scroller, which {@link rowsAt} reads
 * with and {@link recordRows} samples every frame with.
 */
function installRowsReader(page: Page): Promise<void> {
    return page.evaluate(() => {
        (window as unknown as RowsScope).lensRead = (el: Element): RowsAt => {
            const box = el.getBoundingClientRect();
            const at = (y: number) => y - box.top + el.scrollTop;
            const head = el.querySelector('[data-slot="header"]');
            const view = { top: at(head === null ? box.top : Math.max(box.top, head.getBoundingClientRect().bottom)), bottom: at(box.top + el.clientHeight) };
            const rows = [...el.querySelectorAll('[data-slot="row"][data-row-id]')].map((row): [string, number] => [row.getAttribute("data-row-id")!, at(row.getBoundingClientRect().top)]);
            const runs = [...el.querySelectorAll("[data-unloaded-run]")];
            const placeholders = runs.flatMap((run) => [...run.querySelectorAll(":scope > [data-run-row]:not([data-run-band])")].map((row) => at(row.getBoundingClientRect().top)));
            const runInView = runs.some((run) => {
                const b = run.getBoundingClientRect();
                return at(b.bottom) > view.top + 1 && at(b.top) < view.bottom - 1 && run.hasAttribute("data-filled") && run.querySelector("[data-unrevealed]") === null;
            });
            const extent = el.querySelector("[data-virtual-extent]");
            return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, extent: extent === null ? null : extent.getAttribute("data-virtual-extent"), view, rows, placeholders, runInView };
        };
    });
}

/** The rows' scroller as the page lays it out now. */
function rowsAt(entry: Locator): Promise<RowsAt> {
    return scrollerOf(entry).evaluate((el) => (window as unknown as RowsScope).lensRead!(el));
}

/** Samples the rows' scroller at every frame the page draws until {@link stopRecording}: what each frame shows. */
function recordRows(entry: Locator): Promise<void> {
    return scrollerOf(entry).evaluate((el) => {
        const scope = window as unknown as RowsScope;
        scope.lensFrames = [];
        scope.lensRecording = true;
        const frame = () => {
            if (scope.lensRecording !== true) return;
            scope.lensFrames!.push(scope.lensRead!(el));
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    });
}

/** Stops the sampling {@link recordRows} began: every frame it read. */
function stopRecording(page: Page): Promise<RowsAt[]> {
    return page.evaluate(() => {
        const scope = window as unknown as RowsScope;
        scope.lensRecording = false;
        return scope.lensFrames ?? [];
    });
}

/** What moved, frame by frame, as the rows landed: the scroll, the extent or a row, in words. */
function movements(held: RowsAt, frames: readonly RowsAt[]): string[] {
    const moved: string[] = [];
    const tops = new Map<string, number>(held.rows);
    for (const [n, frame] of frames.entries()) {
        if (frame.scrollTop !== held.scrollTop) moved.push(`frame ${n}: the scroll offset ${frame.scrollTop}, held at ${held.scrollTop}`);
        if (frame.scrollHeight !== held.scrollHeight) moved.push(`frame ${n}: the scroll height ${frame.scrollHeight}, held at ${held.scrollHeight}`);
        if (frame.extent !== held.extent) moved.push(`frame ${n}: the extent ${frame.extent}, held at ${held.extent}`);
        for (const [id, top] of frame.rows) {
            const was = tops.get(id);
            if (was !== undefined && Math.abs(top - was) > 0.5) moved.push(`frame ${n}: ${id} at ${top}, before at ${was}`);
            tops.set(id, top);
        }
    }
    return moved;
}

test("moved a long way with the reads there held, then let go, the filter's rows land where their placeholders stood, and nothing moves as they do: the scroll, its height, the extent and every row's top", async ({ page }) => {
    await installE3Faults(page);
    const entry = await open(page, "light");
    await installRowsReader(page);
    const pitch = await scrollerOf(entry).evaluate((el) => el.querySelector('[data-slot="row"][data-row-id]')!.getBoundingClientRect().height);
    // The reads of the record's rows held: the segments' rows, and which of them the filter keeps.
    const hold = await holdE3(page, { kinds: ["page", "within"] });
    // The scrollbar moved a long way: to the middle of the filter's rows, far past what the sheet read as it opened.
    await scrollerOf(entry).evaluate((el) => { el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2); });
    await expect.poll(async () => (await rowsAt(entry)).runInView, { message: "the rows in view not read, their placeholders shown" }).toBe(true);
    await settled(page, { holding: true });
    const held = await rowsAt(entry);
    expect(held.runInView, "while held, the view shows placeholders").toBe(true);
    const inView = held.placeholders.filter((top) => top + pitch > held.view.top && top < held.view.bottom);
    expect(inView.length, "placeholders across the view").toBeGreaterThan(0);
    // Every frame the page draws from the release until the rows have landed and the sheet is at rest.
    await recordRows(entry);
    await releaseE3(page, hold);
    await settled(page);
    const frames = await stopRecording(page);
    const landed = await rowsAt(entry);
    expect(landed.runInView, "the rows in view landed").toBe(false);
    expect(movements(held, [...frames, landed]), "nothing moves as the rows land").toEqual([]);
    // Each row the view shows stands where a placeholder stood.
    const shown = landed.rows.filter(([, top]) => top + pitch > held.view.top && top < held.view.bottom);
    expect(shown.length, "rows across the view").toBeGreaterThanOrEqual(Math.floor((held.view.bottom - held.view.top) / pitch) - 1);
    const off = shown.filter(([, top]) => !inView.some((p) => Math.abs(p - top) <= 0.5)).map(([id, top]) => `${id} at ${top}`);
    expect(off, `each row where its placeholder stood (placeholders at ${inView.slice(0, 4).join(", ")}…)`).toEqual([]);
});
