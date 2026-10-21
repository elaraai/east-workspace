/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's payload over the kiln yard's own records on e3 itself
 * (#1372, `Builder Interfaces Spec.md` §6): its tag's East function binds the
 * bins, the days, the bays, the kilns and the loads as the kiln yard's example
 * does, and compiles against the platform a UI task's preview gives it, so what
 * the payload reads is e3's. The lanes, the resources and the arrivals come
 * from their kinds' accessors; the day's bins through the slice's bin source,
 * each one's roles as the kind reads its row, and the record never whole; a
 * bin's roles written over its row leave its own fields as they were (B1); a
 * booking is made with its arrival's values, a reservation with their types'
 * defaults (B13); the days' status, and Publish's row; and the app's columns
 * read a bin's row as bytes.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, East, OptionType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, isTypeEqual, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { Allocation } from "@elaraai/e3-ui";
import { AllocationPayloadType, Data, Func, Record, Schedule, ScheduleAllocationRolesType, createAllocationPayload } from "@elaraai/e3-ui/internal";
import * as ax from "@elaraai/e3-ui/examples/allocation/allocation";
import { StateRuntime, UIStore, createRecordSliceImplementation } from "@elaraai/east-ui-components/platform";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "allocation/allocation": ax });

/** The mock's plan day, Tue 11 May 2027; Tue 4 is published, Wed 12 the day after. */
const TUE = new Date("2027-05-11T00:00:00Z");
const TUE_4 = new Date("2027-05-04T00:00:00Z");
const WED = new Date("2027-05-12T00:00:00Z");
const byString = compareFor(StringType);
const Bin = ax.kilnBins.type.value;
const encodeBin = encodeBeast2For(Bin);
const decodeBin = decodeBeast2For(Bin);
const binEqual = equalFor(Bin);
const rolesEqual = equalFor(ScheduleAllocationRolesType);
const statusEqual = equalFor(Allocation.Types.Status);
type Payload = ValueTypeOf<typeof AllocationPayloadType>;

/** The kiln yard's payload, the tag over its records as the kiln yard's example binds them. */
const program = East.function([], AllocationPayloadType, ($) => {
    const bins = $.let(Record.bind(ax.kilnBins, [ax.kilnBinsPatch]));
    const entries = $.let(Data.bindPaged(ax.kilnBins));
    const byTime = $.let(Data.bindPaged(ax.kilnBins, { indexes: [ax.kilnBinsByTime] }));
    const days = $.let(Record.bind(ax.yardDays, [ax.yardDaysPatch]));
    const yard = $.let(Data.bind(ax.kilns));
    const loads = $.let(Data.bind(ax.arrivals));
    const bays = $.let(Data.bind(ax.yardBays));
    const fit = $.let(Func.bind(ax.yardFit));
    const slice = $.let(Slice.bindRecords("spec.allocationPayload", { bin: { source: byTime, range: "at" } }));
    return createAllocationPayload({
        id: "spec", fit, slice: { slice }, inspector: true, library: [Allocation.library.arrivals(), Allocation.library.resources()],
        events: { bin: Schedule.events(bins, {
            name: "Bin", icon: "box", entries,
            at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
            quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
        }) },
        resources: {
            bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: (b) => b.name, offset: (b) => b.offset }),
            kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: (k) => k.name, group: (k) => k.group,
                min: (k) => k.min, max: (k) => k.max, hold: (k) => variant("days", k.days), jobs: (k) => k.charges }),
        },
        arrivals: Allocation.arrivals(loads.read(), {
            label: (l) => l.code, quantity: (l) => l.m3, hold: (l) => variant("days", l.dryingDays), kind: (l) => some(l.spec),
            values: (l) => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
        }),
        periods: Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" } }),
        columns: [{ key: "spec", label: "Spec", text: (b) => East.equal(b.specBooked, b.specMeasured).ifElse(() => b.specMeasured, () => East.str`booked ${b.specBooked} · measured ${b.specMeasured}`) }],
    });
});

