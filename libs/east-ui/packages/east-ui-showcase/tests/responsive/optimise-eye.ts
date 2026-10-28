/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Elara eye in the five collection builders (#1409, #1422; `Optimise
 * Spec.md` §14) on the real in-page e3, in both themes: one more item of each
 * builder's one toolbar row, immediately before the history item in every
 * fold of the row at 1440 / 1024 / 768 / 390 / 360 (R6, R27); and a run from
 * the eye — the example's own optimiser on e3 — to the one history step and
 * its landing: the entries the run added marked and lit, the steady ring and
 * the dirty fill in the `elara` tokens and `brandTint` as the page resolves
 * them in the theme, the banner saying what changed; then back with one Undo,
 * which leaves no mark and no highlight (R7–R9, R13–R16).
 *
 * The checks are written here once; each builder's spec file
 * (`optimise-<builder>.spec.ts`) declares its own tests over them — Playwright
 * files a test under the file that calls `test`, so the tests are the spec
 * file's — and so belongs to its builder's suites in
 * `scripts/responsive-impact.ts`: a change to one builder's renderer runs the
 * eye's checks over that builder, not over every one.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { settled } from "./settle";

/** A builder's example with its optimiser, its root, and what the run adds as its entries draw it. */
export interface OptimiseBuilder {
    /** The example's route on the showcase's page. */
    readonly route: string;
    /** The builder's root, in its entry. */
    readonly root: string;
    /** The entries a run adds, as the builder draws them marked. */
    readonly added: string;
    /** Whether an added entry takes the dirty fill: one with no fill of its own. */
    readonly tinted: boolean;
    /** Whether the steady ring is inset, as on a Sheet cell. */
    readonly inset: boolean;
    /** Whether the Shifts layout is opened first: the Roster's, every duty of the day's slots a chip, none virtualised away. */
    readonly shifts: boolean;
}

/** Each builder's example with its optimiser, by the builder's name. */
export const OPTIMISE_BUILDERS = {
    Calendar: { route: "e3/calendar/optimise/calendarOptimise", root: "[data-calendar-frame]", added: "[data-calendar-event][data-op='add']", tinted: true, inset: false, shifts: false },
    Sheet: { route: "e3/sheet/optimise/sheetOptimise", root: "[data-builder-frame]", added: "[data-fill='cell'][data-op]", tinted: true, inset: true, shifts: false },
    Plan: { route: "e3/plan/optimise/planOptimise", root: "[data-plan-frame]", added: "[data-plan-body] [data-run][data-op='add']", tinted: false, inset: false, shifts: false },
    Allocation: { route: "e3/allocation/optimise/allocationOptimise", root: "[data-allocation-frame]", added: "[data-allocation-card][data-op='add']", tinted: false, inset: false, shifts: false },
    Roster: { route: "e3/roster/optimise/rosterOptimise", root: "[data-roster-frame]", added: "[data-roster-assignment][data-layout='shifts'][data-op='add']", tinted: false, inset: false, shifts: true },
} as const satisfies Record<string, OptimiseBuilder>;

/** The frame's widths, widest first: the five the spec names (§14). */
const WIDTHS = [1440, 1024, 768, 390, 360] as const;

/** The page: wide enough that a 1440px frame keeps clear of the doc column's "On this page" beside it. */
const PAGE = { width: 2560, height: 1200 } as const;

/**
 * The toolbar row at a width: each item that shows, in order; whether every one is inside the row; and whether the eye shows.
 */
function rowAt(row: Locator): Promise<{ items: (string | null)[]; inside: boolean; eye: boolean }> {
    return row.evaluate((toolbar) => {
        const r = toolbar.getBoundingClientRect();
        const items = [...toolbar.querySelectorAll<HTMLElement>("[data-toolbar-item]")].filter((el) => el.getBoundingClientRect().width > 0);
        const inside = items.every((el) => { const b = el.getBoundingClientRect(); return b.left >= r.left - 0.5 && b.right <= r.right + 0.5; });
        const eye = toolbar.querySelector("[data-optimise-button]");
        return { items: items.map((el) => el.getAttribute("data-toolbar-item")), inside, eye: eye !== null && eye.getBoundingClientRect().width > 0 };
    });
}

/**
 * The `optimise` recipe's steady ring, as the page resolves it in the theme: `0 0 0 1px elara.edge, 0 0 8px 1px
 * elara.soft` — inset on a Sheet cell — drawn on a probe and read back, so it compares with an entry's computed shadow
 * however the engine prints the colours.
 */
function steadyRing(page: Page, inset: boolean): Promise<string> {
    return page.evaluate((inset) => {
        const probe = document.createElement("span");
        probe.style.boxShadow = inset
            ? "inset 0 0 0 1px var(--chakra-colors-elara-edge), inset 0 0 8px 0 var(--chakra-colors-elara-soft)"
            : "0 0 0 1px var(--chakra-colors-elara-edge), 0 0 8px 1px var(--chakra-colors-elara-soft)";
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).boxShadow;
        probe.remove();
        return value;
    }, inset);
}

/** The dirty fill, `brandTint`, as the page resolves it in the theme (its variable is the token's path in kebab case). */
function dirtyFill(page: Page): Promise<string> {
    return page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.background = "var(--chakra-colors-brand-tint)";
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
    });
}

/** The themes each builder's checks run in. */
export const THEMES = ["light", "dark"] as const;

/** The title of the fold check, for a builder in a theme. */
export function eyeTitle(name: keyof typeof OPTIMISE_BUILDERS, theme: (typeof THEMES)[number]): string {
    return `${name}: the eye is one more item of the toolbar row, immediately before the history item in every fold at 1440 / 1024 / 768 / 390 / 360 (R6, R27) (${theme}) @desktop`;
}

/** The title of the run check, for a builder in a theme. */
export function runTitle(name: keyof typeof OPTIMISE_BUILDERS, theme: (typeof THEMES)[number]): string {
    return `${name}: a run from the eye lands as one step — its entries marked and lit in the elara tokens, the banner saying what changed — and one Undo takes it all back (R7–R9, R13–R16) (${theme}) @desktop`;
}

/**
 * The eye in every fold of the builder's toolbar row (R6, R27): shown, inside the row, and immediately before the
 * history item at each of the five widths.
 *
 * @param page - The page
 * @param builder - The builder's example
 * @param theme - The theme the page loads in
 */
export async function checkEyeInFolds(page: Page, builder: OptimiseBuilder, theme: (typeof THEMES)[number]): Promise<void> {
    await page.setViewportSize(PAGE);
    const entry = await visitBuilder(page, builder.route, builder.root, theme);
    const row = entry.locator(builder.root).first().locator("[data-frame-slot='toolbar'] [data-toolbar]").first();
    for (const width of WIDTHS) {
        await sizeBuilder(page, entry, builder.root, width);
        const at = await rowAt(row);
        expect(at.eye, `${width}px: the eye shows`).toBe(true);
        expect(at.inside, `${width}px: nothing past the row's end — ${at.items.join(" ")}`).toBe(true);
        expect(at.items.indexOf("history") - at.items.indexOf("optimise"), `${width}px: the eye immediately before the history item — ${at.items.join(" ")}`).toBe(1);
    }
}

