/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure `sliceSeries` coverage (#170) — the chart-series pivot the
 * `slice_series` primitive delegates to, tested directly from
 * `@elaraai/east-ui/internal` with plain decoded values. Group-key/roll-up
 * parity with `sliceBreakdown` is pinned in east-ui's own suite (#162); this
 * file covers the remaining shape contract: the ungrouped series, colour
 * order, the legend whitelist, and the typed x-coordinate arms.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { none, some } from "@elaraai/east";
import { sliceSeries, SLICE_SERIES_PALETTE } from "@elaraai/east-ui/internal";

type EngineState  = Parameters<typeof sliceSeries>[0];
type EngineConfig = Parameters<typeof sliceSeries>[1];

const state = (patch: Partial<EngineState>): EngineState => ({
    range: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
    breakdown: none, search: none, visible: none, selectedIndex: none,
    ...patch,
});
const config: EngineConfig = {
    fields: new Map(),
    rangeFieldId: none,
    searchFieldIds: [],
    breakdownFieldIds: ["region"],
};
const NOW = new Date("2026-06-01T00:00:00Z");

test("no breakdown → ONE ungrouped series labelled by the value field, in palette[0]", () => {
    const rows = [
        { day: "Mon", region: "EU", sessions: 5 },
        { day: "Mon", region: "NA", sessions: 3 },
        { day: "Tue", region: "EU", sessions: 2 },
    ];
    const series = sliceSeries(state({}), config, rows, "day", "sessions", NOW);
    assert.equal(series.length, 1);
    assert.equal(series[0]!.key, "sessions");                 // labelled by valueField (no config label)
    assert.equal(series[0]!.color, SLICE_SERIES_PALETTE[0]);
    // Values aggregate per x in data order.
    assert.deepEqual(series[0]!.points.map(p => p.value), [8, 2]);
});

test("with a breakdown → series ordered by count desc, palette colours by position", () => {
    const rows = [
        { day: "Mon", region: "NA", sessions: 1 },
        { day: "Mon", region: "EU", sessions: 1 },
        { day: "Tue", region: "EU", sessions: 1 },
    ];
    const series = sliceSeries(state({ breakdown: some({ fieldId: "region", limit: none }) }), config, rows, "day", "sessions", NOW);
    assert.deepEqual(series.map(s => s.key), ["EU", "NA"]);   // EU count 2 > NA count 1
    assert.equal(series[0]!.color, SLICE_SERIES_PALETTE[0]);
    assert.equal(series[1]!.color, SLICE_SERIES_PALETTE[1]);
});

test("visible=some(Set) hides exactly the non-listed series (colours keep their positions)", () => {
    const rows = [
        { day: "Mon", region: "EU", sessions: 1 },
        { day: "Mon", region: "EU", sessions: 1 },
        { day: "Mon", region: "NA", sessions: 1 },
    ];
    const series = sliceSeries(state({
        breakdown: some({ fieldId: "region", limit: none }),
        visible: some(new Set(["NA"])),
    }), config, rows, "day", "sessions", NOW);
    assert.equal(series.length, 1);
    assert.equal(series[0]!.key, "NA");
    // NA is the SECOND group by count — it keeps its position colour even
    // though EU is hidden.
    assert.equal(series[0]!.color, SLICE_SERIES_PALETTE[1]);
});

test("a Date x-field → variant('time', Date) coordinates keyed by ISO (aggregation per instant)", () => {
    const d1 = new Date("2026-01-02T00:00:00Z");
    const rows = [
        { when: d1, region: "EU", sessions: 5 },
        { when: new Date(d1), region: "EU", sessions: 3 },    // same instant, distinct Date object
    ];
    const series = sliceSeries(state({}), config, rows, "when", "sessions", NOW);
    assert.equal(series[0]!.points.length, 1);                // aggregated by ISO key, not object identity
    const x = series[0]!.points[0]!.x as { type: string; value: Date };
    assert.equal(x.type, "time");
    assert.equal((x.value as Date).toISOString(), d1.toISOString());
    assert.equal(series[0]!.points[0]!.value, 8);
});

test("an integer x-field → variant('number', …) coordinates", () => {
    const rows = [{ hour: 9n, region: "EU", sessions: 5 }];
    const series = sliceSeries(state({}), config, rows, "hour", "sessions", NOW);
    const x = series[0]!.points[0]!.x as { type: string; value: number };
    assert.equal(x.type, "number");
    assert.equal(x.value, 9);
});
