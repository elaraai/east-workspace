/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Plan over paged rows whose nested series it reads a cell at a time
 * (`planNestedAll`, #1438, #1439), measured in a real browser on the e3 the
 * page runs, in both themes, at 1440 and on a phone (390):
 *
 * - the area starts within the showcase's start budget, unchanged, and the
 *   run says how long it took (#1439: the start measured where the suite runs);
 * - a scroll, a pan and a zoom move nothing as their cells land: every row in
 *   view — on a phone, every card — keeps its place and its height, and the
 *   scroll stays where it was put; while the cells are in flight the rows
 *   waiting on them are washed and busy, on the reveal clock, and no other;
 * - past the cap, the rows shading the works' jobs are the height of the rows
 *   they stand in for, hatched at a week, which no summary divides, and
 *   shaded from their totals at a month;
 * - a works draws its crews' hours as e3 keeps their sums, folded as opened:
 *   each week its crews' hours added up, in their columns, at the height its
 *   crews' rows draw at;
 * - a crew's week typed: the input over its cell at the cell's width and the
 *   row's height, its text in the table's numerals — on a phone, a popover
 *   anchored to the cell, inside the frame — and its works' sum moving by it.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-nested`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { East, PatchType, SortedMap, StringType, compareFor, diffFor, encodeBeast2For, variant } from "@elaraai/east";
import { SCHEDULE_EVENT_CAP } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-nested";
import { heldE3, holdE3, installE3Faults, mutateE3, releaseE3 } from "./e3-faults";
import { drawnSel, openExample } from "./plan-page";
import { settled } from "./settle";

/** The nested series examples file, in the catalog. */
const NESTED = "e3/plan/plan-nested";
/** The example: every series a Plan reads a cell at a time, over two hundred works. */
const ALL = "planNestedAll";
/** The workspace of the Plan's area in the page's e3: the area's own name. */
const WORKSPACE = "plan";
/** The works' record, as the page's requests of its e3 name it. */
const WORKS_RECORD = `records.${ex.planWorks.name}`;
/** How long the area may take to start: the showcase's start budget (`settle.ts`), never raised for it (#1439). */
const START_BUDGET_MS = 45_000;

/** The series the example shows to start, by title. */
const SHOWN = ["Jobs", "Load", "Crew hours", "Parts"] as const;

/** The first works, and its two crews. */
const WORKS = "W-10001";
const CREWS = ["C-10001-1", "C-10001-2"] as const;

/** The canvas's scroller at 1440 — its bounded rows — and on a phone, the list of cards. */
const SCROLLER = "[data-frame-slot='main'] [data-virtual-rows='bounded']";
const LIST = "[data-slot='narrowList']";

/** Whether the Plan draws narrow here: on a phone, its list of cards. */
const narrowOf = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 480;

/** A cell's number, `undefined` where it draws none. */
async function numberIn(cell: Locator): Promise<number | undefined> {
    const text = ((await cell.textContent()) ?? "").replace(/[^\d.-]/g, "");
    return text === "" ? undefined : Number(text);
}

/**
 * Every cell of a row or card in sight, by its bucket: its text, its left edge and its width. A row draws a value's
 * cell in the bucket past the window's end too, out of sight past its plot's edge.
 */
async function cellsOf(row: Locator): Promise<Map<string, { readonly text: string; readonly left: number; readonly width: number }>> {
    const cells = await row.locator("[data-cell]").evaluateAll((els) => els.flatMap((el) => {
        const plot = el.closest("[data-plan-plot], [data-plan-cardbody]")!.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        if (box.left >= plot.right - 0.5 || box.right <= plot.left + 0.5) return [];
        return [[el.getAttribute("data-cell") ?? "", el.textContent ?? "", Math.round(box.left * 10) / 10, Math.round(box.width * 10) / 10] as const];
    }));
    return new Map(cells.map(([at, text, left, width]) => [at, { text, left, width }]));
}

/** Every cell of a row or card in sight that draws a number, by its bucket. */
async function numbersOf(row: Locator): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const [at, { text }] of await cellsOf(row)) {
        const digits = text.replace(/[^\d.-]/g, "");
        if (digits !== "") out.set(at, Number(digits));
    }
    return out;
}

/**
 * Leaves the series named on, and switches every other one the example shows off, from the library's Series tab — on a
 * phone, the library's rail opened for it and closed after.
 */
