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
 * of a rack's, and on a phone keeps to a quarter of the canvas's width. A pan
 * into cells not read, the read held, washes what the drawing does not cover
 * — under the grid, the paint and the cards, moving with the camera as a card
 * does — until the window lands (#1398, CL2). The canvas's own paint, read
 * through its 2D context, draws the density in the theme's heat steps and
 * nothing past the racks, and each rack's dot in its load's status token, in
 * both themes (#1395); and with a hall chosen on the rail, fitted, its 2,000
 * racks drawn as dots packed a metre or two apart paint their status colours,
 * the dots' paper never a block over them, and the hall's eyebrow stands over
 * them, its words on their knockout (ruled 26 Oct 2026, "Legible dots").
 *
 * Every wait is a poll on the page's state, never a fixed pause; nothing reads
 * a screenshot.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-window`.
 */

import { test, expect, type Locator } from "playwright/test";
import { e3Requests, heldE3, holdE3, installE3Faults, releaseE3 } from "./e3-faults";
import { recordField } from "./record-slice";
import { RECORD_INDEXES, cardOverlaps, cardsIn, openSchematic, screenPoint, sizeTo, viewOf, zoomInto, type WorldBox } from "./schematic-page";
import { settled } from "./settle";

/** The racks' loads, as the page's reads name them. */
const LOADS = "records.schematic_stress_rack_loads";

/** The racks, as the page's reads name them. */
const RACKS = "records.schematic_stress_racks";

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

/**
 * A pixel of the canvas's own paint at a world point, read through its 2D context — sRGBA channels as the page painted
 * them, never a screenshot.
 */
function painted(root: Locator, x: number, y: number): Promise<number[]> {
    return root.evaluate((el, [wx, wy]) => {
        const host = el.querySelector<HTMLElement>("[data-schematic-canvas]")!;
        const paint = host.querySelector<HTMLCanvasElement>(":scope > canvas")!;
        const layer = host.querySelector<HTMLElement>("[style*='--cam-ppu']")!;
        const box = layer.getBoundingClientRect(), at = paint.getBoundingClientRect();
        const ppu = Number(layer.style.getPropertyValue("--cam-ppu"));
        const cx = box.left + parseFloat(layer.style.getPropertyValue("--cam-tx")) + wx * ppu;
        const cy = box.top + parseFloat(layer.style.getPropertyValue("--cam-ty")) + wy * ppu;
        const px = Math.floor(((cx - at.left) * paint.width) / at.width), py = Math.floor(((cy - at.top) * paint.height) / at.height);
        return [...paint.getContext("2d")!.getImageData(px, py, 1, 1).data];
    }, [x, y] as const);
}

/** A theme colour token as the page resolves it, as sRGBA channels: painted on a one-pixel canvas and read back, as the canvas's probe reads its palette. */
function token(root: Locator, name: string): Promise<number[]> {
    return root.evaluate((el, variable) => {
        const probe = document.createElement("span");
        probe.style.color = `var(${variable})`;
        el.appendChild(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        const pixel = document.createElement("canvas");
        pixel.width = 1;
        pixel.height = 1;
        const ink = pixel.getContext("2d", { willReadFrequently: true })!;
        ink.fillStyle = "#000000";
        ink.fillStyle = colour;
        ink.fillRect(0, 0, 1, 1);
        return [...ink.getImageData(0, 0, 1, 1).data];
    }, name);
}

/** A box of the canvas to read: a box of the drawing, or a box in screen px about a point of it. */
type PaintedBox =
    | { readonly world: WorldBox }
    | { readonly point: { readonly x: number; readonly y: number }; readonly px: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } };

/**
 * Every pixel of the canvas's own paint over a box, read through its 2D context — sRGBA channels as the page painted
 * them, never a screenshot.
 */
function paintedOver(root: Locator, over: PaintedBox): Promise<number[][]> {
    return root.evaluate((el, read) => {
        const host = el.querySelector<HTMLElement>("[data-schematic-canvas]")!;
        const paint = host.querySelector<HTMLCanvasElement>(":scope > canvas")!;
        const layer = host.querySelector<HTMLElement>("[style*='--cam-ppu']")!;
        const box = layer.getBoundingClientRect(), at = paint.getBoundingClientRect();
        const ppu = Number(layer.style.getPropertyValue("--cam-ppu"));
        const sx = (wx: number) => box.left + parseFloat(layer.style.getPropertyValue("--cam-tx")) + wx * ppu;
        const sy = (wy: number) => box.top + parseFloat(layer.style.getPropertyValue("--cam-ty")) + wy * ppu;
        const [left, top, right, bottom] = "world" in read
            ? [sx(read.world.minX), sy(read.world.minY), sx(read.world.maxX), sy(read.world.maxY)]
            : [sx(read.point.x) + read.px.left, sy(read.point.y) + read.px.top, sx(read.point.x) + read.px.right, sy(read.point.y) + read.px.bottom];
        const x0 = Math.floor(((left - at.left) * paint.width) / at.width), x1 = Math.floor(((right - at.left) * paint.width) / at.width);
        const y0 = Math.floor(((top - at.top) * paint.height) / at.height), y1 = Math.floor(((bottom - at.top) * paint.height) / at.height);
        const data = paint.getContext("2d")!.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        const pixels: number[][] = [];
        for (let i = 0; i < data.length; i += 4) pixels.push([data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]);
        return pixels;
    }, over);
}

/** How far a colour lies from every blend of two, in sRGB channels: 0 for either of them or any mix of the two. */
function offBlend(colour: readonly number[], a: readonly number[], b: readonly number[]): number {
    const step = [0, 1, 2].map((i) => b[i]! - a[i]!);
    const length = step.reduce((sum, d) => sum + d * d, 0);
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, [0, 1, 2].reduce((sum, i) => sum + (colour[i]! - a[i]!) * step[i]!, 0) / length));
    return Math.hypot(...[0, 1, 2].map((i) => colour[i]! - (a[i]! + t * step[i]!)));
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

test.describe("Reading by area (#1398)", () => {
    test.skip(({ isMobile }) => isMobile, "a desktop's canvas, whose pan brings in cells its window has not read");

    test("a pan into cells not read washes what the drawing does not cover — under the grid, the paint and the cards, moving with the camera as a card does — until the window lands (CL2)", async ({ page }) => {
        await installE3Faults(page);
        const root = await openSchematic(page, RECORD_INDEXES);
        await expect(notice(root)).toBeVisible();
        // Hall 1's front rows, its racks dots: a window of fewer racks than a window draws, read and drawn.
        await zoomInto(page, root, { minX: 3.0, minY: 3.0, maxX: 73.0, maxY: 52.0 });
        await expect(notice(root)).toHaveCount(0);
        const unread = root.locator("[data-schematic-unread]");
        await expect(unread).toHaveAttribute("data-schematic-unread", "0");
        // The racks' window reads held: a pan of most of the canvas's width brings in cells the window has not read — in
        // one move, so the window read is the one for where the view stops, however fast the machine. The canvas tells its
        // reader where its view stands as it moves, a viewport or less 200 ms on, and else as it rests: a drag of several
        // moves, each a while on a slow machine, is told partway, and its window planned for a view a move short.
        const hold = await holdE3(page, { kinds: ["find", "runs"], dataset: RACKS });
        const canvas = (await root.locator("[data-schematic-canvas]").boundingBox())!;
        const y = canvas.y + canvas.height / 2;
        await page.mouse.move(canvas.x + canvas.width * 0.85, y);
        await page.mouse.down();
        await page.mouse.move(canvas.x + canvas.width * 0.15, y);
        await page.mouse.up();
        await expect.poll(() => heldE3(page, hold), "the window's read, held").toBeGreaterThan(0);
        await expect.poll(async () => Number(await unread.getAttribute("data-schematic-unread")), "boxes washed").toBeGreaterThan(0);
        const wash = unread.locator("[data-loading-wash]").first();
        // Shown once the reveal's delay has passed, in the shared wash, edge to edge with no shape in it.
        await expect(wash).not.toHaveAttribute("data-unrevealed", "");
        const look = await root.evaluate((el) => {
            const host = el.querySelector("[data-schematic-canvas]")!;
            const layer = host.querySelector<HTMLElement>("[data-schematic-unread]")!;
            const box = layer.querySelector<HTMLElement>("[data-loading-wash]")!;
            const later = [host.querySelector(":scope > canvas"), host.querySelector("[data-schematic-cards]")];
            return {
                // The lowest layer: the grid, the paint and the cards come after it, and nothing raises it.
                under: later.every((other) => other !== null && (layer.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
                raised: getComputedStyle(layer).zIndex,
                pointer: getComputedStyle(layer).pointerEvents,
                clipped: getComputedStyle(layer).overflow,
                visible: getComputedStyle(box).visibility,
                painted: getComputedStyle(box).backgroundColor !== "rgba(0, 0, 0, 0)",
                shapes: box.childElementCount,
            };
        });
        expect(look).toEqual({ under: true, raised: "auto", pointer: "none", clipped: "hidden", visible: "visible", painted: true, shapes: 0 });
        // It moves with the camera, as a card does: a further pan of 50px left, inside the window's margin — an eighth of its
        // larger side — moves it 50px left, the window still read and no more of the view washed.
        const boxes = (await unread.getAttribute("data-schematic-unread"))!;
        const before = (await wash.boundingBox())!;
        await page.mouse.move(canvas.x + canvas.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(canvas.x + canvas.width / 2 - 50, y, { steps: 5 });
        await page.mouse.up();
        await expect.poll(async () => Math.round(((await wash.boundingBox())!.x - before.x) * 10) / 10, "the wash's move").toBe(-50);
        await expect(unread).toHaveAttribute("data-schematic-unread", boxes);
        // Released, the window lands, and nothing is washed.
        await releaseE3(page, hold);
        await settled(page);
        await expect(unread).toHaveAttribute("data-schematic-unread", "0");
    });
});

test.describe("What the canvas paints, read through its 2D context (#1395)", () => {
    test.skip(({ isMobile }) => isMobile, "a desktop's canvas, one CSS px a canvas pixel");

    for (const theme of ["light", "dark"] as const) {
        test(`fitted, Hall 1's racks paint a heat step of the theme's and its floor past its 20th row nothing, the ground showing through; zoomed into its front rows, each rack's dot paints its load's status in the theme's token — OK, hot, warm (${theme})`, async ({ page }) => {
            const root = await openSchematic(page, RECORD_INDEXES, theme);
            await expect(notice(root)).toBeVisible();
            // A cell amid Hall 1's racks, read at its centre — the cells lie on the floor's grid of their side, and where two
            // meet each paints a part of the pixel between them: one of the five heat steps, as the theme resolves them in
            // this mode.
            const side = Number(await notice(root).getAttribute("data-density-cell"));
            const centre = (at: number) => (Math.floor(at / side) + 0.5) * side;
            const heats = await Promise.all([1, 2, 3, 4, 5].map((step) => token(root, `--chakra-colors-heat-${step}`)));
            expect(heats.map((heat) => heat.join(",")), "the heat steps' rows").toContainEqual((await painted(root, centre(38.0), centre(26.0))).join(","));
            // Hall 1's floor behind its 20th row, which no rack stands on, outline or eyebrow near: nothing painted.
            expect((await painted(root, 38.0, 100.0))[3], "Hall 1's floor past its racks").toBe(0);
            // Its front rows, zoomed in until each rack's dot stands clear of its neighbours', 0.7 m either side, at its
            // centre — the racks still dots — each in its load's status: R100000 OK, R100003 hot at 11.1 kW, R100006 warm
            // at 10.2.
            await zoomInto(page, root, { minX: 3.0, minY: 3.0, maxX: 46.0, maxY: 33.0 });
            await expect(root.locator("[data-schematic-canvas]")).toHaveAttribute("data-lod", "dot");
            await expect.poll(() => painted(root, 3.3, 3.6), "R100000's dot, OK").toEqual(await token(root, "--chakra-colors-status-pos"));
            expect(await painted(root, 5.4, 3.6), "R100003's dot, hot").toEqual(await token(root, "--chakra-colors-status-neg"));
            expect(await painted(root, 7.5, 3.6), "R100006's dot, warm").toEqual(await token(root, "--chakra-colors-status-warn"));
        });

        test(`a hall chosen on the rail, fitted — 2,000 of the 20,000 racks, each a dot, packed a metre or two apart — paints its racks' status colours, the dots' paper never a block over them, and the hall's eyebrow over them, its words on their knockout (ruled 26 Oct 2026, "Legible dots", ${theme})`, async ({ page }) => {
            await page.setViewportSize({ width: 1440, height: 900 });
            const root = await openSchematic(page, RECORD_INDEXES, theme);
            const hall = await recordField(page, root, "hall", "racks");
            await hall.getByRole("button", { name: /^Hall 2/ }).first().click();
            await page.keyboard.press("Escape");
            await expect(page.getByRole("dialog")).toHaveCount(0);
            await settled(page);
            // Fewer racks in view than the density takes over at (5,000): each drawn as a dot, at Fit's zoom.
            await expect(notice(root)).toHaveCount(0);
            await expect(root.locator("[data-schematic-canvas]")).toHaveAttribute("data-lod", "dot");
            const [paper, ok, warm, hot, ground, ink] = await Promise.all(["--chakra-colors-bg-surface", "--chakra-colors-status-pos", "--chakra-colors-status-warn",
                "--chakra-colors-status-neg", "--chakra-colors-bg-canvas", "--chakra-colors-fg-muted"].map((name) => token(root, name)));
            const same = (a: readonly number[], b: readonly number[]) => a.every((channel, i) => channel === b[i]);
            // Hall 2's racks — rows of 100 racks 0.7 m apart, a row each 2.4 m, 79.3 to 148.6 m along and 3.6 to 49.2 m
            // down — read inside the box their dots' centres span: their status colours, OK, warm and hot, and the dots'
            // paper, which rings each dot, only between them, never merged into a block over them.
            const racks = await paintedOver(root, { world: { minX: 80.0, minY: 4.0, maxX: 148.0, maxY: 49.0 } });
            const share = (pick: (pixel: readonly number[]) => boolean) => racks.filter(pick).length / racks.length;
            expect(racks.length, "Hall 2's racks' pixels").toBeGreaterThan(5_000);
            expect(share((pixel) => same(pixel, paper!)), "the share in the dots' paper").toBeLessThan(0.05);
            expect(share((pixel) => [ok!, warm!, hot!].some((colour) => same(pixel, colour))), "the share in the racks' status colours").toBeGreaterThan(0.75);
            // Hall 2's eyebrow, over the racks of its front rows: inside its knockout, from just in from its top-left, its
            // ground and its words' ink alone — and the blends between them — never a dot's paper or a dot's colour.
            const eyebrow = await paintedOver(root, { point: { x: 78.0, y: 2.0 }, px: { left: 7, top: -6, right: 33, bottom: 4 } });
            const over = eyebrow.filter((pixel) => offBlend(pixel, ground!, ink!) > 3);
            expect(eyebrow.length, "the eyebrow's pixels").toBeGreaterThan(200);
            expect(over.length, `pixels of the eyebrow neither its ground nor its words: ${JSON.stringify(over.slice(0, 4))}`).toBe(0);
        });
    }
});
