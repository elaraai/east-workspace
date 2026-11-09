/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The rules a page adds to its styles, for the specs that hold a gesture to adding none (#1594): Chakra writes every
 * rule in a cascade layer, and in Chromium a rule added to a sheet with layers invalidates every font in the page, so a
 * rule first added as a drag starts has the page's styles worked out and all of it laid out again in that frame.
 */

import type { Page } from "playwright/test";

/**
 * Records every rule the page adds to its styles from before its first script: call before the page is loaded.
 *
 * @param page - The page
 */
export async function recordAddedRules(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const rules: string[] = [];
        Object.assign(window, { addedRules: rules });
        const insert = CSSStyleSheet.prototype.insertRule;
        CSSStyleSheet.prototype.insertRule = function (rule: string, index?: number) { rules.push(rule); return insert.call(this, rule, index); };
    });
}

/**
 * How many rules have been added to the page's styles.
 *
 * @param page - The page
 * @returns Their count
 */
export function addedCount(page: Page): Promise<number> {
    return page.evaluate(() => (window as unknown as { addedRules: string[] }).addedRules.length);
}

/**
 * The rules added to the page's styles since it held `from` of them, each as written.
 *
 * @param page - The page
 * @param from - The count to read from
 * @returns The rules
 */
export function addedSince(page: Page, from: number): Promise<string[]> {
    return page.evaluate((from) => (window as unknown as { addedRules: string[] }).addedRules.slice(from), from);
}
