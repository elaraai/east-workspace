/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Each of the Record's examples written to the e3 the page runs and read back
 * (`Record - DX Proposal.md` AD4, §9 item 10): a cell stepped, Save, the status
 * line's words once the batch is written, then the example let go and mounted
 * again — the value the record now holds, and nothing pending. The read-only
 * skills matrix writes nothing: it reads what the skills matrix wrote, the two
 * showing one record.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { leaveBuilder, visitBuilder } from "./builder-page";
import { test } from "./kept-page";
import { RECORD_ROOT } from "./record-page";

/** Each example that writes: the viewport it is a desktop's at, the cell a click steps, and its word for a row. */
const WRITES = [
    { name: "recordBasic", width: 1280, id: "C-001", key: "forklift", noun: "crew member" },
    { name: "recordSkillsMatrix", width: 1600, id: "P-0401", key: "intake", noun: "person" },
    { name: "recordShiftPreferences", width: 1600, id: "P-0401", key: "days", noun: "person" },
    { name: "recordEveryKind", width: 1600, id: "P-0401", key: "preference", noun: "operator" },
    { name: "recordLooks", width: 2160, id: "R-01", key: "forklift", noun: "person" },
] as const;

/** An example of the Record's, opened in the light theme or, mounted again, by its hash. */
const openOf = (page: Page, name: string, first: boolean): Promise<Locator> =>
    visitBuilder(page, `e3/record/record/${name}`, RECORD_ROOT, first ? "light" : undefined);

/** A cell of an example's, by its row's key and its column's. */
const cellOf = (entry: Locator, id: string, key: string): Locator =>
    entry.locator(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`);

/** Whatever a Record shows pending: a drafted cell, a draft row, an audit's Pending. */
const PENDING = '[data-record] [data-dirty], [data-record] [data-draft], [data-record] [data-slot="pending"]';

for (const write of WRITES) {
    test(`${write.name}: a stepped cell saved to e3, and read back once the example is mounted again — nothing pending @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: write.width, height: 1000 });
        const entry = await openOf(page, write.name, true);
        const cell = cellOf(entry, write.id, write.key);
        const was = (await cell.textContent()) ?? "";
        await cell.click();
        await expect(cell).toHaveAttribute("data-dirty", "");
        await expect(cell).not.toHaveText(was);
        const now = (await cell.textContent()) ?? "";
        // AD4: one batch, through the record's patch door.
        await entry.locator('[data-frame-slot="toolbar"] button[aria-label="Save"]').click();
        await expect(entry.locator('[data-frame-slot="toolbar"] [data-slot="status"]')).toHaveText(`Applied 1 change to 1 ${write.noun}`);
        await expect(entry.locator(PENDING)).toHaveCount(0);

        // Let go and mounted again: the record holds it.
        await leaveBuilder(page);
        const again = await openOf(page, write.name, false);
        await expect(cellOf(again, write.id, write.key)).toHaveText(now);
        await expect(again.locator(PENDING)).toHaveCount(0);

        if (write.name === "recordSkillsMatrix") {
            // The read-only matrix over the same record shows what the matrix wrote.
            await leaveBuilder(page);
            const readOnly = await openOf(page, "recordSkillsReadOnly", false);
            await expect(cellOf(readOnly, write.id, write.key)).toHaveText(now);
            await expect(readOnly.locator('[data-frame-slot="toolbar"] button[aria-label="Save"]')).toHaveCount(0);
        }
    });
}
