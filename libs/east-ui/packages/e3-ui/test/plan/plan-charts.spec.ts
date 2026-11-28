/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan's chart rows, each styled its own way (#1753): the readings — ten
 * weeks a row, each week holding every series its chart reads, a gap a `NaN` —
 * and the Plan over them, which reads them whole and builds. What it draws,
 * measured in the page, is the showcase's (`plan-charts`). And the right axis's
 * rail (#1750): the Plan's own switch, which its root carries, off unless it is
 * turned on. And a line or an area that keeps every point (`fold: "none"`):
 * what its layer carries, over a row's values and over a Chart layer alike,
 * and the column, one bar a bucket, that refuses it.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, printFor,
    type EastIR,
} from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Chart } from "@elaraai/east-ui/internal";
import { Plan, deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./plan-charts.examples.js";
import { rowsOf } from "./plan-rows.fixtures.js";

const printWeek = printFor(DateTimeType);

/** The series each row's chart reads, by the row's key. */
const READS: Record<string, string[]> = {
    "output": ["Printed", "Forecast", "Low", "High"],
    "halls": ["Hall 1", "Hall 2", "Hall 3", "Plan"],
    "jobs": ["Planned", "Done"],
    "press-hours": ["Press A", "Press B", "Press C"],
    "climate": ["Load", "Temp"],
    "quality": ["Sheets", "On-time"],
    "audits": ["Audit", "Average"],
    "defects": ["Press A", "Press B"],
    "strokes": ["Default", "Thick", "Dashed", "Dotted", "Faint"],
    "curves": ["Linear", "Smooth", "Natural", "Step"],
    "presses": ["Press A", "Press B", "Press C", "Press D", "Press E", "Press F"],
    "on-time": ["On-time"],
    "printed": ["Printed"],
};

describe("a Plan's chart rows, each styled its own way (#1753)", () => {
    test("the readings: ten weeks a row from W23, each at the middle of its week, each week holding every series its chart reads", () => {
        const source = ex.planChartMeasures.source;
        if (source?.type !== "value") throw new Error("the readings are inline");
        const rows = source.value;
        assert.deepEqual([...rows.keys()].sort(), Object.keys(READS).sort());
        for (const [key, row] of rows) {
            const weeks = [...row.weeks.keys()].map((week) => printWeek(week));
            assert.equal(weeks.length, 10, key);
            assert.equal(weeks[0], printWeek(new Date("2026-06-04T12:00:00Z")), key);
            assert.equal(weeks[9], printWeek(new Date("2026-08-06T12:00:00Z")), key);
            for (const values of row.weeks.values()) assert.deepEqual([...values.keys()].sort(), [...READS[key]!].sort(), key);
        }
    });

    test("a sparse row's gaps: the audits break where a week held none, and what was printed and done stops at now", () => {
        const source = ex.planChartMeasures.source;
        if (source?.type !== "value") throw new Error("the readings are inline");
        const read = (row: string, series: string) => [...source.value.get(row)!.weeks.values()].map((week) => Number.isNaN(week.get(series)!));
        assert.deepEqual(read("audits", "Audit"), [false, true, false, false, true, false, true, false, false, true]);
        assert.deepEqual(read("output", "Printed"), [false, false, false, false, false, false, true, true, true, true]);
        assert.deepEqual(read("jobs", "Done"), [false, false, false, false, false, false, true, true, true, true]);
    });

    test(ex.planCharts.description, () => {
        const manifest = deriveManifest(ex.planCharts.fn);
        // The readings, read whole.
        assert.deepEqual(manifest.paths, [ex.planChartMeasures.path]);
        assert.deepEqual(manifest.pages, []);
        const component = (ex.planCharts.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
        assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component)).type, component.type);
    });

    test("the right axis's rail is the Plan's own switch (#1750): its root carries it on where the Plan turns it on, and off where the Plan leaves it out", () => {
        const Row = StructType({ id: StringType });
        const railed = East.compile(East.function([], Plan.Types.Root, ($) => {
            const data = $.const(new Map(), DictType(StringType, Row));
            return Plan.Root({
                axis: Plan.axis({ window: { min: new Date("2026-06-01T00:00:00Z"), max: new Date("2026-08-10T00:00:00Z") }, resolution: "week" }),
                data,
                series: [],
                rightAxis: true,
            });
        }), [])();
        const bare = East.compile(East.function([], Plan.Types.Root, ($) => {
            const data = $.const(new Map(), DictType(StringType, Row));
            return Plan.Root({
                axis: Plan.axis({ window: { min: new Date("2026-06-01T00:00:00Z"), max: new Date("2026-08-10T00:00:00Z") }, resolution: "week" }),
                data,
                series: [],
            });
        }), [])();
        assert.deepEqual([railed.rightAxis, bare.rightAxis], [true, false]);
    });
});

