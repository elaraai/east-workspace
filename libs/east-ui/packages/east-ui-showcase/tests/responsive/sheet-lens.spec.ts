/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * The Sheet's lens over a record (#1349) on the real in-page e3: the indexed
 * work orders (`sheetRecordIndexes`) open on the jobs ready — every third of
 * fifty thousand — drawn over the record's rows. At 1440, 1024, 768, 390 and
 * 360px, in both themes, in each pointer mode:
 * - each match at its row number — 1, 4, 7 — its number marked in the brand's
 *   ink at 600;
 * - between each two a gap of its exact size, `2 hidden`: a band 22px tall,
 *   32px on a coarse pointer, flush with the rows either side, a dashed rule
 *   across it in the strong rule's ink, and its pill in mono 9px in the subtle
 *   ink — its controls showing on the pill's hover, and resting open where
 *   nothing hovers;
 * - the count line, `16,667 matches`, in mono 10.5px in the subtle ink while
 *   the toolbar has room for it — on a 2160px window, beside the rail's every
 *   field — the row one 44px band with nothing past its edge, and the page no
 *   wider than the window.
 * Then, on a fine pointer, the context switch's ±1 draws the rows either side
 * of each match, their numbers unmarked, the count line counting them; and a
 * gap's +1 opens the row after a match.
 *
 * Measured in the page — never a screenshot.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { toolbarFaults } from "./builder-frame";
import { settled } from "./settle";

const HASH = "e3/sheet/sheet-records/sheetRecordIndexes";

/** The widths the lens is read at. */
const WIDTHS = [1440, 1024, 768, 390, 360] as const;

/** Opens the indexed work orders in a theme, at rest, its lens drawn. */
async function open(page: Page, theme: "light" | "dark"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${HASH}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-sheet-card]")).toBeVisible({ timeout: 30_000 });
    await settled(page);
    await expect.poll(() => drawn(entry), { timeout: 30_000 }).toEqual(["JOB-10000", "JOB-10003", "JOB-10006"]);
    return entry;
}

/** The first three rows the lens draws, by their ids. */
const drawn = (entry: Locator) => entry.locator('[data-frame-slot="main"] [data-slot="row"][data-row-id]')
    .evaluateAll((rows) => rows.slice(0, 3).map((row) => row.getAttribute("data-row-id")));

/** The theme's tokens the lens is drawn in, as the page resolves them. */
function tokens(page: Page) {
    return page.evaluate(() => {
        const colour = (name: string) => {
            const probe = document.createElement("span");
            probe.style.color = `var(${name})`;
            document.body.appendChild(probe);
            const c = getComputedStyle(probe).color;
            probe.remove();
            return c;
        };
        return { brand: colour("--chakra-colors-brand-solid"), subtle: colour("--chakra-colors-fg-subtle"), strong: colour("--chakra-colors-border-strong") };
    });
}

