/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The key hints (east-workspace#1743), in the Sheet's workshop and the
 * Record's crew: on a phone, which has no keys to press, neither the strip nor
 * the footer names one. At a desktop's width the footer at rest names
 * `⌘C / ⌘V` alone, and a strip's keys give way first — whole or not at all,
 * none beside suggestions the strip has to page, and none while the Record's
 * words are cut.
 *
 * Run: `pnpm exec playwright test key-hints`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { visitBuilder } from "./builder-page";
import { settled } from "./settle";

const ROOT = "[data-builder-frame]";
const WORKSHOP = "e3/sheet/sheet/sheetWorkshop";
const CREW = "e3/record/record/recordBasic";

/** An example on the page, at rest with its rows drawn. */
async function open(page: Page, route: string): Promise<Locator> {
    const entry = await visitBuilder(page, route, ROOT, "light");
    await expect(entry.locator('[data-slot="row"]').first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}

/** What a strip's keys show: their words, whether all of them stand inside the strip, and whether its words are cut beside them. */
interface KeysDrawn {
    /** The words shown, or `undefined` where the strip shows none — not drawn, or wrapped out of its one line. */
    readonly words: string | undefined;
    readonly whole: boolean;
    readonly textCut: boolean;
    readonly paged: boolean;
}

function keysOf(strip: Locator): Promise<KeysDrawn> {
    return strip.evaluate((el): KeysDrawn => {
        const keys = el.querySelector<HTMLElement>('[data-slot="stripKeys"]');
        const text = el.querySelector<HTMLElement>('[data-slot="stripText"]');
        const textCut = text !== null && text.scrollWidth > text.clientWidth + 1;
        const paged = el.hasAttribute("data-paged");
        if (keys === null || (keys.textContent ?? "") === "") return { words: undefined, whole: true, textCut, paged };
        // The words' own box: a key wrapped out of the strip's one line stands under it, where the strip hides it.
        const range = document.createRange();
        range.selectNodeContents(keys);
        const words = range.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        const inside = (r: DOMRect) => r.width > 0 && r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
        if (words.top >= box.bottom - 0.5) return { words: undefined, whole: true, textCut, paged };
        return { words: keys.textContent ?? "", whole: inside(words), textCut, paged };
    });
}

/** The footer's key hint: its hints, each whole. */
const footerHints = (entry: Locator) => entry.locator('[data-slot="footerHint"] [data-footer-unit]').allTextContents();

test.describe("The key hints (east-workspace#1743)", () => {
    test("on a phone neither strip nor footer names a key: the workshop's footer, its strip at a cell, and the crew's strip at a cycle @mobile", async ({ page }) => {
        const workshop = await open(page, WORKSHOP);
        expect(await footerHints(workshop)).toEqual([]);
        await workshop.locator('[data-slot="row"] [data-slot="cell"]').first().click();
        await settled(page);
        expect(await workshop.locator('[data-slot="stripKeys"]').count()).toBe(0);
        const crew = await open(page, CREW);
        await crew.locator('[data-record] [data-slot="row"] [data-slot="cell"][data-key="forklift"]').first().click();
        await settled(page);
        await expect(crew.locator("[data-record-strip]")).toBeVisible();
        expect(await crew.locator('[data-record-strip] [data-slot="stripKeys"]').count()).toBe(0);
    });

    test("at a desktop's width the footer names ⌘C / ⌘V alone, and a link editor's keys show whole or not at all, never beside suggestions the strip pages @desktop", async ({ page }) => {
        const workshop = await open(page, WORKSHOP);
        expect(await footerHints(workshop)).toEqual(["⌘C / ⌘V round-trips with Excel"]);
        const cell = workshop.locator('[data-slot="row"] [data-slot="cell"][data-key="machines"]').first();
        await cell.dblclick();
        const input = cell.locator('[data-slot="editorInput"]');
        await expect(input).toBeFocused();
        const strip = workshop.locator('[data-slot="strip"]').first();
        for (const typed of ["S", "E2"]) {
            await input.fill(typed);
            await settled(page);
            await expect(strip.locator('[data-slot="stripChip"]').first()).toBeVisible();
            const keys = await keysOf(strip);
            expect(keys.whole, `"${typed}": ${keys.words}`).toBe(true);
            if (keys.paged) expect(keys.words, `"${typed}": paged`).toBeUndefined();
        }
    });

    test("at a desktop's width the crew's strip names a cycle's keys whole or not at all, never while its words are cut, and a title none @desktop", async ({ page }) => {
        const crew = await open(page, CREW);
        const strip = crew.locator("[data-record-strip]");
        await crew.locator('[data-record] [data-slot="row"] [data-slot="cell"][data-key="forklift"]').first().hover();
        await settled(page);
        const cycle = await keysOf(strip);
        expect(cycle.whole, `${cycle.words}`).toBe(true);
        if (cycle.words !== undefined) expect(cycle.textCut, `"${cycle.words}" beside cut words`).toBe(false);
        await crew.locator('[data-record] [data-slot="row"] [data-slot="cell"][data-key="name"]').first().hover();
        await settled(page);
        expect((await keysOf(strip)).words).toBeUndefined();
    });
});
