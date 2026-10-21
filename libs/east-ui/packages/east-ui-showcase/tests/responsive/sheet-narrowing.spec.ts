/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 */
/**
 * The Sheet's narrowing (#1345) on the real in-page e3: the workshop's one
 * rail over its orders — the sheet's rows, paged from it — and its operation
 * and order templates, each a record of its own. At every width, in both
 * themes, the rail stands in the toolbar's one row, nothing leaving it, and
 * every source's field is in it: live, folded to its chip, or named by its one
 * trigger. An order status chosen through it narrows the grid's orders and no
 * tab; the operation templates' group narrows the Rows tab, `Rows 5 of 11`,
 * whatever the orders show, its count in the type every tab's count has; and
 * at every width the Rows tab, or the collapsed pane's badge, counts what it
 * shows.
 *
 * On a phone — at 390px, at 360px and in a 294px frame — the workshop's row
 * and the indexed work orders' (`sheetRecordIndexesMobile`) hold the rail's
 * trigger and Save, each clickable: the views fold with the key search into
 * its popover, its views over the search box, where they still switch views
 * and `+ TAB` still snapshots one, and Search Records still seeks.
 */
import { expect, test, type Locator, type Page } from "playwright/test";
import { toolbarFaults } from "./builder-frame";
import { recordField } from "./record-slice";
import { settled } from "./settle";

const HASH = "e3/sheet/sheet/sheetWorkshop";
/** The rail, in the toolbar's row. */
const RAIL = '[data-frame-slot="toolbar"] [data-slice-rail="record-slices"]';
/** The rail's fields, as `source.field`, sorted: the orders' status and customer, and each templates record's group. */
const FIELDS = "groupTemplates.group,rowTemplates.group,rows.customer,rows.status";

/** Opens a Sheet example in a theme, at rest. */
async function open(page: Page, theme: "light" | "dark", hash = HASH): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${hash}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-sheet-card]")).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}

/** Sets the width of the box the sheet's frame fills, and waits for the page at rest. */
async function size(page: Page, entry: Locator, width: number): Promise<void> {
    await entry.locator("[data-builder-frame]").first().locator("xpath=..").evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
}

/**
 * Every source's field as the rail shows it at its width: a live chip, a
 * folded chip (`field:source.field`), or past those its one trigger, named for
 * every field it holds.
 */
const railFields = (frame: Locator) => frame.locator(RAIL).first().evaluate((rail) => {
    const live = [...rail.querySelectorAll("[data-record-slice-source][data-record-slice-field]")].filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => `${el.getAttribute("data-record-slice-source")}.${el.getAttribute("data-record-slice-field")}`);
    const folded = [...rail.querySelectorAll("[data-slice-fold^='field:']")].map((el) => el.getAttribute("data-slice-fold")!.slice(6));
    const trigger = rail.querySelector("button[aria-label^='Filters:']")?.getAttribute("aria-label") ?? "";
    return { fields: [...new Set([...live, ...folded])].sort().join(), named: /Status/.test(trigger) && /Customer/.test(trigger) && /Group/.test(trigger) };
});

