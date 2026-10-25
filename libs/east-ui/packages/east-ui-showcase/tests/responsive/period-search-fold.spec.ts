/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Where a period builder's Search Records folds (ruled 25 Oct 2026): in the
 * Roster's, the Calendar's and the Allocation's one toolbar its box is the
 * first thing the row folds, to its icon, before every step of the rail and
 * of the builder's own items. A row short of room keeps the rail's chips and
 * the period's steps live, and shows the box whole only where it has room
 * (`shared/schedule/search-rank.ts`). Read from the toolbar's ladder
 * (`data-toolbar-ladder`, every step in the order it applies), one test an
 * area (#1397).
 */

import { expect, test } from "playwright/test";
import { visitBuilder } from "./builder-page";

/** Each period builder's example, and its root in the example's entry. */
const BUILDERS = [
    { name: "Roster", route: "e3/roster/roster/rosterWarehouse", root: "[data-roster-frame]" },
    { name: "Calendar", route: "e3/calendar/calendar/calendarOperations", root: "[data-calendar-frame]" },
    { name: "Allocation", route: "e3/allocation/allocation/allocationKilnYard", root: "[data-allocation-frame]" },
] as const;

for (const builder of BUILDERS) {
    test(`${builder.name}: Search Records' box is the first thing its toolbar folds, to its icon, before every step of the rail and of the builder's own items @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 1000 });
        const entry = await visitBuilder(page, builder.route, builder.root, "light");
        const toolbar = entry.locator(builder.root).first().locator("[data-frame-slot='toolbar'] [data-toolbar]").first();
        const steps = ((await toolbar.getAttribute("data-toolbar-ladder")) ?? "").split(" ").filter((step) => step !== "");
        expect(steps[0], steps.join(" ")).toBe("seek>1");
        // The box's second step, into the View, waits for the period's controls: never before the rail's steps.
        const into = steps.indexOf("seek>2");
        const lastRail = steps.reduce((last, step, i) => (step.startsWith("record-slices>") ? i : last), -1);
        expect(into, steps.join(" ")).toBeGreaterThan(lastRail);
    });
}
