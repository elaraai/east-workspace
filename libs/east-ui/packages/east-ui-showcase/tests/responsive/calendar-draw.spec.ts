/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
/**
 * A new event drawn on a day's lane of the Calendar's time grid (12 Nov 2026),
 * by a real mouse on the real in-page e3: a press on a lane off any event,
 * dragged, draws a span under the pointer, and the press's own release makes
 * its event — drawn as a draft, Save taking it. The draw is its pointer's:
 * another pointer's lift over the lane makes nothing and ends nothing, and the
 * window losing the page mid-draw lets go of it, its release — heard after all
 * — making nothing. The lane's pointers go through the shared pointer core
 * (east-ui-components' `src/pointer/`), whose own tests walk every order its
 * events can arrive in; this holds a browser's real capture and release to it.
 */
import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { visitBuilder } from "./builder-page";
import { settled } from "./settle";

const ROUTE = "e3/calendar/calendar/calendarOperations";
const ROOT = "[data-calendar-frame]";

/**
 * A place on a day's lane to draw at: a point of the lane in view with no event at it or for an hour under it, and the
 * point an hour below — each on the lane itself, never a block, a line or a chip over it.
 *
 * @param lane - The lane
 * @returns Where a press lands and where its drag ends, in the page's px
 */
function clearRun(lane: Locator): Promise<{ x: number; from: number; to: number }> {
    return lane.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const view = el.closest("[data-calendar-time-grid]")!.getBoundingClientRect();
        const hour = box.height / 24;
        const x = box.left + box.width / 2;
        const onLane = (y: number) => document.elementFromPoint(x, y) === el;
        for (let y = Math.max(box.top, view.top) + hour; y + hour + 8 < Math.min(box.bottom, view.bottom, innerHeight); y += hour / 4) {
            const clear = [0, 0.25, 0.5, 0.75, 1].every((part) => onLane(y + part * hour));
            if (clear) return { x, from: y, to: y + hour };
        }
        throw new Error("the lane has no clear hour in view to draw on");
    });
}

/** The events the Calendar draws from a draft: those made here, still to save. */
const drafted = (frame: Locator) => frame.locator("[data-calendar-event][data-drafted]");

/** A press on the lane, dragged down its clear hour: the span being drawn shows. */
async function draw(page: Page, lane: Locator, at: { x: number; from: number; to: number }): Promise<void> {
    await page.mouse.move(at.x, at.from);
    await page.mouse.down();
    await page.mouse.move(at.x, at.to, { steps: 6 });
    await expect(lane.locator("[data-calendar-draw]")).toHaveCount(1);
}

test("a span drawn on a lane is made as its own pointer's button lifts — never as another pointer lifts over it — and the window losing the page lets go of it, making nothing @desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const entry = await visitBuilder(page, ROUTE, ROOT, "light");
    const frame = entry.locator(ROOT).first();
    await frame.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await settled(page);
    const lane = frame.locator("[data-calendar-time-grid] [data-calendar-cell]").nth(1);
    await expect(drafted(frame)).toHaveCount(0);
    const at = await clearRun(lane);

    await test.step("another pointer's lift over the lane makes nothing, and the draw goes on", async () => {
        await draw(page, lane, at);
        // A finger pressed elsewhere on the page lifts over the lane: an event of a pointer that is not the draw's.
        await lane.evaluate((el, y) => {
            el.dispatchEvent(new PointerEvent("pointerup", { pointerId: 99, pointerType: "touch", isPrimary: false, clientX: 0, clientY: y, bubbles: true }));
        }, at.to);
        await settled(page);
        await expect(drafted(frame)).toHaveCount(0);
        await expect(lane.locator("[data-calendar-draw]")).toHaveCount(1);
    });

    await test.step("the window losing the page lets go of the draw, and its release makes nothing", async () => {
        await page.evaluate(() => { window.dispatchEvent(new Event("blur")); });
        await expect(lane.locator("[data-calendar-draw]")).toHaveCount(0);
        await page.mouse.up();
        await settled(page);
        await expect(drafted(frame)).toHaveCount(0);
    });

    await test.step("drawn again, the span is made as the mouse's button lifts: one event, a draft Save takes", async () => {
        await draw(page, lane, at);
        await page.mouse.up();
        await expect(drafted(frame)).toHaveCount(1);
        await expect(lane.locator("[data-calendar-draw]")).toHaveCount(0);
        await expect(frame.locator("[data-frame-slot='toolbar']").getByRole("button", { name: "Save" })).toBeEnabled();
    });
});
