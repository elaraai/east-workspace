/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Plan's chart page (#1753, #1750), measured in the page over planCharts —
 * a print works' chart rows, each styled its own way:
 *
 * - its legend — a line a named series down a row's gutter, in the order the
 *   series are declared, its name with its axis's unit and, on a chart that
 *   draws on both axes, its axis; its stroke in the ink its marks draw in, from
 *   the tokens, in both themes; a row with no room for every series ending on
 *   how many more there are; a spark listing none;
 * - its axes — the left's numbers in the gutter, the right's inside the plot's
 *   right edge, each right number at a left number's height, on one gridline;
 *   a row with its grid off reading its scale by its numbers alone;
 * - its marks — each stroke as its layer gives it, a dot at every point where
 *   a layer asks for them, and a reading with none either side drawn as one;
 * - its readout — the row under the pointer reading the week's name and a line
 *   a series, each with its unit, a line and its band on one;
 * - a target zone's caption — at the zone's start on the canvas, and past the
 *   numbers inside a phone card's plot.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { drawnSel, openExample, planBox, rowSel, same, sizeBox } from "./plan-page";
import { settled } from "./settle";
import { token } from "./tokens";

/** The chart page's examples file in the catalog. */
const PLAN_CHART_EXAMPLES = "e3/plan/plan-charts";

/** A chart row's legend and axes as the page lays them out. */
interface ChartRead {
    readonly height: number;
    /** Its legend's lines: each the words of its parts — its stroke's none, its name and unit, its axis — in order. */
    readonly legend: readonly (readonly string[])[];
    /** Each line's stroke, as its ink computes. */
    readonly strokes: readonly string[];
    /** The left axis's numbers in the gutter, and the right's in the plot: what each reads, and its middle down the row. */
    readonly left: readonly (readonly [string, number])[];
    readonly right: readonly (readonly [string, number])[];
    readonly gridlines: number;
    readonly dots: number;
}

/** Reads a chart row ({@link ChartRead}). */
const readChart = (row: Locator): Promise<ChartRead> => row.evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    const middle = (t: Element) => {
        const b = t.getBoundingClientRect();
        return Math.round((b.top + b.height / 2 - top) * 100) / 100;
    };
    return {
        height: el.getBoundingClientRect().height,
        legend: [...el.querySelectorAll("[data-plan-legend-item]")].map((item) => [...item.children].map((part) => part.textContent ?? "")),
        strokes: [...el.querySelectorAll("[data-plan-legend-swatch]")].map((swatch) => getComputedStyle(swatch).backgroundColor),
        left: [...el.querySelectorAll("[role='rowheader'] [data-plan-tickpx]")].map((t) => [t.textContent ?? "", middle(t)] as const),
        right: [...el.querySelectorAll("[data-plan-tick-right]")].map((t) => [t.textContent ?? "", middle(t)] as const),
        gridlines: el.querySelectorAll("[data-plan-gridline]").length,
        dots: el.querySelectorAll("[data-plan-mark='dot']").length,
    };
});

/** A row of the page by its series and its entry's key. */
const chartRow = (entry: Locator, series: string, key: string): Locator => entry.locator(rowSel(series, key));

/** Each series' ink, by the token it is drawn in: the chart's series colours, then those its layers' authors chose. */
const INKS = [
    "brand-solid", "accent-teal", "accent-purple", "accent-blue", "accent-orange",
    "fg-subtle", "orange-solid", "green-solid", "purple-solid", "teal-solid",
] as const;

/** The inks the page resolves, by their tokens. */
async function inksOf(page: Page): Promise<Readonly<Record<(typeof INKS)[number], string>>> {
    return Object.fromEntries(await Promise.all(INKS.map(async (name) => [name, await token(page, name)] as const))) as Record<(typeof INKS)[number], string>;
}

/** The row under the pointer's readout, its pointer at a share of its plot's width: its title, and each line's name and value. */
async function readoutAt(page: Page, row: Locator, at: number): Promise<{ title: string; names: string[]; values: string[] }> {
    await row.scrollIntoViewIfNeeded();
    const plot = (await row.locator("[data-plan-plot]").boundingBox())!;
    await page.mouse.move(plot.x + plot.width * at, plot.y + plot.height / 2);
    const tip = page.locator("[data-plan-tooltip][data-open]");
    await expect(tip).toHaveCount(1);
    return tip.evaluate((el) => ({
        title: el.querySelector("[data-plan-tooltip-title]")?.textContent ?? "",
        names: [...el.querySelectorAll("[data-plan-tooltip-name]")].map((n) => n.textContent ?? ""),
        values: [...el.querySelectorAll("[data-plan-tooltip-value]")].map((v) => v.textContent ?? ""),
    }));
}

