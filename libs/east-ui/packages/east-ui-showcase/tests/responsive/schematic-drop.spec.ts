/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Schematic's drag and drop in a real browser (#1390, `Schematic Builder
 * Spec.md` §7, §8, SC4, SC11–SC13), on the data centre floor in a page 1600px
 * wide, its library pinned beside main and its inspector (#1391) collapsed to
 * its rail, in a box wide enough for every rack to draw as its card — a power
 * unit, 1.2 m wide, draws as its labelled pin there (D44). By the mouse:
 *
 * - **A rack template** carried over Cage A's clear floor: the ghost says
 *   where it lands — the zone and the point, at the screen's resolution — and
 *   the canvas, the drop's one cell, keeps its own ground, with no frame and
 *   no badge of the shared stage; below the drawing the drop is refused, the
 *   caption red and the cursor not allowed. Dropped, a rack stands at the
 *   point the caption named, selected, one change waiting on Save (SC12): its
 *   name longer than the floor's racks', it draws as its pin at the floor's
 *   zoom, and as its card, centred there, once zoomed in to where the card
 *   holds its words. In both themes.
 * - **An owner's card** over a rack's card gives the card the brand — its
 *   paper the brand's tint, its edge the brand's solid, 2px — and the ghost
 *   names the rack; over a power unit's pin the drop is refused and no card is
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
 * staying selected, its change waiting on Save — the history's Discard on —
 * which Save writes, at each width (SC13).
 *
 * Every wait is a poll on the page's state, never a fixed pause; nothing reads
 * a screenshot.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-drop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import {
    DATA_CENTRE, captionOf, card, carryTo, centred, collapseInspector, discard, libraryCard, named, openSchematic, openTab, pane, pickUp, printedRef, save,
    screenPoint, sizeTo, zoomInto, type Point,
} from "./schematic-page";
import { settled } from "./settle";
import { token } from "./tokens";

/**
 * The Schematic's box on a desktop: the library pinned at 272px beside main and the inspector collapsed to its 44px
 * rail leave it 938px, the data centre's 28 m floor fitted inside Fit's 24px margins at 31.8px a metre, where every
 * rack of the floor draws as its card — its 3.2 m holding its words from 27.5px a metre (D44).
 */
const WIDE = 1254;

/** A rack under a key minted new, as East prints its reference. */
const MINTED_RACK = /^\(kind="racks", key="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"\)$/u;

/**
 * Opens the data centre at rest in a page 1600px wide, in a box wide enough for every rack's card, centred in the
 * window, its library pinned beside main and its inspector collapsed to its rail.
 */
async function openWide(page: Page, theme: "light" | "dark"): Promise<Locator> {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const root = await openSchematic(page, DATA_CENTRE, theme);
    await sizeTo(page, root, WIDE);
    await collapseInspector(page, root);
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
        test(`a rack template over Cage A's floor: the ghost says where it lands, at the screen's resolution, and the canvas keeps its own ground, no frame and no badge; below the drawing it is refused, the caption red and the cursor not allowed; dropped, a rack stands where the caption said, selected, one change waiting on Save — its card drawn there once zoomed in to hold its words (SC12, ${theme})`, async ({ page }) => {
            const root = await openWide(page, theme);
            const ground = await token(page, "bg-canvas");
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
            // Back over the floor, and dropped: a rack under a key minted new, where the caption said.
            await carryTo(page, root, floor, 6);
            await expect.poll(async () => (await captionOf(page))?.text).toBe(`Cage A · ${x}, ${y} m`);
            await page.mouse.up();
            await expect(discard(root)).toBeEnabled();
            // The drag over, the ghost has gone and the canvas is no drop's cell.
            await expect.poll(() => captionOf(page)).toBeNull();
            await expect.poll(async () => (await stageOf(root)).stage).toBe("none");
            // "New 42U rack" needs its 3.2 m at 40px a metre to hold its words: at the floor's zoom it is its pin, and no card.
            expect((await cardKeys(root)).filter((key) => MINTED_RACK.test(key))).toEqual([]);
            // Zoomed in about where it landed, it draws as its card, selected, centred where the caption said.
            await zoomInto(page, root, { minX: Number(x) - 3, minY: Number(y) - 1.5, maxX: Number(x) + 3, maxY: Number(y) + 1.5 });
            await expect.poll(async () => (await cardKeys(root)).filter((key) => MINTED_RACK.test(key))).toHaveLength(1);
            const [added] = (await cardKeys(root)).filter((key) => MINTED_RACK.test(key));
            const drawn = root.locator(`[data-card-key=${JSON.stringify(added)}]`);
            await expect(drawn).toHaveAttribute("data-selected", "");
            const [at, there] = [await centreOf(drawn), await screenPoint(root, Number(x), Number(y))];
            expect(Math.abs(at.x - there.x), "the card's centre x").toBeLessThanOrEqual(0.5);
            expect(Math.abs(at.y - there.y), "the card's centre y").toBeLessThanOrEqual(0.5);
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
            // Over a power unit — its pin at this zoom, its dot on PDU-B's centre — a kind the owner's card sets nothing of:
            // refused, and no card marked.
            await carryTo(page, root, await screenPoint(root, 18.6, 4.2), 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "Drop onto a rack", refused: true });
            await expect(root.locator("[data-drop-target]")).toHaveCount(0);
            expect(await looks(a03)).toEqual(plain);
            // Back on the rack, and dropped: one change, nothing marked, the rack as it was drawn.
            await carryTo(page, root, onRack, 6);
            await expect.poll(() => captionOf(page)).toEqual({ text: "onto A03", refused: false });
            await page.mouse.up();
            await expect(discard(root)).toBeEnabled();
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
        await expect(discard(root)).toBeEnabled();
        // A06, which has no place: carried onto Cage A's floor above A05, and placed there.
        await openTab(page, root, "Backlog");
        await pickUp(page, libraryCard(root, printedRef("racks", "A06")));
        await carryTo(page, root, await screenPoint(root, 18.0, 1.0));
        await expect.poll(async () => (await captionOf(page))?.text).toMatch(ON_CAGE_A);
        await page.mouse.up();
        await expect(card(root, "racks", "A06")).toHaveAttribute("data-selected", "");
        await expect(pane(root).getByRole("tab", { name: named("Backlog") })).toHaveText("Backlog 1");
    });
});

test.describe("The Schematic's drops on a phone (#1390)", () => {
    test.skip(({ isMobile }) => !isMobile, "a coarse pointer: the phone projects");

    test("on a phone 390px and 360px wide, and in a 294px parent: in the library opened from its rail a tap selects an owner's card, and a tap on the selected card with no rack selected is refused, the footer saying why; a rack tapped on the canvas, a tap on the selected card sets its owner, the card staying selected — its change waiting on Save, which Save writes, at each width (SC13)", async ({ page }) => {
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
        await expect(discard(root)).toBeDisabled();
        await library(false);
        // At each width a rack, and an owner that is not its owner yet: each drop a change of its own, which Save writes.
        const steps = [
            { at: "at 390px", rack: 6.0, owner: "northwind" },
            { at: "at 360px", rack: 9.6, owner: "harbour" },
            { at: "in a 294px parent", rack: 13.2, owner: "elmway" },
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
            await expect(discard(root), step.at).toBeEnabled();
            await expect(footer(root, "data-schematic-refused"), step.at).toHaveCount(0);
            await expect(owner, step.at).toHaveAttribute("data-placed", "");
            await library(false);
            await save(root).tap();
            await expect(discard(root), step.at).toBeDisabled();
        }
    });
});
