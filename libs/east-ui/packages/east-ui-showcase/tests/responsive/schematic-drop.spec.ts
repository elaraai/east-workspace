/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Schematic's drag and drop in a real browser (#1390, `Schematic Builder
 * Spec.md` §7, §8, SC4, SC11–SC13), on the data centre floor in a page 1600px
 * wide, its library pinned beside main in a box wide enough for every rack to
 * draw as its card. By the mouse:
 *
 * - **A rack template** carried over Cage A's clear floor: the ghost says
 *   where it lands — the zone and the point, at the screen's resolution — and
 *   the canvas, the drop's one cell, keeps its own ground, with no frame and
 *   no badge of the shared stage; below the drawing the drop is refused, the
 *   caption red and the cursor not allowed. Dropped, a rack's card is drawn at
 *   the point the caption named, selected, one change waiting on Save (SC12).
 *   In both themes.
 * - **An owner's card** over a rack's card gives the card the brand — its
 *   paper the brand's tint, its edge the brand's solid, 2px — and the ghost
 *   names the rack; over a power unit the drop is refused and no card is
 *   marked; dropped on the rack, one change waits on Save and nothing stays
 *   marked. In both themes.
 * - **A fibre template** over a rack's card is refused — a card covers the run
 *   that starts under it — and on the run's line it names the run; dropped,
 *   one change waits on Save (SC11). **A backlog row** dropped on the floor is
 *   placed there, selected, the Backlog counting one fewer (SC4).
 *
 * On a phone, 390px and 360px wide and in a 294px parent, the library opened
 * from its rail: a tap selects an owner's card, and a tap on the selected card
 * with no rack selected is refused, the footer saying why; a rack tapped on
 * the canvas, a tap on the selected card sets the rack's owner, the card
 * staying selected, one more change waiting on Save at each width (SC13).
 *
 * Every wait is a poll on the page's state, never a fixed pause; nothing reads
 * a screenshot.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-drop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import {
    DATA_CENTRE, captionOf, card, carryTo, centred, libraryCard, named, openSchematic, openTab, pane, pickUp, printedRef, screenPoint, sizeTo,
    type Point,
} from "./schematic-page";
import { settled } from "./settle";
import { token } from "./tokens";

/**
 * The Schematic's box on a desktop: the library pinned at 272px beside main leaves it 938px, the data centre's 28 m
 * floor 33.5px a metre, where every rack draws as its card (from 30px a metre).
 */
const WIDE = 1210;

/**
 * Opens the data centre at rest in a page 1600px wide, in a box wide enough for every rack's card, centred in the
 * window, its library pinned beside main.
 */
async function openWide(page: Page, theme: "light" | "dark"): Promise<Locator> {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const root = await openSchematic(page, DATA_CENTRE, theme);
    await sizeTo(page, root, WIDE);
    await centred(page, root);
    await expect(pane(root)).toHaveAttribute("data-pane-mode", "pinned");
    await expect(card(root, "racks", "A03")).toBeVisible();
    return root;
}

/** A footer line, by its attribute. */
const footer = (root: Locator, attribute: string) => root.locator(`[data-schematic-footer] [${attribute}]`);

/** A locator's centre. */
async function centreOf(locator: Locator): Promise<Point> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error("not laid out");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The canvas — the drop's one cell — as the page draws it: its stage, its ground, the stage's frame and badge, and its cursor. */
function stageOf(root: Locator) {
    return root.locator("[data-schematic-canvas]").evaluate((el) => ({
        stage: el.hasAttribute("data-drop-invalid") ? "refused" : el.hasAttribute("data-drop-active") ? "taken" : "none",
        ground: getComputedStyle(el).backgroundColor,
        frame: getComputedStyle(el, "::before").content,
        badge: getComputedStyle(el, "::after").content,
        cursor: getComputedStyle(el).cursor,
    }));
}

/** A card's paper, edge and ring. */
const looks = (cardEl: Locator) => cardEl.evaluate((el) => {
    const s = getComputedStyle(el);
    return { paper: s.backgroundColor, edge: s.borderTopColor, ring: s.boxShadow };
});

/** The keys of the cards the canvas draws. */
const cardKeys = (root: Locator) => root.locator("[data-card-key]").evaluateAll((cards) => cards.map((c) => c.getAttribute("data-card-key")!));

/** A caption that names Cage A and a point on its floor, to the centimetre. */
const ON_CAGE_A = /^Cage A · (\d+\.\d{2}), (\d+\.\d{2}) m$/u;

test.describe("The Schematic's drag and drop (#1390)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "carried by the mouse at the desktop width; the phone's tap below");

    for (const theme of ["light", "dark"] as const) {
        test(`a rack template over Cage A's floor: the ghost says where it lands, at the screen's resolution, and the canvas keeps its own ground, no frame and no badge; below the drawing it is refused, the caption red and the cursor not allowed; dropped, a rack's card is drawn where the caption said, selected, one change waiting on Save (SC12, ${theme})`, async ({ page }) => {
            const root = await openWide(page, theme);
            const ground = await token(page, "bg-canvas");
            const before = new Set(await cardKeys(root));
            await pickUp(page, libraryCard(root, printedRef("racks", "r42")));
            // Cage A's clear floor, above its racks' row.
            const floor = await screenPoint(root, 12.0, 1.0);
            await carryTo(page, root, floor);
            await expect.poll(async () => (await captionOf(page))?.text).toMatch(ON_CAGE_A);
            const [, x, y] = ON_CAGE_A.exec((await captionOf(page))!.text)!;
            // The point it names is the pointer's, to the screen's pixel.
            const landing = await screenPoint(root, Number(x), Number(y));
            expect(Math.abs(landing.x - floor.x), "the named x, on the screen").toBeLessThanOrEqual(1);
            expect(Math.abs(landing.y - floor.y), "the named y, on the screen").toBeLessThanOrEqual(1);
            // Its own marks stand in for the shared stage's: the canvas keeps its ground, with no frame and no badge.
            expect(await stageOf(root)).toMatchObject({ stage: "taken", ground, frame: "none", badge: "none" });
            // Below the drawing, still on the canvas: refused, the caption red, the cursor not allowed — and still no stage of the shared one's.
            const bottom = (await screenPoint(root, 12.0, 14.0)).y;
            const canvas = await root.locator("[data-schematic-canvas]").boundingBox();
            const below = { x: floor.x, y: (bottom + canvas!.y + canvas!.height) / 2 };
            expect(below.y - bottom, "the canvas runs on below the drawing").toBeGreaterThan(8);
            await carryTo(page, root, below, 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "Outside the drawing", refused: true });
            expect(await stageOf(root)).toEqual({ stage: "refused", ground, frame: "none", badge: "none", cursor: "not-allowed" });
            // Back over the floor, and dropped: a rack under a key minted new, its card drawn where the caption said, selected.
            await carryTo(page, root, floor, 6);
            await expect.poll(async () => (await captionOf(page))?.text).toBe(`Cage A · ${x}, ${y} m`);
            await page.mouse.up();
            await expect(footer(root, "data-schematic-pending")).toHaveText("1 pending");
            await expect.poll(async () => (await cardKeys(root)).filter((key) => !before.has(key))).toHaveLength(1);
            const [added] = (await cardKeys(root)).filter((key) => !before.has(key));
            expect(added).toMatch(/^\(kind="racks", key="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"\)$/u);
            const drawn = root.locator(`[data-card-key=${JSON.stringify(added)}]`);
            await expect(drawn).toHaveAttribute("data-selected", "");
            const at = await centreOf(drawn);
            expect(Math.abs(at.x - landing.x), "the card's centre x").toBeLessThanOrEqual(0.5);
            expect(Math.abs(at.y - landing.y), "the card's centre y").toBeLessThanOrEqual(0.5);
            // The drag over, the ghost has gone and the canvas is no drop's cell.
            await expect.poll(() => captionOf(page)).toBeNull();
            await expect.poll(async () => (await stageOf(root)).stage).toBe("none");
        });

        test(`an owner's card over a rack's card gives the card the brand — its paper the brand's tint, its edge the brand's solid, 2px — the ghost naming the rack; over a power unit it is refused and no card is marked; dropped on the rack, one change waits on Save and nothing stays marked (${theme})`, async ({ page }) => {
            const root = await openWide(page, theme);
            await openTab(page, root, "Owners");
            const a03 = card(root, "racks", "A03");
            const plain = await looks(a03);
            const [tint, solid] = await Promise.all([token(page, "brand-tint"), token(page, "brand-solid")]);
            await pickUp(page, libraryCard(root, "elmway"));
            const onRack = await centreOf(a03);
            await carryTo(page, root, onRack);
            await expect.poll(() => captionOf(page)).toEqual({ text: "onto A03", refused: false });
            await expect(a03).toHaveAttribute("data-drop-target", "");
            // A 1px edge and a 1px ring outside it: 2px of the brand's solid round the brand's tint.
            expect(await looks(a03)).toEqual({ paper: tint, edge: solid, ring: `${solid} 0px 0px 0px 1px` });
            // Over a power unit, a kind the owner's card sets nothing of: refused, and no card marked.
            await carryTo(page, root, await centreOf(card(root, "pdus", "PDU-B")), 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "Drop onto a rack", refused: true });
            await expect(root.locator("[data-drop-target]")).toHaveCount(0);
            expect(await looks(a03)).toEqual(plain);
            // Back on the rack, and dropped: one change, nothing marked, the rack as it was drawn.
            await carryTo(page, root, onRack, 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "onto A03", refused: false });
            await page.mouse.up();
            await expect(footer(root, "data-schematic-pending")).toHaveText("1 pending");
            await expect(root.locator("[data-drop-target]")).toHaveCount(0);
            expect(await looks(a03)).toEqual(plain);
        });
    }

    test("a fibre template over a rack's card is refused — the card covers the run that starts under it — and on the run's line names the run; dropped, one change waits on Save (SC11); a backlog row dropped on the floor is placed there, selected, the Backlog counting one fewer (SC4)", async ({ page }) => {
        const root = await openWide(page, "light");
        await pickUp(page, libraryCard(root, printedRef("fibre", "oob")));
        await carryTo(page, root, await centreOf(card(root, "racks", "A03")));
        await expect.poll(() => captionOf(page)).toEqual({ text: "Drop onto a fibre run", refused: true });
        // u3 runs down from A03, then across to ODF-1: on its line, clear of every card.
        await carryTo(page, root, await screenPoint(root, 9.6, 6.0), 6);
        await expect.poll(() => captionOf(page)).toEqual({ text: "onto A03 → ODF-1", refused: false });
        await page.mouse.up();
        await expect(footer(root, "data-schematic-pending")).toHaveText("1 pending");
        // A06, which has no place: carried onto Cage A's floor above A05, and placed there.
        await openTab(page, root, "Backlog");
        await pickUp(page, libraryCard(root, printedRef("racks", "A06")));
        await carryTo(page, root, await screenPoint(root, 18.0, 1.0));
        await expect.poll(async () => (await captionOf(page))?.text).toMatch(ON_CAGE_A);
        await page.mouse.up();
        await expect(card(root, "racks", "A06")).toHaveAttribute("data-selected", "");
        await expect(pane(root).getByRole("tab", { name: named("Backlog") })).toHaveText("Backlog 1");
        await expect(footer(root, "data-schematic-pending")).toHaveText("2 pending");
    });
});

