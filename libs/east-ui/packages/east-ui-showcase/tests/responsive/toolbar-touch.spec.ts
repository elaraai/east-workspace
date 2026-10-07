/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Plan's and the Sheet's toolbars under a touch pointer (#1221), measured
 * in a real browser on the phone projects, whose pointer is coarse. Each
 * toolbar is one row inside its 44px band, nothing past the row's edge, and
 * every control in it is a 44px tap target — by its box, or by its halo
 * (`coarseHitArea`, #346), never by growing the row (#1193): a tap 21px above
 * or below a control's middle, on its column, lands on it; and where controls
 * sit edge to edge — a segment strip's, the context switch's — a tap just
 * inside one's edge lands on it, never on its neighbour's halo. An input's
 * target is its field. Read at the phone's own width, and on a touch screen
 * 1920px wide, where the rows unfold — the grain and resolution segments,
 * the key search's box, the rail's search pill, the view tabs — and there with
 * the controls a gesture brings: a key typed into the paged sheet's key search
 * (its steps and its clear), and on the workshop's sheet a query in its search
 * (the lens's context switch, the pill's clear), then view tabs of its own —
 * the active tab's × shown and another's hidden — and the frame narrowed until
 * a tab folds into `+n`. On the phone the workshop's two views fold the strip
 * into its one chip, and the row still fits. And a search's list closes when
 * the focus moves outside it, as on a desktop (#1228): ⏎ in the workshop's
 * rail search hands the focus to the sheet, and Tab leaves the paged sheet's
 * key search, each leaving no list open over the sheet; the key search's box
 * blurred to nothing — the phone's keyboard dismissed — leaves its list open,
 * as a desktop does, and a Tab from there closes it. And in the rail's
 * sectioned editor the cohort's chip and the breakdown's are each one 44px
 * target (#1253), every chip there keeping its own width.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test toolbar-touch --project mobile`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { PLAN_EXAMPLES } from "./plan-page";
import { settled } from "./settle";

/** A gesture that brings controls into the row. */
interface Gesture {
    /** What it does, as a failure names it. */
    what: string;
    run: (entry: Locator, page: Page) => Promise<void>;
}

/** A combobox's list, open. */
const openList = (page: Page) => page.locator("[data-scope='combobox'][data-part='content'][data-state='open']");

/** The sheet's view tabs — every one but the whole sheet's. */
const viewTabs = (entry: Locator) => entry.locator("[data-frame-slot='toolbar'] [data-slot='tab']:not([data-tab='all'])");

/** The strip folded into its one chip (#1221). */
const tabChip = (entry: Locator) => entry.locator("[data-frame-slot='toolbar'] [data-slot='tabMenu']");

/**
 * A new view tab, from the sheet's narrowing as it stands — `+ TAB` tapped on
 * the strip, or picked from its chip's menu — once it is the open view, named
 * `name`: its tab the active one, or its name on the chip.
 */
async function newViewTab(entry: Locator, page: Page, name: string): Promise<void> {
    if (await tabChip(entry).isVisible()) {
        await tabChip(entry).tap();
        await page.getByRole("menuitem", { name: "New tab from this view" }).tap();
    } else {
        await entry.locator("[data-frame-slot='toolbar']").getByRole("button", { name: "New tab from this view" }).tap();
    }
    await expect(entry.locator("[data-frame-slot='toolbar']").locator("[data-slot='tab'][data-active] [data-slot='tabLabel'], [data-slot='tabMenu'] [data-slot='tabLabel']"))
        .toHaveText(name);
    await settled(page);
}

/**
 * The builders' toolbars, each by its example, with the gestures that bring
 * more of its controls into the row: at the phone's width, and on the wide
 * touch screen.
 */
const TOOLBARS: ReadonlyArray<{ name: string; hash: string; phone?: readonly Gesture[]; wide?: readonly Gesture[] }> = [
    { name: "planTargetState", hash: `${PLAN_EXAMPLES}/planTargetState` },
    { name: "planReview", hash: `${PLAN_EXAMPLES}/planReview` },
    { name: "planEditing", hash: `${PLAN_EXAMPLES}/planEditing` },
    {
        name: "sheetWorkshop", hash: "e3/sheet/sheet/sheetWorkshop",
        phone: [{
            what: "two view tabs of its own",
            run: async (entry, page) => {
                await newViewTab(entry, page, "view 1");
                await newViewTab(entry, page, "view 2");
                // The strip folds into its one chip, the open view's (#1221): the row still fits.
                await expect(tabChip(entry)).toHaveAttribute("aria-label", "Views: view 2");
            },
        }],
        wide: [
            {
                what: "a query in the rail's search",
                run: async (entry, page) => {
                    const box = entry.locator("[data-frame-slot='toolbar'] input[placeholder='Search…']");
                    const context = entry.getByRole("radiogroup", { name: "Context rows either side of a hit" });
                    await box.fill("oak");
                    // The lens's context switch, and the pill's clear.
                    await expect(context).toBeVisible();
                    await expect(entry.locator("[data-frame-slot='toolbar']").getByRole("button", { name: "Clear search" })).toBeVisible();
                    // A tap outside the box — on the footer — closes its list, the query kept.
                    await entry.locator("[data-builder-frame] > [data-frame-slot='footer']").tap();
                    await expect(openList(page)).toHaveCount(0);
                    await expect(box).toHaveValue("oak");
                    await expect(context).toBeVisible();
                    await settled(page);
                },
            },
            {
                what: "a view tab of its own",
                run: async (entry, page) => {
                    await newViewTab(entry, page, "oak");
                    // The view's tab, active: its × shows.
                    await expect(entry.locator("[data-slot='tab'][data-active]:not([data-tab='all']) [data-slot='tabClose']")).toBeVisible();
                },
            },
            {
                what: "a second, and the first picked again",
                run: async (entry, page) => {
                    await newViewTab(entry, page, "oak");
                    await expect(viewTabs(entry)).toHaveCount(2);
                    await viewTabs(entry).first().tap();
                    await expect(viewTabs(entry).first()).toHaveAttribute("data-active", "");
                    // Only the active tab's × shows: the other's halo would take a tap that switches to it.
                    await expect(viewTabs(entry).first().locator("[data-slot='tabClose']")).toBeVisible();
                    await expect(viewTabs(entry).nth(1).locator("[data-slot='tabClose']")).toBeHidden();
                    await settled(page);
                },
            },
            {
                what: "the frame narrowed until a tab folds into +n",
                run: async (entry, page) => {
                    const box = entry.locator("[data-builder-frame]").first().locator("xpath=..");
                    const more = entry.locator("[data-frame-slot='toolbar'] [data-slot='tabMore']");
                    for (let width = 1400; width >= 360 && !(await more.isVisible()); width -= 40) {
                        await box.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
                        await settled(page);
                    }
                    await expect(more).toBeVisible();
                },
            },
        ],
    },
    {
        name: "sheetPaged", hash: "e3/sheet/sheet/sheetPaged",
        wide: [{
            what: "a key in the key search",
            run: async (entry, page) => {
                const box = entry.locator("[data-toolbar-item='seek'] input");
                await box.fill("J-0");
                // Its matches found: their steps and the clear beside the box; Escape closes its list, the key kept.
                await expect(entry.getByRole("button", { name: "Next match" })).toBeVisible();
                await box.press("Escape");
                await expect(openList(page)).toHaveCount(0);
                await box.blur();
                await expect(box).toHaveValue("J-0");
                await settled(page);
            },
        }],
    },
    { name: "sheetBatches", hash: "e3/sheet/sheet/sheetBatches" },
];

/** Open an example's page at rest and return its entry. */
async function openToolbar(page: Page, hash: string): Promise<Locator> {
    await page.goto(`/?theme=light#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] > [data-frame-slot='toolbar']").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry;
}

/** What is wrong with a builder's toolbar under a touch pointer — each a line saying what, empty when nothing is. */
async function touchFaults(entry: Locator): Promise<string[]> {
    // The band in the window's middle: a tap above or below a control is on the screen.
    await entry.locator("[data-builder-frame] > [data-frame-slot='toolbar']").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    return entry.evaluate((root) => {
        const bad: string[] = [];
        const band = root.querySelector("[data-builder-frame] > [data-frame-slot='toolbar']");
        if (band === null) return ["no toolbar"];
        const named = (el: Element | null) => (el === null ? "nothing"
            : `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.getAttribute("title") ?? el.textContent ?? "").trim().slice(0, 32)}"`);
        // One row, its band 44px, every item inside the band and none past the row's edge.
        const b = band.getBoundingClientRect();
        if (Math.abs(b.height - 44) > 0.5) bad.push(`the band is ${b.height}px tall`);
        const rows = band.querySelectorAll("[data-toolbar]");
        if (rows.length !== 1) return [...bad, `${rows.length} rows`];
        const row = rows[0]!.getBoundingClientRect();
        for (const item of band.querySelectorAll("[data-toolbar-item]")) {
            const r = item.getBoundingClientRect();
            if (r.width === 0) continue;
            const key = item.getAttribute("data-toolbar-item");
            if (r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) bad.push(`${key}: ${r.top.toFixed(1)}–${r.bottom.toFixed(1)}, out of the band ${b.top.toFixed(1)}–${b.bottom.toFixed(1)}`);
            if (r.right > row.right + 0.5) bad.push(`${key}: its end ${r.right.toFixed(1)} past the row's ${row.right.toFixed(1)}`);
        }
        // Every control it shows — the tab's × the pointer's alone, and a popover's trigger whatever element
        // it is (the slice's chips, the rail's folded trigger) — a 44px tap target. A control inside a
        // button is the button's. An input's field is 44px, and the input fills it: a tap 20px above or
        // below the field's middle — inside its border — lands in the input itself.
        const controls = [...band.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [role='radio'], [role='tab'], [role='button'], [aria-haspopup], [data-slot='tabClose']")]
            .filter((el) => el.checkVisibility({ visibilityProperty: true }))
            .filter((el) => el.parentElement?.closest("button, a[href], [role='button']") === null);
        if (controls.length === 0) bad.push("no control in the row");
        for (const el of controls) {
            const input = el.matches("input");
            const field = input ? (el.closest("[data-part='control']") ?? el) : el;
            const t = field.getBoundingClientRect();
            if (input && t.height < 43.5) bad.push(`${named(el)}: its field is ${t.height.toFixed(1)}px tall`);
            const x = t.left + t.width / 2;
            const y = t.top + t.height / 2;
            for (const dy of input ? [-20, 20] : [-21, 21]) {
                const hit = document.elementFromPoint(x, y + dy);
                if (hit === null || !el.contains(hit)) bad.push(`${named(el)} (${t.width.toFixed(0)}×${t.height.toFixed(1)}): a tap ${dy < 0 ? "above" : "below"} its middle lands on ${named(hit)}`);
            }
        }
        // Controls that sit edge to edge — a segment strip's segments, the context switch's options: siblings of one
        // kind at most 2.5px apart. A tap 2px inside one's edge, on its middle or 21px above or below it, lands on it:
        // the halo of the one beside it, drawn later, never takes it (`axis: "block"`, #1221).
        for (const el of controls) {
            const t = el.getBoundingClientRect();
            const next = controls.find((other) => {
                if (other === el || other.parentElement !== el.parentElement || other.tagName !== el.tagName
                    || other.getAttribute("role") !== el.getAttribute("role")) return false;
                const o = other.getBoundingClientRect();
                const gap = o.left - t.right;
                return gap > -0.5 && gap <= 2.5 && o.top < t.bottom && o.bottom > t.top;
            });
            if (next === undefined) continue;
            for (const dy of [-21, 0, 21]) {
                const hit = document.elementFromPoint(t.right - 2, t.top + t.height / 2 + dy);
                if (hit === null || !el.contains(hit)) {
                    bad.push(`${named(el)}: a tap 2px inside its edge beside ${named(next)}${dy === 0 ? "" : `, ${Math.abs(dy)}px ${dy < 0 ? "above" : "below"} its middle,`} lands on ${named(hit)}`);
                }
            }
        }
        return bad;
    });
}

// ── The builders' rails filtered (#1231) ───────────────────────────────────

/** The slice's edit popover, open: a compact trigger's editor, or the rail's sectioned one. */
const openEditor = (page: Page) => page.locator("[data-scope='popover'][data-part='content'][data-state='open']");

/**
 * A filter on the first field the open editor's clause builder offers — the
 * workshop's activity, the plan's task — its value typed, then Add (not
 * `+ filter`, named Add filter): `<field> contains <word>`.
 */
async function buildFilter(page: Page, word: string): Promise<void> {
    const editor = openEditor(page);
    await editor.locator("[data-clause-stacked]").getByRole("textbox").fill(word);
    await editor.getByRole("button", { name: "Add", exact: true }).tap();
}

/** The row's clause chip, by its words. */
const clauseChip = (entry: Locator, words: string) => entry.locator("[data-frame-slot='toolbar']").getByText(words);

/** Sizes the box a builder frame fills: its nearest ancestor that lays out — the Plan's `display: contents` wrapper does not. */
async function sizeFrame(entry: Locator, width: number): Promise<void> {
    await entry.locator("[data-builder-frame]").first().evaluate((frame, w) => {
        let box = frame.parentElement;
        while (box !== null && getComputedStyle(box).display === "contents") box = box.parentElement;
        if (box !== null) box.style.width = `${w}px`;
    }, width);
}

/**
 * The builders' rails filtered (#1231): every clause chip and `+N more` one
 * button, and every control in the row still a 44px tap target. The
 * workshop's rail is filtered on the phone in its editor — the trigger the
 * editor hangs from keeping its form while it is open, the row folding back
 * once it closes — and the clause then removed from its own editor, a touch
 * screen drawing its chip no ×; on the wide screen from its `+ filter`, the
 * row, short of room once the lens's context switch and count join it,
 * folding the chips into `+2 more` first (#952). The slice-chrome plan's row
 * has the room for clause chips: the one it starts with, a second set from
 * `+ filter`, then the frame narrowed until one folds into `+N more`.
 */
const FILTERED: ReadonlyArray<{ name: string; hash: string; phone: readonly Gesture[]; wide: readonly Gesture[] }> = [
    {
        name: "sheetWorkshop", hash: "e3/sheet/sheet/sheetWorkshop",
        phone: [
            {
                what: "a filter set from the rail's editor",
                run: async (entry, page) => {
                    const editor = openEditor(page);
                    const trigger = entry.locator("[data-frame-slot='toolbar'] [data-slot='railTrigger']");
                    await trigger.tap();
                    const folds = await trigger.locator("[data-slice-fold]").count();
                    await editor.locator("[data-slice-add='filter']").tap();
                    await buildFilter(page, "Panel");
                    await expect(editor.getByText("contains Panel")).toBeVisible();
                    // The rail its open editor holds keeps its form: the trigger the editor hangs from folds as it did.
                    await expect(trigger.locator("[data-slice-fold]")).toHaveCount(folds);
                    await editor.getByRole("button", { name: "Done" }).tap();
                    await expect(openEditor(page)).toHaveCount(0);
                    await settled(page);
                },
            },
            {
                what: "the filter removed from its clause's editor — a touch screen draws its chip no ×",
                run: async (entry, page) => {
                    const editor = openEditor(page);
                    await entry.locator("[data-frame-slot='toolbar'] [data-slot='railTrigger']").tap();
                    const clause = editor.getByText("contains Panel");
                    await expect(clause).toBeVisible();
                    await expect(editor.locator("[data-chip-remove]")).toHaveCount(0);
                    await clause.tap();
                    await editor.getByRole("button", { name: "Remove filter" }).tap();
                    await expect(clause).toHaveCount(0);
                    await editor.getByRole("button", { name: "Done" }).tap();
                    await expect(openEditor(page)).toHaveCount(0);
                    await settled(page);
                },
            },
        ],
        wide: [
            {
                what: "two filters set from the rail's + filter",
                run: async (entry, page) => {
                    const toolbar = entry.locator("[data-frame-slot='toolbar']");
                    for (const word of ["Panel", "Edge"]) {
                        await toolbar.locator("[data-slice-add='filter']").tap();
                        await buildFilter(page, word);
                        await expect(openEditor(page)).toHaveCount(0);
                    }
                    // The row short of room folds the clause chips first (rank 0), into `+2 more`.
                    await expect(toolbar.getByText("+2 more", { exact: true })).toBeVisible();
                    await settled(page);
                },
            },
        ],
    },
    {
        name: "slicePlanChrome", hash: `${PLAN_EXAMPLES}/slicePlanChrome`,
        phone: [],
        wide: [
            {
                what: "a second filter set from the rail's + filter",
                run: async (entry, page) => {
                    await entry.locator("[data-frame-slot='toolbar'] [data-slice-add='filter']").tap();
                    await buildFilter(page, "Design");
                    await expect(openEditor(page)).toHaveCount(0);
                    await expect(clauseChip(entry, "contains Design")).toBeVisible();
                    await expect(clauseChip(entry, "owner = Team A")).toBeVisible();
                    await settled(page);
                },
            },
            {
                what: "the frame narrowed until a clause folds into +N more",
                run: async (entry, page) => {
                    const more = entry.locator("[data-frame-slot='toolbar']").getByText(/^\+\d+ more$/);
                    for (let width = 960; width >= 360 && !(await more.isVisible()); width -= 40) {
                        await sizeFrame(entry, width);
                        await settled(page);
                    }
                    await expect(more).toBeVisible();
                    await expect(entry.locator("[data-frame-slot='toolbar'] [data-slice-clause]")).not.toHaveCount(0);
                },
            },
        ],
    },
];

test.describe("the builders' rails filtered, under a touch pointer (#1231)", () => {
    test.skip(({ isMobile }) => !isMobile, "a coarse pointer: the phone projects");

    for (const { name, hash, phone, wide } of FILTERED) {
        for (const { where, width, gestures } of [
            { where: "at the phone's width", width: undefined, gestures: phone },
            { where: "on a touch screen 1920px wide", width: 1920, gestures: wide },
        ]) {
            const what = gestures.length === 0 ? "at rest" : `with ${gestures.map((g) => g.what).join(", then ")}`;
            test(`${name}, filtered, ${where}, ${what}: one row in its band, every control a 44px tap target`, async ({ page }) => {
                if (width !== undefined) await page.setViewportSize({ width, height: 1000 });
                const entry = await openToolbar(page, hash);
                await expect.poll(() => touchFaults(entry)).toEqual([]);
                for (const gesture of gestures) {
                    await gesture.run(entry, page);
                    await expect.poll(() => touchFaults(entry), { message: `with ${gesture.what}` }).toEqual([]);
                }
            });
        }
    }
});

// ── Studio's builder, the SnapGrid editor and the query builder folded into chips (#1229) ──

/** A chip's menu, open. */
const openChipMenu = (page: Page) => page.locator("[data-scope='menu'][data-part='content'][data-state='open']");

/** A popover, open: Save as template's, or the query's save popover. */
const openPopover = (page: Page) => page.locator("[data-scope='popover'][data-part='content'][data-state='open']");

/** A toolbar control by its selector, in the entry's builder frame's row. */
const inRow = (entry: Locator, selector: string) => entry.locator(`[data-builder-frame] > [data-frame-slot='toolbar'] ${selector}`).first();

/**
 * The frame narrowed, 20px at a time, until what `selector` names is drawn in
 * the row.
 */
async function narrowUntil(entry: Locator, page: Page, selector: string): Promise<void> {
    const target = inRow(entry, selector);
    for (let width = 1400; width >= 360 && !(await target.isVisible()); width -= 20) {
        await sizeFrame(entry, width);
        await settled(page);
    }
    await expect(target).toBeVisible();
}

/** The frame narrowed until the design widths fold to their icons: two segments of an icon each, edge to edge, which the edge check reaches. */
const widthsToIcons: Gesture = {
    what: "the frame narrowed until the widths fold to their icons",
    run: async (entry, page) => {
        await narrowUntil(entry, page, "[data-toolbar-item='widths'][data-toolbar-form='1']");
        await expect.poll(() => inRow(entry, "[data-snap-grid-widths]").evaluate((strip) => {
            const segments = [...strip.querySelectorAll("button")];
            const [a, b] = segments.map((s) => s.getBoundingClientRect());
            return {
                icons: segments.map((s) => [s.getAttribute("aria-label"), s.textContent, s.querySelectorAll("svg").length]),
                apart: Math.abs(Math.round((b!.left - a!.right) * 10) / 10),
            };
        })).toEqual({ icons: [["Desktop", "", 1], ["Tablet", "", 1]], apart: 0 });
    },
};

/** A chip's menu, tapped open, then an item tapped. */
async function tapItem(entry: Locator, page: Page, chip: string, item: string): Promise<void> {
    await inRow(entry, chip).tap();
    await openChipMenu(page).getByRole("menuitem", { name: item, exact: true }).tap();
}

/**
 * The View chip's menu, by touch: Zoom in — the menu staying open — then
 * Tablet, a choice of one, which closes it.
 */
const viewByTouch: Gesture = {
    what: "the View chip's Zoom in, then its Tablet",
    run: async (entry, page) => {
        await tapItem(entry, page, "[data-snap-grid-view]", "Zoom in");
        await expect(openChipMenu(page).locator("[data-snap-grid-view-zoom]")).toHaveText("110%");
        await openChipMenu(page).getByRole("menuitemradio", { name: "Tablet" }).tap();
        await expect(openChipMenu(page)).toHaveCount(0);
        await expect(entry.locator("[data-snap-grid-canvas]").first()).toHaveCSS("max-width", "1024px");
        await settled(page);
    },
};

/** A ⋯ chip's item that opens its popover, by touch: the popover hangs from the chip — still in the row, in the popover's anchor — and Cancel closes it. */
function popoverFromChip(chip: string, item: string): Gesture {
    return {
        what: `the ⋯ chip's ${item}, its popover hung from the chip, then cancelled`,
        run: async (entry, page) => {
            await tapItem(entry, page, chip, item);
            await expect(openPopover(page)).toBeVisible();
            await expect(inRow(entry, chip)).toBeVisible();
            await expect(inRow(entry, chip).locator("xpath=..")).toHaveAttribute("data-part", "anchor");
            await openPopover(page).getByRole("button", { name: "Cancel" }).tap();
            await expect(openPopover(page)).toHaveCount(0);
            await settled(page);
        },
    };
}

/**
 * The builders whose rows fold into chips (#1229), each with the chips its
 * row draws at the phone's width — Studio's View chip and ⋯ chip, the SnapGrid
 * editor's View chip, the query builder's ⋯ chip — and the gestures that use
 * them by touch there; on the wide touch screen, where the rows unfold, the
 * frame narrowed until the design widths fold to their icons, which the edge
 * check reaches, and then until the chips draw.
 */
const CHIPS: ReadonlyArray<{ name: string; hash: string; chips: readonly string[]; phone: readonly Gesture[]; wide: readonly Gesture[] }> = [
    {
        name: "studioBuilder", hash: "e3/studio/studio/studioBuilder",
        chips: ["[data-snap-grid-view]", "[data-studio-more]"],
        phone: [viewByTouch, popoverFromChip("[data-studio-more]", "Save as template…")],
        wide: [
            widthsToIcons,
            { what: "the frame narrowed until the ⋯ chip draws", run: (entry, page) => narrowUntil(entry, page, "[data-studio-more]") },
        ],
    },
    {
        name: "snapGridEditor", hash: "layout/snap-grid/snapGridEditor",
        chips: ["[data-snap-grid-view]"],
        phone: [viewByTouch],
        wide: [
            widthsToIcons,
            { what: "the frame narrowed until the View chip draws", run: (entry, page) => narrowUntil(entry, page, "[data-snap-grid-view]") },
        ],
    },
    {
        name: "queryBuilder", hash: "e3/query/query/queryBuilder",
        chips: ["[data-query-more]"],
        phone: [popoverFromChip("[data-query-more]", "Save…")],
        wide: [{ what: "the frame narrowed until the ⋯ chip draws", run: (entry, page) => narrowUntil(entry, page, "[data-query-more]") }],
    },
];

test.describe("the builders' toolbars folded into chips, under a touch pointer (#1229)", () => {
    test.skip(({ isMobile }) => !isMobile, "a coarse pointer: the phone projects");

    for (const { name, hash, chips, phone, wide } of CHIPS) {
        for (const { where, width, gestures } of [
            { where: "at the phone's width", width: undefined, gestures: phone },
            { where: "on a touch screen 1920px wide", width: 1920, gestures: wide },
        ]) {
            test(`${name}, ${where}, at rest${gestures.map((g) => `, then ${g.what}`).join("")}: one row in its 44px band, nothing past its edge, every control a 44px tap target`, async ({ page }) => {
                if (width !== undefined) await page.setViewportSize({ width, height: 1000 });
                const entry = await openToolbar(page, hash);
                await expect.poll(() => touchFaults(entry)).toEqual([]);
                // On the phone the row fits by folding into its chips.
                if (width === undefined) for (const chip of chips) await expect(inRow(entry, chip)).toBeVisible();
                for (const gesture of gestures) {
                    await gesture.run(entry, page);
                    await expect.poll(() => touchFaults(entry), { message: `with ${gesture.what}` }).toEqual([]);
                }
            });
        }
    }
});

test.describe("the builders' toolbars under a touch pointer (#1221)", () => {
    test.skip(({ isMobile }) => !isMobile, "a coarse pointer: the phone projects");

    /** Measures a toolbar at rest, then after each gesture. */
    async function measure(page: Page, hash: string, gestures: readonly Gesture[] = []): Promise<void> {
        const entry = await openToolbar(page, hash);
        await expect.poll(() => touchFaults(entry)).toEqual([]);
        for (const gesture of gestures) {
            await gesture.run(entry, page);
            await expect.poll(() => touchFaults(entry), { message: `with ${gesture.what}` }).toEqual([]);
        }
    }

    /** What a test's name says of its gestures. */
    const withGestures = (gestures: readonly Gesture[] | undefined) => (gestures === undefined ? "" : `, and with ${gestures.map((g) => g.what).join(", then ")}`);

    for (const { name, hash, phone, wide } of TOOLBARS) {
        test(`${name}, at the phone's width${withGestures(phone)}: one row in its 44px band, nothing past its edge, every control a 44px tap target`, async ({ page }) => {
            await measure(page, hash, phone);
        });

        test(`${name}, on a touch screen 1920px wide${withGestures(wide)}: one row in its band, every control a 44px tap target`, async ({ page }) => {
            await page.setViewportSize({ width: 1920, height: 1000 });
            await measure(page, hash, wide);
        });
    }
});

test.describe("a search's list on a touch screen (#1228)", () => {
    test.skip(({ isMobile }) => !isMobile, "a touch screen: the phone projects");

    /** Whether the focus is in an entry's main — the grid, or anything in it. */
    const focusInMain = (entry: Locator) => entry.evaluate((root) => root.querySelector("[data-frame-slot='main']")?.contains(document.activeElement) === true);

    /** Two animation frames: a search looks at a focus a frame after it moves, as Zag does on a desktop. */
    const frames = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }));

    test("⏎ in the workshop sheet's rail search hands the focus to the sheet, and leaves no list open", async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1000 });
        const entry = await openToolbar(page, "e3/sheet/sheet/sheetWorkshop");
        const box = entry.locator("[data-frame-slot='toolbar'] input[placeholder='Search…']");
        await box.fill("oak");
        await expect(openList(page)).toHaveCount(1);
        await box.press("Enter");
        await expect.poll(() => focusInMain(entry)).toBe(true);
        await expect(openList(page)).toHaveCount(0);
        await expect(box).toHaveValue("oak");
    });

    test("Tab out of the paged sheet's key search leaves no list open", async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1000 });
        const entry = await openToolbar(page, "e3/sheet/sheet/sheetPaged");
        const box = entry.locator("[data-toolbar-item='seek'] input");
        await box.fill("J-0");
        await expect(entry.getByRole("button", { name: "Next match" })).toBeVisible();
        await expect(openList(page)).toHaveCount(1);
        await box.press("Tab");
        await expect(box).not.toBeFocused();
        await expect(openList(page)).toHaveCount(0);
        await expect(box).toHaveValue("J-0");
    });

    test("the paged sheet's key search blurred to nothing — the phone's keyboard dismissed — keeps its list open, as on a desktop, and so does the focus moved inside it; a Tab from there closes it", async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1000 });
        const entry = await openToolbar(page, "e3/sheet/sheet/sheetPaged");
        const box = entry.locator("[data-toolbar-item='seek'] input");
        await box.fill("J-0");
        await expect(entry.getByRole("button", { name: "Next match" })).toBeVisible();
        await expect(openList(page)).toHaveCount(1);
        await box.blur();
        await frames(page);
        await expect(openList(page)).toHaveCount(1);
        // Inside, a focus a script moves closes nothing: onto the trigger, the list, the box again.
        for (const inside of [entry.locator("[data-toolbar-item='seek'] [data-scope='combobox'][data-part='trigger']"), openList(page), box]) {
            await inside.focus();
            await expect(inside).toBeFocused();
            await frames(page);
            await expect(openList(page)).toHaveCount(1);
        }
        // Blurred to nothing again, a Tab from there moves the focus outside: the list closes.
        await box.blur();
        await frames(page);
        await expect(openList(page)).toHaveCount(1);
        await page.keyboard.press("Tab");
        await expect(box).not.toBeFocused();
        await expect(openList(page)).toHaveCount(0);
        await expect(box).toHaveValue("J-0");
    });
});

