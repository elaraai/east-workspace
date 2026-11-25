/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the module loads east-ui-components' entry, which
 * needs one as it loads.
 *
 * The period a window's columns take (#1740): the finest a canvas offers whose
 * column holds the column floor on the plot as laid out; kept while the plot's
 * width alone changes, down to the squeeze floor; the window a period's
 * preset sets, from the window's start, or about a table cell's middle; and
 * the range a brush's resize sets, which nothing holds to a period.
 */

import { describe, expect, test } from "vitest";
import { PLAN_GEOMETRY } from "../../plan/geometry.js";
import { BUCKET_SLOT_GAP } from "../../plan/rows/bucket-slots.js";
import {
    PRESET_LEAST, brushedRange, columnPeriod, finestFirst, periodColumns, presetAround, presetWindow, squeezedPeriod,
    type ColumnWidths, type HeldEnd,
} from "./period.js";
import { MAX_BUCKETS, timeScale, type TimeResolution } from "./scale.js";

const G = PLAN_GEOMETRY.default;
const WIDTHS: ColumnWidths = { floor: G.columnMinWidth, squeeze: G.columnSqueezeWidth, preset: G.columnPresetWidth };
const CALENDAR: readonly TimeResolution[] = ["day", "week", "month", "quarter", "year"];

const DAY = 86_400_000;
const at = (iso: string): number => Date.parse(`${iso}T00:00:00.000Z`);
/** A Monday. */
const MON = at("2026-01-05");
const days = (n: number): readonly [number, number] => [MON, MON + n * DAY];
const pick = (window: readonly [number, number], plot: number, offered = CALENDAR) =>
    columnPeriod(window[0], window[1], plot, offered, WIDTHS.floor);

describe("the canvas's column widths (#1740)", () => {
    test("the floor is a tile at its floor inside its day's rules, so a day picked has room for one tile", () => {
        expect(G.columnMinWidth).toBe(G.tileMinWidth + BUCKET_SLOT_GAP);
        expect([G.columnMinWidth, G.columnSqueezeWidth, G.columnPresetWidth]).toEqual([25, 10, 50]);
        expect(PLAN_GEOMETRY.dense.columnMinWidth).toBe(G.columnMinWidth);
    });
});

describe("how many columns a range draws at a period (#1740)", () => {
    test("the periods it touches, as a scale cuts it: its window widened outward to whole periods", () => {
        const windows: (readonly [number, number])[] = [
            days(1), days(13), days(14), [MON + 3 * DAY, MON + 17 * DAY], [at("2026-01-01"), at("2027-01-01")],
            [at("2026-01-31"), at("2026-03-01")], [at("2026-02-15"), at("2026-02-16")], [at("2025-11-20"), at("2028-02-03")],
            [MON + 5 * 3_600_000, MON + 30 * 3_600_000],
        ];
        for (const [from, to] of windows) {
            for (const resolution of ["hour", ...CALENDAR] as const) {
                const scale = timeScale({ window: { min: new Date(from), max: new Date(to) }, resolution });
                if (scale === undefined || scale.truncated !== undefined) continue;
                expect([resolution, from, to, periodColumns(resolution, from, to)]).toEqual([resolution, from, to, scale.n]);
            }
        }
    });

    test("a year of each, and no column for an empty or an inverted range", () => {
        const year = [at("2026-01-01"), at("2027-01-01")] as const;
        expect(CALENDAR.map((p) => periodColumns(p, ...year))).toEqual([365, 53, 12, 4, 1]);
        expect(periodColumns("day", MON, MON)).toBe(0);
        expect(periodColumns("week", MON + DAY, MON)).toBe(0);
    });
});

