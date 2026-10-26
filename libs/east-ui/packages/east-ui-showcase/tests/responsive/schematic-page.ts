/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Schematic's showcase entries, for its specs (#1387–#1395): one opened
 * on the real in-page e3 at rest, its box sized and centred in the window, its
 * inspector collapsed to its rail, an item's card, a world point of its drawing
 * on the screen, the cards that overlap and those standing in a box, a box of
 * the drawing zoomed into, the box the canvas shows and its camera at rest on
 * one, its library's tabs and cards, a card picked up from it and carried onto the
 * canvas, with what the drag's ghost says, the history's Discard and Save — and
 * whether each of its buttons stays inside the toolbar and takes a click — an
 * item found by Find and picked, and the drawing's counts as the inspector says
 * them.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { editingMessages } from "@elaraai/east-ui-components/testing";
import { settled } from "./settle";

/** A point on the screen, in client px. */
export interface Point {
    readonly x: number;
    readonly y: number;
}

/** The Schematic's examples' module. */
export const FILE = "e3/schematic/schematic";
/** The data centre floor. */
export const DATA_CENTRE = `${FILE}/schematicDataCentre`;
/** The floor of shaped units. */
export const SHAPES = `${FILE}/schematicShapes`;
/** The hall handed over to its install crew: its racks edited, with no pane (#1395). */
export const HANDOVER = `${FILE}/schematicHandover`;
/** The floor of 20,000 racks read a window at a time (#1393). */
export const RECORD_INDEXES = "e3/schematic/schematic-records/schematicRecordIndexes";
/** The same floor in a phone-width frame, with its inspector (#1395). */
export const RECORD_INDEXES_MOBILE = "e3/schematic/schematic-records/schematicRecordIndexesMobile";

/**
 * Opens a Schematic example at rest — its frame out from under its skeleton, its canvas drawn.
 *
 * @param page - The page
 * @param hash - The example, by its module and name
 * @param theme - The theme
 * @returns Its root: the box its frame fills
 */
