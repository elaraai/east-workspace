/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A Studio page's filter rail (#1673), measured in a real browser over the
 * showcase's page of visuals and its builder:
 *
 *  - F1 on a page the rail is a toolbar row over the grid: 28px, the grid 12
 *    under it, no border of its own; the page's starting filter its chip —
 *    the page of visuals starts in its latest quarter — then its `+ FILTER`
 *    chip, after the rail's icon. A page with none is its `+ FILTER` chip
 *    alone (F5, F7).
 *  - F2 a filter is written with the query builder's condition rows in
 *    place, in the chip's popover: it opens on its field's list, then a value
 *    from the values the source holds with how many rows hold each, read from
 *    e3 — the shared picker in the flow under the rows, whole, drawing no
 *    frame of its own, the popover ending where it ends; each slot boxed as
 *    the query builder draws it, solid once filled; and no Done, each
 *    finished condition the page's.
 *  - F3 the filter is a chip in the rows' words, after its dataset's name —
 *    said once, in the caption type, on the chip's line (ruled 19 November
 *    2026) — and every visual of its source narrows: the tiles ask again, on
 *    e3.
 *  - F4 the chip's × takes the filter out, and the tiles are as they were.
 *  - F5 the builder's toolbar holds no filter rail — its canvas is the page as
 *    designed — and its Preview is the page as a reader sees it: the rail
 *    over its grid, measured as F1 measures a page's (ruled 19 November 2026).
 *  - F6 as the page narrows the rail folds its chips one at a time into
 *    `+N more` — every filter a chip or counted, the row 28px and never wider
 *    than its page — and `+N more` opens one popover that lists them all,
 *    whose Clear all takes every one out.
 *  - F7 on a phone the builder's toolbar holds no Filters button; its
 *    Preview's page, on Mobile, draws the rail over its grid as a reader's page
 *    does — measured as F1 measures it, inside the builder — and the editor it
 *    opens stands inside the screen. A page is one box, its rail over its
 *    grid, so no gap of the Preview's frame comes between them.
 *  - F8 in place the rows keep the query builder's columns at every level of
 *    a filter of two conditions and a group (its spec's step: a condition's
 *    slot boxes, its foot's add and its notes on one edge): the head's first
 *    slot and each joiner on one edge; each condition's first slot's box, the
 *    foot's add and a group's box on another — a lone condition's on the
 *    rows' own edge, nothing reaching past it into the popover's padding;
 *    each row's × at its line's end, in line with its group's. With a field's
 *    list open, the list is the one thing in the popover that scrolls.
 *  - F9 a chip says its filter short — `Region: SA`, its field then what it
 *    holds — and whole on its hover. While its popover is open the row holds
 *    still: a condition added there moves neither the chip, its popover nor
 *    `+ FILTER`, and a press held on `+ FILTER`'s very edge — the popover
 *    shutting under it — opens the new filter's editor where it stood. Shut,
 *    the chip says its first condition and how many more: `Region: SA +1`.
 *  - F10 the page's starting filters — what every reader starts with — stand
 *    on a rail of their own in the builder canvas's band, between its
 *    selection bar and its grid: captioned before the rail, on the chip's
 *    line; a 28px row with no border; each dataset's chips after its name; and
 *    the canvas narrows by them. At every width the band holds the rail and
 *    nothing scrolls sideways.
 *  - F11 over a page whose visuals read two datasets, a new filter's editor
 *    is `Add filter`, a choice of them heading it: the datasets in the order
 *    the surface lists them, the first picked, each the shared choice chip
 *    at its own height, as Slice's editors draw their choices (28px is a
 *    toolbar row's alone), between the head and the rows on the rows' edge.
 *    Another picked, the rows start again over its fields. The filter is that
 *    dataset's — its chip after its name — and its visuals alone narrow.
 *
 * Every measurement is taken from the laid-out page.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-filters --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { PatchType, SortedMap, compareFor, diffFor, encodeBeast2For, parseJq, variant, type ValueTypeOf } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import * as studio from "@elaraai/e3-ui/examples/studio/studio";
import { installE3Faults, mutateE3 } from "./e3-faults";
import { test } from "./kept-page";
import { settled } from "./settle";
import { openVisuals } from "./studio-visuals-page";

/** The showcase's builder over a page of content, whose visuals read two sources: the sales and the returns. */
const BUILDER = "e3/studio/studio/studioContent";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

/**
 * Starts the builder's page's readers on a condition over the sales: its draft's one starting filter, as another
 * session's save writes it, through its pages record's patch.
 *
 * @param page - The browser's page
 * @param where - The condition, as jq over one sale
 */
async function writeStartingFilter(page: Page, where: string): Promise<void> {
    const { type, name, default: seeded } = studio.studioContentPages;
    if (seeded === undefined) throw new Error("the content pages are seeded");
    const parsed = parseJq(where);
    if (parsed.program.type === "none") throw new Error(`does not parse: ${where}`);
    const filter = { key: "f-spec", source: "sales", where: parsed.program.value };
    const before = new SortedMap<Key, Entry>(seeded, compareFor(Studio.Types.Key));
    const after = new SortedMap<Key, Entry>([...before].map(([key, entry]): [Key, Entry] => [
        key, entry.type === "page" ? variant("page", { draft: { ...entry.value.draft, filters: [filter] }, live: entry.value.live }) : entry,
    ]), compareFor(Studio.Types.Key));
    await mutateE3(page, "studio", name, "patch", [encodeBeast2For(PatchType(type))(diffFor(type)(before, after))]);
}

/** The page's first KPI's value: the quarter's revenue. */
const revenue = (grid: Locator) => grid.locator('[data-snap-grid-cell="v-revenue"] [data-studio-kpi-value]');

/** A filter's chip on a rail of the page of visuals, after the page's starting filter's — the chip a test wrote. */
const written = (rail: Locator) => rail.locator("[data-slice-clause]").nth(1);

/**
 * Opens the showcase's builder, its entry in view.
 *
 * @param page - The browser's page
 * @returns The builder
 */
async function openBuilder(page: Page): Promise<Locator> {
    await page.goto(`/?theme=light#${BUILDER}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${BUILDER}"]`) });
    await entry.scrollIntoViewIfNeeded();
    return entry.locator("[data-studio-builder]");
}

