/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Flowchart's indexed flows on the real in-page e3 (#1246, #1346): one
 * rail over the record's `flows` source, the Flows tab paging what it narrows
 * the record to. One cold workspace per device runs the whole query, edit and
 * paging lifecycle; and at every width, in both themes, the Flows tab — or the
 * collapsed pane's badge — counts what the rail shows (`Flows 683 of 2,048`),
 * its count in the type its whole count has, the rail folding first and the
 * row whole, and the tab's own search finds a flow by its name within the
 * narrowing, the rail and the count as they were.
 */
import { expect, test, type Locator, type Page } from "playwright/test";
import { toolbarFaults } from "./builder-frame";
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
    // The frame's toolbar: the Flows tab's search has a row of its own.
    const toolbar = root.locator("[data-frame-slot='toolbar'] [data-toolbar]");
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

/** Sets the width of the flowchart's box, and waits for the page at rest. */
async function widthTo(page: Page, root: Locator, width: number) {
    await root.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
}

/** Chooses one description through the rail's field editor: the flows of that description, exactly. */
async function chooseDescription(page: Page, root: Locator, description: string) {
    const editor = await recordField(page, root, "description");
    await editor.getByPlaceholder("Search flows…").fill(description.split(" ")[0]!);
    await page.getByRole("option", { name: new RegExp(`^${description}`) }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await settled(page);
}

for (const theme of ["light", "dark"] as const) {
    test(`the Flows tab counts what the rail's flows source shows — \`Flows 683 of 2,048\`, in the type its whole count has — at every width and in a 294px frame, or, the pane on its rail, its badge; the rail folds first, and the tab's own search finds within the narrowing (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const { root } = await openFlowchart(page, "flowchartRecordIndexes", theme);
        await widthTo(page, root, 1920);
        await pane(root, "Library");
        const start = root.locator("[data-frame-slot='start']");
        const tab = start.locator("[role='tab']");
        const cards = start.locator("[data-library-paged] [data-library-item]");
        const keys = () => cards.evaluateAll((els) => els.map((el) => el.getAttribute("data-library-item")));
        const countType = () => start.locator("[role='tab'] [data-tab-count]").evaluate((count) => {
            const s = getComputedStyle(count);
            return [s.fontFamily, s.fontSize, s.fontWeight, s.letterSpacing, s.color, s.fontVariantNumeric].join(" ");
        });
        await expect(tab).toHaveText(["Flows 2,048"]);
        const whole = await countType();
        // The inbound flows, every third: the rail's flows source narrows the Flows tab, which pages and counts them.
        await chooseDescription(page, root, "Inbound parcels");
        await pane(root, "Library");
        await expect(tab).toHaveText(["Flows 683 of 2,048"]);
        await expect.poll(async () => (await keys()).slice(0, 3)).toEqual(["FLOW-10000", "FLOW-10003", "FLOW-10006"]);
        expect(await countType(), "the narrowed count in the whole count's type").toBe(whole);
        // The tab's own search, by name, within the narrowing: the inbound flows of FLOW-10500 to FLOW-10509, the rail and the count as they were.
        const box = start.getByRole("textbox", { name: "Search flows by name" });
        await expect(box).toHaveAttribute("placeholder", "Search 683 flows by name…");
        await box.fill("FLOW-1050");
        await expect.poll(keys).toEqual(["FLOW-10501", "FLOW-10504", "FLOW-10507"]);
        await expect(start.locator("[data-library-search-hidden]")).toHaveText("680 hidden by filter · Show all");
        await expect(tab).toHaveText(["Flows 683 of 2,048"]);
        await box.fill("");
        await expect.poll(async () => (await keys())[0]).toBe("FLOW-10000");
        // At every width the Flows tab says what it shows — or, the pane on its 44px rail, its badge counts it — the rail folding first, the row whole.
        for (const width of [1920, 1440, 1024, 768, 390, 360, 294]) {
            await widthTo(page, root, width);
            const read = await start.evaluate((el) => (el.hasAttribute("data-collapsed")
                ? { collapsed: true, said: el.querySelector("[data-dock-badge]")?.getAttribute("title") ?? null }
                : { collapsed: false, said: el.querySelector("[role='tab']")?.textContent ?? null }));
            expect(read.said, `${width}px, ${read.collapsed ? "collapsed" : "open"}`).toBe(read.collapsed ? "683" : "Flows 683 of 2,048");
            expect(await toolbarFaults(root), `${width}px`).toEqual([]);
            const ladder = await root.locator("[data-frame-slot='toolbar'] [data-toolbar]").getAttribute("data-toolbar-ladder");
            expect(ladder, `${width}px: the rail and its summary fold first`).toMatch(/^(record-slices>\d+ )+record-summary>1 /);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
}
