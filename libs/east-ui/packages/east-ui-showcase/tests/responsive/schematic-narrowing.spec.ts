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
 * counting 2 of its 7 racks, and each owner's chip its own racks, the chosen
 * marked, as a faceted search counts (#1393); a rack templates group the Templates tab,
 * `Templates 3 of 5`. A field's editor opens inside the frame, its first
 * chip's at the frame's side included, never hanging past it, and inside the
 * page on a phone, whose frame it is wider than (#1393). While a new choice is
 * read, what the canvas drew stands in, kept (#1398, the loading design's
 * retained card): its grid's rules dashed, the cards' words in the third ink and
 * their edges as they were, and the canvas retained, `aria-disabled` — all of
 * it lifted in the commit that lands the choice.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-narrowing`.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { toolbarFaults } from "./builder-frame";
import { RECORD_READS, holdE3, installE3Faults, releaseE3 } from "./e3-faults";
import { expectSourceCounts, type SourceCount } from "./record-counts";
import { recordField } from "./record-slice";
import { DATA_CENTRE, card, collapseInspector, openSchematic, pane, printedRef, sizeTo } from "./schematic-page";
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

/** Each known value's chip in a field's open editor: its label, its count — none while it is read — and whether it is chosen. */
const chipCounts = (editor: Locator) => editor.evaluate((el) => [...el.querySelectorAll("button[aria-pressed]")].map((chip) => {
    const [label, count] = [...chip.children];
    return [label?.textContent ?? "", count === undefined || count.querySelector("[aria-label='Count loading']") !== null ? null : count.textContent, chip.getAttribute("aria-pressed")];
}));

/** A card's look as the page computes it: its opacity, its filter and whether it takes the pointer. */
const lookOf = (el: Locator) => el.evaluate((node) => {
    const style = getComputedStyle(node);
    return { opacity: Number(style.opacity), filter: style.filter, pointer: style.pointerEvents };
});

/**
 * The canvas as the page computes it while what it draws is kept or not (#1398): whether it is retained, the ink a card's
 * words and its edge are in — by the token the canvas's probe resolves to the same colour — and its grid's rules, solid
 * on the grid itself or dashed on a layer each way.
 */
const keptLook = (root: Locator, cardKey: string) => root.evaluate((el, key) => {
    const canvas = el.querySelector<HTMLElement>("[data-schematic-canvas]")!;
    const tokens: Record<string, string> = { fg: "fg", fgMuted: "fg.muted", borderStrong: "border.strong" };
    const tokenOf = (colour: string) => Object.entries(tokens).find(([role]) =>
        getComputedStyle(canvas.querySelector(`[data-schematic-probe] [data-role="${role}"]`)!).color === colour)?.[1] ?? colour;
    const item = canvas.querySelector<HTMLElement>(`[data-card-key=${JSON.stringify(key)}]`)!;
    const grid = canvas.querySelector<HTMLElement>("[data-schematic-grid]")!;
    const dashed = ["::before", "::after"].every((part) => getComputedStyle(grid, part).maskImage.includes("linear-gradient"));
    return {
        retained: canvas.getAttribute("aria-disabled"),
        words: tokenOf(getComputedStyle(item.querySelector("[data-card-label]")!).color),
        edge: tokenOf(getComputedStyle(item).borderTopColor),
        rules: getComputedStyle(grid).backgroundImage === "none" ? (dashed ? "dashed" : "none") : "solid",
    };
}, cardKey);

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
        // Each owner counts its own racks, the chosen marked — never what a click on it would show: all 7 with Harbour
        // Labs cleared, 4 with another added (#1393).
        const owners = await recordField(page, root, "owner", "racks");
        await expect.poll(() => chipCounts(owners)).toEqual([["Harbour Labs", "2", "true"], ["Northwind Media", "2", "false"], ["Elmway College", "2", "false"]]);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        // A rack templates group: the Templates tab alone.
        await choose(page, root, "rackTemplates", "group", /^Half racks/);
        await expectCounts([counted("racks", 2, 7, true), counted("rackTemplates", 1, 3, true), counted("fibreTemplates", 2, 2, false)]);
        await expect(pane(root).getByRole("tab", { name: /^Templates/ })).toHaveText("Templates 3 of 5");
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });

    test(`while a new choice is read, what the canvas drew stands in, kept — its grid's rules dashed, the cards' words in the third ink, their edges as they were — and retained; all of it lifted as the choice lands (#1398, ${theme}) @desktop`, async ({ page }) => {
        await installE3Faults(page);
        const root = await open(page, theme);
        const a01 = printedRef("racks", "A01");
        expect(await keptLook(root, a01)).toEqual({ retained: null, words: "fg", edge: "border.strong", rules: "solid" });
        // The racks' owner chosen, the choice's read of the racks held on its way to e3.
        const editor = await recordField(page, root, "owner", "racks");
        const held = await holdE3(page, { kinds: [...RECORD_READS], dataset: "records.schematic_racks" });
        await editor.getByRole("button", { name: /^Harbour Labs/ }).first().click();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await settled(page, { holding: true });
        await expect.poll(() => keptLook(root, a01)).toEqual({ retained: "true", words: "fg.muted", edge: "border.strong", rules: "dashed" });
        // No rack drawn as context yet: every one stands in as the last choice drew it.
        await expect(card(root, "racks", "A03")).not.toHaveAttribute("data-context", "");
        await releaseE3(page, held);
        await settled(page);
        await expect(card(root, "racks", "A03")).toHaveAttribute("data-context", "");
        expect(await keptLook(root, a01)).toEqual({ retained: null, words: "fg", edge: "border.strong", rules: "solid" });
    });
}

test("a field's editor opens inside the frame at every width it fits — the rail's first, at the frame's side, never hanging past it — and inside the page on a phone, whose frame it is wider than (#1393)", async ({ page }) => {
    const root = await open(page, "light");
    /** How far the open editor hangs past each side of the frame, and of the page. */
    const past = () => root.evaluate((el) => {
        const frame = el.querySelector("[data-builder-frame]")!.getBoundingClientRect();
        const editor = document.querySelector("[role='dialog']")!.getBoundingClientRect();
        const page = document.documentElement.clientWidth;
        return {
            frame: { left: Math.max(0, Math.round(frame.left - editor.left)), right: Math.max(0, Math.round(editor.right - frame.right)) },
            page: { left: Math.max(0, Math.round(-editor.left)), right: Math.max(0, Math.round(editor.right - page)) },
            fits: editor.width < frame.width,
        };
    });
    const close = async () => {
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
    };
    // An editor that grows as its field's section opens is placed again as it grows: each is read once placed.
    for (const width of [1440, 1024, 768]) {
        await sizeTo(page, root, width);
        await recordField(page, root, "name", "racks");
        await expect.poll(async () => (await past()).frame, { message: `${width}px: how far the editor hangs past each side of the frame` }).toEqual({ left: 0, right: 0 });
        await close();
    }
    // A phone: the frame narrower than the editor, which keeps to the page.
    await page.setViewportSize({ width: 390, height: 844 });
    await sizeTo(page, root, 294);
    await recordField(page, root, "name", "racks");
    expect((await past()).fits, "the phone's frame is narrower than the editor").toBe(false);
    await expect.poll(async () => (await past()).page, { message: "390px: how far the editor hangs past each side of the page" }).toEqual({ left: 0, right: 0 });
    await close();
});
