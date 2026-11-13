/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Schematic's Index following the view, in a real browser (#1570), on the
 * floor of 20,000 racks in ten halls, its racks read by area. Zoomed into a
 * hall, the Index opens it once the camera has rested and its racks are read
 * with their loads, and never before: at no change of the tree on the way is
 * another hall open or marked, a hall shown open without its racks, or a rack
 * listed without its load. The hall's row is brought to the list's top,
 * marked as the one in view, and each rack's row has its dot in its load's
 * status and its figure. Scrolled 1,500px into its 2,000 racks, the hall's row
 * sticks at the list's top, on the pane's paper, the racks passing under it
 * and a point on it hitting it; a click on it closes it, and it stays closed
 * while the view rests in it. Found by Find, a rack deep in another hall flies
 * the camera there across the hall between, and the tree holds as it did on
 * the way in: the hall flown to opens once the camera rests, with its racks
 * and their loads, its row at the list's top. At Fit, no hall in view, the
 * hall the view opened closes and none is marked. Desktop, light theme: the
 * Index holds no colour of its own but the pane's paper, a token.
 *
 * Every wait is a poll on the page's state, never a fixed pause; nothing reads
 * a screenshot.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-index`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { RECORD_INDEXES, findAndPick, openSchematic, openTab, pane, restsOn, zoomInto, type WorldBox } from "./schematic-page";
import { settled } from "./settle";
import { token } from "./tokens";

/** The floor: ten halls of 72 × 122 m, five to a row. */
const FLOOR: WorldBox = { minX: 0, minY: 0, maxX: 382, maxY: 254 };
/** Hall 3, as the example's record places it. */
const HALL_3: WorldBox = { minX: 154, minY: 2, maxX: 226, maxY: 124 };
/** A box inside Hall 3, over its racks' rows. */
const IN_HALL_3: WorldBox = { minX: 160, minY: 6, maxX: 220, maxY: 46 };
/** R110450, Hall 5's rack in the middle of its 11th row, as the example's generator places it: 0.6 × 1.2 m about (342.3, 27.6). */
const R110450: WorldBox = { minX: 342.0, minY: 27.0, maxX: 342.6, maxY: 28.2 };

/** The Index's tree. */
const treeOf = (root: Locator) => pane(root).locator("[role='tree']");

/** A row of the Index, by its name: a hall's or a rack's. */
const rowOf = (root: Locator, name: string) => treeOf(root).locator("[role='treeitem']")
    .filter({ has: root.page().locator("[data-index-name]", { hasText: new RegExp(`^${name}$`) }) });

/** What the tree shows at a moment: the halls open, the hall marked as the one in view, and its racks' rows drawn — and of them, those whose dot has no status. */
interface Shown {
    readonly open: readonly string[];
    readonly current: readonly string[];
    readonly racks: number;
    readonly grey: number;
}

/** A recording of what the tree showed, on the page. */
interface Recording {
    readonly shown: Shown[];
    readonly observer: MutationObserver;
}

/**
 * Records what the tree shows now and at each change of it after — every commit that mounts or drops a row, opens or
 * closes a hall, or marks one — until {@link shownSince} reads it.
 *
 * @param root - The Schematic's root
 */
function recordShown(root: Locator): Promise<void> {
    return pane(root).evaluate((el) => {
        const shown: Shown[] = [];
        const read = () => {
            const rows = [...el.querySelectorAll("[role='treeitem']")];
            const names = (pick: (row: Element) => boolean) => rows.filter(pick).map((row) => row.querySelector("[data-index-name]")?.textContent ?? "");
            const racks = rows.filter((row) => row.hasAttribute("data-index-item"));
            shown.push({
                open: names((row) => row.hasAttribute("data-index-zone") && row.getAttribute("aria-expanded") === "true"),
                current: names((row) => row.hasAttribute("data-current")),
                racks: racks.length,
                grey: racks.filter((row) => !(row.querySelector("[data-index-dot]")?.hasAttribute("data-status") ?? false)).length,
            });
        };
        read();
        const observer = new MutationObserver(read);
        observer.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-expanded", "data-current", "data-status"] });
        (window as { __indexShown?: Recording }).__indexShown = { shown, observer };
    });
}

/**
 * What the tree showed at each change since {@link recordShown}, the recording stopped.
 *
 * @param page - The page
 * @returns Each moment, in order
 */
function shownSince(page: Page): Promise<Shown[]> {
    return page.evaluate(() => {
        const recording = (window as { __indexShown?: Recording }).__indexShown!;
        recording.observer.disconnect();
        return recording.shown;
    });
}

/**
 * Holds a recording to the tree following the view: no hall but the one it lands in open, none but it and the one it
 * left marked, no hall shown open without its racks, and no rack listed without its load.
 *
 * @param shown - What the tree showed
 * @param to - The hall the view lands in
 * @param from - The hall the view left, marked until it lands; none from Fit
 */
function followedTo(shown: readonly Shown[], to: string, from?: string): void {
    expect(new Set(shown.flatMap((moment) => moment.open)), "the halls shown open").toEqual(new Set([to]));
    expect(new Set(shown.flatMap((moment) => moment.current)), "the halls marked as the one in view").toEqual(new Set(from === undefined ? [to] : [from, to]));
    expect(shown.filter((moment) => moment.open.length > 0 && moment.racks === 0), "a hall shown open with none of its racks listed").toEqual([]);
    expect(shown.filter((moment) => moment.grey > 0), "a rack listed without its load").toEqual([]);
}

/**
 * Where a hall's row stands in the list's scroll box: how far the box is scrolled, the row's top under the box's, whether
 * its place sticks, whether a point at its middle hits it, whether a rack's row lies under that point, and its paper.
 *
 * @param root - The Schematic's root
 * @param hall - The hall's name
 * @returns Where it stands; `null` while its row is not drawn
 */
function rowPlace(root: Locator, hall: string) {
    return treeOf(root).evaluate((tree, name) => {
        const box = tree.querySelector<HTMLElement>("[data-virtual-rows]")!;
        const row = [...tree.querySelectorAll<HTMLElement>("[role='treeitem'][data-index-zone]")].find((r) => r.querySelector("[data-index-name]")?.textContent === name);
        if (row === undefined) return null;
        const b = box.getBoundingClientRect(), r = row.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
            scrolled: box.scrollTop,
            offset: Math.round(r.top - b.top),
            stuck: row.closest("[data-slot='virtualRow']")?.hasAttribute("data-virtual-stuck") === true,
            hit: hit !== null && row.contains(hit),
            over: document.elementsFromPoint(x, y).some((under) => under.matches("[role='treeitem'][data-index-item]")),
            paper: getComputedStyle(row.closest("[data-index]")!).backgroundColor,
        };
    }, hall);
}

test.describe("The Schematic's Index follows the view (#1570)", { tag: "@desktop" }, () => {
    test("zoomed into a hall, the Index opens it once the camera rests, with its racks and their loads, its row at the list's top; scrolled, the row sticks there on the pane's paper over the racks; a click closes it for as long as the view stays; Find's fly to another hall opens that one alone; Fit closes it", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const root = await openSchematic(page, RECORD_INDEXES);
        await openTab(page, root, "Index");
        await expect(rowOf(root, "Hall 1")).toBeVisible();

        await test.step("zoomed into Hall 3: it opens once the camera rests, with its racks and their loads, and no other hall opens or is marked on the way", async () => {
            await recordShown(root);
            await zoomInto(page, root, IN_HALL_3);
            await expect(rowOf(root, "Hall 3")).toHaveAttribute("data-current", "");
            await expect(rowOf(root, "Hall 3")).toHaveAttribute("aria-expanded", "true");
            await expect(treeOf(root)).not.toHaveAttribute("aria-busy", "true");
            await settled(page);
            followedTo(await shownSince(page), "Hall 3");
        });

        await test.step("its row at the list's top; each rack's row its dot in its load's status and its figure", async () => {
            await expect.poll(async () => (await rowPlace(root, "Hall 3"))?.offset, "Hall 3's row under the list's top").toBe(0);
            // As the example's generator loads them: R100200 8.0 kW, OK; R100201 11.7 kW, hot.
            for (const [rack, status, figure] of [["R100200", "success", "8.0 kW"], ["R100201", "danger", "11.7 kW"]] as const) {
                await expect(rowOf(root, rack).locator("[data-index-dot]"), rack).toHaveAttribute("data-status", status);
                await expect(rowOf(root, rack).locator("[data-index-metric]"), rack).toHaveText(figure);
            }
        });

        await test.step("scrolled 1,500px into its racks, its row sticks at the list's top on the pane's paper, the racks passing under it", async () => {
            await treeOf(root).locator("[data-virtual-rows]").evaluate((box) => { box.scrollTop += 1_500; });
            await settled(page);
            const place = await rowPlace(root, "Hall 3");
            expect(place?.scrolled, "the list scrolled").toBeGreaterThan(1_500);
            expect(place).toMatchObject({ offset: 0, stuck: true, hit: true, over: true, paper: await token(page, "bg-surface") });
        });

        await test.step("a click on it closes it, the camera flying to the hall, and it stays closed while the view rests in it", async () => {
            await rowOf(root, "Hall 3").click();
            await expect(rowOf(root, "Hall 3")).toHaveAttribute("aria-expanded", "false");
            await restsOn(root, HALL_3);
            await settled(page);
            await expect(rowOf(root, "Hall 3")).toHaveAttribute("data-current", "");
            await expect(rowOf(root, "Hall 3")).toHaveAttribute("aria-expanded", "false");
        });

        await test.step("found by Find, a rack deep in Hall 5 flies the camera across Hall 4: Hall 5 alone opens, once the camera rests, with its racks and their loads, its row at the list's top", async () => {
            await recordShown(root);
            await findAndPick(page, root, "R110450", "R110450 · Rack");
            await restsOn(root, R110450);
            await expect(rowOf(root, "Hall 5")).toHaveAttribute("data-current", "");
            await expect(rowOf(root, "Hall 5")).toHaveAttribute("aria-expanded", "true");
            await expect(treeOf(root)).not.toHaveAttribute("aria-busy", "true");
            await settled(page);
            followedTo(await shownSince(page), "Hall 5", "Hall 3");
            await expect.poll(async () => (await rowPlace(root, "Hall 5"))?.offset, "Hall 5's row under the list's top").toBe(0);
        });

        await test.step("at Fit no hall is in view: the hall the view opened closes, and none is marked", async () => {
            await root.locator("[data-frame-slot='toolbar']").getByRole("button", { name: "Fit" }).click();
            await restsOn(root, FLOOR);
            await expect(treeOf(root).locator("[data-current]")).toHaveCount(0);
            await expect(rowOf(root, "Hall 5")).toHaveAttribute("aria-expanded", "false");
        });
    });
});
