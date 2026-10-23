/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Schematic read a window at a time, in a real browser (#1393, `Schematic
 * Builder Spec.md` §10.4, D25), on the floor of 20,000 racks: fitted, the
 * whole floor in view holds more racks than a window draws, so the canvas
 * shades their density and the footer says how many it shades and that
 * zooming in draws them — `Density: 20,000 racks — zoom in to draw them`, the
 * count exact while every cell it shades lies in view (ruled 23 Oct 2026) —
 * the one live notice, and on a phone, at 390 and 360px and in a 294px parent,
 * its words wrapping inside the rail, nothing past its edge. A tap on the
 * density zooms in about it, and once the racks there are read the footer
 * says nothing, its loading line idle: they draw as themselves. Zoomed in until they draw as their
 * cards, no two overlap, and a pan leaves which of them draw as cards as it
 * was (ruled 23 Oct 2026). Zoomed into a hall's front rows, where the racks
 * draw as dots, each reads its load — what its dot's colour says — by the runs
 * the window's cells are of the area index, e3 reading their keys, so none is
 * sent; a pan inside the window reads none (D45). The switch counts the view
 * (D25): past 5,000 racks in it they are shaded, the footer saying more than
 * 5,000, and a view of fewer draws them, though its window's cells, reaching
 * the halls either side, hold more; wheeled back out to Fit, the floor is
 * shaded in the cells it opened in, one view one raster by any route. The
 * minimap draws the floor's whole density wherever the view is, never a dot
 * of a rack's, and on a phone keeps to a quarter of the canvas's width.
 *
 * Every wait is a poll on the page's state, never a fixed pause.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-window`.
 */

import { test, expect, type Locator } from "playwright/test";
import { e3Requests, installE3Faults } from "./e3-faults";
import { RECORD_INDEXES, cardOverlaps, cardsIn, openSchematic, screenPoint, sizeTo, viewOf, zoomInto, type WorldBox } from "./schematic-page";
import { settled } from "./settle";

/** The racks' loads, as the page's reads name them. */
const LOADS = "records.schematic_stress_rack_loads";

/** The density's words. */
const notice = (root: Locator) => root.locator("[data-schematic-footer] [data-schematic-density='racks']");

/** The minimap. */
const minimap = (root: Locator) => root.locator("[data-schematic-minimap]");

/** How many cells of the racks' whole drawing's density the minimap draws, once it draws any. */
async function minimapCells(root: Locator): Promise<number> {
    await expect.poll(async () => Number(await minimap(root).getAttribute("data-minimap-cells")), "the minimap's density cells").toBeGreaterThan(0);
    return Number(await minimap(root).getAttribute("data-minimap-cells"));
}

/** The minimap's width over the canvas's, as the page lays them out. */
function minimapShare(root: Locator): Promise<number> {
    return root.evaluate((el) => {
        const canvas = el.querySelector("[data-schematic-canvas]")!.getBoundingClientRect();
        return el.querySelector("[data-schematic-minimap]")!.getBoundingClientRect().width / canvas.width;
    });
}

/** How many racks the density's words say it shades. */
async function saidRows(root: Locator): Promise<number> {
    const words = await notice(root).textContent() ?? "";
    const count = /([\d,]+) racks/.exec(words);
    expect(count, `a count of racks in "${words}"`).not.toBeNull();
    return Number(count![1]!.replaceAll(",", ""));
}

/**
 * How many of the floor's 20,000 racks stand in a box by their centres, placed as the example's generator places them:
 * a row of 100 in each of the ten halls in turn, 0.7 m apart along a row and 2.4 m from row to row, five halls to a row
 * of the floor, 76 m and 126 m apart.
 */
function racksIn(box: WorldBox): number {
    let n = 0;
    for (let i = 0; i < 20_000; i++) {
        const hall = Math.floor(i / 100) % 10, row = Math.floor(i / 1000);
        const x = (hall % 5) * 76 + (i % 100) * 0.7 + 3.3, y = Math.floor(hall / 5) * 126 + row * 2.4 + 3.6;
        if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) n++;
    }
    return n;
}

/** What passes an edge: the density's words past the rail's inner box, the rail past the frame's, or the page wider than the window. */
function overflow(root: Locator): Promise<string[]> {
    return root.evaluate((el) => {
        const rail = el.querySelector<HTMLElement>("[data-schematic-footer]")!;
        const words = rail.querySelector("[data-schematic-density]")!.getBoundingClientRect();
        const r = rail.getBoundingClientRect(), frame = el.querySelector("[data-builder-frame]")!.getBoundingClientRect();
        const css = getComputedStyle(rail);
        const inner = { left: r.left + parseFloat(css.paddingLeft), right: r.right - parseFloat(css.paddingRight) };
        const out: string[] = [];
        if (words.left < inner.left - 0.5 || words.right > inner.right + 0.5) out.push(`the words span ${Math.round(words.left)}–${Math.round(words.right)}, the rail ${Math.round(inner.left)}–${Math.round(inner.right)}`);
        if (r.right > frame.right + 0.5) out.push(`the rail ends at ${Math.round(r.right)}, the frame at ${Math.round(frame.right)}`);
        const doc = document.documentElement;
        if (doc.scrollWidth > doc.clientWidth) out.push(`the page is ${doc.scrollWidth}px wide in a ${doc.clientWidth}px window`);
        return out;
    });
}

