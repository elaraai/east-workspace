/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A number input whose host writes back each change, typed in a real
 * browser at a person's pace (#1211): the input configurator's Float —
 * precision 2, its value bound to `State` — typed `3.5` a key at a time reads
 * `3.5` while it is typed, and `3.50` at its precision once the focus leaves;
 * the State holds 3.5. Before the fix, the write-back of `3` rewrote the box
 * as `3.00` mid-entry, the `.` was lost, and the box read `35.00`; at rest it
 * showed no precision at all (`0` for 0).
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test number-input --project desktop`.
 */

import { test, expect } from "playwright/test";
import { settled } from "./settle";

const HASH = "forms/input/inputStyles";

test.describe("a number input written back per key (#1211)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "typed once, at the desktop width");

    test("typed 3.5 a key at a time at a person's pace, the Float reads 3.5, then 3.50 at its precision once the focus leaves", async ({ page }) => {
        await page.goto(`/?theme=light#${HASH}`);
        await page.waitForSelector("header", { timeout: 20_000 });
        const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
        await entry.scrollIntoViewIfNeeded();
        await settled(page);
        // The configurator's type: the Float, its value bound to State.
        await entry.locator("[data-scope=select][data-part=trigger]").first().click();
        await page.getByRole("option", { name: "float", exact: true }).click();
        const input = entry.getByRole("spinbutton").first();
        // At rest, at its precision.
        await expect(input).toHaveValue("0.00");
        await input.click();
        await input.press("ControlOrMeta+a");
        await input.press("Backspace");
        // 30 ms a key: each key lands after the host has written the number before it back.
        await input.pressSequentially("3.5", { delay: 30 });
        await expect(input).toHaveValue("3.5");
        // The focus leaves: the box shows its number at its precision.
        await input.press("Tab");
        await expect(input).toHaveValue("3.50");
        // The aside reads the bound value back.
        await expect(entry.getByText("Value: 3.5", { exact: true })).toBeVisible();
    });
});
