/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * What the Schematic's gestures cost the main thread as its reads land, and
 * how long a read takes to land (#1393, SC30, SC42) — `E3_UI_PERF=1`, never in
 * CI: a timing on a shared runner is no deterministic signal. On the built
 * showcase and its in-page e3, the floor of `schematicRecordIndexes` as it is
 * seeded — 20,000 racks, each hall's first 20 rows — and filled to its 50,000
 * through the racks' and the loads' patch doors, as another session would
 * (ruled 23 Oct 2026):
 *
 * - wheeled about Hall 3's front rows, a notch every four frames — a notch of
 *   100, as a mouse's wheel gives one — from Fit to 40× and back, each stretch
 *   until the windows it asked for have landed;
 * - dragged along the halls' front rows at 1,500 px/s for 3 s, a move a frame,
 *   where some 2,000 racks in view draw as dots, and where they draw as cards
 *   — in a press of Zoom in at a time past the 40× the zoom stops at until the
 *   racks are drawn (`maxZoom`) — each to rest where it stops and the windows
 *   there landed;
 * - eight times each, at their p50 and p95: opened again, to its first paint at
 *   Fit, its density drawn; jumped by the minimap, at the cards' zoom, to
 *   another hall's front rows, until the window there has landed, its cards'
 *   details with it; and panned a canvas's width at that zoom into cells not
 *   read, until they have landed.
 *
 * Each stretch records what it cost the main thread (`main-thread-cost.ts`'
 * `costOf`) and the page's reads of its e3 meanwhile, by kind, and prints them
 * as JSON. Each wheel and each drag holds that no frame took longer than 50 ms
 * and the browser reported no long animation frame: a window's rows are made a
 * budget a read, a frame drawing between (`made-rows.ts`), and the frame draws
 * what the reader read in a task of its own.
 *
 * Run (from the showcase, over its build):
 * `E3_UI_PERF=1 pnpm exec playwright test schematic-perf --project desktop --workers 1`.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { East, PatchType, diffFor, encodeBeast2For } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic-records";
import { leaveBuilder } from "./builder-page";
import { e3Requests, installE3Faults, mutateE3 } from "./e3-faults";
import { costOf, type Cost } from "./main-thread-cost";
import { RECORD_INDEXES, openSchematic, screenPoint, zoomInto, type Point, type WorldBox } from "./schematic-page";
import { settled } from "./settle";

/** Whether the measurement runs: `E3_UI_PERF=1`, as the renderers' benchmarks are asked for. */
const PERF = process.env["E3_UI_PERF"] === "1";

/** A notch of the wheel, as a mouse gives one, and the frames between notches. */
const NOTCH = 100;
const FRAMES_A_NOTCH = 4;
/** The notches from Fit to 40×: the canvas zooms by e^(0.0015 × 100) a notch. */
const NOTCHES = Math.ceil(Math.log(40) / (0.0015 * NOTCH));

/** A drag's speed, px/s, and its length. */
const SPEED = 1_500;
const SECONDS = 3;

/** How many times each landing is timed, for its p50 and p95. */
const TIMES = 8;

/** The racks the record is seeded with, and the floor's whole (`schematic-records.examples.tsx`). */
const SEEDED = 20_000n;
const FLOOR = 50_000n;

/** The workspace of the Schematic's area in the page's e3: the area's own name. */
const WORKSPACE = "schematic";

/** The example's drawing, in metres: what the minimap draws, edge to edge. */
const EXTENT = { width: 382, height: 254 };

/** Hall 1's front rows: some 2,000 racks in view, at a zoom where they draw as dots. */
const HALL_1_FRONT: WorldBox = { minX: 3.0, minY: 3.0, maxX: 73.0, maxY: 52.0 };
/** Hall 1's front corner: zoomed into, then in a press at a time until its racks draw as cards. */
const HALL_1_CORNER: WorldBox = { minX: 3.0, minY: 3.0, maxX: 23.0, maxY: 15.0 };

/** The canvas's zoom: its camera's px a unit. */
function ppuOf(root: Locator): Promise<number> {
    return root.evaluate((el) => Number(el.querySelector<HTMLElement>("[data-schematic-canvas] [style*='--cam-ppu']")!.style.getPropertyValue("--cam-ppu")));
}

/** Wheels the canvas about a point, a notch of `delta` every {@link FRAMES_A_NOTCH} frames, `notches` times. */
function wheel(root: Locator, at: Point, delta: number, notches: number): Promise<void> {
    return root.evaluate(async (el, { at, delta, notches, every }) => {
        const canvas = el.querySelector<HTMLElement>("[data-schematic-canvas]")!;
        await new Promise<void>((resolve) => {
            let frame = 0, sent = 0;
            const tick = () => {
                if (frame++ % every === 0) {
                    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, deltaMode: 0, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }));
                    sent++;
                }
                if (sent < notches) requestAnimationFrame(tick);
                else resolve();
            };
            requestAnimationFrame(tick);
        });
    }, { at, delta, notches, every: FRAMES_A_NOTCH });
}

