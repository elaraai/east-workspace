/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Words that stand in a toolbar's row with no control around them stand on
 * the line of the chips beside them (#1775), in a real browser, as a toolbar
 * is only mid-gesture — at rest, every example's row is read by
 * `box-rows.spec.ts`:
 *
 * - what a Save is doing, which the history bar every builder mounts says
 *   before its buttons: while the Save is out, and while what it saved is read
 *   back — measured in the Plan's toolbar beside its overlaps chip, whose
 *   face, size and place under the row's top the words share;
 * - the same words in a phone's second row, where they stand in the place of
 *   the drafts' count, as it stood — measured over the Sheet's work orders;
 * - the Record's last gesture, said in its toolbar once a Save has landed.
 *
 * Left on the line they inherit, a row centres such words at a fraction of a
 * pixel — "Saving…" stood a pixel and a quarter above the chip beside it — and
 * the page paints them a row higher or lower by where it stands the toolbar.
 *
 * A Save is held on its way by the showcase's fault hook, so its words stand
 * until the test lets it go: every wait is a poll on the page's state.
 *
 * Run: `pnpm exec playwright test toolbar-words`.
 */

import { expect, test, type Locator } from "playwright/test";
import { expectWholeBoxWords } from "./box-words";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { holdE3, installE3Faults, releaseE3, RECORD_READS, type FaultMatch } from "./e3-faults";
import { OPTIMISE_BUILDERS } from "./optimise-eye";
import { cellOf, RECORD_ROOT } from "./record-page";
import { settled } from "./settle";

/** What a builder reads back of what it saved: its record's reads, and the reads of a dataset whole, its status, its history and its description. */
const READS_BACK: NonNullable<FaultMatch["kinds"]> = [...RECORD_READS, "read", "history", "describe", "dataset-status"];

/** Where words stand in the row they are in. Words of one face at one size that start as far under the row's top stand on one baseline. */
interface Standing {
    /** Their face. */
    face: string;
    /** Their size. */
    size: string;
    /** How far under the row's top they start, to the 64th of a pixel the page lays out in. */
    under: number;
}

/**
 * Reads where a part's first words stand in the row around it.
 *
 * @param part - The part: a chip, the words a Save says, the drafts' count
 * @param row - The row, by its selector: the nearest around the part
 * @returns Their face and size, and how far under the row's top they start
 */
function standing(part: Locator, row = "[data-toolbar]"): Promise<Standing> {
    return part.evaluate((el, row) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node !== null && (node.textContent ?? "").trim() === "") node = walker.nextNode();
        const around = el.closest(row);
        if (node === null || around === null) throw new Error(`the part holds no words, or stands in no ${row}`);
        const words = document.createRange();
        words.selectNodeContents(node);
        const style = getComputedStyle(node.parentElement!);
        return { face: style.fontFamily, size: style.fontSize, under: Math.round((words.getBoundingClientRect().top - around.getBoundingClientRect().top) * 64) / 64 };
    }, row);
}

test("while a Save is out, and while what it saved is read back, the history bar's words stand as the chip beside them: its face, its size, as far under the row's top @desktop", async ({ page }) => {
    await installE3Faults(page);
    // Wide enough that a 1440px frame keeps clear of the doc column's "On this page" beside it.
    await page.setViewportSize({ width: 2560, height: 1200 });
    const plan = OPTIMISE_BUILDERS.Plan;
    const entry = await visitBuilder(page, plan.route, plan.root, "light");
    await sizeBuilder(page, entry, plan.root, 1440);
    const toolbar = entry.locator(plan.root).first().locator("[data-frame-slot='toolbar']");
    const row = toolbar.locator("[data-toolbar]").first();
    // Drafts to save: a run from the eye lands as them.
    const eye = toolbar.locator("[data-optimise-button]");
    await expect(eye).toBeEnabled({ timeout: 30_000 });
    await eye.click();
    await expect(entry.locator("[data-optimise-banner='done']")).toBeVisible({ timeout: 45_000 });
    await settled(page);
    const chip = row.locator("[data-plan-overlaps]");
    await expect(chip).toBeVisible();
    const line = await standing(chip);

    // The Save out, held on its way.
    const save = await holdE3(page, { kinds: ["mutate"] });
    await toolbar.getByRole("button", { name: "Save", exact: true }).click();
    const said = toolbar.locator("[data-slot='history'] [role='status']");
    await expect(said).toHaveText("Saving…");
    expect(await standing(said), "while the Save is out").toEqual(line);
    await expectWholeBoxWords(row, "the Plan's toolbar row while a Save is out");

    // It lands with the reads of what it saved held: the words say so, where they stood.
    const reads = await holdE3(page, { kinds: READS_BACK });
    await releaseE3(page, save);
    await expect(said).toHaveText("Saved — reading it back…", { timeout: 15_000 });
    expect(await standing(said), "while what it saved is read back").toEqual(line);
    await releaseE3(page, reads);
    await expect(said).toHaveCount(0, { timeout: 15_000 });
});

test("in a phone's second row, what a Save is doing stands where the drafts' count stood: its face, its size, as far under the row's top @desktop", async ({ page }) => {
    await installE3Faults(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const orders = OPTIMISE_BUILDERS.Sheet;
    const entry = await visitBuilder(page, orders.route, orders.root, "light");
    const frame = entry.locator(orders.root).first();
    // A draft, typed where the frame is wide enough for its grid.
    const job = frame.locator("[data-frame-slot=main] [data-slot='row'][data-row-id='WO-1001'] [data-key='job']");
    await job.dblclick();
    const input = page.locator("[data-slot='editorInput']");
    await input.fill("Cut side panels");
    await input.press("Enter");
    await expect(job).toHaveText("Cut side panels");
    // A phone's frame: the history in its second row, the drafts' count at the row's start.
    await page.setViewportSize({ width: 560, height: 900 });
    await settled(page);
    await expect(frame).toHaveAttribute("data-phone", "");
    const row = frame.locator("[data-frame-slot='sessionRow']");
    const summary = row.locator("[data-history-summary]");
    await expect(summary).toHaveAttribute("data-history-summary", "count");
    const count = await standing(summary, "[data-frame-slot='sessionRow']");

    const save = await holdE3(page, { kinds: ["mutate"] });
    await row.getByRole("button", { name: "Save", exact: true }).click();
    await expect(summary).toHaveText("Saving…");
    expect(await standing(summary, "[data-frame-slot='sessionRow']")).toEqual(count);
    await releaseE3(page, save);
    await expect(summary).toHaveAttribute("data-history-summary", "count", { timeout: 15_000 });
});

test("the Record's last gesture stands on the toolbar's line once a Save has landed: a chip's size, as far under the row's top as a chip's words @desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    const entry = await visitBuilder(page, "e3/record/record/recordBasic", RECORD_ROOT, "light");
    const cell = cellOf(entry, "C-001", "forklift");
    await cell.click();
    await expect(cell).toHaveAttribute("data-dirty", "");
    const toolbar = entry.locator("[data-frame-slot='toolbar']");
    await toolbar.locator("button[aria-label='Save']").click();
    const said = toolbar.locator("[data-slot='status']");
    await expect(said).toHaveText("Applied 1 change to 1 crew member");
    // Where a chip in a toolbar's row sets its words, at a chip's size (`one-line-words.spec.ts`).
    expect(await standing(said)).toMatchObject({ size: "11.5px", under: 7 });
    await expectWholeBoxWords(toolbar.locator("[data-toolbar]").first(), "the Record's toolbar row once a Save has landed");
});
