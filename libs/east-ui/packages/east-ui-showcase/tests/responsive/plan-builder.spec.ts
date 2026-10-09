/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The print works' Plan builder in a real browser (#1200, `Plan Builder
 * Spec.md` §9.12, PB56, PB57): what the Plan's other specs leave unmeasured
 * of its frame at the desktop and phone widths, its two themes, its panes, a
 * drop and a resize, measured through the page's DOM:
 *
 * - its toolbar's ladder at 390px, and in the dark theme at 1440, 1024, 768,
 *   390 and 360px — one 44px row, folded as far as its ladder says, the rail
 *   first and the history item last, never less folded at a narrower frame;
 * - its panes at those five widths: each pinned beside main or on its 44px
 *   rail as the frame's room says — the library 272px and the inspector 320px
 *   open, main between them — and each on its rail, opened, over main from
 *   its own edge, main where it was, under the scrim, never so wide that less
 *   than 48px of the scrim shows beside it;
 * - a template dropped on a press and a bar's end dragged a day on, saved on
 *   the e3 the page runs: the drafts retire, and the Plan mounted again over
 *   the jobs record draws the new job and the longer one as saved.
 *
 * Measured elsewhere, and not again here: the frame — no border, the panes it
 * is given, one toolbar row with the history last — at the desktop and phone
 * widths in both themes, the toolbar's ladder in the light theme from 1440px
 * to 360px, the history item, the inspector, the overlaps and a field saved on
 * e3-web (`plan-frame.spec.ts`); the toolbar under a touch pointer at the
 * phone's 390px and on a touch screen 1920px wide (`toolbar-touch.spec.ts`);
 * each pane's tab row (`builder-panes.spec.ts`); the inspector's form
 * (`inspector-form.spec.ts`); and a drop and a resize with the library over
 * main and pinned beside it, a drafted bar's look in both themes, and the
 * phone's panes over a canvas where nothing drags (`plan-builder-dnd.spec.ts`).
 *
 * Every wait is a poll on the page's state, never a fixed pause.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-builder --project desktop`.
 */

import { test, expect } from "playwright/test";
import { editingMessages } from "@elaraai/east-ui-components/testing";
import { frameAt, type FrameAt } from "./builder-frame";
import { PRESS_A1, PRINT_WORKS_DAYS, boxOf, centre, dayOf, libraryOf, openCards, openPrintWorks, pickUp } from "./plan-builder-page";
import { PLAN_EVENT_EXAMPLES, openExample, planBox, remount, sizeBox, toolbarLadderFaults } from "./plan-page";
import { settled } from "./settle";

/** The widths the print works is measured at (PB57): a desktop's, a tablet's and a phone's. */
const WIDTHS = [1440, 1024, 768, 390, 360] as const;

test.describe("the print works' toolbar (#1200, PB57)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "swept at the desktop project; the phone's own row is toolbar-touch's");

    // The light theme's other widths are plan-frame.spec.ts's sweep, which passes 390px by.
    for (const { theme, widths } of [
        { theme: "light", widths: [390] },
        { theme: "dark", widths: WIDTHS },
    ] as const) {
        test(`planPrintWorks (${theme}) at ${widths.join(", ")}px: one 44px row — nothing past its edge, nothing scrolled — folded as far as its ladder says, the rail first and the history last, never less at a narrower frame`, async ({ page }) => {
            const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES, theme);
            expect(await toolbarLadderFaults(page, entry, widths)).toEqual([]);
        });
    }
});

/** The print works' panes open (§8): the library 272px, the inspector 320px. */
const OPEN = { start: 272, end: 320 } as const;

/** What a pane keeps in the flow while it overlays or is collapsed: its 44px rail. */
const RAIL = 44;

/** The strip of the scrim an open overlay pane leaves beside it: the builder frame's `MIN_SCRIM`. */
const MIN_SCRIM = 48;

/** Each pane's name, as its rail's toggle names it. */
const PANE = { start: "Library", end: "Inspector" } as const;

/**
 * Where the print works' panes sit in a frame of each width, by the frame's
 * rule (#1125): pinned while main keeps 480px beside them, the library placed
 * first; at 560px and narrower over main. At 1440px main keeps 848px beside
 * both; at 1024px 432px would be left beside the inspector, which overlays,
 * main keeping 708px; at 768px the library would leave 452px, and overlays
 * too.
 */