// ── The rail's cohort and breakdown chips on a touch screen (#1253) ──────────

/**
 * What is wrong with the chips the rail's sectioned editor holds under a touch
 * pointer, each a line saying what, empty when nothing is. Each chip — a
 * clause's, a cohort's, the breakdown's, an add's — keeps its own width (its
 * contents, its padding and its border: the editor stretches no trigger), and
 * is a 44px tap target no other covers: a tap 21px above or below its middle
 * lands on it, and so does one 2px inside either edge. A cohort's On · Off
 * segments sit edge to edge: a tap 2px inside each one's edges, on its middle
 * or 21px above or below it, lands on it.
 */
async function editorChipFaults(page: Page): Promise<string[]> {
    return openEditor(page).evaluate((editor) => {
        const bad: string[] = [];
        const named = (el: Element | null) => (el === null ? "nothing"
            : `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 32)}"`);
        /** Taps at `points` land on `el`, or name where they land instead. */
        const lands = (el: HTMLElement, points: ReadonlyArray<readonly [number, number, string]>) => {
            for (const [x, y, where] of points) {
                const hit = document.elementFromPoint(x, y);
                if (hit === null || !el.contains(hit)) {
                    const t = el.getBoundingClientRect();
                    bad.push(`${named(el)} (${t.width.toFixed(0)}×${t.height.toFixed(1)}): a tap ${where} lands on ${named(hit)}`);
                }
            }
        };
        const chips = [...editor.querySelectorAll<HTMLElement>("[data-slice-clause], [data-slice-cohort], [data-slice-breakdown], [data-slice-add]")]
            .filter((el) => el.checkVisibility({ visibilityProperty: true }));
        if (chips.length === 0) bad.push("no chip in the editor");
        for (const chip of chips) {
            chip.scrollIntoView({ block: "center" });
            const t = chip.getBoundingClientRect();
            const contents = document.createRange();
            contents.selectNodeContents(chip);
            const cs = getComputedStyle(chip);
            const own = contents.getBoundingClientRect().width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
                + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
            if (Math.abs(t.width - own) > 1) bad.push(`${named(chip)}: ${t.width.toFixed(1)}px wide, its own width ${own.toFixed(1)}px`);
            const x = t.left + t.width / 2;
            const y = t.top + t.height / 2;
            lands(chip, [[x, y - 21, "21px above its middle"], [x, y + 21, "21px below its middle"], [t.left + 2, y, "2px inside its start"], [t.right - 2, y, "2px inside its end"]]);
        }
        for (const segment of editor.querySelectorAll<HTMLElement>("[data-slice-cohort-state] button")) {
            segment.scrollIntoView({ block: "center" });
            const t = segment.getBoundingClientRect();
            const y = t.top + t.height / 2;
            lands(segment, [-21, 0, 21].flatMap((dy) => [[t.left + 2, y + dy, `2px inside its start, ${dy}px from its middle`], [t.right - 2, y + dy, `2px inside its end, ${dy}px from its middle`]] as const));
        }
        return bad;
    });
}

