/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import { expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/**
 * Open the same field editor through whichever rung the shared rail exposes —
 * the field of `source`, given, on a rail whose sources share a field's name
 * (a Sheet's templates records, each with its `group`, #1345).
 */
export async function recordField(page: Page, frame: Locator, name: string, source?: string) {
    const field = source === undefined ? `[data-record-slice-field="${name}"]` : `[data-record-slice-source="${source}"][data-record-slice-field="${name}"]`;
    const trigger = frame.locator(`${field}:visible`);
    if (await trigger.count()) {
        if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
    }
    else {
        await frame.getByRole("button", { name: /^Filters:/ }).click();
        const disclosure = page.getByRole("dialog").locator(field);
        // The shared editor retains its disclosure when closed and reopened.
        if (await disclosure.getAttribute("aria-expanded") !== "true") await disclosure.click();
    }
    await expect(page.getByRole("dialog")).toHaveCount(1);
    const editor = page.locator(`[data-record-slice-editor="${name}"]:visible`);
    await expect(editor).toBeVisible();
    const sections = page.getByRole("dialog").locator("[data-slice-section]");
    if (await sections.count()) {
        await expect(page.getByRole("dialog").locator("[data-record-slice-editor]:visible")).toHaveCount(1);
        await expect(page.getByRole("dialog").locator(field)).toHaveCount(1);
    }
    return editor;
}

/** The viewport stays wide; the same field must work in a 294px parent. */
export async function containedRecordEditor(page: Page, frame: Locator, name: string) {
    await frame.evaluate(el => {
        const parent = el.parentElement!;
        parent.style.width = "294px";
        parent.style.maxWidth = "294px";
    });
    await settled(page);
    expect((await frame.boundingBox())!.width).toBeLessThanOrEqual(294);
    const toolbar = frame.locator('[data-frame-slot="toolbar"]');
    expect(await toolbar.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    const editor = await recordField(page, frame, name);
    if (name === "due") {
        await editor.getByRole("button", { name: "Custom", exact: true }).click();
        await editor.getByRole("button", { name: "Include time" }).click();
    }
    expect(await page.getByRole("dialog").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    if (name === "due") await editor.getByRole("button", { name: "Apply", exact: true }).click();
    await editor.getByRole("button", { name: /^Clear / }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
}
