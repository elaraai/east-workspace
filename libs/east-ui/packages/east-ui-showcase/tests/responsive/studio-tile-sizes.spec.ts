/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Studio tiles at every size (#1692), measured in a real browser: the
 * showcase's page of visuals, over which the spec writes a page of its own as
 * another session's publish would — each tile the Studio draws, in its
 * configurations, at a narrow, a small and a wide span. The page is the test's
 * alone: the showcase lists the page of visuals, never this one. The page's
 * grid is set to each width a page could give it, a wide desktop's to a
 * phone's (the showcase's own frame, which holds an example to under a
 * thousand pixels, aside). From 960px the grid gives a tile its span — a
 * narrow one 153px wide at 960 — and under it half the grid or all of it,
 * then under 480px all of it: every width a tile can be drawn at on a page is
 * read. Its pages: every KPI configuration; every kind of donut — its legend
 * of values, of names or none, Other among its slices; every list
 * configuration; records, summaries and pivots; and every kind of chart, its
 * legend of few series and of many long names, its value axis over small
 * numbers and large — each at a narrow, a small, a mid and a wide span. In
 * every tile, every part:
 *
 *  - T1 lies inside its tile's frame;
 *  - T2 lies over no other part;
 *  - T3 stands on one line, its words whole, or ended in an ellipsis with
 *    the whole on hover — a phone table's words wrapping at their spaces
 *    (QP11), none split;
 *  - T4 a number stands whole: never cut, never ended in an ellipsis;
 *  - T5 neither the tile nor anything in it scrolls sideways, but a table's
 *    body, inside which a wide table scrolls (TBL-5);
 *  - C1 a chart's plot keeps a third of its chart's width at the least: its
 *    axes' labels never crowd it out;
 *  - D1 a donut's total and its caption lie inside its hole (#1692), as its
 *    plot says the hole's radius.
 *
 * Every measurement is taken from the laid-out page; a failure names the
 * tile, the page width, the rule and the part.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-tile-sizes --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { none, some, variant } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import { installE3Faults } from "./e3-faults";
import { test } from "./kept-page";
import { settled } from "./settle";
import { HASH, writeVisuals, type Cells } from "./studio-visuals-page";

/** The widths a page's grid is read at: a wide desktop's, through the grid's half and whole tiers, to a phone's. */
const WIDTHS = [1800, 1600, 1440, 1320, 1200, 1120, 1040, 960, 900, 800, 700, 600, 520, 480, 440, 390, 360, 320] as const;

const vis = Studio.visual;

/**
 * Each KPI the spec's page places, on a row of its own: its value alone — a
 * count, an amount, a percentage, a ratio; its change against what it
 * compares to, up, down, flat and long; lower is better; its goal; its trend;
 * and every part at once under a long name.
 */
const KPIS = {
    count: vis.kpi({ value: vis.count() }),
    amount: vis.kpi({ value: vis.sum("revenue") }),
    percent: vis.kpi({ value: vis.mean("margin") }),
    ratio: vis.kpi({ value: vis.ratio("revenue", "units") }),
    up: vis.kpi({ value: vis.sum("revenue"), compare: vis.mean("revenue") }),
    down: vis.kpi({ value: vis.mean("revenue"), compare: vis.sum("revenue") }),
    flat: vis.kpi({ value: vis.sum("revenue"), compare: vis.sum("revenue") }),
    long: vis.kpi({ value: vis.count(), compare: vis.sum("revenue") }),
    lower: vis.kpi({ value: vis.sum("units", { better: "lower" }), compare: vis.mean("units") }),
    goal: vis.kpi({ value: vis.sum("revenue", { goal: 24000 }) }),
    trend: vis.kpi({ value: vis.count(), trend: "ordered_at" }),
    every: vis.kpi({
        value: vis.sum("revenue", { goal: 24000, label: "Revenue across every region this quarter" }),
        compare: vis.mean("revenue"), trend: "ordered_at",
    }),
};

