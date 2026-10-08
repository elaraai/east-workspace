/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A Plan example's page in the showcase: opening it at rest, naming its rows
 * the way the canvas names them, sizing the box its frame fills, mounting it
 * again over what its records hold, and reading its toolbar's ladder as the
 * box narrows.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { printFor, variant } from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";
import { settled } from "./settle";

/** The Plan's examples file in the catalog: e3-ui's (#1177), so under the e3
 *  section's `e3/` prefix — and drawn once the e3 the page runs has started. */
export const PLAN_EXAMPLES = "e3/plan/plan";

/** The examples file of the Plan of event kinds (#1191) in the catalog. */
export const PLAN_EVENT_EXAMPLES = "e3/plan/plan-events";

/** A row id's canonical text (#822), printed by East as the canvas prints it. */
export const printId = printFor(Plan.Types.RowId);

/** An entry row's id text — the series that made it and the path of keys to it. */
export const rowId = (series: string, ...path: string[]): string =>
    printId(variant("entry", { series, path }) as Parameters<typeof printId>[0]);

/** A row's element. `data-plan-row` holds the row's id as its canonical text
 *  (#822) — printed by East, so the selector is the id the example builds. */
export const rowSel = (series: string, ...path: string[]): string =>
    `[data-plan-row=${JSON.stringify(rowId(series, ...path))}]`;

/** Open one example's page and return its entry (the virtualized doc row
 *  holding its anchor and its live canvas) — a Plan example unless another
 *  examples file is named, in the light theme unless another is named. */
export async function openExample(page: Page, name: string, file = PLAN_EXAMPLES, theme: "light" | "dark" = "light"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${file}/${name}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${file}/${name}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-plan-body]").first()).toBeVisible({ timeout: 20_000 });
    // Charts and collections measure their containers before they settle.
    await settled(page);
    return entry;
}

/** The box a Plan's frame fills: its wrapper's host, which the page lays out (the wrapper itself does not). */
export const planBox = (entry: Locator): Locator => entry.locator("[data-plan-frame]").first().locator("xpath=..");

/** Sets a box's width, and waits for the page to be at rest. */
export async function sizeBox(page: Page, box: Locator, width: number): Promise<void> {
    await box.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
}

/**
 * Leaves an example's page for another e3 page and comes back to it, in the
 * same page — its e3 kept in memory — so the Plan mounts afresh over what its
 * records hold.
 *
 * @returns The example's entry, drawn and at rest
 */
export async function remount(page: Page, name: string, file: string): Promise<Locator> {
    const away = `${PLAN_EXAMPLES}/planTargetState`;
    await page.evaluate((h) => { location.hash = `#${h}`; }, away);
    await expect(page.locator("[data-index]", { has: page.locator(`a[href="#${away}"]`) }).locator("[data-plan-body]").first()).toBeVisible({ timeout: 20_000 });
    const hash = `${file}/${name}`;
    await page.evaluate((h) => { location.hash = `#${h}`; }, hash);
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-plan-body]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry;
}

/** The rail's clusters: every step of theirs folds before any of the Plan's own. */
const RAIL = ["cluster", "range"];

/**
 * What is wrong with a Plan's toolbar as its box narrows through `widths`,
 * widest first — each a line saying what, at which width: at every width one
 * 44px row, every item inside the band, nothing scrolled and nothing past the
 * row's edge; each item at the form the ladder's first folds put it; the
 * rail's steps first and the history item's last; and never fewer folds at a
 * narrower frame holding the same items (the narrow layout drops the grain).
 */
export async function toolbarLadderFaults(page: Page, entry: Locator, widths: readonly number[]): Promise<string[]> {
    const box = planBox(entry);
    const toolbar = entry.locator("[data-builder-frame] > [data-frame-slot='toolbar'] [data-toolbar]");
    const bad: string[] = [];
    let last: { keys: string; folds: number } | undefined;
    for (const width of widths) {
        await sizeBox(page, box, width);
        const at = await toolbar.evaluate((row) => {
            const band = row.closest("[data-frame-slot='toolbar']")!.getBoundingClientRect();
            const items = [...row.children].map((el) => el.getBoundingClientRect());
            return {
                state: row.getAttribute("data-toolbar-state") ?? "",
                ladder: row.getAttribute("data-toolbar-ladder") ?? "",
                folds: Number(row.getAttribute("data-toolbar-folds")),
                band: Math.round(band.height),
                inBand: items.every((b) => b.top >= band.top - 0.5 && b.bottom <= band.bottom + 0.5),
                scrolls: row.scrollWidth > row.clientWidth + 0.5,
                fits: items.every((b) => b.right <= row.getBoundingClientRect().right + 0.5),
            };
        });
        if (at.band !== 44 || !at.inBand || at.scrolls || !at.fits) {
            bad.push(`at ${width}px: band ${at.band}px, ${at.inBand ? "" : "an item out of the band, "}${at.scrolls ? "scrolled, " : ""}${at.fits ? "" : "past the row's edge"} — ${at.state}`);
        }
        const state = new Map(at.state.split(";").filter((p) => p !== "").map((p) => {
            const [key, of] = p.split("=");
            return [key!, Number(of!.split("/")[0])] as const;
        }));
        const ladder = at.ladder.split(" ").filter((s) => s !== "").map((s) => s.split(">")[0]!);
        // What it folded is its ladder's first steps, each item at the form they put it.
        for (const [key, form] of state) {
            const want = ladder.slice(0, at.folds).filter((k) => k === key).length;
            if (form !== want) bad.push(`at ${width}px: ${key} at form ${form}, where the ladder's first ${at.folds} steps put it at ${want}`);
        }
        // The rail's steps first; the history's last.
        const firstOwn = ladder.findIndex((k) => !RAIL.includes(k));
        if (firstOwn >= 0 && ladder.slice(firstOwn).some((k) => RAIL.includes(k))) bad.push(`at ${width}px: a rail step after the Plan's own — ${at.ladder}`);
        if (ladder.includes("history") && ladder[ladder.length - 1] !== "history") bad.push(`at ${width}px: the history item folds before the last step — ${at.ladder}`);
        // Never less folded at a narrower frame with the same items (the narrow layout drops the grain).
        const keys = [...state.keys()].join(",");
        if (last !== undefined && last.keys === keys && at.folds < last.folds) bad.push(`at ${width}px: ${at.folds} folds, fewer than the wider frame's ${last.folds}`);
        last = { keys, folds: at.folds };
    }
    return bad;
}
