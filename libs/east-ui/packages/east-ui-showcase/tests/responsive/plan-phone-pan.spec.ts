/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The narrow Plan's two-finger pan on a phone (12 Nov 2026), in a real touch
 * browser at 390 × 844: two fingers carried left by a period's width pan the
 * window a period later, and one finger pans nothing — the page's scroll is
 * its. After a touch the system takes back — an edge swipe, a pull of the
 * notification shade, a palm — one finger still pans nothing, and two still
 * pan a period for a period's width; and as much after a finger whose lift the
 * page never hears, which a phone does not always say. The list's fingers are
 * the shared pointer core's (east-ui-components' `src/pointer/`), which holds a
 * finger only while it is down. Counted by the list itself, one finger
 * remembered past its end made a single finger's swipe pan the window, and two
 * fingers pan nothing.
 *
 * A page of its own, never `./kept-page`'s: the touches are sent through the
 * page's context.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

const ROUTE = "e3/plan/plan-nested/planNestedAll";

interface Point { readonly x: number; readonly y: number }

/** Opens the Plan's example at a phone's size, its frame at rest. */
async function open(page: Page): Promise<Locator> {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?theme=light#${ROUTE}`);
    await page.waitForSelector("header");
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${ROUTE}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const frame = entry.locator("[data-builder-frame]").first();
    await expect(frame).toHaveAttribute("data-phone", "", { timeout: 30_000 });
    await settled(page);
    return frame;
}

/** Touches the screen with fingers that move together, a frame a step: each finger's path, from its first point to its last. */
async function touch(page: Page, paths: readonly (readonly [Point, Point])[]): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    const at = (t: number) => paths.map(([from, to], id) => ({ id, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
    for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(i / 8) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    await settled(page);
}

/** A finger put down that the system takes back before it lifts: the page hears its touch cancelled, never ended. */
async function touchTakenBack(page: Page, at: Point): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, x: at.x, y: at.y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await cdp.detach();
    await settled(page);
}

/**
 * A finger put down and lifted, its lift never reaching the page: the next end of a pointer — its release, or the
 * browser taking it back — is kept from every listener of the page's, as a phone that says nothing of it keeps it.
 */
async function touchNeverHeardToEnd(page: Page, at: Point): Promise<void> {
    await page.evaluate(() => {
        const swallow = (event: Event) => {
            event.stopImmediatePropagation();
            window.removeEventListener("pointerup", swallow, true);
            window.removeEventListener("pointercancel", swallow, true);
        };
        window.addEventListener("pointerup", swallow, true);
        window.addEventListener("pointercancel", swallow, true);
    });
    await touch(page, [[at, { x: at.x, y: at.y + 1 }]]);
}

/** The periods the list's ruler shows, as its ticks read. */
const periods = (frame: Locator): Promise<string[]> => frame.locator("[data-slot='narrowRulerTick']").allTextContents();

test("two fingers carried a period's width pan the narrow Plan a period, and one finger none — as much after a touch the system takes back, and after a finger whose lift the page never hears @mobile", async ({ page }) => {
    const frame = await open(page);
    const list = frame.locator("[data-slot='narrowList']");
    await list.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await settled(page);
    const box = (await list.boundingBox())!;
    const shown = await periods(frame);
    expect(shown.length).toBeGreaterThan(1);
    // A period's width, as the list lays its ruler out: its ticks share its width less the cards' inset each side.
    const period = (box.width - 50) / shown.length;
    const x = box.x + box.width / 2, y = Math.max(box.y, 0) + 120;
    /** One finger carried left across two periods. */
    const oneFinger = () => touch(page, [[{ x: x + period, y }, { x: x - period, y }]]);
    /** Two fingers carried left together, a period and a little more. */
    const twoFingers = () => touch(page, [
        [{ x: x + period, y }, { x: x - period * 0.2, y }],
        [{ x: x + period + 60, y: y + 40 }, { x: x - period * 0.2 + 60, y: y + 40 }],
    ]);

    await test.step("one finger pans nothing", async () => {
        await oneFinger();
        expect(await periods(frame)).toEqual(shown);
    });
    let panned: string[] = [];
    await test.step("two fingers pan a period later", async () => {
        await twoFingers();
        await expect.poll(() => periods(frame)).not.toEqual(shown);
        panned = await periods(frame);
        // The window a period on: each tick but the last is the one that stood after it.
        expect(panned.slice(0, -1)).toEqual(shown.slice(1));
    });
    await test.step("after a touch the system takes back, one finger still pans nothing, and two still pan a period", async () => {
        await touchTakenBack(page, { x, y });
        await oneFinger();
        expect(await periods(frame)).toEqual(panned);
        await twoFingers();
        await expect.poll(() => periods(frame)).not.toEqual(panned);
        expect((await periods(frame)).slice(0, -1)).toEqual(panned.slice(1));
    });
    await test.step("after a finger whose lift the page never hears, one finger still pans nothing, and two still pan a period", async () => {
        const before = await periods(frame);
        await touchNeverHeardToEnd(page, { x, y });
        await oneFinger();
        expect(await periods(frame)).toEqual(before);
        await twoFingers();
        await expect.poll(() => periods(frame)).not.toEqual(before);
        expect((await periods(frame)).slice(0, -1)).toEqual(before.slice(1));
    });
});