describe("a line or an area that keeps every point (fold: \"none\", #1807)", () => {
    test(ex.planChartReadings.description, () => {
        const manifest = deriveManifest(ex.planChartReadings.fn);
        // The room's readings, read whole.
        assert.deepEqual(manifest.paths, [ex.planRoomReadings.path]);
        assert.deepEqual(manifest.pages, []);
        const component = (ex.planChartReadings.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
        assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component)).type, component.type);
    });

    /** Readings many times a step: two in the step from 2, one in the step from 4. */
    const Meter = StructType({ name: StringType, readings: DictType(FloatType, FloatType) });
    const Meters = DictType(StringType, Meter);
    const READINGS = new SortedMap([[2.1, 35], [2.4, 30], [4.9, 24]], compareFor(FloatType));
    /** Each data layer's fold, by its tag, in layer order. */
    const foldsOf = (row: ReturnType<typeof rowsOf>[number]) => {
        if (row.kind.type !== "chart") throw new Error(`expected a chart row, got ${row.kind.type}`);
        return row.kind.value.layers.map((layer) => (layer.type === "line" || layer.type === "area" || layer.type === "column" ? layer.value.fold.type : layer.type));
    };

    test("over a row's values: its layer carries `none` and every point as read, where the line and the column beside it fold by their mean and their sum", () => {
        const root = East.function([], Plan.Types.Root, ($) => {
            const data = $.const(new Map([["m1", { name: "Meter 1", readings: READINGS }]]), Meters);
            return Plan.Root({
                axis: Plan.axis.number({ window: { min: 0, max: 8 }, step: 1 }),
                data,
                series: [Plan.series.chart(Meter, {
                    key: "levels", title: "Levels", label: (row) => row.name,
                    layers: [
                        Plan.line(Plan.values("readings", (v) => ({ y: v })), { fold: "none", curve: "stepAfter" }),
                        Plan.area(Plan.values("readings", (v) => ({ y: v })), { fold: "none" }),
                        Plan.line(Plan.values("readings", (v) => ({ y: v }))),
                        Plan.column(Plan.values("readings", (v) => ({ y: v }))),
                    ],
                })],
            });
        }).toIR().compile([])();
        const [row] = rowsOf(root);
        assert.deepEqual(foldsOf(row!), ["none", "none", "mean", "sum"]);
        if (row!.kind.type !== "chart" || row!.kind.value.layers[0]!.type !== "line") return assert.fail("a line first");
        assert.deepEqual(row!.kind.value.layers[0]!.value.points.map((p) => p.y), [35, 30, 24]);
    });

    test("over a Chart layer, wrapped in Plan.layer, as over a row's values", () => {
        const Point = StructType({ at: FloatType, y: FloatType });
        const rows = East.function([], ArrayType(Plan.Types.Row), ($) => {
            const points = $.const([{ at: 2.1, y: 35 }, { at: 2.4, y: 30 }], ArrayType(Point));
            return Plan.chart({
                key: "c", label: "C",
                layers: [
                    Plan.layer(Chart.Line(points, { x: (p) => p.at, y: (p) => p.y }), { fold: "none" }),
                    Plan.layer(Chart.Area(points, { x: (p) => p.at, y: (p) => p.y }), { fold: "none" }),
                    Chart.Line(points, { x: (p) => p.at, y: (p) => p.y }),
                ],
            });
        }).toIR().compile([])();
        assert.deepEqual(foldsOf(rows[0]!), ["none", "none", "mean"]);
    });

    test("a column, one bar a bucket, refuses it — over a row's values and over a Chart layer — naming what keeps every point", () => {
        assert.throws(() => Plan.series.chart(Meter, {
            key: "levels", title: "Levels", label: (row) => row.name,
            layers: [Plan.column(Plan.values("readings", (v) => ({ y: v })), { fold: "none" })],
        }), /^Error: Plan\.chart: a column draws one bar a bucket, so it folds the points in it — `fold: "none"` keeps every point of a line or an area$/);
        const Point = StructType({ at: FloatType, y: FloatType });
        assert.throws(() => East.function([], ArrayType(Plan.Types.Row), ($) => {
            const points = $.const([{ at: 2.1, y: 35 }], ArrayType(Point));
            return Plan.chart({ key: "c", label: "C", layers: [Plan.layer(Chart.Column(points, { x: (p) => p.at, y: (p) => p.y }), { fold: "none" })] });
        }), /a column draws one bar a bucket/);
    });
});
