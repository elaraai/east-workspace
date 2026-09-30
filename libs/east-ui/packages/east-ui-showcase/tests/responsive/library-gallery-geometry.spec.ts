/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Library gallery's geometry, measured in a real browser (#1030): the page
 * gallery's cards two across with their media at the start, the list the
 * toolbar's switch lays out, the report gallery's cards three across with
 * their media on top, and how many a narrower Library holds; the dashed card
 * that adds one; the media, which takes neither the pointer nor a scrollbar;
 * and the one toolbar row the switch ends. The Library's width is set on the
 * page, so each width is measured on one example. Every measurement is polled
 * until it holds, on a page at rest; no screenshot is read.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test library-gallery-geometry --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** A box, relative to the gallery's first grid. */
interface CardBox { x: number; y: number; w: number; h: number }

/** A card's media: where it sits in its card, its size, and the card's. */
interface MediaBox { x: number; y: number; w: number; h: number; cardW: number; cardH: number }

/** Open a Library example's page and return its Library, at rest. */
async function openLibrary(page: Page, name: string): Promise<Locator> {
    await page.goto(`/?theme=light#collections/library/${name}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#collections/library/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const library = entry.locator("[data-library]").first();
    await expect(library.locator("[data-library-card]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return library;
}

/** Set the Library's width. */
function widthTo(library: Locator, px: number): Promise<void> {
    return library.evaluate((root, w) => { (root as HTMLElement).style.width = `${w}px`; }, px);
}

/** Every card's box — and the dashed card's, as `+` — relative to the first grid, rounded to a tenth of a pixel. */
function cards(library: Locator): Promise<Record<string, CardBox>> {
    return library.evaluate((root) => {
        const grid = root.querySelector("[data-layout]")!.getBoundingClientRect();
        const round = (n: number) => Math.round(n * 10) / 10;
        const box = (el: Element) => {
            const b = el.getBoundingClientRect();
            return { x: round(b.left - grid.left), y: round(b.top - grid.top), w: round(b.width), h: round(b.height) };
        };
        return Object.fromEntries([
            ...[...root.querySelectorAll("[data-library-card]")].map((el) => [el.getAttribute("data-library-card")!, box(el)]),
            ...[...root.querySelectorAll("[data-library-add]")].map((el) => ["+", box(el)]),
        ]);
    });
}

/** Every card's media, by the card's key, rounded to a tenth of a pixel. */
function media(library: Locator): Promise<Record<string, MediaBox>> {
    return library.evaluate((root) => {
        const round = (n: number) => Math.round(n * 10) / 10;
        return Object.fromEntries([...root.querySelectorAll("[data-library-card]")].map((card) => {
            const c = card.getBoundingClientRect();
            const m = card.querySelector("[data-library-media]")!.getBoundingClientRect();
            return [card.getAttribute("data-library-card")!, {
                x: round(m.left - c.left), y: round(m.top - c.top), w: round(m.width), h: round(m.height), cardW: round(c.width), cardH: round(c.height),
            }];
        }));
    });
}

/** A track's width on a grid `width` px wide holding `n` columns `gap` px apart. */
const track = (width: number, n: number, gap: number) => Math.round(((width - (n - 1) * gap) / n) * 10) / 10;

/** A difference of rounded boxes, rounded again — subtraction leaves float noise. */
const tenth = (n: number) => Math.round(n * 10) / 10;

/** The pages the page gallery holds, in order. */
const PAGES = ["overview", "account-detail", "regional-rollup"];

/** The operations group's reports, in order. */
const OPERATIONS = ["order-intake", "fill-rate", "backlog-age"];

/** The body's padding, both sides: a Library `w` wide lays its grid out `w - 28` wide. */
const INSET = 28;

test.describe("Library gallery geometry (#1030)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width; the Library's width is set per case");

    test("the page gallery: two across, 14px between columns and rows; each card's media 156px wide at its start, the face beside it; at least 140px tall, a 10px radius, a 1px strong rule; the dashed card last, as tall as its row", async ({ page }) => {
        const library = await openLibrary(page, "libraryGalleryPages");
        await widthTo(library, 1000);
        const col = track(1000 - INSET, 2, 14);
        await expect.poll(async () => {
            const b = await cards(library);
            const [first, second, third] = PAGES.map((k) => b[k]!);
            const add = b["+"]!;
            return {
                first: [first!.x, first!.y, first!.w], second: [second!.x, second!.y, second!.w],
                third: [third!.x, third!.w], add: [add.x, add.w],
                rowGap: tenth(third!.y - (first!.y + first!.h)), addBesideThird: add.y === third!.y && add.h === third!.h,
                tall: [first!, second!, third!].every((c) => c.h >= 140),
            };
        }).toEqual({
            first: [0, 0, col], second: [col + 14, 0, col], third: [0, col], add: [col + 14, col],
            rowGap: 14, addBesideThird: true, tall: true,
        });
        // Inside the card's 1px rule, 156px wide, the card's full height.
        await expect.poll(async () => Object.values(await media(library)).map((m) => [m.x, m.y, m.w, tenth(m.cardH - m.h)]))
            .toEqual(PAGES.map(() => [1, 1, 156, 2]));
        await expect.poll(() => library.evaluate((root) => {
            const s = getComputedStyle(root.querySelector("[data-library-card]")!);
            const add = getComputedStyle(root.querySelector("[data-library-add]")!);
            return { border: `${s.borderTopWidth} ${s.borderTopStyle}`, radius: s.borderTopLeftRadius, overflow: s.overflow, add: `${add.borderTopWidth} ${add.borderTopStyle}` };
        })).toEqual({ border: "1px solid", radius: "10px", overflow: "hidden", add: "1px dashed" });
    });

    test("the toolbar's List lays each card on a row of its own, the grid's full width, 14px apart, its media still at the start", async ({ page }) => {
        const library = await openLibrary(page, "libraryGalleryPages");
        await library.getByRole("radio", { name: "List view" }).click();
        await widthTo(library, 1000);
        const full = 1000 - INSET;
        await expect.poll(async () => {
            const b = await cards(library);
            const order = [...PAGES, "+"].map((k) => b[k]!);
            return {
                columns: order.map((c) => [c.x, c.w]),
                gaps: order.slice(1).map((c, i) => tenth(c.y - (order[i]!.y + order[i]!.h))),
            };
        }).toEqual({ columns: [[0, full], [0, full], [0, full], [0, full]], gaps: [14, 14, 14] });
        await expect.poll(async () => Object.values(await media(library)).map((m) => [m.x, m.w])).toEqual(PAGES.map(() => [1, 156]));
    });

    test("the report gallery: three across 12px apart, each card's media 112px tall above its face; a narrower Library holds two, then one — no column under 180px", async ({ page }) => {
        const library = await openLibrary(page, "libraryGalleryReports");
        // 1000: three columns, the operations group's three reports.
        await widthTo(library, 1000);
        const three = track(1000 - INSET, 3, 12);
        await expect.poll(async () => {
            const b = await cards(library);
            return OPERATIONS.map((k) => [b[k]!.x, b[k]!.w]);
        }, "1000").toEqual([[0, three], [three + 12, three], [2 * (three + 12), three]]);
        // On top, inside the card's 1px rule: the card's width less its rule, 112px tall.
        await expect.poll(async () => [...new Set(Object.values(await media(library)).map((m) => `${m.x} ${m.y} ${tenth(m.cardW - m.w)} ${m.h}`))], "media")
            .toEqual(["1 1 2 112"]);
        // 500: two columns — a third would be under 180px.
        await widthTo(library, 500);
        const two = track(500 - INSET, 2, 12);
        await expect.poll(async () => {
            const b = await cards(library);
            return OPERATIONS.map((k) => [b[k]!.x, b[k]!.w]);
        }, "500").toEqual([[0, two], [two + 12, two], [0, two]]);
        // 300: one.
        await widthTo(library, 300);
        await expect.poll(async () => [...new Set(Object.values(await cards(library)).map((c) => `${c.x} ${c.w}`))], "300")
            .toEqual([`0 ${300 - INSET}`]);
    });

    test("the media takes neither the pointer nor a scrollbar: a press on a page's wireframe opens the page", async ({ page }) => {
        const library = await openLibrary(page, "libraryGalleryPages");
        const wire = library.locator('[data-library-card="overview"] [data-library-media]');
        await expect.poll(() => wire.evaluate((el) => {
            const scrollers = [...el.querySelectorAll("*")].filter((d) => ["auto", "scroll"].includes(getComputedStyle(d).overflowX));
            return {
                inert: (el as HTMLElement).inert,
                pointer: getComputedStyle(el).pointerEvents,
                scrollbars: scrollers.filter((d) => getComputedStyle(d).scrollbarWidth !== "none" || (d as HTMLElement).offsetHeight - d.clientHeight > 0).length,
            };
        })).toEqual({ inert: true, pointer: "none", scrollbars: 0 });
        await wire.click();
        await expect(page.getByText("Opened · overview", { exact: true })).toBeVisible();
    });

    test("one toolbar row, 44px: the search at its start, the Grid · List switch at its end", async ({ page }) => {
        const library = await openLibrary(page, "libraryGalleryReports");
        await widthTo(library, 1000);
        await expect.poll(() => library.evaluate((root) => {
            const band = root.querySelector("[data-slot='toolbar']")!.getBoundingClientRect();
            const row = root.querySelector("[data-toolbar]")!.getBoundingClientRect();
            const search = root.querySelector("[data-toolbar-item='search']")!.getBoundingClientRect();
            const layout = root.querySelector("[data-toolbar-item='layout']")!.getBoundingClientRect();
            const round = (n: number) => Math.round(n * 10) / 10;
            return {
                rows: root.querySelectorAll("[data-toolbar]").length,
                band: round(band.height),
                searchAtStart: round(search.left - row.left),
                layoutAtEnd: round(row.right - layout.right),
                oneLine: Math.abs((search.top + search.bottom) / 2 - (layout.top + layout.bottom) / 2) < 0.5,
            };
        })).toEqual({ rows: 1, band: 44, searchAtStart: 0, layoutAtEnd: 0, oneLine: true });
    });
});