export async function openSchematic(page: Page, hash: string, theme: "light" | "dark" = "light"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${hash}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${hash}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const root = entry.locator("[data-schematic]").first();
    await expect(root.locator("[data-builder-frame]")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
    // Its paint layer: the minimap paints in a canvas of its own.
    await expect(root.locator("[data-schematic-canvas] > canvas")).toBeVisible();
    await settled(page);
    return root;
}

/**
 * Sizes the Schematic's box — its width, and its height when given — and waits for the page to be at rest.
 *
 * @param page - The page
 * @param root - The Schematic's root
 * @param width - Its box's width, in px
 * @param height - Its box's height, in px
 */
export async function sizeTo(page: Page, root: Locator, width: number, height?: number): Promise<void> {
    await root.evaluate((el, [w, h]) => {
        (el as HTMLElement).style.width = `${w}px`;
        if (h !== undefined) (el as HTMLElement).style.height = `${h}px`;
    }, [width, height] as const);
    await settled(page);
}

/**
 * Scrolls the Schematic to the window's middle and waits for the page to be at rest: a drag near the window's edge
 * scrolls the page under it.
 *
 * @param page - The page
 * @param root - The Schematic's root
 */
export async function centred(page: Page, root: Locator): Promise<void> {
    await root.evaluate((el) => { el.scrollIntoView({ block: "center" }); });
    await settled(page);
}

/**
 * Collapses the inspector to its rail, as a viewer does to give the canvas the room (#1391) — where it is open — and
 * scrolls the frame's start back into view: a box wider than the example's scrolls it sideways to the inspector's
 * control.
 *
 * @param page - The page
 * @param root - The Schematic's root
 */
export async function collapseInspector(page: Page, root: Locator): Promise<void> {
    const end = root.locator("[data-frame-slot='end']");
    if (await end.getAttribute("data-collapsed") === null) {
        await end.getByRole("button", { name: "Collapse Inspector" }).click();
        await expect(end).toHaveAttribute("data-collapsed", "");
    }
    await root.evaluate((el) => { el.scrollIntoView({ block: "center", inline: "start" }); });
    await settled(page);
}

/**
 * An entity's reference as East prints it — its kind's slot and its key: an item's id on the canvas, and a template's
 * card's key in the library.
 *
 * @param kind - The kind's slot
 * @param key - The key
 * @returns The printed reference
 */
export const printedRef = (kind: string, key: string): string => `(kind=${JSON.stringify(kind)}, key=${JSON.stringify(key)})`;

/**
 * An item's card, by its kind and key: its id on the canvas, its reference as East prints it.
 *
 * @param root - The Schematic's root
 * @param kind - The item's kind's slot
 * @param key - The item's key
 * @returns The card
 */
export function card(root: Locator, kind: string, key: string): Locator {
    return root.locator(`[data-card-key=${JSON.stringify(printedRef(kind, key))}]`);
}

/**
 * A world point of the drawing on the screen, through the camera the card layer holds (`--cam-ppu`, `--cam-tx`,
 * `--cam-ty`), as a card is placed.
 *
 * @param root - The Schematic's root
 * @param x - The point's x, in the drawing's units
 * @param y - The point's y, in the drawing's units
 * @returns The point, in client px
 */
export function screenPoint(root: Locator, x: number, y: number): Promise<Point> {
    return root.evaluate((el, [wx, wy]) => {
        const layer = el.querySelector<HTMLElement>("[data-schematic-canvas] [style*='--cam-ppu']")!;
        const box = layer.getBoundingClientRect();
        const ppu = Number(layer.style.getPropertyValue("--cam-ppu"));
        return {
            x: box.left + parseFloat(layer.style.getPropertyValue("--cam-tx")) + wx * ppu,
            y: box.top + parseFloat(layer.style.getPropertyValue("--cam-ty")) + wy * ppu,
        };
    }, [x, y] as const);
}

/**
 * Each two cards that overlap on the screen, by their keys: none while nothing is selected, the declutter keeping every
 * card clear of every other (#1393) — a selected one draws over its neighbours.
 *
 * @param root - The Schematic's root
 * @returns The pairs, each `key × key`
 */
export function cardOverlaps(root: Locator): Promise<string[]> {
    return root.evaluate((el) => {
        const cards = [...el.querySelectorAll<HTMLElement>("[data-card-key]")].map((card) => ({ key: card.getAttribute("data-card-key") ?? "", box: card.getBoundingClientRect() }));
        const out: string[] = [];
        for (const [i, a] of cards.entries()) {
            for (const b of cards.slice(i + 1)) {
                if (a.box.left < b.box.right - 0.5 && b.box.left < a.box.right - 0.5 && a.box.top < b.box.bottom - 0.5 && b.box.top < a.box.bottom - 0.5) out.push(`${a.key} × ${b.key}`);
            }
        }
        return out;
    });
}

/**
 * The cards whose centres stand in a box on the screen, by their keys: which items draw as cards there.
 *
 * @param root - The Schematic's root
 * @param box - The box, in client px
 * @returns The cards' keys
 */
export function cardsIn(root: Locator, box: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }): Promise<string[]> {
    return root.evaluate((el, b) => [...el.querySelectorAll<HTMLElement>("[data-card-key]")].flatMap((card) => {
        const r = card.getBoundingClientRect();
        const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
        return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom ? [card.getAttribute("data-card-key") ?? ""] : [];
    }), box);
}

/** A box of the drawing, in its units. */
export interface WorldBox {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
}

/**
 * The box of the drawing the canvas shows, as it tells its reader where its viewport rests: its camera — the card
 * layer's `--cam-ppu`, `--cam-tx` and `--cam-ty` — over its size.
 *
 * @param root - The Schematic's root
 * @returns The box, in the drawing's units
 */
