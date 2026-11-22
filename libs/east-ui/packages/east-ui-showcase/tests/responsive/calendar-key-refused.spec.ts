/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A reservation dragged onto a key another holds is refused where it is seen
 * (east-workspace#1709): on the reservations keyed by their machine and their
 * start (`calendarBuiltKeys`), the ghost's caption says which key, in the
 * danger ink — and, long as those words are, in a box no wider than 44 of its
 * characters, its words whole on as many lines as they need. It never runs a
 * frame's width across what lies beside the ghost. Released, the reservation
 * is where it was, and the Calendar says why in its own line for a gesture's
 * error, in the danger ink — the ghost and its caption gone, the reason is not.
 * A page of its own: the pointer is held down across the measurements.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test calendar-key-refused --project desktop`.
 */

import { expect, test } from "playwright/test";
import { settled } from "./settle";
import { token } from "./tokens";

const ROUTE = "e3/calendar/calendar/calendarBuiltKeys";
/** What the caption says first: the key Tool trial holds. */
const TAKEN = 'Another reservation is keyed "press1@2026-10-01T07:00:00.000" already';

test("calendarBuiltKeys: a reservation dragged onto another's key is refused in the ghost's caption — the key named in the danger ink, its words whole in a box no wider than 44 characters — and released, it is where it was, the Calendar saying why in the danger ink @desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/?theme=light#${ROUTE}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${ROUTE}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const frame = entry.locator("[data-calendar-frame]").first();
    await expect(frame).toBeVisible({ timeout: 30_000 });
    await settled(page);
    await frame.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await settled(page);
    const run = frame.locator("[data-calendar-event]").filter({ hasText: "First-article run" });
    const trial = frame.locator("[data-calendar-event]").filter({ hasText: "Tool trial" });
    const [from, to] = [(await run.boundingBox())!, (await trial.boundingBox())!];
    const key = await run.getAttribute("data-calendar-event");
    const danger = await token(page, "fg-danger");
    const said = frame.getByRole("alert");
    await expect(said).toHaveCount(0);

    // First-article run picked up by its head and carried onto Tool trial's: Press 1 at 07:00, the key Tool trial holds.
    await page.mouse.move(from.x + from.width / 2, from.y + 12);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 8, from.y + 14, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + 12, { steps: 12 });
    const caption = page.locator(".east-drag-ghost [data-drag-caption]");
    await expect(caption).toHaveAttribute("data-refused", "");
    await expect(caption).toContainText(TAKEN);
    const drawn = await caption.evaluate((el) => {
        const s = getComputedStyle(el);
        // One of its characters, in its own face: a mono face's are all one width.
        const one = document.createElement("span");
        one.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${s.font};letter-spacing:${s.letterSpacing}`;
        one.textContent = "0".repeat(44);
        document.body.append(one);
        const most = one.getBoundingClientRect().width;
        one.remove();
        const box = el.getBoundingClientRect();
        return { width: box.width, most, lines: Math.round((box.height - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)) / parseFloat(s.lineHeight)),
            cut: el.scrollWidth > el.clientWidth, ink: s.color, right: box.right, window: document.documentElement.clientWidth };
    });
    expect(drawn.width, "no wider than 44 of its characters").toBeLessThanOrEqual(drawn.most + 0.5);
    expect([drawn.lines > 1, drawn.cut, drawn.ink, drawn.right <= drawn.window]).toEqual([true, false, danger, true]);

    // Released there, nothing moved: the reservation is under the key it had, and Tool trial under its own.
    await page.mouse.up();
    await settled(page);
    await expect(frame.locator(`[data-calendar-event=${JSON.stringify(key)}]`)).toHaveCount(1);
    await expect(frame.locator("[data-calendar-event]")).toHaveCount(3);
    // The ghost and its caption are gone; the reason stays, in the Calendar's line for a gesture's error.
    await expect(page.locator(".east-drag-ghost [data-drag-caption]")).toHaveCount(0);
    await expect(said).toHaveText(TAKEN);
    expect(await said.evaluate((el) => getComputedStyle(el).color)).toBe(danger);
    // A drop the Calendar takes says nothing: the reason goes.
    const training = frame.locator("[data-calendar-event]").filter({ hasText: "Operator training" });
    const at = (await training.boundingBox())!;
    await page.mouse.move(at.x + at.width / 2, at.y + 12);
    await page.mouse.down();
    await page.mouse.move(at.x + at.width / 2, at.y + 20, { steps: 3 });
    await page.mouse.move(at.x + at.width / 2, at.y + 12 + 96, { steps: 10 });
    await page.mouse.up();
    await settled(page);
    await expect(said).toHaveCount(0);
});
