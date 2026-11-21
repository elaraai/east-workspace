/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */

/**
 * Every Pagination draws the design system's (`parts-pagination`), measured
 * in a real browser over the catalog's pagers:
 *
 *  - P1 each page button and its previous and next triggers stand the size's
 *    height — 24 at `sm`, 32 at `md`, 40 at `lg` — the triggers a square of
 *    it, a button never narrower than one; each gap that marks the pages left
 *    out is 16 wide and as tall; the bar is as tall as they are.
 *  - P2 a pagination that declares neither size nor variant draws the design
 *    system's default, in both themes: `sm` and `outline` — each button on the
 *    paper with a 1px `--rule-strong` edge, mono 10.5 at 500 in `--ink-2`; the
 *    current page `--brand-tint`, its edge `--brand-d`, in `--brand-dd` at
 *    600; the first page's previous trigger disabled, `--ink-5` on a `--rule`
 *    edge; the gaps in `--ink-4`.
 *  - P3 `subtle` draws no edge and no paper, in `--ink-3`, the current page
 *    `--brand-tint` in `--brand-dd` with no edge; `outline` puts the edges back.
 *  - P4 `boundaries` are the pages at either end: one by default, two when it
 *    says two.
 *
 * Each colour is compared with its token's as the page resolves it in its
 * theme, so two tokens of one colour — `--ink-2` and `--brand-dd` in light —
 * never read as each other.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test pagination-sizes --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";

/** The catalog's configurator: one pager over 500 rows, its Variant, Size, Siblings and Boundaries axes. */
const CONFIGURATOR = "collections/pagination/paginationVariants";
/** The catalog's plain pager, declaring neither size nor variant. */
const BASIC = "collections/pagination/paginationBasic";

/** The design system's tokens a pager is drawn in, by their Chakra names. */
const TOKENS = ["border-strong", "border-subtle", "bg-surface", "fg-strong", "fg-muted", "fg-subtle", "fg-faint", "brand-tint", "brand-solid", "brand-pressed"] as const;

/** A token a pager is drawn in, or `none`: no colour. */
type Token = (typeof TOKENS)[number] | "none";