/** The spans each KPI is placed at, on its row: narrow, small and wide. */
const SPANS = [2n, 3n, 7n];

/** The parts of a tile's eyebrow the rules read, by name. */
const EYEBROW: Readonly<Record<string, string>> = {
    name: "[data-studio-visual-name]",
    meta: "[data-studio-visual-meta]",
    menu: "[data-studio-visual-menu]",
};

/**
 * A page of tiles the spec writes: its placements, how many tiles they are, what a tile drawn from its answer is, and
 * the parts the rules read of each — by name, those whose words are numbers (T4), and those drawn, not written.
 */
interface TilePage {
    readonly cells: Cells;
    readonly tiles: number;
    readonly drawn: string;
    readonly parts: Readonly<Record<string, string>>;
    readonly numbers: readonly string[];
    readonly drawings: readonly string[];
    /** The one body that scrolls sideways, where its kind is a grid of columns (a table's): T5 lets it, and what it scrolls across is read as it shows. */
    readonly sideways?: string | undefined;
    /** The parts whose words may run onto lines at their spaces — a phone table's (QP11): T3 reads that none is split. */
    readonly wraps?: readonly string[] | undefined;
}

/** Every KPI configuration, each at a narrow, a small and a wide span, over the page of visuals' orders. */
const KPI_CELLS: Cells = Object.entries(KPIS).flatMap(([name, kpi]) => SPANS.map((span) => ({
    key: `kpi-${name}-${span}`, row: `r-${name}`, span, height: none, align: variant("stretch", null), title: none,
    content: vis.of("orders", kpi),
})));
const KPI_SIZES: TilePage = {
    cells: KPI_CELLS, tiles: KPI_CELLS.length, drawn: "[data-studio-kpi]",
    parts: {
        ...EYEBROW,
        value: "[data-studio-kpi-value]",
        unit: "[data-studio-kpi-unit]",
        change: "[data-studio-kpi-change]",
        goal: "[data-studio-kpi-goal]",
        trend: "[data-studio-kpi-trend]",
        note: "[data-studio-kpi-note]",
    },
    numbers: ["value", "change"],
    drawings: ["menu", "goal", "trend"],
};

/**
 * Each donut the spec's page places, on a row of its own: revenue's shares of its categories — a caption with its
 * unit — of its regions, past four of them in Other, and the customers' orders, a count; a legend of names alone; and
 * none.
 */
const DONUTS = {
    categories: vis.pie({ slice: vis.group("category"), value: vis.sum("revenue"), donut: true }),
    regions: vis.pie({ slice: vis.group("region"), value: vis.sum("revenue"), donut: true }),
    customers: vis.pie({ slice: vis.group("customer"), value: vis.count(), donut: true }),
    names: vis.pie({ slice: vis.group("category"), value: vis.sum("units"), donut: true, legend: "names" }),
    alone: vis.pie({ slice: vis.group("region"), value: vis.sum("revenue"), donut: true, legend: "hidden" }),
};

/** Every donut, each at a narrow, a small, a mid and a wide span, 240 tall, over the page of visuals' orders. */
const DONUT_CELLS: Cells = Object.entries(DONUTS).flatMap(([name, pie]) => [2n, 3n, 4n, 7n].map((span) => ({
    key: `donut-${name}-${span}`, row: `r-${name}`, span, height: some(240n), align: variant("stretch", null), title: none,
    content: vis.of("orders", pie),
})));
const DONUT_SIZES: TilePage = {
    cells: DONUT_CELLS, tiles: DONUT_CELLS.length, drawn: "[data-chart-pie]",
    parts: {
        ...EYEBROW,
        total: "[data-chart-pie-total]",
        caption: "[data-chart-pie-caption]",
        label: "[data-chart-slice-entry] > span:nth-of-type(2)",
        value: "[data-chart-slice-entry] > span:nth-of-type(3)",
        share: "[data-chart-slice-entry] > span:nth-of-type(4)",
        note: "[data-chart-pie-note]",
    },
    numbers: ["total", "value", "share"],
    drawings: ["menu"],
};

