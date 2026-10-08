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
 *   themes;
 * - on a phone the canvas is its narrow layout, where nothing drags, and the
 *   panes open over it from their rails, the library's cards dragging nowhere.
 *
 * Every wait is a poll on the page's state, never a fixed pause.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-builder-dnd`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { openExample, rowSel } from "./plan-page";
import { settled } from "./settle";

/** The event kinds' examples file (#1191). */
const EVENTS = "e3/plan/plan-events";

/** Press A1's bars. */
const A1 = rowSel("presses.span", "Hall A", "a1");

/** The print works' window: four weeks, a day a bucket. */
const DAYS = 28;

/** The frame's start pane: the library. */
const libraryOf = (entry: Locator) => entry.locator("[data-builder-frame] > [data-frame-slot='body'] > [data-frame-slot='start']");

/** The cards of a pane's open tab. */
const openCards = (pane: Locator) => pane.locator('[role="tabpanel"]:not([hidden]) [data-library-item]');

/** A locator's box — it must be laid out. */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error("not laid out");
    return box;
}

/** A locator's centre, in client px. */
async function centre(locator: Locator): Promise<{ x: number; y: number }> {
    const box = await boxOf(locator);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The middle of a day of a plot, its window's day 0 Monday 5 October. */
async function dayOf(plot: Locator, day: number): Promise<{ x: number; y: number }> {
    const box = await boxOf(plot);
    return { x: box.x + ((day + 0.5) / DAYS) * box.width, y: box.y + box.height / 2 };
}

/** The frame's region at a point — `main`, or a pane's side — or `null` outside the frame. */
function regionAt(page: Page, at: { x: number; y: number }): Promise<string | null> {
    return page.evaluate(({ x, y }) =>
        document.elementFromPoint(x, y)?.closest("[data-frame-slot]")?.getAttribute("data-frame-slot") ?? null, at);
}

/** Sets the box the Plan fills to a width, and waits for the page to be at rest. */
async function sizeTo(page: Page, entry: Locator, width: number): Promise<void> {
    await entry.locator("[data-plan-frame]").first().locator("xpath=..").evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
}

/**
 * The print works at rest, 70px under its scroller's top, so a drag stays
 * clear of the page's edge bands: in a box 760px wide its library overlays
 * main, 1440px wide it is pinned beside it — opened from its rail when it
 * rests there. A box 1440px wide is drawn in a window wide enough to hold it
 * left of the page's own "On this page" column.
 */
async function open(page: Page, placement: "overlay" | "pinned", theme: "light" | "dark" = "light"): Promise<Locator> {
    if (placement === "pinned") await page.setViewportSize({ width: 1920, height: 1080 });
    const entry = await openExample(page, "planPrintWorks", EVENTS, theme);
    await sizeTo(page, entry, placement === "overlay" ? 760 : 1440);
    await entry.locator("[data-plan-frame]").evaluate((frame) => {
        frame.scrollIntoView({ block: "start" });
        let scroller = frame.parentElement;
        while (scroller !== null && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
            scroller = scroller.parentElement;
        }
        if (scroller !== null) scroller.scrollTop -= 70;
    });
    await settled(page);
    const pane = libraryOf(entry);
    if (await pane.getAttribute("data-collapsed") !== null) {
        await entry.locator("[data-builder-frame]").first().getByRole("button", { name: "Expand Library" }).click();
    }
    await expect(pane).not.toHaveAttribute("data-collapsed", "");
    await expect(pane).toHaveAttribute("data-pane-mode", placement);
    await settled(page);
    return entry;
}

/** Press a node and carry it past the drag's 4px threshold — the drag is in flight. */
async function pickUp(page: Page, node: Locator): Promise<{ x: number; y: number }> {
    const at = await centre(node);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 12, at.y + 12, { steps: 3 });
    return at;
}

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
            const look = () => bar.evaluate((el) => {
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
            });
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
