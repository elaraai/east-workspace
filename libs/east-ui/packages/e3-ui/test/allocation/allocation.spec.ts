/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DictType, East, IntegerType, StringType, StructType, decodeBeast2For, encodeBeast2For, fromEastTypeValue, isTypeEqual, none, some, variant, type EastTypeValue,
} from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { Slice } from "@elaraai/east-ui";
import e3 from "@elaraai/e3";
import { Allocation, type AllocationProps } from "@elaraai/e3-ui";
import { AllocationPayloadType, Data, Func, Record, createAllocationPayload, funcBindPlatformFn } from "@elaraai/e3-ui/internal";
import { memoryRecords } from "../schedule/memory-records.js";
import { Bay, BinValues, TimberLoad, yardArrivals, yardBayRows, yardKilns, yardLanes, yardPlans } from "./kiln-yard.js";
import * as ex from "./allocation.examples.js";

describeEast("Allocation — inline bound examples", test => {
    Assert.examples(test, {
        allocationMinimal: ex.allocationMinimal, allocationKilnYard: ex.allocationKilnYard, allocationTable: ex.allocationTable, allocationLabels: ex.allocationLabels,
        allocationPublished: ex.allocationPublished, allocationNoPublish: ex.allocationNoPublish, allocationSplit: ex.allocationSplit,
        allocationWindowed: ex.allocationWindowed, allocationMobile: ex.allocationMobile, allocationCustomBin: ex.allocationCustomBin,
        allocationFitRule: ex.allocationFitRule,
    });
}, { platformFns: TestImpl });

/** `Func.bind`, in memory: a handle that names its function and is never called here. */
const memoryFunctions: PlatformFunction[] = [funcBindPlatformFn.implement((_handleType: EastTypeValue) => (nameArg: unknown) => ({
    call: () => null, read: () => none, status: () => variant("idle", null), error: () => none, pending: () => false, cancel: () => null,
    binding: { name: nameArg as string },
}))];
const platform = [...memoryRecords(new Map([[ex.kilnPlans.name, yardPlans]])), ...memoryFunctions];

/** The kiln yard's payload, built by the tag over the module's records. */
function payloadWith(overrides: Partial<AllocationProps<typeof BinValues>> = {}) {
    const fn = East.function([], AllocationPayloadType, $ => {
        const days = $.let(Record.bind(ex.kilnPlans, [ex.kilnPlansPatch]));
        const fit = $.let(Func.bind(ex.yardFit));
        const loads = $.const(yardArrivals, DictType(StringType, TimberLoad));
        const yard = $.const(yardKilns, ex.kilns.type);
        return createAllocationPayload({
            days, fit, lanes: yardLanes,
            events: Allocation.events(loads, { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }) }),
            resources: Allocation.resources(yard, { label: k => k.name, min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
            columns: [{ key: "spec", label: "Spec", text: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => v.specMeasured, () => East.str`booked ${v.specBooked} · measured ${v.specMeasured}`) }],
            ...overrides,
        });
    });
    return East.compile(fn, platform)();
}

test("Allocation is one tag: BuilderFrame, Builder and View are not part of its developer API, and its payload holds no UI", () => {
    assert.equal("Builder" in Allocation, false); assert.equal("View" in Allocation, false);
    const value = payloadWith();
    assert.equal("frame" in value, false); assert.equal("children" in value, false);
    assert.equal(value.sourceId, "kiln_plans");
    assert.equal(value.fit.name, "yard_fit");
    assert.ok(isTypeEqual(fromEastTypeValue(value.valuesType), BinValues));
    assert.equal(value.events.length, 27); assert.equal(value.resources.length, 33);
    assert.equal(value.library.length, 0); assert.equal(value.inspector.type, "none"); assert.equal(value.check.type, "none");
    assert.equal(value.settings.title, "Allocation"); assert.equal(value.settings.publish, true); assert.equal(value.settings.layout.type, "timeline");
    assert.ok(value.every.type === "hours" && value.every.value === 1);
    assert.ok(value.settings.horizon.before.type === "days" && value.settings.horizon.before.value === 3);
    assert.ok(value.settings.horizon.after.type === "days" && value.settings.horizon.after.value === 10);
    assert.equal(value.rules.under, true);
});

