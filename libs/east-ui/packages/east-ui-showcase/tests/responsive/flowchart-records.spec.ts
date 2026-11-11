/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Flowchart's narrow layout over the records (#1505, `Flowchart Records
 * Spec.md` R17), on the depot's states and transitions bound editable, its
 * lanes read whole and its states' details on their cards
 * (`flowchartDepotPhone`), held by the e3 inside the page. Below 480px of main
 * nothing drags — the canvas takes no drop, shows no handle to connect, and a
 * state carried by the mouse stays where it was — and the inspector carries the
 * gestures: Find state selects a state, the inspector shows its form, a lane
 * chosen there draws the state in that lane's band, and Save, reachable with
 * the state selected, writes the move to the states' record; mounted afresh,
 * the flowchart draws the state in its new lane. On a phone 390 and 360px
 * wide, and in a 294px parent.
 *
 * Every measurement is polled until it holds, on a page at rest; nothing reads
 * a screenshot.
 *
 * Locally: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test responsive/flowchart-records`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { leaveBuilder, sizeBuilder, visitBuilder } from "./builder-page";
import { FLOWCHARTS, openFlowchart } from "./flowchart-page";
import { settled } from "./settle";
import { LAYOUT_THEMES } from "./themes";

/** The depot's flowchart in a phone's frame, its states and transitions bound editable and its details on the cards. */
const ROUTE = `${FLOWCHARTS}/flowchartDepotPhone`;

/** The builder's frame, in its example's entry. */
const FRAME = "[data-builder-frame]";

/**
 * The band a state is drawn in: the lane whose band holds its middle.
 *
 * @param root - The flowchart's root
 * @param key - The state's key
 * @returns The lane's key, or `null` while the state is not drawn
 */
function bandOf(root: Locator, key: string): Promise<string | null> {
    return root.evaluate((el, k) => {
        const node = el.querySelector(`[data-flowchart-node="${k}"]`);
        if (node === null) return null;
        const n = node.getBoundingClientRect();
        const x = n.left + n.width / 2, y = n.top + n.height / 2;
        for (const band of el.querySelectorAll("[data-flowchart-band]")) {
            const b = band.getBoundingClientRect();
            if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return band.getAttribute("data-flowchart-band");
        }
        return null;
    }, key);
}

/**
 * Carries a state's card by the mouse onto another's: pressed on its body, under
 * its head, moved there in steps onto the other's body, and let go — what a
 * move on the canvas is made of, where one is offered.
 *
 * @param page - The page
 * @param from - The card carried
 * @param onto - The card it is let go on
 */
async function carry(page: Page, from: Locator, onto: Locator): Promise<void> {
    const a = await from.boundingBox(), b = await onto.boundingBox();
    if (a === null || b === null) throw new Error("both cards are drawn");
    await page.mouse.move(a.x + a.width / 2, a.y + 60);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 10 });
    await page.mouse.up();
    await settled(page);
}

/**
 * Closes what lies over the frame — the View's popover, a pane's view — each
 * Esc taking one layer.
 *
 * @param page - The page
 * @param root - The flowchart's root
 */
async function closeLayers(page: Page, root: Locator): Promise<void> {
    const open = async () => await page.getByRole("dialog").count() + await root.locator("[data-frame-drawer][data-open]").count();
    for (let i = 0; i < 3 && await open() > 0; i++) {
        await page.keyboard.press("Escape");
        await settled(page);
    }
    expect(await open(), "nothing lies over the frame").toBe(0);
}

/**
 * R17 on the frame as it stands: nothing drags, a state carried by the mouse
 * moving nowhere; Find state selects Scanned;
 * the inspector shows its form, and the Induct lane chosen there draws it in
 * Induct's band; Save, reachable with the state selected, writes the move; and
 * the flowchart, mounted afresh, draws Scanned in Induct.
 *
 * @param page - The page
 * @param root - The flowchart's root
 */