/**
 * Scrolls the showcase's list of examples so a page's rail stands at the top of its view — where a reader's page holds
 * it, under the page's head, with the screen's room below — before a test opens a filter's editor from it. The list
 * leaves the page wherever its scroll stood: after a fresh page's first paint, or a kept page's last test, the rail
 * stood anywhere from the screen's top to its last quarter, and an editor opened there had a quarter of the room.
 *
 * @param page - The browser's page
 * @param rail - The page's rail
 */
async function railOnTop(page: Page, rail: Locator): Promise<void> {
    await rail.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await settled(page);
}

/**
 * A rail at rest, over the grid it narrows: its height, how far above the grid
 * it stands and whether it starts where the grid does, its borders, its chips,
 * and its `+ FILTER` chip's height and whether it stands after the rail's icon.
 *
 * @param rail - The rail's row
 * @returns What it measures
 */
const railAtRest = (rail: Locator) => rail.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const grid = el.parentElement!.querySelector("[data-snap-grid]")!.getBoundingClientRect();
    const style = getComputedStyle(el);
    const add = el.querySelector("[data-slice-add=filter]")!.getBoundingClientRect();
    return {
        h: box.height, toGrid: grid.top - box.bottom, sameStart: box.left === grid.left,
        borders: [style.borderTopWidth, style.borderBottomWidth, style.borderLeftWidth, style.borderRightWidth],
        chips: el.querySelectorAll("[data-slice-clause]").length, add: [add.height, add.left > box.left],
    };
});

/** What {@link railAtRest} reads of a rail with no filter: F1's page, and the Preview's at F5 and F7. */
const AT_REST = { h: 28, toGrid: 12, sameStart: true, borders: ["0px", "0px", "0px", "0px"], chips: 0, add: [28, true] };