/**
 * Each list the spec's page places, on a row of its own, with its ranking bar: the customers by revenue, one value
 * with its unit; under their regions, with a second value; the regions by revenue a unit and their margin, a ratio's
 * long unit beside a percentage; the days, more than a page of them; and the first four customers, the rest in Other.
 */
const LISTS = {
    revenue: vis.list({ item: vis.group("customer", { sort: "high" }), values: [vis.sum("revenue")], bar: true }),
    captioned: vis.list({ item: vis.group("customer", { sort: "high" }), caption: "region", values: [vis.sum("revenue"), vis.count()], bar: true }),
    ratio: vis.list({ item: vis.group("region", { sort: "high" }), values: [vis.ratio("revenue", "units"), vis.mean("margin")], bar: true }),
    days: vis.list({ item: vis.group("ordered_at", { bucket: "day" }), values: [vis.sum("revenue")], bar: true }),
    top: vis.list({ item: vis.group("customer", { sort: "high", top: 4n }), values: [vis.sum("revenue")], bar: true }),
};

/** Every list, each at a narrow, a small, a mid and a wide span, 240 tall, over the page of visuals' orders. */
const LIST_CELLS: Cells = Object.entries(LISTS).flatMap(([name, list]) => [2n, 3n, 4n, 7n].map((span) => ({
    key: `list-${name}-${span}`, row: `r-${name}`, span, height: some(240n), align: variant("stretch", null), title: none,
    content: vis.of("orders", list),
})));
const LIST_SIZES: TilePage = {
    cells: LIST_CELLS, tiles: LIST_CELLS.length, drawn: "[data-studio-list]",
    parts: {
        ...EYEBROW,
        item: "[data-studio-list-name]",
        caption: "[data-studio-list-caption]",
        value: "[data-studio-list-value]",
        unit: "[data-studio-list-unit]",
        bar: "[data-studio-list-bar]",
        note: "[data-studio-visual-note]",
        pages: "[data-scope='pagination'] button",
    },
    numbers: ["value"],
    drawings: ["menu", "bar", "pages"],
};

/**
 * Each table the spec's page places, on a row of its own: the latest orders in six columns, and in two; the regions
 * summed with their total, and over their categories with a goal; the regions over the categories on the heat ramp,
 * and over two years of months.
 */
const TABLES = {
    records: vis.records({ columns: ["ordered_at", "customer", "region", "revenue", "units", "margin"], sort: "ordered_at", descending: true }),
    pair: vis.records({ columns: ["customer", "revenue"] }),
    summary: vis.summary({ rows: [vis.group("region", { sort: "high" })], values: [vis.sum("revenue"), vis.count()], total: true }),
    nested: vis.summary({ rows: [vis.group("region", { sort: "high" }), vis.group("category")], values: [vis.sum("revenue"), vis.ratio("revenue", "units", { goal: 13.5 })], total: true }),
    pivot: vis.pivot({ rows: vis.group("region"), columns: vis.group("category"), value: vis.sum("revenue"), heat: true }),
    months: vis.pivot({ rows: vis.group("region"), columns: vis.group("ordered_at", { bucket: "month" }), value: vis.count(), heat: true }),
};