const PLACES = [
    { width: 1440, start: "pinned", end: "pinned" },
    { width: 1024, start: "pinned", end: "overlay" },
    { width: 768, start: "overlay", end: "overlay" },
    { width: 390, start: "overlay", end: "overlay" },
    { width: 360, start: "overlay", end: "overlay" },
] as const;

/** The frame at rest, as the expectations read it: each pane's place, whether it is collapsed, what it keeps in the flow, and main between them. */
function atRest(at: FrameAt) {
    const start = at.start!;
    const end = at.end!;
    return {
        modes: [start.mode, end.mode],
        collapsed: [start.collapsed, end.collapsed],
        flow: [Math.round(start.slot.w), Math.round(end.slot.w)],
        // Main from the library's slot to the inspector's: never under a pinned pane, never short of one.
        main: [Math.round(at.main.x - (start.slot.x + start.slot.w)), Math.round(end.slot.x - (at.main.x + at.main.w))],
        scrim: at.scrim !== null,
    };
}

/**
 * One pane opened over main, as the expectations read it: open, its rail still
 * in the flow and main where it was; its sheet from its own edge — the
 * frame's — as wide as it reads, its full height; the scrim over main, and
 * the strip of it the sheet leaves.
 */
function opened(at: FrameAt, side: "start" | "end") {
    const pane = at[side]!;
    const sheet = pane.sheet;
    const scrim = at.scrim;
    return {
        open: !pane.collapsed,
        flow: Math.round(pane.slot.w),
        main: [Math.round(at.main.x - at.body.x), Math.round(at.main.w)],
        fromEdge: Math.round(side === "start" ? sheet.x - at.body.x : at.body.x + at.body.w - (sheet.x + sheet.w)),
        width: Math.round(sheet.w),
        height: [Math.round(sheet.y - at.body.y), Math.round(sheet.h - at.body.h)],
        scrim: scrim === null ? null : [Math.round(scrim.x - at.main.x), Math.round(scrim.w - at.main.w)],
        ink: at.ink.scrim === at.ink.backdrop,
        strip: scrim === null ? 0 : Math.round(side === "start" ? scrim.x + scrim.w - (sheet.x + sheet.w) : sheet.x - scrim.x),
    };
}

test.describe("the print works' panes (#1200, PB57)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "the frame sized at the desktop project; the phone's own panes are plan-frame's and plan-builder-dnd's");

    test(`planPrintWorks at ${WIDTHS.join(", ")}px: each pane pinned beside main or on its rail as the frame's room says, main between them; each on its rail, opened, over main from its own edge — main where it was, under the scrim, never so wide that less than 48px of the scrim shows — and closed again`, async ({ page }) => {
        test.setTimeout(120_000);
        // A window wide enough for a 1440px box left of the page's own "On this page" column.
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await openExample(page, "planPrintWorks", PLAN_EVENT_EXAMPLES);
        const frame = entry.locator("[data-builder-frame]").first();
        for (const place of PLACES) {
            await sizeBox(page, planBox(entry), place.width);
            const flow = { start: place.start === "pinned" ? OPEN.start : RAIL, end: place.end === "pinned" ? OPEN.end : RAIL };
            // An `auto` pane that starts to overlay closes; a pinned one is open.
            await expect.poll(async () => atRest(await frameAt(entry)), { message: `at ${place.width}px, at rest` }).toEqual({
                modes: [place.start, place.end],
                collapsed: [place.start === "overlay", place.end === "overlay"],
                flow: [flow.start, flow.end],
                main: [0, 0],
                scrim: false,
            });
            const rest = await frameAt(entry);
            for (const side of ["start", "end"] as const) {
                if (place[side] !== "overlay") continue;
                // The room beside the other side's part of the flow: the sheet is as wide as the pane opens, but
                // leaves the scrim's strip — so the strip is at least 48px, exactly so where the sheet is held in.
                const room = Math.round(rest.body.w) - (side === "start" ? flow.end : flow.start);
                const width = Math.min(OPEN[side], room - MIN_SCRIM);
                await frame.getByRole("button", { name: `Expand ${PANE[side]}` }).click();
                await expect.poll(async () => opened(await frameAt(entry), side), { message: `at ${place.width}px, the ${PANE[side]} open` }).toEqual({
                    open: true,
                    flow: RAIL,
                    main: [Math.round(rest.main.x - rest.body.x), Math.round(rest.main.w)],
                    fromEdge: 0,
                    width,
                    height: [0, 0],
                    scrim: [0, 0],
                    ink: true,
                    strip: room - width,
                });
                await frame.getByRole("button", { name: `Collapse ${PANE[side]}` }).click();
                await expect.poll(async () => atRest(await frameAt(entry)), { message: `at ${place.width}px, the ${PANE[side]} closed again` }).toEqual(atRest(rest));
            }
        }
    });
});

