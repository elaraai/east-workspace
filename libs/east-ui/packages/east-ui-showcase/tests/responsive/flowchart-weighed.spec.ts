/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The rail's picks weighing the Flowchart's details in a real browser (#1523,
 * `Flowchart Records Spec.md` R43–R46), on the depot's two examples whose cards
 * the services the rail picks weigh — in both themes, with no screenshot:
 *
 * - **The depot** (`flowchartDepot`), nothing picked as it opens: Standard and
 *   Priority picked on the rail's Service field, Sorted's parcels their sum,
 *   9,981 + 4,303, and its bars their counts added bin by bin; every service
 *   picked drawing every card as no pick does; International picked, a returns
 *   state's weighed reads saying *no data* while its card keeps its others; and
 *   the inspector's line naming the picks.
 * - **The dimmed depot** (`flowchartDepotDimmed`), opening on International:
 *   Held's time in state International's own, the returns' states, which hold
 *   none, saying *no data*.
 *
 * Every count here is the examples' (`flowchart.examples.tsx`'s depot
 * evidence): each service's own figures, which add up to the state's own.
 *
 * Locally: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test flowchart-weighed`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { openFlowchart } from "./flowchart-page";
import { recordField } from "./record-slice";
import { settled } from "./settle";

/** The themes: the details hold colours of their own (`themes.ts`). */
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/** The rail's services, as its Service field lists them. */
const SERVICES = ["Standard", "Priority", "Economy", "International"] as const;
type Service = (typeof SERVICES)[number];

/** A frame wide enough to pin the inspector beside main. */
const WIDE = 1200;

/** Sorted's parcels by time in state, Standard's and Priority's: a count a bin, in the depot's twelve bins. */
const SORTED_STANDARD = [441, 1128, 2467, 2852, 1863, 827, 305, 98, 0, 0, 0, 0];
const SORTED_PRIORITY = [341, 701, 1230, 1141, 598, 213, 63, 16, 0, 0, 0, 0];
/** Held's international parcels by time in state. */
const HELD_INTERNATIONAL = [0, 1, 4, 14, 29, 57, 83, 86, 106, 87, 47, 25];

/**
 * The card's bars counts draw, as the Flowchart draws them: a bar a bin that
 * counts any, as tall as its count over the card's tallest, 27 at most and 1
 * at least.
 */
function barsFor(counts: readonly number[]): [number, number][] {
    const most = Math.max(...counts);
    return counts.flatMap((count, bin): [number, number][] => (count > 0 ? [[bin, Math.max(1, Math.round((27 * count) / most))]] : []));
}

/** Opens an example and waits until every drawn row's details have landed: no card draws a placeholder. */
async function openLanded(page: Page, name: string, theme: Theme): Promise<Locator> {
    const { root } = await openFlowchart(page, name, theme);
    await expect(root.locator("[data-card-bars]").first()).toBeVisible({ timeout: 20_000 });
    await landed(page, root);
    return root;
}

/** Waits until no card or label draws a placeholder. */
async function landed(page: Page, root: Locator): Promise<void> {
    await expect.poll(() => root.locator("[data-flowchart-node] [data-place], [data-flowchart-label] [data-line=placeholder]").count(),
        "every drawn row's details landed").toBe(0);
    await settled(page);
}

/** Toggles choices of a field of the rail — on where off, off where on — through whichever rung shows it, and closes its editor. */
async function toggle(page: Page, root: Locator, source: string, field: string, choices: readonly string[]): Promise<void> {
    await recordField(page, root, field, source);
    for (const choice of choices) await page.getByRole("dialog").getByRole("button", { name: new RegExp(`^${choice}\\b`) }).first().click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await settled(page);
}

/** Picks services on the rail's Service field. */
function pick(page: Page, root: Locator, services: readonly Service[]): Promise<void> {
    return toggle(page, root, "evidence", "byService", services);
}

/** A state's card. */
const card = (root: Locator, key: string): Locator => root.locator(`[data-flowchart-node="${key}"]`);

/** A figure's number on a state's card. */
const figureOf = (root: Locator, key: string, read: number): Promise<string | null> =>
    card(root, key).locator(`[data-card-read='${read}'] [data-card-value] > :first-child`).textContent();

/** The bars a state's card draws for a read: each bar's bin and its height, to the pixel. */
function barsOf(root: Locator, key: string, read: number): Promise<[number, number][]> {
    return card(root, key).locator(`[data-card-read='${read}'] [data-card-bars] [data-bin]`).evaluateAll((bars) =>
        bars.map((bar): [number, number] => [Number(bar.getAttribute("data-bin")), Math.round(bar.getBoundingClientRect().height)]));
}

/** What a read of a state's card says where it has nothing to draw: *no data*, *none*, or `null` where it draws. */
async function emptyOf(root: Locator, key: string, read: number): Promise<string | null> {
    const empty = card(root, key).locator(`[data-card-read='${read}'] [data-card-empty]`);
    return await empty.count() === 0 ? null : empty.textContent();
}

/** A tag list's tags on a state's card. */
const tagsOf = (root: Locator, key: string, read: number): Promise<string[]> =>
    card(root, key).locator(`[data-card-read='${read}'] [data-flowchart-tag]`).evaluateAll((tags) => tags.map((tag) => tag.getAttribute("data-flowchart-tag") ?? ""));

/** A list's rows on a state's card: each name and its share. */
const listOf = (root: Locator, key: string, read: number): Promise<[string, string][]> =>
    card(root, key).locator(`[data-card-read='${read}'] [data-list-row]`).evaluateAll((rows) =>
        rows.map((row): [string, string] => [row.children[0]?.textContent ?? "", row.children[2]?.textContent ?? ""]));

/** Every card's drawn details, by its key: its body as the page draws it. */
function drawnCards(root: Locator): Promise<Record<string, string>> {
    return root.evaluate((el) => Object.fromEntries([...el.querySelectorAll<HTMLElement>("[data-flowchart-node][data-details]")]
        .map((node) => [node.getAttribute("data-flowchart-node")!, node.querySelector("[data-card-body]")?.innerHTML ?? ""])));
}

test.describe("The rail's picks weigh the depot's cards (R43–R46)", () => {
    for (const theme of THEMES) {
        test(`Standard and Priority picked: Sorted's parcels their sum, its bars their counts added bin by bin; its share of each service its own (${theme}) @desktop`, async ({ page }) => {
            const root = await openLanded(page, "flowchartDepot", theme);
            // Nothing picked as it opens: Sorted's own.
            expect(await figureOf(root, "SRD", 0)).toBe("17,210");
            expect(await barsOf(root, "SRD", 5)).toEqual(barsFor([861, 2065, 4303, 4818, 3098, 1377, 516, 172, 0, 0, 0, 0]));
            await pick(page, root, ["Standard", "Priority"]);
            await expect.poll(() => figureOf(root, "SRD", 0)).toBe("14,284");
            await landed(page, root);
            expect(await barsOf(root, "SRD", 5)).toEqual(barsFor(SORTED_STANDARD.map((count, bin) => count + SORTED_PRIORITY[bin]!)));
            // Its flags: Standard's, Fragile — Priority's parcels carry none. Its equipment and its Service list, which the
            // entries lack, its own.
            expect(await tagsOf(root, "SRD", 2)).toEqual(["Fragile"]);
            expect(await tagsOf(root, "SRD", 3)).toEqual(["Conveyor"]);
            expect(await listOf(root, "SRD", 6)).toEqual([["Standard", "58%"], ["Priority", "25%"]]);
        });

        test(`every service picked: every card drawn as no pick draws it (${theme}) @desktop`, async ({ page }) => {
            const root = await openLanded(page, "flowchartDepot", theme);
            const unpicked = await drawnCards(root);
            expect(Object.keys(unpicked).length, "the parcels' flow's states draw their details").toBeGreaterThan(8);
            // Three picked first, so the picks are seen to weigh: Sorted's parcels all but International's 861.
            await pick(page, root, SERVICES.filter((service) => service !== "International"));
            await expect.poll(() => figureOf(root, "SRD", 0)).toBe("16,349");
            await pick(page, root, ["International"]);
            await landed(page, root);
            await expect.poll(() => drawnCards(root)).toEqual(unpicked);
        });

        test(`International picked: a returns state's weighed reads say no data, its card keeping its other reads (${theme}) @desktop`, async ({ page }) => {
            const root = await openLanded(page, "flowchartDepot", theme);
            // Every flow's states: the parcels' flow, the rail's opening choice, taken off.
            await toggle(page, root, "states", "flow", ["Parcels"]);
            await expect(card(root, "RCV")).toHaveCount(1);
            await pick(page, root, ["International"]);
            await expect.poll(() => emptyOf(root, "RCV", 0)).toBe("no data");
            await landed(page, root);
            for (const key of ["RCV", "INS", "RSD"]) {
                // The parcels, the flags and the time in state, which the picks weigh: the returns hold no international parcels.
                expect([await emptyOf(root, key, 0), await emptyOf(root, key, 2), await emptyOf(root, key, 5)], key).toEqual(["no data", "no data", "no data"]);
            }
            // Received keeps its equipment, its shifts and its Service list — the state's own.
            expect([await tagsOf(root, "RCV", 3), await tagsOf(root, "RCV", 4)]).toEqual([["Scanner"], ["Weekend"]]);
            expect(await listOf(root, "RCV", 6)).toEqual([["Standard", "68%"], ["Priority", "20%"]]);
            // A state of the parcels' flow draws International's own: Held's 539 of its 1,080.
            expect(await figureOf(root, "HLD", 0)).toBe("539");
            expect(await barsOf(root, "HLD", 5)).toEqual(barsFor(HELD_INTERNATIONAL));
        });

        test(`the inspector's line names the picks, with the state selected (${theme}) @desktop`, async ({ page }) => {
            const root = await openLanded(page, "flowchartDepot", theme);
            await root.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, WIDE);
            await settled(page);
            await expect(root.locator("[data-frame-slot='end']")).toHaveAttribute("data-pane-mode", "pinned");
            await card(root, "SRD").click();
            await settled(page);
            const reads = root.locator("[data-frame-slot='end'] [data-inspector-reads]");
            await expect(reads).toHaveAttribute("data-reads", "landed");
            // Nothing picked: no line.
            await expect(reads.locator("[data-read-weighed]")).toHaveCount(0);
            await pick(page, root, ["Standard", "Priority"]);
            await expect(reads.locator("[data-read-weighed]")).toHaveText("Service · Standard, Priority");
            await expect(reads).toHaveAttribute("data-reads", "landed");
        });

        test(`the dimmed depot opens on International: Held's time in state International's own, the returns' states saying no data (${theme}) @desktop`, async ({ page }) => {
            const root = await openLanded(page, "flowchartDepotDimmed", theme);
            expect(await barsOf(root, "HLD", 0)).toEqual(barsFor(HELD_INTERNATIONAL));
            // Its Service list, which the entries lack, the state's own mix.
            expect(await listOf(root, "HLD", 1)).toEqual([["International", "50%"], ["Standard", "31%"]]);
            for (const key of ["RCV", "INS", "RSD"]) expect(await emptyOf(root, key, 0), key).toBe("no data");
            expect(await listOf(root, "RCV", 1)).toEqual([["Standard", "68%"], ["Priority", "20%"]]);
        });
    }
});
