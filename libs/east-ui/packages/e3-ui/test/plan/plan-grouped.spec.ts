/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The grouped records (#1710), as their seeds make them: the halls, each
 * holding its presses and each press its tasks, and the four records of
 * events on them, each event a row of its own — the sizes each is declared
 * at, and each event's hall the hall its press stands in, which its series
 * index in time order files it by. And the Plan over them: it builds, reads
 * its rows a page at a time and its events a cell at a time — never whole —
 * and writes through each record's patch door. What it draws and reads, on
 * e3, is e3-ui-components' (`plan/frame/plan-grouped-examples`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DictType, East, StringType, decodeBeast2For, encodeBeast2For, equalFor, type EastIR, type ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./plan-grouped.examples.js";

type Halls = ValueTypeOf<typeof ex.SeriesHalls>;

/** Each event's press stands in its hall, and a job's task is one of its press's. */
function assertPlaced(halls: Halls, events: ReadonlyMap<string, { hall: string; press: string; task?: string }>, what: string): void {
    for (const [key, event] of events) {
        const press = halls.get(event.hall)?.presses.get(event.press);
        assert.ok(press !== undefined, `${what} ${key}: its press stands in its hall`);
        if (event.task !== undefined) assert.ok(press.tasks.has(event.task), `${what} ${key}: its task is one of its press's`);
    }
}

describe("the grouped records (#1710)", () => {
    test("eight halls of four sizes in turn, 576 presses, each with its three tasks: the record starts with them", () => {
        const halls = East.compile(ex.generateSeriesHalls, [])(8n);
        assert.deepEqual([...halls.keys()], ["H-101", "H-102", "H-103", "H-104", "H-105", "H-106", "H-107", "H-108"]);
        assert.deepEqual([...halls.values()].map((hall) => hall.presses.size), [24, 144, 72, 48, 24, 144, 72, 48]);
        // A press is keyed by its hall and its number: the first and the last of the second hall.
        const second = [...halls.get("H-102")!.presses.keys()];
        assert.deepEqual([second[0], second[second.length - 1]], ["P-102-1001", "P-102-1144"]);
        for (const hall of halls.values()) {
            for (const press of hall.presses.values()) assert.deepEqual([...press.tasks.keys()], ["T1", "T2", "T3"]);
        }
        assert.ok(equalFor(ex.SeriesHalls)(ex.planSeriesHalls.default!, halls));
        // The places events are generated over are the halls' presses, in their order.
        assert.deepEqual(East.compile(ex.generateSeriesPlaces, [])(8n).map((place) => place.press),
            [...halls.values()].flatMap((hall) => [...hall.presses.keys()]));
    });

    test("each press's week: three jobs, one on each of its tasks, a delivery and a check, and every third week a service — each event's hall the hall its press stands in: the records start with them", () => {
        const halls = East.compile(ex.generateSeriesHalls, [])(8n);
        const weeks = East.compile(ex.generateSeriesWeeks, [])(8n, 6n);
        assert.deepEqual([weeks.jobs.size, weeks.deliveries.size, weeks.checks.size, weeks.services.size], [576 * 6 * 3, 576 * 6, 576 * 6, 576 * 2]);
        assertPlaced(halls, weeks.jobs, "job");
        assertPlaced(halls, weeks.services, "service");
        assertPlaced(halls, weeks.deliveries, "delivery");
        assertPlaced(halls, weeks.checks, "check");
        assert.ok(equalFor(DictType(StringType, ex.SeriesJob))(ex.planSeriesJobs.default!, weeks.jobs));
        assert.ok(equalFor(DictType(StringType, ex.SeriesService))(ex.planSeriesServices.default!, weeks.services));
        assert.ok(equalFor(DictType(StringType, ex.SeriesDelivery))(ex.planSeriesDeliveries.default!, weeks.deliveries));
        assert.ok(equalFor(DictType(StringType, ex.SeriesCheck))(ex.planSeriesChecks.default!, weeks.checks));
    });
});

describe("the Plan over them (#1710)", () => {
    test(ex.planSeriesAll.description, () => {
        const manifest = deriveManifest(ex.planSeriesAll.fn);
        // Its halls are read a page at a time and its events a cell at a time, never whole, and it writes through each record's patch door.
        assert.deepEqual(manifest.pages, [ex.planSeriesJobs.path, ex.planSeriesServices.path, ex.planSeriesDeliveries.path, ex.planSeriesChecks.path, ex.planSeriesHalls.path]);
        assert.equal(manifest.paths.length, 0, "the Plan never reads the halls or any events whole");
        assert.deepEqual(manifest.records, [ex.planSeriesJobs.name, ex.planSeriesServices.name, ex.planSeriesDeliveries.name, ex.planSeriesChecks.name]);
        const component = (ex.planSeriesAll.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
        assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component)).type, component.type);
    });
});