/** Every table, each at a narrow, a small, a mid and a wide span, 300 tall, over the page of visuals' orders. */
const TABLE_CELLS: Cells = Object.entries(TABLES).flatMap(([name, table]) => [2n, 3n, 4n, 7n].map((span) => ({
    key: `table-${name}-${span}`, row: `r-${name}`, span, height: some(300n), align: variant("stretch", null), title: none,
    content: vis.of("orders", table),
})));
const TABLE_SIZES: TilePage = {
    cells: TABLE_CELLS, tiles: TABLE_CELLS.length, drawn: "[data-studio-records=''], [data-studio-summary], [data-studio-pivot]",
    parts: {
        ...EYEBROW,
        head: "th span",
        text: "td p:not([data-numeric]):not([data-date])",
        date: "td [data-date]",
        number: "td [data-numeric]",
        columns: "[data-slot='colHeader'] > span, [data-slot='headerCell'] > span",
        rows: "[data-slot='rowHeaderName']",
        cell: "[data-slot='segLabel']",
        heat: "[data-studio-heat]",
        tick: "[data-studio-heat-tick]",
        note: "[data-studio-visual-note]",
        pages: "[data-scope='pagination'] button",
    },
    numbers: ["number", "cell", "tick"],
    drawings: ["menu", "heat", "pages"],
    // A table is a grid of columns: a wide one scrolls sideways inside its tile, its body alone (TBL-5).
    sideways: "[data-studio-pivot] [data-virtual-rows], [data-table-scroll]",
    wraps: ["text"],
};

/**
 * Each chart the spec's page places, on a row of its own: revenue's months stacked by its six regions, a legend of
 * six; its months by each of its fourteen customers, a legend of many long names; a margin's weeks, the small numbers
 * of a percentage on its value axis; every customer's revenue as bars, the large numbers of two years beside long
 * names; a month's revenue under its goal; the regions' revenue beside their margin on a second axis; each customer's
 * units against their revenue, by region; and a pie of the categories.
 */
const CHARTS = {
    stacked: vis.column({ x: vis.group("ordered_at", { bucket: "month" }), values: [vis.sum("revenue")], split: "region", stack: "stacked" }),
    customers: vis.line({ x: vis.group("ordered_at", { bucket: "month" }), values: [vis.sum("revenue")], split: "customer" }),
    small: vis.line({ x: vis.group("ordered_at", { bucket: "week" }), values: [vis.mean("margin")] }),
    large: vis.bar({ x: vis.group("customer", { sort: "high" }), values: [vis.sum("revenue")] }),
    goal: vis.area({ x: vis.group("ordered_at", { bucket: "month" }), values: [vis.sum("revenue", { goal: 130000 })] }),
    combo: vis.combo({ x: vis.group("region"), columns: [vis.left(vis.sum("revenue"))], lines: [vis.right(vis.mean("margin"))] }),
    scatter: vis.scatter({ point: "customer", x: vis.sum("units"), y: vis.sum("revenue"), split: "region" }),
    pie: vis.pie({ slice: vis.group("category"), value: vis.sum("revenue") }),
};

/** Every chart, each at a narrow, a small, a mid and a wide span, 240 tall, over the page of visuals' orders. */
const CHART_CELLS: Cells = Object.entries(CHARTS).flatMap(([name, chart]) => [2n, 3n, 4n, 7n].map((span) => ({
    key: `chart-${name}-${span}`, row: `r-${name}`, span, height: some(240n), align: variant("stretch", null), title: none,
    content: vis.of("orders", chart),
})));
const CHART_SIZES: TilePage = {
    cells: CHART_CELLS, tiles: CHART_CELLS.length, drawn: "[data-studio-chart]",
    parts: {
        ...EYEBROW,
        caption: "[data-studio-chart-caption]",
        legend: "[data-chart-legend-entry] > span:nth-of-type(2)",
        tick: ".visx-axis-tick text",
        rule: "[data-chart-rule-label]",
        label: "[data-chart-slice-entry] > span:nth-of-type(2)",
        value: "[data-chart-slice-entry] > span:nth-of-type(3)",
        share: "[data-chart-slice-entry] > span:nth-of-type(4)",
        note: "[data-studio-visual-note]",
    },
    numbers: ["value", "share"],
    drawings: ["menu"],
};

/**
 * Opens the page of visuals on a wide screen and writes a page of tiles over it, every tile drawn from its answer, at
 * rest: the page's tiles alone, with no starting filter.
 *
 * @param page - The browser's page
 * @param at - The page of tiles
 * @returns The page's grid
 */