/**
 * Drags the canvas from a point by `dx` px across at `speed` px/s, a move a frame — pressed and let go on it, as a
 * viewer's drag over the floor is: a pan, the drawing following the pointer.
 */
function drag(root: Locator, from: Point, dx: number, speed: number): Promise<void> {
    return root.evaluate(async (el, { from, dx, speed }) => {
        const canvas = el.querySelector<HTMLElement>("[data-schematic-canvas]")!;
        const send = (type: string, x: number, buttons: number) => canvas.dispatchEvent(new PointerEvent(type, {
            pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons, clientX: x, clientY: from.y, bubbles: true, cancelable: true,
        }));
        send("pointerdown", from.x, 1);
        const seconds = Math.abs(dx) / speed;
        const start = performance.now();
        await new Promise<void>((resolve) => {
            const tick = (now: number) => {
                const t = Math.min(1, (now - start) / 1000 / seconds);
                send("pointermove", from.x + dx * t, 1);
                if (t < 1) requestAnimationFrame(tick);
                else resolve();
            };
            requestAnimationFrame(tick);
        });
        send("pointerup", from.x + dx, 0);
    }, { from, dx, speed });
}

/**
 * How long, in ms, a gesture's window takes to land: the gesture run in the page — a tap on the minimap at a world
 * point, which puts the view there at its zoom, or a drag of the canvas — then each frame until its racks draw as cards
 * in the canvas, every one with its details, nothing washed and main busy no more.
 */
function landing(root: Locator, gesture: { readonly jump: { readonly x: number; readonly y: number } } | { readonly pan: Point; readonly dx: number; readonly ms: number }): Promise<number> {
    return root.evaluate(async (el, { gesture, extent }) => {
        const canvas = el.querySelector<HTMLElement>("[data-schematic-canvas]")!;
        const main = el.querySelector<HTMLElement>("[data-frame-slot='main']")!;
        const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
        const press = (target: HTMLElement, type: string, x: number, y: number, buttons: number) => target.dispatchEvent(new PointerEvent(type, {
            pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons, clientX: x, clientY: y, bubbles: true, cancelable: true,
        }));
        if ("jump" in gesture) {
            const minimap = el.querySelector<HTMLElement>("[data-schematic-minimap]")!;
            const box = minimap.getBoundingClientRect();
            const x = box.left + (gesture.jump.x / extent.width) * box.width, y = box.top + (gesture.jump.y / extent.height) * box.height;
            press(minimap, "pointerdown", x, y, 1);
            press(minimap, "pointerup", x, y, 0);
        } else {
            press(canvas, "pointerdown", gesture.pan.x, gesture.pan.y, 1);
            const start = performance.now();
            for (let t = 0; t < 1;) {
                t = Math.min(1, ((await frame()) - start) / gesture.ms);
                press(canvas, "pointermove", gesture.pan.x + gesture.dx * t, gesture.pan.y, 1);
            }
            press(canvas, "pointerup", gesture.pan.x + gesture.dx, gesture.pan.y, 0);
        }
        const from = performance.now();
        const view = canvas.getBoundingClientRect();
        const drawn = () => {
            const cards = [...el.querySelectorAll<HTMLElement>("[data-card-key]")].filter((card) => {
                const r = card.getBoundingClientRect();
                return r.right > view.left && r.left < view.right && r.bottom > view.top && r.top < view.bottom;
            });
            return cards.length > 0 && el.querySelector("[data-card-key] [data-pending]") === null
                && el.querySelector("[data-schematic-unread]")?.getAttribute("data-schematic-unread") === "0"
                && main.getAttribute("aria-busy") === "false";
        };
        for (;;) {
            const now = await frame();
            if (drawn()) return Math.round(now - from);
            if (now - from > 60_000) throw new Error("the window did not land within 60 s");
        }
    }, { gesture, extent: EXTENT });
}

