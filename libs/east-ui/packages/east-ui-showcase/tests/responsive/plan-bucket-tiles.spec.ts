/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The task tiles on a Plan's buckets rows (#1735), measured in the page at
 * 100%:
 *
 * - the grid — each day's rule its last pixel, a lane 24 of room and a rule
 *   under the day rules, a row 25 a lane — over `planTaskTiles`, its frame
 *   sized so a day is the spec's 132px;
 * - the slots — one tile takes its day, two halves, three or four quarters,
 *   five or more three tiles and a `+n` in the last quarter: tile `i` of `k`
 *   at `2 + i·B/k`, `B/k − 5` wide, 20 tall, 2 inside every rule;
 * - what a tile holds — its parts from 6 in, its state's border standing in
 *   that, whole or dropped from the end: a half holds a check but not a check
 *   and `2h 30m`, a quarter a check but not `10m`; its name says its label
 *   all the same; the label mono 11/600 tabular, its glyph box a whole 4px
 *   under the tile's top edge (#1638), its digits 6 | 8 | 6 — and, on
 *   planTargetState's tiles, either side of every turn;
 * - the gutter's lines in the lanes' rooms, each name's words a whole 6px
 *   under its lane's top, on the rows its lane's tiles' digits stand on;
 * - each state's look, resolved from the tokens;
 * - the floor: narrower days draw fewer tiles and a `+n` (#1267), the slots
 *   following the frame frame by frame, never painting slots they do not rest
 *   on; a `+n`'s pick; a day with no room for a tile drawing its lone tile as
 *   a mark across it, several as their `+n` alone (#1276, #1710);
 * - `planTaskTiles`' library: a task card dropped on a crew's day is a
 *   proposed task there, a draft Save commits;
 * - and, under a touch pointer, the `+n`'s tap target: its 44px halo held to
 *   its cell, less the tiles in it (#1267).
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { centre, libraryOf, openCards, pickUp } from "./plan-builder-page";
import { PLAN_EXAMPLES, openExample, planBox, rowId, rowSel, sizeBuckets } from "./plan-page";
import { cutText } from "./plan-text";
import { settled } from "./settle";

/** The tiles' examples file. */
const TILES = "e3/plan/plan-tiles";

/** The days `planTaskTiles` shows: Monday to Friday. */
const DAYS = 5;

/** The weeks planTargetState shows: W27 to W38. */
const WEEKS = 12;

/** planTargetState's Van 1, a row on a desktop and a card on a phone. */
const VAN1 = rowId("vans", "van1");

/** Van 1's Aug 24 cell, which holds two tiles: a ✓ (a7) and a resting proposal (a8). */
const VAN1_CELL = `:is([data-plan-row=${JSON.stringify(VAN1)}], [data-plan-card=${JSON.stringify(VAN1)}]) [data-plan-cell]:has([data-event='a7'])`;

/** A tile or a chip in its cell: where it stands, in px from the cell's corner, and what it draws. */
interface Placed {
    readonly key: string;
    readonly left: number;
    readonly width: number;
    readonly top: number;
    readonly height: number;
}

/** A buckets row as it draws: its height, its rules, and each cell with what stands in it, by its key. */
interface RowRead {
    readonly height: number;
    /** Each day rule's pixel column, from the plot's left. */
    readonly dayRules: readonly number[];
    /** Each lane rule's pixel row, from the plot's top. */
    readonly laneRules: readonly number[];
    /** Each cell, by `data-plan-cell`: its box in the plot, and its tiles and chip in it. */
    readonly cells: Readonly<Record<string, { readonly left: number; readonly width: number; readonly top: number; readonly height: number; readonly placed: readonly Placed[] }>>;
}

/** Reads a crew's row of `planTaskTiles` ({@link RowRead}). */
function readRow(entry: Locator, crew: string): Promise<RowRead> {
    return entry.locator(rowSel("crews", crew)).evaluate((row) => {
        const plot = row.querySelector("[data-plan-plot]")!;
        const p = plot.getBoundingClientRect();
        const grid = plot.querySelector("[data-plan-gridsep] svg")!;
        const g = grid.getBoundingClientRect();
        const columns = (grid.querySelector("[data-plan-day-rules]")?.getAttribute("d") ?? "").matchAll(/M([\d.]+) /g);
        const rows = (grid.querySelector("[data-plan-lane-rules]")?.getAttribute("d") ?? "").matchAll(/M0 ([\d.]+)H/g);
        const cells: Record<string, { left: number; width: number; top: number; height: number; placed: Placed[] }> = {};
        for (const cell of row.querySelectorAll<HTMLElement>("[data-plan-cell]")) {
            const c = cell.getBoundingClientRect();
            const placed = [...cell.querySelectorAll<HTMLElement>(":scope > [data-plan-cell-tiles] > :is([data-event]:not([data-folded]), [data-tile-more])")].map((el) => {
                const r = el.getBoundingClientRect();
                return { key: el.hasAttribute("data-tile-more") ? (el.textContent ?? "") : el.getAttribute("data-event")!, left: r.left - c.left, width: r.width, top: r.top - c.top, height: r.height };
            });
            cells[cell.getAttribute("data-plan-cell")!] = { left: c.left - p.left, width: c.width, top: c.top - p.top, height: c.height, placed };
        }
        return {
            height: row.getBoundingClientRect().height,
            dayRules: [...columns].map((m) => Number(m[1]) - 0.5 + g.left - p.left),
            laneRules: [...rows].map((m) => Number(m[1]) - 0.5 + g.top - p.top),
            cells,
        };
    });
}

/** What a tile draws: its parts in sight, in order — its check, an icon, its label — and how they stand in it. */
interface TileRead {
    /** Its parts in sight, in order: `check`, `icon`, or its label's words. */
    readonly parts: readonly string[];
    /** Each part in sight: where it starts from the tile's left, and its width. */
    readonly at: readonly (readonly [number, number])[];
    /** Its icon's box, across and down, where it draws one. */
    readonly icon: readonly [number, number] | undefined;
    /** Its first part's left from the tile's, and its content box's: its used border and its padding. */
    readonly first: number | undefined;
    readonly content: number;
    /** Its padding and the border its state says it draws, in CSS px: 6 together. */
    readonly padding: number;
    readonly edge: number;
    /** How far its last part in sight stands from its right edge, and its content box's right inset. */
    readonly clear: number | undefined;
    readonly contentRight: number;
    /** Its accessible name. */
    readonly name: string;
    /**
     * Its label's words, when its label is in sight: how far under the tile's top edge their glyph box starts (#1638),
     * and their digits' ink — above it, its height, and below it to the tile's bottom edge — read from the glyph box's
     * top and the face's own metrics.
     */
    readonly band: { readonly words: number; readonly above: number; readonly cap: number; readonly below: number } | undefined;
    /** Its label's face. */
    readonly face: string | undefined;
    /** Its look: fill, rings, border, ink, slant, line, and its check's ink. */
    readonly look: {
        readonly fill: string; readonly rings: string; readonly border: string; readonly ink: string;
        readonly slant: string; readonly line: string; readonly check: string | undefined;
    };
}

/** Reads a tile of `planTaskTiles` by its task's key ({@link TileRead}). */
function readTile(entry: Locator, key: string): Promise<TileRead> {
    return entry.locator(`[data-event="${key}"]`).evaluate((tile) => {
        const r = tile.getBoundingClientRect();
        const s = getComputedStyle(tile);
        const px = (v: string) => Number.parseFloat(v);
        const inSight = [...tile.children].filter((part) => {
            const b = part.getBoundingClientRect();
            return b.width > 0 && b.top >= r.top - 0.01 && b.bottom <= r.bottom + 0.01;
        });
        const words = (part: Element) => (part.hasAttribute("data-plan-done") || part.querySelector("[data-plan-done]") !== null ? "check"
            : part.hasAttribute("data-plan-label") ? (part.textContent ?? "") : "icon");
        const label = inSight.find((part) => part.hasAttribute("data-plan-label"));
        const ls = label === undefined ? undefined : getComputedStyle(label);
        // Its words' glyph box, as box-rows.spec reads it, and its digits' ink, from the face's metrics: the baseline its
        // ascent under the glyph box's top, the ink its text's ascent over that.
        const text = label === undefined ? null : document.createTreeWalker(label, NodeFilter.SHOW_TEXT).nextNode();
        const range = document.createRange();
        if (text !== null) range.selectNodeContents(text);
        const glyph = text === null ? undefined : range.getClientRects()[0];
        const metrics = document.createElement("canvas").getContext("2d")!;
        if (ls !== undefined) metrics.font = `${ls.fontStyle} ${ls.fontWeight} ${ls.fontSize} ${ls.fontFamily}`;
        const m = metrics.measureText(text?.textContent ?? "");
        const baseline = glyph === undefined ? 0 : glyph.top + m.fontBoundingBoxAscent;
        const check = tile.querySelector("[data-plan-done]");
        const icon = tile.querySelector(":scope > svg")?.getBoundingClientRect();
        return {
            parts: inSight.map(words),
            at: inSight.map((part) => { const b = part.getBoundingClientRect(); return [Math.round((b.left - r.left) * 100) / 100, Math.round(b.width * 100) / 100] as const; }),
            icon: icon === undefined ? undefined : [icon.width, icon.height] as const,
            first: inSight[0] === undefined ? undefined : inSight[0].getBoundingClientRect().left - r.left,
            content: px(s.borderLeftWidth) + px(s.paddingLeft),
            padding: px(s.paddingLeft),
            edge: px(s.getPropertyValue("--state-edge") || "0"),
            clear: inSight.at(-1) === undefined ? undefined : r.right - inSight.at(-1)!.getBoundingClientRect().right,
            contentRight: px(s.borderRightWidth) + px(s.paddingRight),
            name: tile.getAttribute("aria-label") ?? "",
            band: glyph === undefined ? undefined : {
                words: glyph.top - r.top,
                above: baseline - m.actualBoundingBoxAscent - r.top,
                cap: m.actualBoundingBoxAscent,
                below: r.bottom - baseline,
            },
            face: ls === undefined ? undefined : `${/mono/i.test(ls.fontFamily) ? "mono" : ls.fontFamily} ${ls.fontSize} ${ls.fontWeight} ${ls.fontVariantNumeric}`,
            look: {
                // A border of no width is none, whatever style the page's reset gives every element.
                fill: s.backgroundColor, rings: s.boxShadow, border: px(s.borderTopWidth) === 0 ? "none" : `${s.borderTopStyle} ${s.borderTopColor}`, ink: s.color,
                slant: s.fontStyle, line: s.textDecorationLine, check: check === null ? undefined : getComputedStyle(check).color,
            },
        };
    });
}

/** A token's colour as the page resolves it. */
function token(page: Page, name: string): Promise<string> {
    return page.evaluate((n) => {
        const probe = document.createElement("div");
        probe.style.color = `var(${n})`;
        document.body.appendChild(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
    }, name);
}

/** Where tile `i` of `k` stands in a day of `pitch`, as the spec places it: `B/k` rounded, 2 in, 5 between. */
const slot = (pitch: number, k: number, i: number) => ({ left: 2 + i * Math.round(pitch / k), width: Math.round(pitch / k) - 5 });

/**
 * planTargetState's weeks at 7px each, too narrow for a tile: a gutter of 400 beside their 84 keeps the canvas its rows,
 * over the 480 of main it draws its cards under.
 */
async function noRoom(page: Page, entry: Locator): Promise<void> {
    await page.addStyleTag({ content: "[data-plan-body] { --plan-gutter-w: 400px !important; }" });
    await sizeBuckets(page, entry, 7, WEEKS);
}

/** One frame of a cell as it painted: its room, and what it showed. */
interface CellPainted { room: number; sig: string }

/** What the cell paint checks keep in the page ({@link startCellPaint}). */
interface CellPaintWindow {
    __cellPainted: CellPainted[];
    __cellPaintStop: () => void;
}

/**
 * Samples what a cell paints, until {@link stopCellPaint}: every frame as it paints — when a strip's resize is
 * delivered, the strip a pixel wider or narrower each frame and observed after the canvas's own observer, so read once
 * the canvas has answered the frame's width and after every animation-frame callback, a pick's among them. Each sample
 * is the cell's room and what it shows: its tiles in sight, by key, then `|` and its chip's words.
 */
async function startCellPaint(cell: Locator): Promise<void> {
    await cell.evaluate((el) => {
        const w = window as unknown as CellPaintWindow;
        const box = el.querySelector("[data-plan-cell-tiles]")!;
        const sig = () => {
            const tiles = [...box.querySelectorAll(":scope > [data-event]")].filter((t) => getComputedStyle(t).display !== "none");
            const chip = box.querySelector(":scope > [data-tile-more]");
            return `${tiles.map((t) => t.getAttribute("data-event")).join(" ")}|${chip?.textContent ?? ""}`;
        };
        const strip = document.body.appendChild(document.createElement("div"));
        strip.style.cssText = "position: fixed; left: 0; top: 0; width: 1px; height: 0; pointer-events: none;";
        w.__cellPainted = [];
        const observer = new ResizeObserver(() => {
            w.__cellPainted.push({ room: Math.round(box.getBoundingClientRect().width * 100) / 100, sig: sig() });
        });
        observer.observe(strip);
        let frame = requestAnimationFrame(function tick() {
            strip.style.width = strip.style.width === "1px" ? "2px" : "1px";
            frame = requestAnimationFrame(tick);
        });
        w.__cellPaintStop = () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            strip.remove();
        };
    });
}

/** Stops {@link startCellPaint}, returning what it sampled. */
async function stopCellPaint(cell: Locator): Promise<CellPainted[]> {
    return cell.evaluate(() => {
        const w = window as unknown as CellPaintWindow;
        w.__cellPaintStop();
        return w.__cellPainted;
    });
}

/** A day with no room for a tile as it draws: the tiles that show; the mark a lone one draws as, by its key, whether it
 *  spans the cell and lies inside it; and its chip's words, its name, whether its count is in sight, spans the cell and
 *  lies inside it. */
const noRoomDrawn = (cell: Element) => {
    const c = cell.getBoundingClientRect();
    const spans = (r: DOMRect) => Math.abs(r.left - c.left) <= 0.5 && Math.abs(r.right - c.right) <= 0.5;
    const inside = (r: DOMRect) => r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5;
    const mark = cell.querySelector("[data-plan-cell-tiles][data-no-room] > [data-event]");
    const chip = cell.querySelector("[data-tile-more]");
    // Its count's words: in sight on its line, or wrapped off it.
    const count = chip?.querySelector("[data-tile-more-count] > [data-plan-label]")?.getBoundingClientRect();
    const m = chip?.getBoundingClientRect();
    return {
        shown: [...cell.querySelectorAll("[data-event]")].filter((t) => getComputedStyle(t).display !== "none").map((t) => t.getAttribute("data-event")),
        mark: mark === null ? null : { key: mark.getAttribute("data-event"), spans: spans(mark.getBoundingClientRect()), inside: inside(mark.getBoundingClientRect()) },
        chip: chip === null || m === undefined ? null : {
            words: chip.textContent,
            label: chip.getAttribute("aria-label"),
            count: count !== undefined && count.top >= m.top - 0.5 && count.bottom <= m.bottom + 0.5 && count.right <= m.right + 0.5,
            spans: spans(m),
            inside: inside(m),
        },
    };
};

/**
 * Where a tap near a cell's `+n` chip lands that it should not, under a touch
 * pointer (#1267) — each a line saying where, empty when none does. The chip's
 * target is its halo, 44px across and down, held to its cell, less the tiles
 * in it: a tap at each of that area's corners, 1px in, the middle of each of
 * its edges and its middle lands on the chip, or on the tile there. A tap on
 * every tile its row or card shows — its middle, 1px inside each end — lands
 * on that tile. Evaluated on the chip, or on a lone tile a day with no room
 * draws as a mark across itself, whose halo is the chip's (#1710); `onTile`
 * counts the area's taps that a tile took.
 */
const tapFaults = (chip: Element): { bad: string[]; onTile: number } => {
    const bad: string[] = [];
    const cell = chip.closest("[data-plan-cell]")!;
    cell.scrollIntoView({ block: "center", inline: "center" });
    const holder = chip.closest("[data-plan-row], [data-plan-card]")!;
    const tiles = [...holder.querySelectorAll("[data-event]:not([data-ctx])")].filter((t) => getComputedStyle(t).display !== "none");
    const named = (el: Element | null) => {
        if (el === null) return "nothing";
        if (chip.contains(el)) return "the chip";
        const tile = el.closest("[data-event]");
        return tile !== null ? `tile ${tile.getAttribute("data-event")}`
            : `${el.tagName.toLowerCase()}${[...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `[${a.name}]`).join("")}`;
    };
    const tileAt = (x: number, y: number) => tiles.find((t) => {
        const r = t.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    const c = cell.getBoundingClientRect();
    const m = chip.getBoundingClientRect();
    const [cx, cy] = [(m.left + m.right) / 2, (m.top + m.bottom) / 2];
    const [left, right] = [Math.max(c.left, cx - 22) + 1, Math.min(c.right, cx + 22) - 1];
    const [top, bottom] = [Math.max(c.top, cy - 22) + 1, Math.min(c.bottom, cy + 22) - 1];
    let onTile = 0;
    for (const x of [left, (left + right) / 2, right]) {
        for (const y of [top, (top + bottom) / 2, bottom]) {
            const hit = document.elementFromPoint(x, y);
            const tile = tileAt(x, y);
            if (tile !== undefined) onTile += 1;
            const want = tile ?? chip;
            if (hit === null || !want.contains(hit)) bad.push(`a tap at (${(x - c.left).toFixed(1)}, ${(y - c.top).toFixed(1)}) in the cell lands on ${named(hit)}, not ${named(want)}`);
        }
    }
    for (const tile of tiles) {
        const r = tile.getBoundingClientRect();
        for (const [x, where] of [[r.left + 1, "start"], [(r.left + r.right) / 2, "middle"], [r.right - 1, "end"]] as const) {
            const hit = document.elementFromPoint(x, (r.top + r.bottom) / 2);
            if (hit === null || !tile.contains(hit)) bad.push(`a tap at tile ${tile.getAttribute("data-event")}'s ${where} lands on ${named(hit)}`);
        }
    }
    return { bad, onTile };
};

test.describe("Plan bucket tiles (#1735) @desktop", () => {
    test("at 132px a day: the day's rule its last pixel, a lane 24 and a rule, a row 25 a lane; one tile takes its day, two halves, three or four quarters, five or more three and a +n — each 20 tall, 2 inside every rule", async ({ page }) => {
        const entry = await openExample(page, "planTaskTiles", TILES);
        await sizeBuckets(page, entry, 132, DAYS);
        const a = await readRow(entry, "crew-a");
        const b = await readRow(entry, "crew-b");
        const c = await readRow(entry, "crew-c");
        // The grid: each day's rule its last pixel, the last day's the plot's edge; the lanes 24 and a rule.
        for (const row of [a, b, c]) expect(row.dayRules).toEqual([131, 263, 395, 527]);
        expect([a.height, b.height, c.height]).toEqual([25, 50, 75]);
        expect([a.laneRules, b.laneRules, c.laneRules]).toEqual([[], [24], [24, 49]]);
        // A cell is its day's room in its lane's: 131 across from the day's start, 24 down from its lane's top.
        for (const row of [a, b, c]) {
            for (const [key, cell] of Object.entries(row.cells)) {
                const [day, lane] = key.split(":").map(Number) as [number, number];
                expect({ key, left: cell.left, width: cell.width, top: cell.top, height: cell.height })
                    .toEqual({ key, left: 132 * day, width: 131, top: 25 * lane, height: 24 });
            }
        }
        // Crew A's week: a day of one, two, three, four and six.
        const at = (k: number, i: number, key: string) => ({ key, ...slot(132, k, i), top: 2, height: 20 });
        expect(a.cells["0:0"]!.placed).toEqual([at(1, 0, "a1")]);
        expect(a.cells["1:0"]!.placed).toEqual([at(2, 0, "b1"), at(2, 1, "b2")]);
        expect(a.cells["2:0"]!.placed).toEqual([at(4, 0, "c1"), at(4, 1, "c2"), at(4, 2, "c3")]);
        expect(a.cells["3:0"]!.placed).toEqual([at(4, 0, "d1"), at(4, 1, "d2"), at(4, 2, "d3"), at(4, 3, "d4")]);
        expect(a.cells["4:0"]!.placed).toEqual([at(4, 0, "e1"), at(4, 1, "e2"), at(4, 2, "e3"), at(4, 3, "+3")]);
        // The spec's widths at 132: 127, 61, 28.
        expect([slot(132, 1, 0).width, slot(132, 2, 0).width, slot(132, 4, 0).width]).toEqual([127, 61, 28]);
        // In their lanes: two in Crew B's Tuesday morning, five in its Thursday afternoon; Crew C's Friday's late four.
        expect(b.cells["1:0"]!.placed).toEqual([at(2, 0, "t1"), at(2, 1, "t2")]);
        expect(b.cells["3:1"]!.placed).toEqual([at(4, 0, "h2"), at(4, 1, "h3"), at(4, 2, "h4"), at(4, 3, "+2")]);
        expect(c.cells["4:2"]!.placed).toEqual([at(4, 0, "s6"), at(4, 1, "s7"), at(4, 2, "s8"), at(4, 3, "s9")]);
    });

    test("what a tile holds at a day, a half and a quarter: its parts from 6 in, its state's border standing in that, whole or dropped from the end; its name says its label all the same; its label mono 11/600 tabular, its glyph box a whole 4px under the tile's top, its digits 6 | 8 | 6", async ({ page }) => {
        const entry = await openExample(page, "planTaskTiles", TILES);
        await sizeBuckets(page, entry, 132, DAYS);
        const tiles = Object.fromEntries(await Promise.all(["a1", "b1", "b2", "c1", "c2", "c3", "d1", "d3", "e1"].map(async (key) => [key, await readTile(entry, key)] as const)));
        // A day holds the check and its label; a half the check, not the check and `2h 30m` (6 + 10 + 4 + 42 + 6 past
        // 61, the mono face 7 a glyph at 11px); a quarter a check but not `10m` (6 + 21 + 6 past 28), nor `20m` alone,
        // but `5m`.
        expect(Object.fromEntries(Object.entries(tiles).map(([key, tile]) => [key, tile.parts]))).toEqual({
            a1: ["check", "10m"], b1: ["check"], b2: ["45m"], c1: ["check"], c2: [], c3: ["5m"], d1: ["1h"], d3: ["3h"], e1: ["check"],
        });
        // The icon 10 across and down; its label 4 after it: at 6, then 20.
        expect(tiles.a1!.icon).toEqual([10, 10]);
        expect(tiles.a1!.at.map(([left]) => left)).toEqual([6, 20]);
        for (const [key, tile] of Object.entries(tiles)) {
            // 6 in, the border its state draws standing in it (a proposal's 1.5 and 4.5), and its first part at its content's edge.
            expect(tile.padding + tile.edge, `${key}: its padding and its state's border`).toBe(6);
            if (tile.first !== undefined) expect(tile.first, `${key}: its first part`).toBeCloseTo(tile.content, 2);
            // Nothing in sight past its content's right edge: 6 clear, its border in it.
            if (tile.clear !== undefined) expect(tile.clear, `${key}: what its last part leaves`).toBeGreaterThanOrEqual(tile.contentRight - 0.01);
            // Its words a whole number of pixels under its top edge, whatever border its state draws (#1638): 4.
            if (tile.band !== undefined) expect(Math.round(tile.band.words * 64) / 64, `${key}: its words' glyph box under its top edge`).toBe(4);
        }
        // Its name says its label, in sight or not.
        expect(tiles.b1!.name).toContain("2h 30m");
        expect(tiles.c2!.name).toContain("20m");
        // The label: mono 11/600 tabular, its 13px glyph box a pixel low in the tile's even room — 4 under its top edge —
        // so its digits' eight rows stand 6 | 8 | 6, as the spec centres them.
        const band = tiles.a1!.band!;
        expect(tiles.a1!.face).toBe("mono 11px 600 tabular-nums");
        expect([band.words, band.above, band.cap, band.below].map((v) => Math.round(v * 100) / 100)).toEqual([4, 6, 8, 6]);
    });

    test("the gutter's lines stand in their lanes: a one-lane row's name, and a laned row's every line in its lane's room — the rooms its cells stand in — each name's glyph box a whole 6px under its lane's top, its digits on the rows its lane's tiles' stand on (#1638, #1735)", async ({ page }) => {
        const entry = await openExample(page, "planTaskTiles", TILES);
        await sizeBuckets(page, entry, 132, DAYS);
        const read = (crew: string) => entry.locator(rowSel("crews", crew)).evaluate((row) => {
            const top = row.getBoundingClientRect().top;
            const at = (el: Element) => Math.round((el.getBoundingClientRect().top - top) * 64) / 64;
            const glyph = (el: Element) => {
                const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
                if (text === null) return undefined;
                const range = document.createRange();
                range.selectNodeContents(text);
                const box = range.getClientRects()[0];
                return box === undefined ? undefined : Math.round((box.top - top) * 64) / 64;
            };
            return {
                // Each lane line's box: its top and height in the row.
                lines: [...row.querySelectorAll("[data-plan-gutter='name'], [data-plan-gutter='lane']")].map((line) => [at(line), line.getBoundingClientRect().height]),
                name: glyph(row.querySelector("[data-plan-gutter='label']")!),
                // A tile's words in the row's first lane, for the rows its digits stand on.
                tile: glyph(row.querySelector("[data-plan-cell$=':0'] [data-plan-label]")!),
            };
        });
        // Crew A, one lane: its name's line in the row, its words 6 under the row's top.
        const a = await read("crew-a");
        expect(a.name).toBe(6);
        // Crew B and Crew C: a line a lane, each the lane's room — 24, a rule's pixel between — its name on the first.
        const b = await read("crew-b");
        expect(b.lines).toEqual([[0, 24], [25, 24]]);
        expect(b.name).toBe(6);
        const c = await read("crew-c");
        expect(c.lines).toEqual([[0, 24], [25, 24], [50, 24]]);
        expect(c.name).toBe(6);
        // A tile's words stand 2 + 4 under its lane's top, as the name's 6: their digits on the same rows.
        for (const row of [a, b, c]) expect(row.tile).toBe(row.name);
    });

    test("each state's look from the tokens: done the third paper in the strong rule, its check in the positive; in progress the committed fill; confirmed the paper in the brand's rule; a proposal and a removal the tint, dashed in the brand, the pressed ink, upright; an estimate dashed in the strong rule, the fourth ink, upright; a rejection as it was", async ({ page }) => {
        const entry = await openExample(page, "planTaskTiles", TILES);
        await sizeBuckets(page, entry, 132, DAYS);
        const T = {
            paper: await token(page, "--chakra-colors-bg-surface"),
            paper3: await token(page, "--chakra-colors-bg-subtle"),
            strong: await token(page, "--chakra-colors-border-strong"),
            ink: await token(page, "--chakra-colors-fg"),
            ink4: await token(page, "--chakra-colors-fg-subtle"),
            brand: await token(page, "--chakra-colors-brand-solid"),
            pressed: await token(page, "--chakra-colors-brand-pressed"),
            tint: await token(page, "--chakra-colors-brand-tint"),
            committed: await token(page, "--chakra-colors-brand-emphasized"),
            pos: await token(page, "--chakra-colors-status-pos"),
        };
        const none = "rgba(0, 0, 0, 0)";
        const look = async (key: string) => (await readTile(entry, key)).look;
        expect(await look("a1")).toEqual({ fill: T.paper3, rings: `${T.strong} 0px 0px 0px 1px inset`, border: "none", ink: T.ink, slant: "normal", line: "none", check: T.pos });
        expect(await look("c2")).toMatchObject({ fill: T.committed, rings: "none", ink: T.paper });
        expect(await look("c3")).toMatchObject({ fill: T.paper, rings: `${T.brand} 0px 0px 0px 1px inset`, slant: "normal" });
        for (const key of ["b2", "d1", "d2"]) {
            expect(await look(key), key).toMatchObject({ fill: T.tint, rings: "none", border: `dashed ${T.brand}`, ink: T.pressed, slant: "normal", line: "none" });
        }
        expect(await look("d3")).toMatchObject({ fill: none, border: `dashed ${T.strong}`, ink: T.ink4, slant: "normal", line: "none" });
        expect(await look("d4")).toMatchObject({ fill: none, border: `dashed ${T.strong}`, ink: T.ink4, line: "line-through" });
    });

    test("the floor: at 60px a day, three or more tasks take halves — one tile and a +n; at 40px, two or more a +n alone in the day, a lone task its tile across it", async ({ page }) => {
        const entry = await openExample(page, "planTaskTiles", TILES);
        // Five days of 40 are 200 of plot: a gutter of 320 beside them keeps the canvas its rows, over the 480 of main
        // it draws its cards under.
        await page.addStyleTag({ content: "[data-plan-body] { --plan-gutter-w: 320px !important; }" });
        await sizeBuckets(page, entry, 60, DAYS);
        const at = (pitch: number, k: number, i: number, key: string) => ({ key, ...slot(pitch, k, i), top: 2, height: 20 });
        let a = await readRow(entry, "crew-a");
        expect(a.cells["1:0"]!.placed).toEqual([at(60, 2, 0, "b1"), at(60, 2, 1, "b2")]);
        expect(a.cells["2:0"]!.placed).toEqual([at(60, 2, 0, "c1"), at(60, 2, 1, "+2")]);
        expect(a.cells["4:0"]!.placed).toEqual([at(60, 2, 0, "e1"), at(60, 2, 1, "+5")]);
        await sizeBuckets(page, entry, 40, DAYS);
        a = await readRow(entry, "crew-a");
        expect(a.cells["0:0"]!.placed).toEqual([at(40, 1, 0, "a1")]);
        expect(a.cells["1:0"]!.placed).toEqual([at(40, 1, 0, "+2")]);
        expect(a.cells["4:0"]!.placed).toEqual([at(40, 1, 0, "+6")]);
    });

    /**
     * planTargetState's tiles either side of where their parts turn: a tile's parts stand from its left, 6 in — the
     * border its state draws standing in that — each whole or not drawn, dropped from the end where the tile has no room
     * for it: a resting proposal's grip and its `plan`, the regional van's truck. Each width is 2px clear of a turn,
     * read from the parts' own widths — an icon 10 across, a label its glyphs, 4 between them. The MIXED tile, whose map
     * centres its content, draws its label centred, whole or none all the same.
     */
    const TILE_TURNS: readonly { key: string; parts: readonly ("icon" | "label")[]; centred: boolean }[] = [
        { key: "a5", parts: ["icon", "label"], centred: false },
        { key: "m5", parts: ["icon"], centred: false },
        { key: "m4", parts: ["label"], centred: true },
    ];

    for (const { key, parts, centred } of TILE_TURNS) {
        test(`planTargetState: tile ${key} draws its parts whole or not at all, dropped from the end, either side of every turn`, async ({ page }) => {
            const entry = await openExample(page, "planTargetState");
            const tile = entry.locator(`[data-plan-row] [data-event=${JSON.stringify(key)}]:not([data-ctx])`);
            await expect(tile).toHaveCount(1);
            // What stands round its parts — its padding and border, either side — and each part's width, as drawn.
            const measured = await tile.evaluate((el) => {
                const cs = getComputedStyle(el);
                const px = (v: string) => Number.parseFloat(v);
                return {
                    around: px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth),
                    widths: [...el.children].map((part) => part.getBoundingClientRect().width),
                };
            });
            expect(measured.widths).toHaveLength(parts.length);
            for (let j = 0; j < parts.length; j++) {
                const turn = measured.around + measured.widths.slice(0, j + 1).reduce((sum, w) => sum + w, 0) + 4 * j;
                for (const [width, shown] of [[turn - 2, parts.slice(0, j)], [turn + 2, parts.slice(0, j + 1)]] as const) {
                    await test.step(`${width.toFixed(1)}px`, async () => {
                        await tile.evaluate((el, w) => {
                            el.style.setProperty("width", `${w}px`, "important");
                            // Its cell as wide, so nothing it draws is clipped there.
                            el.closest<HTMLElement>("[data-plan-cell]")!.style.setProperty("width", `${w + 4}px`, "important");
                        }, width);
                        const drawn = () => tile.evaluate((el) => {
                            const r = el.getBoundingClientRect();
                            const cs = getComputedStyle(el);
                            const px = (v: string) => Number.parseFloat(v);
                            const left = r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
                            const right = r.right - px(cs.borderRightWidth) - px(cs.paddingRight);
                            const inSight = [...el.children].filter((part) => {
                                const b = part.getBoundingClientRect();
                                return b.width > 0 && b.top >= r.top - 0.01 && b.bottom <= r.bottom + 0.01;
                            });
                            const boxes = inSight.map((part) => part.getBoundingClientRect());
                            const from = Math.min(...boxes.map((b) => b.left));
                            const to = Math.max(...boxes.map((b) => b.right));
                            const placed = boxes.length === 0 ? "" : Math.abs(from - left) <= 0.5 ? "left"
                                : Math.abs((from + to) / 2 - (r.left + r.right) / 2) <= 0.5 ? "centre" : `at ${(from - left).toFixed(1)}`;
                            return {
                                parts: inSight.map((part) => (part.hasAttribute("data-plan-label") ? "label" : "icon")),
                                placed,
                                inside: boxes.every((b) => b.left >= left - 0.5 && b.right <= right + 0.5),
                            };
                        });
                        await expect.poll(drawn).toEqual({ parts: shown, placed: shown.length === 0 ? "" : centred ? "centre" : "left", inside: true });
                        await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
                    });
                }
            }
        });
    }

    /** A slot narrower than a tile's padding (#1276) — a phone's day may leave a tile a few pixels: its padding gives
     *  way, down to its rings, so the tile — a ✓ (a0) or a proposal in its 1.5px dashed ring (a2) — keeps its slot's
     *  width and stays in its cell. */
    for (const key of ["a0", "a2"] as const) {
        test(`planTargetState: tile ${key} in a slot narrower than its padding keeps the slot's width, inside its cell (#1276)`, async ({ page }) => {
            const entry = await openExample(page, "planTargetState");
            const tile = entry.locator(`[data-plan-row] [data-event=${JSON.stringify(key)}]:not([data-ctx])`);
            for (const width of [12, 4]) await test.step(`${width}px`, async () => {
                await tile.evaluate((el, w) => {
                    el.style.setProperty("width", `${w}px`, "important");
                    el.style.setProperty("--plan-slot-w", `${w}px`);
                }, width);
                const held = () => tile.evaluate((el) => {
                    const t = el.getBoundingClientRect();
                    const c = el.closest("[data-plan-cell]")!.getBoundingClientRect();
                    return { width: Math.round(t.width * 10) / 10, inside: t.left >= c.left - 0.5 && t.right <= c.right + 0.5 };
                });
                await expect.poll(held).toEqual({ width, inside: true });
                await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
            });
        });
    }

    test("planTargetState: Van 1's Aug 24 cell takes its slots from its week's pitch — halves from 49, its +2 alone in the one slot under it — each tile in its slot, whole", async ({ page }) => {
        const entry = await openExample(page, "planTargetState", PLAN_EXAMPLES);
        const cell = entry.locator(VAN1_CELL);
        const drawn = () => cell.evaluate((el) => {
            const c = el.getBoundingClientRect();
            return [...el.querySelectorAll(":scope > [data-plan-cell-tiles] > :is([data-event]:not([data-folded]), [data-tile-more])")].map((t) => {
                const r = t.getBoundingClientRect();
                return [t.getAttribute("data-event") ?? t.textContent, Math.round((r.left - c.left) * 10) / 10, Math.round(r.width * 10) / 10];
            });
        });
        // Halves of 30 at 60 a week; at 49, round(24.5) is 25, a tile 20 — the floor; at 48 a half's tile is 19, under it.
        for (const [pitch, want] of [
            [60, [["a7", 2, 25], ["a8", 32, 25]]],
            [49, [["a7", 2, 20], ["a8", 27, 20]]],
            [48, [["+2", 2, 43]]],
            [30, [["+2", 2, 25]]],
        ] as const) {
            await test.step(`${pitch}px a week`, async () => {
                await sizeBuckets(page, entry, pitch, WEEKS);
                await expect.poll(drawn).toEqual(want);
                await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
            });
        }
    });

    test("planTargetState: Van 1's Aug 24 cell never paints slots it does not rest on — its frame narrowed a pixel at a time across the turn at 49 a week, then widened back, each frame draws what its week's pitch rests on", async ({ page }) => {
        const entry = await openExample(page, "planTargetState", PLAN_EXAMPLES);
        await sizeBuckets(page, entry, 52, WEEKS);
        const cell = entry.locator(VAN1_CELL);
        // Its pitch is its room and its rule: halves from 49, the +2 alone under it.
        const rests = (room: number) => (room + 1 >= 49 ? "a7 a8|" : "|+2");
        await startCellPaint(cell);
        await planBox(entry).evaluate(async (box: HTMLElement) => {
            const frames = (n: number) => new Promise<void>((resolve) => {
                const step = (k: number) => { if (k === 0) resolve(); else requestAnimationFrame(() => step(k - 1)); };
                step(n);
            });
            // Twelve weeks: a pixel of the frame is a twelfth of a week's pitch, so seventy pixels take it from 52 under 47.
            const start = box.getBoundingClientRect().width;
            for (const width of [...Array.from({ length: 70 }, (_x, i) => start - i), ...Array.from({ length: 70 }, (_x, i) => start - 69 + i)]) {
                box.style.width = `${width}px`;
                await frames(3);
            }
        });
        const painted = await stopCellPaint(cell);
        expect(painted.length, "the frames sampled").toBeGreaterThan(300);
        // The sweep crossed the turn.
        expect(new Set(painted.map((p) => p.sig)), "the slots the sweep drew").toEqual(new Set(["a7 a8|", "|+2"]));
        expect([...new Set(painted.filter((p) => p.sig !== rests(p.room)).map((p) => `at ${p.room}px: painted "${p.sig}", resting on "${rests(p.room)}"`))]).toEqual([]);
    });

    test("planTargetState: Van 1's Aug 24 cell's +2, named for what it holds and where, lists its tiles by their names; a pick does what the tile's click does — Van 1 selected — and no frame paints the tile alone: the cell folds it again, its chip taking the focus", async ({ page }) => {
        const entry = await openExample(page, "planTargetState", PLAN_EXAMPLES);
        await sizeBuckets(page, entry, 30, WEEKS);
        const cell = entry.locator(VAN1_CELL);
        const chip = cell.locator("[data-tile-more]");
        await expect(chip).toHaveText("+2");
        // Its two events, neither drawn: two events, none more than another (#1680's review).
        await expect(chip).toHaveAttribute("aria-label", "2 events, Week of Aug 24, 2026");
        await chip.click();
        const items = page.locator("[data-tile-more-menu]").getByRole("menuitem");
        await expect(items).toHaveText(["Event, Week of Aug 24, 2026, confirmed", "Event, Week of Aug 24, 2026, recommended"]);
        await startCellPaint(cell);
        await items.first().click();
        await expect(entry.locator(rowSel("vans", "van1"))).toHaveAttribute("data-selected", "");
        await expect(chip).toBeFocused();
        await settled(page);
        // One fold painted throughout — the chip alone in the week's one slot — and never the tile alone.
        expect([...new Set((await stopCellPaint(cell)).map((p) => p.sig))]).toEqual(["|+2"]);
    });

    test("planTargetState: a week with no room for a tile draws its lone tile as a mark across its room, never a +1, a click on it doing what the tile's does — Van 1 selected; several tiles, their +2 alone across it, its count out of sight, its name saying it (#1276, #1710)", async ({ page }) => {
        const entry = await openExample(page, "planTargetState", PLAN_EXAMPLES);
        await noRoom(page, entry);
        const cell = entry.locator("[data-plan-row] [data-plan-cell]:has([data-event='a0'])");
        await expect.poll(() => cell.evaluate(noRoomDrawn)).toEqual({ shown: ["a0"], mark: { key: "a0", spans: true, inside: true }, chip: null });
        await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
        await expect.poll(() => entry.locator(VAN1_CELL).evaluate(noRoomDrawn)).toEqual({
            shown: [], mark: null,
            chip: { words: "+2", label: "2 events, Week of Aug 24, 2026", count: false, spans: true, inside: true },
        });
        await cell.locator("[data-event='a0']").click();
        await expect(entry.locator(rowSel("vans", "van1"))).toHaveAttribute("data-selected", "");
        // Selected, the tile is still its day's mark.
        await expect.poll(() => cell.evaluate(noRoomDrawn)).toMatchObject({ shown: ["a0"], chip: null });
    });

    test("planTargetState: a lane's day with no room for a tile draws its lone tile as a mark across the lane's room, never a +1; a click on it opens the tile's popover, hung from the mark, and it stays open", async ({ page }) => {
        const entry = await openExample(page, "planTargetState", PLAN_EXAMPLES);
        await noRoom(page, entry);
        const cell = entry.locator("[data-plan-row] [data-plan-cell]:has([data-event='m5'])");
        await expect.poll(() => cell.evaluate(noRoomDrawn)).toEqual({ shown: ["m5"], mark: { key: "m5", spans: true, inside: true }, chip: null });
        const mark = cell.locator("[data-event='m5']");
        await mark.click();
        const pop = page.locator('[data-plan-overlay="popover"]');
        await expect(pop).toHaveText("Load 41 · 8 pallets");
        // Over the mark, which it hangs from, and still open once the page is at rest.
        await settled(page);
        await expect(pop).toBeVisible();
        const read = async () => {
            const [p, m] = [await pop.boundingBox(), await mark.boundingBox()];
            return p !== null && m !== null && p.y + p.height <= m.y + 0.5 && p.x <= m.x + m.width && p.x + p.width >= m.x;
        };
        await expect.poll(read).toBe(true);
    });

    test("planTaskTiles' library: a task card dragged onto Crew A's Monday is a proposed task there, saying its length, the day's two tiles taking halves — a draft, which Save commits to the crews' record", async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        const entry = await openExample(page, "planTaskTiles", TILES);
        const frame = entry.locator("[data-builder-frame]").first();
        const pane = libraryOf(entry);
        if (await pane.getAttribute("data-collapsed") !== null) await frame.getByRole("button", { name: "Expand Library" }).click();
        await expect(pane).not.toHaveAttribute("data-collapsed", "");
        await settled(page);
        // Monday holds one task, a1; the Inspection card makes one saying 1h.
        const monday = entry.locator(`${rowSel("crews", "crew-a")} [data-plan-cell="0:0"]`);
        const tiles = monday.locator(":scope > [data-plan-cell-tiles] > [data-event]");
        await expect(tiles).toHaveCount(1);
        const card = openCards(pane).filter({ hasText: "Inspection" });
        await expect(card).toHaveCount(1);
        const target = await centre(monday);
        await pickUp(page, card);
        await page.mouse.move(target.x, target.y, { steps: 8 });
        await page.mouse.up();
        const made = monday.locator(":scope > [data-plan-cell-tiles] > [data-event]:not([data-event='a1'])");
        await expect(made).toHaveCount(1);
        await expect(made).toHaveAttribute("data-state", "prop");
        await expect(made.locator("[data-plan-label]")).toHaveText("1h");
        // The draft is the crew's: its row, which holds its tasks, is drafted.
        const crew = entry.locator(rowSel("crews", "crew-a"));
        await expect(crew).toHaveAttribute("data-draft", "");
        await expect(entry.locator('[data-plan-count="pending"]')).toHaveText("1 pending");
        // Two tiles: halves of the day, side by side, each as wide.
        const widths = await tiles.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width * 100) / 100));
        expect(widths).toHaveLength(2);
        expect(widths[0]).toBe(widths[1]);
        // Save commits it: the crew no longer drafted, the task still Monday's.
        await frame.getByRole("button", { name: "Save", exact: true }).click();
        await expect(entry.locator('[data-plan-count="pending"]')).toHaveText("0 pending");
        await expect(crew).not.toHaveAttribute("data-draft");
        await expect(made).toHaveCount(1);
        await expect(made.locator("[data-plan-label]")).toHaveText("1h");
    });
});

