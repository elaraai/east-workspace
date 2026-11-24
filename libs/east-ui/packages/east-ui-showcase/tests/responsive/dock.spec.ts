/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A `<Dock>`'s control stands still, and a press on its row or its rail
 * toggles it, measured in a real browser: on each Dock example — a sidebar on
 * its own panel (the card surface), one in a host's frame (the shell), two on
 * the end edge resting on their rails, and a tray — the pane is collapsed and
 * expanded by its control, by the room on its open row, and by the room on its
 * rail and on the rail's bar, and after each press the control stands where it
 * stood at rest, to the 64th of a pixel: across, and down but on a tray pinned
 * to the end, whose row rides the tray's edge. Before the fix a sidebar pinned
 * to the start drew its control at the end of its open row and at the top of
 * its rail, 200px apart on a 264px pane, and only the rail took a press.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test dock --project desktop`.
 */

import { expect } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
import { dockControlOf, pressDock, type DockPress } from "./dock-control";

/** A Dock example, and what each of its panes is. */
const EXAMPLES = [
    { hash: "layout/dock/dockVariants", panes: ["a sidebar on its own panel, pinned to the start"] },
    { hash: "layout/dock/dockTabs", panes: ["a sidebar with tabs in a host's frame, pinned to the start"] },
    { hash: "layout/dock/dockActive", panes: ["an inspector on the end edge, active, on its rail", "an inspector on the end edge, idle, on its rail"] },
    { hash: "layout/dock/dockVertical", panes: ["a tray on its own panel, pinned to the end"] },
] as const;

test.describe("a Dock's control stands still as it collapses and expands, and its row and its rail each toggle it", { tag: "@desktop" }, () => {
    for (const example of EXAMPLES) {
        test(`${example.hash}: ${example.panes.join("; ")}`, async ({ page }) => {
            await page.goto(`/?theme=light#${example.hash}`);
            await page.waitForSelector("header", { timeout: 20_000 });
            const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${example.hash}"]`) });
            await entry.scrollIntoViewIfNeeded();
            await settled(page);
            const panes = entry.locator("[data-orientation][data-side][data-surface]");
            await expect(panes).toHaveCount(example.panes.length);
            for (const [i, what] of example.panes.entries()) await test.step(what, async () => {
                const pane = panes.nth(i);
                const rest = await dockControlOf(pane);
                // Open, it collapses by its control, and opens again from its rail's bar; then its row collapses it, and
                // its rail opens it. On its rail, the same four presses the other way round.
                const presses: readonly DockPress[] = rest.open ? ["control", "bar", "row", "rail"] : ["rail", "row", "bar", "control"];
                for (const press of presses) await pressDock(page, pane, rest, press);
            });
        });
    }
});
