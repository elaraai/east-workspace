/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Plan builder's drag and drop in a real browser (#1196, `Plan Builder
 * Spec.md` §9.7, PB31–PB37), on the print works (`planPrintWorks`), measured
 * through the page's DOM:
 *
 * - at the desktop width, its library opened over main from its rail — which
 *   it slides off while a card is carried — and pinned beside main: a template
 *   from the Events tab, picked up past 4px and dropped on a press, makes its
 *   job at the day under the pointer, selected and drafted, the ghost saying
 *   what lands where; and a bar's end dragged a day on resizes it;
 * - a drafted bar wears the brand tint in a 1.5px brand border (§8), in both
 *   themes, and so does a drafted tile: a delivery of the links example
 *   (`planEventLinks`) dragged a week back;
 * - on a phone the canvas is its narrow layout, where nothing drags, and the
 *   panes open over it from their rails, the library's cards dragging nowhere.
 *
 * Every wait is a poll on the page's state, never a fixed pause.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-builder-dnd`.
 */

import { test, expect } from "playwright/test";
import { PLAN_EVENT_EXAMPLES, openExample, rowSel } from "./plan-page";
import { PRESS_A1 as A1, PRINT_WORKS_DAYS as DAYS, boxOf, centre, dayOf, libraryOf, openCards, openPrintWorks as open, pickUp, regionAt } from "./plan-builder-page";
import { settled } from "./settle";

/** The event kinds' examples file (#1191). */
const EVENTS = PLAN_EVENT_EXAMPLES;

/**
 * An element's fill and its top and left borders, beside the brand's tint, ink
 * and 1.5px as the page resolves and draws them. Evaluated in the page.
 */
function lookOf(el: Element) {
    const s = getComputedStyle(el);
    const probe = document.createElement("span");
    probe.style.background = "var(--chakra-colors-brand-tint)";
    probe.style.color = "var(--chakra-colors-brand-solid)";
    probe.style.border = "1.5px solid";
    document.body.appendChild(probe);
    const p = getComputedStyle(probe);
    const want = { tint: p.backgroundColor, brand: p.color, width: p.borderTopWidth };
    probe.remove();
    return {
        draft: el.hasAttribute("data-draft"),
        fill: s.backgroundColor,
        border: [s.borderTopWidth, s.borderTopStyle, s.borderTopColor, s.borderLeftWidth, s.borderLeftStyle, s.borderLeftColor],
        want,
    };
}

/** The links example's dispatch bay: its tiles, the deliveries. */
const BAY = rowSel("bays.buckets", "bay");

