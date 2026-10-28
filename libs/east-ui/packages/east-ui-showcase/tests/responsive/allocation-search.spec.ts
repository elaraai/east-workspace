/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * Search Records over the Allocation's bins (#1398) on the real in-page e3: a
 * bin the rail's narrowing hides says which choice hides it, as the rail words
 * it, and a pick of it clears just that choice and goes to the bin — every
 * lane's rows drawn again, the bin's row at its time, selected and brought
 * into the Table's view below its sticky head — in both themes.
 */
import { expect, test, type Locator, type Page } from "playwright/test";
import { open } from "./allocation-page";
import { recordField } from "./record-slice";
import { settled } from "./settle";

/** Search Records' input: the box in the row, or — folded to its icon — the one its popover opens. */
async function searchInput(page: Page, frame: Locator): Promise<Locator> {
    const item = frame.locator("[data-frame-slot='toolbar'] [data-toolbar-item='seek']");
    const icon = item.locator("[data-key-search='icon']");
    if (await icon.isVisible()) {
        await icon.click();
        return page.locator("[data-key-search='popover'] input");
    }
    return item.locator("[data-part='dataset-key-search'] input");
}

/** The lines the box lists — the listbox its input controls — as they read. */
const lines = (input: Locator) => input.evaluate((el) => {
    const list = document.getElementById(el.getAttribute("aria-controls") ?? "");
    return list === null ? [] : [...list.querySelectorAll('[role="option"]')].map((option) => option.textContent);
});

for (const theme of ["light", "dark"] as const) {
    test(`a bin the narrowing hides says which choice hides it; a pick clears just that choice and brings its row into view, selected (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const entry = await open(page, "allocationTable", theme);
        const frame = entry.locator("[data-allocation-frame]").first();
        const table = frame.locator("[data-allocation-table]");
        const lanes = async () => new Set(await table.locator("[data-allocation-row] > span:nth-child(2)").allTextContents());
        // The Table at the end of its day, then the south yard's bays chosen: B-3's rows alone.
        await table.locator("[data-virtual-rows]").first().evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await settled(page);
        const area = await recordField(page, frame, "area", "bays");
        await area.getByRole("button", { name: /^South/ }).click();
        await page.keyboard.press("Escape");
        await settled(page);
        expect(await lanes()).toEqual(new Set(["B-3"]));
        // 3001 stands in B-1: its line names the choice that hides it, as the rail words it.
        const input = await searchInput(page, frame);
        await input.pressSequentially("3001");
        await expect.poll(() => lines(input), { timeout: 15_000 })
            .toEqual(["3001 · LD-2201 · B-1 06:15 · Tue, May 4, 2027 · hidden by Area: South — picking it clears that filter"]);
        await input.press("Enter");
        await settled(page);
        // The Area cleared — every lane's rows drawn again — and the bin's row at its time, selected and in the Table's view.
        const row = table.locator('[data-allocation-row="bin:3001"]');
        await expect(row).toHaveAttribute("data-selected", "");
        await expect(row).toContainText("06:15");
        expect([...await lanes()].sort()).toEqual(["B-1", "B-2", "B-3"]);
        const inView = await row.evaluate((el) => {
            const pane = el.closest("[data-virtual-rows]")!, p = pane.getBoundingClientRect(), r = el.getBoundingClientRect();
            const head = pane.querySelector("[data-allocation-table-head]")!.getBoundingClientRect();
            return { below: r.top >= head.bottom - 0.5, above: r.bottom <= p.bottom + 0.5 };
        });
        expect(inView).toEqual({ below: true, above: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
}
