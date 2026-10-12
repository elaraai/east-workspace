/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { openFlowchart } from "./flowchart-page";
import { recordField } from "./record-slice";
import { settled } from "./settle";

/** Open one pane, including the shared overlay layout on phones. */
async function pane(root: Locator, name: "Library" | "Inspector") {
    const other = root.getByRole("button", { name: `Collapse ${name === "Library" ? "Inspector" : "Library"}`, exact: true });
    if (await other.isVisible()) await other.click();
    const expand = root.getByRole("button", { name: `Expand ${name}`, exact: true });
    if (await expand.isVisible()) await expand.click();
}

async function search(page: Page, root: Locator, prefix: string) {
    const editor = await recordField(page, root, "description");
    const input = editor.getByPlaceholder("Search flows…");
    await input.fill(prefix);
    await page.getByRole("option", { name: new RegExp(`All starting with “${prefix}”`) }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await settled(page);
}

// One cold workspace per device, then the whole query/edit/paging lifecycle.
// Covers the real e3 index and mutation doors, not an in-memory filtered list.
test("Flowchart indexed records page, search and retain drafts @narrow", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const { root } = await openFlowchart(page, "flowchartRecordIndexes");
    const save = root.locator("[data-toolbar-item='history'] [data-slot='history'] button").last();
    const toolbar = root.locator("[data-toolbar]");
    await expect.poll(() => toolbar.evaluate(el => {
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll("button")].every(button => {
            const rect = button.getBoundingClientRect();
            return rect.left >= box.left && rect.right <= box.right;
        });
    })).toBe(true);
    const view = root.getByRole("button", { name: "View", exact: true });
    if (await view.isVisible()) {
        await view.click();
        const stateSearch = page.getByPlaceholder("Find state");
        await stateSearch.click();
        await expect(page.getByRole("option", { name: "ARV · Arrived", exact: true })).toBeVisible();
        await page.getByRole("option", { name: "ARV · Arrived", exact: true }).click();
        await expect(root.locator('[data-flowchart-node="ARV"]')).toHaveAttribute("data-selected", "true");
        await page.getByRole("radio", { name: "TD", exact: true }).click();
        await page.getByRole("radio", { name: "LR", exact: true }).click();
        await page.keyboard.press("Escape");
    }
    // The 44px collapsed rail uses the shared compact formatter and keeps
    // its exact count. Long localized values are contained by the recipe.
    await pane(root, "Library");
    await root.getByRole("button", { name: "Collapse Library", exact: true }).click();
    const badge = root.locator("[data-frame-slot='start'] [data-dock-badge]");
    await expect(badge).toHaveAttribute("title", "2,048");
    await expect(badge.locator("[aria-hidden]")).toHaveText("2K");
    await expect.poll(() => badge.evaluate(el => {
        const box = el.getBoundingClientRect();
        const rail = el.closest("[data-collapsed]")!.getBoundingClientRect();
        return box.left >= rail.left && box.right <= rail.right && getComputedStyle(el).textOverflow === "ellipsis";
    })).toBe(true);

    const list = root.locator("[data-library-paged]");
    const cards = list.locator("[data-library-item]");
    await pane(root, "Library");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeLessThan(50);
    await expect.poll(() => cards.evaluateAll(elements => elements.slice(0, -1).every((el, i) =>
        el.getBoundingClientRect().bottom <= elements[i + 1]!.getBoundingClientRect().top))).toBe(true);
    const scroll = list.locator("[data-virtual-rows]");
    await expect(scroll).toHaveCount(1);
    await scroll.evaluate(el => { el.scrollTop = 40000; });
    await expect.poll(() => cards.first().getAttribute("data-library-item")).not.toBe("FLOW-10000");
    await expect(cards.first()).not.toHaveAttribute("data-library-item", "");
    expect(await cards.count()).toBeLessThan(50);

    // A computed integer uses the shared range editor. Editing the graph
    // changes the maintained key in the same Save as its primary record.
    const count = await recordField(page, root, "stateCount");
    await count.getByRole("textbox", { name: "State count from", exact: true }).fill("4");
    await count.getByRole("textbox", { name: "State count until", exact: true }).fill("5");
    await count.getByRole("button", { name: "Apply", exact: true }).click();
    await page.keyboard.press("Escape");
    await pane(root, "Library");
    await expect(cards.first()).toHaveAttribute("data-library-item", "FLOW-10001");
    await cards.first().click();
    for (const name of ["Library", "Inspector"]) {
        const close = root.getByRole("button", { name: `Collapse ${name}`, exact: true });
        if (await close.isVisible()) await close.click();
    }
    await expect(root.locator("[data-flowchart-node]")).toHaveCount(4);
    await root.locator('[data-flowchart-node="CHK"]').click();
    await page.keyboard.press("Delete");
    await expect(root.locator("[data-flowchart-node]")).toHaveCount(3);
    await save.click();
    await expect(save).toBeDisabled();
    await expect(root.locator("[data-record-save-notice]")).toHaveText("1 flow left this view");
    await expect(root.locator("[data-flowchart-flow]")).toHaveText("FLOW-10001");

    // Nested values use exact membership. Selecting an incompatible path
    // replaces the earlier range explicitly, rather than scanning rows.
    const lane = await recordField(page, root, "lane");
    await lane.getByPlaceholder("Search lane…").fill("rev");
    await expect(page.getByRole("option", { name: /^review/ })).toContainText("1,536");
    await page.getByRole("option", { name: /^review/ }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await pane(root, "Library");
    await expect(cards.first()).toHaveAttribute("data-library-item", "FLOW-10001");
    const owner = await recordField(page, root, "decisionOwner");
    await owner.getByPlaceholder("Search decision owner…").fill("customs");
    await page.getByRole("option", { name: /^customs-desk/ }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await pane(root, "Library");
    await expect(cards.first()).toHaveAttribute("data-library-item", "FLOW-10004");

    await search(page, root, "Inbound");
    await pane(root, "Library");
    await expect(cards.first()).toHaveAttribute("data-library-item", "FLOW-10000");
    await cards.first().click();
    await pane(root, "Inspector");
    const description = root.getByRole("textbox", { name: /^Description(?: description)?$/ });
    await expect(description).toHaveValue("Inbound parcels");
    await description.fill("Returns");
    await description.press("Tab");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(save).toBeDisabled();
    await expect(root.locator("[data-record-save-notice]")).toHaveText("1 flow left this view");
    await expect(root.locator("[data-flowchart-flow]")).toHaveText("FLOW-10000");
    await expect(description).toHaveValue("Returns");

    await search(page, root, "Returns");
    await pane(root, "Library");
    await expect(cards.first()).toHaveAttribute("data-library-item", "FLOW-10000");
    await cards.first().click();
    await pane(root, "Inspector");
    await description.fill("Draft kept through paging");
    await description.press("Tab");
    await expect(save).toBeEnabled();
    await pane(root, "Library");
    await cards.nth(1).click();
    await expect(root.locator("[data-flowchart-flow]")).not.toHaveText("FLOW-10000");
    await cards.first().click();
    await pane(root, "Inspector");
    await expect(description).toHaveValue("Draft kept through paging");
    await expect(save).toBeEnabled();
    expect(errors).toEqual([]);
    expect(await root.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});