async function findMoveAndSave(page: Page, root: Locator): Promise<void> {
    const main = root.locator(`${FRAME} [data-frame-slot='main']`);
    expect(await main.evaluate((el) => el.getBoundingClientRect().width), "main is narrow").toBeLessThan(480);
    // Below 480px of main nothing drags: the canvas takes no drop, and its states show no handle to connect.
    await expect(main.locator("[data-drag-cell]")).toHaveCount(0);
    await expect(root.locator("[data-flowchart-handle]")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect.poll(() => bandOf(root, "SCN")).toBe("intake");
    // Nor is a state moved: Scanned carried by the mouse onto Arrived, above it in Intake, stays after it, nothing to save.
    const save = root.locator("[data-slot='history']").getByRole("button", { name: "Save", exact: true });
    const arrived = root.locator("[data-flowchart-node='ARV']");
    await carry(page, root.locator("[data-flowchart-node='SCN']"), arrived);
    await expect(save).toBeDisabled();
    expect(await root.evaluate((el) => {
        const top = (key: string) => el.querySelector(`[data-flowchart-node="${key}"]`)!.getBoundingClientRect().top;
        return top("ARV") < top("SCN");
    }), "Scanned stays after Arrived").toBe(true);

    // Find state, folded to its icon in the toolbar: its search view lists the match, and the pick selects the state.
    // A touch is a tap; the page's other flowcharts keep their own boxes, so every locator starts at this one.
    const touch = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    const press = (target: Locator) => (touch ? target.tap() : target.click());
    await press(root.locator("[data-toolbar-item='seek'] [data-key-search='icon']"));
    const search = page.locator("[data-key-search-phone]");
    await search.getByRole("textbox").fill("SCN");
    const match = search.locator("[data-key-search-row]").filter({ hasText: "SCN" });
    await expect(match).toHaveCount(1);
    await press(match);
    await settled(page);
    await closeLayers(page, root);
    const scanned = root.locator("[data-flowchart-node='SCN']");
    await expect(scanned).toHaveAttribute("data-selected", "true");

    // Its form, in the inspector's view from the strip along the frame's foot.
    await root.locator("[data-pane-tab='end']").click();
    await settled(page);
    const form = root.locator("[data-flowchart-inspector='state']");
    await expect(form.locator("[data-field='label'] input")).toHaveValue("Scanned");
    const lane = form.locator("[data-field='lane']");
    await expect(lane).toContainText("Intake");
    // A lane chosen there: the state drawn in its band, one change.
    await lane.locator("[data-part='trigger']").click();
    await page.getByRole("option", { name: "Induct", exact: true }).click();
    await settled(page);
    await expect.poll(() => bandOf(root, "SCN")).toBe("induct");
    await expect(lane).toContainText("Induct");

    // Save, the state still selected: in the toolbar's second row, uncovered once the view is closed.
    await closeLayers(page, root);
    await expect(scanned).toHaveAttribute("data-selected", "true");
    await expect(save).toBeEnabled();
    // What lies over Save's middle: Save alone, or what does, by its tag and marks. Each look scrolls Save into view
    // again: the scroll shows the foot of the example above, which renders as it comes into view and, growing, moves
    // Save down.
    await expect.poll(async () => {
        await save.scrollIntoViewIfNeeded();
        return save.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (hit === null) return "nothing: out of view";
            if (el.contains(hit)) return "Save";
            const marks = [...hit.attributes].filter((a) => a.name.startsWith("data-") || a.name === "role" || a.name === "aria-label").map((a) => `${a.name}="${a.value}"`);
            return [hit.tagName.toLowerCase(), ...marks].join(" ");
        });
    }, { message: "Save is uncovered" }).toBe("Save");
    await save.click();
    await expect(save).toBeDisabled();

    // Mounted afresh over what the states' record holds: Scanned in Induct.
    await leaveBuilder(page);
    const entry = await visitBuilder(page, ROUTE, FRAME, undefined);
    await expect.poll(() => bandOf(entry.locator("[data-flowchart-root]").first(), "SCN")).toBe("induct");
}

test.describe("The Flowchart's narrow layout over the records (#1505)", () => {
    for (const theme of LAYOUT_THEMES) {
        test(`on a phone: nothing drags; Find state selects a state, the inspector shows its form, a lane chosen there draws it in that lane, and Save — reachable with the state selected — writes the move, which a remount draws (${theme})`, {
            tag: ["@mobile", "@narrow"],
        }, async ({ page }) => {
            const { root } = await openFlowchart(page, "flowchartDepotPhone", theme);
            await findMoveAndSave(page, root);
        });

        test(`in a 294px parent: nothing drags; Find state selects a state, the inspector shows its form, a lane chosen there draws it in that lane, and Save — reachable with the state selected — writes the move, which a remount draws (${theme})`, {
            tag: "@desktop",
        }, async ({ page }) => {
            await page.setViewportSize({ width: 1440, height: 900 });
            const { entry, root } = await openFlowchart(page, "flowchartDepotPhone", theme);
            await sizeBuilder(page, entry, FRAME, 294);
            expect(await entry.locator(FRAME).first().evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(294);
            await findMoveAndSave(page, root);
        });
    }
});