test("fitted, the floor's density: the footer says how many racks it shades and that zooming in draws them, its one live notice, nothing past the rail's edge; the minimap draws the floor's density, on a phone in its corner (#1393)", async ({ page, isMobile }) => {
    const root = await openSchematic(page, RECORD_INDEXES);
    await expect(notice(root)).toHaveText("Density: 20,000 racks — zoom in to draw them");
    await expect(root.locator("[data-schematic-notices] > *")).toHaveCount(1);
    expect(await overflow(root)).toEqual([]);
    // The minimap: the racks' whole drawing as its density, never a dot of theirs.
    expect(await minimapCells(root)).toBeGreaterThan(0);
    await expect(minimap(root)).toHaveAttribute("data-minimap-items", "0");
    expect(await minimapShare(root)).toBeLessThanOrEqual(0.25);
    if (!isMobile) return;
    // On a phone, narrower still: the words wrap inside the rail, and the minimap keeps to a quarter of the canvas's width.
    await page.setViewportSize({ width: 360, height: 740 });
    await settled(page);
    await expect(notice(root)).toBeVisible();
    expect(await overflow(root), "at 360px").toEqual([]);
    expect(await minimapShare(root), "the minimap at 360px").toBeLessThanOrEqual(0.25);
    await sizeTo(page, root, 294);
    await expect(notice(root)).toBeVisible();
    expect(await overflow(root), "in a 294px parent").toEqual([]);
    expect(await minimapShare(root), "the minimap in a 294px parent").toBeLessThanOrEqual(0.25);
});

