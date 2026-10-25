/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Plan's and the Sheet's toolbars under a touch pointer (#1221), measured
 * in a real browser on the phone projects, whose pointer is coarse — the
 * print works' event kinds' among them, its history item at the row's end
 * (#1194). Each
 * toolbar is one row inside its 44px band, nothing past the row's edge, and
 * every control in it is a 44px tap target — by its box, or by its halo
 * (`coarseHitArea`, #346), never by growing the row (#1193): a tap 21px above
 * or below a control's middle, on its column, lands on it; and where controls
 * sit edge to edge — a segment strip's — a tap just inside one's edge lands
 * on it, never on its neighbour's halo. An input's
 * target is its field. Read at the phone's own width, and on a touch screen
 * 1920px wide, where the rows unfold — the grain and resolution segments,
 * the key search's box, the rail's search pill, the view tabs — and there with
 * the controls a gesture brings: a key typed into the paged sheet's key search
 * (its steps and its clear); on the workshop's sheet a customer searched
 * through its rail (#1345), then two view tabs of its own, named from the
 * search — the frame narrowed until the second folds the first into `+n`,
 * which picks it again — and
 * on the stress sheet another of its views picked — from the strip, or from
 * `+n` where its lens's count line leaves the strip short of room (#1349) —
 * the active tab's × shown and the others' hidden. On the phone
 * the workshop's two views fold with the
 * key search into its popover (#1345), and the row still fits. And a search's
 * list closes when the focus moves outside it, as on a desktop (#1228): ⏎ in
 * the workshop rail's Customer search applies its prefix, and Tab leaves the paged sheet's
 * key search, each leaving no list open over the sheet; the key search's box
 * blurred to nothing — the phone's keyboard dismissed — leaves its list open,
 * as a desktop does, and a Tab from there closes it. And in the rail's
 * sectioned editor the cohort's chip and the breakdown's are each one 44px
 * target (#1253), every chip there keeping its own width. And the
 * Flowchart's frame (#1245): over the host's tables, which no rail narrows
 * (#1346), on the phone LR · TD and find state folded into their chips — LR ·
 * TD's menu turning the canvas, find state's popover picking a state — and on
 * the wide screen its row unfolded, a query in find state stepped through its
 * matches and cleared, then the frame narrowed until LR · TD and find state
 * fold; over a record of flows (#1246) its row ending with the history item;
 * and over a record its `flows` source narrows (#1346), the rail and its
 * summary in the row. And the Schematic's frame (#1387): on the phone the
 * rail's icon and the View, and on the wide screen its tools, every one named,
 * its zoom and Fit and its Find's box.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test toolbar-touch --project mobile`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { PLAN_EVENT_EXAMPLES, PLAN_EXAMPLES, drawnSel } from "./plan-page";
import { recordField } from "./record-slice";
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
 * The workshop rail's Customer search (#1345), open — its chip's editor, or
 * the folded rail's — and its box: a prefix of the orders' customers, through
 * the record's own index.
 */
async function customerSearch(entry: Locator, page: Page): Promise<Locator> {
    const editor = await recordField(page, entry.locator("[data-builder-frame]").first(), "customer");
    return editor.getByRole("combobox");
}

/** Closes a rail field's editor by Escape — its search's list first, while one is open — the focus inside them all along. */
async function escapeEditor(page: Page): Promise<void> {
    const editor = page.getByRole("dialog");
    for (let i = 0; i < 2 && await editor.count() > 0; i++) {
        await page.keyboard.press("Escape");
        await expect.poll(async () => await openList(page).count() === 0).toBe(true);
    }
    await expect(editor).toHaveCount(0);
}

/** The views folded with the key search into its popover (#1345): its icon, in the row. */
const searchViewsIcon = (entry: Locator) => entry.locator("[data-frame-slot='toolbar'] [data-toolbar-item='seek'] [data-key-search='icon'][aria-label='Views and search']");

/**
 * A new view tab, from the sheet's narrowing as it stands — `+ TAB` tapped on
 * the strip, picked from its chip's menu, or tapped in the key search's
 * popover the views folded into (#1345), which closes it — once it is the
 * open view, named `name`: its tab the active one, its name on the chip, or
 * its choice the pressed one in the popover opened again.
 */
async function newViewTab(entry: Locator, page: Page, name: string): Promise<void> {
    if (await searchViewsIcon(entry).isVisible()) {
        const icon = searchViewsIcon(entry);
        const views = page.locator("[data-slot='searchViews']");
        await icon.tap();
        await views.getByRole("button", { name: "New tab from this view" }).tap();
        // + TAB closes the popover, as an item closes the chip's menu; opened again, the new view's choice is the pressed one.
        await expect(icon).toHaveAttribute("data-state", "closed");
        await icon.tap();
        await expect(views.locator("button[aria-pressed='true']")).toHaveText(new RegExp(`^${name}\\b`));
        await icon.tap();
        await expect(icon).toHaveAttribute("data-state", "closed");
        await settled(page);
        return;
    }
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
    { name: "planRowDrop", hash: `${PLAN_EXAMPLES}/planRowDrop` },
    { name: "planPrintWorks", hash: `${PLAN_EVENT_EXAMPLES}/planPrintWorks` },
    { name: "calendarOperations", hash: "e3/calendar/calendar/calendarOperations" },
    {
        name: "sheetWorkshop", hash: "e3/sheet/sheet/sheetWorkshop",
        phone: [{
            what: "two view tabs of its own",
            run: async (entry, page) => {
                await newViewTab(entry, page, "view 1");
                await newViewTab(entry, page, "view 2");
                // The views fold with the key search into its popover (#1345), the open view's choice pressed there: the row still fits.
                await expect(searchViewsIcon(entry)).toBeVisible();
                await expect(tabChip(entry)).toHaveCount(0);
            },
        }],
        wide: [
            {
                what: "a customer searched through the rail",
                run: async (entry, page) => {
                    const search = await customerSearch(entry, page);
                    await search.fill("Quill");
                    await search.press("Enter");
                    // The prefix applied; Escape closes the search's list, then its editor, the focus inside them: no list
                    // left open, the search kept on the rail.
                    await escapeEditor(page);
                    await expect(openList(page)).toHaveCount(0);
                    // The one order whose customer starts so.
                    await expect.poll(() => entry.locator("[data-frame-slot='main'] [data-slot='row'][data-band-row]")
                        .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row-id")))).toEqual(["WO-2201"]);
                    await settled(page);
                },
            },
            {
                what: "a view tab of its own",
                run: async (entry, page) => {
                    await newViewTab(entry, page, "Quill");
                    // The view's tab, active: its × shows.
                    await expect(entry.locator("[data-slot='tab'][data-active]:not([data-tab='all']) [data-slot='tabClose']")).toBeVisible();
                },
            },
            {
                // A second, then the frame narrowed until the strip has room for one view and folds the first into
                // `+1` (#1345): that room is what the rail, the key search's box and the history leave it, so the
                // frame is narrowed to find it, never a width assumed.
                what: "a second, the frame narrowed until it folds the first into +1, and the first picked again from there",
                run: async (entry, page) => {
                    await newViewTab(entry, page, "Quill");
                    const more = entry.locator("[data-frame-slot='toolbar'] [data-slot='tabMore']");
                    await narrowUntil(entry, page, "[data-slot='tabMore']");
                    await expect(more).toBeVisible();
                    await expect(viewTabs(entry)).toHaveCount(1);
                    await expect.poll(() => touchFaults(entry), { message: "with +1" }).toEqual([]);
                    await more.tap();
                    await page.getByRole("menuitem", { name: /^Quill/ }).tap();
                    await expect(page.locator("[role='menu']")).toHaveCount(0);
                    // The first open again, its × shown, the second in `+1` now.
                    await expect(viewTabs(entry)).toHaveCount(1);
                    await expect(viewTabs(entry).first()).toHaveAttribute("data-active", "");
                    await expect(viewTabs(entry).first()).toHaveAttribute("data-tab", "view-1");
                    await expect(viewTabs(entry).first().locator("[data-slot='tabClose']")).toBeVisible();
                    await settled(page);
                },
            },
        ],
    },
    {
        // Its views beside its lens's count line (#1349): a strip short of room folds the views it cannot hold into
        // `+n`, the open one kept, before the count line goes — so another view is picked from the strip or from `+n`,
        // whichever holds it.
        name: "sheetStress", hash: "e3/sheet/sheet/sheetStress",
        wide: [{
            what: "another of its views picked",
            run: async (entry, page) => {
                const routers = entry.locator("[data-frame-slot='toolbar'] [data-slot='tab'][data-tab='routers']");
                if (await routers.isVisible()) {
                    await routers.tap();
                } else {
                    await entry.locator("[data-frame-slot='toolbar'] [data-slot='tabMore']").tap();
                    await page.getByRole("menuitem", { name: /^ROUTERS/ }).tap();
                    await expect(page.locator("[role='menu']")).toHaveCount(0);
                }
                await expect(routers).toHaveAttribute("data-active", "");
                await settled(page);
                // Only the active tab's × shows: another's halo would take a tap that switches to it.
                await expect(routers.locator("[data-slot='tabClose']")).toBeVisible();
                const others = await entry.locator("[data-frame-slot='toolbar'] [data-slot='tab']:not([data-tab='all']):not([data-active])").all();
                for (const other of others) await expect(other.locator("[data-slot='tabClose']")).toBeHidden();
            },
        }],
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
    // Over a record of flows, the history item ends the Flowchart's row (#1246).
    { name: "flowchartFlows", hash: "e3/flowchart/flowchart/flowchartFlows" },
    // Over a record its `flows` source narrows, the rail and its summary fold first, and on the phone LR · TD and find
    // state bundle into the key search's popover (#1346).
    { name: "flowchartRecordIndexes", hash: "e3/flowchart/flowchart/flowchartRecordIndexes" },
    // The Schematic's tools, its zoom and Fit and its Find, after its rail (#1387): on the phone the rail's icon and the
    // View; on the wide screen every tool named, edge to edge.
    { name: "schematicDataCentre", hash: "e3/schematic/schematic/schematicDataCentre" },
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
        // button is the button's. An input fills its field's 44px height: a tap 20px above or below
        // its middle lands in the input. Sample its own column: a compound field also contains
        // status text and buttons, which are checked separately below.
        const controls = [...band.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [role='radio'], [role='tab'], [role='button'], [aria-haspopup], [data-slot='tabClose']")]
            .filter((el) => el.checkVisibility({ visibilityProperty: true }))
            .filter((el) => el.parentElement?.closest("button, a[href], [role='button']") === null);
        if (controls.length === 0) bad.push("no control in the row");
        for (const el of controls) {
            const input = el.matches("input");
            const field = input ? (el.closest("[data-part='control']") ?? el) : el;
            const t = field.getBoundingClientRect();
            if (input && t.height < 43.5) bad.push(`${named(el)}: its field is ${t.height.toFixed(1)}px tall`);
            const own = el.getBoundingClientRect();
            const x = own.left + own.width / 2;
            const y = t.top + t.height / 2;
            for (const dy of input ? [-20, 20] : [-21, 21]) {
                const hit = document.elementFromPoint(x, y + dy);
                if (hit === null || !el.contains(hit)) bad.push(`${named(el)} (${t.width.toFixed(0)}×${t.height.toFixed(1)}): a tap ${dy < 0 ? "above" : "below"} its middle lands on ${named(hit)}`);
            }
        }
        // Controls that sit edge to edge — a segment strip's segments: siblings of one kind at most 2.5px apart. A tap
        // 2px inside one's edge, on its middle or 21px above or below it, lands on it: the halo of the one beside it,
        // drawn later, never takes it (`axis: "block"`, #1221).
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

/** Sizes the box a builder frame fills: its nearest ancestor that lays out — the Plan's `display: contents` wrapper does not. */
async function sizeFrame(entry: Locator, width: number): Promise<void> {
    await entry.locator("[data-builder-frame]").first().evaluate((frame, w) => {
        let box = frame.parentElement;
        while (box !== null && getComputedStyle(box).display === "contents") box = box.parentElement;
        if (box !== null) box.style.width = `${w}px`;
    }, width);
}

/**
 * Team B chosen in the slice-chrome plan rail's Owner editor (#1344), beside
 * the Team A its tasks start narrowed to: Team B's Design draws — its row, or
 * on a phone its card.
 */
const ownerChosen: Gesture = {
    what: "Team B chosen in the rail's Owner editor",
    run: async (entry, page) => {
        const editor = await recordField(page, entry.locator("[data-builder-frame]").first(), "owner");
        await editor.getByRole("button", { name: /^Team B/ }).tap();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(entry.locator(`[data-frame-slot='main'] ${drawnSel("jobs", "Design")}`)).toHaveCount(1);
        await settled(page);
    },
};

/**
 * The frame narrowed until the plan's rail folds its one field, Owner, to its
 * chip (#1344): a rail of one field has no icon rung, and the tasks' start is
 * the date navigator's, never the rail's.
 */
const railFolded: Gesture = {
    what: "the frame narrowed until the rail folds its Owner to its chip",
    run: (entry, page) => narrowUntil(entry, page, "[data-toolbar-item='record-slices'] [data-slice-fold='field:rows.owner']"),
};

/**
 * The builders' rails filtered (#1231): every control in the row still a 44px
 * tap target. The workshop's rail is its records' (#1345): on the phone an
 * order status is chosen in its editor and then cleared from it; on the wide
 * screen two sources are chosen from their chips — an order status and the
 * operation templates' group — and the row holds the chips it shows chosen.
 * The slice-chrome plan's rail is its tasks' record's (#1344): Team B is
 * chosen in its Owner editor, beside the Team A it starts with, and on the
 * wide screen the frame is then narrowed until the rail folds Owner to its
 * chip.
 */
const FILTERED: ReadonlyArray<{ name: string; hash: string; phone: readonly Gesture[]; wide: readonly Gesture[] }> = [
    {
        name: "sheetWorkshop", hash: "e3/sheet/sheet/sheetWorkshop",
        phone: [
            {
                what: "an order status chosen in the rail's editor",
                run: async (entry, page) => {
                    const editor = await recordField(page, entry.locator("[data-builder-frame]").first(), "status");
                    await editor.getByRole("button", { name: /^PLANNED/ }).tap();
                    await page.keyboard.press("Escape");
                    await expect(page.getByRole("dialog")).toHaveCount(0);
                    await expect(entry.locator("[data-frame-slot='main'] [data-slot='row'][data-band-row][data-row-id='WO-2201']")).toHaveCount(0);
                    await settled(page);
                },
            },
            {
                what: "the status cleared from its own editor",
                run: async (entry, page) => {
                    const editor = await recordField(page, entry.locator("[data-builder-frame]").first(), "status");
                    await editor.getByRole("button", { name: /^Clear / }).tap();
                    await page.keyboard.press("Escape");
                    await expect(page.getByRole("dialog")).toHaveCount(0);
                    await expect(entry.locator("[data-frame-slot='main'] [data-slot='row'][data-band-row][data-row-id='WO-2201']")).toHaveCount(1);
                    await settled(page);
                },
            },
        ],
        wide: [
            {
                what: "two sources chosen from their chips",
                run: async (entry, page) => {
                    for (const [source, field, value] of [["rows", "status", /^PLANNED/], ["rowTemplates", "group", /^Dispatch/]] as const) {
                        const editor = await recordField(page, entry.locator("[data-builder-frame]").first(), field, source);
                        await editor.getByRole("button", { name: value }).first().tap();
                        await page.keyboard.press("Escape");
                        await expect(page.getByRole("dialog")).toHaveCount(0);
                    }
                    await expect(entry.locator("[data-frame-slot='start'] [role='tab']").first()).toHaveText("Rows 5 of 11");
                    await settled(page);
                },
            },
        ],
    },
    {
        name: "slicePlanChrome", hash: `${PLAN_EXAMPLES}/slicePlanChrome`,
        phone: [ownerChosen],
        wide: [ownerChosen, railFolded],
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

/** The Flowchart's lane headers' anchors (#1245): middle across the top in LR, start down the side in TD. */
const laneAnchors = (entry: Locator) => entry.locator("[data-flowchart-lane]").evaluateAll((els) => els.map((el) => el.getAttribute("text-anchor")));

/** LR · TD's chip, by touch (#1245): its menu's TD turns the canvas, and the chip names it. */
const orientationByTouch: Gesture = {
    what: "LR · TD's chip, its TD",
    run: async (entry, page) => {
        await tapItem(entry, page, "[data-flowchart-segmenu]", "TD");
        await expect(openChipMenu(page)).toHaveCount(0);
        await expect(inRow(entry, "[data-flowchart-segmenu]")).toContainText("TD");
        await expect.poll(() => laneAnchors(entry)).toEqual(Array.from({ length: 5 }, () => "start"));
        await settled(page);
    },
};

/** Find state's icon, by touch (#1245): its popover's box finds a state, and a pick selects it. */
const findByTouch: Gesture = {
    what: "find state's icon, a state found in its popover and picked",
    run: async (entry, page) => {
        await inRow(entry, "[data-toolbar-item='seek'] [data-key-search='icon']").tap();
        const box = page.locator("[data-key-search='popover'] input");
        await expect(box).toBeFocused();
        await box.fill("dsp");
        await page.getByRole("option", { name: "DSP · Dispatched" }).tap();
        await expect(entry.locator("[data-flowchart-node='DSP']")).toHaveAttribute("data-selected", "true");
        await inRow(entry, "[data-toolbar-item='seek'] [data-key-search='icon']").tap();
        await expect(openPopover(page)).toHaveCount(0);
        await settled(page);
    },
};

/** A query in find state's box on the wide screen (#1245): its matches stepped, then the query cleared. */
const findStepped: Gesture = {
    what: "a query in find state, its matches stepped, then cleared",
    run: async (entry, page) => {
        const box = inRow(entry, "[data-toolbar-item='seek'] input");
        await box.fill("s");
        await expect(entry.getByRole("button", { name: "Next match" })).toBeVisible();
        await box.press("Escape");
        await entry.getByRole("button", { name: "Next match" }).tap();
        await expect(entry.locator("[data-flowchart-node][data-selected]")).toHaveCount(1);
        await entry.getByRole("button", { name: "Clear search" }).tap();
        await expect(box).toHaveValue("");
        await settled(page);
    },
};

/**
 * The frame narrowed, 10px at a time from 420px, until what `selector` names
 * draws in the row (#1245): past the phone's width the row still holds LR ·
 * TD's segment and find state's box — over the host's tables, which no rail
 * narrows (#1346), down to some 300px — so the frame narrows below it.
 */
function narrowedUntil(what: string, selector: string): Gesture {
    return {
        what,
        run: async (entry, page) => {
            const target = inRow(entry, selector);
            for (let width = 420; width >= 240 && !(await target.isVisible()); width -= 10) {
                await sizeFrame(entry, width);
                await settled(page);
            }
            await expect(target).toBeVisible();
        },
    };
}

/** The frame narrowed until LR · TD folds into its chip (#1245). */
const orientationToChip = narrowedUntil("the frame narrowed until LR · TD folds into its chip", "[data-flowchart-segmenu]");

/** The frame narrowed until find state folds to its icon (#1245), LR · TD folded into its chip before it. */
const findToIcon = narrowedUntil("the frame narrowed until find state folds to its icon", "[data-toolbar-item='seek'] [data-key-search='icon']");

/**
 * The builders whose rows fold into chips (#1229), each with the chips its
 * row draws at the phone's width — Studio's View chip and ⋯ chip, the SnapGrid
 * editor's View chip, the query builder's ⋯ chip — and the gestures that use
 * them by touch there; on the wide touch screen, where the rows unfold, the
 * frame narrowed until the design widths fold to their icons, which the edge
 * check reaches, and then until the chips draw. The Flowchart's LR · TD chip
 * and find state's icon (#1245) draw in a frame narrower than the phone's:
 * over the host's tables, which no rail narrows (#1346), the phone's row holds
 * LR · TD's segment and find state's box, so there the frame narrows until
 * both fold, and the gestures use them by touch.
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
    {
        // Over the host's tables, which no rail narrows (#1346), the phone's row folds no chip: the frame narrows until
        // LR · TD's chip and find state's icon draw.
        name: "flowchartDepot", hash: "e3/flowchart/flowchart/flowchartDepot",
        chips: [],
        phone: [findToIcon, orientationByTouch, findByTouch],
        wide: [findStepped, orientationToChip, findToIcon],
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

    test("⏎ in the workshop sheet rail's Customer search applies its prefix, and Escape leaves no list open; the grid shows the one order whose customer starts so (#1345)", async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1000 });
        const entry = await openToolbar(page, "e3/sheet/sheet/sheetWorkshop");
        const search = await customerSearch(entry, page);
        await search.fill("Quill");
        await search.press("Enter");
        // Escape closes the search's list, then its editor, the focus inside them: no list left open over the sheet.
        await escapeEditor(page);
        await expect(openList(page)).toHaveCount(0);
        await expect.poll(() => entry.locator("[data-frame-slot='main'] [data-slot='row'][data-band-row]")
            .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row-id")))).toEqual(["WO-2201"]);
        // The sheet takes the focus again at a tap, nothing left open over it.
        await entry.locator("[data-frame-slot='main'] [data-sheet-card]").tap();
        await expect.poll(() => focusInMain(entry)).toBe(true);
        await expect(openList(page)).toHaveCount(0);
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
