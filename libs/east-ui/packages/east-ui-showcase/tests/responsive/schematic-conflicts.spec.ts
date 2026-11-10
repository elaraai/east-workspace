/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A conflict's Go to on the Schematic in a real browser, on the real in-page
 * e3 (#1585): a rack moved sideways here, then Someone else saves, is one
 * conflict; its Go to, the conflicts popover open over the canvas — and staying
 * open, at full width — flies the camera so the rack lands beside the popover,
 * in the part of the view it leaves clear, where a flight that centred it would
 * land it under the popover. The popover says where it lies; the Schematic
 * reads none of it from the page.
 *
 * Every wait is a poll on the page's state, never a fixed pause.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-conflicts --project desktop`.
 */

import { test, expect, type Locator } from "playwright/test";
import { FILE, card, centred, collapseInspector, openSchematic, screenPoint, sizeTo } from "./schematic-page";
import { settled } from "./settle";

/** The racks you edit, and Someone else saves, which moves every one half a metre to the right. */
const CONFLICTS = `${FILE}/schematicConflicts`;

/** A box on the screen, in client px. */
interface Box {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

/** Whether two boxes share any of their area. */
const overlap = (a: Box, b: Box): boolean => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

/** An element's box on the screen. */
const boxOf = (locator: Locator): Promise<Box> => locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
});

test("a conflict's Go to lands its rack beside the conflicts popover open over the canvas, never under it, the popover where it hangs (#1585) @desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const root = await openSchematic(page, CONFLICTS);
    // A box 720px wide: the inspector folds to its rail for lack of room, and the popover, hung from the toolbar's end,
    // covers the canvas's middle.
    await sizeTo(page, root, 720);
    await centred(page, root);
    await collapseInspector(page, root);
    const canvas = root.locator("[data-schematic-canvas]");
    // B01 moved sideways — half a metre to the left, and down into the open floor below its row: its x is yours.
    await root.locator("[data-frame-slot='toolbar']").getByRole("radio", { name: "Move" }).click();
    await expect(canvas).toHaveAttribute("data-tool", "move");
    const from = await screenPoint(root, 2.4, 8.6);
    const to = await screenPoint(root, 1.9, 10.6);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await settled(page);
    // Someone else saves every rack half a metre to the right: theirs and yours differ on B01's x.
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${CONFLICTS}"]`) });
    await entry.getByRole("button", { name: "Someone else saves" }).click();
    await root.locator("[data-frame-slot='toolbar']").getByRole("button", { name: "1 conflict" }).click();
    const body = page.locator("[data-conflicts-body]");
    await expect(body.locator("[data-conflict-card]")).toHaveCount(1);
    await settled(page);
    const popover = page.locator("[data-scope='popover'][data-part='content']", { has: body });
    // Centred, the rack would land under the popover: the canvas's middle is under it.
    const [view, over] = [await boxOf(canvas), await boxOf(popover)];
    const middle = { x: (view.left + view.right) / 2, y: (view.top + view.bottom) / 2 };
    expect(middle.x > over.left && middle.x < over.right && middle.y > over.top && middle.y < over.bottom, "the canvas's middle under the popover").toBe(true);

    await body.getByRole("button", { name: "Go to" }).click();
    // The flight over: the camera still across two frames.
    await expect.poll(() => canvas.evaluate(async (el) => {
        const layer = el.querySelector<HTMLElement>("[style*='--cam-ppu']")!;
        const camera = () => ["--cam-ppu", "--cam-tx", "--cam-ty"].map((name) => layer.style.getPropertyValue(name)).join(" ");
        const before = camera();
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        return camera() === before;
    }), { message: "the camera at rest" }).toBe(true);
    await settled(page);
    // The rack, drawn as its card at the zoom the flight landed at, selected, wearing the conflict's ring.
    const rack = card(root, "racks", "B01");
    await expect(rack).toHaveAttribute("data-selected", "");
    await expect(rack).toHaveAttribute("data-conflict", "");
    // Beside the popover, open still where it hangs from its button: it had no need to hang by the frame's other side.
    expect([await body.getAttribute("data-hung"), overlap(await boxOf(rack), await boxOf(popover))], "the rack beside the popover, which stays where it hangs")
        .toEqual([null, false]);
});