describe("the period a range's columns take on a plot (#1740)", () => {
    test("the finest offered whose column is at least the floor", () => {
        expect(pick(days(7), 1000)).toBe("day");
        expect(pick(days(40), 1000)).toBe("day");
        // Past forty days on a plot of a thousand, a day is under the floor: weeks.
        expect(pick(days(41), 1000)).toBe("week");
        expect(pick(days(42), 1000)).toBe("week");
        expect(pick([at("2026-01-01"), at("2027-01-01")], 1000)).toBe("month");
        expect(pick([at("2026-01-01"), at("2031-01-01")], 1000)).toBe("quarter");
        expect(pick([at("2026-01-01"), at("2046-01-01")], 1000)).toBe("year");
    });

    test("a wider plot draws finer columns for the same range, a narrower one coarser", () => {
        const year = [at("2026-01-01"), at("2027-01-01")] as const;
        expect(pick(year, 1330)).toBe("week");
        expect(pick(year, 1200)).toBe("month");
        expect(pick(year, 280)).toBe("quarter");
        expect(pick(days(14), 1000)).toBe("day");
        expect(pick(days(14), 300)).toBe("week");
    });

    test("a column is counted in whole pixels, as a day's room is laid out: thirteen weeks on 322, a fraction under the floor each, are weeks", () => {
        expect(322 / 13).toBeLessThan(WIDTHS.floor);
        expect(pick(days(13 * 7), 322)).toBe("week");
        expect(pick(days(13 * 7), 318)).toBe("month");
    });

    test("never finer than the finest offered, and past the coarsest's floor the coarsest, drawn narrower", () => {
        // An afternoon is one wide day where hours are not offered, and hours where they are.
        const afternoon = [MON + 12 * 3_600_000, MON + 18 * 3_600_000] as const;
        expect(pick(afternoon, 1000)).toBe("day");
        expect(pick(afternoon, 1000, ["hour", ...CALENDAR])).toBe("hour");
        expect(pick([at("1900-01-01"), at("2100-01-01")], 1000)).toBe("year");
        expect(pick([at("2026-01-01"), at("2027-01-01")], 1000, ["day", "week"])).toBe("week");
        expect(pick(days(41), 1000, ["day"])).toBe("day");
    });

    test("only the periods offered, in whatever order they are named, and none where none is offered", () => {
        expect(pick(days(41), 1000, ["year", "month", "day"])).toBe("month");
        expect(finestFirst(["year", "day", "week", "day"])).toEqual(["day", "week", "year"]);
        expect(pick(days(41), 1000, [])).toBeUndefined();
    });
});

describe("the period a canvas keeps as its plot's width alone changes (#1740)", () => {
    const keep = (period: TimeResolution, window: readonly [number, number], plot: number) =>
        squeezedPeriod(period, window[0], window[1], plot, CALENDAR, WIDTHS);

    test("a pane opened or a browser resized squeezes or widens the columns and keeps the period", () => {
        // Forty days picked days on a thousand; a pane halves the plot and they stay days, a column under the floor.
        expect(keep("day", days(40), 500)).toBe("day");
        expect(keep("day", days(40), 2400)).toBe("day");
        // A year in months stays months on a plot that would pick weeks.
        expect(keep("month", [at("2026-01-01"), at("2027-01-01")], 2000)).toBe("month");
    });

    test("where its columns would fall under the squeeze floor, the period is the one the range takes on the plot as it is", () => {
        expect(keep("day", days(40), 400)).toBe("day");
        expect(keep("day", days(40), 370)).toBe("week");
        expect(keep("day", days(40), 120)).toBe("month");
    });
});