test.describe("Plan chart page (#1753) @desktop", () => {
    for (const theme of ["light", "dark"] as const) {
        test(`planCharts (${theme}): each row taller than its own lines lists its named series down its gutter in the order they are declared, its name with its axis's unit and, on two axes, its axis — its stroke the ink its series draws in; a row short of room ends on how many more; a spark lists none`, async ({ page }) => {
            const entry = await openExample(page, "planCharts", PLAN_CHART_EXAMPLES, theme);
            const ink = await inksOf(page);
            const legendOf = async (series: string, key: string) => {
                const read = await readChart(chartRow(entry, series, key));
                return { legend: read.legend, strokes: read.strokes };
            };
            const lines = (...names: string[]) => names.map((name) => ["", name]);
            expect(await legendOf("combo", "output")).toEqual({
                legend: lines("Printed k sheets", "Forecast k sheets"), strokes: [ink["brand-solid"], ink["accent-teal"]],
            });
            expect(await legendOf("halls", "halls")).toEqual({
                legend: lines("Hall 1 k sheets", "Hall 2 k sheets", "Hall 3 k sheets", "Plan k sheets"),
                strokes: [ink["brand-solid"], ink["accent-teal"], ink["accent-purple"], ink["fg-subtle"]],
            });
            expect(await legendOf("jobs", "jobs")).toEqual({
                legend: lines("Planned jobs", "Done jobs"), strokes: [ink["fg-subtle"], ink["brand-solid"]],
            });
            expect(await legendOf("press-hours", "press-hours")).toEqual({
                legend: lines("Press A h", "Press B h", "Press C h"), strokes: [ink["brand-solid"], ink["accent-teal"], ink["accent-purple"]],
            });
            // On two axes, each line names its series' axis.
            expect(await legendOf("climate", "climate")).toEqual({
                legend: [["", "Load %", "left"], ["", "Temp °C", "right"]], strokes: [ink["brand-solid"], ink["orange-solid"]],
            });
            expect(await legendOf("quality", "quality")).toEqual({
                legend: [["", "Sheets k", "left"], ["", "On-time %", "right"]], strokes: [ink["brand-solid"], ink["green-solid"]],
            });
            expect(await legendOf("audits", "audits")).toEqual({
                legend: lines("Audit %", "Average %"), strokes: [ink["purple-solid"], ink["fg-subtle"]],
            });
            expect(await legendOf("defects", "defects")).toEqual({
                legend: lines("Press A ppm", "Press B ppm"), strokes: [ink["teal-solid"], ink["orange-solid"]],
            });
            expect(await legendOf("strokes", "strokes")).toEqual({
                legend: lines("Default", "Thick", "Dashed", "Dotted", "Faint"),
                strokes: [ink["brand-solid"], ink["accent-teal"], ink["accent-purple"], ink["accent-blue"], ink["accent-orange"]],
            });
            expect(await legendOf("curves", "curves")).toEqual({
                legend: lines("Linear", "Smooth", "Natural", "Step"),
                strokes: [ink["brand-solid"], ink["accent-teal"], ink["accent-purple"], ink["accent-blue"]],
            });
            // Six series in a row with room for two lines: the first, then how many more — the row keeps its height.
            const presses = await readChart(chartRow(entry, "presses", "presses"));
            expect([presses.height, presses.legend]).toEqual([88, [["", "Press A k sheets"], ["+5 more"]]]);
            // At a row's own height, none.
            for (const [series, key] of [["spark-line", "on-time"], ["spark-columns", "printed"]] as const) {
                const spark = await readChart(chartRow(entry, series, key));
                expect([spark.height, spark.legend]).toEqual([32, []]);
            }
            // A stroke in the legend is the ink its marks draw in: each line's, each hall's columns'.
            const marks = await chartRow(entry, "strokes", "strokes").evaluate((el) => [...el.querySelectorAll("[data-plan-mark='line']")].map((m) => getComputedStyle(m).stroke));
            expect(marks).toEqual((await readChart(chartRow(entry, "strokes", "strokes"))).strokes);
            const columns = await chartRow(entry, "halls", "halls").evaluate((el) => [...el.querySelectorAll("[data-plan-mark='column']")].map((m) => getComputedStyle(m).fill));
            expect([columns[0], columns[10], columns[20]]).toEqual([ink["brand-solid"], ink["accent-teal"], ink["accent-purple"]]);
        });
    }

    test("planCharts: on two axes, the left reads its numbers in the gutter and the right reads its own inside the plot's right edge, each at a left number's height — one gridline for both; a row with its grid off reads its scale by its numbers alone, and a spark by its gridlines alone", async ({ page }) => {
        const entry = await openExample(page, "planCharts", PLAN_CHART_EXAMPLES);
        const shared = (read: ChartRead) => read.left.map(([left, y], i) => [left, read.right[i]?.[0], Math.abs(y - (read.right[i]?.[1] ?? Number.NaN)) <= 0.5]);
        const climate = await readChart(chartRow(entry, "climate", "climate"));
        expect(shared(climate)).toEqual([["0", "0", true], ["25", "10", true], ["50", "20", true], ["75", "30", true], ["100", "40", true]]);
        expect(climate.gridlines).toBe(5);
        const quality = await readChart(chartRow(entry, "quality", "quality"));
        expect(shared(quality)).toEqual([["0", "70", true], ["20", "80", true], ["40", "90", true], ["60", "100", true]]);
        expect(quality.gridlines).toBe(4);
        // Its grid off: no gridline, its numbers still read.
        const audits = await readChart(chartRow(entry, "audits", "audits"));
        expect([audits.gridlines, audits.left.map(([n]) => n)]).toEqual([0, ["86", "88", "90", "92", "94"]]);
        // A spark: its gridlines, no number.
        const spark = await readChart(chartRow(entry, "spark-line", "on-time"));
        expect([spark.gridlines > 0, spark.left, spark.right]).toEqual([true, [], []]);
    });

    test("planCharts: each stroke as its layer gives it — its width, its dash and its strength — and a dot at every point where a layer asks for them; a reading with none either side drawn as its dot", async ({ page }) => {
        const entry = await openExample(page, "planCharts", PLAN_CHART_EXAMPLES);
        const strokes = await chartRow(entry, "strokes", "strokes").evaluate((el) => [...el.querySelectorAll("[data-plan-mark='line']")].map((m) => {
            const s = getComputedStyle(m);
            return [s.strokeWidth, s.strokeDasharray, s.strokeOpacity];
        }));
        expect(strokes).toEqual([
            ["1.5px", "none", "1"],
            ["3.5px", "none", "1"],
            ["2px", "8px, 4px", "1"],
            ["2px", "1px, 3px", "1"],
            ["2px", "none", "0.4"],
        ]);
        // The dotted line's dots, a week each.
        expect((await readChart(chartRow(entry, "strokes", "strokes"))).dots).toBe(10);
        // The on-time line's, a week each.
        expect((await readChart(chartRow(entry, "quality", "quality"))).dots).toBe(10);
        // The audits held in W23 and in W28 have no reading either side: a dot each, and none for the readings joined.
        expect((await readChart(chartRow(entry, "audits", "audits"))).dots).toBe(2);
    });

    test("planCharts: the row under the pointer reads the week's name, then a line a series in the legend's order with its unit — a line and its band on one — and all six presses where the legend has room for one", async ({ page }) => {
        const entry = await openExample(page, "planCharts", PLAN_CHART_EXAMPLES);
        expect(await readoutAt(page, chartRow(entry, "combo", "output"), 0.15)).toEqual({
            title: "Week of Jun 8, 2026",
            names: ["Printed", "Forecast"],
            values: ["34 k sheets", "33 (30–36) k sheets"],
        });
        expect(await readoutAt(page, chartRow(entry, "climate", "climate"), 0.35)).toEqual({
            title: "Week of Jun 22, 2026",
            names: ["Load", "Temp"],
            values: ["74 %", "26 °C"],
        });
        expect(await readoutAt(page, chartRow(entry, "presses", "presses"), 0.55)).toEqual({
            title: "Week of Jul 6, 2026",
            names: ["Press A", "Press B", "Press C", "Press D", "Press E", "Press F"],
            values: ["37 k sheets", "29 k sheets", "28 k sheets", "23 k sheets", "20 k sheets", "14 k sheets"],
        });
    });

    test("planCharts: a target zone's caption stands at the zone's start on the canvas, whose numbers are in the gutter; on a phone card, whose numbers stand inside its plot's left edge, just past them (#1750, ruled 25 Nov 2026)", async ({ page }) => {
        const entry = await openExample(page, "planCharts", PLAN_CHART_EXAMPLES);
        /** The zone's caption's left, the plot's, and the right of the widest number inside the plot — none on a canvas row. */
        const read = () => entry.locator(drawnSel("quality", "quality")).evaluate((el) => {
            const caption = [...el.querySelectorAll("[data-plan-band-caption]")].find((c) => c.textContent === "ON TARGET")!;
            const inPlot = [...el.querySelectorAll("[data-plan-cardbody] [data-plan-tickpx]")].map((t) => t.getBoundingClientRect().right);
            return {
                caption: caption.getBoundingClientRect().left,
                plot: el.querySelector("[data-plan-chart]")!.getBoundingClientRect().left,
                numbers: inPlot.length === 0 ? null : Math.max(...inPlot),
            };
        });
        const canvas = await read();
        expect([canvas.numbers, same(canvas.caption, canvas.plot)]).toEqual([null, true]);
        // A phone's width: the canvas is cards, its chart rows under Measures.
        await sizeBox(page, planBox(entry), 360);
        await entry.getByRole("tab", { name: /Measures/ }).click();
        await settled(page);
        const card = await read();
        expect(card.numbers, "the card's numbers inside its plot").not.toBeNull();
        // Never under the numbers, and no further from them than its own paper's edge.
        expect(card.caption - card.numbers!).toBeGreaterThanOrEqual(-0.5);
        expect(card.caption - card.numbers!).toBeLessThanOrEqual(1);
    });
});
