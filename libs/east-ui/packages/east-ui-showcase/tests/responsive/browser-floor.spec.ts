/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The showcase draws in a browser with no built-in newer than ES2023 (`docs/conventions/BROWSER_FLOOR.md`).
 *
 * An app built on East opens on iPhones back to iOS 16.4, and every browser on an iPhone runs on the system's own
 * engine, which has ES2023's built-ins and few newer ones. East's Dicts and Sets once named `Iterator`, which that
 * engine gained in iOS 18.4: on an older phone every page stopped at its first draw, an error where each builder
 * should be. The browser this suite drives has them all, so each page here is opened with the newer ones taken away
 * before its first script — East's own list of them, the one its suite is run without (`libs/east/test/floor/`).
 *
 * What this holds that the lint rule cannot: a value typed `any`, and everything the bundle holds besides East's
 * packages — the component library, the state machines under it, the table and the virtualizer. It reads what each
 * builder draws on a phone, a test an area (#1397); the engine is the page's own, so the e3 the page runs in its
 * workers keeps what the browser has.
 *
 * Run: `make test-responsive` (libs/east-ui), or `pnpm exec playwright test browser-floor`.
 */

import { test, expect, type Page } from "playwright/test";
import { FLOOR, takeAway } from "../../../../../east/test/floor/es2023.ts";
import { visitBuilder } from "./builder-page";
import { settled } from "./settle";

/** One example of each builder, by its showcase entry. */
const BUILDERS: readonly (readonly [name: string, hash: string])[] = [
    ["Sheet", "e3/sheet/sheet-records/sheetRecordIndexes"],
    ["Record", "e3/record/record/recordHoursByProject"],
    ["Plan", "e3/plan/plan-records/planRecordIndexes"],
    ["Roster", "e3/roster/roster/rosterWarehouse"],
    ["Calendar", "e3/calendar/calendar/calendarOperations"],
    ["Allocation", "e3/allocation/allocation/allocationKilnYard"],
    ["Flowchart", "e3/flowchart/flowchart/flowchartDepot"],
    ["Studio", "e3/studio/studio/studioBuilder"],
    ["Query", "e3/query/query/queryBuilder"],
    ["Schematic", "e3/schematic/schematic/schematicDataCentre"],
];

/** Makes the page the older engine before its first script, and keeps what it throws. */
async function onTheFloor(page: Page): Promise<string[]> {
    const thrown: string[] = [];
    page.on("pageerror", (error) => thrown.push(error.message));
    await page.addInitScript(takeAway, FLOOR);
    return thrown;
}

/** What the page has of the built-ins East's containers and renderers could reach for: on the floor, none. */
function builtins(page: Page): Promise<Record<string, string>> {
    return page.evaluate(() => ({
        Iterator: typeof (globalThis as { Iterator?: unknown }).Iterator,
        "an iterator's map": typeof (new Map<string, number>().keys() as { map?: unknown }).map,
        "a Set's union": typeof (new Set<number>() as { union?: unknown }).union,
        "Object.groupBy": typeof (Object as { groupBy?: unknown }).groupBy,
        "Promise.withResolvers": typeof (Promise as { withResolvers?: unknown }).withResolvers,
    }));
}

/** Each East error the page draws in an example's place, in the engine's words for what it lacked. */
function eastErrors(page: Page): Promise<string[]> {
    return page.locator("[data-east-error]").evaluateAll((drawn) => drawn.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200)));
}

const GONE = { Iterator: "undefined", "an iterator's map": "undefined", "a Set's union": "undefined", "Object.groupBy": "undefined", "Promise.withResolvers": "undefined" };

test.describe("the showcase in a browser with nothing newer than ES2023 @mobile", () => {
    for (const [name, route] of BUILDERS) {
        test(`the ${name} draws, and its page throws for no built-in it lacks`, async ({ page }) => {
            const thrown = await onTheFloor(page);
            const entry = await visitBuilder(page, route, "[data-builder-frame]", "light");
            expect(await builtins(page), "the page is the older engine").toEqual(GONE);
            expect(await eastErrors(page), "no East error is drawn").toEqual([]);
            await expect(entry.locator("[data-builder-frame] [data-frame-slot='main']").first()).toBeVisible();
            expect(thrown, "the page threw nothing").toEqual([]);
        });
    }

    test("an east-ui page draws, and throws for no built-in it lacks", async ({ page }) => {
        const thrown = await onTheFloor(page);
        await page.goto("/?theme=light#buttons/button/buttonBasic");
        await expect(page.getByRole("button", { name: "Click me" }).first()).toBeVisible({ timeout: 30_000 });
        await settled(page);
        expect(await builtins(page), "the page is the older engine").toEqual(GONE);
        expect(await eastErrors(page), "no East error is drawn").toEqual([]);
        expect(thrown, "the page threw nothing").toEqual([]);
    });
});