describe("the window a period's preset sets (#1740)", () => {
    const preset = (start: number, period: TimeResolution, plot: number) => presetWindow(start, period, plot, WIDTHS);
    const columns = (period: TimeResolution, window: readonly [number, number]) => periodColumns(period, window[0], window[1]);

    test("from the window's start, as many of the period as the plot holds at the preset width", () => {
        expect(preset(MON, "week", 1000)).toEqual([MON, MON + 20 * 7 * DAY]);
        expect(preset(MON, "day", 1000)).toEqual([MON, MON + 20 * DAY]);
        expect(preset(at("2026-01-01"), "month", 1000)).toEqual([at("2026-01-01"), at("2027-09-01")]);
        expect(preset(at("2026-01-01"), "quarter", 1000)).toEqual([at("2026-01-01"), at("2031-01-01")]);
        expect(preset(at("2026-01-01"), "year", 1000)).toEqual([at("2026-01-01"), at("2046-01-01")]);
    });

    test("the start never moves; the end is a period's edge, counting the period the start falls in", () => {
        const wed = MON + 2 * DAY;
        const window = preset(wed, "week", 1000);
        expect(window).toEqual([wed, MON + 20 * 7 * DAY]);
        expect(columns("week", window)).toBe(20);
        expect(preset(at("2026-02-17"), "month", 500)).toEqual([at("2026-02-17"), at("2026-12-01")]);
    });

    test("never fewer than a week of days, four weeks, three months, four quarters or two years where those hold the floor", () => {
        expect(PRESET_LEAST).toEqual({ hour: 1, day: 7, week: 4, month: 3, quarter: 4, year: 2 });
        // A plot of two hundred holds four columns at the preset width: a week of days still holds the floor.
        expect(columns("day", preset(MON, "day", 200))).toBe(7);
        expect(columns("week", preset(MON, "week", 150))).toBe(4);
        expect(columns("year", preset(at("2026-01-01"), "year", 60))).toBe(2);
        // A week of days under the floor: as many as the plot holds at the preset width, and at least one.
        expect(columns("day", preset(MON, "day", 160))).toBe(3);
        expect(columns("day", preset(MON, "day", 40))).toBe(1);
        expect(columns("hour", preset(MON, "hour", 1000))).toBe(20);
    });

    test("the period the range then takes is the one pressed", () => {
        for (const plot of [120, 322, 480, 1000, 1330, 2400]) {
            for (const period of CALENDAR) {
                for (const start of [MON, MON + 2 * DAY, at("2026-02-17"), at("2027-12-31")]) {
                    const window = preset(start, period, plot);
                    expect([plot, start, pick(window, plot)]).toEqual([plot, start, period]);
                }
            }
        }
    });
});

describe("the window a zoom to a table cell's period sets (#1438, #1740)", () => {
    const around = (middle: number, period: TimeResolution, plot: number, within?: readonly [number, number]) =>
        presetAround(middle, period, plot, WIDTHS, within);

    test("as many of the period as its preset shows, about the middle the cell names", () => {
        // A Wednesday: twenty weeks on a plot of a thousand, ten either side of its week's Monday.
        expect(around(at("2026-01-14"), "week", 1000)).toEqual([at("2025-11-03"), at("2026-03-23")]);
        expect(around(at("2026-01-14"), "day", 1000)).toEqual([at("2026-01-04"), at("2026-01-24")]);
        // Two years about November are that year and the next; about March, the year before and that one.
        expect(around(at("2026-11-15"), "year", 60)).toEqual([at("2026-01-01"), at("2028-01-01")]);
        expect(around(at("2026-03-15"), "year", 60)).toEqual([at("2025-01-01"), at("2027-01-01")]);
    });

    test("it keeps inside the time given, and is the whole of it where the periods do not fit", () => {
        const span = [at("2022-01-01"), at("2032-04-01")] as const;
        expect(around(at("2026-01-14"), "week", 1000, span)).toEqual([at("2025-11-03"), at("2026-03-23")]);
        // Near its start and its end the window stops at the span's own weeks.
        expect(around(at("2022-01-10"), "week", 1000, span)).toEqual([at("2021-12-27"), at("2022-05-16")]);
        expect(around(at("2032-03-20"), "week", 1000, span)).toEqual([at("2031-11-17"), at("2032-04-05")]);
        expect(around(at("2026-01-14"), "week", 1000, [at("2026-01-05"), at("2026-02-02")])).toEqual([at("2026-01-05"), at("2026-02-02")]);
    });

    test("the period the range then takes is the one zoomed to, so the cell asked for takes the focus", () => {
        for (const plot of [322, 480, 1000, 2400]) {
            for (const period of CALENDAR) {
                const window = around(at("2026-06-17"), period, plot, [at("1900-01-01"), at("2200-01-01")]);
                expect([plot, pick(window, plot)]).toEqual([plot, period]);
                // A zoom goes to the finest period offered: so it is over a span too short for its preset, shown whole.
                const short = around(at("2026-06-17"), period, plot, [at("2026-06-01"), at("2026-06-20")]);
                expect([plot, pick(short, plot, CALENDAR.slice(CALENDAR.indexOf(period)))]).toEqual([plot, period]);
            }
        }
    });
});