async function onlySeries(page: Page, entry: Locator, keep: readonly string[]): Promise<void> {
    const narrow = narrowOf(page);
    if (narrow) await entry.getByRole("button", { name: "Expand Library" }).click();
    const pane = entry.locator('[data-frame-slot="start"]');
    for (const title of SHOWN.filter((t) => !keep.includes(t))) {
        await pane.getByRole("button", { name: `Toggle ${title}`, exact: true }).click();
    }
    if (narrow) await entry.getByRole("button", { name: "Collapse Library" }).click();
    await settled(page);
}

/** Where a row or card in view is: its top in its scroller, and its height. */
interface Place {
    readonly top: number;
    readonly height: number;
}

/** One frame as the eye sees it: the scroll, and each row in view (each card, on a phone) by its id. */
interface Frame {
    readonly scroll: number;
    readonly rows: Record<string, Place>;
}

/** The rows in view now (the cards, on a phone), by id: each one's place in its scroller. */
async function inView(entry: Locator, narrow: boolean): Promise<Frame> {
    return entry.evaluate((root, { scrollerSel, attr }) => {
        const scroller = root.querySelector<HTMLElement>(scrollerSel)!;
        const view = scroller.getBoundingClientRect();
        const rows: Record<string, Place> = {};
        for (const row of scroller.querySelectorAll(`[${attr}]`)) {
            const box = row.getBoundingClientRect();
            if (box.bottom <= view.top || box.top >= view.bottom) continue;
            rows[row.getAttribute(attr)!] = { top: Math.round((box.top - view.top) * 10) / 10, height: Math.round(box.height * 10) / 10 };
        }
        return { scroll: scroller.scrollTop, rows };
    }, { scrollerSel: narrow ? LIST : SCROLLER, attr: narrow ? "data-plan-card" : "data-plan-row" });
}

/** Starts reading the rows in view every frame, as {@link inView} reads them, until {@link framesOf} stops it. */
async function watch(entry: Locator, narrow: boolean): Promise<void> {
    await entry.evaluate((root, { scrollerSel, attr }) => {
        const w = window as unknown as { __nestedFrames: Frame[]; __nestedWatching: boolean };
        w.__nestedFrames = [];
        w.__nestedWatching = true;
        const scroller = root.querySelector<HTMLElement>(scrollerSel)!;
        const read = () => {
            const view = scroller.getBoundingClientRect();
            const rows: Record<string, Place> = {};
            for (const row of scroller.querySelectorAll(`[${attr}]`)) {
                const box = row.getBoundingClientRect();
                if (box.bottom <= view.top || box.top >= view.bottom) continue;
                rows[row.getAttribute(attr)!] = { top: Math.round((box.top - view.top) * 10) / 10, height: Math.round(box.height * 10) / 10 };
            }
            w.__nestedFrames.push({ scroll: scroller.scrollTop, rows });
            if (w.__nestedWatching) requestAnimationFrame(read);
        };
        read();
    }, { scrollerSel: narrow ? LIST : SCROLLER, attr: narrow ? "data-plan-card" : "data-plan-row" });
}

/** Stops reading the rows in view, and returns every frame read. */
async function framesOf(page: Page): Promise<Frame[]> {
    return page.evaluate(() => {
        const w = window as unknown as { __nestedFrames: Frame[]; __nestedWatching: boolean };
        w.__nestedWatching = false;
        return w.__nestedFrames;
    });
}

/** Two places the eye cannot tell apart: within half a pixel. */
const same = (a: number, b: number): boolean => Math.abs(a - b) <= 0.5;

/** What moved across the frames, each a line saying what: the scroll, and a row in view that moved, changed its height or left the view. */
function movedIn(frames: readonly Frame[]): string[] {
    const bad: string[] = [];
    const first = frames[0]!;
    for (let i = 1; i < frames.length; i++) {
        const before = frames[i - 1]!;
        const now = frames[i]!;
        if (now.scroll !== first.scroll) bad.push(`frame ${i}: the scroll moved from ${first.scroll} to ${now.scroll}`);
        for (const [row, was] of Object.entries(before.rows)) {
            const at = now.rows[row];
            if (at === undefined) bad.push(`frame ${i}: ${row} left the view`);
            else if (!same(at.top, was.top) || !same(at.height, was.height)) bad.push(`frame ${i}: ${row} went from ${was.top}+${was.height} to ${at.top}+${at.height}`);
        }
    }
    return bad;
}

