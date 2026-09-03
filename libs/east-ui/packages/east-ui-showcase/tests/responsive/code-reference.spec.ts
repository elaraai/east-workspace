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
 */

import { test, expect } from "playwright/test";

const SELECTOR = '[data-testid="code-language"]';
const PYTHON_BLOCK = '[data-testid="code-source"][data-language="python"]';
const TYPESCRIPT_BLOCK = '[data-testid="code-source"][data-language="typescript"]';

test("Code Reference: TypeScript / Python on every example, each example's choice its own", async ({ page }, testInfo) => {
    await page.goto("/#east");
    await page.waitForSelector("header", { timeout: 20_000 });
    await expect(page.locator(SELECTOR).first()).toBeVisible();
    expect(await page.locator(SELECTOR).count()).toBeGreaterThan(1);

    // TypeScript first: the authored source.
    await expect(page.locator(TYPESCRIPT_BLOCK).first()).toContainText("East.function(");
    expect(await page.locator(PYTHON_BLOCK).count()).toBe(0);

    // Python on ONE example: the same example printed from its IR by the
    // python printer — and only that example changes.
    const typescriptBefore = await page.locator(TYPESCRIPT_BLOCK).count();
    await page.locator(SELECTOR).first().getByText("Python").click();
    const python = page.locator(PYTHON_BLOCK).first();
    await expect(python).toBeVisible();
    await expect(python).toContainText("from east import");
    await expect(python).toContainText("East.function(");
    expect(await page.locator(PYTHON_BLOCK).count()).toBe(1);
    expect(await page.locator(TYPESCRIPT_BLOCK).count()).toBe(typescriptBefore - 1);
    await page.screenshot({ path: testInfo.outputPath("code-reference-python.png") });

    // Back to TypeScript on that example.
    await page.locator(SELECTOR).first().getByText("TypeScript").click();
    expect(await page.locator(PYTHON_BLOCK).count()).toBe(0);

    // `?lang=python` opens every example in python.
    await page.goto("/?lang=python#east-node-io");
    await page.waitForSelector("header", { timeout: 20_000 });
    await expect(page.locator(PYTHON_BLOCK).first()).toBeVisible();
    expect(await page.locator(TYPESCRIPT_BLOCK).count()).toBe(0);
});

test("Components have no language selector — a JSX example has no python surface", async ({ page }) => {
    await page.goto("/#buttons");
    await page.waitForSelector("header", { timeout: 20_000 });
    await page.waitForTimeout(500);
    expect(await page.locator(SELECTOR).count()).toBe(0);
});