/** The payload, built over e3 as a UI task's preview builds it, its slice made on the record Slice's platform over e3's pages. */
async function built(): Promise<Payload> {
    const { platform } = await h.platform(program);
    StateRuntime.initializeStore(new UIStore());
    const implementations = [...platform];
    implementations.push(...createRecordSliceImplementation(() => implementations));
    return East.compile(program, implementations)();
}

describe("the Allocation's payload over the kiln yard's records", () => {
    test("builds the lanes, the resources and the arrivals from their kinds' accessors, and the bin kind over the yard's own rows", async () => {
        const value = await built();
        assert.ok(equalFor(ArrayType(Allocation.Types.Lane))(value.lanes, [
            { key: "B-1", label: "B-1", offset: variant("minutes", 15) },
            { key: "B-2", label: "B-2", offset: variant("minutes", 35) },
            { key: "B-3", label: "B-3", offset: variant("minutes", 55) },
        ]), "a lane per bay, at its offset past the hour");
        assert.equal(value.resources.length, 33);
        const k209 = value.resources.find((resource) => resource.key === "K-209")!;
        assert.ok(equalFor(Allocation.Types.Resource)(k209, {
            key: "K-209", label: "K-209", group: some("Hall B"), meta: none, note: none, min: 20, max: 40, hold: variant("days", 7),
            jobs: [{ label: "planned", start: new Date("2027-05-19T00:00:00Z"), end: new Date("2027-05-27T00:00:00Z") }],
        }), "K-209, its every accessor");
        assert.equal(value.arrivals.length, 27);
        const ld2231 = value.arrivals.find((arrival) => arrival.key === "LD-2231")!;
        assert.ok(equalFor(Allocation.Types.Arrival)(ld2231, {
            key: "LD-2231", label: "LD-2231", meta: none, quantity: 21, hold: variant("days", 8), kind: some("MC12"), due: none, window: none, details: [],
        }));
        assert.ok(isTypeEqual(fromEastTypeValue(value.bin.rowType), Bin), "the bin kind's rows are the yard's own");
        assert.deepEqual([value.bin.lanes, value.bin.parts, value.bin.kinded, value.fit.name, value.inspector], ["bays", "kilns", true, "yard_fit", true]);
        assert.ok(equalFor(OptionType(StringType))(value.bin.unit, some("m³")), "the quantity's unit, its role's");
    });

    test("reads the day's bins through the slice's bin source — Tue 11's 26, each its roles as the kind reads its row — and the record never whole", async () => {
        const value = await built();
        const rows = await h.ready(() => value.bin.rows(TUE, WED));
        assert.equal(rows.size, 26);
        const stored = await h.read(ax.kilnBins);
        for (const [key, entry] of rows) {
            assert.ok(binEqual(decodeBin(entry.row), stored.get(key)!), `${key}: its row as the record holds it`);
            assert.ok(rolesEqual(value.bin.read(entry.row), entry.roles), `${key}: its roles, as the kind reads them from its row`);
        }
        assert.ok(rolesEqual(rows.get("3101")!.roles, {
            at: new Date("2027-05-11T01:55:00Z"), lane: "B-3", arrival: some("LD-2201"), quantity: 35,
            parts: new SortedMap([["K-209", 35]], byString), hold: variant("days", 7), kind: some("MC14"),
        }), "its bay its lane, its load its arrival, its m³, its kilns its parts, how long it dries its hold, its spec its kind");
        assert.equal(h.requests("read", "records.kiln_bins").length, 0, "the bins are never read whole");
        // Its session is over the record's revision, with no snapshot of the record.
        assert.equal(value.bin.kind.editing.snapshot.type, "none");
    });

    test("a bin's roles written over its row leave its own fields as they were (B1)", async () => {
        const value = await built();
        const stored = (await h.read(ax.kilnBins)).get("3113")!;
        const bytes = encodeBin(stored);
        const at = new Date("2027-05-11T00:15:00Z");
        const moved = decodeBin(value.bin.write(bytes, { ...value.bin.read(bytes), lane: "B-1", at, parts: new SortedMap([], byString) }));
        assert.ok(binEqual(moved, { ...stored, bay: "B-1", at, kilns: new SortedMap([], byString) }),
            "its bay, its time and its kilns written; its spec, its grades and its instruction its own");
        assert.ok(binEqual(decodeBin(value.bin.write(encodeBin(moved), value.bin.read(bytes))), stored), "and back");
    });

    test("a booking is made with its arrival's values, a reservation with their types' defaults (B13)", async () => {
        const value = await built();
        const initial = value.initial("LD-2231");
        if (initial.type !== "some") assert.fail("expected LD-2231's values");
        const Values = fromEastTypeValue(value.bin.values);
        assert.ok(equalFor(Values)(decodeBeast2For(Values)(initial.value), {
            specBooked: "MC12", specMeasured: "MC12", gradeBooked: "R", gradeMeasured: "R2", instruction: some("Sticker every 600 mm before loading"),
        }), "LD-2231's values, its grade booked by its letter");
        const at = new Date("2027-05-11T00:15:00Z");
        const booked = decodeBin(value.bin.create({
            at, lane: "B-1", arrival: some("LD-2231"), quantity: 21, parts: new SortedMap([["K-601", 21]], byString), hold: variant("days", 8), kind: some("MC12"),
        }, initial));
        assert.ok(binEqual(booked, {
            bay: "B-1", at, load: some("LD-2231"), m3: 21, spec: some("MC12"), dryFor: variant("days", 8), kilns: new SortedMap([["K-601", 21]], byString),
            specBooked: "MC12", specMeasured: "MC12", gradeBooked: "R", gradeMeasured: "R2", instruction: some("Sticker every 600 mm before loading"),
        }), "its roles, and its arrival's values");
        const reserved = decodeBin(value.bin.create({
            at, lane: "B-2", arrival: none, quantity: 0, parts: new SortedMap([["K-305", 0]], byString), hold: variant("days", 0), kind: none,
        }, none));
        assert.ok(binEqual(reserved, {
            bay: "B-2", at, load: none, m3: 0, spec: none, dryFor: variant("days", 0), kilns: new SortedMap([["K-305", 0]], byString),
            specBooked: "", specMeasured: "", gradeBooked: "", gradeMeasured: "", instruction: none,
        }), "a reservation: no load, its other fields their types' defaults");
    });

    test("the days: Tue 11 a draft, Tue 4 issued and when; Publish's row the issued case at the time given", async () => {
        const value = await built();
        if (value.periods.type !== "some") assert.fail("expected the periods");
        const periods = value.periods.value;
        const rows = await h.ready(() => periods.rows(TUE_4, WED));
        assert.equal(rows.size, 2, "Tue 4 and Tue 11: the days with a row");
        assert.ok(statusEqual(periods.status(rows.get(TUE)!), variant("draft", null)));
        assert.ok(statusEqual(periods.status(rows.get(TUE_4)!), variant("published", { at: some(new Date("2027-05-03T17:40:00Z")) })));
        const Day = fromEastTypeValue(periods.rowType);
        const at = new Date("2027-05-11T18:00:00Z");
        assert.ok(equalFor(Day)(decodeBeast2For(Day)(periods.publish(some(rows.get(TUE)!), at)), { state: variant("issued", { at }) }), "the draft, issued");
        assert.ok(equalFor(Day)(decodeBeast2For(Day)(periods.publish(none, at)), { state: variant("issued", { at }) }), "a day with no row, a new one issued");
    });

    test("the app's columns read a bin's row as bytes", async () => {
        const value = await built();
        const stored = (await h.read(ax.kilnBins)).get("3113")!;
        assert.equal(value.columns[0]!.text(encodeBin(stored)), "booked MC08 · measured MC22");
        assert.equal(value.columns[0]!.text(encodeBin((await h.read(ax.kilnBins)).get("3101")!)), "MC14");
    });
});
