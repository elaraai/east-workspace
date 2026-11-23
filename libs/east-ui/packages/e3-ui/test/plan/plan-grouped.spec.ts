/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The grouped records (#1710), as their seeds make them: the halls, rows
 * beside groups at every level — each hall its folders and its bays beside its
 * lines, each line its guillotine beside its presses, each press its tasks —
 * and the five records of three sparse years of events on them, each event a
 * row of its own: the sizes each is declared at, each event on a row that
 * stands where its fields say — its hall, and its line — which its series
 * index in time order files it by, and every event inside the three years,
 * spread to their end. And the Plan over them: it builds, reads its rows a
 * page at a time and its events a cell at a time — never whole — and writes
 * through each record's patch door. What it draws and reads, on e3, is
 * e3-ui-components' (`plan/frame/plan-grouped-examples`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DateTimeType, DictType, East, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, type EastIR, type ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./plan-grouped.examples.js";

type Halls = ValueTypeOf<typeof ex.SeriesHalls>;

const compareTime = compareFor(DateTimeType);
/** Monday 5 October 2026, where the events' three years start. */
const FIRST = new Date(Date.UTC(2026, 9, 5));
/** 156 weeks on: where they end. */
const PAST = new Date(Date.UTC(2029, 9, 1));
/** Their last quarter's start: each kind has events in it. */
const LAST_QUARTER = new Date(Date.UTC(2029, 6, 1));

/** Every instant inside the three years, and some in their last quarter: the events spread to their end. */
function assertSpread(times: readonly Date[], what: string): void {
    for (const time of times) assert.ok(compareTime(time, FIRST) >= 0 && compareTime(time, PAST) < 0, `${what}: inside the three years`);
    assert.ok(times.some((time) => compareTime(time, LAST_QUARTER) >= 0), `${what}: some in the last quarter`);
}

describe("the grouped records (#1710)", () => {
    test("eight halls of four sizes in turn, rows beside groups: each hall two folders and two bays beside its lines, each line a guillotine beside ten presses, each press its three tasks — the record starts with them", () => {
        const halls = East.compile(ex.generateSeriesHalls, [])(8n);
        assert.deepEqual([...halls.keys()], ["H-101", "H-102", "H-103", "H-104", "H-105", "H-106", "H-107", "H-108"]);
        assert.deepEqual([...halls.values()].map((hall) => hall.lines.size), [1, 4, 2, 3, 1, 4, 2, 3]);
        for (const hall of halls.values()) {
            assert.deepEqual([hall.folders.size, hall.bays.size], [2, 2]);
            for (const line of hall.lines.values()) {
                assert.deepEqual([line.guillotines.size, line.presses.size], [1, 10]);
                for (const press of line.presses.values()) assert.deepEqual([...press.tasks.keys()], ["T1", "T2", "T3"]);
            }
        }
        // Each row keyed by its hall and its number: the second hall's folders, bays and lines, and its last line's
        // guillotine and first and last press — the presses numbered on through the hall's lines.
        const second = halls.get("H-102")!;
        assert.deepEqual([[...second.folders.keys()], [...second.bays.keys()]], [["F-102-1", "F-102-2"], ["B-102-1", "B-102-2"]]);
        assert.deepEqual([...second.lines.keys()], ["L-102-1", "L-102-2", "L-102-3", "L-102-4"]);
        const last = second.lines.get("L-102-4")!;
        const presses = [...last.presses.keys()];
        assert.deepEqual([[...last.guillotines.keys()], presses[0], presses[presses.length - 1]], [["G-102-4"], "P-102-1031", "P-102-1040"]);
        assert.ok(equalFor(ex.SeriesHalls)(ex.planSeriesHalls.default!, halls));
        // The places the print jobs are generated over are the halls' presses, in their order, each with its hall and its line.
        const places = East.compile(ex.generateSeriesPlaces, [])(8n);
        assert.equal(places.length, 200);
        assert.deepEqual(places.map((place) => place.press),
            [...halls.values()].flatMap((hall) => [...hall.lines.values()].flatMap((line) => [...line.presses.keys()])));
    });

    test("three sparse years of events, one kind at each level — each on a row that stands where its fields say, inside the three years and spread to their end: the records start with them", () => {
        const halls: Halls = East.compile(ex.generateSeriesHalls, [])(8n);
        const inspections = East.compile(ex.generateSeriesInspections, [])(8n, 156n);
        const folding = East.compile(ex.generateSeriesFolding, [])(8n, 156n);
        const deliveries = East.compile(ex.generateSeriesDeliveries, [])(8n, 156n);
        const jobs = East.compile(ex.generateSeriesJobs, [])(8n, 156n);
        const trims = East.compile(ex.generateSeriesTrims, [])(8n, 156n);
        // Twelve inspections a hall; 78 runs a folder, deliveries a bay and trims a guillotine; fifteen jobs a press, three bars each.
        assert.deepEqual([inspections.size, folding.size, deliveries.size, jobs.size, trims.size], [8 * 12, 16 * 78, 16 * 78, 200 * 15 * 3, 20 * 78]);
        for (const [key, inspection] of inspections) assert.ok(halls.has(inspection.hall), `inspection ${key}: its hall is a hall`);
        for (const [key, run] of folding) assert.ok(halls.get(run.hall)?.folders.has(run.folder), `run ${key}: its folder stands in its hall`);
        for (const [key, delivery] of deliveries) assert.ok(halls.get(delivery.hall)?.bays.has(delivery.bay), `delivery ${key}: its bay stands in its hall`);
        for (const [key, job] of jobs) {
            const press = halls.get(job.hall)?.lines.get(job.line)?.presses.get(job.press);
            assert.ok(press?.tasks.has(job.task), `job ${key}: its press stands in its line, in its hall, and its task is one of its press's`);
        }
        for (const [key, trim] of trims) assert.ok(halls.get(trim.hall)?.lines.get(trim.line)?.guillotines.has(trim.guillotine), `trim ${key}: its guillotine stands in its line, in its hall`);
        assertSpread([...inspections.values()].flatMap((e) => [e.start, e.end]), "inspections");
        assertSpread([...folding.values()].flatMap((e) => [e.start, e.end]), "folding runs");
        assertSpread([...deliveries.values()].map((e) => e.at), "deliveries");
        assertSpread([...jobs.values()].flatMap((e) => [e.start, e.end]), "jobs");
        assertSpread([...trims.values()].map((e) => e.at), "trims");
        assert.ok(equalFor(DictType(StringType, ex.SeriesInspection))(ex.planSeriesInspections.default!, inspections));
        assert.ok(equalFor(DictType(StringType, ex.SeriesFolding))(ex.planSeriesFolding.default!, folding));
        assert.ok(equalFor(DictType(StringType, ex.SeriesDelivery))(ex.planSeriesDeliveries.default!, deliveries));
        assert.ok(equalFor(DictType(StringType, ex.SeriesJob))(ex.planSeriesJobs.default!, jobs));
        assert.ok(equalFor(DictType(StringType, ex.SeriesTrim))(ex.planSeriesTrims.default!, trims));
    });
});

describe("the Plan over them (#1710)", () => {
    test(ex.planSeriesAll.description, () => {
        const manifest = deriveManifest(ex.planSeriesAll.fn);
        const kinds = [ex.planSeriesInspections, ex.planSeriesFolding, ex.planSeriesDeliveries, ex.planSeriesJobs, ex.planSeriesTrims];
        // Its halls are read a page at a time and its events a cell at a time, never whole, and it writes through each record's patch door.
        assert.deepEqual(manifest.pages, [...kinds.map((kind) => kind.path), ex.planSeriesHalls.path]);
        assert.equal(manifest.paths.length, 0, "the Plan never reads the halls or any events whole");
        assert.deepEqual(manifest.records, kinds.map((kind) => kind.name));
        const component = (ex.planSeriesAll.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
        assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component)).type, component.type);
    });
});