test.describe("the rail's cohort and breakdown chips, under a touch pointer (#1253)", () => {
    test.skip(({ isMobile }) => !isMobile, "a coarse pointer: the phone projects");

    test("in the narrow Table's sectioned editor — a split set from + dimension, the cohort's editor opened and its On · Off used, the split cleared from its own editor — every chip keeps its own width and is a 44px tap target no other covers", async ({ page }) => {
        const hash = "slice/slice/sliceNarrow";
        await page.goto(`/?theme=light#${hash}`);
        await page.waitForSelector("header", { timeout: 20_000 });
        const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
        await entry.scrollIntoViewIfNeeded();
        await expect(entry.locator("[data-slot='railTrigger']")).toBeVisible({ timeout: 20_000 });
        await settled(page);
        const editor = openEditor(page);
        await entry.locator("[data-slot='railTrigger']").tap();
        await expect(editor).toBeVisible();
        await expect.poll(() => editorChipFaults(page)).toEqual([]);

        // A split set from + dimension: its disclosure says it expands, and the split's chip takes its place.
        const addDimension = editor.locator("[data-slice-add='dimension']");
        await addDimension.tap();
        await expect(addDimension).toHaveAttribute("aria-expanded", "true");
        await editor.getByRole("button", { name: "Region", exact: true }).tap();
        const split = editor.getByRole("button", { name: "Split by Region" });
        await expect(split).toBeVisible();
        await expect(split.locator("[data-chip-remove]")).toHaveCount(0);
        await expect.poll(() => editorChipFaults(page), { message: "with the split set" }).toEqual([]);

        // The cohort's chip, one target, opens its editor; its On · Off turns the cohort on at once.
        const cohort = editor.locator("[data-slice-cohort='high-volume']");
        await cohort.tap();
        await expect(cohort).toHaveAttribute("aria-expanded", "true");
        await editor.getByRole("group", { name: "Cohort state" }).getByRole("button", { name: "On" }).tap();
        await expect(cohort).toHaveAttribute("data-state", "on");
        await expect.poll(() => editorChipFaults(page), { message: "with the cohort's editor open and the cohort on" }).toEqual([]);

        // The split cleared from its own editor.
        await split.tap();
        await editor.getByRole("button", { name: "Clear breakdown" }).tap();
        await expect(split).toHaveCount(0);
        await expect.poll(() => editorChipFaults(page), { message: "with the split cleared" }).toEqual([]);
    });
});