/** What the lens draws at the top of the record, and its toolbar's count, as the page lays them out. */
function readLens(entry: Locator) {
    return entry.evaluate((root) => {
        const main = root.querySelector('[data-frame-slot="main"]')!;
        const mono = (s: CSSStyleDeclaration) => /mono/i.test(s.fontFamily);
        const box = (el: Element) => el.getBoundingClientRect();
        /** To a tenth of a pixel, a negative zero made zero. */
        const tenth = (n: number) => Math.round(n * 10) / 10 + 0;
        // The body's first items, in the order the grid draws them: the rows and the gaps between them.
        const items = [...main.querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id], [data-slot="band"][data-band="lens"]')]
            .sort((a, b) => box(a).top - box(b).top).slice(0, 6);
        const rows = items.filter((el) => el.dataset["slot"] === "row");
        const numbers = rows.map((row) => {
            const number = row.querySelector('[data-slot="gutterNumber"]')!;
            const s = getComputedStyle(number);
            return { text: number.textContent, hit: number.hasAttribute("data-hit"), color: s.color, weight: s.fontWeight };
        });
        const gaps = items.flatMap((el, i) => {
            if (el.dataset["slot"] !== "band") return [];
            const b = box(el);
            const above = items[i - 1];
            const below = items[i + 1];
            const rule = getComputedStyle(el.firstElementChild!);
            const pill = el.querySelector<HTMLElement>('[data-slot="bandPill"]')!;
            const ps = getComputedStyle(pill);
            return [{
                hidden: el.dataset["hidden"],
                said: el.querySelector('[data-slot="bandCount"]')?.textContent ?? null,
                height: tenth(b.height),
                // How far it sits from the rows either side: flush is none.
                above: above === undefined ? null : tenth(b.top - box(above).bottom),
                below: below === undefined ? null : tenth(box(below).top - b.bottom),
                rule: { style: rule.borderTopStyle, color: rule.borderTopColor },
                pill: { mono: mono(ps), size: ps.fontSize, color: ps.color },
                controls: [...pill.querySelectorAll('[data-slot="bandControl"]')].map((c) => getComputedStyle(c).display),
            }];
        });
        const count = root.querySelector<HTMLElement>('[data-frame-slot="toolbar"] [data-slot="toolbarCount"]');
        const cs = count === null || count.getBoundingClientRect().width === 0 ? null : getComputedStyle(count);
        return {
            lens: main.querySelector("[data-sheet]")?.hasAttribute("data-lens") ?? false,
            ids: rows.map((row) => row.dataset["rowId"]),
            numbers,
            gaps,
            count: cs === null ? null : { text: count!.textContent, mono: mono(cs), size: cs.fontSize, color: cs.color },
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
}

for (const theme of ["light", "dark"] as const) {
    test(`at every width the lens draws each match at its row number, marked in the brand's ink, the rows between in a gap of their size — its band flush, its rule dashed, its pill in the band's type, its controls on hover or at rest where nothing hovers — and the count line in its type (${theme})`, async ({ page, isMobile }) => {
        // Wide, the row has room for the count line beside the rail's every field.
        await page.setViewportSize({ width: 2160, height: 900 });
        const entry = await open(page, theme);
        const frame = entry.locator("[data-builder-frame]").first();
        const T = await tokens(page);
        expect((await readLens(entry)).count, "2160px").toEqual({ text: "16,667 matches", mono: true, size: "10.5px", color: T.subtle });
        // On a coarse pointer the band is a touch's height, and nothing can hover its pill: its controls rest shown —
        // flex items of the pill, so they compute to `flex`.
        const bandPx = isMobile ? 32 : 22;
        for (const width of WIDTHS) {
            await page.setViewportSize({ width, height: 900 });
            await settled(page);
            await expect.poll(() => drawn(entry), { message: `${width}px`, timeout: 30_000 }).toEqual(["JOB-10000", "JOB-10003", "JOB-10006"]);
            const read = await readLens(entry);
            expect(read.lens, `${width}px: the sheet draws its lens`).toBe(true);
            expect(read.numbers, `${width}px: each match at its number, marked`).toEqual(["1", "4", "7"].map((text) => ({ text, hit: true, color: T.brand, weight: "600" })));
            expect(read.gaps.length, `${width}px: a gap between each two`).toBeGreaterThanOrEqual(2);
            for (const gap of read.gaps.slice(0, 2)) {
                expect(gap, `${width}px`).toEqual({
                    hidden: "2", said: "2 hidden", height: bandPx, above: 0, below: 0,
                    rule: { style: "dashed", color: T.strong },
                    pill: { mono: true, size: "9px", color: T.subtle },
                    controls: Array.from({ length: gap.controls.length }, () => (isMobile ? "flex" : "none")),
                });
                // Its +1 from either end, and all.
                expect(gap.controls.length, `${width}px: the gap's controls`).toBe(3);
            }
            // The count line in its type while the toolbar has room for it; the row one band, nothing past its edge.
            if (read.count !== null) expect(read.count, `${width}px`).toEqual({ text: "16,667 matches", mono: true, size: "10.5px", color: T.subtle });
            expect(await toolbarFaults(frame), `${width}px`).toEqual([]);
            expect(read.overflow, `${width}px: the page no wider than the window`).toBeLessThanOrEqual(0);
        }
        if (isMobile) return;
        // A fine pointer on a gap's pill shows its controls.
        const pill = entry.locator('[data-frame-slot="main"] [data-slot="band"][data-band="lens"] [data-slot="bandPill"]').first();
        await pill.hover();
        await expect(pill.locator('[data-slot="bandControl"]').first()).toHaveCSS("display", "flex");
    });
}

test("the context switch's ±1 draws the rows either side of each match, unmarked, and the count line counts them; ±0 folds them again, and a gap's +1 opens the row after a match @desktop", async ({ page }) => {
    // The sheet's box 1920px wide: room for the count line, its context counted too, beside the rail.
    await page.setViewportSize({ width: 2160, height: 900 });
    const entry = await open(page, "light");
    await entry.locator("[data-builder-frame]").first().locator("xpath=..").evaluate((el) => { (el as HTMLElement).style.width = "1920px"; });
    await settled(page);
    const T = await tokens(page);
    const main = entry.locator('[data-frame-slot="main"]');
    const ids = (n: number) => main.locator('[data-slot="row"][data-row-id]').evaluateAll((rows, k) => rows.slice(0, k).map((row) => row.getAttribute("data-row-id")), n);
    const option = (n: number) => entry.locator(`[data-frame-slot="toolbar"] [data-slot="contextOption"][data-context="${n}"]`);
    // ±1: every third ready, each with the row either side — the rows from the first run on unbroken.
    await option(1).click();
    await expect.poll(() => ids(8), { timeout: 30_000 }).toEqual(Array.from({ length: 8 }, (_x, i) => `JOB-${10000 + i}`));
    await expect(option(1)).toHaveAttribute("data-on", "");
    const read = await readLens(entry);
    expect(read.gaps, "no gap: every row is beside a match").toEqual([]);
    expect(read.numbers.map((n) => [n.text, n.hit])).toEqual([["1", true], ["2", false], ["3", false], ["4", true], ["5", false], ["6", false]]);
    // A row beside a match is unmarked: its number in the subtle ink, at the number's own weight.
    expect(read.numbers[1]).toEqual({ text: "2", hit: false, color: T.subtle, weight: "500" });
    expect(read.count?.text).toMatch(/^16,667 matches · [\d,]+ context$/);
    // ±0: the gaps again.
    await option(0).click();
    await expect.poll(() => ids(3), { timeout: 30_000 }).toEqual(["JOB-10000", "JOB-10003", "JOB-10006"]);
    expect((await readLens(entry)).count?.text).toBe("16,667 matches");
    // The first gap's +1 from its top opens the row after the first match.
    const gap = main.locator('[data-slot="band"][data-band="lens"]').first();
    await gap.locator('[data-slot="bandPill"]').hover();
    await gap.locator('[data-slot="bandControl"][data-where="top"]').click();
    await expect.poll(() => ids(3), { timeout: 30_000 }).toEqual(["JOB-10000", "JOB-10001", "JOB-10003"]);
    await expect(main.locator('[data-slot="band"][data-band="lens"]').first()).toHaveAttribute("data-hidden", "1");
    await settled(page);
});