describe("the range a brush's resize, or a range drawn anew, sets (#1740)", () => {
    const brush = (from: number, to: number, held: HeldEnd, plot = 1000, offered = CALENDAR) =>
        brushedRange(from, to, held, plot, offered, WIDTHS.floor);

    test("the end under the hand goes to the nearest edge of the period the range takes; the end held stays", () => {
        // Days while they hold the floor.
        expect(brush(MON, MON + 9.4 * DAY, "start")).toEqual([MON, MON + 9 * DAY]);
        expect(brush(MON + 3.3 * DAY, MON + 14 * DAY, "end")).toEqual([MON + 3 * DAY, MON + 14 * DAY]);
        // Past forty days on a plot of a thousand the columns are weeks, and so are the edges.
        expect(brush(MON, MON + 60.2 * DAY, "start")).toEqual([MON, MON + 63 * DAY]);
        expect(brush(MON - 60.2 * DAY, MON, "end")).toEqual([MON - 63 * DAY, MON]);
        // No period's least or most stops it: a day, or four years, of a window that showed six weeks.
        expect(brush(MON, MON + 0.6 * DAY, "start")).toEqual([MON, MON + DAY]);
        expect(brush(at("2026-01-01"), at("2030-02-10"), "start")).toEqual([at("2026-01-01"), at("2030-01-01")]);
    });

    test("an end held on a finer period's edge gives outward to the edge of the period the range takes, as a scale draws it", () => {
        const wed = MON + 2 * DAY;
        expect(brush(wed, wed + 100 * DAY, "start")).toEqual([MON, MON + 105 * DAY]);
        expect(brush(wed - 100 * DAY, wed, "end")).toEqual([MON - 98 * DAY, MON + 7 * DAY]);
    });

    test("always one period at the least: a range of no length is one of the finest", () => {
        expect(brush(MON, MON + 0.2 * DAY, "start")).toEqual([MON, MON + DAY]);
        expect(brush(MON + 0.9 * DAY, MON + DAY, "end")).toEqual([MON, MON + DAY]);
        expect(brush(MON, MON, "start")).toEqual([MON, MON + DAY]);
        expect(brush(MON + DAY, MON + DAY, "end")).toEqual([MON, MON + DAY]);
    });

    test("just past the most weeks hold, the nearest month's edge would leave weeks: the end goes to the month's edge beyond", () => {
        // Forty-one weeks and a bit from the first of January: months. Nine of them are thirty-nine weeks, which draw as weeks.
        const from = at("2026-01-01");
        const to = from + 41.3 * 7 * DAY;
        expect(pick([from, to], 1000)).toBe("month");
        expect(pick([from, at("2026-10-01")], 1000)).toBe("week");
        expect(brush(from, to, "start")).toEqual([from, at("2026-11-01")]);
    });

    test("the range a gesture shows is the one its release keeps: whole columns of the period it takes", () => {
        for (const plot of [322, 1000, 2400]) {
            for (const span of [0, 0.2, 1.4, 9.4, 13.2, 40.5, 41.3, 60.2, 200.7, 289.1, 800.3, 4000.1, 20_000.5]) {
                for (const held of ["start", "end"] as const) {
                    const [from, to] = held === "start" ? [MON + 2 * DAY, MON + (2 + span) * DAY] : [MON + (16 - span) * DAY, MON + 16 * DAY];
                    const range = brush(from, to, held, plot)!;
                    const scale = timeScale({ window: { min: new Date(range[0]), max: new Date(range[1]) }, resolution: pick(range, plot)! })!;
                    expect([plot, span, held, scale.window.min.getTime(), scale.window.max.getTime()]).toEqual([plot, span, held, range[0], range[1]]);
                }
            }
        }
    });

    test("it stops at as many of the coarsest offered as a scale draws, and is none where no period is offered", () => {
        const weeks = 7 * DAY;
        expect(brush(MON, MON + 600 * weeks, "start", 1000, ["day", "week"])).toEqual([MON, MON + MAX_BUCKETS * weeks]);
        expect(brush(MON - 600 * weeks, MON, "end", 1000, ["day", "week"])).toEqual([MON - MAX_BUCKETS * weeks, MON]);
        expect(brush(MON, MON + DAY, "start", 1000, [])).toBeUndefined();
    });
});
