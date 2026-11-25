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
 * turned on.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DateTimeType, DictType, East, StringType, StructType, decodeBeast2For, encodeBeast2For, printFor, type EastIR } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Plan, deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./plan-charts.examples.js";

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
