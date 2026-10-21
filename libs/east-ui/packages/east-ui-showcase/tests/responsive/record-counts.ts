/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * How a builder's record rail counts its sources (#1358), read where it gives
 * them: the toolbar's summary, while it is in the row, or — folded after every
 * step of the rail — the rail's editor.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

/** A source's count as a spec expects the rail to give it. */
export interface SourceCount {
    /** The rows its narrowing shows. */
    readonly shown: number;
    /** Every row of its record. */
    readonly total: number;
    /** Whether a narrowing is in force on it: a choice, or the window its range holds. */
    readonly narrowed: boolean;
    /** The noun the summary counts it in (`production events`). */
    readonly noun: string;
}

/** A count as the app writes it; the specs' counts are under a thousand, so no digit grouping. */
const said = (n: number) => `${n}`;

/**
 * Waits for a record rail to count each source as given (#1358). While the
 * toolbar's summary is in the row it names each source a narrowing hides rows
 * of — `6 of 10 production events` — and no other. Folded after every step of
 * the rail, the rail's editor counts each source in its heading: the total, or
 * `N of M` while a narrowing is in force on it; a source with no heading —
 * no field of the rail's — in the line under the fields, named as the summary
 * names it, while a narrowing hides rows of it.
 *
 * @param page - The page
 * @param frame - The builder's frame
 * @param rail - The rail, in the toolbar's row
 * @param counts - Each source's count, by its name
 */
export async function expectSourceCounts(page: Page, frame: Locator, rail: string, counts: Readonly<Record<string, SourceCount>>): Promise<void> {
    const named = (count: SourceCount) => `${said(count.shown)} of ${said(count.total)} ${count.noun}`;
    const item = frame.locator('[data-frame-slot="toolbar"] [data-toolbar-item="record-summary"]');
    if (await item.count() > 0) {
        for (const [source, count] of Object.entries(counts)) {
            const line = item.locator(`[data-record-slices-summary] [data-record-slice-source="${source}"]`);
            if (count.shown < count.total) await expect(line, source).toHaveText(named(count));
            else await expect(line, `${source} hides nothing: unnamed`).toHaveCount(0);
        }
        return;
    }
    await frame.locator(`${rail} button[aria-label^="Filters:"]`).first().click();
    const editor = page.getByRole("dialog");
    await expect(editor).toHaveCount(1);
    for (const [source, count] of Object.entries(counts)) {
        const head = editor.locator(`[data-slice-group="source:${source}"]`);
        if (await head.count() > 0) {
            await expect(head.locator("[data-rail-group-count]"), source)
                .toHaveText(count.narrowed ? `${said(count.shown)} of ${said(count.total)}` : said(count.total));
        } else {
            const line = editor.locator(`[data-record-slices-summary] [data-record-slice-source="${source}"]`);
            if (count.shown < count.total) await expect(line, source).toHaveText(named(count));
            else await expect(line, `${source} hides nothing: unnamed`).toHaveCount(0);
        }
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await settled(page);
}