/** The page's reads of its e3 since a mark, by kind. */
async function readsSince(page: Page, mark: number): Promise<Record<string, number>> {
    const since = (await e3Requests(page)).slice(mark);
    const kinds: Record<string, number> = {};
    for (const request of since) kinds[request.kind] = (kinds[request.kind] ?? 0) + 1;
    return kinds;
}

/** A stretch's p50 and p95, nearest rank, and every time it took, in ms. */
function percentiles(times: readonly number[]): { p50: number; p95: number; times: readonly number[] } {
    const sorted = [...times].sort((a, b) => a - b);
    const rank = (q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]!;
    return { p50: rank(0.5), p95: rank(0.95), times };
}

/**
 * Fills the floor to its 50,000 racks as another session would: what the seed's 20,000 lack, made by the examples' own
 * generators, patched in through the racks' and the loads' patch doors.
 */
async function fillFloor(page: Page): Promise<void> {
    const racks = East.compile(ex.generateRacks, []);
    const loads = East.compile(ex.generateLoads, []);
    const racksType = ex.schematicStressRacks.type, loadsType = ex.schematicStressRackLoads.type;
    await mutateE3(page, WORKSPACE, ex.schematicStressRacks.name, ex.schematicStressRacksPatch.name,
        [encodeBeast2For(PatchType(racksType))(diffFor(racksType)(racks(SEEDED), racks(FLOOR)))]);
    await mutateE3(page, WORKSPACE, ex.schematicStressRackLoads.name, ex.schematicStressRackLoadsPatch.name,
        [encodeBeast2For(PatchType(loadsType))(diffFor(loadsType)(loads(SEEDED), loads(FLOOR)))]);
}

/** The density's words. */
const notice = (root: Locator) => root.locator("[data-schematic-footer] [data-schematic-density='racks']");

/** A button of the toolbar's, by its name. */
const toolbarButton = (root: Locator, name: string) => root.locator("[data-frame-slot='toolbar']").getByRole("button", { name, exact: true });

/** What a stretch cost, by its name, as the run prints it. */
type Results = Record<string, unknown>;

/**
 * Measures a stretch of work: what it cost the main thread and the page's reads of its e3 meanwhile, kept by its name.
 *
 * @returns What it cost
 */
async function measure(page: Page, results: Results, name: string, work: () => Promise<unknown>, extra: () => Promise<Record<string, unknown>> = async () => ({})): Promise<Cost> {
    const mark = (await e3Requests(page)).length;
    const cost = await costOf(page, work);
    results[name] = { ...(await extra()), reads: await readsSince(page, mark), ...cost };
    return cost;
}

/** Back at Fit, the window there landed. */
async function toFit(page: Page, root: Locator): Promise<void> {
    await toolbarButton(root, "Fit").click();
    await expect(toolbarButton(root, "Zoom out")).toBeDisabled();
    await settled(page);
}

/**
 * Zooms into a box of the drawing, then in a press of Zoom in at a time until its racks draw as cards: the zoom stops
 * at 40× until the racks there are drawn, and then at where the smallest draws as a whole card (`maxZoom`, #1393).
 */
