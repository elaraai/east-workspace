/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Studio's builder, measured in a real browser (#1000): one 44px toolbar
 * across its frame, over the palette's 264px pane under its 44px tab row, the
 * canvas column — whose selection bar is 44px — and the inspector's 300px
 * pane; each pane collapses to a 44px rail and the column takes the room (B1,
 * B13, B15). The palette's cards sit 6px apart, each with a 30px icon tile
 * (B3). The toolbar folds by one ladder — the grid chip first, then the width
 * readout, then the widths to their icons, then the zoom into the View chip as
 * the widths hide, then Save as template, Preview and Publish into the ⋯ chip
 * (#1229), the status, the history item last — so whatever a narrower frame
 * folds is the ladder's first steps (B8). Preview
 * opens the publish preview in the canvas's place: its 44px bar across the
 * frame and its 320px aside (E1, E3); the page on its panel, 24 / 28px in, at
 * most each device's width — Desktop and Tablet laying the page out at its
 * declared spans, Mobile stacking its placements in row order at 390px (E2).
 * The builder is set to the Studio's width, 1440px, and measured on the page
 * it opens at rest. Its builder frame (#1125 F3): on a desktop the palette
 * and the inspector are pinned, main between them; on a phone each rests on
 * its rail, and opened it floats over main from its edge, main where it was,
 * under the scrim — leaving a 48px strip of the scrim beside it, which a tap
 * closes. Every measurement is polled until it holds, on a page at rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-builder --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";
import { frameAt, type Box } from "./builder-frame";

/**
 * Open the builder example and return the builder, at rest: as wide as the
 * Studio's (1440px), or, with `null`, as wide as the page lays it out.
 */
async function openBuilder(page: Page, width: number | null = 1440): Promise<Locator> {
    await page.goto("/?theme=light#e3/studio/studio/studioBuilder");
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator('a[href="#e3/studio/studio/studioBuilder"]') });
    await entry.scrollIntoViewIfNeeded();
    const builder = entry.locator("[data-studio-builder]").first();
    await expect(builder.locator("[data-snap-grid-tile]").first()).toBeVisible({ timeout: 20_000 });
    if (width !== null) await builder.evaluate((root, w) => { (root as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
    return builder;
}

/** A difference of boxes' edges, to a tenth of a pixel — subtraction leaves float noise. */
const tenth = (n: number) => Math.round(n * 10) / 10;



/** A box's place within another, to a tenth of a pixel. */
const within = (box: Box, frame: Box): Box => ({ x: tenth(box.x - frame.x), y: tenth(box.y - frame.y), w: box.w, h: box.h });

/** Open the builder's publish preview from its toolbar, and return it. */
async function openPreview(page: Page): Promise<Locator> {
    const builder = await openBuilder(page);
    await builder.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = builder.locator("[data-studio-publish]");
    await expect(preview.locator("[data-snap-grid-cell]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return preview;
}

/** A part's rounded box within the builder. */
function box(builder: Locator, selector: string): Promise<{ w: number; h: number }> {
    return builder.evaluate((root, sel) => {
        const b = root.querySelector(sel)!.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height) };
    }, selector);
}

/** Where the page sits in the preview's panel, and its placements — each box relative to the page frame, to the pixel. */
function measure(preview: Locator) {
    return preview.evaluate((root) => {
        const main = root.querySelector("[data-publish-main]")!;
        const pageFrame = root.querySelector("[data-publish-frame]")!;
        const m = main.getBoundingClientRect();
        const f = pageFrame.getBoundingClientRect();
        const style = getComputedStyle(main);
        const cells = [...pageFrame.querySelectorAll("[data-snap-grid-cell]")].map((cell) => {
            const b = cell.getBoundingClientRect();
            return { key: cell.getAttribute("data-snap-grid-cell"), x: Math.round(b.left - f.left), y: Math.round(b.top - f.top), w: Math.round(b.width) };
        });
        return {
            padding: [Number.parseFloat(style.paddingTop), Number.parseFloat(style.paddingLeft)],
            column: Math.round(m.width - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)),
            frame: Math.round(f.width),
            centred: Math.abs((f.left - m.left) - (m.right - f.right)) <= 1,
            cells,
        };
    });
}

test.describe("Studio builder (#1000)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width");

    test("B1, B13: a 44px toolbar over the palette's 264px pane, under its 44px tab row, and the canvas column, whose selection bar is 44px; collapsed, the palette is a 44px rail and the column takes the room", async ({ page }) => {
        const builder = await openBuilder(page);
        await expect.poll(async () => ({
            toolbar: (await box(builder, "[data-frame-slot=toolbar]")).h,
            pane: (await box(builder, "[data-frame-slot='start']")).w,
            tabs: (await box(builder, "[data-frame-slot='start'] [data-surface=shell] > :first-child")).h,
            bar: (await box(builder, "[data-snap-grid-selection]")).h,
        })).toEqual({ toolbar: 44, pane: 264, tabs: 44, bar: 44 });
        const before = (await box(builder, "[data-snap-grid-main]")).w;

        await builder.getByRole("button", { name: "Collapse Components" }).click();
        await expect.poll(async () => (await box(builder, "[data-frame-slot='start']")).w).toBe(44);
        await expect.poll(async () => (await box(builder, "[data-snap-grid-main]")).w).toBe(before + 220);
    });

    test("B15: the inspector's pane is 300px after the canvas column; collapsed, it is a 44px rail and the column takes the room", async ({ page }) => {
        const builder = await openBuilder(page);
        await expect.poll(async () => (await box(builder, "[data-frame-slot='end']")).w).toBe(300);
        const before = (await box(builder, "[data-snap-grid-main]")).w;

        await builder.getByRole("button", { name: "Collapse Inspector" }).click();
        await expect.poll(async () => (await box(builder, "[data-frame-slot='end']")).w).toBe(44);
        await expect.poll(async () => (await box(builder, "[data-snap-grid-main]")).w).toBe(before + 256);
    });

    test("B3: the palette's cards sit 6px apart, each with a 30px icon tile", async ({ page }) => {
        const builder = await openBuilder(page);
        await expect.poll(() => builder.evaluate((root) => {
            // The Display group's two cards: the KPI rail, then the breakdown bars.
            const cards = [...root.querySelectorAll("[data-library^='studio.components'] [data-clickable]")]
                .map((card) => card.getBoundingClientRect());
            const tile = root.querySelector("[data-library^='studio.components'] svg[data-icon='gauge-high']")!
                .parentElement!.getBoundingClientRect();
            return {
                gap: cards.length < 2 ? -1 : Math.round(cards[1]!.top - cards[0]!.bottom),
                tile: [Math.round(tile.width), Math.round(tile.height)],
            };
        })).toEqual({ gap: 6, tile: [30, 30] });
    });

    test("B8: the toolbar folds by one ladder — the grid chip, the width readout, the widths, the zoom into the View chip as the widths hide, Save as template, Preview and Publish into the ⋯ chip, the status, the history item — and a narrower frame folds its first steps", async ({ page }) => {
        const builder = await openBuilder(page);
        const editor = builder.locator("[data-snap-grid-editor]");
        const toolbar = editor.locator("[data-frame-slot=toolbar] [data-toolbar]");
        await expect.poll(() => toolbar.getAttribute("data-toolbar-ladder"))
            .toBe("grid>1 readout>1 widths>1 zoom>1 widths>2 save-template>1 preview>1 publish>1 more>1 status>1 history>1");
        // At the mock's 1440px frame nothing folds.
        await expect.poll(() => toolbar.getAttribute("data-toolbar-folds")).toBe("0");
        // Each item by its first step: a chip's bundle folds together, so what has folded is still a run of these from the start.
        const ladder = ["grid", "readout", "widths", "zoom", "save-template", "preview", "publish", "more", "status", "history"];
        for (const width of [1000, 900, 800, 700, 600]) {
            await editor.evaluate((root, w) => { (root as HTMLElement).style.width = `${w}px`; }, width);
            await settled(page);
            const folded = await toolbar.evaluate((row) => (row.getAttribute("data-toolbar-state") ?? "").split(";")
                .map((s) => s.split("=")).filter(([, f]) => !f!.startsWith("0/")).map(([k]) => k));
            // What folds is always the ladder's first steps — the state lists
            // the items in the row's order, so they are put in the ladder's.
            folded.sort((a, b) => ladder.indexOf(a) - ladder.indexOf(b));
            expect(folded, `at ${width}px`).toEqual(ladder.slice(0, folded.length));
        }
    });

    test("E1, E3: the preview's bar is 44px tall across the frame; the aside is 320px wide beside the page, at the frame's edge", async ({ page }) => {
        const preview = await openPreview(page);
        await expect.poll(() => preview.evaluate((root) => {
            const r = root.getBoundingClientRect();
            const bar = root.querySelector("[data-publish-bar]")!.getBoundingClientRect();
            const aside = root.querySelector("[data-publish-aside]")!.getBoundingClientRect();
            return { bar: [Math.round(bar.height), Math.round(bar.width)], aside: Math.round(aside.width), asideAtRight: Math.round(r.right - aside.right) };
        })).toEqual({ bar: [44, 1440], aside: 320, asideAtRight: 0 });
    });

    test("E2: Desktop — the page 24 / 28px into its panel, as wide as the panel lets it be, at its declared spans", async ({ page }) => {
        const preview = await openPreview(page);
        await expect.poll(async () => {
            const at = await measure(preview);
            const row2 = at.cells.filter((c) => c.key === "a-orders" || c.key === "a-bars");
            return {
                padding: at.padding, frameIsColumn: at.frame === at.column,
                // The orders' 8 columns beside the bars' 4, on one line.
                row2: row2.map((c) => c.key), oneLine: new Set(row2.map((c) => c.y)).size === 1, twice: Math.abs(row2[0]!.w / row2[1]!.w - 2) < 0.1,
            };
        }).toEqual({ padding: [24, 28], frameIsColumn: true, row2: ["a-orders", "a-bars"], oneLine: true, twice: true });
    });

    test("E2: Tablet — the page at most 1024px, centred in its panel, still at its declared spans", async ({ page }) => {
        const preview = await openPreview(page);
        await preview.locator('[data-publish-device="tablet"]').click();
        await expect.poll(async () => {
            const at = await measure(preview);
            const row2 = at.cells.filter((c) => c.key === "a-orders" || c.key === "a-bars");
            return { frame: at.frame, centred: at.centred, oneLine: new Set(row2.map((c) => c.y)).size === 1 };
        }).toEqual({ frame: 1024, centred: true, oneLine: true });
    });

    test("E2: Mobile — the page 390px wide, centred in its panel, every placement the page's width, in row order", async ({ page }) => {
        const preview = await openPreview(page);
        await preview.locator('[data-publish-device="mobile"]').click();
        await expect.poll(async () => {
            const at = await measure(preview);
            const ys = at.cells.map((c) => c.y);
            return {
                frame: at.frame, centred: at.centred,
                keys: at.cells.map((c) => c.key),
                full: at.cells.every((c) => c.x === 0 && c.w === 390),
                stacked: ys.every((y, i) => i === 0 || y > ys[i - 1]!),
            };
        }).toEqual({ frame: 390, centred: true, keys: ["a-kpi", "a-orders", "a-bars", "a-trend"], full: true, stacked: true });
    });
});

