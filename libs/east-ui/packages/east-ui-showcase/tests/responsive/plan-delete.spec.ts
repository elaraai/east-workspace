/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { test, expect } from "playwright/test";
import { PLAN_EVENT_EXAMPLES, remount } from "./plan-page";
import { PRESS_A1, dayOf, libraryOf, openCards, openPrintWorks, pickUp } from "./plan-builder-page";

// One real record/session flow, including the focus left behind by a pointer drop.
test("Plan Delete and Backspace remove existing and just-dropped events; typing is safe, Undo restores, Save survives remount", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard and pointer drop; the inspector is shared with the phone layout");
    let entry = await openPrintWorks(page, "pinned");
    const original = () => entry.locator(`${PRESS_A1} [data-run]`, { hasText: "Spring catalogue" });
    const pending = () => entry.locator('[data-plan-count="pending"]');
    const history = (name: string) => entry.getByRole("button", { name, exact: true });
    await original().click();
    await original().press("Delete");
    await expect(original()).toHaveCount(0);
    await expect(pending()).toHaveText("1 pending");
    await history("Undo").click();
    await expect(original()).toHaveCount(1);
    await original().click();
    const openInspector = entry.getByRole("button", { name: "Expand Inspector", exact: true });
    if (await openInspector.count() > 0) await openInspector.click();
    const customer = entry.locator('[data-field="customer"]').getByRole("textbox");
    await customer.focus();
    await customer.press("End");
    await customer.press("Delete");
    await expect(original()).toHaveCount(1);
    await expect(pending()).toHaveText("0 pending");
    await entry.locator('[data-inspector-action="delete"]').click();
    await expect(original()).toHaveCount(0);
    await history("Undo").click();
    await entry.getByRole("button", { name: "Collapse Inspector", exact: true }).click();

    const pane = libraryOf(entry);
    await pane.getByRole("tab", { name: /^Backlog/ }).click();
    const card = openCards(pane).first();
    await pickUp(page, card);
    const plot = entry.locator(`${PRESS_A1} [data-plan-plot]`);
    const on = await dayOf(plot, 7);
    await page.mouse.move(on.x, on.y, { steps: 8 });
    await expect(plot).toHaveAttribute("data-drop-active", "");
    await page.mouse.up();
    const selected = entry.locator('[data-run][aria-pressed="true"]');
    await expect(selected).toHaveCount(1);
    const key = await selected.getAttribute("data-run");
    const dropped = entry.locator(`[data-run=${JSON.stringify(key)}]`);
    await page.keyboard.press("Backspace");
    await expect(dropped).toHaveCount(0);
    await history("Undo").click();
    await expect(dropped).toHaveCount(1);
    await history("Discard").click();
    await expect(dropped).toHaveCount(0);

    await original().click();
    await original().press("Delete");
    await history("Save").click();
    await expect(pending()).toHaveText("0 pending", { timeout: 15_000 });
    entry = await remount(page, "planPrintWorks", PLAN_EVENT_EXAMPLES);
    await expect(original()).toHaveCount(0);
    await expect(entry.locator('[data-session-banner]')).toHaveCount(0);
});