test.describe("A tap on the density (#1393)", () => {
    test.skip(({ isMobile }) => isMobile, "a desktop's canvas, whose tap zooms in to fewer racks than a window draws");

    test("zooms in about it, and once the racks there are read — main busy no more — the footer says nothing", async ({ page }) => {
        const root = await openSchematic(page, RECORD_INDEXES);
        await expect(notice(root)).toBeVisible();
        // Hall 1's front rows: the canvas flies in about the tap, eight of its cells across, and reads the window there.
        const front = await screenPoint(root, 20.0, 10.0);
        await page.mouse.click(front.x, front.y);
        const main = root.locator("[data-frame-slot='main']");
        await expect.poll(async () => (await main.getAttribute("aria-busy")) === "true" || (await notice(root).count()) === 0,
            "the window there read, or reading").toBe(true);
        await settled(page);
        await expect(notice(root)).toHaveCount(0);
        await expect(root.locator("[data-schematic-notices] > *")).toHaveCount(0);
        await expect(root.locator("[data-schematic-footer] [data-footer-line]")).toHaveAttribute("data-idle", "");
    });

    test("zoomed in until the racks draw as their cards — each 0.6 m holding its words — no two overlap, and a pan leaves which of them draw as cards as it was (ruled 23 Oct 2026)", async ({ page }) => {
        const root = await openSchematic(page, RECORD_INDEXES);
        const front = await screenPoint(root, 20.0, 10.0);
        await page.mouse.click(front.x, front.y);
        await settled(page);
        await expect(notice(root)).toHaveCount(0);
        // In about the canvas's middle, a press at a time, until the racks there draw as their cards.
        const zoomIn = root.locator("[data-frame-slot='toolbar']").getByRole("button", { name: "Zoom in" });
        const cards = root.locator("[data-card-key]");
        for (let presses = 0; await cards.count() === 0; presses++) {
            expect(presses, "presses of Zoom in before the racks draw as their cards").toBeLessThan(12);
            await zoomIn.click();
            await settled(page);
        }
        expect(await cardOverlaps(root)).toEqual([]);
        // A pan of 60 × 40px: the cards whose centres stood in the canvas's middle, 150px in from each edge, stand there
        // moved with the floor, and nothing else draws as a card there.
        const canvas = (await root.locator("[data-schematic-canvas]").boundingBox())!;
        const inner = { left: canvas.x + 150, top: canvas.y + 150, right: canvas.x + canvas.width - 150, bottom: canvas.y + canvas.height - 150 };
        const before = await cardsIn(root, inner);
        expect(before.length).toBeGreaterThan(0);
        const middle = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
        await page.mouse.move(middle.x, middle.y);
        await page.mouse.down();
        await page.mouse.move(middle.x + 60, middle.y + 40, { steps: 6 });
        await page.mouse.up();
        await settled(page);
        const after = await cardsIn(root, { left: inner.left + 60, top: inner.top + 40, right: inner.right + 60, bottom: inner.bottom + 40 });
        expect(new Set(after)).toEqual(new Set(before));
        expect(await cardOverlaps(root)).toEqual([]);
    });

    test("the switch counts the view: past 5,000 racks in it they are shaded, the footer saying more; a view of fewer draws them, though its window's cells hold more; wheeled back out to Fit, the floor shades in the cells it opened in (D25)", async ({ page }) => {
        const root = await openSchematic(page, RECORD_INDEXES);
        await expect(notice(root)).toHaveText("Density: 20,000 racks — zoom in to draw them");
        const opened = await notice(root).getAttribute("data-density-cell");
        expect(opened, "the side of the cells it shades in").not.toBeNull();
        const overview = await minimapCells(root);
        // Halls 2, 3 and 4's front rows, and a slip of halls 1 and 5's: past 5,000 racks in view, shaded, and the footer
        // says about how many — more than a window draws.
        await zoomInto(page, root, { minX: 79.0, minY: 3.0, maxX: 301.0, maxY: 50.0 });
        const many = racksIn(await viewOf(root));
        expect(many, "racks in view").toBeGreaterThan(5_000);
        // The canvas tells its reader where its viewport rests once it has rested a moment: the footer counts the view then.
        await expect.poll(async () => Math.abs(await saidRows(root) - many), `the footer's count of the ${many} racks in view`).toBeLessThan(many / 10);
        expect(await saidRows(root), "the racks the footer says it shades").toBeGreaterThan(5_000);
        // Halls 2 and 3's: fewer than 5,000 racks in view, drawn as themselves, though the cells of its window — the
        // view, its margin and the cells' reach past them, into halls 1 and 4 — hold more than 5,000.
        await zoomInto(page, root, { minX: 79.0, minY: 3.0, maxX: 225.0, maxY: 50.0 });
        const fewer = racksIn(await viewOf(root));
        expect(fewer, "racks in view").toBeGreaterThan(3_000);
        expect(fewer).toBeLessThanOrEqual(5_000);
        await expect(notice(root)).toHaveCount(0);
        await expect(root.locator("[data-schematic-canvas]")).toHaveAttribute("data-lod", "dot");
        // The minimap still draws the whole floor: its overview, never the window the racks were read by (#1393).
        await expect(minimap(root)).toHaveAttribute("data-minimap-cells", String(overview));
        // Out a notch of the wheel at a time, each let rest, until the zoom stops at Fit: the floor shaded as it opened.
        const zoomOut = root.locator("[data-frame-slot='toolbar']").getByRole("button", { name: "Zoom out" });
        const canvas = (await root.locator("[data-schematic-canvas]").boundingBox())!;
        await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
        for (let notches = 0; await zoomOut.isEnabled(); notches++) {
            expect(notches, "notches of the wheel out to Fit").toBeLessThan(30);
            await page.mouse.wheel(0, 100);
            await settled(page);
        }
        await expect(notice(root)).toHaveText("Density: 20,000 racks — zoom in to draw them");
        await expect(notice(root)).toHaveAttribute("data-density-cell", opened!);
    });

    test("zoomed into a hall's front rows, its racks drawn as dots read their loads by the runs of the window's cells — no key sent — and a pan inside the window reads none (D45)", async ({ page }) => {
        await installE3Faults(page);
        const root = await openSchematic(page, RECORD_INDEXES);
        await expect(notice(root)).toBeVisible();
        // Hall 1's front rows, 70 m by 49 m: fewer racks than a window draws, each a dot at this zoom.
        await zoomInto(page, root, { minX: 3.0, minY: 3.0, maxX: 73.0, maxY: 52.0 });
        await expect(notice(root)).toHaveCount(0);
        await expect(root.locator("[data-schematic-canvas]")).toHaveAttribute("data-lod", "dot");
        /** The page's reads of the loads, each by what its body names. */
        const loadReads = async () => (await e3Requests(page))
            .filter((request) => request.kind === "rows" && request.dataset === LOADS)
            .map((request) => JSON.parse(request.body ?? "{}") as { keys?: unknown; keysOf?: { index: string; runs: unknown[] } });
        const read = await loadReads();
        expect(read.length, "the loads are read at the dots' zoom").toBeGreaterThan(0);
        for (const body of read) {
            expect(body.keys, "no key is sent").toBeUndefined();
            expect(body.keysOf?.index).toBe("schematic_stress_racks_by_area");
            expect(body.keysOf?.runs.length).toBeGreaterThan(0);
        }
        // A pan of 40 × 30px, inside the window's margin: no cell is added, and nothing more of the loads is read.
        const canvas = (await root.locator("[data-schematic-canvas]").boundingBox())!;
        const middle = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
        await page.mouse.move(middle.x, middle.y);
        await page.mouse.down();
        await page.mouse.move(middle.x + 40, middle.y + 30, { steps: 6 });
        await page.mouse.up();
        await settled(page);
        expect((await loadReads()).length).toBe(read.length);
    });
});
