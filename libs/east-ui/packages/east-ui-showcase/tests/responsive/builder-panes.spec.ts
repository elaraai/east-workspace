/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Every builder's panes, measured in a real browser (#1210): a pane's tab row
 * draws each of its tabs inside the row and clear of its collapse control —
 * the counts leave the row first, then the trailing tabs fold into a `+n`
 * menu, the open tab always on the row — on each builder the showcase holds:
 * Studio's, the query builder's, the Sheet's frame (#1216), the Plan's
 * library (#1195) and inspector (#1197), and the Flowchart's library — its
 * Steps, Transitions and Lanes tabs beside the author's owners (#1248, #1501)
 * — and its inspector, on by default (#1250). At the desktop width
 * the panes are measured open, as they rest; on a phone each is opened from
 * its tab and measured over the frame, and where its row folds, a tap on its
 * `+n` opens the menu, which stays open, and a tab picked from it opens on
 * the row (#1235). An overlay pane opened by a press on its rail's tile,
 * which is no control and takes no focus of its own, takes the focus, so Esc
 * closes it (#1584). Each pane's control stands still as it collapses and
 * expands — the library's at the start of its open row, over its rail's, the
 * inspector's at the end — and a press on its row's room collapses it, as a
 * press on its rail or its rail's bar expands it. Every measurement is polled
 * until it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test builder-panes --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
import { LAYOUT_THEMES } from "./themes";
import { dockControlOf, pressDock } from "./dock-control";

/**
 * A builder the showcase holds: its example, what shows once it is at rest,
 * the box its own spec sizes (the frame's parent when `null`) and to what
 * width, its panes by name, and the panes whose tab rows fold on the phone.
 */
interface BuilderPage {
    readonly name: string;
    readonly hash: string;
    readonly ready: string;
    readonly box: string | null;
    readonly width: number;
    readonly panes: readonly string[];
    readonly folds: readonly string[];
}

const BUILDERS: readonly BuilderPage[] = [
    { name: "Studio's builder", hash: "e3/studio/studio/studioBuilder", ready: "[data-snap-grid-tile]", box: "[data-studio-builder]", width: 1440, panes: ["Components", "Inspector"], folds: [] },
    { name: "the query builder", hash: "e3/query/query/queryBuilder", ready: "[data-query-results-view]", box: "[data-query-builder]", width: 1240, panes: ["Query"], folds: [] },
    { name: "the Sheet", hash: "e3/sheet/sheet/sheetWorkshop", ready: "[data-sheet-card]", box: null, width: 1440, panes: ["Library", "Inspector"], folds: [] },
    // The Plan's frame fills its wrapper, which its host bounds: the host is the box sized.
    { name: "the Plan", hash: "e3/plan/plan-events/planPrintWorks", ready: "[data-plan-body]", box: ":has(> [data-plan-frame])", width: 1440, panes: ["Library", "Inspector"], folds: ["Library"] },
    // Four tabs — the Steps, Transitions and Lanes tabs and the author's owners — fold on the phone (#1248, #1501).
    { name: "the Flowchart", hash: "e3/flowchart/flowchart/flowchartDepot", ready: "[data-flowchart-node]", box: null, width: 1440, panes: ["Library", "Inspector"], folds: ["Library"] },
];

/**
 * Open a builder's example and return its frame, at rest: sized as its own
 * spec sizes it, where its panes are pinned open beside main, or, with
 * `sized` false, as the page lays it out.
 */
async function openFrame(page: Page, builder: BuilderPage, theme: "light" | "dark", sized = true): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${builder.hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${builder.hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const frame = entry.locator("[data-builder-frame]").first();
    await expect(frame.locator(builder.ready).first()).toBeVisible({ timeout: 20_000 });
    if (sized) {
        const box = builder.box === null ? frame.locator("xpath=..") : entry.locator(builder.box).first();
        await box.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, builder.width);
    }
    await settled(page);
    return frame;
}

/**
 * Each open pane's tab row, as the page draws it: the pane, by its collapse
 * control's name, the tabs on the row, and what runs past the row's room for
 * them — a tab or the `+n` menu starting before it or ending past it, under
 * the collapse control or off the row — or a tab list wider than its box.
 */
function tabRowsOf(frame: Locator) {
    return frame.evaluate((root) => [...root.querySelectorAll("[data-frame-slot=start], [data-frame-slot=end]")].flatMap((slot) => {
        const pane = slot.querySelector("[data-orientation][data-side][data-surface]");
        if (pane === null || pane.hasAttribute("data-collapsed")) return [];
        const row = pane.firstElementChild!;
        const toggle = row.querySelector(":scope > button[aria-expanded]");
        const r = row.getBoundingClientRect();
        // The tabs' room: the row, less its collapse control — at its start on a pane pinned to the start, else at its end
        // — and, where the control leads, less the row's own padding at its end: the tabs' box ends there.
        const leads = toggle !== null && row.firstElementChild === toggle;
        const t = toggle?.getBoundingClientRect();
        const start = leads ? t!.right : r.left;
        const end = t === undefined ? r.right : leads ? (row.querySelector("[data-dock-tabs]") ?? row).getBoundingClientRect().right : t.left;
        const tabs = [...row.querySelectorAll('[role="tab"]')];
        const more = row.querySelector("[data-dock-more]");
        const past: string[] = [];
        for (const el of more === null ? tabs : [...tabs, more]) {
            const b = el.getBoundingClientRect();
            const what = el === more ? "the +n menu" : `"${el.textContent}"`;
            if (b.left < start - 0.5) past.push(`${what} starts ${Math.round(start - b.left)}px ${leads ? "under the collapse control" : "before the row"}`);
            if (b.right > end + 0.5) past.push(`${what} runs ${Math.round(b.right - end)}px ${leads || t === undefined ? "past the row" : "under the collapse control"}`);
        }
        const list = row.querySelector('[role="tablist"]');
        if (list !== null && list.scrollWidth > list.clientWidth + 0.5) past.push(`the tab list is ${list.scrollWidth - list.clientWidth}px wider than its box`);
        return [{ pane: toggle?.getAttribute("aria-label") ?? "", tabs: tabs.map((t) => t.getAttribute("aria-label") ?? t.textContent), past }];
    }));
}

test.describe("every builder pane's tab row fits its pane (#1210)", { tag: "@desktop" }, () => {
    const batches = [BUILDERS.slice(0, 3), BUILDERS.slice(3)];
    for (const theme of LAYOUT_THEMES) {
        for (const batch of batches) {
            test(`${batch.map(builder => builder.name).join(", ")}: tabs stay clear of collapse controls (${theme})`, async ({ page }) => {
                for (const builder of batch) await test.step(builder.name, async () => {
                    const frame = await openFrame(page, builder, theme);
                    await expect.poll(async () => (await tabRowsOf(frame)).map(({ pane, past }) => ({ pane, past })))
                        .toEqual(builder.panes.map((name) => ({ pane: `Collapse ${name}`, past: [] })));
                });
            });
        }
    }
});

test.describe("every builder pane's control stands still as it collapses and expands, and its row and its rail each toggle it", { tag: "@desktop" }, () => {
    for (const builder of BUILDERS) {
        test(`${builder.name}: ${builder.panes.join(" and ")}`, async ({ page }) => {
            const frame = await openFrame(page, builder, "light");
            for (const name of builder.panes) await test.step(name, async () => {
                const slot = frame.locator("[data-frame-slot=start], [data-frame-slot=end]", { has: page.getByRole("button", { name: `Collapse ${name}`, exact: true }) });
                const side = await slot.getAttribute("data-frame-slot");
                const pane = frame.locator(`[data-frame-slot=${side}] [data-orientation][data-side][data-surface]`).first();
                const rest = await dockControlOf(pane);
                // Collapsed by its control, opened from its rail's bar, collapsed by its row, opened from its rail.
                for (const press of ["control", "bar", "row", "rail"] as const) await pressDock(page, pane, rest, press);
            });
        });
    }
});

test("an overlay pane opened by a press on its rail's tile takes the focus, so Esc, pressed next, closes it and gives the focus back to its rail (#1584) @desktop", async ({ page }) => {
    // The Sheet's frame at 700px: both its panes overlay, each closed on its rail.
    const frame = await openFrame(page, { ...BUILDERS.find((builder) => builder.name === "the Sheet")!, width: 700 }, "light");
    const end = frame.locator('[data-frame-slot="end"]');
    await expect(end).toHaveAttribute("data-collapsed", "");
    const focus = () => end.evaluate((slot) => ({
        open: !slot.hasAttribute("data-collapsed"),
        inPane: slot.contains(document.activeElement),
        on: document.activeElement?.getAttribute("aria-label") ?? null,
    }));
    // The tile under the rail's control: a press there focuses nothing, the browser's or the pane's own.
    await end.locator('[data-surface] > [title="Inspector"]').click();
    await settled(page);
    await expect.poll(async () => { const at = await focus(); return [at.open, at.inPane]; }).toEqual([true, true]);
    await page.keyboard.press("Escape");
    await settled(page);
    await expect.poll(focus).toEqual({ open: false, inPane: true, on: "Expand Inspector" });
});

test.describe("every builder pane's tab row fits its pane, on a phone (#1210)", { tag: "@mobile" }, () => {

    for (const builder of BUILDERS) {
        test(`${builder.name}: each pane, opened from its tab, its tabs inside its tab row, clear of the collapse control; a folded tab opens from the +n menu`, async ({ page }) => {
            const frame = await openFrame(page, builder, "light", false);
            for (const name of builder.panes) {
                await frame.locator("[data-pane-tab]", { hasText: name }).click();
                await settled(page);
                const rows = async () => (await tabRowsOf(frame)).map(({ pane, past }) => ({ pane, past }));
                await expect.poll(rows).toEqual([{ pane: `Collapse ${name}`, past: [] }]);
                const slot = frame.locator("[data-frame-slot]", { has: page.getByRole("button", { name: `Collapse ${name}` }) });
                const more = slot.locator("[data-dock-more]");
                await expect(more).toHaveCount(builder.folds.includes(name) ? 1 : 0);
                if (builder.folds.includes(name)) {
                    // Tapped, the menu stays open. It is the page's first, so Chromium
                    // fires a font event as it inserts the menu's styles, and the row
                    // measures again while the menu is open (#1235).
                    await more.tap();
                    const menu = page.getByRole("menu");
                    await expect(menu).toBeVisible();
                    await settled(page);
                    await expect(menu).toBeVisible();
                    // A tab picked from it opens on the row, which still fits.
                    const item = menu.getByRole("menuitem").first();
                    const tab = (await item.textContent()) ?? "";
                    await item.tap();
                    await expect(page.locator('[role="menu"]')).toHaveCount(0);
                    await expect(slot.getByRole("tab", { name: tab, exact: true, selected: true })).toBeVisible();
                    await settled(page);
                    await expect.poll(rows).toEqual([{ pane: `Collapse ${name}`, past: [] }]);
                }
                await frame.getByRole("button", { name: `Collapse ${name}` }).click();
                await settled(page);
            }
        });
    }
});
