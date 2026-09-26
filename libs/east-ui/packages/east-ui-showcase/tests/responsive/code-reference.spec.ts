/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Code Reference language selector (#655): every program example offers
 * TypeScript / Python, the python view is the printing of the example's IR
 * (from the Claude plugin's index), each example's choice is its own,
 * `?lang=python` opens a page in python, and a Components page —
 * JSX-authored, no python surface — has no selector.
 *
 * Checks are scoped to the examples they are about: the doc list mounts rows
 * as it measures, so a page-wide count taken twice can differ for no reason
 * the spec is testing.
 */

import { test, expect } from "playwright/test";

const SELECTOR = '[data-testid="code-language"]';
const PYTHON_BLOCK = '[data-testid="code-source"][data-language="python"]';
const TYPESCRIPT_BLOCK = '[data-testid="code-source"][data-language="typescript"]';

test("Code Reference: TypeScript / Python on every example, each example's choice its own", async ({ page }) => {
    await page.goto("/#east");
    await page.waitForSelector("header", { timeout: 20_000 });
    // The doc list's entries (one example per row) that offer the selector.
    const selectable = page.locator("[data-index]").filter({ has: page.locator(SELECTOR) });
    const first = selectable.nth(0);
    const second = selectable.nth(1);
    await expect(second.locator(SELECTOR)).toBeVisible();

    // TypeScript first: the authored source.
    await expect(first.locator(TYPESCRIPT_BLOCK)).toContainText("East.function(");
    await expect(page.locator(PYTHON_BLOCK)).toHaveCount(0);

    // Python on ONE example: the same example printed from its IR by the
    // python printer — and only that example changes.
    await first.locator(SELECTOR).getByText("Python").click();
    const python = first.locator(PYTHON_BLOCK);
    await expect(python).toBeVisible();
    await expect(python).toContainText("from east import");
    await expect(python).toContainText("East.function(");
    await expect(first.locator(TYPESCRIPT_BLOCK)).toHaveCount(0);
    await expect(second.locator(TYPESCRIPT_BLOCK)).toHaveCount(1);
    await expect(page.locator(PYTHON_BLOCK)).toHaveCount(1);

    // Back to TypeScript on that example.
    await first.locator(SELECTOR).getByText("TypeScript").click();
    await expect(first.locator(TYPESCRIPT_BLOCK)).toHaveCount(1);
    await expect(page.locator(PYTHON_BLOCK)).toHaveCount(0);

    // `?lang=python` opens every example in python.
    await page.goto("/?lang=python#east-node-io");
    await page.waitForSelector("header", { timeout: 20_000 });
    await expect(page.locator(PYTHON_BLOCK).first()).toBeVisible();
    await expect(page.locator(TYPESCRIPT_BLOCK)).toHaveCount(0);
});

test("Components have no language selector — a JSX example has no python surface", async ({ page }) => {
    await page.goto("/#buttons");
    await page.waitForSelector("header", { timeout: 20_000 });
    // Once the page's examples have mounted, none offers a language.
    await expect(page.locator('a[href^="#buttons/"]').first()).toBeVisible();
    expect(await page.locator(SELECTOR).count()).toBe(0);
});