test.describe("the print works' drag and drop, saved on e3-web (#1200, PB56)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "saved once, at the desktop width");

    test("planPrintWorks: a template dropped on a press and a bar's end dragged a day on are drafts; Save commits both to the jobs record on the e3 the page runs — the drafts retire, no banner — and the Plan mounted again draws the new job and the longer one as saved", async ({ page }) => {
        const entry = await openPrintWorks(page, "pinned");
        const frame = entry.locator("[data-builder-frame]").first();
        const save = frame.locator(":scope > [data-frame-slot='toolbar']").getByRole("button", { name: editingMessages.apply(), exact: true });
        await expect(save).toBeDisabled();
        const plot = entry.locator(`${PRESS_A1} [data-plan-plot]`);
        // The brochure run's template onto Press A1's Monday 12 October, the second week's first day.
        await pickUp(page, openCards(libraryOf(entry)).filter({ hasText: "Brochure run" }));
        const on = await dayOf(plot, 7);
        await page.mouse.move(on.x, on.y, { steps: 8 });
        await expect(plot).toHaveAttribute("data-drop-active", "");
        await page.mouse.up();
        const made = entry.locator(`${PRESS_A1} [data-run]`, { hasText: "Brochure run" });
        await expect(made).toHaveAttribute("data-draft", "");
        await settled(page);
        // The course handbook runs 06:00–18:00 on Monday 19 October: its end, carried a day on.
        const handbook = entry.locator(`${PRESS_A1} [data-run]`, { hasText: "Course handbook" });
        const end = await centre(handbook.locator("[data-plan-edge='end']"));
        const day = (await boxOf(plot)).width / PRINT_WORKS_DAYS;
        await page.mouse.move(end.x, end.y);
        await page.mouse.down();
        await page.mouse.move(end.x + day, end.y, { steps: 8 });
        await expect(plot).toHaveAttribute("data-drop-active", "");
        await page.mouse.up();
        await expect(handbook).toHaveAttribute("data-draft", "");
        await expect(save).toBeEnabled();
        await save.click();
        // Confirmed by the record read back: Save off, nothing drafted, no banner.
        await expect(save).toBeDisabled();
        await expect(entry.locator(`${PRESS_A1} [data-run][data-draft]`)).toHaveCount(0);
        await expect(frame.locator(":scope > [data-frame-slot='banners'] [data-session-banner]")).toHaveCount(0);
        // Mounted afresh over the jobs record: the new job and the longer one, as saved.
        const again = await remount(page, "planPrintWorks", PLAN_EVENT_EXAMPLES);
        await sizeBox(page, planBox(again), 1440);
        const madeAgain = again.locator(`${PRESS_A1} [data-run]`, { hasText: "Brochure run" });
        await expect(madeAgain).toHaveAttribute("aria-label", /^Brochure run, Oct 12, 2026 – Oct 12, 2026, 06:00/);
        await expect(madeAgain).not.toHaveAttribute("data-draft", /.*/);
        const handbookAgain = again.locator(`${PRESS_A1} [data-run]`, { hasText: "Course handbook" });
        await expect(handbookAgain).toHaveAttribute("aria-label", /^Course handbook, Oct 19, 2026, 06:00 – Oct 20, 2026, 18:00/);
        await expect(handbookAgain).not.toHaveAttribute("data-draft", /.*/);
    });
});
