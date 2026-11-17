/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The optimiser over jobs a Plan never holds whole (east-workspace#1622, the
 * epic's done test), in a real browser on the page's own e3: the print works
 * of 2,000 presses, its jobs read a cell at a time (`planOptimiseWindows`),
 * and the works' maintenance optimiser, which reads the jobs of the press
 * that is down through the jobs' series index. A job dragged from the Backlog
 * onto that press, and not saved, goes with the run as a draft: the function
 * reads it there, and its answer sends it back to the backlog beside the
 * press's saved job. The answer lands as unsaved edits in one step; one Undo
 * reverts it, the drag standing; Save commits the drag and the answer
 * together; and the page writes nothing to e3 before Save.
 *
 * The page is the spec's own, never `./kept-page`'s: the e3 fault hook, which
 * lists what the page asks of e3, is installed before it loads.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test optimise-plan-windows`.
 */

import { expect, test, type Page } from "playwright/test";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { e3Requests, installE3Faults } from "./e3-faults";
import { boxOf, libraryOf, openCards, pickUp } from "./plan-builder-page";
import { rowSel } from "./plan-page";
import { settled } from "./settle";

const PLAN = "[data-plan-frame]";
/** The press down for maintenance, as the workspace's input says it: its row. */
const DOWN = rowSel("presses", "P-1003");
/** The fortnight the Plan opens on, from Monday 5 October 2026, a day a bucket. */
const DAYS = 14;

/** How many writes the page has made of its e3's records. */
const writes = async (page: Page): Promise<number> => (await e3Requests(page)).filter((request) => request.kind === "mutate").length;

test("planOptimiseWindows: a job dragged onto the press that is down, and not saved, is read by the optimiser through the series index — its answer lands as one step, Undo reverts it, and Save commits the drag and the answer together, nothing written before it (#1622) @desktop", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1000, "dragged at the desktop width");
    await installE3Faults(page);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const entry = await visitBuilder(page, "e3/plan/optimise-windows/planOptimiseWindows", PLAN, "light");
    await sizeBuilder(page, entry, PLAN, 1440);
    const frame = entry.locator(PLAN).first();
    await frame.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await settled(page);
    const toolbar = frame.locator("[data-frame-slot='toolbar']");
    const pending = frame.locator("[data-frame-slot='footer'] [data-plan-count='pending']");
    /** A job's bar on the press that is down, by its title. */
    const onPress = (title: string) => frame.locator(`${DOWN} [data-run][aria-label^=${JSON.stringify(title)}]`);
    // The press holds the course handbooks, 7–9 October; the order forms wait in the Backlog.
    await expect(onPress("Course handbooks")).toHaveCount(1, { timeout: 30_000 });
    const pane = libraryOf(entry);
    if (await pane.getAttribute("data-collapsed") !== null) {
        await frame.locator("[data-builder-frame]").first().getByRole("button", { name: "Expand Library" }).click();
    }
    await expect(pane).not.toHaveAttribute("data-collapsed", "");
    const backlog = pane.getByRole("tab", { name: /^Backlog/ });
    await expect(backlog).toHaveText(/Backlog\s*4/);

    // The drag: the order forms onto the press's Monday, 12 October — a draft, saved nowhere.
    const card = openCards(pane).filter({ hasText: "Order forms" });
    await expect(card).toHaveAttribute("data-draggable", "");
    await pickUp(page, card);
    const plot = await boxOf(frame.locator(`${DOWN} [data-plan-plot]`));
    await page.mouse.move(plot.x + ((7 + 0.5) / DAYS) * plot.width, plot.y + plot.height / 2, { steps: 8 });
    await page.mouse.up();
    await settled(page);
    await expect(onPress("Order forms")).toHaveCount(1);
    await expect(pending).toHaveText("1 pending");
    await expect(backlog).toHaveText(/Backlog\s*3/);

    // The eye, on while the canvas holds the jobs a cell at a time: its answer one step, both jobs off the press and waiting.
    const eye = toolbar.locator("[data-optimise-button]");
    await expect(eye).toBeEnabled();
    await eye.click();
    const banner = frame.locator("[data-optimise-banner='done']");
    await expect(banner).toBeVisible({ timeout: 45_000 });
    await settled(page);
    await expect(banner.locator("[data-banner-body]")).toHaveText("2 changes: 2 removed. Undo or apply them like any edit.");
    await expect(onPress("Course handbooks")).toHaveCount(0);
    await expect(onPress("Order forms")).toHaveCount(0);
    await expect(backlog).toHaveText(/Backlog\s*5/);
    // The call saved nothing: the page has written no record.
    expect(await writes(page)).toBe(0);
    // During the highlight the legend says `Elara change`: its swatch, then its words 8px on, as the design's legend item
    // lays them out — never the words hard against the swatch.
    const legend = frame.locator("[data-frame-slot='footer'] [data-optimise-legend]");
    await expect(legend).toHaveText(/Elara change/i);
    const gap = await legend.evaluate((el) => {
        const swatch = el.querySelector("[data-optimise-swatch]")!.getBoundingClientRect();
        const words = [...el.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "")!;
        const range = document.createRange();
        range.selectNodeContents(words);
        return range.getBoundingClientRect().left - swatch.right;
    });
    expect(gap, "the room between the Elara change swatch and its words").toBeCloseTo(8, 0);

    // One Undo reverts the answer, the drag standing; Redo brings it back.
    await toolbar.getByRole("button", { name: "Undo", exact: true }).click();
    await settled(page);
    await expect(onPress("Course handbooks")).toHaveCount(1);
    await expect(onPress("Order forms")).toHaveCount(1);
    await expect(pending).toHaveText("1 pending");
    await expect(backlog).toHaveText(/Backlog\s*3/);
    await toolbar.getByRole("button", { name: "Redo", exact: true }).click();
    await settled(page);
    await expect(onPress("Order forms")).toHaveCount(0);
    expect(await writes(page)).toBe(0);

    // Save commits the drag and the answer together, in one write; read back from e3, both jobs wait in the backlog.
    await toolbar.getByRole("button", { name: "Save", exact: true }).click();
    await expect(pending).toHaveText("0 pending", { timeout: 30_000 });
    await settled(page);
    expect(await writes(page)).toBe(1);
    await expect(onPress("Course handbooks")).toHaveCount(0);
    await expect(onPress("Order forms")).toHaveCount(0);
    await expect(backlog).toHaveText(/Backlog\s*5/);
});