for (const theme of ["light", "dark"] as const) {
    test(`the one rail stands at every width, nothing leaving the toolbar, every source's field in it (${theme}) @narrow`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1080 });
        const entry = await open(page, theme);
        const frame = entry.locator("[data-builder-frame]").first();
        for (const width of [1920, 1440, 1024, 768, 390, 360, 294]) {
            await size(page, entry, width);
            expect(await toolbarFaults(frame), `${width}px`).toEqual([]);
            await expect(frame.locator(RAIL).first(), `${width}px`).toBeVisible();
            const shown = await railFields(frame);
            expect(shown.named || shown.fields === FIELDS, `${width}px: ${JSON.stringify(shown)}`).toBe(true);
        }
    });

    test(`an order status chosen through the rail narrows the grid's orders; the operation templates' group, the Rows tab — \`Rows 5 of 11\`, its count in every tab count's type — at every width, or, the pane on its rail, its badge (${theme}) @desktop`, async ({ page }) => {
        await page.setViewportSize({ width: 2160, height: 1200 });
        const entry = await open(page, theme);
        await size(page, entry, 1920);
        const frame = entry.locator("[data-builder-frame]").first();
        const start = frame.locator('[data-frame-slot="start"]');
        const bands = () => frame.locator('[data-frame-slot="main"] [data-slot="row"][data-band-row]').evaluateAll((els) => els.map((el) => el.getAttribute("data-row-id")));
        const choose = async (source: string, field: string, value: RegExp) => {
            await frame.locator(`${RAIL} [data-record-slice-source="${source}"][data-record-slice-field="${field}"]`).first().click();
            await page.getByRole("dialog").getByRole("button", { name: value }).first().click();
            await page.keyboard.press("Escape");
            await expect(page.getByRole("dialog")).toHaveCount(0);
            await settled(page);
        };
        await expect(start.locator('[role="tab"]')).toHaveText(["Rows 11", "Statuses 3", "Columns 6"]);
        // The orders on hold — one, WO-2204: the rows source narrows the grid, and no tab.
        await choose("rows", "status", /^ON HOLD/);
        await expect.poll(bands).toEqual(["WO-2204"]);
        await expect(start.locator('[role="tab"]')).toHaveText(["Rows 11", "Statuses 3", "Columns 6"]);
        // The operation templates for dispatch — two — beside the three order templates, whose source narrows nothing.
        await choose("rowTemplates", "group", /^Dispatch/);
        await expect(start.locator('[role="tab"]')).toHaveText(["Rows 5 of 11", "Statuses 3", "Columns 6"]);
        await expect.poll(bands).toEqual(["WO-2204"]);
        // The Rows tab's count in the type every tab's count has.
        const types = await start.evaluate((el) => [...el.querySelectorAll('[role="tab"] [data-tab-count]')].map((count) => {
            const s = getComputedStyle(count);
            return [s.fontFamily, s.fontSize, s.fontWeight, s.letterSpacing, s.color, s.fontVariantNumeric].join(" ");
        }));
        expect(types).toHaveLength(3);
        expect(new Set(types).size, types.join(" | ")).toBe(1);
        // At every width the Rows tab says what it shows — or, the pane on its 44px rail, its badge counts the templates it shows — the row whole.
        for (const width of [1920, 1440, 1024, 768, 560, 390, 360]) {
            await size(page, entry, width);
            const read = await start.evaluate((el) => (el.hasAttribute("data-collapsed")
                ? { collapsed: true, said: el.querySelector("[data-dock-badge]")?.textContent ?? null }
                : { collapsed: false, said: el.querySelector('[role="tab"]')?.textContent ?? null }));
            expect(read.said, `${width}px, ${read.collapsed ? "collapsed" : "open"}`).toBe(read.collapsed ? "5" : "Rows 5 of 11");
            expect(await toolbarFaults(frame), `${width}px`).toEqual([]);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
}

// ── On a phone: the views folded with the key search (#1345) ────────────────

/** The toolbar's row of a sheet's frame. */
const toolbarOf = (frame: Locator) => frame.locator('[data-frame-slot="toolbar"]');

/** The key search's icon once the views fold into it: its popover holds them over the search box. */
const searchViewsIcon = (frame: Locator) => toolbarOf(frame).locator("[data-toolbar-item='seek'] [data-key-search='icon'][aria-label='Views and search']");

/** The views the key search's popover holds, while it is open. */
const searchViews = (page: Page) => page.locator("[data-slot='searchViews']");

/** Where the row holds the views: their strip, its one chip, or folded with the key search into its popover. */
async function viewsForm(frame: Locator): Promise<"strip" | "chip" | "search"> {
    if (await searchViewsIcon(frame).isVisible()) return "search";
    if (await toolbarOf(frame).locator("[data-slot='tabMenu']").isVisible()) return "chip";
    return "strip";
}

/** Opens the key search's popover the views folded into, and returns its views. */
async function openSearchViews(page: Page, frame: Locator): Promise<Locator> {
    await searchViewsIcon(frame).tap();
    await expect(searchViews(page)).toBeVisible();
    return searchViews(page);
}

/**
 * Closes what a phone's gesture left open over the sheet — a search's list,
 * then the popover it sits in, or a menu — one Escape at a time, and waits
 * for the page at rest.
 */
async function closeOverlays(page: Page): Promise<void> {
    const open = page.locator("[data-scope='popover'][data-part='content'][data-state='open'], [data-scope='combobox'][data-part='content'][data-state='open'], [role='menu']");
    for (let i = 0; i < 3 && await open.count() > 0; i++) await page.keyboard.press("Escape");
    await expect(open).toHaveCount(0);
    await settled(page);
}

/** `+ TAB` from whatever form the row holds the views in: a view of the narrowing as it stands. In the key search's popover it closes the popover, as the chip's menu closes. */
async function addView(page: Page, frame: Locator): Promise<void> {
    const form = await viewsForm(frame);
    if (form === "search") {
        await (await openSearchViews(page, frame)).getByRole("button", { name: "New tab from this view" }).tap();
        await expect(searchViewsIcon(frame)).toHaveAttribute("data-state", "closed");
    } else if (form === "chip") {
        await toolbarOf(frame).locator("[data-slot='tabMenu']").tap();
        await page.getByRole("menuitem", { name: "New tab from this view" }).tap();
    } else await toolbarOf(frame).getByRole("button", { name: "New tab from this view" }).tap();
    await settled(page);
}

/** Switches to a view, by its name, from whatever form the row holds the views in. A view picked in the key search's popover closes it, as an item closes the chip's menu. */
async function switchView(page: Page, frame: Locator, name: string): Promise<"strip" | "chip" | "search"> {
    const form = await viewsForm(frame);
    if (form === "search") {
        const views = await openSearchViews(page, frame);
        await views.locator("button[aria-pressed]", { hasText: new RegExp(`^${name}\\b`) }).tap();
        await expect(searchViewsIcon(frame)).toHaveAttribute("data-state", "closed");
        await settled(page);
    } else if (form === "chip") {
        await toolbarOf(frame).locator("[data-slot='tabMenu']").tap();
        await page.getByRole("menuitem", { name: new RegExp(`^${name}`) }).tap();
        await settled(page);
    } else {
        await toolbarOf(frame).locator("[data-slot='tab']", { hasText: new RegExp(`^${name}`) }).tap();
        await settled(page);
    }
    return form;
}

/**
 * Seeks a key through Search Records, whatever its form — the box, or its
 * icon's popover — and lands the ring on its row; the popover then closed by
 * its icon, as a finger closes it.
 */
async function seek(page: Page, frame: Locator, key: string): Promise<void> {
    const inline = toolbarOf(frame).locator("[data-toolbar-item='seek'] input");
    const icon = toolbarOf(frame).locator("[data-toolbar-item='seek'] [data-key-search='icon']");
    const folded = !(await inline.isVisible());
    let box = inline;
    if (folded) {
        await icon.tap();
        box = page.locator("[data-key-search='popover'] input");
        await expect(box).toBeFocused();
    }
    await box.fill(key);
    // Its matches counted — a list of them shows only where their rows have landed.
    await expect(box.locator("xpath=ancestor::*[@data-part='dataset-key-search'][1]")).toContainText(/\b[1-9][\d,]* match(es)?\b/, { timeout: 15_000 });
    await box.press("Enter");
    await expect(frame.locator(`[data-frame-slot="main"] [data-slot="row"][data-row-id="${key}"] [data-slot="ring"]`)).toHaveCount(1, { timeout: 15_000 });
    if (folded && (await icon.getAttribute("data-state")) === "open") {
        await icon.tap();
        await expect(icon).toHaveAttribute("data-state", "closed");
    }
    await settled(page);
}

/**
 * The phone examples, each with a row the view hides and the whole sheet
 * shows at its top, and a key to seek over the whole sheet, in key order: the
 * workshop, narrowed to the orders on hold through its rail; and the indexed
 * work orders in their phone frame, which open on the jobs ready — the view
 * in its index's order — its key far down the record.
 */
const PHONES: ReadonlyArray<{ name: string; hash: string; narrow?: { field: string; value: RegExp }; hidden: string; key: string }> = [
    { name: "sheetWorkshop", hash: HASH, narrow: { field: "status", value: /^ON HOLD/ }, hidden: "WO-2201", key: "WO-2206" },
    { name: "sheetRecordIndexesMobile", hash: "e3/sheet/sheet-records/sheetRecordIndexesMobile", hidden: "JOB-10001", key: "JOB-49999" },
];

test.describe("the Sheet's row on a phone (#1345)", () => {
    test.skip(({ isMobile }) => !isMobile, "a phone: its own width, and a 294px frame");

    for (const { name, hash, narrow, hidden, key } of PHONES) {
        test(`${name}: at the phone's width and in a 294px frame the row holds the rail's trigger and Save, each clickable; the views — folded with the key search into its popover in the 294px frame — still switch views, and Search Records still seeks @narrow`, async ({ page }) => {
            const entry = await open(page, "light", hash);
            const frame = entry.locator("[data-builder-frame]").first();
            const row = (id: string) => frame.locator(`[data-frame-slot="main"] [data-slot="row"][data-row-id="${id}"]`);
            const view = () => frame.locator("[data-sheet]").first().getAttribute("data-view");
            // A view of the narrowing: the orders on hold, or the jobs ready the record example opens on.
            if (narrow !== undefined) {
                const editor = await recordField(page, frame, narrow.field);
                await editor.getByRole("button", { name: narrow.value }).first().tap();
                await closeOverlays(page);
            }
            await expect(row(hidden)).toHaveCount(0);
            await addView(page, frame);
            await expect.poll(view).toBe("view-1");
            for (const width of [undefined, 294] as const) {
                const at = width === undefined ? "the phone's width" : `a ${width}px frame`;
                if (width !== undefined) await size(page, entry, width);
                expect(await toolbarFaults(frame), at).toEqual([]);
                // The rail's trigger and Save in the row, each the element a tap on its middle lands on.
                const save = toolbarOf(frame).getByRole("button", { name: "Save" });
                const rail = toolbarOf(frame).locator("[data-slice-rail='record-slices'] button").first();
                for (const [what, control] of [["Save", save], ["the rail's trigger", rail]] as const) {
                    await expect(control, `${what} at ${at}`).toBeVisible();
                    expect(await control.evaluate((el) => {
                        const b = el.getBoundingClientRect();
                        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
                        return hit !== null && el.contains(hit);
                    }), `${what} at ${at}: a tap on its middle lands on it`).toBe(true);
                }
                await rail.tap();
                await expect(page.getByRole("dialog"), `the rail's editor at ${at}`).toHaveCount(1);
                await closeOverlays(page);
                // In the 294px frame the views fold with the key search into its popover.
                if (width !== undefined) expect(await viewsForm(frame), at).toBe("search");
                // The whole sheet, then the view again: each open in turn, and what each holds.
                await switchView(page, frame, "All");
                await expect.poll(view, `the whole sheet at ${at}`).not.toBe("view-1");
                await expect(row(hidden), `the whole sheet at ${at}`).toHaveCount(1);
                await switchView(page, frame, "view 1");
                await expect.poll(view, `the view at ${at}`).toBe("view-1");
                await expect(row(hidden), `the view at ${at}`).toHaveCount(0);
                // Search Records still seeks: over the whole sheet, its rows landed in key order, the ring on the key's row.
                await switchView(page, frame, "All");
                await expect(row(hidden), `the whole sheet again at ${at}`).toHaveCount(1);
                await seek(page, frame, key);
                expect(await toolbarFaults(frame), `${at}, after the gestures`).toEqual([]);
                // The view open again for the next width.
                await switchView(page, frame, "view 1");
            }
        });
    }
});