export function viewOf(root: Locator): Promise<WorldBox> {
    return root.evaluate((el) => {
        const canvas = el.querySelector<HTMLElement>("[data-schematic-canvas]")!;
        const layer = canvas.querySelector<HTMLElement>("[style*='--cam-ppu']")!;
        const ppu = Number(layer.style.getPropertyValue("--cam-ppu"));
        const tx = parseFloat(layer.style.getPropertyValue("--cam-tx")), ty = parseFloat(layer.style.getPropertyValue("--cam-ty"));
        return { minX: -tx / ppu, minY: -ty / ppu, maxX: (canvas.clientWidth - tx) / ppu, maxY: (canvas.clientHeight - ty) / ppu };
    });
}

/**
 * Waits for the canvas's camera to rest with a box of the drawing in view: still across two frames, as a fly, which
 * moves it every frame until it lands, never is. The page at rest (`settled`) reads the rows and the document, never
 * the camera, so it can come to rest while a fly is still under way.
 *
 * @param root - The Schematic's root
 * @param box - The box, in the drawing's units
 */
export async function restsOn(root: Locator, box: WorldBox): Promise<void> {
    await expect.poll(() => root.evaluate(async (el, b) => {
        const canvas = el.querySelector<HTMLElement>("[data-schematic-canvas]")!;
        const layer = canvas.querySelector<HTMLElement>("[style*='--cam-ppu']")!;
        const camera = () => ["--cam-ppu", "--cam-tx", "--cam-ty"].map((name) => layer.style.getPropertyValue(name)).join(" ");
        const before = camera();
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        if (camera() !== before) return false;
        const ppu = Number(layer.style.getPropertyValue("--cam-ppu"));
        const tx = parseFloat(layer.style.getPropertyValue("--cam-tx")), ty = parseFloat(layer.style.getPropertyValue("--cam-ty"));
        return -tx / ppu <= b.minX && -ty / ppu <= b.minY && (canvas.clientWidth - tx) / ppu >= b.maxX && (canvas.clientHeight - ty) / ppu >= b.maxY;
    }, box), { message: "the camera rests with the box in view" }).toBe(true);
}

/**
 * Zooms the canvas into a box of the drawing as a viewer does: the pointer over the canvas, Ctrl held for the Zoom
 * tool, a drag from one corner of the box to the other, and the camera's flight to it let land.
 *
 * @param page - The page
 * @param root - The Schematic's root
 * @param box - The box, in the drawing's units
 */
export async function zoomInto(page: Page, root: Locator, box: WorldBox): Promise<void> {
    const canvas = root.locator("[data-schematic-canvas]");
    const from = await screenPoint(root, box.minX, box.minY);
    const to = await screenPoint(root, box.maxX, box.maxY);
    await page.mouse.move(from.x, from.y);
    await page.keyboard.down("Control");
    await expect(canvas).toHaveAttribute("data-tool", "zoom");
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    await expect(canvas).not.toHaveAttribute("data-tool", "zoom");
    await restsOn(root, box);
    await settled(page);
}

/** The library pane. */
export const pane = (root: Locator): Locator => root.locator("[data-frame-slot='start']");

/** A tab's accessible name: its name, and its count after it. */
export const named = (name: string): RegExp => new RegExp(`^${name}( |$)`);

/**
 * Opens a tab of the library: from its row, or — folded — from its `+n` menu, which puts it on the row; the menu gone
 * before the tab is read, so none of it lies over the tab's first rows.
 *
 * @param page - The page
 * @param root - The Schematic's root
 * @param name - The tab's name
 */
export async function openTab(page: Page, root: Locator, name: string): Promise<void> {
    const tab = pane(root).getByRole("tab", { name: named(name) });
    if (await tab.count() > 0) await tab.click();
    else {
        await pane(root).locator("[data-dock-more]").click();
        await page.getByRole("menuitem", { name: named(name) }).click();
        await expect(page.getByRole("menu")).toHaveCount(0);
    }
    await expect(pane(root).getByRole("tab", { name: named(name) })).toHaveAttribute("aria-selected", "true");
    await settled(page);
}

