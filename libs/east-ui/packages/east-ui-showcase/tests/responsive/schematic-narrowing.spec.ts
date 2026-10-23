/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * The Schematic's narrowing (#1392, `Schematic Builder Spec.md` §10, SC17,
 * SC18) on the real in-page e3: the data centre's one rail over its racks —
 * read through their source by name, hall and owner — and its two templates
 * records. At every width, in both themes and with both pointers, the rail
 * stands in the toolbar's one row, nothing leaving it, every source's field in
 * it: live, folded to its chip, or named by its one trigger.
 *
 * Each source narrows its own places, and the rail counts each in its own words
 * (`expectSourceCounts`, #1358): the racks' owner leaves Harbour Labs' racks
 * drawn as themselves and the rest as context — `narrowed="dim"` — each faded
 * to 0.35, greyed and taking no pointer, in the recipe's styles, the rail
 * counting 2 of its 7 racks; a rack templates group the Templates tab,
 * `Templates 3 of 5`.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-narrowing`.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { toolbarFaults } from "./builder-frame";
import { expectSourceCounts, type SourceCount } from "./record-counts";
import { recordField } from "./record-slice";
import { DATA_CENTRE, card, collapseInspector, openSchematic, pane, sizeTo } from "./schematic-page";
import { settled } from "./settle";

/** The rail, in the toolbar's row. */
const RAIL = '[data-frame-slot="toolbar"] [data-slice-rail="record-slices"]';
/** The rail's fields, as `source.field`, sorted. */
const FIELDS = "fibreTemplates.system,rackTemplates.group,racks.hall,racks.name,racks.owner";
/** Each field's label, as the folded rail's one trigger names the fields it holds. */
const LABELS = ["Rack", "Hall", "Owner", "Group", "System"];

/**
 * Every source's field as the rail shows it at its width: a live chip, a folded chip (`field:source.field`), or past
 * those its one trigger, named for every field it holds.
 */
const railFields = (root: Locator) => root.locator(RAIL).first().evaluate((rail, labels) => {
    const live = [...rail.querySelectorAll("[data-record-slice-source][data-record-slice-field]")].filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => `${el.getAttribute("data-record-slice-source")}.${el.getAttribute("data-record-slice-field")}`);
    const folded = [...rail.querySelectorAll("[data-slice-fold^='field:']")].map((el) => el.getAttribute("data-slice-fold")!.slice(6));
    const trigger = rail.querySelector("button[aria-label^='Filters:']")?.getAttribute("aria-label") ?? "";
    return { fields: [...new Set([...live, ...folded])].sort().join(), named: labels.every((label) => trigger.includes(label)) };
}, LABELS);

/** The nouns the data centre counts its sources in. */
const NOUNS = { racks: "racks", rackTemplates: "rack templates", fibreTemplates: "fibre run templates" } as const;

/** A source's count: what it shows of its total, and whether a choice is in force on it. */
const counted = (source: keyof typeof NOUNS, shown: number, total: number, narrowed: boolean): [string, SourceCount] =>
    [source, { shown, total, narrowed, noun: NOUNS[source] }];

/** Opens the data centre at rest in a theme, in a page 1600px wide, its box 1440px wide and its inspector on its rail, where every rack draws as its card. */
async function open(page: Page, theme: "light" | "dark"): Promise<Locator> {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const root = await openSchematic(page, DATA_CENTRE, theme);
    await sizeTo(page, root, 1440);
    await collapseInspector(page, root);
    return root;
}

/** Picks a value of a source's field on the rail, through whichever rung shows the field, and closes its editor. */
async function choose(page: Page, root: Locator, source: string, field: string, value: RegExp): Promise<void> {
    const editor = await recordField(page, root, field, source);
    await editor.getByRole("button", { name: value }).first().click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await settled(page);
}

/** A card's look as the page computes it: its opacity, its filter and whether it takes the pointer. */
const lookOf = (el: Locator) => el.evaluate((node) => {
    const style = getComputedStyle(node);
    return { opacity: Number(style.opacity), filter: style.filter, pointer: style.pointerEvents };
});

for (const theme of ["light", "dark"] as const) {
    test(`the one rail stands at every width, nothing leaving the toolbar, every source's field in it (${theme})`, async ({ page }) => {
        const root = await open(page, theme);
        for (const width of [1440, 1024, 768, 390, 360, 294]) {
            await sizeTo(page, root, width);
            await expect.poll(() => toolbarFaults(root), { message: `${width}px` }).toEqual([]);
            await expect(root.locator(RAIL).first(), `${width}px`).toBeVisible();
            const shown = await railFields(root);
            expect(shown.named || shown.fields === FIELDS, `${width}px: ${JSON.stringify(shown)}`).toBe(true);
        }
    });

    test(`each source narrows its own places, and the rail counts each in its own words; the racks it leaves out draw as context — faded, greyed and taking no pointer (${theme})`, async ({ page }) => {
        const root = await open(page, theme);
        const expectCounts = (counts: readonly [string, SourceCount][]) => expectSourceCounts(page, root, RAIL, Object.fromEntries(counts));
        await expectCounts([counted("racks", 7, 7, false), counted("rackTemplates", 3, 3, false), counted("fibreTemplates", 2, 2, false)]);
        for (const key of ["A01", "A03"]) expect(await lookOf(card(root, "racks", key)), key).toEqual({ opacity: 1, filter: "none", pointer: "auto" });
        // The racks' owner: Harbour Labs' racks as themselves, Northwind Media's and Elmway College's as context.
        await choose(page, root, "racks", "owner", /^Harbour Labs/);
        await expectCounts([counted("racks", 2, 7, true), counted("rackTemplates", 3, 3, false), counted("fibreTemplates", 2, 2, false)]);
        await expect(card(root, "racks", "A03")).toHaveAttribute("data-context", "");
        for (const key of ["A03", "A04", "A05"]) {
            const look = await lookOf(card(root, "racks", key));
            expect(look.opacity, key).toBeCloseTo(0.35, 5);
            expect([look.filter, look.pointer], key).toEqual(["grayscale(1)", "none"]);
        }
        for (const key of ["A01", "A02"]) expect(await lookOf(card(root, "racks", key)), key).toEqual({ opacity: 1, filter: "none", pointer: "auto" });
        // A rack templates group: the Templates tab alone.
        await choose(page, root, "rackTemplates", "group", /^Half racks/);
        await expectCounts([counted("racks", 2, 7, true), counted("rackTemplates", 1, 3, true), counted("fibreTemplates", 2, 2, false)]);
        await expect(pane(root).getByRole("tab", { name: /^Templates/ })).toHaveText("Templates 3 of 5");
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
}
