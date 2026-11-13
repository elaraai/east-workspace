/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Autosave under a touch pointer, after a finger whose lift the page never
 * hears (12 Nov 2026), on the real in-page e3. An automatic Save waits while a
 * pointer is down, and a phone does not always say a finger ended: counted as
 * down for good, that one finger held every automatic Save back until the page
 * was left — an edit made after it sat unsaved, with Autosave on. The fingers
 * down are the shared pointer core's record (east-ui-components'
 * `src/pointer/touches.ts`), which lets go of such a finger as the next touch
 * begins: the edit made after it is saved by itself, a pause after it.
 *
 * A page of its own, never `./kept-page`'s: its clock is held, and its e3's
 * requests are listed by a script installed before it loads.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { visitBuilder } from "./builder-page";
import { e3Requests, installE3Faults } from "./e3-faults";

/** A Calendar whose author says where its Autosave begins, from the app's own setting: on. */
const AUTHORED = "e3/calendar/calendar/calendarAutosave";
const ROOT = "[data-builder-frame]";
/** The moment the page's clock is held at. */
const HELD = new Date("2026-11-10T09:00:00Z").getTime();
/** The automatic Save's pause, and a little more. */
const PAUSE_MS = 2_500;

/** A page whose clock is held and whose requests of its e3 are listed, on the example, wide enough for its grid. */
async function open(page: Page): Promise<Locator> {
    await installE3Faults(page);
    await page.clock.setFixedTime(new Date(HELD));
    await page.setViewportSize({ width: 1440, height: 900 });
    const entry = await visitBuilder(page, AUTHORED, ROOT, "light");
    return entry.locator(ROOT).first();
}

/** How many commits the page has sent its e3: a record's mutation each. */
const commits = async (page: Page): Promise<number> => (await e3Requests(page)).filter((request) => request.kind === "mutate").length;

/**
 * A finger put down on the page whose lift never reaches it: the next end of a pointer — its release, or the browser
 * taking it back — is kept from every listener of the page's, as a phone that says nothing of it keeps it.
 */
async function touchNeverHeardToEnd(page: Page, at: { x: number; y: number }): Promise<void> {
    await page.evaluate(() => {
        const swallow = (event: Event) => {
            event.stopImmediatePropagation();
            window.removeEventListener("pointerup", swallow, true);
            window.removeEventListener("pointercancel", swallow, true);
        };
        window.addEventListener("pointerup", swallow, true);
        window.addEventListener("pointercancel", swallow, true);
    });
    await page.touchscreen.tap(at.x, at.y);
}

test("with Autosave on, an edit made after a finger whose lift the page never heard is still saved by itself, a pause after it @mobile", async ({ page }) => {
    const frame = await open(page);
    const bar = frame.locator("[data-frame-slot='toolbar'] [data-slot='history']");
    const save = bar.getByRole("button", { name: "Save" });
    await expect(bar.locator("[data-history-autosave]")).toHaveAttribute("data-on", "");
    // A finger on the frame's footer, its lift never heard.
    const footer = (await frame.locator("[data-frame-slot='footer']").boundingBox())!;
    await touchNeverHeardToEnd(page, { x: footer.x + footer.width / 2, y: footer.y + footer.height / 2 });
    // An edit, by touch: a visit tapped, and deleted from the keyboard.
    const visit = frame.locator("[data-calendar-event]", { hasText: "Intake call" });
    await visit.tap();
    await page.keyboard.press("Delete");
    await expect(visit).toHaveCount(0);
    // The clock has not moved since the edit: it waits, and nothing was sent.
    await expect(save).toBeEnabled();
    expect(await commits(page)).toBe(0);
    // The pause over: the Save goes by itself, one commit — no finger is down, whatever the page was never told.
    await page.clock.setFixedTime(new Date(HELD + PAUSE_MS));
    await expect(save).toBeDisabled({ timeout: 15_000 });
    expect(await commits(page)).toBe(1);
});