/**
 * A card of the library's open tab, by its key: a template's is its reference ({@link printedRef}), a backlog row's
 * its item's, an author's its row's key.
 *
 * @param root - The Schematic's root
 * @param key - The card's key
 * @returns The card
 */
export function libraryCard(root: Locator, key: string): Locator {
    return pane(root).locator(`[role='tabpanel']:not([hidden]) [data-library-item=${JSON.stringify(key)}]`);
}

/**
 * Presses a library card and carries it past the drag threshold — the drag is in flight.
 *
 * @param page - The page
 * @param from - The card
 */
export async function pickUp(page: Page, from: Locator): Promise<void> {
    // Hovering brings the card into view and waits for a stable hit target: an earlier drop or tab can scroll it.
    await from.hover();
    const box = await from.boundingBox();
    if (box === null) throw new Error("the card is not laid out");
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 12, at.y + 12, { steps: 3 });
    await expect(from).toHaveAttribute("data-dragging", "");
}

/**
 * Carries the picked-up card to a point of the canvas — once main holds it, no pane and nothing of the page over it —
 * and lets it rest there.
 *
 * @param page - The page
 * @param root - The Schematic's root
 * @param at - The point
 * @param steps - The moves the mouse makes on its way
 */
export async function carryTo(page: Page, root: Locator, at: Point, steps = 8): Promise<void> {
    await expect.poll(() => root.evaluate((el, p) => el.querySelector("[data-frame-slot='main']")!.contains(document.elementFromPoint(p.x, p.y)), at),
        `main holds (${Math.round(at.x)}, ${Math.round(at.y)})`).toBe(true);
    await page.mouse.move(at.x, at.y, { steps });
}

/**
 * What the drag's ghost says, and whether it says why not.
 *
 * @param page - The page
 * @returns Its caption, or `null` while no ghost carries one
 */
export function captionOf(page: Page): Promise<{ text: string; refused: boolean } | null> {
    return page.evaluate(() => {
        const el = document.querySelector(".east-drag-ghost [data-drag-caption]");
        return el === null ? null : { text: el.textContent ?? "", refused: el.hasAttribute("data-refused") };
    });
}

/**
 * The history's Discard, which drops the changes waiting on Save: on while any wait (#1388). The footer says nothing of
 * them (ruled 23 Oct 2026).
 *
 * @param root - The Schematic's root
 * @returns The button
 */
export function discard(root: Locator): Locator {
    return root.locator("[data-frame-slot='toolbar']").getByRole("button", { name: editingMessages.discard(), exact: true });
}

/**
 * The history's Save.
 *
 * @param root - The Schematic's root
 * @returns The button
 */
export function save(root: Locator): Locator {
    return root.locator("[data-frame-slot='toolbar']").getByRole("button", { name: editingMessages.apply(), exact: true });
}

/**
 * What is wrong with the history's reach (#1404): each of Undo, Redo, Discard and Save not wholly inside the toolbar's
 * band, or not the element a click at its centre lands on — the page scrolled to bring it into the window first, as a
 * box wider than the window leaves the row's end past its edge; the row clips what lies past its own.
 *
 * @param root - The Schematic's root: one that edits, its history in the row
 * @returns Each fault, in words; none while every button is inside and takes its click
 */
