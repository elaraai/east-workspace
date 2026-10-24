/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Schematic's links in the shared links look (#1403, `Schematic Builder
 * Spec.md` §4.3): the canvas paints its links and nets in the colours and the
 * caption's font its theme probe reads from the shared links part
 * (`linkRibbons`) — the elements the Plan's links layer draws, so what the page
 * computes for the one it computes for the other, and a change to the part
 * changes the Plan, the Allocation and the Schematic together. Here, in both
 * themes, what the page computes for the probe's link parts is what it computes
 * for the Plan's links: the casing's paper under a link and its head, the muted
 * ink of a link and its head, the strong ink a lit link takes and the ring round
 * its ends, a caption's knockout, and the caption's ink and font.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { openExample } from "./plan-page";
import { DATA_CENTRE } from "./schematic-page";
import { settled } from "./settle";

/** What the page computes for each part of the links' look, by the part. */
type LinkLook = Readonly<Record<string, string>>;

/** The parts compared at rest, each the element that draws it and what the page computes for it. */
const AT_REST = [
    { part: "casing", selector: "[data-plan-casing='band']", property: "stroke" },
    { part: "head's casing", selector: "[data-plan-casing='head']", property: "fill" },
    { part: "ink", selector: "[data-plan-link]:not([data-lit]) [data-plan-ribbon-band]", property: "stroke" },
    { part: "head", selector: "[data-plan-link]:not([data-lit]) [data-plan-ribbon-head]", property: "fill" },
    { part: "knockout", selector: "[data-plan-ribbon-label]:not([data-selected]) [data-plan-ribbon-knockout]", property: "fill" },
    { part: "caption", selector: "[data-plan-ribbon-caption]", property: "fill" },
    { part: "caption's family", selector: "[data-plan-ribbon-caption]", property: "fontFamily" },
    { part: "caption's size", selector: "[data-plan-ribbon-caption]", property: "fontSize" },
    { part: "caption's weight", selector: "[data-plan-ribbon-caption]", property: "fontWeight" },
] as const;

/** The parts a lit link takes: its ink, its head and the ring round its ends. */
const LIT = [
    { part: "lit ink", selector: "[data-plan-link][data-lit] [data-plan-ribbon-band]", property: "stroke" },
    { part: "lit head", selector: "[data-plan-link][data-lit] [data-plan-ribbon-head]", property: "fill" },
    { part: "ring", selector: "[data-plan-linkend]", property: "stroke" },
    { part: "ring's width", selector: "[data-plan-linkend]", property: "strokeWidth" },
] as const;

/** A part compared: the element that draws it, and what the page computes for it. */
type Part = (typeof AT_REST)[number] | (typeof LIT)[number];

/**
 * What the page computes for parts of the links' look under a root: the first element of each part's, or `missing`
 * where none stands.
 *
 * @param root - Where the parts stand: a Plan's entry, or the Schematic's probe
 * @param parts - The parts
 * @returns Each part's computed value, by the part
 */
function lookOf(root: Locator, parts: readonly Part[]): Promise<LinkLook> {
    return root.evaluate((el, of) => Object.fromEntries(of.map(({ part, selector, property }) => {
        const found = el.querySelector(selector);
        return [part, found === null ? "missing" : String(getComputedStyle(found)[property as "stroke"])];
    })), parts.map((p) => ({ ...p })));
}

/**
 * Lights one of the Plan's links: the pointer onto its line, a fifth of the way along it — clear of its caption, which
 * sits at its middle — until a link is lit.
 *
 * @param page - The page
 * @param entry - The Plan's entry, its links shown
 */
async function lightALink(page: Page, entry: Locator): Promise<void> {
    const points = await entry.evaluate((el) => [...el.querySelectorAll<SVGPathElement>("[data-plan-link] [data-plan-ribbon-band]")].flatMap((band) => {
        const ctm = band.getScreenCTM();
        if (ctm === null) return [];
        return [0.2, 0.8].map((at) => {
            const p = band.getPointAtLength(band.getTotalLength() * at);
            return { x: ctm.a * p.x + ctm.c * p.y + ctm.e, y: ctm.b * p.x + ctm.d * p.y + ctm.f };
        });
    }));
    for (const at of points) {
        await page.mouse.move(at.x, at.y);
        if (await entry.locator("[data-plan-link][data-lit]").count() > 0) return;
    }
    throw new Error("no link of the Plan's lit under the pointer");
}

/**
 * Opens the Schematic's data centre in the page as it stands — its e3 started already — by its link, as a viewer
 * follows one: its frame out from under its skeleton, its canvas drawn.
 *
 * @param page - The page
 * @returns The Schematic's root
 */
async function followToSchematic(page: Page): Promise<Locator> {
    await page.evaluate((h) => { location.hash = `#${h}`; }, DATA_CENTRE);
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${DATA_CENTRE}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const root = entry.locator("[data-schematic]").first();
    await expect(root.locator("[data-builder-frame]")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
    await expect(root.locator("[data-schematic-canvas] > canvas")).toBeVisible();
    await settled(page);
    return root;
}

test.describe("The Schematic's links in the shared look (#1403)", { tag: "@desktop" }, () => {
    for (const theme of ["light", "dark"] as const) {
        test(`the canvas's probe reads its links' colours and caption font from the parts the Plan's links draw with — the casing, the ink, the lit ink and its ring, the knockout and the caption (${theme})`, async ({ page }) => {
            const entry = await openExample(page, "planTargetState", undefined, theme);
            await entry.locator('[data-plan-control="links"]').first().click();
            await expect(entry.locator("[data-plan-link]").first()).toBeVisible();
            // Its parts at rest, then a link lit under the pointer: what a lit link takes.
            const rest = await lookOf(entry, AT_REST);
            await lightALink(page, entry);
            const plan = { ...rest, ...await lookOf(entry, LIT) };
            expect(Object.entries(plan).filter(([, value]) => value === "missing"), "every part drawn in the Plan").toEqual([]);
            const root = await followToSchematic(page);
            expect(await lookOf(root.locator("[data-schematic-probe]"), [...AT_REST, ...LIT])).toEqual(plan);
        });
    }
});