test.describe("A Studio page's filter rail (#1673)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("F1: on a page the rail is a 28px toolbar row over the grid, 12 above it, with no border; its starting filter's chip, then its + FILTER chip after its icon", async ({ page }) => {
        const grid = await openVisuals(page, "light");
        const rail = grid.locator("xpath=..").locator("[data-studio-filters]");
        expect(await railAtRest(rail)).toEqual({ ...AT_REST, chips: 1 });
        // Every reader starts in the latest quarter.
        await expect(rail.locator("[data-slice-clause]")).toHaveAttribute("title", "ordered at is on or after 2026-07-01 and ordered at is before 2026-10-01");
    });

    test("F2, F3, F4: a filter written with the condition rows — a field, a value from the source's own with its count, the chooser whole inside the popover — is a chip in words that narrows every visual of its source; its × puts them back", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const grid = await openVisuals(page, "light");
        const rail = grid.locator("xpath=..").locator("[data-studio-filters]");
        const all = await revenue(grid).textContent();
        await railOnTop(page, rail);
        await rail.locator("[data-slice-add=filter]").click();
        const rows = page.locator("[data-studio-filter-rows]");
        await expect(rows).toBeVisible();
        // A new filter opens on its field's list: the shared picker, in the flow under the rows.
        const chooser = rows.locator("[data-chooser]");
        await expect(chooser).toBeVisible();
        await settled(page);
        // The rows alone: no step card, number or toolbar of the query builder's, and no Done — each finished condition is the page's.
        expect(await rows.locator("[data-step-id], [data-query-shape-text]").count()).toBe(0);
        await expect(page.getByRole("dialog").getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
        /**
         * Whether the picker stands whole in the popover's body, on top, tall enough for its offers, with no edge of its
         * own — the popover's is the one frame — and the rows' block, and the popover with it, ending where it ends.
         */
        const whole = () => chooser.evaluate((el) => {
            const box = el.getBoundingClientRect();
            const block = document.querySelector("[data-studio-filter-rows]")!.getBoundingClientRect();
            const body = el.closest("[data-scope='popover'][data-part='content']")!.getBoundingClientRect();
            const hit = document.elementFromPoint(box.left + box.width / 2, box.bottom - 8);
            const look = getComputedStyle(el);
            return {
                inside: box.left >= body.left && box.right <= body.right && box.top >= body.top && box.bottom <= body.bottom + 0.5,
                onTop: hit !== null && el.contains(hit), tall: box.height >= 200,
                edges: [look.borderTopWidth, look.borderRightWidth, look.borderBottomWidth, look.borderLeftWidth],
                endsWithIt: Math.abs(block.bottom - box.bottom) <= 0.5,
            };
        });
        expect(await whole()).toEqual({ inside: true, onTop: true, tall: true, edges: ["0px", "0px", "0px", "0px"], endsWithIt: true });
        await chooser.locator("[role=option]", { hasText: "region" }).first().click();
        // The field's value opens next: the values the orders hold, each with its rows.
        await expect(chooser.locator("[role=option]", { hasText: "SA" })).toBeVisible({ timeout: 20_000 });
        await settled(page);
        const offers = await chooser.locator("[role=option]").allTextContents();
        expect(offers.every((offer) => /\d+ orders?$/.test(offer)), offers.join(" | ")).toBe(true);
        expect(await whole()).toEqual({ inside: true, onTop: true, tall: true, edges: ["0px", "0px", "0px", "0px"], endsWithIt: true });
        await chooser.locator("[role=option]", { hasText: "SA" }).first().click();
        // The condition finished, the picker goes; each filled slot is the query builder's, its box's edge solid — the one
        // the pick gave the focus back to wears its ring.
        await expect(chooser).toHaveCount(0);
        const slots = await rows.locator("[data-slot-key]:not([data-empty])").evaluateAll((all) =>
            all.map((slot) => {
                const look = getComputedStyle(slot);
                return { focused: slot === document.activeElement, edge: [look.borderTopStyle, look.borderTopColor !== "rgba(0, 0, 0, 0)"] };
            }));
        expect([slots.filter((slot) => !slot.focused).map((slot) => slot.edge), slots.filter((slot) => slot.focused).length])
            .toEqual([[["solid", true], ["solid", true]], 1]);

        // The quarter's revenue is South Australia's alone at once; the row, held while its editor is open — the starting
        // filter's chip its only one — takes the new chip as the editor shuts, after it: short, and whole on its hover.
        await expect(revenue(grid)).not.toHaveText(all ?? "");
        const narrowed = await revenue(grid).textContent();
        expect(narrowed).toBe("38.4k");
        await expect(rail.locator("[data-slice-clause]")).toHaveCount(1);
        await page.keyboard.press("Escape");
        await expect(written(rail)).toHaveText("Region: SA");
        await expect(written(rail)).toHaveAttribute("title", "region is SA");
        // After its dataset's name, said once: before the chip, on its line, in the caption type.
        const named = await rail.evaluate((el) => {
            const names = el.querySelectorAll("[data-slice-chip-group]");
            const name = names[0]!.getBoundingClientRect();
            const chip = el.querySelector("[data-slice-clause]")!.getBoundingClientRect();
            const look = getComputedStyle(names[0]!);
            return {
                names: [...names].map((held) => held.textContent), before: name.right <= chip.left,
                line: Math.abs((name.top + name.bottom) / 2 - (chip.top + chip.bottom) / 2) <= 0.5, type: [look.textTransform, look.fontWeight],
            };
        });
        expect(named).toEqual({ names: ["Orders"], before: true, line: true, type: ["uppercase", "600"] });
        // Its ×: the filter out — the starting filter's chip its only one again — the tiles as they were.
        await written(rail).locator("[data-chip-remove]").click();
        await expect(rail.locator("[data-slice-clause]")).toHaveCount(1);
        await expect(revenue(grid)).toHaveText(all ?? "");
    });

    test("F8: in place the rows keep their columns at every level — head word and joiners on one edge; slots, the foot's add and a group's box on another; each × at its line's end — and with a field's list open the list is the one thing that scrolls", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const grid = await openVisuals(page, "light");
        const rail = grid.locator("xpath=..").locator("[data-studio-filters]");
        await railOnTop(page, rail);
        await rail.locator("[data-slice-add=filter]").click();
        const rows = page.locator("[data-studio-filter-rows]");
        const chooser = rows.locator("[data-chooser]");
        /** Closes the open field's list, where one is open: the list takes the Esc, and the popover stays. */
        const closeList = async () => {
            if (await chooser.count() === 0) return;
            await page.keyboard.press("Escape");
            await expect(chooser).toHaveCount(0);
        };
        // A condition, a second still to be written, and a group of two.
        await chooser.locator("[role=option]", { hasText: "region" }).first().click();
        await expect(chooser.locator("[role=option]", { hasText: "SA" })).toBeVisible({ timeout: 20_000 });
        await chooser.locator("[role=option]", { hasText: "SA" }).first().click();
        await expect(chooser).toHaveCount(0);
        // A lone condition, as the query builder's step draws one: its first slot's box on the rows' own edge — nothing
        // reaching past it into the popover's padding — and its foot's add on that edge; its × at its line's end.
        const lone = await rows.locator("[data-condition-rows]").evaluate((root) => {
            const left = (el: Element | null) => (el === null ? null : Math.round(el.getBoundingClientRect().left * 2) / 2);
            const row = root.querySelector(":scope > [data-query-line=row]")!;
            const slot = left(row.querySelector("[data-slot-key]"));
            return {
                edge: slot === left(root), add: slot === left(root.querySelector(":scope > [data-query-line=foot] button svg")),
                end: Math.round(row.querySelector(":scope > button:last-child")!.getBoundingClientRect().right * 2) / 2 === Math.round(root.getBoundingClientRect().right * 2) / 2,
            };
        });
        expect(lone).toEqual({ edge: true, add: true, end: true });
        const top = rows.locator("[data-condition-rows] > [data-query-line=foot]");
        await top.getByRole("button", { name: "Add condition" }).click();
        await closeList();
        // A group is added with its two conditions.
        await top.getByRole("button", { name: "Add group" }).click();
        await closeList();
        await expect(rows.locator("[data-query-group-box] > [data-query-line=row]")).toHaveCount(2);
        await settled(page);
        /** Each level's columns: its head's first slot and its joiners; its rows' first slots' boxes, its foot's add and a group's box; its ×s' ends. */
        const columns = () => rows.locator("[data-condition-rows]").evaluate((root) => {
            const at = (n: number) => Math.round(n * 2) / 2;
            const slot = (line: Element | null) => line?.querySelector("[data-slot-key]") ?? null;
            const level = (box: Element, head: Element | null) => {
                const lines = [...box.children];
                const of = (kind: string) => lines.filter((line) => line.matches(`[data-query-line=${kind}]`));
                const joiners = [...of("row"), ...of("group")].map((line) => line.querySelector(":scope > [data-query-joiner]"))
                    .filter((joiner): joiner is Element => joiner !== null && joiner.textContent !== "");
                const add = of("foot")[0]?.querySelector("button svg") ?? null;
                return {
                    words: [slot(head), ...joiners].map((el) => (el === null ? null : at(el.getBoundingClientRect().left))),
                    slots: [...of("row").map(slot), add, ...of("group").map((g) => g.querySelector("[data-query-group-box]"))]
                        .map((el) => (el === null ? null : at(el.getBoundingClientRect().left))),
                    ends: [head?.querySelector(":scope > button:last-child") ?? null, ...of("row").map((row) => row.querySelector(":scope > button:last-child"))]
                        .filter((el): el is Element => el !== null).map((el) => at(el.getBoundingClientRect().right)),
                };
            };
            const group = root.querySelector("[data-query-group-box]")!;
            return {
                top: { ...level(root, root.querySelector(":scope > [data-query-line=head]")), edge: at(root.getBoundingClientRect().right) },
                group: level(group, group.querySelector(":scope > [data-query-group-head]")),
            };
        });
        const read = await columns();
        /** One edge: every value the same. */
        const one = (xs: readonly (number | null)[]) => xs.every((x) => x !== null && x === xs[0]);
        expect({
            topWords: one(read.top.words), topSlots: one(read.top.slots), topEnds: read.top.ends.every((x) => x === read.top.edge),
            groupWords: one(read.group.words), groupSlots: one(read.group.slots), groupEnds: one(read.group.ends),
        }, JSON.stringify(read)).toEqual({ topWords: true, topSlots: true, topEnds: true, groupWords: true, groupSlots: true, groupEnds: true });
        // A field's list open under rows this tall: the list is the one thing that scrolls — the popover's body fits.
        await rows.locator("[data-condition-rows] > [data-query-line=row] [data-slot-key][data-empty]").first().click();
        await expect(chooser).toBeVisible();
        await settled(page);
        const scrollers = await rows.evaluate((el) => [...el.closest("[data-scope='popover'][data-part='content']")!.querySelectorAll("*")]
            .filter((node) => {
                const look = getComputedStyle(node);
                return (look.overflowY === "auto" || look.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 1;
            }).map((node) => node.getAttribute("role") ?? node.tagName.toLowerCase()));
        expect(scrollers).toEqual(["listbox"]);
        expect(await chooser.locator("[role=option]").count()).toBeGreaterThan(3);
    });

    test("F9: a chip says its filter short and whole on hover; while its popover is open an edit moves neither the chip, its popover nor + FILTER — a press held on + FILTER's edge opens its editor — and shut, the chip says the edit", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const grid = await openVisuals(page, "light");
        const rail = grid.locator("xpath=..").locator("[data-studio-filters]");
        const rows = page.locator("[data-studio-filter-rows]");
        const chooser = rows.locator("[data-chooser]");
        /** Finishes a condition whose field's list is open: a field, then one of its source's values. */
        const pick = async (field: string, value: string) => {
            await chooser.locator("[role=option]", { hasText: field }).first().click();
            await expect(chooser.locator("[role=option]", { hasText: value }).first()).toBeVisible({ timeout: 20_000 });
            await chooser.locator("[role=option]", { hasText: value }).first().click();
            await expect(chooser).toHaveCount(0);
        };
        await railOnTop(page, rail);
        await rail.locator("[data-slice-add=filter]").click();
        await pick("region", "SA");
        await page.keyboard.press("Escape");
        const chip = written(rail);
        await expect(chip).toHaveText("Region: SA");
        await expect(chip).toHaveAttribute("title", "region is SA");

        // Its popover open, a second condition added there: the page takes it at once, the row as it stood.
        await chip.click();
        await expect(rows).toBeVisible();
        await settled(page);
        /** Where the chip, its popover and `+ FILTER` stand, to the half pixel: the chip written, after the starting filter's. */
        const where = () => page.evaluate(() => {
            const at = (el: Element | null) => {
                const box = el!.getBoundingClientRect();
                return [box.left, box.top, box.width].map((n) => Math.round(n * 2) / 2);
            };
            const filters = document.querySelector("[data-studio-filters]")!;
            return {
                chip: at(filters.querySelectorAll("[data-slice-clause]")[1] ?? null),
                add: at(filters.querySelector("[data-slice-add=filter]")),
                popover: at(document.querySelector("[data-scope='popover'][data-part='content'][data-state='open']")).slice(0, 2),
            };
        });
        const before = await where();
        await rows.locator("[data-condition-rows] > [data-query-line=foot]").getByRole("button", { name: "Add condition" }).click();
        await pick("category", "Tools");
        await settled(page);
        expect(await where()).toEqual(before);
        await expect(chip).toHaveText("Region: SA");

        // A press held on + FILTER's left edge: the chip's popover shuts under it, and its click opens the new filter's editor.
        await rail.locator("[data-slice-add=filter]").click({ position: { x: 2, y: 14 }, delay: 150 });
        await expect(page.getByRole("dialog").filter({ hasText: "Add filter" })).toBeVisible();
        await expect(chip).toHaveText("Region: SA");
        // It opens on its field's list, which takes the first Esc; the second shuts it.
        await expect(chooser).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(chooser).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        // Shut: the chip says its first condition and how many more, and whole on its hover.
        await expect(chip).toHaveText("Region: SA +1");
        await expect(chip).toHaveAttribute("title", "region is SA and category is Tools");
    });

    test("F5: the builder's toolbar holds no filter rail — its canvas is the page as designed — and its Preview is the page as a reader sees it: the rail a 28px row over its grid, 12 above it, with no border, its + FILTER chip after its icon", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const builder = await openBuilder(page);
        const preview = builder.locator("[data-studio-preview]");
        await expect(preview).toBeVisible({ timeout: 30_000 });
        await settled(page);
        // The toolbar — its Preview's row — holds no filter rail.
        const toolbar = builder.locator("[data-builder-frame] > [data-frame-slot=toolbar]").first();
        await expect(toolbar.locator("[data-studio-preview]")).toBeVisible();
        await expect(toolbar.locator("[data-slice-rail='studio-filters']")).toHaveCount(0);
        await preview.click();
        const rail = builder.locator("[data-studio-publish] [data-publish-frame] [data-studio-filters]");
        await expect(rail.locator("[data-slice-add=filter]")).toBeVisible({ timeout: 30_000 });
        await settled(page);
        expect(await railAtRest(rail)).toEqual(AT_REST);
    });
    test("F6: as the page narrows the rail folds its chips one at a time into +N more, 28px and never wider than its page; +N more lists every filter, and its Clear all takes them out", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const grid = await openVisuals(page, "light");
        const rail = grid.locator("xpath=..").locator("[data-studio-filters]");
        /** Adds a filter through the rail: a field, then one of its source's values. */
        const add = async (field: string, value: string) => {
            await rail.locator("[data-slice-add=filter]").click();
            const rows = page.locator("[data-studio-filter-rows]");
            await expect(rows).toBeVisible();
            // It opens on its field's list.
            const chooser = rows.locator("[data-chooser]");
            await chooser.locator("[role=option]", { hasText: field }).first().click();
            await expect(chooser.locator("[role=option]", { hasText: value }).first()).toBeVisible({ timeout: 20_000 });
            await chooser.locator("[role=option]", { hasText: value }).first().click();
            await page.keyboard.press("Escape");
            await settled(page);
        };
        // Three, after the page's starting filter: four in all.
        await add("region", "SA");
        await add("category", "Tools");
        await add("customer", "Northwind");
        /** The rail as drawn: its width, its chips, how many `+N more` counts, and whether anything runs past it. */
        const read = () => rail.evaluate((el) => {
            const more = el.querySelector("[data-slice-more]")?.textContent ?? "";
            return {
                width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
                chips: el.querySelectorAll("[data-slice-clause]").length, folded: Number(/\d+/.exec(more)?.[0] ?? 0),
                add: el.querySelector("[data-slice-add=filter]") !== null,
                fits: el.scrollWidth <= el.clientWidth && document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            };
        });
        const drawn: Awaited<ReturnType<typeof read>>[] = [];
        for (const width of [1440, 900, 480, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await settled(page);
            // The toolbar chooses its form by its measured room: read it once it has.
            await expect.poll(async () => { const now = await read(); return now.chips + now.folded; }).toBe(4);
            const now = await read();
            expect([now.height, now.add, now.fits], `at ${width}px`).toEqual([28, true, true]);
            drawn.push(now);
        }
        // The wider the rail, the more chips it shows — at a phone's fewer than at its widest — the rest counted at every width.
        const byWidth = [...drawn].sort((a, b) => a.width - b.width);
        expect(byWidth.every((now, at) => at === 0 || now.chips >= byWidth[at - 1]!.chips)).toBe(true);
        const [narrowest, widest] = [byWidth[0]!, byWidth[byWidth.length - 1]!];
        expect([narrowest.chips < widest.chips, widest.chips + widest.folded, narrowest.chips + narrowest.folded]).toEqual([true, 4, 4]);

        // +N more: one popover that lists every filter, and clears them.
        await rail.locator("[data-slice-more]").click();
        const popover = page.getByRole("dialog").filter({ hasText: "4 active filters" });
        await expect(popover).toBeVisible();
        for (const words of ["ordered at is on or after 2026-07-01", "region is SA", "category is Tools", "customer is Northwind"]) await expect(popover).toContainText(words);
        await popover.getByRole("button", { name: "Clear all" }).click();
        await expect.poll(async () => { const now = await read(); return [now.chips, now.folded]; }).toEqual([0, 0]);
    });

    test("F7: on a phone the builder's toolbar holds no Filters button; its Preview's page, on Mobile, draws the rail over its grid as a reader's page does — measured as F1 measures it, inside the builder — and the editor it opens stands inside the screen", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const builder = await openBuilder(page);
        const bar = builder.locator("[data-studio-phone-bar]");
        await expect(bar).toBeVisible({ timeout: 30_000 });
        await settled(page);
        // The toolbar — the phone's bar is its row — holds no filter rail.
        const toolbar = builder.locator("[data-builder-frame] > [data-frame-slot=toolbar]").first();
        await expect(toolbar.locator("[data-studio-phone-bar]")).toBeVisible();
        await expect(toolbar.locator("[data-slice-rail='studio-filters']")).toHaveCount(0);
        await bar.locator("[data-studio-preview]").click();
        const rail = builder.locator("[data-publish-phone] [data-publish-frame=mobile] [data-studio-filters]");
        await expect(rail.locator("[data-slice-add=filter]")).toBeVisible({ timeout: 30_000 });
        await settled(page);
        expect(await railAtRest(rail)).toEqual(AT_REST);
        const drawn = await rail.evaluate((el) => {
            const box = el.getBoundingClientRect();
            const frame = el.closest("[data-studio-builder]")!.getBoundingClientRect();
            return { inside: box.left >= frame.left && box.right <= frame.right, fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
        });
        expect(drawn).toEqual({ inside: true, fits: true });
        // + FILTER opens its editor there, inside the screen.
        await rail.locator("[data-slice-add=filter]").click();
        const rows = page.locator("[data-studio-filter-rows]");
        await expect(rows).toBeVisible();
        await settled(page);
        const editor = await rows.evaluate((el) => {
            const box = el.closest("[data-scope='popover'][data-part='content']")!.getBoundingClientRect();
            return { inside: box.left >= 0 && box.right <= document.documentElement.clientWidth, fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
        });
        expect(editor).toEqual({ inside: true, fits: true });
    });

    test("F10: the page's starting filters stand on a rail of their own in the builder canvas's band — captioned, a 28px row with no border, each dataset's chips after its name — and the canvas narrows by them; at every width the band holds them and nothing scrolls sideways (#1673)", async ({ page }) => {
        // A page of its own: the record this test writes goes with it.
        await installE3Faults(page);
        await page.setViewportSize({ width: 1440, height: 1100 });
        const builder = await openBuilder(page);
        const band = builder.locator("[data-snap-grid-head]");
        const rail = band.locator("[data-studio-starting-filters]");
        // The page's visuals read the sales: the rail stands, its + FILTER chip alone, and the top regions list every region.
        await expect(rail.locator("[data-slice-add=filter]")).toBeVisible({ timeout: 30_000 });
        const regions = builder.locator('[data-snap-grid-tile="s-top"] [data-studio-list-row]');
        await expect(regions).toHaveCount(3, { timeout: 60_000 });
        // Its readers started on the North: the chip, and the canvas narrowed to the North alone.
        await writeStartingFilter(page, `.region == "North"`);
        await expect(rail.locator("[data-slice-clause]")).toHaveText("Region: North", { timeout: 30_000 });
        await expect(regions).toHaveCount(1, { timeout: 60_000 });
        await settled(page);
        const measured = await band.evaluate((el) => {
            const box = (node: Element) => node.getBoundingClientRect();
            const mid = (r: DOMRect) => (r.top + r.bottom) / 2;
            const starting = el.querySelector("[data-studio-starting-filters]")!;
            const caption = starting.querySelector("[data-studio-starting-caption]")!;
            const row = starting.querySelector("[data-slice-rail='studio-filters']")!;
            const name = starting.querySelector("[data-slice-chip-group]")!;
            const chip = starting.querySelector("[data-slice-clause]")!;
            const look = getComputedStyle(row);
            return {
                order: [...el.parentElement!.children].map((child) => (child.hasAttribute("data-snap-grid-selection") ? "selection"
                    : child === el ? "band" : child.querySelector("[data-snap-grid-canvas]") !== null ? "grid" : "?")),
                caption: [caption.textContent, box(caption).right <= box(row).left, Math.abs(mid(box(caption)) - mid(box(chip))) <= 0.5],
                row: [box(row).height, [look.borderTopWidth, look.borderBottomWidth, look.borderLeftWidth, look.borderRightWidth]],
                named: [name.textContent, box(name).right <= box(chip).left],
                inside: box(starting).left >= box(el).left && box(starting).right <= box(el).right,
            };
        });
        expect(measured).toEqual({
            order: ["selection", "band", "grid"],
            caption: ["Starting filters", true, true],
            row: [28, ["0px", "0px", "0px", "0px"]],
            named: ["Sales", true],
            inside: true,
        });
        for (const width of [1440, 1024, 900, 480, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await settled(page);
            const held = await builder.evaluate((root) => {
                const holder = root.querySelector("[data-snap-grid-head]");
                const starting = holder?.querySelector("[data-studio-starting-filters]");
                if (holder === null || holder === undefined || starting === null || starting === undefined) return "no rail";
                const b = holder.getBoundingClientRect();
                const s = starting.getBoundingClientRect();
                const sideways = document.documentElement.scrollWidth > document.documentElement.clientWidth;
                return s.left >= b.left - 0.5 && s.right <= b.right + 0.5 && !sideways ? "held" : JSON.stringify({ band: [b.left, b.right], rail: [s.left, s.right], sideways });
            });
            expect(held, `at ${width}px`).toBe("held");
        }
    });

    test("F11: over the page's two datasets a new filter's editor is Add filter, a choice of them heading it — the surface's order, the first picked, each the shared choice chip at its own height, on the rows' edge — and the rows start again over the one picked; the filter is that dataset's, its chip after its name, and its visuals alone narrow (#1673)", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        const builder = await openBuilder(page);
        const rail = builder.locator("[data-snap-grid-head] [data-studio-starting-filters]");
        await expect(rail.locator("[data-slice-add=filter]")).toBeVisible({ timeout: 30_000 });
        // The visuals over both datasets drawn: the regions' list over the sales, the items returned over the returns.
        const regions = builder.locator('[data-snap-grid-tile="s-top"] [data-studio-list-row]');
        const returned = builder.locator('[data-snap-grid-tile="s-returned"] [data-studio-kpi-value]');
        await expect(regions).toHaveCount(3, { timeout: 60_000 });
        await expect(returned).toHaveText("218", { timeout: 60_000 });
        await railOnTop(page, rail);
        await rail.locator("[data-slice-add=filter]").click();
        const choice = page.locator("[data-studio-filter-source]");
        const chooser = page.locator("[data-studio-filter-rows] [data-chooser]");
        await expect(choice).toBeVisible();
        await expect(chooser).toBeVisible();
        await settled(page);
        /**
         * The editor as drawn: its head's words; the choice's chips, each its name, whether it is picked and its height;
         * whether the picked one's fill is not the others'; whether the choice stands between the head and the rows, on
         * the rows' edge; and how many fields the rows offer.
         */
        const editor = () => choice.evaluate((el) => {
            const content = el.closest("[data-scope='popover'][data-part='content']")!;
            const head = content.querySelector("button[aria-label='Close']")!.parentElement!;
            const rows = content.querySelector("[data-studio-filter-rows]")!.getBoundingClientRect();
            const box = el.getBoundingClientRect();
            const chips = [...el.querySelectorAll("button")];
            const fills = chips.map((chip) => [chip.getAttribute("aria-pressed"), getComputedStyle(chip).backgroundColor]);
            return {
                head: head.querySelector("span")!.textContent,
                chips: chips.map((chip) => [chip.textContent!.trim(), chip.getAttribute("aria-pressed"), chip.getBoundingClientRect().height]),
                picked: fills.filter(([pressed]) => pressed === "true").every(([, fill]) => fills.every(([other, its]) => other === "true" || its !== fill)),
                between: box.top >= head.getBoundingClientRect().bottom && box.bottom <= rows.top,
                edge: Math.abs(box.left - rows.left) <= 0.5,
                fields: content.querySelectorAll("[data-chooser] [role=option]").length,
            };
        });
        // The sales first, as the surface lists them, and picked: the rows over their three fields. Each chip the shared
        // choice chip at its own height, as Slice's editors draw their choices — its 11.5px mono line, 4px of padding and its
        // edge; only a toolbar row stands a chip 28px tall (the chip recipe).
        expect(await editor()).toEqual({
            head: "Add filter", chips: [["Sales", "true", 21.5], ["Returns", "false", 21.5]], picked: true, between: true, edge: true, fields: 3,
        });
        // The returns picked: the rows start again over their five fields.
        await choice.getByRole("button", { name: "Returns" }).click();
        await expect(chooser.locator("[role=option]")).toHaveCount(5);
        await settled(page);
        expect(await editor()).toEqual({
            head: "Add filter", chips: [["Sales", "false", 21.5], ["Returns", "true", 21.5]], picked: true, between: true, edge: true, fields: 5,
        });
        await chooser.locator("[role=option]", { hasText: "reason" }).first().click();
        await expect(chooser.locator("[role=option]", { hasText: "Damaged" }).first()).toBeVisible({ timeout: 20_000 });
        await chooser.locator("[role=option]", { hasText: "Damaged" }).first().click();
        await expect(chooser).toHaveCount(0);
        await page.keyboard.press("Escape");
        // The returns' filter: its chip after their name, said once; their visuals narrow to the damaged, the sales' do not.
        await expect(rail.locator("[data-slice-clause]")).toHaveText("Reason: Damaged");
        await expect(rail.locator("[data-slice-chip-group]")).toHaveText(["Returns"]);
        await expect(returned).toHaveText("87", { timeout: 60_000 });
        await expect(builder.locator('[data-snap-grid-tile="s-reasons"] rect.visx-bar')).toHaveCount(1);
        await expect(regions).toHaveCount(3);
    });
});