/** What a gesture does, at 1440 and on a phone: a scroll to rows not read, a pan of a week, a zoom to a month. */
const GESTURES = {
    // At 1440 the canvas scrolled to its 76th row; on a phone, the list's next cards shown.
    scroll: async (_page: Page, entry: Locator, narrow: boolean) => {
        if (narrow) await entry.locator("[data-plan-more='rows']").click();
        else await entry.locator(SCROLLER).evaluate((el) => { el.scrollTop = 75 * 32; });
    },
    // A week on: at 1440 the canvas's `]` on a row, whichever form the toolbar's navigation is in; on a phone, the View
    // popover's Next week.
    pan: async (page: Page, entry: Locator, narrow: boolean) => {
        if (narrow) {
            await entry.getByRole("button", { name: "View" }).click();
            await page.getByRole("button", { name: "Next week", exact: true }).click();
            await page.keyboard.press("Escape");
        } else {
            await entry.locator("[data-plan-row]").first().focus();
            await page.keyboard.press("]");
        }
    },
    // To a month: the toolbar's resolution, at 1440; on a phone, the View popover's.
    zoom: async (page: Page, entry: Locator, narrow: boolean) => {
        if (narrow) await entry.getByRole("button", { name: "View" }).click();
        await (narrow ? page : entry.locator("[data-frame-slot='toolbar']")).getByRole("radio", { name: /^month$/i }).click();
        if (narrow) await page.keyboard.press("Escape");
    },
} as const;

/**
 * Crowds the first works past the cap, as another session would: its jobs as generated, and one more than the cap of
 * hour-long jobs in the week of 5 October 2026, in view — patched in through the works' patch door.
 */
async function crowd(page: Page): Promise<void> {
    const type = ex.planWorks.type;
    const works = East.compile(ex.generateWorks, [])(0n, 522n);
    const jobs = new SortedMap(works.jobs, compareFor(StringType));
    const monday = Date.UTC(2026, 9, 5, 6);
    for (let i = 0; i <= SCHEDULE_EVENT_CAP; i++) {
        const start = new Date(monday + (i % 100) * 3_600_000);
        jobs.set(`J-${i}`, { product: "cap", start, end: new Date(start.getTime() + 3_600_000), state: variant("confirmed", null) });
    }
    const keyed = (value: typeof works) => new SortedMap([[WORKS, value]], compareFor(StringType));
    await mutateE3(page, WORKSPACE, ex.planWorks.name, "patch",
        [encodeBeast2For(PatchType(type))(diffFor(type)(keyed(works), keyed({ ...works, jobs })))]);
}

for (const theme of ["light", "dark"] as const) {
    test.describe(`${theme}: a Plan reading its rows' nested series a cell at a time (#1438)`, () => {
        test.use({ viewport: { width: 1440, height: 900 } });
        defineChecks(theme, "@desktop");
    });
    test.describe(`${theme}: on a phone, a Plan reading its rows' nested series a cell at a time (#1438)`, () => {
        defineChecks(theme, "@mobile");
    });
}