async function openTiles(page: Page, at: TilePage): Promise<Locator> {
    await installE3Faults(page);
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto(`/?theme=light#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const grid = entry.locator("[data-snap-grid]").first();
    await expect(grid).toBeVisible({ timeout: 30_000 });
    await writeVisuals(page, () => ({ title: "Tiles", cells: at.cells, filters: [] }));
    // e3 in the page answers each tile's programs: every tile drawn.
    await expect.poll(() => grid.evaluate((root, drawn) => root.querySelectorAll(drawn).length, at.drawn), { timeout: 120_000 }).toBe(at.tiles);
    await settled(page);
    return grid;
}

/**
 * What is wrong with a page's tiles at a grid width: each a line naming the
 * tile, the width, the rule and the part — none when every tile stands whole.
 *
 * @param grid - The page's grid
 * @param at - The page of tiles: the parts the rules read
 * @param width - The grid's width, as each line names it
 * @returns The faults
 */
function faultsOf(grid: Locator, at: TilePage, width: number): Promise<string[]> {
    return grid.evaluate((root, { parts, numbers, drawings, width, sideways, wraps }) => {
        const bad: string[] = [];
        const r = (n: number) => Math.round(n * 10) / 10;
        const box = (b: DOMRect) => `${r(b.left)},${r(b.top)} ${r(b.width)}×${r(b.height)}`;
        /** The lines a part's words stand on: its text's boxes, a new line where one starts under the last line's foot. */
        const lines = (el: HTMLElement) => {
            const rects: DOMRect[] = [];
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
                if ((node.textContent ?? "").trim() === "") continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 0));
            }
            rects.sort((a, b) => a.top - b.top);
            let count = 0;
            let foot = -Infinity;
            for (const rect of rects) {
                if (rect.top >= foot - 1) {
                    count++;
                    foot = rect.bottom;
                } else foot = Math.max(foot, rect.bottom);
            }
            return count;
        };
        /** A word of a part's that stands on two lines: split, as a run onto lines at its spaces never splits one. */
        const split = (el: HTMLElement): string | undefined => {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
                for (const word of (node.textContent ?? "").matchAll(/\S+/gu)) {
                    const range = document.createRange();
                    range.setStart(node, word.index);
                    range.setEnd(node, word.index + word[0].length);
                    const tops = new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top)));
                    if (tops.size > 1) return word[0];
                }
            }
            return undefined;
        };
        /** A box between a part and its tile, by its tag and its first marks. */
        const named = (el: Element) => `${el.tagName.toLowerCase()}${[...el.attributes].filter((a) => a.name.startsWith("data-")).slice(0, 2).map((a) => `[${a.name}]`).join("")}`;
        /**
         * What of a part shows, and the boxes that clip it sideways: its box, cut where its rows scroll up and down — a
         * list's rows past its foot lie under it, scrolled out of view — and, at the one kind of body that scrolls
         * sideways (`sideways`, a records table's), where it scrolls across; never cut by a box that only clips it,
         * which T1 holds it inside.
         */
        const shown = (el: Element, cell: Element) => {
            let { left, top, right, bottom } = el.getBoundingClientRect();
            const clips: Element[] = [];
            for (let up = el.parentElement; up !== null && up !== cell; up = up.parentElement) {
                const look = getComputedStyle(up);
                const at = up.getBoundingClientRect();
                if (look.overflowY === "auto" || look.overflowY === "scroll") [top, bottom] = [Math.max(top, at.top), Math.min(bottom, at.bottom)];
                if (sideways !== undefined && up.matches(sideways)) [left, right] = [Math.max(left, at.left), Math.min(right, at.right)];
                else if (look.overflowX !== "visible") clips.push(up);
            }
            return { at: new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top)), clips };
        };
        for (const cell of root.querySelectorAll<HTMLElement>("[data-snap-grid-cell]")) {
            const tile = `${cell.getAttribute("data-snap-grid-cell")} (${r(cell.getBoundingClientRect().width)}px) in a ${width}px grid`;
            const frame = cell.getBoundingClientRect();
            const found = Object.entries(parts).flatMap(([name, selector]) => [...cell.querySelectorAll<HTMLElement>(selector)]
                .map((el) => ({ name, el, ...shown(el, cell) })))
                .filter((part) => part.at.width > 0 && part.at.height > 0);
            for (const part of found) {
                const { name, el, at } = part;
                // T1: inside the tile's frame, and inside every box between that clips it — a legend row's entry past its
                // line is hidden, as one past its end is cut.
                if (at.left < frame.left - 0.5 || at.right > frame.right + 0.5 || at.top < frame.top - 0.5 || at.bottom > frame.bottom + 0.5) {
                    bad.push(`${tile}: T1 ${name} at ${box(at)} past the tile at ${box(frame)}`);
                }
                for (const clip of part.clips) {
                    const by = clip.getBoundingClientRect();
                    if (at.left < by.left - 0.5 || at.right > by.right + 0.5 || at.top < by.top - 0.5 || at.bottom > by.bottom + 0.5) {
                        bad.push(`${tile}: T1 ${name} at ${box(at)} cut by ${named(clip)} at ${box(by)}`);
                    }
                }
                if (drawings.includes(name) || (el.textContent ?? "").trim() === "") continue;
                // T3, T4: its words on one line, whole — or, words not a number, ended in an ellipsis with the whole on hover; a
                // part that wraps, on lines at its spaces.
                const n = lines(el);
                const torn = n > 1 && wraps.includes(name) ? split(el) : undefined;
                if (torn !== undefined) bad.push(`${tile}: T3 ${name} “${el.textContent}” splits “${torn}” across lines`);
                else if (n > 1 && !wraps.includes(name)) bad.push(`${tile}: T3 ${name} “${el.textContent}” on ${n} lines`);
                // An SVG text's scroll and client widths are no box's: a donut's words are D1's to read.
                if (!(el instanceof SVGElement) && el.scrollWidth > el.clientWidth + 0.5) {
                    const look = getComputedStyle(el);
                    const ended = look.textOverflow === "ellipsis" && look.overflowX !== "visible";
                    const whole = (el.closest("[title]")?.getAttribute("title") ?? "").includes((el.textContent ?? "").trim());
                    if (numbers.includes(name)) bad.push(`${tile}: T4 ${name} “${el.textContent}” cut, ${r(el.scrollWidth)} in ${r(el.clientWidth)}`);
                    else if (!ended || !whole) bad.push(`${tile}: T3 ${name} “${el.textContent}” cut ${ended ? "with no whole on hover" : "with no ellipsis"}, ${r(el.scrollWidth)} in ${r(el.clientWidth)}`);
                }
            }
            // T2: no part over another.
            for (let i = 0; i < found.length; i++) {
                for (let j = i + 1; j < found.length; j++) {
                    const a = found[i]!, b = found[j]!;
                    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
                    const w = Math.min(a.at.right, b.at.right) - Math.max(a.at.left, b.at.left);
                    const h = Math.min(a.at.bottom, b.at.bottom) - Math.max(a.at.top, b.at.top);
                    if (w > 0.5 && h > 0.5) bad.push(`${tile}: T2 ${a.name} at ${box(a.at)} over ${b.name} at ${box(b.at)}`);
                }
            }
            // T5: nothing scrolls sideways — the tile, or anything in it — but a table's body.
            for (const el of [cell, ...cell.querySelectorAll<HTMLElement>("*")]) {
                if (sideways !== undefined && el.matches(sideways)) continue;
                const look = getComputedStyle(el);
                const scrolls = el === cell || look.overflowX === "auto" || look.overflowX === "scroll";
                if (scrolls && el.scrollWidth > el.clientWidth + 0.5) {
                    bad.push(`${tile}: T5 ${el === cell ? "the tile" : el.tagName.toLowerCase()} scrolls sideways, ${r(el.scrollWidth)} in ${r(el.clientWidth)}`);
                }
            }
            // C1: a chart's plot keeps a third of its chart's width at the least, as its plot says its box (#1692): its axes'
            // labels never crowd it out.
            for (const plot of cell.querySelectorAll<SVGElement>("svg[data-chart-plot]")) {
                const room = Number(plot.getAttribute("data-chart-plot")!.split(" ")[2]);
                const whole = plot.getBoundingClientRect().width;
                if (room < whole / 3 - 0.5) bad.push(`${tile}: C1 the plot ${r(room)} wide in a ${r(whole)}px chart`);
            }
            // D1: a donut's total and caption inside its hole, every corner of each within the radius its plot says.
            for (const plot of cell.querySelectorAll<SVGElement>("svg[data-chart-pie-hole]")) {
                const hole = Number(plot.getAttribute("data-chart-pie-hole"));
                const disc = plot.getBoundingClientRect();
                const [cx, cy] = [disc.left + disc.width / 2, disc.top + disc.height / 2];
                for (const words of plot.querySelectorAll<SVGTextElement>("[data-chart-pie-total], [data-chart-pie-caption]")) {
                    const at = words.getBoundingClientRect();
                    const far = Math.max(...[[at.left, at.top], [at.right, at.top], [at.left, at.bottom], [at.right, at.bottom]]
                        .map(([x, y]) => Math.hypot(x! - cx, y! - cy)));
                    if (far > hole + 0.5) bad.push(`${tile}: D1 “${words.textContent}” at ${box(at)} reaches ${r(far)} from the centre of a ${r(hole)} hole`);
                }
            }
        }
        return bad;
    }, { parts: at.parts, numbers: at.numbers, drawings: at.drawings, width, sideways: at.sideways, wraps: at.wraps ?? [] });
}

/**
 * Reads a page of tiles with its grid at every width: what is wrong at each.
 *
 * @param page - The browser's page
 * @param at - The page of tiles
 * @returns Every fault, at every width
 */
async function readEveryWidth(page: Page, at: TilePage): Promise<string[]> {
    const grid = await openTiles(page, at);
    const found: string[] = [];
    for (const width of WIDTHS) {
        // The grid at the width a page that wide gives it: its tiers answer the grid's own width.
        await grid.evaluate((root, w) => { root.querySelector<HTMLElement>("[data-snap-grid-body]")!.style.width = `${w}px`; }, width);
        await settled(page);
        found.push(...await faultsOf(grid, at, width));
    }
    return found;
}

test.describe("Studio tiles at every size (#1692)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, from the desktop project, at every grid width");

    test("KPIs: every configuration at every span and grid width — inside its tile, over no other part, on one line whole or ended with the whole on hover, its numbers whole, nothing scrolling sideways", async ({ page }) => {
        expect(await readEveryWidth(page, KPI_SIZES)).toEqual([]);
    });

    test("Donuts: every kind at every span and grid width — the same rules, and its total and caption inside its hole", async ({ page }) => {
        expect(await readEveryWidth(page, DONUT_SIZES)).toEqual([]);
    });

    test("Lists: every configuration at every span and grid width — the same rules over its rows, its bars and its foot", async ({ page }) => {
        expect(await readEveryWidth(page, LIST_SIZES)).toEqual([]);
    });

    test("Tables: records, summaries and pivots at every span and grid width — the same rules over their heads, cells, legends and feet, a table's body alone scrolling sideways", async ({ page }) => {
        expect(await readEveryWidth(page, TABLE_SIZES)).toEqual([]);
    });

    test("Charts: every kind at every span and grid width — the same rules over their legends, their axes' labels and their goals", async ({ page }) => {
        expect(await readEveryWidth(page, CHART_SIZES)).toEqual([]);
    });
});