/**
 * A cell's `+n` under a touch pointer (#1267): its tap target is its 44px
 * halo, held to its cell, less the tiles in it — so a tile beside it, or in
 * another cell, keeps its own taps. On the phone planTargetState's Van 1 card
 * holds its Aug 24 week's tiles in a `+2` in the week's one slot, its target the
 * whole cell; on a touch screen 1280px wide, planTaskTiles' Wednesday at 60 a
 * day draws a ✓ beside `+2`, the halo reaching over the ✓, which keeps its taps.
 * A lone tile a day with no room draws as a mark across itself takes the
 * chip's halo (#1710).
 */
test.describe("Plan bucket tiles' +n on touch (#1267) @mobile", () => {

    test("planTargetState at the phone's width: Van 1's Aug 24 cell is a +2 in its week's one slot, a tile tall; a tap anywhere in the cell lands on it, every tile of the card keeps its own; a tap opens its menu, and a pick does what the tile's tap does", async ({ page }) => {
        const entry = await openExample(page, "planTargetState", PLAN_EXAMPLES);
        // The narrow layout's Rows tab holds Van 1's card: its first rows drawn, a "more rows" button for the rest.
        await entry.locator("[data-plan-narrow] [data-plan-tab='rows']").tap();
        await settled(page);
        const card = entry.locator(`[data-plan-card=${JSON.stringify(VAN1)}]`);
        const more = entry.getByRole("button", { name: /^\d+ more rows?$/ });
        for (let i = 0; i < 10 && await card.count() === 0 && await more.count() > 0; i++) {
            await more.first().tap();
            await settled(page);
        }
        const cell = entry.locator(VAN1_CELL);
        const chip = cell.locator("[data-tile-more]");
        await expect(chip).toHaveText("+2");
        // A tile's height: the halo makes the target, never the chip's own box.
        expect(await chip.evaluate((el) => Math.abs(el.getBoundingClientRect().height - Number.parseFloat(getComputedStyle(el).getPropertyValue("--plan-tile-h"))) <= 0.5)).toBe(true);
        await expect.poll(() => chip.evaluate(tapFaults)).toEqual({ bad: [], onTile: 0 });
        await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
        await chip.tap();
        const items = page.locator("[data-tile-more-menu]").getByRole("menuitem");
        await expect(items).toHaveText(["Event, Week of Aug 24, 2026, confirmed", "Event, Week of Aug 24, 2026, recommended"]);
        await items.first().tap();
        await expect(entry.locator(`[data-plan-card=${JSON.stringify(VAN1)}]`)).toHaveAttribute("data-selected", "");
        await expect(chip).toBeFocused();
    });

    test("planTaskTiles on a touch screen 1280px wide: Wednesday at 60 a day draws its ✓ beside +2, whose halo reaches over the ✓ — a tap there lands on the ✓, one beside it on the chip", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const entry = await openExample(page, "planTaskTiles", TILES);
        await sizeBuckets(page, entry, 60, DAYS);
        const cell = entry.locator(`${rowSel("crews", "crew-a")} [data-plan-cell="2:0"]`);
        await expect(cell.locator("[data-tile-more]")).toHaveText("+2");
        await expect(cell.locator("[data-event='c1']")).not.toHaveAttribute("data-folded", "");
        const read = await cell.locator("[data-tile-more]").evaluate(tapFaults);
        expect(read.bad).toEqual([]);
        expect(read.onTile, "the halo's taps on the ✓").toBeGreaterThan(0);
    });

    test("planTargetState on a touch screen 1920px wide: a week with no room for a tile draws its lone tile as a mark, its 44px halo held inside the cell — a tap anywhere in it lands on the mark, one just outside it never does, and every tile of the row keeps its own (#1276, #1710)", async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 900 });
        const entry = await openExample(page, "planTargetState", PLAN_EXAMPLES);
        await noRoom(page, entry);
        const cellOf = "[data-plan-row] [data-plan-cell]:has([data-event='a0'])";
        const mark = entry.locator(`${cellOf} [data-plan-cell-tiles][data-no-room] > [data-event='a0']`);
        await expect(mark).toHaveCount(1);
        await expect(entry.locator(`${cellOf} [data-tile-more]`)).toHaveCount(0);
        // The taps on the mark's own box are on a tile; those above and below it, on its halo.
        await expect.poll(() => mark.evaluate(tapFaults)).toMatchObject({ bad: [] });
        const outside = () => mark.evaluate((el) => {
            const c = el.closest("[data-plan-cell]")!.getBoundingClientRect();
            const [mx, my] = [(c.left + c.right) / 2, (c.top + c.bottom) / 2];
            return ([[c.left - 2, my, "left"], [c.right + 2, my, "right"], [mx, c.top - 2, "above"], [mx, c.bottom + 2, "below"]] as const)
                .flatMap(([x, y, side]) => { const hit = document.elementFromPoint(x, y); return hit !== null && el.contains(hit) ? [`a tap 2px ${side} the cell lands on the mark`] : []; });
        });
        expect(await outside()).toEqual([]);
    });
});
