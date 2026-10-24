/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The floor of 20,000 racks edited through its windows, in a real browser
 * (#1395, `Schematic Builder Spec.md` §7, §10.4, SC23): its racks bound with
 * their patch door and read a window at a time, every edit a draft of the
 * racks' session, kept by the rack's key whatever window the view reads.
 *
 * - **By the mouse**, where the racks draw as their cards: a rack moved by
 *   Move waits as a draft while the view goes to the floor's far end, and
 *   draws where it was let go when the view comes back, its neighbour where
 *   it stood; Save writes it through the door, and the floor mounted again
 *   draws it there, read back from e3.
 * - **On a phone**, in the phone-width frame, where nothing drags: a rack
 *   found by its key and moved across the floor by Details' x and y draws
 *   where its draft places it, off the window it was read in — Find takes the
 *   view there and back — and Save writes it; mounted again, Find takes the
 *   view to it there, read back from e3 through its area index, its
 *   neighbour where it stood.
 *
 * Every wait is a poll on the page's state, never a fixed pause; nothing reads
 * a screenshot.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-records`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { leaveBuilder } from "./builder-page";
import {
    RECORD_INDEXES, RECORD_INDEXES_MOBILE, card, centred, discard, openSchematic, restsOn, save, screenPoint, zoomInto, type Point, type WorldBox,
} from "./schematic-page";
import { settled } from "./settle";

/** Hall 1's front corner, about its first rack, R100000, at 3.3, 3.6 m — the next along its row, R100001, at 4.0. */
const HALL_1_CORNER: WorldBox = { minX: 0.5, minY: 1.0, maxX: 6.1, maxY: 6.2 };
/** Hall 10's front corner, at the floor's far end: a window that holds none of Hall 1's racks. */
const HALL_10_CORNER: WorldBox = { minX: 306.5, minY: 128.5, maxX: 313.0, maxY: 133.5 };

/** What nothing on a narrow main may carry: a drag source or a drop target. */
const DRAG = "[data-draggable], [data-drag-cell]";

/** A button of the toolbar's, by its name. */
const toolbarButton = (root: Locator, name: string): Locator => root.locator("[data-frame-slot='toolbar']").getByRole("button", { name, exact: true });

/** A locator's centre on the page. */
async function centreOf(locator: Locator): Promise<Point> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error("not laid out");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** How far a rack's card's centre stands from a world point, in px. */
async function offBy(root: Locator, key: string, x: number, y: number): Promise<number> {
    const [at, there] = [await centreOf(card(root, "racks", key)), await screenPoint(root, x, y)];
    return Math.hypot(at.x - there.x, at.y - there.y);
}

/** Picks a tool from the toolbar. */
async function tool(root: Locator, name: string): Promise<void> {
    await root.locator("[data-frame-slot='toolbar']").getByRole("radio", { name }).click();
    await expect(root.locator("[data-schematic-canvas]")).toHaveAttribute("data-tool", name.toLowerCase());
}

/** From Fit into Hall 1's front corner, then in a press of Zoom in at a time until R100000 draws as its card. */
async function toHall1(page: Page, root: Locator): Promise<void> {
    await toolbarButton(root, "Fit").click();
    await settled(page);
    await zoomInto(page, root, HALL_1_CORNER);
    for (let presses = 0; await card(root, "racks", "R100000").count() === 0; presses++) {
        expect(presses, "presses of Zoom in before R100000 draws as its card").toBeLessThan(12);
        await toolbarButton(root, "Zoom in").click();
        await settled(page);
    }
}

/** A floor unmounted and mounted again, as a viewer leaving it and coming back does: what it shows read back from e3. */
async function remount(page: Page, hash: string): Promise<Locator> {
    await leaveBuilder(page);
    await page.evaluate((to) => { location.hash = `#${to}`; }, hash);
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const root = entry.locator("[data-schematic]").first();
    await expect(root.locator("[data-builder-frame]")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
    await expect(root.locator("[data-schematic-canvas] > canvas")).toBeVisible();
    await settled(page);
    return root;
}

/** The inspector's pane. */
const inspector = (root: Locator): Locator => root.locator("[data-frame-slot='end']");

/** What Details shows, in the inspector's open tab. */
const details = (root: Locator): Locator => inspector(root).locator("[role='tabpanel']:not([hidden]) [data-schematic-inspector]");

/** Opens the inspector from its rail where it is collapsed, with a tap. */
async function expandInspector(page: Page, root: Locator): Promise<void> {
    if (await inspector(root).getAttribute("data-collapsed") !== null) {
        await inspector(root).getByRole("button", { name: "Expand Inspector" }).tap();
        await expect(inspector(root)).not.toHaveAttribute("data-collapsed", "");
    }
    await settled(page);
}

/** Collapses the inspector to its rail where it is open, with a tap. */
async function collapseInspector(page: Page, root: Locator): Promise<void> {
    if (await inspector(root).getAttribute("data-collapsed") === null) {
        await inspector(root).getByRole("button", { name: "Collapse Inspector" }).tap();
        await expect(inspector(root)).toHaveAttribute("data-collapsed", "");
    }
    await settled(page);
}

/**
 * Finds a rack by its key, as a phone's viewer does: the View opened from the row, the key typed into Find's box, its line
 * tapped and the View closed — the view flown to the rack, which is selected once it draws.
 */
async function findRack(page: Page, root: Locator, key: string): Promise<void> {
    const view = root.locator("[data-toolbar-item='seek'] [data-key-search='icon']");
    await view.tap();
    const box = page.locator("[data-key-search='popover'] input");
    await expect(box).toBeVisible();
    await box.fill(key);
    await page.getByRole("option", { name: `${key} · Rack`, exact: true }).tap();
    await expect(box).toHaveValue(key);
    await page.keyboard.press("Escape");
    await expect(view).toHaveAttribute("data-state", "closed");
    await settled(page);
}

/** Types a number into a field of Details' Position a key at a time — the shared input writes back on a frame — and commits it with Enter. */
async function typePosition(root: Locator, field: "x" | "y", value: string): Promise<void> {
    const input = details(root).locator(`[data-inspector-fields='position'] [data-field='${field}'] [role=spinbutton]`);
    await input.tap();
    await input.press("ControlOrMeta+a");
    await input.press("Backspace");
    await input.pressSequentially(value, { delay: 30 });
    await input.press("Enter");
}

/** Where Details says the selected rack stands, after its kind: `x, y m`. */
const standsAt = (x: string, y: string): RegExp => new RegExp(`${x.replace(".", "\\.")}, ${y.replace(".", "\\.")} m$`, "u");

/** Opens Details on the rack a Find selected, and reads what it says: its key and where it stands. */
async function inDetails(page: Page, root: Locator, key: string, x: string, y: string): Promise<void> {
    await expandInspector(page, root);
    await expect(details(root)).toHaveAttribute("data-schematic-inspector", "item");
    await expect(details(root).locator("[data-inspector-title]")).toHaveText(key);
    await expect(details(root).locator("[data-inspector-when]")).toHaveText(standsAt(x, y));
}

test.describe("The floor edited through its windows (#1395)", () => {
    test("a rack moved by the mouse where the racks draw as their cards waits as a draft while the view goes to the floor's far end, draws where it was let go on the way back, and Save writes it — the floor mounted again drawing it there, read back from e3 (SC23) @desktop", async ({ page }) => {
        let root = await openSchematic(page, RECORD_INDEXES);
        await centred(page, root);
        await toHall1(page, root);
        expect(await offBy(root, "R100000", 3.3, 3.6), "R100000 where its row stands it").toBeLessThan(1);
        // Moved by Move into the aisle behind its row, 1.2 m back: one change waiting on Save, its card where it was let go.
        await tool(root, "Move");
        const [from, to] = [await screenPoint(root, 3.3, 3.6), await screenPoint(root, 3.3, 4.8)];
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 8 });
        await page.mouse.up();
        await expect(discard(root)).toBeEnabled();
        await expect.poll(() => offBy(root, "R100000", 3.3, 4.8), "R100000 where it was let go").toBeLessThan(1);
        expect(await offBy(root, "R100001", 4.0, 3.6), "R100001 where its row stands it").toBeLessThan(1);
        await tool(root, "Select");
        // To the floor's far end, a window that holds none of Hall 1's racks: the draft waits in its session.
        await toolbarButton(root, "Fit").click();
        await settled(page);
        await zoomInto(page, root, HALL_10_CORNER);
        await expect(discard(root)).toBeEnabled();
        // Back: R100000 where its draft has it, R100001 where it stood.
        await toHall1(page, root);
        await expect.poll(() => offBy(root, "R100000", 3.3, 4.8), "R100000 where its draft has it").toBeLessThan(1);
        expect(await offBy(root, "R100001", 4.0, 3.6), "R100001 where its row stands it").toBeLessThan(1);
        // Saved, nothing waits; mounted again, the floor draws it where it was let go, read back from e3.
        await save(root).click();
        await expect(discard(root)).toBeDisabled();
        root = await remount(page, RECORD_INDEXES);
        await centred(page, root);
        await toHall1(page, root);
        await expect.poll(() => offBy(root, "R100000", 3.3, 4.8), "R100000 where Save wrote it").toBeLessThan(1);
        expect(await offBy(root, "R100001", 4.0, 3.6), "R100001 where its row stands it").toBeLessThan(1);
        await expect(discard(root)).toBeDisabled();
    });

    test("on a phone, a rack found by its key and moved across the floor by Details' x and y draws where its draft places it, off the window it was read in — Find taking the view there and back — and Save writes it; mounted again, Find takes the view to it there, read back from e3 (SC23, SC25) @mobile", async ({ page }) => {
        let root = await openSchematic(page, RECORD_INDEXES_MOBILE);
        await centred(page, root);
        await expect(root).toHaveAttribute("data-schematic-layout", "narrow");
        await expect(root.locator(DRAG)).toHaveCount(0);
        // R100000, at Hall 1's front, moved by its x and y to Hall 10's front aisle, 300 m across the floor.
        await findRack(page, root, "R100000");
        await inDetails(page, root, "R100000", "3.30", "3.60");
        await typePosition(root, "x", "310");
        await typePosition(root, "y", "130.8");
        await expect(details(root).locator("[data-inspector-when]")).toHaveText(standsAt("310.00", "130.80"));
        await expect(discard(root)).toBeEnabled();
        await collapseInspector(page, root);
        // Its neighbour, by Find: the view at Hall 1's front, where R100000 stood, R100001 where it stands.
        await findRack(page, root, "R100001");
        await inDetails(page, root, "R100001", "4.00", "3.60");
        await collapseInspector(page, root);
        await expect(discard(root)).toBeEnabled();
        // R100000 again: Find takes the view to where its draft places it, off the window it was read in.
        await findRack(page, root, "R100000");
        await restsOn(root, { minX: 309.9, minY: 130.7, maxX: 310.1, maxY: 130.9 });
        await inDetails(page, root, "R100000", "310.00", "130.80");
        await collapseInspector(page, root);
        // Saved, nothing waits; mounted again, Find takes the view to it at Hall 10's front, read back from e3.
        await save(root).tap();
        await expect(discard(root)).toBeDisabled();
        root = await remount(page, RECORD_INDEXES_MOBILE);
        await centred(page, root);
        await findRack(page, root, "R100000");
        await restsOn(root, { minX: 309.9, minY: 130.7, maxX: 310.1, maxY: 130.9 });
        await inDetails(page, root, "R100000", "310.00", "130.80");
        await collapseInspector(page, root);
        await findRack(page, root, "R100001");
        await inDetails(page, root, "R100001", "4.00", "3.60");
        await expect(discard(root)).toBeDisabled();
    });
});