export function historyFaults(root: Locator): Promise<string[]> {
    const names = [editingMessages.undo(), editingMessages.redo(), editingMessages.discard(), editingMessages.apply()];
    return root.evaluate((el, wanted) => {
        const buttons = [...el.querySelectorAll<HTMLElement>("[data-frame-slot='toolbar'] [data-toolbar-item='history'] button")];
        return wanted.flatMap((name) => {
            const button = buttons.find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === name);
            if (button === undefined) return [`${name}: not in the row`];
            button.scrollIntoView({ block: "nearest", inline: "nearest" });
            const band = el.querySelector("[data-frame-slot='toolbar']")!.getBoundingClientRect();
            const b = button.getBoundingClientRect();
            const faults: string[] = [];
            if (b.left < band.left - 0.5 || b.right > band.right + 0.5 || b.top < band.top - 0.5 || b.bottom > band.bottom + 0.5) {
                faults.push(`${name}: ${b.left.toFixed(1)}–${b.right.toFixed(1)}, past the toolbar's ${band.left.toFixed(1)}–${band.right.toFixed(1)}`);
            }
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            if (hit === null || !button.contains(hit)) faults.push(`${name}: a click at its centre lands on ${hit === null ? "nothing" : hit.tagName.toLowerCase()}`);
            return faults;
        });
    }, names);
}

/**
 * Finds an item by Find and picks it, as a viewer does: its box typed into — in the row, or, where the row folds it into
 * the View, in the View's popover, closed again once the pick lands — and its line picked from the list; the rack it
 * lands on selected once the canvas draws it.
 *
 * @param page - The page
 * @param root - The Schematic's root
 * @param query - What is typed
 * @param line - The line picked, as the list words it (`A01 · Rack`)
 * @param touch - Whether the pointer is a finger: taps, not clicks
 */
export async function findAndPick(page: Page, root: Locator, query: string, line: string, touch = false): Promise<void> {
    const press = (target: Locator) => (touch ? target.tap() : target.click());
    const inRow = root.locator("[data-toolbar-item='seek'] [data-part='dataset-key-search'] input");
    const view = root.locator("[data-toolbar-item='seek'] [data-key-search='icon']");
    const folded = await inRow.count() === 0;
    if (folded) await press(view);
    const box = folded ? page.locator("[data-key-search='popover'] input") : inRow;
    await press(box);
    await box.fill(query);
    await press(page.getByRole("option", { name: line, exact: true }));
    await expect(box).toHaveValue(line.split(" · ")[0]!);
    if (folded) {
        await page.keyboard.press("Escape");
        await expect(view).toHaveAttribute("data-state", "closed");
    }
    // Selected once it draws: the steps join the row (in the View, where the row folds it there).
    await expect.poll(() => root.locator("[data-frame-slot='toolbar'] [data-toolbar]").getAttribute("data-toolbar-state"), { message: `${line} selected` })
        .toMatch(/(^|;)step=/u);
    await settled(page);
}

/**
 * The drawing's counts, as the inspector's Details says them with nothing selected (#1391): the Select tool held, which
 * ends a Connect's session, Esc over the canvas's corner, which clears the selection, and the inspector opened from its
 * rail.
 *
 * @param page - The page
 * @param root - The Schematic's root
 * @returns Each count as Details prints it, by what it counts — an item kind's slot, `zones`, `links` or `nets`
 */
export async function drawingCounts(page: Page, root: Locator): Promise<Record<string, string>> {
    const canvas = root.locator("[data-schematic-canvas]");
    await root.locator("[data-frame-slot='toolbar']").getByRole("radio", { name: "Select" }).click();
    await expect(canvas).toHaveAttribute("data-tool", "select");
    await canvas.hover({ position: { x: 4, y: 4 } });
    await page.keyboard.press("Escape");
    const end = root.locator("[data-frame-slot='end']");
    if (await end.getAttribute("data-collapsed") !== null) {
        await end.getByRole("button", { name: "Expand Inspector" }).click();
        await expect(end).not.toHaveAttribute("data-collapsed", "");
    }
    const counts = end.locator("[data-schematic-inspector='drawing'] [data-inspector-counts] [data-count]");
    await expect(counts.first()).toBeVisible();
    await settled(page);
    return Object.fromEntries(await counts.evaluateAll((els) => els.map((el) => [el.getAttribute("data-count") ?? "", el.children[0]?.textContent ?? ""])));
}
