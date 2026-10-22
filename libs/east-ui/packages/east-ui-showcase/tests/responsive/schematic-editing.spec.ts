/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Schematic's drags in a real browser (#1388, `Schematic Builder Spec.md`
 * §7, SC8, SC9), on the data centre floor in a page 1600px wide, where the
 * example's own box draws every rack as its card — below 480px of main the
 * canvas takes no drag (#1394). By the mouse and by touch — Chromium's own
 * touch input, through its DevTools protocol, as a touchscreen delivers it:
 *
 * - **Move**: a rack's card follows the pointer while the drag is under way;
 *   Esc mid-drag puts it back, nothing waiting on Save, and let go it stays
 *   where it is, one change waiting on Save.
 * - **Connect**: a drag from a rack onto the meet-me room's frame draws its
 *   draft and records a run, one more link drawn; onto a power distribution
 *   unit, which a fibre run ends at none of, the unit rings danger and the
 *   draft says why in the shared drag caption, in the danger ink, and letting
 *   go there records nothing.
 *
 * Every wait is a poll on the page's state, never a fixed pause.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-editing --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

const DATA_CENTRE = "e3/schematic/schematic/schematicDataCentre";

/**
 * Open the data centre at rest and return its root: in a page 1600px wide, whose column gives the example's own box
 * room for every rack to draw as its card, each where nothing of the page lies over it.
 */
async function openDataCentre(page: Page): Promise<Locator> {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/?theme=light#${DATA_CENTRE}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${DATA_CENTRE}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const root = entry.locator("[data-schematic]").first();
    await expect(root.locator("[data-builder-frame]")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
    await settled(page);
    // Each card a drag starts or ends on, the page's topmost element at its centre: a press there is the card's.
    for (const [kind, key] of [["racks", "A03"], ["racks", "A05"], ["pdus", "PDU-B"], ["network", "MMR-1"]] as const) {
        await expect.poll(() => card(root, kind, key).evaluate((el) => {
            const r = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        }), { message: `${key}'s card at its centre` }).toBe(true);
    }
    return root;
}

/** An item's card, by its kind and key. */
const card = (root: Locator, kind: string, key: string) => root.locator(`[data-card-key=${JSON.stringify(`(kind=${JSON.stringify(kind)}, key=${JSON.stringify(key)})`)}]`);

/** A locator's centre, in client px. */
async function centre(locator: Locator): Promise<{ x: number; y: number }> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error("not laid out");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Picks a tool from the toolbar. */
async function tool(root: Locator, name: string): Promise<void> {
    await root.locator("[data-frame-slot='toolbar']").getByRole("radio", { name }).click();
    await expect(root.locator("[data-schematic-canvas]")).toHaveAttribute("data-tool", name.toLowerCase());
}

/** A footer line, by its attribute. */
const footer = (root: Locator, attribute: string) => root.locator(`[data-schematic-footer] [${attribute}]`);

/** A drag by touch, as Chromium's touchscreen delivers it: touch events, and the pointer events it derives from them. */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, during?: () => Promise<void>): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }) =>
        cdp.send("Input.dispatchTouchEvent", { type, touchPoints: at === undefined ? [] : [{ x: at.x, y: at.y }] });
    await touch("touchStart", from);
    for (let i = 1; i <= 8; i++) await touch("touchMove", { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 });
    await during?.();
    await touch("touchEnd");
    await cdp.detach();
}

test.describe("The Schematic's drags (#1388)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "a drag needs 480px of main: the desktop project");

    test("Move by the mouse: a rack's card follows the pointer and stays where it is let go, one change waiting on Save; Esc mid-drag puts it back (SC8)", async ({ page }) => {
        const root = await openDataCentre(page);
        await tool(root, "Move");
        const a03 = card(root, "racks", "A03");
        const from = await centre(a03);
        // Down 90 px, into the clear floor below the racks' row — and Esc mid-drag: the card goes back, nothing waiting on Save.
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x, from.y + 90, { steps: 8 });
        await expect.poll(async () => Math.round((await centre(a03)).y - from.y)).toBe(90);
        await page.keyboard.press("Escape");
        await expect.poll(async () => Math.round((await centre(a03)).y - from.y)).toBe(0);
        await page.mouse.up();
        await expect(footer(root, "data-schematic-pending")).toHaveCount(0);
        // Again, let go: the card followed the pointer while the drag was under way, and stays where it was let go.
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x, from.y + 90, { steps: 8 });
        await expect.poll(async () => Math.round((await centre(a03)).y - from.y)).toBe(90);
        await page.mouse.up();
        await expect(footer(root, "data-schematic-pending")).toHaveText("1 pending");
        expect(Math.round((await centre(a03)).y - from.y)).toBe(90);
    });

    test("Move by touch: a rack's card follows the touch and stays where it lifts, one change waiting on Save (SC8)", async ({ page }) => {
        const root = await openDataCentre(page);
        await tool(root, "Move");
        const a03 = card(root, "racks", "A03");
        const from = await centre(a03);
        await touchDrag(page, from, { x: from.x, y: from.y + 90 }, async () => {
            await expect.poll(async () => Math.round((await centre(a03)).y - from.y)).toBe(90);
        });
        await expect(footer(root, "data-schematic-pending")).toHaveText("1 pending");
        expect(Math.round((await centre(a03)).y - from.y)).toBe(90);
    });

    test("Connect by the mouse: a run from a rack onto the frame is recorded, one more link drawn; onto a power unit the draft says why, in the danger ink, and records nothing (SC9)", async ({ page }) => {
        const root = await openDataCentre(page);
        await tool(root, "Connect");
        const from = await centre(card(root, "racks", "A05"));
        // Onto PDU-B: a fibre run ends at none — the unit rings danger, and the draft says why in the shared caption.
        const pdu = card(root, "pdus", "PDU-B");
        const unit = await centre(pdu);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(unit.x, unit.y, { steps: 8 });
        await expect(pdu).toHaveAttribute("data-forbidden", "");
        const caption = root.locator("[data-schematic-refusal] [data-drag-caption][data-refused]");
        await expect(caption).toHaveText("Fibre run can't end at PDU-B");
        const ink = await caption.evaluate((el) => {
            const probe = document.createElement("span");
            probe.style.color = "var(--chakra-colors-fg-danger)";
            el.parentElement!.appendChild(probe);
            const want = getComputedStyle(probe).color;
            probe.remove();
            return [getComputedStyle(el).color, want];
        });
        expect(ink[0]).toBe(ink[1]);
        await page.mouse.up();
        await expect(caption).toHaveCount(0);
        await expect(footer(root, "data-schematic-pending")).toHaveCount(0);
        // Onto the meet-me room's frame: the draft snaps, and letting go records the run.
        const frame = card(root, "network", "MMR-1");
        const to = await centre(frame);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 8 });
        await expect(root.locator("[data-schematic-canvas]")).not.toHaveAttribute("data-forbidden", "");
        await page.mouse.up();
        await expect(footer(root, "data-schematic-count=\"links\"")).toHaveText("7 links");
        await expect(footer(root, "data-schematic-pending")).toHaveText("1 pending");
    });

    test("Connect by touch: a run from a rack onto the frame is recorded, one more link drawn (SC9)", async ({ page }) => {
        const root = await openDataCentre(page);
        await tool(root, "Connect");
        await touchDrag(page, await centre(card(root, "racks", "A05")), await centre(card(root, "network", "MMR-1")));
        await expect(footer(root, "data-schematic-count=\"links\"")).toHaveText("7 links");
        await expect(footer(root, "data-schematic-pending")).toHaveText("1 pending");
    });
});
