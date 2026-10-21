/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * The Allocation's fit and its history on the real in-page e3 (#1335, §3.4,
 * §12.4): every rank and reason the board shows is the app's `e3.function`,
 * run in the page's e3 — the kiln yard's `yard_fit`, a greedy look-ahead over
 * the built-in rules, and the bulk-kiln rule's `yard_bulk_fit` — and two years
 * of bins are read a day at a time. What answers is the e3 function, in
 * either theme, so each runs in one.
 */
import { expect, test, type Locator, type Page } from "playwright/test";
import { FILE, open, size } from "./allocation-page";
import { settled } from "./settle";

/** Opens another example of the file in the same page, by its hash, so the e3 the page runs keeps running. */
async function visit(page: Page, name: string): Promise<Locator> {
    await page.evaluate(key => { location.hash = key; }, `${FILE}/${name}`);
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${FILE}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-allocation-frame]").first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}

/** Picks a Library arrival card, as a click does (A9): the Inspector's drop list asks the fit for it (A23, A34). */
async function pick(page: Page, frame: Locator, arrival: string): Promise<Locator> {
    const card = frame.locator(`[data-allocation-library="arrivals"] [data-library-item="arrival:${arrival}"]`);
    await card.scrollIntoViewIfNeeded();
    await card.click(); await settled(page);
    return frame.locator('[data-allocation-inspector="details"] [data-allocation-drop-row]');
}

/** The drop list as it reads: its head's three lines, and each fit's rank, resource and reason, in rank order. */
function listOf(frame: Locator): Promise<{ head: string[]; fits: string[][] }> {
    return frame.locator('[data-allocation-inspector="details"]').evaluate((body) => ({
        head: [...body.querySelector("[data-allocation-drop-head]")!.children].map(line => line.textContent ?? ""),
        fits: [...body.querySelectorAll("[data-allocation-drop-row]")].map(row => [
            row.firstElementChild!.textContent ?? "", row.querySelector('[data-drop-row="name"]')!.textContent ?? "", row.querySelector('[data-drop-row="why"]')!.textContent ?? "",
        ]),
    }));
}

test(`§12.4, §3.4 — every fit the board shows is the app's e3.function, run in the page's e3: the yard's look-ahead, then a rule over the ready-made fit (light) @desktop`, async ({ page }) => {
    await page.setViewportSize({ width: 2160, height: 1200 });
    await test.step("allocationKilnYard: yard_fit", async () => {
        const entry = await open(page, "allocationKilnYard");
        await size(page, entry, 1440);
        const frame = entry.locator("[data-allocation-frame]").first();
        const rows = await pick(page, frame, "LD-2231");
        await expect(rows).toHaveCount(2);
        // The look-ahead's ranks and words (§12.4): K-601, the only fit for three of the day's other loads, ranks below K-107, each
        // reason saying what the placement leaves; the built-in rules alone would say neither. The basis is the yard's own words.
        expect(await listOf(frame)).toEqual({
            head: ["Gaps that fit", "LD-2231 · 21 m³", "8-day hold from Tue 11 · ranked by load, kind and spare days, and what it leaves for the day's other loads"],
            fits: [
                ["1", "K-107", "0 d spare to Wed 19 · leaves 21 m³ · takes 12–24 · leaves 1 load with no fit"],
                ["2", "K-601", "open gap · leaves 21 m³ · min 40 · 19 short · leaves 2 loads with no fit"],
            ],
        });
        await page.keyboard.press("Escape"); await settled(page);
        await expect(rows).toHaveCount(0);
    });
    await test.step("allocationFitRule: yard_bulk_fit", async () => {
        const entry = await visit(page, "allocationFitRule");
        await size(page, entry, 1440);
        const frame = entry.locator("[data-allocation-frame]").first();
        const rows = await pick(page, frame, "LD-2235");
        await expect(rows).toHaveCount(1);
        // The rule refuses K-601, which the built-in rules take under its minimum: LD-2235 (8 m³) fits K-305 alone, under the rule's basis.
        expect(await listOf(frame)).toEqual({
            head: ["Gaps that fit", "LD-2235 · 8 m³", "9-day hold from Tue 11 · ranked by load, kind and spare days; bulk kilns take 20 m³ and more"],
            fits: [["1", "K-305", "0 d spare to Thu 20 · leaves 8 m³ · takes 4–10"]],
        });
    });
});

test(`§3.4, A2 — two years of bins read a day at a time on e3: a day back is published, the picker marks each day of the month it opens on, and forward again the draft (light) @desktop`, async ({ page }) => {
    await page.setViewportSize({ width: 2160, height: 1200 });
    const entry = await open(page, "allocationWindowed");
    await size(page, entry, 1440);
    const frame = entry.locator("[data-allocation-frame]").first();
    const toolbar = frame.locator('[data-frame-slot="toolbar"]');
    const status = toolbar.locator("[data-allocation-status]");
    // The summary's Bins count: what the day the board reads holds.
    const bins = frame.locator('[data-allocation-stat="Bins"] > :nth-child(2)');
    await expect(status).toHaveText("Draft");
    await expect(bins).toHaveText("26");
    await toolbar.getByRole("button", { name: "Previous day", exact: true }).click(); await settled(page);
    await expect(status).toHaveText("Published");
    await expect(bins).toHaveText("4");
    // The picker reads the month it opens on: May's days to Mon 10 published, Tue 11 the draft, the days after not started.
    await toolbar.getByRole("button", { name: "Choose plan day" }).click();
    const picker = page.getByRole("dialog");
    const mark = (iso: string) => picker.locator(`[data-time-day="${Date.parse(iso)}"] [data-state]`);
    await expect(mark("2027-05-10T00:00:00Z")).toHaveAttribute("data-state", "published");
    await expect(mark("2027-05-11T00:00:00Z")).toHaveAttribute("data-state", "draft");
    await expect(mark("2027-05-12T00:00:00Z")).toHaveAttribute("data-state", "empty");
    // A month back, read as the picker browses to it: every day published.
    await picker.getByRole("button", { name: "Previous month", exact: true }).click(); await settled(page);
    await expect(mark("2027-04-01T00:00:00Z")).toHaveAttribute("data-state", "published");
    await expect(mark("2027-04-30T00:00:00Z")).toHaveAttribute("data-state", "published");
    await page.keyboard.press("Escape"); await settled(page);
    await expect(picker).toHaveCount(0);
    // Forward again: the draft, as the record holds it.
    await toolbar.getByRole("button", { name: "Next day", exact: true }).click(); await settled(page);
    await expect(status).toHaveText("Draft");
    await expect(bins).toHaveText("26");
});