test.describe("the Plan builder's drag and drop (#1196)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "dragged at the desktop width; a phone's canvas is its narrow layout, read below");

    for (const placement of ["overlay", "pinned"] as const) {
        test(`planPrintWorks, its library ${placement === "overlay"
            ? "opened over main from its rail, which it slides off while the card is carried"
            : "pinned beside main, where it stays"}: a template dropped on a press makes its job on the day under the pointer, selected and drafted; a bar's end dragged a day on resizes it`, async ({ page }) => {
            const entry = await open(page, placement);
            const pane = libraryOf(entry);
            const card = openCards(pane).filter({ hasText: "Brochure run" });
            await expect(card).toHaveAttribute("data-draggable", "");
            const from = await pickUp(page, card);
            await expect(card).toHaveAttribute("data-dragging", "");
            // Over main, the library slides off it while the card is carried; pinned, it stays where it is.
            await expect.poll(() => regionAt(page, from)).toBe(placement === "overlay" ? "main" : "start");
            const plot = entry.locator(`${A1} [data-plan-plot]`);
            // Monday 12 October, the second week's first day.
            const on = await dayOf(plot, 7);
            await page.mouse.move(on.x, on.y, { steps: 8 });
            await expect(plot).toHaveAttribute("data-drop-active", "");
            await expect(page.locator("[data-drag-caption]")).toHaveText("Brochure run · Press A1 · Mon, Oct 12, 2026");
            await expect(page.locator("[data-drag-caption]")).not.toHaveAttribute("data-refused", /.*/);
            await page.mouse.up();
            const made = entry.locator(`${A1} [data-run]`, { hasText: "Brochure run" });
            await expect(made).toHaveCount(1);
            await expect(made).toHaveAttribute("aria-label", /^Brochure run, Oct 12, 2026 – Oct 12, 2026, 06:00/);
            await expect(made).toHaveAttribute("aria-pressed", "true");
            await expect(made).toHaveAttribute("data-draft", "");
            await expect(card).not.toHaveAttribute("data-dragging", "");
            // The drag over, the library is back where it was; the new job selected, the page at rest.
            await expect.poll(() => regionAt(page, from)).toBe("start");
            await settled(page);
            // Over main, the library is closed so main takes the pointer again.
            if (placement === "overlay") {
                await entry.locator("[data-builder-frame]").first().getByRole("button", { name: "Collapse Library" }).click();
                await expect(pane).toHaveAttribute("data-collapsed", "");
                await settled(page);
            }
            // The course handbook runs 06:00–18:00 on Monday 19 October: its end, carried a day on.
            const handbook = entry.locator(`${A1} [data-run]`, { hasText: "Course handbook" });
            const end = await centre(handbook.locator("[data-plan-edge='end']"));
            const day = (await boxOf(plot)).width / DAYS;
            await page.mouse.move(end.x, end.y);
            await page.mouse.down();
            await page.mouse.move(end.x + day, end.y, { steps: 8 });
            await expect(plot).toHaveAttribute("data-drop-active", "");
            await expect(page.locator("[data-drag-caption]")).toHaveText("Course handbook · Press A1 · Mon, Oct 19, 2026 · 06:00");
            await page.mouse.up();
            await expect(handbook).toHaveAttribute("aria-label", /^Course handbook, Oct 19, 2026, 06:00 – Oct 20, 2026, 18:00/);
            await expect(handbook).toHaveAttribute("data-draft", "");
        });
    }

    for (const theme of ["light", "dark"] as const) {
        test(`planPrintWorks (${theme}): a job its drafts changed wears the brand tint in a 1.5px brand border, in place of its lifecycle's look`, async ({ page }) => {
            const entry = await open(page, "pinned", theme);
            const bar = entry.locator(`${A1} [data-run]`, { hasText: "Spring catalogue" });
            // The bar's fill and border, and the brand's tint, ink and 1.5px as this page resolves and draws them.
            const look = () => bar.evaluate(lookOf);
            // At rest an actual job wears its lifecycle's own look.
            const rest = await look();
            expect(rest.draft).toBe(false);
            expect(rest.fill).not.toBe(rest.want.tint);
            // Its customer changed in the inspector: a draft of its kind's.
            await bar.click();
            await settled(page);
            const customer = entry.locator("[data-builder-frame] > [data-frame-slot='body'] > [data-frame-slot='end'] [data-inspector-fields='form'] [data-field='customer']").getByRole("textbox");
            await customer.fill("Alder & Finch Ltd");
            await customer.press("Enter");
            await expect(bar).toHaveAttribute("data-draft", "");
            const drafted = await look();
            const { tint, brand, width } = drafted.want;
            expect({ fill: drafted.fill, border: drafted.border }).toEqual({ fill: tint, border: [width, "solid", brand, width, "solid", brand] });
        });

        test(`planEventLinks (${theme}): a tile its drafts changed wears the same look — a delivery dragged a week back`, async ({ page }) => {
            const entry = await openExample(page, "planEventLinks", EVENTS, theme);
            const plot = entry.locator(`${BAY} [data-plan-plot]`);
            // The posters' delivery, in the third week's cell, and its look at rest — the dispatch bay's row is below
            // the bounded canvas's view at rest, so it is scrolled into it, and the pointer lands on the tile.
            const posters = entry.locator(`${BAY} [data-event*='D-02']`);
            await expect(posters).toHaveAttribute("data-plan-frac", "0.5000");
            await posters.scrollIntoViewIfNeeded();
            await settled(page);
            expect(await posters.evaluate((el) => {
                const r = el.getBoundingClientRect();
                return el.contains(document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2));
            })).toBe(true);
            const look = () => posters.evaluate(lookOf);
            const rest = await look();
            expect(rest.draft).toBe(false);
            expect(rest.fill).not.toBe(rest.want.tint);
            // A week back, into the second week's cell: a draft of its kind's.
            const from = await centre(posters);
            const week = (await boxOf(plot)).width / 4;
            await page.mouse.move(from.x, from.y);
            await page.mouse.down();
            await page.mouse.move(from.x - week, from.y, { steps: 8 });
            await expect(plot).toHaveAttribute("data-drop-active", "");
            await page.mouse.up();
            await expect(posters).toHaveAttribute("data-plan-frac", "0.2500");
            await expect(posters).toHaveAttribute("data-draft", "");
            const drafted = await look();
            const { tint, brand, width } = drafted.want;
            expect({ fill: drafted.fill, border: drafted.border }).toEqual({ fill: tint, border: [width, "solid", brand, width, "solid", brand] });
        });
    }
});

test.describe("the Plan builder's drag and drop on a phone (#1196)", () => {
    test.skip(({ isMobile }) => !isMobile, "a coarse pointer: the phone projects");

    test("planPrintWorks: the canvas is its narrow layout, where nothing drags; the panes open over it from their rails, and the library's cards drag nowhere", async ({ page }) => {
        const entry = await openExample(page, "planPrintWorks", EVENTS);
        const frame = entry.locator("[data-builder-frame]").first();
        await expect(entry.locator("[data-plan-body][data-plan-narrow]")).toHaveCount(1);
        await expect(frame.locator(":scope > [data-frame-slot='body'] > [data-frame-slot='main'] [data-draggable]")).toHaveCount(0);
        await frame.getByRole("button", { name: "Expand Library" }).tap();
        await settled(page);
        const pane = frame.locator(":scope > [data-frame-slot='body'] > [data-frame-slot='start']");
        await expect(pane).toHaveAttribute("data-pane-mode", "overlay");
        // The Events tab's templates: no row to drop them on.
        await expect(openCards(pane).first()).toBeVisible();
        await expect(pane.locator("[data-draggable]")).toHaveCount(0);
        // The customers, folded into +n on a phone (#1210): no event on the canvas to set them on.
        await pane.locator("[data-dock-more]").tap();
        await page.getByRole("menuitem", { name: /^Customers/ }).tap();
        // The menu closes over the pane's head: read once it has gone.
        await expect(page.locator('[role="menu"]')).toHaveCount(0);
        await settled(page);
        await expect(openCards(pane).first()).toHaveText(/Alder & Finch/);
        await expect(pane.locator("[data-draggable]")).toHaveCount(0);
        // The inspector opens over it too, from its rail.
        await expect(frame.locator(":scope > [data-frame-slot='body'] > [data-frame-slot='end']")).toHaveAttribute("data-pane-mode", "overlay");
    });
});