/** The checks, in a theme, at the width the tag runs them at: 1440, or a phone's 390. */
function defineChecks(theme: "light" | "dark", tag: "@desktop" | "@mobile"): void {
    test("the area starts within the showcase's start budget; a works draws its crews' sums as e3 keeps them, folded as opened, in their columns at their rows' height; and a crew's week typed moves it", { tag }, async ({ page }) => {
        const began = Date.now();
        const entry = await openExample(page, ALL, NESTED, theme);
        const took = Date.now() - began;
        test.info().annotations.push({ type: "start", description: `planNestedAll started in ${took} ms` });
        console.log(`planNestedAll started in ${took} ms (${theme}, ${page.viewportSize()?.width}px)`);
        expect(took).toBeLessThan(START_BUDGET_MS);
        const narrow = narrowOf(page);
        await onlySeries(page, entry, ["Crew hours"]);
        const works = entry.locator(drawnSel("crews", WORKS));
        const crews = CREWS.map((crew) => entry.locator(drawnSel("crew", WORKS, crew)));
        const folded = await numbersOf(works);
        expect(folded.size).toBeGreaterThan(0);
        if (!narrow) {
            // Folded at 1440, its crews not drawn; opened by its header, it draws what it drew folded.
            await expect(works).toHaveAttribute("aria-expanded", "false");
            await expect(crews[0]).toHaveCount(0);
            await works.locator('[role="rowheader"]').first().click();
            await settled(page);
            await expect(works).toHaveAttribute("aria-expanded", "true");
            expect(await numbersOf(works)).toEqual(folded);
        }
        // Each week, its crews' hours added up.
        const sums = new Map<string, number>();
        for (const crew of crews) {
            for (const [at, hours] of await numbersOf(crew)) sums.set(at, (sums.get(at) ?? 0) + hours);
        }
        expect(sums).toEqual(folded);
        // In its crews' columns, at the height their rows draw at.
        const columns = await cellsOf(works);
        for (const crew of crews) {
            const theirs = await cellsOf(crew);
            for (const [at, { left, width }] of columns) {
                const column = theirs.get(at);
                expect(column, `${at} in ${await crew.getAttribute(narrow ? "data-plan-card" : "data-plan-row")}`).toBeDefined();
                expect(same(column!.left, left) && same(column!.width, width), `${at}'s column`).toBe(true);
            }
        }
        const [worksBox, ...crewBoxes] = await Promise.all([works, ...crews].map((row) => row.boundingBox()));
        for (const box of crewBoxes) expect(same(box!.height, worksBox!.height)).toBe(true);

        // A crew's week holding hours, typed into.
        const crew = crews[0]!;
        const cell = crew.locator("[data-cell][data-typed]").filter({ hasText: /\d/ }).first();
        const at = await cell.getAttribute("data-cell");
        const sum = works.locator(`[data-cell="${at}"]`);
        const was = (await numberIn(cell))!;
        const before = (await numberIn(sum))!;
        if (narrow) await cell.tap();
        else await cell.dblclick();
        const field = page.locator("[data-plan-typing]");
        const input = field.locator("input");
        await expect(input).toBeFocused();
        const popover = page.locator("[data-plan-typing-popover]");
        // On a phone, measured once the popover has come in: it scales as it opens.
        if (narrow) await popover.locator("xpath=..").evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.then(() => undefined, () => undefined))));
        const [cellBox, fieldBox] = await Promise.all([cell.boundingBox(), field.boundingBox()]);
        if (narrow) {
            // A popover anchored to the cell — below it, across it — inside the frame, its field a row's height.
            const [frameBox, popoverBox] = await Promise.all([entry.locator("[data-builder-frame]").first().boundingBox(), popover.boundingBox()]);
            expect(popoverBox!.y).toBeGreaterThanOrEqual(cellBox!.y + cellBox!.height);
            expect(popoverBox!.x).toBeLessThanOrEqual(cellBox!.x + cellBox!.width / 2);
            expect(popoverBox!.x + popoverBox!.width).toBeGreaterThanOrEqual(cellBox!.x + cellBox!.width / 2);
            expect(popoverBox!.x, "the popover's left edge, inside the frame").toBeGreaterThanOrEqual(frameBox!.x);
            expect(popoverBox!.x + popoverBox!.width, "the popover's right edge, inside the frame").toBeLessThanOrEqual(frameBox!.x + frameBox!.width);
            expect(same(fieldBox!.height, 32)).toBe(true);
            // The design system's smallest popover, xs 240, drawn at the width its styles give it: the width the frame's
            // bounds weigh before it is drawn.
            const [drawn, styled] = await popover.evaluate((el) => [el.getBoundingClientRect().width, el.computedStyleMap().get("width")?.toString()] as const);
            expect([Math.round(drawn), styled]).toEqual([240, "240px"]);
        } else {
            // Over the cell, at its width and the row's height.
            expect(same(fieldBox!.x, cellBox!.x) && same(fieldBox!.width, cellBox!.width)).toBe(true);
            expect(same(fieldBox!.y, cellBox!.y) && same(fieldBox!.height, cellBox!.height)).toBe(true);
        }
        // Its text in the table's numerals: the face the row's numbers are set in.
        const [numerals, typed] = await Promise.all([
            crew.locator("[data-cell] [data-part]").first().evaluate((el) => getComputedStyle(el).fontFamily),
            input.evaluate((el) => getComputedStyle(el).fontFamily),
        ]);
        expect(typed).toBe(numerals);
        await input.fill(String(was + 20));
        await input.press("Enter");
        await expect(field).toHaveCount(0);
        await expect.poll(() => numberIn(cell)).toBe(was + 20);
        await expect.poll(() => numberIn(sum)).toBe(before + 20);
        await settled(page);
    });

    for (const gesture of ["scroll", "pan", "zoom"] as const) {
        test(`a ${gesture} moves nothing as its cells land: while they are in flight the rows waiting on them are washed and busy, and no other; landed, every row in view keeps its place and its height`, { tag }, async ({ page }) => {
            await installE3Faults(page);
            const entry = await openExample(page, ALL, NESTED, theme);
            const narrow = narrowOf(page);
            // The works' cells held in flight: their searches and their runs.
            const held = await holdE3(page, { kinds: ["find", "runs"], dataset: WORKS_RECORD });
            await GESTURES[gesture](page, entry, narrow);
            await expect.poll(() => heldE3(page, held)).toBeGreaterThan(0);
            await settled(page, { holding: true });
            const waiting = entry.locator(narrow ? "[data-plan-cardbody][data-plan-unread]" : "[data-plan-plot][data-plan-unread]");
            await expect(waiting.first()).toBeVisible();
            const washes = entry.locator("[data-loading-wash]");
            await expect(washes).toHaveCount(await waiting.count());
            await expect(washes.first()).not.toHaveAttribute("data-unrevealed", "");
            // Across each one's plot, painted, busy.
            for (const plot of await waiting.all()) {
                const drawn = await plot.evaluate((el) => {
                    const wash = el.querySelector<HTMLElement>(":scope > [data-loading-wash]")!;
                    const style = getComputedStyle(wash);
                    const p = el.getBoundingClientRect(), b = wash.getBoundingClientRect();
                    return {
                        visibility: style.visibility, covers: Math.abs(b.width - p.width) <= 1 && Math.abs(b.height - p.height) <= 1,
                        painted: style.backgroundColor !== "rgba(0, 0, 0, 0)", busy: el.getAttribute("aria-busy"),
                    };
                });
                expect(drawn).toEqual({ visibility: "visible", covers: true, painted: true, busy: "true" });
            }
            // Landed, nothing in view moves, and nothing is washed.
            await watch(entry, narrow);
            await releaseE3(page, held);
            await expect(waiting).toHaveCount(0);
            await settled(page);
            const frames = await framesOf(page);
            expect(Object.keys(frames[0]!.rows).length).toBeGreaterThan(0);
            expect(movedIn(frames)).toEqual([]);
            await expect(washes).toHaveCount(0);
        });
    }

    test("past the cap, the rows shading the works' jobs are the height of the rows they stand in for: hatched at a week, shaded from their totals at a month", { tag }, async ({ page }) => {
        await installE3Faults(page);
        const entry = await openExample(page, ALL, NESTED, theme);
        const narrow = narrowOf(page);
        await onlySeries(page, entry, ["Jobs"]);
        const kind = (key: string) => {
            const row = entry.locator(drawnSel("works", key));
            return narrow ? row.locator("[data-plan-cardbody]") : row;
        };
        const kindOf = narrow ? "data-plan-cardbody" : "data-plan-kind";
        await expect(kind(WORKS)).toHaveAttribute(kindOf, "span");
        const before = await inView(entry, narrow);
        expect(Object.keys(before.rows).length).toBeGreaterThan(1);
        await crowd(page);
        // Hatched at a week: every works row in view shades, each at its place and its height.
        for (const id of Object.keys(before.rows)) {
            const row = entry.locator(`[${narrow ? "data-plan-card" : "data-plan-row"}=${JSON.stringify(id)}]`);
            await expect(narrow ? row.locator("[data-plan-cardbody]") : row).toHaveAttribute(kindOf, "heat");
        }
        await settled(page);
        expect(await inView(entry, narrow)).toEqual(before);
        // At a month, shaded from their totals: the same.
        await GESTURES.zoom(page, entry, narrow);
        await settled(page);
        await expect(kind(WORKS)).toHaveAttribute(kindOf, "heat");
        expect((await inView(entry, narrow)).rows).toEqual(before.rows);
    });
}