test("the app's bin values cross as bytes: the plans, an event's starting values and a column's text", () => {
    const value = payloadWith();
    const plans = decodeBeast2For(Allocation.Types.Days(BinValues))(value.read());
    assert.equal(plans.size, 3);
    const day = [...plans.values()][1]!;
    assert.equal(day.bins.size, 26);
    const start = decodeBeast2For(BinValues)(value.initial("LD-2231"));
    assert.deepEqual([start.specBooked, start.gradeBooked, start.gradeMeasured], ["MC12", "R", "R2"]);
    const bin = day.bins.get("3113")!;
    const text = value.columns[0]!.text(encodeBeast2For(BinValues)(bin.values));
    assert.equal(text, "booked MC08 · measured MC22");
});

test("a fit bound over other bin values is refused at build, naming both types", () => {
    const OtherValues = StructType({ grade: StringType });
    const otherFit = e3.function("other_fit", East.function([Allocation.Types.FitRequest(OtherValues)], Allocation.Types.FitResult, ($, req) => {
        const answer = $.const(Allocation.answer(OtherValues));
        const rule = $.const(Allocation.fit);
        return answer(req, rule, "ranked");
    }));
    assert.throws(() => East.function([], AllocationPayloadType, $ => {
        const days = $.let(Record.bind(ex.kilnPlans, [ex.kilnPlansPatch]));
        const fit = $.let(Func.bind(otherFit));
        return createAllocationPayload({
            days, fit: fit as never, lanes: yardLanes, resources: [],
            events: Allocation.events($.const(yardArrivals, DictType(StringType, TimberLoad)), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays),
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade, gradeMeasured: l.grade, instruction: none }) }),
        });
    }), /`fit` is bound over bin values .*grade.*, and `days` holds bin values .*specBooked/);
});

test("the tag refuses empty lanes, a repeated library tab, a repeated column and a check of another type", () => {
    assert.throws(() => payloadWith({ lanes: [] }), /`lanes` must not be empty/);
    assert.throws(() => payloadWith({ library: [Allocation.library.events(), Allocation.library.events()] }), /duplicate library tab events/);
    assert.throws(() => payloadWith({ columns: [
        { key: "spec", label: "Spec", text: v => v.specBooked }, { key: "spec", label: "Again", text: v => v.specMeasured },
    ] }), /duplicate column spec/);
    assert.throws(() => payloadWith({ check: East.function([StringType], ArrayType(Allocation.Types.Issue), () => []) as never }), /`check` is an East function from Allocation.Types.CheckContext/);
});

test("the tag takes its library, inspector and settings as given", () => {
    const value = payloadWith({
        library: [Allocation.library.resources(), Allocation.library.events()], inspector: true, publish: false, title: "Kiln loading",
        view: { layout: "table" }, every: variant("minutes", 30), horizon: { before: variant("days", 1), after: variant("days", 7) }, rules: { under: false },
        quantity: { unit: "m³" }, id: "yard",
    });
    assert.deepEqual(value.library.map(t => t.type), ["resources", "events"]);
    assert.ok(value.inspector.type === "some" && value.inspector.value.bin.type === "none");
    assert.equal(value.settings.publish, false); assert.equal(value.settings.title, "Kiln loading"); assert.equal(value.settings.layout.type, "table");
    assert.ok(value.every.type === "minutes" && value.every.value === 30);
    assert.equal(value.rules.under, false);
    assert.ok(value.quantity.unit.type === "some" && value.quantity.unit.value === "m³");
    assert.ok(value.id.type === "some" && value.id.value === "yard");
});

test("Allocation.lanes reads the app's keyed rows as lanes, in key order, each lane keyed by its row", () => {
    const lanes = East.compile(East.function([], ArrayType(Allocation.Types.Lane), $ => {
        const bays = $.const(yardBayRows, DictType(StringType, Bay));
        return Allocation.lanes(bays, { label: b => East.str`Bay ${b.name}`, offset: b => b.offset });
    }), [])();
    assert.deepEqual(lanes.map(lane => [lane.key, lane.label]), [["B-1", "Bay B-1"], ["B-2", "Bay B-2"], ["B-3", "Bay B-3"]]);
    assert.deepEqual(lanes.map(lane => lane.offset), [variant("minutes", 15), variant("minutes", 35), variant("minutes", 55)]);
    const bare = East.compile(East.function([], ArrayType(Allocation.Types.Lane), $ =>
        Allocation.lanes($.const(yardBayRows, DictType(StringType, Bay)), { label: b => b.name })), [])();
    assert.deepEqual(bare.map(lane => lane.offset), [variant("minutes", 0), variant("minutes", 0), variant("minutes", 0)], "no offset: on the slot");
    assert.throws(() => Allocation.lanes(East.value([], ArrayType(Bay)) as never, { label: () => "" }), /a Dict keyed by String/);
});