async function toCards(page: Page, root: Locator, box: WorldBox): Promise<void> {
    await zoomInto(page, root, box);
    const zoomIn = toolbarButton(root, "Zoom in");
    for (let presses = 0; await root.locator("[data-card-key]").count() === 0; presses++) {
        expect(presses, "presses of Zoom in before the racks draw as cards").toBeLessThan(12);
        await zoomIn.click();
        await settled(page);
    }
}

/** The wheel from Fit to 40× about Hall 3's front rows and back, each stretch until its windows have landed. */
async function wheelInAndOut(page: Page, root: Locator, results: Results, floor: string): Promise<Cost[]> {
    const main = root.locator("[data-frame-slot='main']");
    await toFit(page, root);
    const fit = await ppuOf(root);
    const at = await screenPoint(root, 190, 26);
    const zoom = async () => ({ zoom: Math.round(((await ppuOf(root)) / fit) * 10) / 10 });
    const stretch = (name: string, delta: number) => measure(page, results, name, async () => {
        await wheel(root, at, delta, NOTCHES);
        await expect(main).toHaveAttribute("aria-busy", "false");
        await settled(page);
    }, zoom);
    const zoomIn = await stretch(`${floor}: wheel in, Fit to 40×, ${NOTCHES} notches`, -NOTCH);
    expect((await ppuOf(root)) / fit).toBeGreaterThanOrEqual(40);
    const zoomOut = await stretch(`${floor}: wheel out, 40× to Fit, ${NOTCHES} notches`, NOTCH);
    return [zoomIn, zoomOut];
}

/**
 * Drags along the halls' front rows — where some 2,000 racks in view draw as dots, and where they draw as cards — at
 * {@link SPEED} for {@link SECONDS}, each to rest where it stops and the windows there landed.
 */
async function dragAlong(page: Page, root: Locator, results: Results, floor: string): Promise<Cost[]> {
    const main = root.locator("[data-frame-slot='main']");
    const canvas = root.locator("[data-schematic-canvas]");
    const costs: Cost[] = [];
    for (const where of ["dots", "cards"] as const) {
        await toFit(page, root);
        if (where === "dots") {
            await zoomInto(page, root, HALL_1_FRONT);
            await expect(canvas).toHaveAttribute("data-lod", "dot");
        } else {
            await toCards(page, root, HALL_1_CORNER);
        }
        const at = await canvas.boundingBox();
        const from = { x: at!.x + at!.width * 0.9, y: at!.y + at!.height / 2 };
        const drawing = async () => ({
            lod: await canvas.getAttribute("data-lod"), ppu: Math.round((await ppuOf(root)) * 10) / 10, cards: await root.locator("[data-card-key]").count(),
        });
        costs.push(await measure(page, results, `${floor}: dragged along the front rows where they draw as ${where}, ${SPEED} px/s for ${SECONDS} s`, async () => {
            await drag(root, from, -SPEED * SECONDS, SPEED);
            await expect(main).toHaveAttribute("aria-busy", "false");
            await settled(page);
        }, drawing));
    }
    return costs;
}

/**
 * The landings, {@link TIMES} times each, at their p50 and p95: the Schematic opened again to its first paint at Fit;
 * jumped by the minimap at the cards' zoom to another hall's front rows; and panned a canvas's width at that zoom into
 * cells not read.
 */