test.describe("Studio builder — its builder frame on a desktop (#1125 F3)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured at the desktop width");

    test("the palette and the inspector are pinned: main starts where the open palette ends, and the inspector where main ends; no scrim", async ({ page }) => {
        const builder = await openBuilder(page);
        await expect.poll(async () => {
            const at = await frameAt(builder);
            const start = at.start!, end = at.end!;
            return {
                modes: [start.mode, end.mode], collapsed: [start.collapsed, end.collapsed],
                mainFromPalette: tenth(at.main.x - (start.slot.x + start.slot.w)),
                inspectorFromMain: tenth(end.slot.x - (at.main.x + at.main.w)),
                // Each pane in its slot, in the flow.
                inSlots: [within(start.sheet, start.slot), within(end.sheet, end.slot)],
                scrim: at.scrim,
            };
        }).toEqual({
            modes: ["pinned", "pinned"], collapsed: [false, false],
            mainFromPalette: 0, inspectorFromMain: 0,
            inSlots: [{ x: 0, y: 0, w: 264, h: expect.any(Number) }, { x: 0, y: 0, w: 300, h: expect.any(Number) }],
            scrim: null,
        });
    });
});

test.describe("Studio on a phone (`Studio Mobile Spec.md`)", () => {
    test.skip(({ isMobile }) => !isMobile, "measured on the phone");

    /** The builder in its phone's frame, at rest. */
    async function openPhone(page: Page): Promise<{ builder: Locator; frame: Locator }> {
        // Wide enough for the example's own 390: a phone's frame is the frame's width, not the screen's.
        await page.setViewportSize({ width: 470, height: 1000 });
        await page.goto("/?theme=light#e3/studio/studio/studioBuilderMobile");
        await page.waitForSelector("header", { timeout: 20_000 });
        const entry = page.locator("[data-index]", { has: page.locator('a[href="#e3/studio/studio/studioBuilderMobile"]') });
        await entry.scrollIntoViewIfNeeded();
        const builder = entry.locator("[data-studio-builder]").first();
        const frame = builder.locator("[data-builder-frame][data-phone]");
        await expect(frame.locator("[data-snap-grid-tile]").first()).toBeVisible({ timeout: 20_000 });
        await settled(page);
        return { builder, frame };
    }
    /** What no popover may be, on this phone. */
    const nothingFloats = (page: Page) => expect(page.locator('[data-scope="popover"][data-part="content"][data-state="open"], [data-scope="menu"][data-part="content"][data-state="open"]:not([data-frame-layer-content])')).toHaveCount(0);

    test("the first row by width (ST1–ST3), the canvas's stack and captions (ST8–ST10), no grid, no drag, no zoom (D1, D3); select, the bar, the stepper as one undo step (ST12–ST16)", async ({ page }) => {
        const { builder, frame } = await openPhone(page);
        expect(await frame.evaluate((root) => {
            const bar = root.querySelector("[data-studio-phone-bar]")!.getBoundingClientRect();
            const box = root.querySelector("[data-studio-preview] > span")!.getBoundingClientRect();
            const target = root.querySelector("[data-studio-preview]")!.getBoundingClientRect();
            const publish = root.querySelector("[data-studio-open-publish] > span")!.getBoundingClientRect();
            const meter = root.querySelector("[data-span-meter]")!;
            return {
                bar: bar.height, box: box.height, target: target.height, fromEdge: Math.round(root.getBoundingClientRect().right - publish.right), template: root.querySelector("[data-studio-save-template]") !== null,
                grid: root.querySelector("[data-snap-grid-ruler], [data-snap-grid-bands], [data-snap-grid-zoom], [data-snap-grid-widths], [data-draggable]") === null,
                cells: meter.children.length,
                caption: Math.round(root.querySelector("[data-tile-caption]")!.getBoundingClientRect().height),
            };
        })).toEqual({ bar: 44, box: 32, target: 44, fromEdge: 12, template: true, grid: true, cells: 12, caption: 24 });
        // Below 372 Save as template is ⋯'s, whose view it goes straight to: nothing floats (ST3, ST27, ST28).
        await builder.evaluate((root) => { (root as HTMLElement).style.width = "324px"; });
        await settled(page);
        await expect(frame.locator("[data-studio-save-template]")).toHaveCount(0);
        const more = frame.locator("[data-studio-more]");
        await more.click(); await settled(page);
        await expect(frame.locator('[data-frame-slot="overlay"]').getByRole("textbox", { name: "Template name" })).toBeVisible();
        await nothingFloats(page);
        await page.keyboard.press("Escape"); await settled(page);
        await builder.evaluate((root) => { (root as HTMLElement).style.width = ""; });
        await settled(page);

        // A tap selects: the bar under the page, the tile in sight above it; every control 44.
        const tile = frame.locator("[data-snap-grid-tile]").nth(1);
        await tile.click(); await settled(page);
        const bar = frame.locator("[data-snap-grid-tile-bar]");
        await expect(bar).toContainText("Row 2 · Orders by week");
        await expect(frame.locator("[data-tile-consequence]")).toHaveText("Columns 1–8 of 12 · row 2 is full");
        await expect(frame.locator("[data-span-plus]")).toBeDisabled();
        expect(await frame.evaluate((root) => {
            const inSight = root.querySelector("[data-selected]")!.getBoundingClientRect();
            const main = root.querySelector("[data-snap-grid-phone-scroll]")!.getBoundingClientRect();
            return { inSight: inSight.top >= main.top - 1 && inSight.bottom <= main.bottom + 1, targets: [...root.querySelectorAll("[data-snap-grid-tile-bar] button")].every((b) => b.getBoundingClientRect().height >= 42) };
        })).toEqual({ inSight: true, targets: true });
        // Two steps: one Undo; the value marked dirty.
        await frame.locator("[data-span-minus]").click();
        await frame.locator("[data-span-minus]").click();
        await expect(frame.locator("[data-span-value]")).toHaveText("6 / 12");
        await expect(frame.locator("[data-span-value]")).toHaveAttribute("data-dirty", "");
        await expect(frame.locator("[data-tile-consequence]")).toHaveText("Columns 1–6 of 12 · 2 free in row 2");
        await frame.locator('[data-frame-slot="sessionRow"]').getByRole("button", { name: "Undo" }).click();
        await expect(frame.locator("[data-span-value]")).toHaveText("8 / 12");
        // Again taps it off.
        await tile.click();
        await expect(bar).toHaveCount(0);
    });

    test("pick, then place: Move's outline, no slot in a full row, a slot's tap places and selects (ST17–ST20, D4); a card starts it and Inspector's Move too (ST21–ST24); Height a view, Save as template a view (ruled)", async ({ page }) => {
        const { frame } = await openPhone(page);
        // Row 2 is full: moving the row's first tile offers its own row only by its own span.
        await frame.locator("[data-snap-grid-tile]").nth(1).click(); await settled(page);
        await frame.locator("[data-span-minus]").click();
        await frame.locator("[data-tile-move]").click(); await settled(page);
        const outline = frame.locator("[data-snap-grid-outline]");
        await expect(outline).toBeVisible();
        await expect(frame.locator("[data-snap-grid-place-bar]")).toContainText("Moving · Orders by week");
        // Row 1, full, has no slot; the count is what is drawn.
        const slots = await outline.locator("[data-place-slot]").count();
        await expect(frame.locator("[data-place-count]")).toContainText(`${slots} slots · span 7 of 12`);
        await expect(outline.locator('[data-place-slot="join"]', { hasText: "row 1" })).toHaveCount(0);
        expect(await outline.locator("[data-place-slot]").evaluateAll((all) => all.every((s) => s.getBoundingClientRect().height >= 44))).toBe(true);
        // Its own row keeps it in place: Into row 2 only past the row's next tile.
        await outline.locator('[data-place-slot="join"]', { hasText: "row 2" }).first().click(); await settled(page);
        await expect(frame.locator("[data-snap-grid-tile-bar]")).toContainText("Orders by week");
        await expect(outline).toHaveCount(0);
        await frame.locator('[data-frame-slot="sessionRow"]').getByRole("button", { name: "Undo" }).click(); await settled(page);

        // Components: the intro, no grips; a tap closes the view and starts placing; a slot adds it.
        await frame.locator("[data-pane-tab='start']").click(); await settled(page);
        const pane = frame.locator("[data-frame-drawer][data-open]");
        await expect(pane.locator("[data-studio-intro]").first()).toContainText("Tap a component");
        await expect(pane.locator("[data-drag-grip]")).toHaveCount(0);
        expect(await pane.locator("[data-clickable]").evaluateAll((cards) => cards.filter((c) => (c as HTMLElement).offsetHeight > 0).every((c) => c.getBoundingClientRect().height >= 56))).toBe(true);
        // A menu of the pane's: a view over the whole frame, its rows 44, and Esc goes back to the pane, not past it.
        await pane.getByRole("button", { name: "Group by" }).click(); await settled(page);
        await nothingFloats(page);
        const layer = frame.locator('[data-frame-slot="overlay"] [data-frame-layer-content]');
        await expect(layer).toBeVisible();
        // Measured once it has slid in: under a moving transform the browser works a box out in floats, and 44 can read 43.99.
        await layer.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.then(() => undefined, () => undefined))));
        expect(await layer.evaluate((el) => {
            const box = el.getBoundingClientRect(), root = el.closest("[data-builder-frame]")!.getBoundingClientRect();
            return { covers: Math.abs(box.width - root.width) < 1 && Math.abs(box.height - root.height) < 1, rows: [...el.querySelectorAll("[data-part=item]")].every((r) => r.getBoundingClientRect().height >= 44) };
        })).toEqual({ covers: true, rows: true });
        await page.keyboard.press("Escape"); await settled(page);
        await expect(layer).toHaveCount(0);
        await expect(frame.locator("[data-frame-drawer][data-open]")).toBeVisible();
        const before = await frame.locator("[data-snap-grid-tile]").count();
        await pane.locator("[data-clickable]", { hasText: "Visits sparkline" }).click(); await settled(page);
        await expect(frame.locator("[data-frame-drawer][data-open]")).toHaveCount(0);
        await expect(frame.locator("[data-snap-grid-place-bar]")).toContainText("Adding · Visits sparkline");
        await outline.locator('[data-place-slot="gap"]').last().click(); await settled(page);
        await expect(frame.locator("[data-snap-grid-tile]")).toHaveCount(before + 1);
        await expect(frame.locator("[data-snap-grid-tile-bar]")).toContainText("Visits sparkline");

        // The Inspector: its row a readout, Move starts placing; Height a view of its options, nothing floating.
        await frame.locator("[data-pane-tab='end']").click(); await settled(page);
        const inspector = frame.locator("[data-frame-drawer][data-open]");
        await expect(inspector.locator("[data-inspector-row]")).toHaveText(/of/);
        await inspector.locator("[data-inspector-height]").click(); await settled(page);
        await expect(frame.locator('[data-frame-slot="overlay"] [data-inspector-heights] [role=option]').first()).toBeVisible();
        await nothingFloats(page);
        await frame.locator('[data-frame-slot="overlay"] [role=option]', { hasText: "240 px" }).click(); await settled(page);
        await expect(inspector.locator("[data-inspector-height]")).toContainText("240 px");
        await inspector.locator("[data-inspector-move]").click(); await settled(page);
        await expect(frame.locator("[data-frame-drawer][data-open]")).toHaveCount(0);
        await expect(frame.locator("[data-snap-grid-place-bar]")).toContainText("Moving");
        await frame.locator("[data-place-cancel]").click();
        await expect(frame.locator("[data-snap-grid-place-bar]")).toHaveCount(0);
    });

    test("the preview in the builder's place: Page and Changes as Preview and Publish open them, Mobile first, the wireframes by name, the foot's stacking (ST5, ST30–ST33); a page of none and Save's band (ST34, ST36)", async ({ page }) => {
        const { builder, frame } = await openPhone(page);
        await frame.locator("[data-studio-preview]").click(); await settled(page);
        const preview = builder.locator("[data-publish-phone]");
        await expect(preview.locator('[data-publish-tab="page"]')).toHaveAttribute("aria-selected", "true");
        await expect(preview.locator('[data-publish-device="mobile"]')).toHaveAttribute("aria-pressed", "true");
        await expect(preview.locator("[data-snap-grid-cell]").first()).toBeVisible();
        await preview.locator('[data-publish-device="desktop"]').click(); await settled(page);
        await expect(preview.locator("[data-publish-wire]")).toContainText("Orders by week");
        await preview.locator("[data-publish-exit]").click(); await settled(page);
        await frame.locator("[data-studio-open-publish]").click(); await settled(page);
        await expect(preview.locator('[data-publish-tab="changes"]')).toHaveAttribute("aria-selected", "true");
        await expect(preview.locator("[data-publish-changes] li").first()).toBeVisible();
        expect(await preview.evaluate((root) => {
            const save = root.querySelector("[data-publish-save]")!.getBoundingClientRect();
            const publish = root.querySelector("[data-publish-publish]")!.getBoundingClientRect();
            return { save: save.height, publish: publish.height, sideBySide: Math.abs(save.top - publish.top) < 1 };
        })).toEqual({ save: 44, publish: 44, sideBySide: true });
        await builder.evaluate((root) => { (root as HTMLElement).style.width = "324px"; });
        await settled(page);
        expect(await preview.evaluate((root) => root.querySelector("[data-publish-publish]")!.getBoundingClientRect().top > root.querySelector("[data-publish-save]")!.getBoundingClientRect().bottom)).toBe(true);
        await builder.evaluate((root) => { (root as HTMLElement).style.width = ""; });
        await preview.locator("[data-publish-exit]").click(); await settled(page);

        // A page of none: every tile removed, a draft; what to do, and Add a component.
        const tiles = frame.locator("[data-snap-grid-tile]");
        for (let left = await tiles.count(); left > 0; left--) {
            await tiles.first().click();
            await frame.locator("[data-tile-remove]").click();
        }
        await expect(frame.locator("[data-snap-grid-empty]")).toContainText("No components on");
        await expect(frame.locator("[data-snap-grid-add]")).toBeVisible();
        await frame.locator('[data-frame-slot="sessionRow"]').getByRole("button", { name: "Discard" }).click();
        await frame.locator("[data-history-discard-confirm]").click(); await settled(page);
        await expect(tiles.first()).toBeVisible();

        // Save's band.
        await tiles.nth(1).click(); await settled(page);
        await frame.locator("[data-span-minus]").click();
        await frame.locator('[data-frame-slot="sessionRow"]').getByRole("button", { name: "Save" }).click();
        await expect(frame.locator("[data-snap-grid-saved-band]")).toHaveText("Saved 1 change");
    });

    test("a change that meets someone else's save waits: its frame dashed, Conflict in its caption, the band over the strip, Issues counting it and opening the Inspector's tab, mine against theirs, either clearing it (ST7, ST37)", async ({ page }) => {
        await page.setViewportSize({ width: 430, height: 1000 });
        await page.goto("/?theme=light#e3/studio/studio/studioConflicts");
        await page.waitForSelector("header", { timeout: 20_000 });
        const entry = page.locator("[data-index]", { has: page.locator('a[href="#e3/studio/studio/studioConflicts"]') });
        await entry.scrollIntoViewIfNeeded();
        const frame = entry.locator("[data-builder-frame][data-phone]");
        await expect(frame.locator("[data-snap-grid-tile]").first()).toBeVisible({ timeout: 20_000 });
        await settled(page);
        await frame.locator("[data-snap-grid-tile]").nth(1).click();
        await frame.locator("[data-span-minus]").click();
        await frame.locator("[data-span-minus]").click();
        await entry.getByRole("button", { name: "Someone else saves" }).click();
        await expect(frame.locator("[data-tile-conflict]")).toHaveText("Conflict");
        expect(await frame.locator("[data-snap-grid-tile][data-conflict] > [data-snap-grid-phone-frame]").evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");
        // Issues counts it and opens the Inspector's Issues tab; nothing floats, no conflicts button. The band's Choose goes there too.
        await expect(frame.locator("[data-conflicts]")).toHaveCount(0);
        await expect(frame.locator("[data-history-issues]")).toHaveText("1");
        await frame.locator("[data-banner-action=choose]").click(); await settled(page);
        const pane = frame.locator("[data-frame-drawer][data-open]");
        const issue = pane.locator("[data-snap-grid-issue]");
        await expect(issue).toContainText("Conflict · Row 2");
        await expect(issue).toContainText("Orders by week · column span");
        await expect(issue).toContainText("6 / 12 · columns 1–6");
        await expect(issue).toContainText("7 / 12");
        await expect(page.locator('[data-scope="popover"][data-part="content"][data-state="open"]')).toHaveCount(0);
        // Either clears it, and Save no longer waits.
        await issue.locator('[data-issue-keep="draft"]').click();
        await expect(issue).toHaveCount(0);
        await expect(pane.locator("[data-snap-grid-issues][data-empty]")).toBeVisible();
        await page.keyboard.press("Escape"); await settled(page);
        await expect(frame.locator("[data-tile-conflict]")).toHaveCount(0);
        await frame.locator("[data-history-issues]").waitFor({ state: "detached" });
    });
});