test("with no slice the board narrows nothing; a slice is Slice.bindRecords over lanes and resources, refused otherwise", () => {
    const value = payloadWith();
    assert.equal(value.slice.type, "none");
    assert.deepEqual([value.narrowed.lanes.type, value.narrowed.resources.type], ["none", "none"]);
    const bayIndex = Data.bindPaged(ex.yardBays, { indexes: [ex.yardBaysByArea] });
    const kilnIndex = Data.bindPaged(ex.kilns, { indexes: [ex.kilnsByGroup] });
    // The narrowing builds over both sources, and over either alone.
    for (const sources of [{ lanes: { source: bayIndex } }, { resources: { source: kilnIndex } }, { lanes: { source: bayIndex }, resources: { source: kilnIndex } }]) {
        assert.doesNotThrow(() => East.function([], AllocationPayloadType, $ => {
            const days = $.let(Record.bind(ex.kilnPlans, [ex.kilnPlansPatch]));
            const fit = $.let(Func.bind(ex.yardFit));
            const slice = $.let(Slice.bindRecords("spec.yard", sources as never));
            return createAllocationPayload({ days, fit, lanes: yardLanes, resources: [], slice: { slice },
                events: Allocation.events($.const(yardArrivals, DictType(StringType, TimberLoad)), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays),
                    values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade, gradeMeasured: l.grade, instruction: none }) }) });
        }));
    }
    const refused = (slice: unknown) => () => payloadWith({ slice: { slice: slice as never } });
    assert.throws(refused(Slice.bindRecord("spec.single", kilnIndex)), /`slice` is Slice.bindRecords\(key, \{ lanes, resources \}\) — name each source after what it narrows/);
    assert.throws(refused(Slice.bindRecords("spec.bays", { bays: { source: bayIndex } })), /its source 'bays' is neither; name the sources `lanes` and `resources`/);
    const Numbered = DictType(IntegerType, StructType({ group: StringType }));
    const numbered = e3.record("spec_numbered", Numbered, new Map());
    const byGroup = e3.recordIndex("spec_numbered_by_group", numbered, { on: ["group"] });
    assert.throws(refused(Slice.bindRecords("spec.numbered", { resources: { source: Data.bindPaged(numbered, { indexes: [byGroup] }) } })),
        /String primary keys/);
});

test("labels: the board's nouns, resolved — regular plurals and articles by default, given ones kept, the quantity QTY", () => {
    const defaults = payloadWith().labels;
    assert.deepEqual(defaults, {
        lane: { one: "Lane", other: "Lanes", article: "a" }, event: { one: "Event", other: "Events", article: "an" },
        resource: { one: "Resource", other: "Resources", article: "a" }, quantity: "QTY",
    });
    const yard = payloadWith({ labels: { lane: "Bay", event: "Order", resource: { one: "Bus", other: "Buses" }, quantity: "Volume" } }).labels;
    assert.deepEqual(yard, {
        lane: { one: "Bay", other: "Bays", article: "a" }, event: { one: "Order", other: "Orders", article: "an" },
        resource: { one: "Bus", other: "Buses", article: "a" }, quantity: "Volume",
    });
    assert.deepEqual(payloadWith({ labels: { lane: { one: "Unit", article: "a" } } }).labels.lane, { one: "Unit", other: "Units", article: "a" });
    assert.throws(() => payloadWith({ labels: { event: " " } }), /`labels.event` must not be empty/);
});

test("table.bands: four by default; the app's own, from 0 and rising within the day, labelled or not; refused otherwise", () => {
    assert.deepEqual(payloadWith().table.bands, [0, 6, 12, 18].map(from => ({ from, label: none })));
    assert.deepEqual(payloadWith({ table: { bands: [{ from: 0, label: "Night" }, { from: 7.5 }, { from: 18, label: "Evening" }] } }).table.bands,
        [{ from: 0, label: some("Night") }, { from: 7.5, label: none }, { from: 18, label: some("Evening") }]);
    assert.throws(() => payloadWith({ table: { bands: [] } }), /needs at least one band, from 0/);
    assert.throws(() => payloadWith({ table: { bands: [{ from: 6 }] } }), /first band starts at 0/);
    assert.throws(() => payloadWith({ table: { bands: [{ from: 0 }, { from: 12 }, { from: 12 }] } }), /band 3 starts at 12, not after 12/);
    assert.throws(() => payloadWith({ table: { bands: [{ from: 0 }, { from: 24 }] } }), /band 2 starts at 24: a band starts within the day/);
});