/**
 * A run from the eye to its landing and back (R7–R9, R13–R16): one call of the example's optimiser on e3, its entries
 * marked and lit in the theme's tokens, the banner saying what changed, and one Undo taking it all back.
 *
 * @param page - The page
 * @param builder - The builder's example
 * @param theme - The theme the page loads in
 */
export async function checkRunFromEye(page: Page, builder: OptimiseBuilder, theme: (typeof THEMES)[number]): Promise<void> {
    await page.setViewportSize(PAGE);
    const entry = await visitBuilder(page, builder.route, builder.root, theme);
    await sizeBuilder(page, entry, builder.root, 1440);
    const frame = entry.locator(builder.root).first();
    const toolbar = frame.locator("[data-frame-slot='toolbar']");
    if (builder.shifts) { await toolbar.getByRole("radio", { name: "Shifts", exact: true }).click(); await settled(page); }
    const eye = toolbar.locator("[data-optimise-button]");
    await expect(eye).toBeEnabled({ timeout: 30_000 });
    // One call of the example's optimiser on e3: its answer the banner says, the highlight on.
    await eye.click();
    const banner = frame.locator("[data-optimise-banner='done']");
    await expect(banner).toBeVisible({ timeout: 45_000 });
    await settled(page);
    const lit = entry.locator("[data-optimise-lit]");
    await expect(lit).toHaveCount(1);
    await expect(banner.locator("[data-banner-title]")).toHaveText(/^Elara optimised /);
    await expect(banner.locator("[data-banner-body]")).toHaveText(/^\d+ changes?: .+\. Undo or apply them like any edit\.$/);
    const added = frame.locator(builder.added);
    expect(await added.count(), "the entries the run added, marked").toBeGreaterThan(0);
    // The landing settles once every flare and the totals' flash are done — 1500ms after the cascade and the
    // totals' delay (§8): only then is an entry's shadow the steady ring, not a flare's frame.
    await expect(entry.locator("[data-optimise-landing]")).toHaveCount(0, { timeout: 10_000 });
    // The highlight in the theme (§8, R16): the steady ring on every entry the run added, and the dirty fill on one with no fill of its own.
    const ring = await steadyRing(page, builder.inset);
    const shadows = await added.evaluateAll((all) => all.map((el) => getComputedStyle(el).boxShadow));
    expect(shadows.every((shadow) => shadow === ring), `the steady ring: ${shadows[0]} against ${ring}`).toBe(true);
    if (builder.tinted) {
        const tint = await dirtyFill(page);
        const fills = await added.evaluateAll((all) => all.map((el) => getComputedStyle(el).backgroundColor));
        expect(fills.every((fill) => fill === tint), `the dirty fill: ${fills[0]} against ${tint}`).toBe(true);
    }
    // The run is one step of the history: one Undo takes it all back, and ends the highlight — no mark is left.
    const undo = toolbar.getByRole("button", { name: "Undo", exact: true });
    await expect(undo).toBeEnabled();
    await undo.click();
    await settled(page);
    await expect(frame.locator("[data-op]")).toHaveCount(0);
    await expect(lit).toHaveCount(0);
    await expect(undo).toBeDisabled();
}
