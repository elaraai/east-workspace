/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A key a builder acts on goes no further than the builder (#1398): the page
 * around it never hears it — the showcase's own `[`, which folds its sidebar,
 * least of all. Each builder's keys, pressed where they act: the Plan's canvas
 * and grid keys; the Sheet's grid's, and a key that starts an edit; the
 * Roster's and the Allocation's frame keys — `[` and `]` step the period —
 * their views' and a keyboard drag's; the Schematic's canvas keys, its
 * hovered keys and its Index's; and the Flowchart's canvas keys, its state
 * editor's and its history's — and an Escape typed elsewhere on the page never
 * acts on the Flowchart, which hears one from the page itself only with the
 * pointer over its canvas. A key no builder acts on goes on as it came.
 * What reaches the page is read from a listener on the window, the last thing
 * a key reaches; one area a test, each its own e3.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test builder-keys --project desktop`.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { visitBuilder } from "./builder-page";
import { DATA_CENTRE, openSchematic, openTab } from "./schematic-page";
import { settled } from "./settle";

/** Where the showcase keeps its sidebar folded or not: what its `[` toggles. */
const SIDEBAR_KEY = "east-ui-showcase.sidebar-collapsed";

/** Starts hearing — again — what keys reach the window. */
async function listen(page: Page): Promise<void> {
    await page.evaluate(() => {
        const w = window as unknown as { __keysHeard?: string[] };
        if (w.__keysHeard === undefined) {
            w.__keysHeard = [];
            window.addEventListener("keydown", (event) => { w.__keysHeard!.push(event.key); });
        }
        w.__keysHeard.length = 0;
    });
}

/** The keys that reached the window since {@link listen}. */
const heard = (page: Page): Promise<string[]> => page.evaluate(() => [...((window as unknown as { __keysHeard?: string[] }).__keysHeard ?? [])]);

/** Whether the showcase's sidebar is folded, as it keeps it. */
const sidebar = (page: Page): Promise<string | null> => page.evaluate((key) => localStorage.getItem(key), SIDEBAR_KEY);

/** Presses keys where an element has the focus, each with it focused again: none reaches the page. */
async function pressedOn(page: Page, at: Locator, keys: readonly string[]): Promise<void> {
    for (const key of keys) {
        await at.focus();
        await listen(page);
        await page.keyboard.press(key);
        expect(await heard(page), `${key} on ${await at.evaluate((el) => el.outerHTML.slice(0, 80))}`).toEqual([]);
    }
}

/** A key no builder acts on reaches the page as it came. */
async function goesOn(page: Page, at: Locator): Promise<void> {
    await at.focus();
    await listen(page);
    await page.keyboard.press("Shift");
    expect(await heard(page)).toEqual(["Shift"]);
}

test.describe("a key a builder acts on goes no further than the builder (#1398)", () => {
    test("the Plan's canvas and grid keys: `[` pans the Plan and folds no sidebar @desktop", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const entry = await visitBuilder(page, "e3/plan/plan/planRowDrop", "[data-plan-frame]", "light");
        const grid = entry.locator("[data-plan-body] [role='treegrid']").first();
        const folded = await sidebar(page);
        // Focused on the grid, the focus goes on to a row: each key there is the Plan's.
        await pressedOn(page, grid, ["[", "]", "n", "g", "g", "ArrowDown", "ArrowUp", "PageDown", "PageUp", "End", "Home", "Escape"]);
        await settled(page);
        // An element of a row: Enter does what its click does, Space picks it up or does the same, and Escape lets it
        // go or goes back to its row.
        await pressedOn(page, entry.locator("[data-plan-body]").locator("[data-run],[data-event],[data-chip],[data-mark],[data-cell]").first(),
            ["Enter", "Space", "Escape"]);
        await settled(page);
        expect(await sidebar(page)).toBe(folded);
        await goesOn(page, grid);
        // A segment strip of the toolbar takes its arrows: the Resolution's, on the area's Plan over every row kind.
        const target = await visitBuilder(page, "e3/plan/plan/planTargetState", "[data-plan-frame]", undefined);
        const resolution = target.getByRole("radiogroup", { name: "Resolution" });
        await expect(resolution).toBeVisible();
        await pressedOn(page, resolution.getByRole("radio", { checked: true }), ["ArrowRight", "ArrowLeft"]);
        await settled(page);
        expect(await sidebar(page)).toBe(folded);
    });

    test("the Sheet's grid keys, and the key that starts an edit @desktop", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const entry = await visitBuilder(page, "e3/sheet/sheet/sheetWorkshop", "[data-sheet-card]", "light");
        const cell = entry.locator("[data-sheet-card] [data-slot='row'][data-group-id]:not([data-blank]) [data-slot='cell']").first();
        await cell.evaluate((el) => el.closest("[role='row']")!.scrollIntoView({ block: "center", inline: "nearest" }));
        await settled(page);
        await cell.click();
        const card = entry.locator("[data-sheet-card]").first();
        const folded = await sidebar(page);
        await listen(page);
        for (const key of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "PageDown", "PageUp", "End", "Home"]) await page.keyboard.press(key);
        expect(await heard(page)).toEqual([]);
        // `[` on a cell starts its edit with it; Escape takes the edit back.
        await page.keyboard.press("[");
        await expect(card.locator("input:focus, textarea:focus")).toHaveCount(1);
        await page.keyboard.press("Escape");
        await expect(card.locator("input:focus, textarea:focus")).toHaveCount(0);
        expect(await heard(page)).toEqual([]);
        expect(await sidebar(page)).toBe(folded);
        await listen(page);
        await page.keyboard.press("Shift");
        expect(await heard(page)).toEqual(["Shift"]);
    });

    test("the Roster's keys: its week's steps, its People names, a duty's Enter, Escape and a keyboard drag @desktop", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        // The People layout: its names take ↑ and ↓.
        const entry = await visitBuilder(page, "e3/roster/roster/rosterPeople", "[data-roster-frame]", "light");
        const frame = entry.locator("[data-roster-frame]").first();
        const folded = await sidebar(page);
        const name = frame.locator("[data-roster-person-head]").first();
        await pressedOn(page, name, ["ArrowDown"]);
        // A duty selected by Enter, and Escape letting it go; the week stepped on and back from anywhere in the frame —
        // here a person's name, which leaves `[` and `]` to the frame.
        await pressedOn(page, frame.locator("[data-roster-assignment]").first(), ["Enter", "Escape"]);
        await pressedOn(page, name, ["]"]);
        await settled(page);
        await pressedOn(page, name, ["["]);
        await settled(page);
        expect(await sidebar(page)).toBe(folded);
        // A duty picked up by Space, moved and let go by Escape: the drag's keys are the drag's.
        const carried = frame.locator("[data-roster-assignment][data-draggable]").first();
        await carried.focus();
        await listen(page);
        await page.keyboard.press("Space");
        await expect(carried).toHaveAttribute("data-dragging", "");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Escape");
        await expect(carried).not.toHaveAttribute("data-dragging", "");
        expect(await heard(page)).toEqual([]);
        await goesOn(page, frame.locator("[data-roster-person-head]").first());
    });

    test("the Allocation's keys: its day's steps, a bin's Enter, Escape and a keyboard drag @desktop", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const entry = await visitBuilder(page, "e3/allocation/allocation/allocationKilnYard", "[data-allocation-frame]", "light");
        const frame = entry.locator("[data-allocation-frame]").first();
        const folded = await sidebar(page);
        // A bin selected by Enter, and Escape letting it go; the day stepped on and back from anywhere in the frame — here
        // its toolbar's Next day, a button, which leaves `[` and `]` to the frame.
        await pressedOn(page, frame.locator("[data-allocation-card]").first(), ["Enter", "Escape"]);
        const next = frame.getByRole("button", { name: "Next day", exact: true });
        await pressedOn(page, next, ["]"]);
        await settled(page);
        await pressedOn(page, next, ["["]);
        await settled(page);
        expect(await sidebar(page)).toBe(folded);
        // A bin picked up by Space, moved and let go by Escape.
        const card = frame.locator("[data-allocation-card][data-draggable]").first();
        await card.focus();
        await listen(page);
        await page.keyboard.press("Space");
        await expect(card).toHaveAttribute("data-dragging", "");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Escape");
        await expect(card).not.toHaveAttribute("data-dragging", "");
        expect(await heard(page)).toEqual([]);
        await goesOn(page, frame.locator("[data-allocation-card]").first());
    });

    test("the Calendar's keys: its period's steps, an event's Enter, Escape, Delete and a keyboard drag @desktop", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const entry = await visitBuilder(page, "e3/calendar/calendar/calendarOperations", "[data-calendar-frame]", "light");
        const frame = entry.locator("[data-calendar-frame]").first();
        const folded = await sidebar(page);
        // The week's brackets batch, by the name its block gives it.
        const brackets = frame.locator("[data-calendar-event][aria-label^='Mounting brackets']");
        // An event selected by Enter, and Escape letting it go; with nothing left to let go of, Escape goes on.
        await pressedOn(page, brackets, ["Enter", "Escape"]);
        await brackets.focus();
        await listen(page);
        await page.keyboard.press("Escape");
        expect(await heard(page)).toEqual(["Escape"]);
        // The week stepped on and back from anywhere in the frame — here its toolbar's Next week, a button, which leaves `[`
        // and `]` to the frame.
        const anchor = () => frame.locator("[data-time-navigation=calendar]").first().getAttribute("data-time-anchor");
        const week = await anchor();
        const next = frame.getByRole("button", { name: "Next week", exact: true });
        await pressedOn(page, next, ["]"]);
        await settled(page);
        expect(Number(await anchor())).toBe(Number(week) + 7 * 86_400_000);
        await pressedOn(page, next, ["["]);
        await settled(page);
        expect(await anchor()).toBe(week);
        expect(await sidebar(page)).toBe(folded);
        // An event picked up by Space, moved and let go by Escape: the drag's keys are the drag's.
        const carried = frame.locator("[data-calendar-event][data-draggable]").first();
        await carried.focus();
        await listen(page);
        await page.keyboard.press("Space");
        await expect(carried).toHaveAttribute("data-dragging", "");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Escape");
        await expect(carried).not.toHaveAttribute("data-dragging", "");
        expect(await heard(page)).toEqual([]);
        // Delete removes the selected event: the Calendar's too.
        await pressedOn(page, brackets, ["Enter", "Delete"]);
        await expect(brackets).toHaveCount(0);
        await goesOn(page, frame.locator("[data-calendar-event]").first());
    });

    test("the Schematic's keys: its canvas's, its hovered keys and its Index's @desktop", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const root = await openSchematic(page, DATA_CENTRE, "light");
        const canvas = root.locator("[data-schematic-canvas]").first();
        await canvas.hover();
        // An item stepped to; Space held for Select; Escape letting the selection go — over the canvas.
        await pressedOn(page, canvas, ["ArrowRight", "Space"]);
        await settled(page);
        await pressedOn(page, canvas, ["Escape"]);
        await goesOn(page, canvas);
        // The Index's tree takes its arrows and Enter.
        await openTab(page, root, "Index");
        await pressedOn(page, root.locator("[data-frame-slot='start'] [role='tree']").first(), ["ArrowDown", "Enter"]);
    });

    test("the Flowchart's keys: its canvas's Escape and Del, its history's undo and a state's editor's Enter and Escape — and an Escape typed elsewhere on the page never acting on it @desktop", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const route = "e3/flowchart/flowchart/flowchartDetail";
        const entry = await visitBuilder(page, route, "[data-flowchart-root] [data-flowchart-node]", "light");
        const root = entry.locator("[data-flowchart-root]").first();
        const canvas = root.locator("[data-flowchart-scroll]");
        const state = (key: string) => root.locator(`[data-flowchart-node="${key}"]`);
        const folded = await sidebar(page);
        // A state selected by a click: Escape in the canvas lets it go.
        await state("CLD").click();
        await expect(state("CLD")).toHaveAttribute("data-selected", "true");
        await pressedOn(page, canvas, ["Escape"]);
        await expect(state("CLD")).not.toHaveAttribute("data-selected", "true");
        // Del deletes the selected state; the history's undo, from anywhere in the frame, puts it back — its Control the
        // only key the page hears.
        await state("RCV").click();
        await pressedOn(page, canvas, ["Delete"]);
        await expect(state("RCV")).toHaveCount(0);
        await canvas.focus();
        await listen(page);
        await page.keyboard.press("Control+z");
        await expect(state("RCV")).toHaveCount(1);
        expect(await heard(page)).toEqual(["Control"]);
        // A state's editor, opened by a double-click: Escape puts it away, and Enter commits what it holds — each key, which
        // closes the editor it is pressed in, going no further.
        const editor = root.locator("[data-flowchart-stateeditor]");
        for (const key of ["Escape", "Enter"]) {
            await state("BKD").dblclick();
            await editor.locator("input").first().focus();
            await listen(page);
            await page.keyboard.press(key);
            await expect(editor, key).toHaveCount(0);
            expect(await heard(page), `${key} in a state's editor`).toEqual([]);
        }
        await settled(page);
        // An Escape typed elsewhere on the page — on the example's own link, outside the frame — leaves the selection be.
        await state("CLD").click();
        await expect(state("CLD")).toHaveAttribute("data-selected", "true");
        await entry.locator(`a[href="#${route}"]`).first().focus();
        await page.keyboard.press("Escape");
        await expect(state("CLD")).toHaveAttribute("data-selected", "true");
        // One from the page itself, nothing focused, is the canvas's while the pointer is over it.
        await canvas.hover();
        await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
        await page.keyboard.press("Escape");
        await expect(state("CLD")).not.toHaveAttribute("data-selected", "true");
        expect(await sidebar(page)).toBe(folded);
        await goesOn(page, canvas);
    });
});
