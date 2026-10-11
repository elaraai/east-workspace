/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { expect, test } from "playwright/test";
import { containedRecordEditor, recordField } from "./record-slice";
import { settled } from "./settle";

for (const theme of ["light", "dark"] as const) for (const host of ["roster", "sheet", "plan"] as const) {
    test(`${host} bound record controls (${theme}) @narrow`, async ({ page }, info) => {
        const mobile = info.project.name !== "desktop";
        const name = `${host}RecordIndexes${mobile ? "Mobile" : ""}`;
        const route = `e3/${host}/${host}-records/${name}`;
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(`/?theme=${theme}#${route}`);
        const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${route}"]`) });
        await entry.scrollIntoViewIfNeeded();
        const frame = entry.locator(host === "roster" ? "[data-roster-frame]" : "[data-builder-frame]").first();
        await expect(frame).toBeVisible({ timeout: 30_000 });
        await settled(page);
        const id = host === "roster" ? "team" : "status";
        const first = host === "roster" ? "inbound" : "Ready";
        const next = host === "roster" ? "picking" : "Done";
        const main = frame.locator("[data-frame-slot=main]");
        const original = host === "roster"
            ? main.locator('[data-roster-assignment="s37"], [data-roster-card="s37"]').first()
            : host === "sheet" ? main.locator('[data-row-id="JOB-10000"]')
                : main.locator("[data-plan-row], [data-plan-card]").filter({ hasText: "JOB-10000" });
        await expect(original).toBeVisible();
        const coverage = host === "roster" ? await main.locator('[role="img"][aria-label]').evaluateAll(els => els.map(el => el.getAttribute("aria-label"))) : [];
        const editor = await recordField(page, frame, id);
        await editor.getByRole("button", { name: new RegExp(`^${next}`) }).click();
        await editor.getByRole("button", { name: new RegExp(`^${first}`) }).click();
        await expect(original).toHaveCount(0);
        await expect(page.getByRole("dialog")).toHaveCount(1);
        expect(await page.getByRole("dialog").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        expect(await editor.getByRole("button", { name: new RegExp(`^${next}`) }).evaluate(el => getComputedStyle(el).fontFamily)).toContain("Inter Tight");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await settled(page);
        if (host === "roster") {
            expect(await main.locator('[role="img"][aria-label]').evaluateAll(els => els.map(el => el.getAttribute("aria-label")))).toEqual(coverage);
        } else if (host === "sheet") {
            const statuses = main.locator('[data-row-id] [data-key="status"]');
            expect(await statuses.count()).toBeGreaterThan(0);
            expect(await statuses.allTextContents()).toEqual(Array(await statuses.count()).fill("Done"));
            // Two thousand stored rows must still have a bounded mounted window.
            expect(await main.locator("[data-row-id]").count()).toBeLessThan(100);
        } else {
            const rows = main.locator("[data-plan-row], [data-plan-card]");
            expect(await rows.count()).toBeGreaterThan(0);
            expect(await rows.count()).toBeLessThan(100);
            expect((await rows.allTextContents()).every(text => text.includes("Done"))).toBe(true);
        }
        expect(await frame.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        if (!mobile) {
            if (host === "plan") {
                const before = await main.innerText();
                const brush = frame.locator("[data-brush-track]");
                const box = (await brush.boundingBox())!;
                await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
                await page.mouse.down();
                await page.mouse.move(box.x + box.width * .65, box.y + box.height * .5, { steps: 12 });
                expect(await main.innerText()).toBe(before);
                await page.mouse.up();
                await expect.poll(() => main.innerText()).not.toBe(before);
            }
            await containedRecordEditor(page, frame, id);
        }
        expect(errors).toEqual([]);
    });
}
