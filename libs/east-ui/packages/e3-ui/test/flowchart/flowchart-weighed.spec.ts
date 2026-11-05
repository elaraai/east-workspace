/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A kind's details weighed by the rail's picks (#1522, `Flowchart Records
 * Spec.md` R43–R46): details bound through their record's entries index, and
 * naming the source of the Flowchart's slice that offers the Dict field it
 * files.
 *
 * - The fold over a parcel depot's types, kind by kind: a figure and an Option
 *   of one, a histogram over an Array of counts and over a Dict of durations,
 *   a list over numbers and over structs through its draw, tags over a Set and
 *   over an Array — each the picked entries added up.
 * - `weigh: false`, and a field the entries lack, draw the row's own.
 * - Each refusal, in the tag's words.
 * - The payload: the details' `weighed`, read by key whatever the kind's read,
 *   and the source they name checked against the slice (R4).
 *
 * e3-ui's specs read and write no e3: the bindings compile on a platform that
 * refuses every read, and the renderer's tests draw the weighed details on
 * e3-web.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, Expr, FloatType, IntegerType, OptionType, SetType, StringType, StructType,
    encodeBeast2For, equalFor, none, printType, some, variant,
    type BlockBuilder, type EastType, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Flowchart as PublicFlowchart, Record } from "@elaraai/e3-ui";
import { Flowchart } from "@elaraai/e3-ui/internal";
import { refusingPlatform } from "../refusing-platform.js";
import * as ex from "./flowchart.examples.js";

// ============================================================================
// Fixtures: a depot state's evidence, each service's share filed apart
// ============================================================================

/** Where a state's parcels came from: a list of structs, added field by field before its draw. */
const Origin = StructType({ parcels: IntegerType, late: IntegerType, lanes: SetType(StringType), codes: ArrayType(StringType), weight: OptionType(IntegerType) });
/** One service's share of what a state measured: what the entries index files under the service's key. */
const ServiceShare = StructType({
    parcels: IntegerType,                             // a figure: adds
    held: OptionType(IntegerType),                    // an Option of one: adds its values, none where every entry's is
    onTime: FloatType,                                // a share: adding two is wrong, so its read says weigh: false
    flags: SetType(StringType),                       // tags over a Set: join
    stamps: ArrayType(StringType),                    // tags over an Array: join
    hours: ArrayType(IntegerType),                    // a histogram over an Array of counts: position by position
    dwell: DictType(FloatType, IntegerType),          // a histogram over a Dict of durations: duration by duration
    exceptions: DictType(StringType, IntegerType),    // a list over numbers: by name
    origins: DictType(StringType, Origin),            // a list over structs: each struct's numbers by name, then its draw
});
/** A state's evidence: its own figures, each service's share of them, and what the entries hold none of. */
const Evidence = StructType({
    parcels: IntegerType,
    held: OptionType(IntegerType),
    onTime: FloatType,
    flags: SetType(StringType),
    stamps: ArrayType(StringType),
    hours: ArrayType(IntegerType),
    dwell: DictType(FloatType, IntegerType),
    exceptions: DictType(StringType, IntegerType),
    origins: DictType(StringType, Origin),
    equipment: SetType(StringType),                   // the entries hold none: always the row's own
    byService: DictType(StringType, ServiceShare),    // each service's share, entry by entry
});
const evidence = e3.record("flowchart_weighed_evidence", DictType(StringType, Evidence), {
    initial: new Map(),
    indexes: (index) => ({
        evidence_by_service: index.entries("byService"),
        evidence_by_parcels: index.on(["parcels"]),
    }),
});

type Share = ValueTypeOf<typeof ServiceShare>;
type Row = ValueTypeOf<typeof Evidence>;
/** The Hold state's own evidence, as its lean row reads it: its services emptied. */
const HOLD: Row = {
    parcels: 1080n, held: some(70n), onTime: 0.82, flags: new Set(["Hazmat", "Customs"]), stamps: ["manual"],
    hours: [12n, 30n, 64n, 120n], dwell: new Map([[1, 5n]]), exceptions: new Map([["Duty unpaid", 236n]]),
    origins: new Map([["Air hub", { parcels: 293n, late: 5n, lanes: new Set(["A"]), codes: [], weight: none }]]),
    equipment: new Set(["Scanner", "X-ray"]),
    byService: new Map(),
};
/** Standard's share of it. */
const STANDARD: Share = {
    parcels: 335n, held: some(40n), onTime: 0.9, flags: new Set(["Fragile", "At risk"]), stamps: ["late", "rescan"],
    hours: [5n, 3n, 1n, 0n], dwell: new Map([[0.5, 3n], [2, 4n]]), exceptions: new Map([["Missort", 3n], ["Late arrival", 1n]]),
    origins: new Map([
        ["Air hub", { parcels: 10n, late: 1n, lanes: new Set(["A"]), codes: ["x"], weight: some(7n) }],
        ["Rail yard", { parcels: 5n, late: 0n, lanes: new Set(["B"]), codes: [], weight: none }],
    ]),
};
/** Priority's share of it. */
const PRIORITY: Share = {
    parcels: 130n, held: none, onTime: 0.6, flags: new Set(["Hazmat", "Fragile"]), stamps: ["rescan", "manual"],
    hours: [2n, 2n, 0n, 1n], dwell: new Map([[2, 1n], [8, 2n]]), exceptions: new Map([["Missort", 2n], ["Damaged", 4n]]),
    origins: new Map([
        ["Air hub", { parcels: 4n, late: 2n, lanes: new Set(["A", "C"]), codes: ["y", "x"], weight: some(3n) }],
        ["Sea port", { parcels: 3n, late: 0n, lanes: new Set(["D"]), codes: ["z"], weight: some(2n) }],
    ]),
};
/** The depot's bins, in hours. */
const HOURS = [0, 1, 12, 48];

const rowBytes = encodeBeast2For(Evidence);
const shareBytes = encodeBeast2For(ServiceShare);
const detailRowEqual = equalFor(Flowchart.Types.DetailRow);
const readsEqual = equalFor(ArrayType(BooleanType));
const optionString = equalFor(OptionType(StringType));

/** The evidence through its entries index: what the rail's source and the weighed details both bind. */
const byService = () => Data.bindPaged(evidence, { indexes: ["evidence_by_service"] });
/** The binding's id, as the platform names it: what the details are read by key through. */
const byServiceId = (): string => {
    const binding = byService();
    const type = Expr.type(binding) as EastType;
    return (East.compile(East.function([], type, ($) => $.return(binding)), refusingPlatform)() as { readonly id: string }).id;
};
/** The rail's source over it, its Dict field offered by the services' names. */
const evidenceSource = () => ({
    source: byService(),
    fields: { byService: { label: "Service", hints: ["Standard", "Priority", "Economy", "International"] } },
});
/** The depot's states read through their source of the rail, as the Flowchart's examples read them. */
const statesSource = () => ({
    source: Data.bindPaged(ex.depotStates, { indexes: ["flowchart_states_by_flow"] }),
    fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] } },
});

/** A kind's details built over a binding and called, on a platform that reads nothing: what the payload carries for it. */
function detailsOf(make: ($: BlockBuilder<typeof Flowchart.Types.Details>) => ExprType<typeof Flowchart.Types.Details>): ValueTypeOf<typeof Flowchart.Types.Details> {
    return East.compile(East.function([], Flowchart.Types.Details, ($) => make($)), refusingPlatform)();
}

/**
 * The weighed details over the evidence, every read in the order drawn — the
 * eight the entries hold, the share kept, and the equipment they lack — as the
 * states' details build them, read through their source or whole.
 */
const weighedDetails = (throughSource: boolean) => detailsOf(($) => Flowchart.details($.let(byService()), {
    source: "evidence",
    details: [
        Flowchart.figure("parcels", { label: "Parcels", unit: "parcels" }),
        Flowchart.figure("held", { label: "Held" }),
        Flowchart.figure("onTime", { label: "On time", unit: "%", weigh: false }),
        Flowchart.tags("flags", { label: "Flags" }),
        Flowchart.tags("stamps", { label: "Stamps", show: "inspector" }),
        Flowchart.histogram("hours", { unit: "hours", label: "Time in state", bins: HOURS, show: "inspector" }),
        Flowchart.histogram("dwell", { unit: "hours", label: "Dwell", show: "inspector" }),
        Flowchart.list("exceptions", { label: "Exceptions", show: "inspector" }),
        Flowchart.list("origins", { label: "Origin", show: "inspector" }, (o) => ({
            value: o.parcels,
            note: East.greater(o.late, 0n).ifElse(
                (_$) => East.value(some(East.str`${o.late} late · ${o.lanes.size()} lanes · ${o.codes.size()} codes · ${o.weight.match({
                    none: (_$2) => East.value(-1n, IntegerType),
                    some: (_$2, w) => w,
                })} kg`), OptionType(StringType)),
                (_$) => East.value(none, OptionType(StringType)),
            ),
        })),
        Flowchart.tags("equipment", { label: "Equipment", show: "inspector" }),
    ],
}).build("states", "Flowchart.states", throughSource));

/** Builds an East function as a surface does, making each check its build makes; what it refuses, it throws. */
function built(make: ($: BlockBuilder<UIComponentType>) => ExprType<UIComponentType>): void {
    East.function([], UIComponentType, ($) => make($));
}


/** Whether `build` throws an Error whose message is `message`, exactly. */
function refused(build: () => void, message: string): void {
    assert.throws(build, (error: unknown) => {
        assert.ok(error instanceof Error, "an Error");
        assert.equal(error.message, message);
        return true;
    });
}

// ============================================================================
// The fold (R45)
// ============================================================================

describe("the rail's picks weigh a kind's details: each read the entries hold, its picked entries added up by kind (R44, R45)", () => {
    test("the details carry how the picks weigh them: the source, the Dict field, its entries index, and which reads they weigh", () => {
        for (const throughSource of [true, false]) {
            const details = weighedDetails(throughSource);
            if (details.weighed.type !== "some") assert.fail("the details name a source: weighed");
            const weighed = details.weighed.value;
            assert.equal(weighed.source, "evidence");
            assert.equal(weighed.field, "byService");
            assert.equal(weighed.index, "evidence_by_service");
            assert.ok(readsEqual(weighed.reads, [true, true, false, true, true, true, true, true, true, false]),
                "every read the entries hold but the share, which says weigh: false, and the equipment, which they lack");
            // Read by key whatever the kind's read: through the binding's id, never whole.
            assert.equal(details.rows.type, "none");
            assert.ok(optionString(details.paged, some(byServiceId())));
        }
    });

    test("with no pick, every read draws the row's own: `values` reads the lean row as it is", () => {
        const details = weighedDetails(true);
        assert.ok(detailRowEqual(details.values(rowBytes(HOLD)), [
            variant("figure", some(1080)),
            variant("figure", some(70)),
            variant("figure", some(0.82)),
            variant("tags", ["Customs", "Hazmat"]),
            variant("tags", ["manual"]),
            variant("histogram", [{ from: 0, count: 12 }, { from: 1, count: 30 }, { from: 12, count: 64 }, { from: 48, count: 120 }]),
            variant("histogram", [{ from: 1, count: 5 }]),
            variant("list", [{ name: "Duty unpaid", value: 236, note: none }]),
            variant("list", [{ name: "Air hub", value: 293, note: some("5 late · 1 lanes · 0 codes · -1 kg") }]),
            variant("tags", ["Scanner", "X-ray"]),
        ]));
    });

    test("picked, each read adds its entries by kind; the share and the equipment draw the row's own", () => {
        const details = weighedDetails(true);
        if (details.weighed.type !== "some") assert.fail("weighed");
        const drawn = details.weighed.value.fold(rowBytes(HOLD), [shareBytes(STANDARD), shareBytes(PRIORITY)]);
        assert.ok(detailRowEqual(drawn, [
            // A figure adds: 335 + 130.
            variant("figure", some(465)),
            // An Option adds its values: Priority holds none, Standard 40.
            variant("figure", some(40)),
            // weigh: false — the row's own share.
            variant("figure", some(0.82)),
            // Tags join, each once, in the entries' order: a Set's in its own.
            variant("tags", ["At risk", "Fragile", "Hazmat"]),
            variant("tags", ["late", "rescan", "manual"]),
            // An Array of counts adds position by position, each at its bin's edge.
            variant("histogram", [{ from: 0, count: 7 }, { from: 1, count: 5 }, { from: 12, count: 1 }, { from: 48, count: 1 }]),
            // A Dict of durations adds duration by duration.
            variant("histogram", [{ from: 0.5, count: 3 }, { from: 2, count: 5 }, { from: 8, count: 2 }]),
            // A list adds by name.
            variant("list", [{ name: "Damaged", value: 4, note: none }, { name: "Late arrival", value: 1, note: none }, { name: "Missort", value: 5, note: none }]),
            // A list of structs adds each struct's fields by name — numbers and Options of them add, Sets and Arrays of
            // Strings join — then draws: Air hub's 14 parcels, 3 late, lanes A and C, codes x and y, 7 + 3 kg.
            variant("list", [
                { name: "Air hub", value: 14, note: some("3 late · 2 lanes · 2 codes · 10 kg") },
                { name: "Rail yard", value: 5, note: none },
                { name: "Sea port", value: 3, note: none },
            ]),
            // The entries hold no equipment: the row's own.
            variant("tags", ["Scanner", "X-ray"]),
        ]));
    });

    test("one entry draws its own; an Option is none where every entry's is; counts of another number than the bins draw their total at NaN", () => {
        const details = weighedDetails(true);
        if (details.weighed.type !== "some") assert.fail("weighed");
        const { fold } = details.weighed.value;
        const alone = fold(rowBytes(HOLD), [shareBytes(PRIORITY)]);
        assert.ok(detailRowEqual(alone.slice(0, 2), [variant("figure", some(130)), variant("figure", none)]),
            "Priority alone: its parcels, and its held none — every entry's is");
        const short = fold(rowBytes(HOLD), [shareBytes(STANDARD), shareBytes({ ...PRIORITY, hours: [2n, 2n] })]);
        // 5 + 3 + 1 + 0 and 2 + 2: no bin holds NaN, so the renderer lists the row in Issues, as it does the row's own.
        assert.ok(detailRowEqual([short[5]!], [variant("histogram", [{ from: NaN, count: 13 }])]));
    });
});

// ============================================================================
// Refused, in words (R44, R45)
// ============================================================================

/** A record whose entries hold a field the row reads as a number as a String. */
const Mismatched = StructType({ waiting: IntegerType, byService: DictType(StringType, StructType({ waiting: StringType })) });
const mismatched = e3.record("flowchart_weighed_mismatched", DictType(StringType, Mismatched), {
    initial: new Map(), indexes: (index) => ({ mismatched_by_service: index.entries("byService") }),
});
/** A record whose list's items hold a time, which neither adds nor joins. */
const Hub = StructType({ parcels: IntegerType, opened: DateTimeType });
const Hubs = StructType({ hubs: DictType(StringType, Hub), byService: DictType(StringType, StructType({ hubs: DictType(StringType, Hub) })) });
const hubs = e3.record("flowchart_weighed_hubs", DictType(StringType, Hubs), {
    initial: new Map(), indexes: (index) => ({ hubs_by_service: index.entries("byService") }),
});
/** A record whose entries hold a list's items as other structs than the row's. */
const LeanOrigin = StructType({ parcels: IntegerType });
const Apart = StructType({ origins: DictType(StringType, Origin), byService: DictType(StringType, StructType({ origins: DictType(StringType, LeanOrigin) })) });
const apart = e3.record("flowchart_weighed_apart", DictType(StringType, Apart), {
    initial: new Map(), indexes: (index) => ({ apart_by_service: index.entries("byService") }),
});
/** A record whose entries are numbers, not structs of fields. */
const Flat = StructType({ parcels: IntegerType, byService: DictType(StringType, IntegerType) });
const flat = e3.record("flowchart_weighed_flat", DictType(StringType, Flat), {
    initial: new Map(), indexes: (index) => ({ flat_by_service: index.entries("byService") }),
});

describe("weighed details refuse, as they are built, what the picks cannot weigh (R44, R45)", () => {
    /** The weighed details over a binding, with the reads given: what the tag builds, and what it refuses. */
    const weighing = (details: ($: BlockBuilder<UIComponentType>) => unknown) => () => built(($) => PublicFlowchart({
        states: Flowchart.states($.let(Record.bind(ex.depotStates)), { label: "name", details: details($) as never }),
    } as never));

    test("`source` names a source of the slice, beside an entries index — and an entries index needs a source", () => {
        refused(weighing(($) => Flowchart.details($.let(byService()), { source: "", details: [Flowchart.figure("parcels")] })),
            "Flowchart.details: `source` names the rail's source whose picks weigh the details — a source of the Flowchart's slice");
        const unweighed = "Flowchart.details: the details name the source \"evidence\", whose picks weigh them through their record's entries index — " +
            "bind them with Data.bindPaged(record, { indexes: [its entries index] })";
        refused(weighing(($) => Flowchart.details($.let(Data.bind(evidence)), { source: "evidence", details: [Flowchart.figure("parcels")] })), unweighed);
        refused(weighing(($) => Flowchart.details($.let(Data.bindPaged(ex.stateEvidence)), { source: "evidence", details: [Flowchart.figure("parcels")] })), unweighed);
        refused(weighing(($) => Flowchart.details($.let(byService()), { details: [Flowchart.figure("parcels")] })),
            "Flowchart.details: the details are bound through the entries index 'evidence_by_service', whose picks weigh them — name the rail's " +
            "source that offers 'byService', source: \"…\"");
        // Through other indexes than an entries index, the details have nothing to weigh by.
        refused(weighing(($) => Flowchart.details($.let(Data.bindPaged(ex.depotStates, { indexes: ["flowchart_states_by_flow"] })), { source: "evidence", details: [Flowchart.figure("seq")] })),
            "Flowchart.details: the details are read by key through the record's own entries, Data.bindPaged(record) — or, weighed by the rail's " +
            "picks, through the record's entries index — and this one reads it through other indexes");
        // An entries index beside the record's others: the one they are weighed by.
        const beside = detailsOf(($) => Flowchart.details($.let(Data.bindPaged(evidence, { indexes: ["evidence_by_service", "evidence_by_parcels"] })), {
            source: "evidence", details: [Flowchart.figure("parcels")],
        }).build("states", "Flowchart.states", false));
        if (beside.weighed.type !== "some") assert.fail("weighed");
        assert.equal(beside.weighed.value.index, "evidence_by_service");
        refused(weighing(($) => Flowchart.details($.let(Data.bindPaged(flat, { indexes: ["flat_by_service"] })), { source: "evidence", details: [Flowchart.figure("parcels")] })),
            `Flowchart.details: the entries index 'flat_by_service' files "byService", whose entries are ${printType(IntegerType)} — ` +
            "the picks weigh the fields of an entry's struct, each named as the row's is");
    });

    test("`weigh` needs a source; a read of the entries' own field is refused; weigh: true needs the entries to hold the field", () => {
        refused(weighing(($) => Flowchart.details($.let(Data.bind(evidence)), { details: [Flowchart.figure("onTime", { weigh: false })] })),
            "Flowchart.figure: \"onTime\" says weigh, and the details name no source whose picks weigh them — give the details source: \"…\", or leave weigh out");
        refused(weighing(($) => Flowchart.details($.let(byService()), { source: "evidence", details: [Flowchart.list("byService" as never)] })),
            "Flowchart.list: \"byService\" is what the entries index 'evidence_by_service' files, entry by entry, and each row is read with it emptied — " +
            "read the fields its entries hold");
        refused(weighing(($) => Flowchart.details($.let(byService()), { source: "evidence", details: [Flowchart.tags("equipment", { weigh: true })] })),
            `Flowchart.tags: "equipment" says weigh: true, and the entries of "byService" hold no "equipment" (${Object.keys(ServiceShare.fields).join(", ")}) — ` +
            "leave weigh out to draw the row's own");
        refused(() => Flowchart.figure("parcels", { weigh: "no" } as never),
            "Flowchart.figure: `weigh` is false to keep the row's own beside the rail's picks — a share or an average, which adding would make wrong");
    });

    test("a read whose field the entries hold in a type it doesn't take is refused, and weigh: false draws the row's own", () => {
        refused(weighing(($) => Flowchart.details($.let(Data.bindPaged(mismatched, { indexes: ["mismatched_by_service"] })), {
            source: "evidence", details: [Flowchart.figure("waiting")],
        })), `Flowchart.figure: the entries hold "waiting" as ${printType(StringType)} — a figure reads a number, or an Option of one: give it weigh: false to draw the row's own`);
        const kept = detailsOf(($) => Flowchart.details($.let(Data.bindPaged(mismatched, { indexes: ["mismatched_by_service"] })), {
            source: "evidence", details: [Flowchart.figure("waiting", { weigh: false })],
        }).build("states", "Flowchart.states", false));
        if (kept.weighed.type !== "some") assert.fail("weighed");
        assert.ok(readsEqual(kept.weighed.value.reads, [false]));
        const mismatchedBytes = encodeBeast2For(Mismatched);
        const entryBytes = encodeBeast2For(Mismatched.fields.byService.value);
        assert.ok(detailRowEqual(kept.weighed.value.fold(mismatchedBytes({ waiting: 70n, byService: new Map() }), [entryBytes({ waiting: "PX-1" })]),
            [variant("figure", some(70))]), "the row's own");
    });

    test("a list of structs adds field by field: one whose fields neither add nor join, or whose entries hold other structs, is refused unless weigh: false", () => {
        const hubsBinding = () => Data.bindPaged(hubs, { indexes: ["hubs_by_service"] });
        refused(weighing(($) => Flowchart.details($.let(hubsBinding()), { source: "evidence", details: [Flowchart.list("hubs", {}, (h) => ({ value: h.parcels }))] })),
            `Flowchart.list: "hubs"'s items hold "opened", ${printType(DateTimeType)}, which neither adds nor joins — numbers and Options of them add, ` +
            "Sets and Arrays of Strings join: give the list weigh: false");
        // weigh: false keeps the row's own: built, though the Flowchart has no slice to name the source — so its words are the payload's.
        refused(weighing(($) => Flowchart.details($.let(hubsBinding()), { source: "evidence", details: [Flowchart.list("hubs", { weigh: false }, (h) => ({ value: h.parcels }))] })),
            "Flowchart: the states' details name the source 'evidence', and the Flowchart has no slice — " +
            "slice={{ slice: Slice.bindRecords(key, { …, evidence: { source: Data.bindPaged(record, { indexes }), fields } }) }}");
        const apartBinding = () => Data.bindPaged(apart, { indexes: ["apart_by_service"] });
        refused(weighing(($) => Flowchart.details($.let(apartBinding()), { source: "evidence", details: [Flowchart.list("origins", {}, (o) => ({ value: o.parcels }))] })),
            `Flowchart.list: the entries hold "origins"'s items as ${printType(LeanOrigin)}, and the row as ${printType(Origin)} — its draw reads the row's: ` +
            "give the entries the row's items, or the list weigh: false");
    });
});

