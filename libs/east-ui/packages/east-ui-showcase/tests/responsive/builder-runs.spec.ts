/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The unloaded run (#1398, CL2) in the Sheet and the Plan, on the real in-page
 * e3, the reads of the rows scrolled to held through the showcase's e3 fault
 * hook (`e3-faults.ts`), in both themes:
 *
 * - Scrolled into rows not read, the run's rows lie in the view — from the
 *   first the view meets under the pinned head to the view's foot, each at the
 *   rows' own pitch and the next where the last ends — drawn from the scroll
 *   offset, never a caption pinned off-screen.
 * - Each is the builder's own row: its surface and its rule, its gutter's rule
 *   and its columns' rules, as the rows it stands for draw them; once the
 *   reveal says so each cell takes its column's shape — the Sheet's by its
 *   column's kind, the Plan's a label bar and the plot's wash under its grid.
 * - No caption sits in a gap: the run says nothing but the Sheet's real row
 *   numbers.
 * - Nothing moves when the rows land: the view, the rows' extent, and at the
 *   view's top the row whose placeholder stood there — the Sheet's by its
 *   number, its place in the record.
 */

import { expect, test, type Locator } from "playwright/test";
import { visitBuilder } from "./builder-page";
import { holdE3, installE3Faults, releaseE3 } from "./e3-faults";
import { settled } from "./settle";

/** A paged builder, by its example, and its parts as the spec reads them. */
interface Paged {
    readonly builder: string;
    readonly route: string;
    /** What the builder's root is, in its entry. */
    readonly root: string;
    /** Its pinned head, inside what scrolls its rows. */
    readonly head: string;
    /** A row it draws once read; its gutter and a column's cell, in it. */
    readonly row: string;
    readonly gutter: string;
    readonly cell: string;
    /** The shapes each run row's cells take once filled, by cell. */
    readonly shapes: readonly string[];
    /** What it pages whole, opened: the Sheet's All, its rows unnarrowed. */
    readonly open?: (entry: Locator) => Promise<void>;
}

const PAGED: readonly Paged[] = [
    {
        // Fifty thousand work orders, every one of them on the All tab, paged two hundred a window: a reference, a job
        // and a status, a due date and a quantity.
        builder: "Sheet", route: "e3/sheet/sheet-records/sheetRecordIndexes", root: "[data-builder-frame]", head: '[data-slot="header"]',
        row: '[data-slot="row"][data-row-id]', gutter: '[data-slot="gutter"]', cell: '[data-slot="cell"]',
        shapes: ["rowNumber", "text", "text", "text", "date", "number"],
        open: async (entry) => {
            await entry.locator('[data-slot="tab"][data-tab="all"]').click();
        },
    },
    {
        // Two thousand presses paged two hundred a window, each a two-line row over the jobs' days.
        builder: "Plan", route: "e3/plan/plan-windows/planWindows", root: "[data-plan-frame]", head: "[data-plan-header]",
        row: "[data-plan-row]", gutter: '[role="rowheader"]', cell: "[data-plan-plot]",
        shapes: ["label2", "wash"],
    },
];

/** What a style comparison reads of each part — a row's surface as it paints, through any transparent box over it. */
const ROW_STYLE = ["surface", "borderBottomWidth", "borderBottomStyle", "borderBottomColor"] as const;
const RULE_STYLE = ["borderRightWidth", "borderRightStyle", "borderRightColor"] as const;

/** A run in the view, as the page lays it out. */
interface RunAt {
    /** The view: its top under the pinned head, and its foot, px from the rows' scroll top. */
    readonly view: { readonly top: number; readonly bottom: number };
    /** The run's own extent, px from the rows' scroll top. */
    readonly run: { readonly top: number; readonly bottom: number };
    /** The real rows' pitch, read before the jump. */
    readonly pitch: number;
    /** Each drawn row: its top and height, px from the rows' scroll top, its index, its number and its cells' shapes. */
    readonly rows: readonly { readonly top: number; readonly height: number; readonly index: number; readonly number: string; readonly shapes: readonly string[] }[];
    /** What the run says, all told. */
    readonly text: string;
    /** Whether its shapes show. */
    readonly filled: boolean;
    /** Where a run row's styles part from a real row's: `part.property run ≠ real`. */
    readonly unlike: readonly string[];
    /** Where the rows scroll to, and their extent. */
    readonly scrollTop: number;
    readonly extent: string | null;
}

/** The rows' scroller in a builder's main. */
function scrollerOf(entry: Locator): Locator {
    return entry.locator("[data-frame-slot='main'] [data-virtual-rows]").first();
}

/** A real row's height: the pitch every run row is drawn at. */
function pitchOf(entry: Locator, paged: Paged): Promise<number> {
    return scrollerOf(entry).evaluate((el, sel) => el.querySelector(sel)!.getBoundingClientRect().height, paged.row);
}

/** The real row's styles the run rows are held to: the row's, its gutter's and a column's cell's, read before the jump. */
type RealStyles = Record<string, string>;

function realStylesOf(entry: Locator, paged: Paged): Promise<RealStyles> {
    return scrollerOf(entry).evaluate((el, { sel, rowStyle, ruleStyle }) => {
        const row = el.querySelector<HTMLElement>(sel.row)!;
        const out: Record<string, string> = {};
        const surface = (node: Element): string => {
            for (let n: Element | null = node; n !== null; n = n.parentElement) {
                const bg = getComputedStyle(n).backgroundColor;
                if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
            }
            return "transparent";
        };
        const read = (part: string, node: Element, props: readonly string[]) => {
            const css = getComputedStyle(node) as unknown as Record<string, string>;
            for (const p of props) out[`${part}.${p}`] = p === "surface" ? surface(node) : css[p]!;
        };
        read("row", row, rowStyle);
        read("gutter", row.querySelector(sel.gutter)!, ruleStyle);
        read("cell", row.querySelector(sel.cell)!, ruleStyle);
        return out;
    }, { sel: { row: paged.row, gutter: paged.gutter, cell: paged.cell }, rowStyle: ROW_STYLE, ruleStyle: RULE_STYLE });
}

/** The run the view meets, measured against the real rows' pitch and styles. */
function runAt(entry: Locator, paged: Paged, pitch: number, real: RealStyles): Promise<RunAt | null> {
    return scrollerOf(entry).evaluate((el, { head, pitch, real, rowStyle, ruleStyle }): RunAt | null => {
        const box = el.getBoundingClientRect();
        const at = (y: number) => y - box.top + el.scrollTop;
        const pinned = el.querySelector(head);
        const headBottom = pinned === null ? box.top : Math.max(box.top, pinned.getBoundingClientRect().bottom);
        const view = { top: at(headBottom), bottom: at(box.top + el.clientHeight) };
        const run = [...el.querySelectorAll<HTMLElement>("[data-unloaded-run]")].find((r) => {
            const b = r.getBoundingClientRect();
            return at(b.bottom) > view.top + 1 && at(b.top) < view.bottom - 1;
        });
        if (run === undefined) return null;
        const runBox = run.getBoundingClientRect();
        const drawn = [...run.querySelectorAll<HTMLElement>(":scope > [data-run-row]")];
        const unlike: string[] = [];
        const surface = (node: Element): string => {
            for (let n: Element | null = node; n !== null; n = n.parentElement) {
                const bg = getComputedStyle(n).backgroundColor;
                if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
            }
            return "transparent";
        };
        const compare = (part: string, node: Element | null, props: readonly string[]) => {
            if (node === null) { unlike.push(`${part} missing`); return; }
            const css = getComputedStyle(node) as unknown as Record<string, string>;
            for (const p of props) {
                const got = p === "surface" ? surface(node) : css[p]!;
                if (got !== real[`${part}.${p}`]) unlike.push(`${part}.${p} ${got} ≠ ${real[`${part}.${p}`]}`);
            }
        };
        const first = drawn.find((row) => !row.hasAttribute("data-run-band"));
        if (first !== undefined) {
            compare("row", first, rowStyle);
            compare("gutter", first.querySelector('[data-run-cell="0"]'), ruleStyle);
            compare("cell", first.querySelector('[data-run-cell="1"]'), ruleStyle);
        }
        return {
            view, pitch,
            run: { top: at(runBox.top), bottom: at(runBox.bottom) },
            rows: drawn.map((row) => {
                const b = row.getBoundingClientRect();
                return {
                    top: at(b.top), height: b.height, index: Number(row.getAttribute("data-run-index")),
                    number: row.querySelector('[data-shape="rowNumber"]')?.textContent ?? "",
                    shapes: [...row.querySelectorAll(":scope > [data-run-cell]")].map((cell) => cell.querySelector("[data-shape]")?.getAttribute("data-shape") ?? ""),
                };
            }),
            text: run.textContent ?? "",
            filled: run.hasAttribute("data-filled") && run.querySelector("[data-unrevealed]") === null,
            unlike,
            scrollTop: el.scrollTop,
            extent: el.querySelector("[data-virtual-extent]")?.getAttribute("data-virtual-extent") ?? null,
        };
    }, { head: paged.head, pitch, real, rowStyle: ROW_STYLE, ruleStyle: RULE_STYLE });
}

/** What is wrong with a run in the view, in words. */
function faults(at: RunAt, paged: Paged): string[] {
    const bad: string[] = [];
    const { rows, view, pitch } = at;
    if (rows.length === 0) return ["no row drawn"];
    // Rows at the pitch, each where the last ends.
    rows.forEach((row, i) => {
        if (Math.abs(row.height - pitch) > 0.5) bad.push(`row ${row.index} ${row.height}px tall, the pitch ${pitch}px`);
        const last = rows[i - 1];
        if (last !== undefined && Math.abs(row.top - (last.top + last.height)) > 0.5) bad.push(`row ${row.index} at ${row.top}, the last ending at ${last.top + last.height}`);
    });
    // In the view: from the first row the view meets under the pinned head, to the view's foot or the run's end — one row of
    // overscan either side at most.
    const top = rows[0]!.top;
    const bottom = rows.at(-1)!.top + rows.at(-1)!.height;
    if (top > view.top + 0.5) bad.push(`the first row at ${top}, below the view's top ${view.top}`);
    if (top < view.top - 2 * pitch - 0.5) bad.push(`the first row at ${top}, more than a row above the view's top ${view.top}`);
    const foot = Math.min(view.bottom, at.run.bottom);
    if (bottom < foot - 0.5) bad.push(`the last row ends at ${bottom}, short of the view's foot ${foot}`);
    if (bottom > foot + 2 * pitch + 0.5) bad.push(`the last row ends at ${bottom}, more than a row past the view's foot ${foot}`);
    // The builder's own row: its surface and rules.
    bad.push(...at.unlike);
    // Each cell its column's shape, once filled.
    if (!at.filled) bad.push("its shapes never revealed");
    for (const row of rows) {
        if (row.shapes.join() !== paged.shapes.join()) bad.push(`row ${row.index}'s shapes ${row.shapes.join()}`);
    }
    // No caption in the gap: the Sheet's real numbers, its place plus one as the gutter draws it, and nothing else.
    const numbers = paged.builder === "Sheet" ? rows.map((row) => row.number) : [];
    if (paged.builder === "Sheet") {
        rows.forEach((row) => { if (row.number !== String(row.index + 1)) bad.push(`row ${row.index} numbered ${row.number}`); });
    }
    if (at.text !== numbers.join("")) bad.push(`it says "${at.text.slice(0, 80)}"`);
    return bad;
}

// A test a builder: each is an area of its own, whose workspace the page deploys the first time it shows (#1397).
for (const theme of ["light", "dark"] as const) {
    for (const paged of PAGED) {
        test(`scrolled into rows not read, the ${paged.builder}'s run draws its own rows in the view at their pitch, says nothing${paged.builder === "Sheet" ? " but their numbers" : ""}, and nothing moves as the rows land (#1398, CL2) (${theme}) @desktop`, async ({ page }) => {
            await installE3Faults(page);
            const entry = await visitBuilder(page, paged.route, paged.root, theme);
            if (paged.open !== undefined) {
                await paged.open(entry);
                await settled(page);
            }
            const pitch = await pitchOf(entry, paged);
            const real = await realStylesOf(entry, paged);
            // The rows' reads held; the view sent to the middle of what they page, past what they read as they opened.
            const hold = await holdE3(page, { kinds: ["page"] });
            await scrollerOf(entry).evaluate((el) => { el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2); });
            await expect.poll(async () => (await runAt(entry, paged, pitch, real))?.filled ?? false, { message: `${paged.builder}: a run in the view, revealed` }).toBe(true);
            await settled(page, { holding: true });
            const held = (await runAt(entry, paged, pitch, real))!;
            expect(faults(held, paged), `${paged.builder} (${theme})`).toEqual([]);
            // The first row whole under the view's top: where the row it stands for lands.
            const anchor = held.rows.find((row) => row.top >= held.view.top - 0.5)!;
            await releaseE3(page, hold);
            await settled(page);
            const landed = await scrollerOf(entry).evaluate((el, { sel, top }) => {
                const box = el.getBoundingClientRect();
                const at = (y: number) => y - box.top + el.scrollTop;
                const row = [...el.querySelectorAll<HTMLElement>(sel.row)].find((r) => Math.abs(at(r.getBoundingClientRect().top) - top) <= 0.5);
                return {
                    scrollTop: el.scrollTop,
                    extent: el.querySelector("[data-virtual-extent]")?.getAttribute("data-virtual-extent") ?? null,
                    row: row === undefined ? null : row.querySelector('[data-slot="gutterNumber"]')?.textContent ?? "",
                    runs: el.querySelectorAll("[data-unloaded-run]").length,
                };
            }, { sel: { row: paged.row }, top: anchor.top });
            expect({ scrollTop: landed.scrollTop, extent: landed.extent, row: landed.row !== null }, `${paged.builder}: the view, the extent and the row at the anchor's place`)
                .toEqual({ scrollTop: held.scrollTop, extent: held.extent, row: true });
            if (paged.builder === "Sheet") expect(landed.row, "the row landed where its placeholder stood, by its number").toBe(anchor.number);
        });
    }
}
