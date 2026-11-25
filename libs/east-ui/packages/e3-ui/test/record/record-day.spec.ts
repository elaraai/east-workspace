/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record's day (`<Record day>`, east-workspace#1746): the crew's planned
 * hours (`recordPlannedHours`) evaluate, read the crew, the lines and the
 * machines from e3, and declare the one record their Saves commit to; a
 * Record's payload carries the day its page gives, as the page gives it — a
 * value or an expression — and none without it; and the example's read and
 * write keep each machine's hours by its date: an edit sets that date's entry
 * in its place or adds one, a clear takes it out, and no other day's changes.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, DateTimeType, East, FloatType, OptionType, equalFor, none, printFor, some, type ValueTypeOf } from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { pathToString } from "@elaraai/e3-types";
import { Data, Record, RecordPayloadType, deriveManifest } from "@elaraai/e3-ui/internal";
import { refusingPlatform } from "../refusing-platform.js";
import * as ex from "./record-day.examples.js";

describeEast("Record — the page's day", test => {
    Assert.examples(test, {
        recordPlannedHours: ex.recordPlannedHours,
    });
}, { platformFns: TestImpl });

const DayType = RecordPayloadType.fields.day;
const dayEqual = equalFor(DayType);
const printDay = printFor(DayType);
const PlanType = ArrayType(ex.Planned);
const planEqual = equalFor(PlanType);
const printPlan = printFor(PlanType);
const HoursType = OptionType(FloatType);
const hoursEqual = equalFor(HoursType);
const printHours = printFor(HoursType);
const printInstant = printFor(DateTimeType);

/** The Monday the plan is made for, at UTC midnight, as the example's page keeps its days. */
const MONDAY = new Date("2026-11-30T00:00:00Z");
/** The day after it. */
const TUESDAY = new Date("2026-12-01T00:00:00Z");

describe("the Record's day", () => {
    test("its payload carries the day the page gives, as the page gives it — a value, never rounded, or an expression — and none without it", () => {
        // The crew's Record over a window, its names alone: built without reading the record.
        const columns = { name: Record.column.title(ex.Crew, { header: "Name" }) };
        const afternoon = new Date("2026-11-30T15:30:00Z");
        for (const [given, carried] of [
            [MONDAY, MONDAY],
            [afternoon, afternoon],
            [East.DateTime.roundDownDay(East.value(afternoon), 1n), MONDAY],
        ] as const) {
            const payload = East.compile(East.function([], RecordPayloadType, () => Record.Payload({
                record: Record.bind(ex.recordDayCrew), window: Data.bindPaged(ex.recordDayCrew), columns, edits: { insertRows: false }, day: given,
            })), refusingPlatform)();
            assert.ok(dayEqual(payload.day, some(carried)), printDay(payload.day));
        }
        const left = East.compile(East.function([], RecordPayloadType, () => Record.Payload({
            record: Record.bind(ex.recordDayCrew), window: Data.bindPaged(ex.recordDayCrew), columns, edits: { insertRows: false },
        })), refusingPlatform)();
        assert.ok(dayEqual(left.day, none), printDay(left.day));
    });

    test("the example reads its crew, its lines and its machines from e3, and declares the one record its Saves commit to", () => {
        const manifest = deriveManifest(ex.recordPlannedHours.fn);
        assert.deepEqual(manifest.paths.map(pathToString).sort(), [ex.recordDayCrew, ex.recordDayLines, ex.recordDayMachines].map((record) => pathToString(record.path)).sort());
        assert.deepEqual([...new Set(manifest.records)], [ex.recordDayCrew.name]);
    });
});

describe("the example's read and write over a dated plan", () => {
    const hoursOn = East.compile(ex.hoursOn, []);
    const withHours = East.compile(ex.withHours, []);
    const PLAN: ValueTypeOf<typeof PlanType> = [
        { day: MONDAY, machine: "M-10", hours: 6.0 },
        { day: MONDAY, machine: "M-11", hours: 2.0 },
        { day: TUESDAY, machine: "M-10", hours: 8.0 },
    ];

    test("a machine's hours on a day are its entry on that date — whatever time of day the day holds — and none where the plan holds none", () => {
        for (const [machine, day, hours] of [
            ["M-10", MONDAY, some(6.0)],
            ["M-10", new Date("2026-11-30T15:30:00Z"), some(6.0)],
            ["M-10", TUESDAY, some(8.0)],
            ["M-11", TUESDAY, none],
            ["M-20", MONDAY, none],
        ] as const) {
            const read = hoursOn(PLAN, machine, day);
            assert.ok(hoursEqual(read, hours), `${machine} on ${printInstant(day)}: ${printHours(read)}`);
        }
    });

    test("an edit sets the date's entry in its place, or adds one at its date's midnight after the rest; a clear takes it out; no other day's entry changes; and hours set back write the plan as it was", () => {
        const set = withHours(PLAN, "M-10", some(7.0), MONDAY);
        assert.ok(planEqual(set, [{ day: MONDAY, machine: "M-10", hours: 7.0 }, PLAN[1]!, PLAN[2]!]), printPlan(set));
        const added = withHours(PLAN, "M-20", some(3.0), new Date("2026-12-01T09:00:00Z"));
        assert.ok(planEqual(added, [...PLAN, { day: TUESDAY, machine: "M-20", hours: 3.0 }]), printPlan(added));
        const cleared = withHours(PLAN, "M-11", none, MONDAY);
        assert.ok(planEqual(cleared, [PLAN[0]!, PLAN[2]!]), printPlan(cleared));
        const nothing = withHours(PLAN, "M-20", none, MONDAY);
        assert.ok(planEqual(nothing, PLAN), printPlan(nothing));
        const back = withHours(set, "M-10", some(6.0), MONDAY);
        assert.ok(planEqual(back, PLAN), printPlan(back));
    });
});