async function landings(page: Page, root: Locator, results: Results, floor: string): Promise<void> {
    // Its first paint at Fit, each time it opens: from its hash to its density drawn and its frame out from its
    // skeleton — its own entry's, whatever else of the area's examples the page mounts beside it.
    const opens: number[] = [];
    for (let i = 0; i < TIMES; i++) {
        await leaveBuilder(page);
        opens.push(await page.evaluate(async (hash) => {
            const entry = `[data-index]:has(a[href="#${hash}"]) [data-schematic]`;
            const from = performance.now();
            location.hash = hash;
            for (;;) {
                const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
                const frame = document.querySelector(`${entry} [data-builder-frame]`);
                const density = document.querySelector(`${entry} [data-schematic-footer] [data-schematic-density='racks']`);
                if (frame?.getAttribute("aria-busy") === "false" && density !== null) return Math.round(now - from);
                if (now - from > 60_000) throw new Error("the Schematic did not paint its first view within 60 s");
            }
        }, RECORD_INDEXES));
        await settled(page);
    }
    results[`${floor}: first paint at Fit, from its hash`] = percentiles(opens);

    // At the cards' zoom, a jump by the minimap to another hall's front rows: each a window nothing has read.
    await toFit(page, root);
    await toCards(page, root, HALL_1_CORNER);
    const jumps: number[] = [];
    for (let i = 0; i < TIMES; i++) {
        const hall = (i + 1) % 10;
        jumps.push(await landing(root, { jump: { x: (hall % 5) * 76 + 20 + (i % 3) * 10, y: Math.floor(hall / 5) * 126 + 3.6 + (i % 4) * 9.6 } }));
        await settled(page);
    }
    results[`${floor}: a window at the cards' zoom, jumped to by the minimap`] = percentiles(jumps);

    // At that zoom, a pan of a canvas's width into cells not read: along the rows, then back.
    const box = (await root.locator("[data-schematic-canvas]").boundingBox())!;
    const pans: number[] = [];
    for (let i = 0; i < TIMES; i++) {
        const leftward = i < TIMES / 2;
        const from = { x: box.x + (leftward ? box.width * 0.95 : box.width * 0.05), y: box.y + box.height / 2 };
        pans.push(await landing(root, { pan: from, dx: (leftward ? -1 : 1) * box.width * 0.9, ms: 300 }));
        await settled(page);
    }
    results[`${floor}: a pan of a canvas's width at the cards' zoom into cells not read`] = percentiles(pans);
}

/** Holds a stretch to the budget: no frame over 50 ms, and no long animation frame. */
function withinBudget(costs: readonly Cost[], what: string): void {
    expect(costs.map((cost) => cost.over50), `frames over 50 ms, ${what}`).toEqual(costs.map(() => 0));
    expect(costs.map((cost) => cost.loaf.count), `long animation frames, ${what}`).toEqual(costs.map(() => 0));
}

test.describe("what the Schematic's gestures cost the main thread as its reads land (#1393; E3_UI_PERF=1, not a CI gate)", () => {
    test.skip(!PERF, "E3_UI_PERF=1 only: a timing on a shared runner is no CI gate");

    for (const floor of ["20,000", "50,000"] as const) {
        test(`the floor of ${floor} racks: its first paint at Fit, a window jumped to at its cards' zoom and a pan into cells not read, each at its p50 and p95; wheeled from Fit to 40× and back, and dragged along its front rows where they draw as dots and as cards, no frame over 50 ms and no long animation frame @desktop`, async ({ page }) => {
            test.setTimeout(1_200_000);
            await installE3Faults(page);
            await page.setViewportSize({ width: 1440, height: 1000 });
            const root = await openSchematic(page, RECORD_INDEXES);
            await expect(notice(root)).toHaveText("Density: 20,000 racks — zoom in to draw them");
            if (floor === "50,000") {
                await fillFloor(page);
                // The example reads its records again as their revisions move (`SHOWCASE_POLL_MS`): the floor's density, whole.
                await expect(notice(root)).toHaveText("Density: 50,000 racks — zoom in to draw them", { timeout: 60_000 });
                await settled(page);
            }
            const results: Results = {};
            await landings(page, root, results, floor);
            const wheels = await wheelInAndOut(page, root, results, floor);
            const drags = await dragAlong(page, root, results, floor);
            console.log(`Schematic at ${floor} ${JSON.stringify(results, null, 2)}`);
            test.info().annotations.push({ type: `Schematic at ${floor}`, description: JSON.stringify(results) });
            withinBudget(wheels, "wheeling in, and out");
            withinBudget(drags, "dragging where they draw as dots, and as cards");
        });
    }
});