// ============================================================================
// The payload: the source the details name (R4, R44)
// ============================================================================

describe("weighed details name a source of the Flowchart's slice over their own record (R4, R44)", () => {
    /** The depot's states, through their source or whole, their details weighed by the source named. */
    const flowchart = (source: string, slice: "sourced" | "whole" | "none", sources: object = { evidence: evidenceSource() }) => ($: BlockBuilder<UIComponentType>) => {
        const details = Flowchart.details($.let(byService()), { source, details: [Flowchart.figure("parcels"), Flowchart.list("exceptions")] });
        if (slice === "none") return PublicFlowchart({ states: Flowchart.states($.let(Record.bind(ex.depotStates)), { label: "name", details }) } as never);
        if (slice === "whole") {
            const rail = $.let(Slice.bindRecords("flowchart.weighed.whole", sources as never));
            return PublicFlowchart({ slice: { slice: rail }, states: Flowchart.states($.let(Record.bind(ex.depotStates)), { label: "name", details }) } as never);
        }
        const rail = $.let(Slice.bindRecords("flowchart.weighed.sourced", { states: statesSource(), ...sources } as never));
        return PublicFlowchart({ slice: { slice: rail }, states: Flowchart.states($.let(Data.bindPaged(ex.depotStates)), { label: "name", details }) } as never);
    };

    test("the Flowchart builds weighed details beside the states' own source, or alone beside states read whole — read by key either way", () => {
        built(flowchart("evidence", "sourced"));
        built(flowchart("evidence", "whole"));
        // What the states' kind carries for them, read through their source or whole (the first test's).
        for (const throughSource of [true, false]) assert.equal(weighedDetails(throughSource).rows.type, "none");
    });

    test("a source the slice lacks, the states' or the transitions' own, one over rows of another type, or no slice at all, is refused", () => {
        refused(() => built(flowchart("evidence", "none")),
            "Flowchart: the states' details name the source 'evidence', and the Flowchart has no slice — " +
            "slice={{ slice: Slice.bindRecords(key, { …, evidence: { source: Data.bindPaged(record, { indexes }), fields } }) }}");
        refused(() => built(flowchart("service", "sourced")),
            "Flowchart: the states' details name the source 'service', which is none of the slice's sources (states, evidence) — " +
            "slice={{ slice: Slice.bindRecords(key, { …, service: { source: Data.bindPaged(record, { indexes }), fields } }) }}");
        refused(() => built(flowchart("states", "sourced")),
            "Flowchart: the states' details name the source 'states', which narrows the states — the picks that weigh details are a source of the " +
            "slice over the details' own record");
        refused(() => built(flowchart("evidence", "sourced", { evidence: statesSource() })),
            `Flowchart: the states' details name the source 'evidence', whose rows are ${printType(ex.DepotState)} — and the details' are ` +
            `${printType(Evidence)}: name the source over the details' record`);
    });
});