test.describe("The Schematic's drops on a phone (#1390)", () => {
    test.skip(({ isMobile }) => !isMobile, "a coarse pointer: the phone projects");

    test("on a phone 390px and 360px wide, and in a 294px parent: in the library opened from its rail a tap selects an owner's card, and a tap on the selected card with no rack selected is refused, the footer saying why; a rack tapped on the canvas, a tap on the selected card sets its owner, the card staying selected — one more change waiting on Save at each width (SC13)", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const root = await openSchematic(page, DATA_CENTRE);
        const library = async (open: boolean) => {
            await pane(root).getByRole("button", { name: open ? "Expand Library" : "Collapse Library" }).tap();
            await settled(page);
        };
        // Nothing selected: the owner's card, tapped twice, is refused in the footer's words, nothing waiting on Save.
        await centred(page, root);
        await library(true);
        await openTab(page, root, "Owners");
        await libraryCard(root, "northwind").tap();
        await expect(libraryCard(root, "northwind")).toHaveAttribute("data-placed", "");
        await libraryCard(root, "northwind").tap();
        await expect(footer(root, "data-schematic-refused")).toHaveText("Drop onto a rack");
        await expect(footer(root, "data-schematic-pending")).toHaveCount(0);
        await library(false);
        // At each width a rack, and an owner that is not its owner yet: each drop one more change.
        const steps = [
            { at: "at 390px", rack: 6.0, owner: "northwind", pending: "1 pending" },
            { at: "at 360px", rack: 9.6, owner: "harbour", pending: "2 pending" },
            { at: "in a 294px parent", rack: 13.2, owner: "elmway", pending: "3 pending" },
        ] as const;
        for (const step of steps) {
            if (step.at === "at 360px") {
                await page.setViewportSize({ width: 360, height: 740 });
                await settled(page);
            }
            if (step.at === "in a 294px parent") await sizeTo(page, root, 294);
            await centred(page, root);
            const rack = await screenPoint(root, step.rack, 2.9);
            await page.touchscreen.tap(rack.x, rack.y);
            await settled(page);
            await library(true);
            await openTab(page, root, "Owners");
            const owner = libraryCard(root, step.owner);
            if (await owner.getAttribute("data-placed") === null) {
                await owner.tap();
                await expect(owner, step.at).toHaveAttribute("data-placed", "");
            }
            await owner.tap();
            await expect(footer(root, "data-schematic-pending"), step.at).toHaveText(step.pending);
            await expect(footer(root, "data-schematic-refused"), step.at).toHaveCount(0);
            await expect(owner, step.at).toHaveAttribute("data-placed", "");
            await library(false);
        }
    });
});