/** Opens a catalog entry in a theme, its pager drawn, at rest. */
async function openPager(page: Page, hash: string, theme: "light" | "dark" = "light"): Promise<Locator> {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`/?theme=${theme}#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-scope=pagination][data-part=item]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry;
}

/** Each token's colour as the page resolves it in its theme, in the form computed styles give a colour. */
const tokensOf = (page: Page) => page.evaluate((names) => {
    const resolved: Record<string, string> = { none: "rgba(0, 0, 0, 0)" };
    for (const name of names) {
        const probe = document.createElement("span");
        probe.style.color = `var(--chakra-colors-${name})`;
        document.body.appendChild(probe);
        resolved[name] = getComputedStyle(probe).color;
        probe.remove();
    }
    return resolved;
}, [...TOKENS]) as Promise<Record<Token, string>>;

/** The pager's parts as laid out: each button's height and the narrowest, each gap's and each trigger's box, and the bar's height. */
const partsOf = (entry: Locator) => entry.evaluate((root) => {
    const pager = root.querySelector("[data-scope=pagination][data-part=root]")!;
    const box = (el: Element) => {
        const b = el.getBoundingClientRect();
        return `${Math.round(b.width)}×${Math.round(b.height)}`;
    };
    const items = [...pager.querySelectorAll("[data-part=item]")];
    return {
        chips: [...new Set(items.map((el) => Math.round(el.getBoundingClientRect().height)))],
        narrowest: Math.min(...items.map((el) => Math.round(el.getBoundingClientRect().width))),
        runs: [...new Set([...pager.querySelectorAll("[data-part=ellipsis]")].map(box))],
        triggers: [box(pager.querySelector("[data-part=prev-trigger]")!), box(pager.querySelector("[data-part=next-trigger]")!)],
        bar: Math.round(pager.firstElementChild!.getBoundingClientRect().height),
    };
});

/**
 * How the pager's parts are drawn: a page button's and the current page's
 * edge, paper, ink, weight, size and family; the first page's previous
 * trigger's edge and ink; and a gap's ink.
 */
const lookOf = (entry: Locator) => entry.evaluate((root) => {
    const pager = root.querySelector("[data-scope=pagination][data-part=root]")!;
    const look = (el: Element) => {
        const s = getComputedStyle(el);
        return { edge: `${s.borderTopWidth} ${s.borderTopColor}`, paper: s.backgroundColor, ink: s.color, weight: s.fontWeight, size: s.fontSize, mono: s.fontFamily.includes("Mono") };
    };
    const items = [...pager.querySelectorAll("[data-part=item]")];
    const prev = getComputedStyle(pager.querySelector("[data-part=prev-trigger]")!);
    return {
        page: look(items.find((el) => !el.hasAttribute("data-selected"))!),
        current: look(items.find((el) => el.hasAttribute("data-selected"))!),
        prev: { edge: `${prev.borderTopWidth} ${prev.borderTopColor}`, ink: prev.color },
        gap: getComputedStyle(pager.querySelector("[data-part=ellipsis]")!).color,
    };
});

/** The look a page button is expected to have: a 1px edge, its paper and its ink in the tokens' colours, mono at its weight and size. */
function drawn(t: Record<Token, string>, edge: Token, paper: Token, ink: Token, weight: string, size: string) {
    return { edge: `1px ${t[edge]}`, paper: t[paper], ink: t[ink], weight, size, mono: true };
}

/** The strip as drawn: each page button's number, and `…` for each gap. */
const stripOf = (entry: Locator) => entry.evaluate((root) =>
    [...root.querySelectorAll("[data-scope=pagination] [data-part=item], [data-scope=pagination] [data-part=ellipsis]")]
        .map((el) => (el.getAttribute("data-part") === "ellipsis" ? "…" : (el.textContent ?? "").trim())));

test.describe("The Pagination is the design system's", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("P1: a pager stands its size's height — 24 at sm, 32 at md, 40 at lg — its triggers a square of it, each button at least one wide, each gap 16 wide and as tall", async ({ page }) => {
        const entry = await openPager(page, CONFIGURATOR);
        for (const [size, side] of [["SM", 24], ["MD", 32], ["LG", 40]] as const) {
            await entry.getByText(size, { exact: true }).click();
            await settled(page);
            await expect.poll(() => partsOf(entry), { message: `at ${size}` }).toEqual({
                chips: [side], narrowest: side, runs: [`16×${side}`], triggers: [`${side}×${side}`, `${side}×${side}`], bar: side,
            });
        }
    });

    for (const theme of ["light", "dark"] as const) {
        test(`P2 (${theme}): a pager that declares neither size nor variant is sm and outline — each button on the paper with a --rule-strong edge, mono 10.5 at 500 in --ink-2; the current page --brand-tint edged --brand-d in --brand-dd at 600; the first page's previous trigger --ink-5 on --rule; the gaps --ink-4`, async ({ page }) => {
            const entry = await openPager(page, BASIC, theme);
            const t = await tokensOf(page);
            expect(await partsOf(entry)).toEqual({ chips: [24], narrowest: 24, runs: ["16×24"], triggers: ["24×24", "24×24"], bar: 24 });
            await expect.poll(() => lookOf(entry)).toEqual({
                page: drawn(t, "border-strong", "bg-surface", "fg-strong", "500", "10.5px"),
                current: drawn(t, "brand-solid", "brand-tint", "brand-pressed", "600", "10.5px"),
                prev: { edge: `1px ${t["border-subtle"]}`, ink: t["fg-faint"] },
                gap: t["fg-subtle"],
            });
        });
    }

    test("P3: subtle draws no edge and no paper, in --ink-3, the current page --brand-tint in --brand-dd with no edge; outline puts the edges back", async ({ page }) => {
        const entry = await openPager(page, CONFIGURATOR);
        const t = await tokensOf(page);
        await entry.getByText("MD", { exact: true }).click();
        await entry.getByText("SUBTLE", { exact: true }).click();
        await settled(page);
        await expect.poll(async () => { const look = await lookOf(entry); return [look.page, look.current]; }).toEqual([
            drawn(t, "none", "none", "fg-muted", "500", "11px"),
            drawn(t, "none", "brand-tint", "brand-pressed", "600", "11px"),
        ]);
        await entry.getByText("OUTLINE", { exact: true }).click();
        await settled(page);
        await expect.poll(async () => { const look = await lookOf(entry); return [look.page.edge, look.current.edge]; }).toEqual([`1px ${t["border-strong"]}`, `1px ${t["brand-solid"]}`]);
    });

    test("P4: boundaries are the pages at either end — one by default, two when it says two", async ({ page }) => {
        const entry = await openPager(page, CONFIGURATOR);
        const boundaries = entry.locator("[data-scope='number-input'][data-part='input']").nth(1);
        await boundaries.fill("1");
        await boundaries.press("Tab");
        await settled(page);
        // Page 6 of 50, a sibling either side.
        await expect.poll(() => stripOf(entry)).toEqual(["1", "…", "5", "6", "7", "…", "50"]);
        await boundaries.fill("2");
        await boundaries.press("Tab");
        await settled(page);
        await expect.poll(() => stripOf(entry)).toEqual(["1", "2", "…", "5", "6", "7", "…", "49", "50"]);
    });
});
