/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's kinds, payload and tag (#1386, `Schematic Builder Spec.md`
 * §1, §2, §4, §5): each role's check (SC1); a gesture's write of only its
 * roles' fields (SC2); each prop §2 removes refused, naming its replacement
 * (SC3); each binding a kind's read doesn't take refused, naming the form to
 * use (SC33); geometry carried about its anchor, and a footprint without its
 * box refused (SC35); and the kinds' closed functions over decoded bytes —
 * each kind built over a record handle as the record runtime gives one, run,
 * and its rows, roles and writes read back at the record's own row type.
 */

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import {
    ArrayType, BooleanType, DictType, East, FloatType, FunctionType, NullType, OptionType, PatchType, SetType, StringType, StructType, VariantType,
    decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, isTypeEqual, none, some, variant, type BlockBuilder, type EastType, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Slice, UIComponentType } from "@elaraai/east-ui";
import { Text } from "@elaraai/east-ui/internal";
import { DatasetStatusType, RecordCommitInfoType } from "@elaraai/e3-types";
import {
    Data, DataBindHandleType, Record, RecordBindHandleType, RecordErrorType, RecordMutateStatusType, RecordOutcomeType, Schematic as PublicSchematic,
} from "@elaraai/e3-ui";
import { Schematic, SchematicPayloadType, buildSchematicLibrary, schematicKeys } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import * as ex from "./schematic.examples.js";

/** An index over the floor's racks' model: what the binding matrix's source reads them through, built and never run. */
const floorRacksByModel = e3.recordIndex("schematic_floor_racks_by_model", ex.schematicFloorRacks, { on: ["model"] });

describeEast("Schematic", (test) => {
    Assert.examples(test, {
        schematicFloor: ex.schematicFloor,
        schematicShapes: ex.schematicShapes,
        schematicDataCentre: ex.schematicDataCentre,
    });
}, { platformFns: TestImpl });

// ============================================================================
// Fixtures: records of the app's, and handles as their runtimes give them
// ============================================================================

const Alarm = VariantType({ ok: NullType, hot: NullType });
/** A rack with fields of its own beside its roles' — `hall`, `owner` and `notes` — which no gesture writes. */
const Rack = StructType({
    name: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType, model: StringType, alarm: Alarm,
    outline: OptionType(Schematic.Types.Geometry), system: StringType, hall: StringType, owner: StringType, notes: OptionType(StringType),
});
const Racks = DictType(StringType, Rack);
type RackRow = ValueTypeOf<typeof Rack>;
const A01: RackRow = {
    name: "A01", x: 2.4, y: 2.9, w: 3.2, h: 1.2, model: "42U", alarm: variant("ok", null),
    outline: some(variant("polygon", { vertices: [{ x: -1.6, y: -0.6, bulge: 0.0 }, { x: 1.6, y: -0.6, bulge: 0.0 }, { x: 1.6, y: 0.6, bulge: 0.0 }] })),
    system: "power", hall: "Hall 1", owner: "Harbour Labs", notes: some("cold aisle side"),
};
const A02: RackRow = {
    name: "A02", x: 6.0, y: 2.9, w: 3.2, h: 1.2, model: "48U", alarm: variant("hot", null), outline: none,
    system: "power", hall: "Hall 1", owner: "Northwind Media", notes: none,
};
const RACKS = new Map([["A01", A01], ["A02", A02]]);

/** A rack whose centre is a pair of Options: a kind with a backlog. */
const Slot = StructType({ name: StringType, x: OptionType(FloatType), y: OptionType(FloatType), w: FloatType, h: FloatType, owner: StringType });
const SLOTS = new Map([
    ["S1", { name: "S1", x: some(1.0), y: some(2.0), w: 1.0, h: 1.0, owner: "Harbour Labs" }],
    ["S2", { name: "S2", x: none, y: none, w: 1.0, h: 1.0, owner: "" }],
]);

const Frame = StructType({ name: StringType, x: FloatType, y: FloatType });
const FRAMES = new Map([["ODF-1", { name: "ODF-1", x: 8.0, y: 9.0 }]]);

const End = VariantType({ rack: StringType, frame: StringType });
/** A fibre run between two ends, with fields of its own beside its roles'. */
const Fibre = StructType({ from: End, to: End, path: ArrayType(Schematic.Types.Point), speed: StringType, colour: StringType });
const FIBRE = new Map([["u1", { from: variant("rack", "A01"), to: variant("frame", "ODF-1"), path: [{ x: 4.0, y: 6.0 }], speed: "100G", colour: "aqua" }]]);

/** A power feed, its supply a Set and its racks an Array. */
const Feed = StructType({ supply: SetType(StringType), racks: ArrayType(StringType), name: StringType });
const FEEDS = new Map([["f1", { supply: new Set(["A01"]), racks: ["A02"], name: "Feed 1" }]]);

const Area = StructType({ name: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType, shape: OptionType(Schematic.Types.Geometry) });
const AREAS = new Map([["hall-1", { name: "Hall 1", x: 0.0, y: 0.0, w: 20.0, h: 10.0, shape: some(variant("circle", { radius: 4.0 })) }]]);

const Load = StructType({ kw: FloatType, cap: FloatType, alarm: Alarm });
const LOADS = new Map([["A01", { kw: 5.0, cap: 8.0, alarm: variant("hot", null) }]]);

/** A `Record.bind` handle over a record of `type`, as the record runtime gives one: its read answers `value`, bound with its patch door when `patch`. */
function recordHandle<T extends EastType>(type: T, value: ValueTypeOf<T>, name: string, patch = true) {
    const handleType = RecordBindHandleType(type, patch ? { patch: [PatchType(type)] } : {});
    return East.function([], handleType, (_$) => ({
        read: East.function([], type, (_$2) => value as never),
        status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
        history: East.function([], OptionType(ArrayType(RecordCommitInfoType)), (_$2) => none),
        mutate: {
            pending: East.function([], BooleanType, (_$2) => false),
            status: East.function([], RecordMutateStatusType, (_$2) => variant("idle", null)),
            error: East.function([], OptionType(RecordErrorType), (_$2) => none),
            cancel: East.function([], NullType, (_$2) => null),
            ...(patch ? { patch: East.function([PatchType(type)], NullType, (_$2) => null) } : {}),
        },
        commit: patch
            ? { patch: East.asyncFunction([StringType, PatchType(type)], RecordOutcomeType, (_$2) => variant("committed", { commitHash: "c", stateHash: "s" })) }
            : {},
        start: East.function([], NullType, (_$2) => null),
        binding: { name, mutations: patch ? ["patch"] : [] },
    }) as never);
}

/** A `Data.bind` handle over a record of `type`, as the dataset runtime gives one: its read answers `value`. */
function dataHandle<T extends EastType>(type: T, value: ValueTypeOf<T>, name: string) {
    return East.function([], DataBindHandleType(type), (_$) => ({
        read: East.function([], type, (_$2) => value as never),
        write: East.function([type], NullType, (_$2) => null),
        writeAndStart: East.function([type], NullType, (_$2) => null),
        start: East.function([], NullType, (_$2) => null),
        source: East.function([], type, (_$2) => value as never),
        pending: East.function([], BooleanType, (_$2) => false),
        commit: East.function([], NullType, (_$2) => null),
        discard: East.function([], NullType, (_$2) => null),
        has: East.function([], BooleanType, (_$2) => true),
        status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
        binding: { source: [variant("field", "inputs"), variant("field", name)], patch: none, mode: variant("staged", null) },
    }) as never);
}

const racksRecord = recordHandle(Racks, RACKS, "racks");
const racksData = dataHandle(Racks, RACKS, "racks");
const racksUnpatched = recordHandle(Racks, RACKS, "racks", false);
const slotsRecord = recordHandle(DictType(StringType, Slot), SLOTS, "slots");
const framesData = dataHandle(DictType(StringType, Frame), FRAMES, "frames");
const fibreRecord = recordHandle(DictType(StringType, Fibre), FIBRE, "fibre");
const feedsRecord = recordHandle(DictType(StringType, Feed), FEEDS, "feeds");
const areasData = dataHandle(DictType(StringType, Area), AREAS, "areas");
const loadsData = dataHandle(DictType(StringType, Load), LOADS, "loads");

/** Builds an East function as a surface does, running each check its build makes; what it refuses, it throws. */
function built(make: ($: BlockBuilder<UIComponentType>) => ExprType<UIComponentType>): void {
    East.function([], UIComponentType, ($) => make($));
}

/** The smallest valid props beside the ones a test gives: one rack kind read whole, the drawing's extent. */
function floor($: BlockBuilder<UIComponentType>, props: object = {}): ExprType<UIComponentType> {
    const racks = $.let(racksRecord());
    return PublicSchematic({
        extent: { width: 20, height: 10 },
        items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", label: "name" }) },
        ...props,
    } as never);
}

/** The payload `<Schematic>` carries, read back from the carrier's bytes. */
function carried(make: ($: BlockBuilder<UIComponentType>) => ExprType<UIComponentType>): ValueTypeOf<typeof SchematicPayloadType> {
    const ui = East.compile(East.function([], UIComponentType, ($) => make($)), [])();
    if (ui.type !== "Extension") assert.fail(`expected the Schematic extension, got the ${ui.type} arm`);
    assert.equal(ui.value.kind, "Schematic");
    return decodeBeast2For(SchematicPayloadType)(ui.value.payload);
}

/** A kind built over its handle and run: what the payload carries for it. */
function kindOf<T extends EastType>(kindType: T, make: ($: BlockBuilder<T>) => ExprType<T>): ValueTypeOf<T> {
    return East.compile(East.function([], kindType as EastType, ($) => make($ as never) as never), [])() as ValueTypeOf<T>;
}

const rackBytes = encodeBeast2For(Rack);
const rackOf = decodeBeast2For(Rack);
const rackEqual = equalFor(Rack);
const refOf = (kind: string, key: string) => ({ kind, key });

// ============================================================================
// SC1, SC35: each role checked at build
// ============================================================================

describe("each role is a field of the app's row, named and checked (SC1)", () => {
    const items = (config: object) => built(($) => {
        const racks = $.let(racksRecord());
        return PublicSchematic({ extent: { width: 20, height: 10 }, items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", label: "name", ...config } as never) } });
    });

    hostTest("a role naming a field the row lacks is refused, naming the role, the field and the row's fields", () => {
        assert.throws(() => items({ x: "left" }), /^Error: Schematic\.items: "Rack": `x` names "left", a field the row does not have \(name, x, y, w, h, model, alarm, outline, system, hall, owner, notes\)$/);
        assert.throws(() => items({ layer: "tier" }), /`layer` names "tier", a field the row does not have/);
    });

    hostTest("a role naming a field of another type is refused, naming the role, the field and its type", () => {
        assert.throws(() => items({ label: "w" }), /Schematic\.items: "Rack": `label` names a String field — "w" holds \.Float/);
        assert.throws(() => items({ width: "name", height: "h" }), /`width` names a Float field — "name" holds \.String/);
        assert.throws(() => items({ layer: "w" }), /`layer` names a String field — "w" holds \.Float/);
        assert.throws(() => items({ width: "w", height: "h", footprint: "notes" }), /`footprint` names an Option of a Schematic\.Types\.Geometry field — "notes" holds an Option of \.String/);
        assert.throws(() => items({ x: "name" }), /`x` names a Float field, or an Option of one — "name" holds \.String/);
    });

    hostTest("`x` and `y` are both Floats, or both Options of Float, and two fields", () => {
        assert.throws(() => built(($) => {
            const slots = $.let(slotsRecord());
            return PublicSchematic({ extent: { width: 20, height: 10 }, items: { slots: Schematic.items(slots, { name: "Slot", icon: "server", x: "x", y: "w" as never, label: "name" }) } });
        }), /`x` and `y` are both Float fields, or both Options of Float — "x" holds an Option of \.Float and "w" \.Float/);
        assert.throws(() => items({ y: "x" }), /`x` and `y` both name "x" — an item's centre is two fields/);
    });

    hostTest("an accessor returning another type is refused, naming what it returns", () => {
        assert.throws(() => items({ sublabel: (r: ExprType<typeof Rack>) => r.w }), /`sublabel` returns a String — and this one returns \.Float/);
        assert.throws(() => items({ meter: (r: ExprType<typeof Rack>) => r.w }), /`meter` returns a Schematic\.Types\.Meter, \{ value, max \} — and this one returns \.Float/);
        assert.throws(() => items({ tone: (r: ExprType<typeof Rack>) => r.name }), /`tone` returns an Option of a Schematic\.Types\.Tone — and this one returns \.String/);
    });

    hostTest("a footprint is drawn about the item's centre, inside its box: without `width` and `height` it is refused (SC35)", () => {
        assert.throws(() => items({ footprint: "outline" }), /`footprint` is drawn about the item's centre, inside its box — give `width` and `height` with it, the box's Float fields/);
        assert.throws(() => items({ footprint: "outline", width: "w" }), /give `width` and `height` with it/);
        assert.doesNotThrow(() => items({ footprint: "outline", width: "w", height: "h" }));
    });

    hostTest("a status is a variant field every row holds, a Status per case", () => {
        assert.throws(() => items({ status: { field: "name", cases: {} } }), /`status\.field` names a variant field every row holds, a Status per case — "name" holds \.String/);
        assert.throws(() => items({ status: { field: "notes", cases: {} } }), /`status\.field` names a variant field every row holds, a Status per case — "notes" holds an Option of \.String/);
    });

    hostTest("a zone's box is four Float fields; its pattern an accessor of a ZonePattern; its shape an Option of a Geometry", () => {
        const zones = (config: object) => built(($) => {
            const racks = $.let(racksRecord());
            const areas = $.let(areasData());
            return PublicSchematic({
                extent: { width: 20, height: 10 },
                items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", label: "name" }) },
                zones: { areas: Schematic.zones(areas, { name: "Area", icon: "vector-square", x: "x", y: "y", width: "w", height: "h", label: "name", ...config } as never) },
            });
        });
        assert.doesNotThrow(() => zones({ geometry: "shape" }));
        assert.throws(() => zones({ width: "name" }), /Schematic\.zones: "Area": `width` names a Float field — "name" holds \.String/);
        assert.throws(() => zones({ pattern: (a: ExprType<typeof Area>) => a.name }), /`pattern` returns a Schematic\.Types\.ZonePattern — and this one returns \.String/);
        assert.throws(() => zones({ geometry: "name" }), /`geometry` names an Option of a Schematic\.Types\.Geometry field — "name" holds \.String/);
        assert.throws(() => zones({ templates: [] }), /zones take no templates/);
    });

    hostTest("a link's ends are a String field or a variant of String cases — never an Option — and two fields; each `of` names an item slot", () => {
        const Link = StructType({ a: StringType, b: OptionType(StringType), c: FloatType });
        const linkRecord = recordHandle(DictType(StringType, Link), new Map(), "links");
        const links = (config: object) => built(($) => {
            const racks = $.let(racksRecord());
            const runs = $.let(linkRecord());
            return PublicSchematic({
                extent: { width: 20, height: 10 },
                items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", label: "name" }) },
                links: { runs: Schematic.links(runs, { name: "Run", icon: "bolt", from: { field: "a", of: "racks" }, to: { field: "a", of: "racks" }, ...config } as never) },
            });
        });
        assert.throws(() => links({}), /Schematic\.links: "Run": `from` and `to` both name "a" — a link's ends are two fields/);
        assert.throws(() => links({ to: { field: "b", of: "racks" } }), /a link has both its ends — `to\.field` names a String field or a variant of String cases, and "b" holds an Option of \.String/);
        assert.throws(() => links({ to: { field: "c", of: "racks" } }), /`to\.field` names a field holding a item's key — a String, a variant of String cases, or an Option of either — and "c" holds \.Float/);
        assert.throws(() => links({ to: { field: "a", of: "frames" }, from: { field: "a", of: "racks" } }), /two fields/);
    });

    hostTest("a net's sides are Set or Array of String fields, two of them", () => {
        const Net = StructType({ s: SetType(StringType), d: ArrayType(StringType), n: StringType });
        const netRecord = recordHandle(DictType(StringType, Net), new Map(), "nets");
        const nets = (config: object) => built(($) => {
            const racks = $.let(racksRecord());
            const feeds = $.let(netRecord());
            return PublicSchematic({
                extent: { width: 20, height: 10 },
                items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", label: "name" }) },
                nets: { feeds: Schematic.nets(feeds, { name: "Feed", icon: "plug", sources: { field: "s", of: "racks" }, destinations: { field: "d", of: "racks" }, ...config } as never) },
            });
        });
        assert.doesNotThrow(() => nets({}));
        assert.throws(() => nets({ destinations: { field: "n", of: "racks" } }), /Schematic\.nets: "Feed": `destinations\.field` names a Set or an Array of String field, its items' keys — "n" holds \.String/);
        assert.throws(() => nets({ destinations: { field: "s", of: "racks" } }), /`sources` and `destinations` both name "s" — a net's sides are two fields/);
    });

    hostTest("a card role given by the kind and by its details is refused, naming it: a card draws one", () => {
        assert.throws(() => built(($) => {
            const racks = $.let(racksRecord());
            const loads = $.let(loadsData());
            return PublicSchematic({
                extent: { width: 20, height: 10 },
                items: { racks: Schematic.items(racks, {
                    name: "Rack", icon: "server", x: "x", y: "y", label: "name", meter: (r) => ({ value: r.w, max: r.h }),
                    details: Schematic.details(loads, { meter: (l) => ({ value: l.kw, max: l.cap }) }),
                }) },
            });
        }), /Schematic\.items: "Rack": `meter` is given here and by the kind's details — a card draws one; give it in one place/);
    });

    hostTest("templates are records: a list written in the code is refused, and so are templates whose values aren't every field but the centre", () => {
        assert.throws(() => items({ templates: [{ key: "r", name: "Rack", values: {} }] }), /templates are records — Schematic\.templates\(templates\.read\(\), \{ name, values, source \}\)/);
        const Template = StructType({ name: StringType, size: FloatType });
        assert.throws(() => built(($) => {
            const racks = $.let(racksRecord());
            const templates = $.let(dataHandle(DictType(StringType, Template), new Map(), "templates")());
            return PublicSchematic({
                extent: { width: 20, height: 10 },
                items: { racks: Schematic.items(racks, {
                    name: "Rack", icon: "server", x: "x", y: "y", label: "name",
                    templates: Schematic.templates(templates.read(), { name: (t) => t.name, values: (t) => ({ size: t.size }) as never, source: "templates" }),
                }) },
            });
        }), /Schematic\.items: "Rack": its templates' `values` give every field of the row but `x` and `y` — \.Struct .* — and these give \.Struct/);
    });
});

// ============================================================================
// SC33: how a kind is bound follows how it is read
// ============================================================================

describe("a kind's binding follows its read: every other form is refused, naming the one to use (SC33)", () => {
    /** A slice whose `racks` source narrows the floor's racks. */
    const sliceOf = ($: BlockBuilder<UIComponentType>) => $.let(Slice.bindRecords("t.schematic", {
        racks: { source: Data.bindPaged(ex.schematicFloorRacks, { indexes: [floorRacksByModel] }), fields: { model: { label: "Model", hints: ["42U · 8 kW", "48U · 12 kW"] } } },
    }));
    const whole = (bind: ($: BlockBuilder<UIComponentType>) => unknown, extra: object = {}) => built(($) => PublicSchematic({
        extent: { width: 20, height: 10 },
        items: { racks: Schematic.items(bind($) as never, { name: "Rack", icon: "server", x: "x", y: "y", label: "name", ...extra } as never) },
    }));
    const through = (bind: ($: BlockBuilder<UIComponentType>) => unknown, extra: object = {}) => built(($) => {
        const slice = sliceOf($);
        return PublicSchematic({
            extent: { width: 20, height: 10 }, slice: { slice },
            items: { racks: Schematic.items(bind($) as never, { name: "Rack", icon: "server", x: "x", y: "y", label: "name", ...extra } as never) },
        });
    });

    hostTest("read whole: Record.bind with its patch door, or Data.bind; Data.bindPaged has no whole read", () => {
        assert.doesNotThrow(() => whole(($) => $.let(Record.bind(ex.schematicFloorRacks, [ex.schematicFloorRacksPatch]))));
        assert.doesNotThrow(() => whole(($) => $.let(Data.bind(ex.schematicFloorRacks))));
        assert.throws(() => whole(($) => $.let(Data.bindPaged(ex.schematicFloorRacks))),
            /Schematic\.items: "Rack": a paged binding has no whole read — read it through its source of the slice, slot "racks"/);
    });

    hostTest("read whole, `entries` is refused: the record is read from the binding", () => {
        assert.throws(() => whole(($) => $.let(Record.bind(ex.schematicFloorRacks, [ex.schematicFloorRacksPatch])), { entries: Data.bindPaged(ex.schematicFloorRacks) }),
            /`entries` reads the record by key beside its source of the slice — name one "racks", or leave `entries` out/);
        assert.throws(() => whole(($) => $.let(Data.bind(ex.schematicFloorRacks)), { entries: Data.bindPaged(ex.schematicFloorRacks) }),
            /`entries` reads an editable record by key — a kind bound Data\.bind is read whole: leave `entries` out/);
    });

    hostTest("a record bound without its patch door is refused, naming the binding to use", () => {
        assert.throws(() => whole(($) => $.let(Record.bind(ex.schematicFloorRacks, []))),
            /Schematic\.items: "Rack": `record` is bound without its patch door — Record\.bind\(record, \[e3\.mutation\.patch\(record\)\]\) to edit it/);
        assert.throws(() => whole(($) => $.let(racksUnpatched())), /bound without its patch door/);
    });

    hostTest("through its source: Record.bind with `entries`, or Data.bindPaged; Data.bind, and Record.bind without `entries`, are refused", () => {
        assert.doesNotThrow(() => through(($) => $.let(Record.bind(ex.schematicFloorRacks, [ex.schematicFloorRacksPatch])), { entries: Data.bindPaged(ex.schematicFloorRacks) }));
        assert.doesNotThrow(() => through(($) => $.let(Data.bindPaged(ex.schematicFloorRacks))));
        assert.throws(() => through(($) => $.let(Data.bind(ex.schematicFloorRacks))),
            /Data\.bind\(record\) reads the record whole, which a source of the slice exists to avoid — bind it Data\.bindPaged\(record\) to read it through its source "racks"/);
        assert.throws(() => through(($) => $.let(Record.bind(ex.schematicFloorRacks, [ex.schematicFloorRacksPatch]))),
            /the slice's source "racks" reads only its narrowing — .* give `entries: Data\.bindPaged\(record\)` beside it, the record's own entries/);
        assert.throws(() => through(($) => $.let(Data.bindPaged(ex.schematicFloorRacks)), { entries: Data.bindPaged(ex.schematicFloorRacks) }),
            /`entries` reads an editable record by key — a kind bound Data\.bindPaged reads by key through its own binding: leave `entries` out/);
    });

    hostTest("a paged read of the record's indexes is no binding of the kind's record: it is the kind's source of the slice", () => {
        assert.throws(() => whole(($) => $.let(Data.bindPaged(ex.schematicFloorRacks, { indexes: [floorRacksByModel] }))),
            /Schematic\.items: "Rack": `record` is the app's record, bound — .* — and this paged read serves the record's indexes: bind its own entries, Data\.bindPaged\(record\), and name the indexed read as the kind's source of the slice/);
    });

    hostTest("a kind's details are bound as their kind is read", () => {
        const withDetails = (source: boolean, bind: ($: BlockBuilder<UIComponentType>) => unknown, extra: object = {}) => built(($) => {
            const slice = source ? sliceOf($) : undefined;
            const racks = source ? $.let(Data.bindPaged(ex.schematicFloorRacks)) : $.let(Data.bind(ex.schematicFloorRacks));
            return PublicSchematic({
                extent: { width: 20, height: 10 }, ...(slice === undefined ? {} : { slice: { slice } }),
                items: { racks: Schematic.items(racks as never, {
                    name: "Rack", icon: "server", x: "x", y: "y", label: "name",
                    details: Schematic.details(bind($) as never, { metric: (r: ExprType<typeof ex.FloorRack>) => some(r.model), ...extra } as never),
                }) },
            });
        });
        assert.doesNotThrow(() => withDetails(false, ($) => $.let(Data.bind(ex.schematicFloorRacks))));
        assert.doesNotThrow(() => withDetails(true, ($) => $.let(Data.bindPaged(ex.schematicFloorRacks))));
        assert.doesNotThrow(() => withDetails(true, ($) => $.let(Record.bind(ex.schematicFloorRacks, [ex.schematicFloorRacksPatch])), { entries: Data.bindPaged(ex.schematicFloorRacks) }));
        assert.throws(() => withDetails(false, ($) => $.let(Data.bindPaged(ex.schematicFloorRacks))),
            /Schematic\.details of racks: beside a kind read whole, its details are read whole — bind them Data\.bind\(record\)/);
        assert.throws(() => withDetails(true, ($) => $.let(Data.bind(ex.schematicFloorRacks))),
            /Schematic\.details of racks: beside a kind read through its source, its details are read by key — bind them Data\.bindPaged\(record\)/);
        assert.throws(() => withDetails(true, ($) => $.let(Record.bind(ex.schematicFloorRacks, [ex.schematicFloorRacksPatch]))),
            /beside a kind read through its source, its details are read by key — give `entries: Data\.bindPaged\(record\)` beside Record\.bind/);
        assert.throws(() => withDetails(false, ($) => $.let(Record.bind(ex.schematicFloorRacks, [ex.schematicFloorRacksPatch])), { entries: Data.bindPaged(ex.schematicFloorRacks) }),
            /`entries` reads the details by key beside a kind read through its source — this kind is read whole/);
    });

    hostTest("a kind's record holds its entities by String key, each a struct", () => {
        const byNumber = recordHandle(DictType(FloatType, Rack), new Map(), "racks");
        assert.throws(() => whole(($) => $.let(byNumber())), /a Schematic kind's record holds its entities by String key, each a struct — and this one holds \.Dict/);
        assert.throws(() => whole(() => "racks"), /`record` is the app's record, bound — Record\.bind\(record, \[e3\.mutation\.patch\(record\)\]\) to edit it, or Data\.bind\(record\) or Data\.bindPaged\(record\) to read it only/);
    });
});

// ============================================================================
// SC3: each removed prop refused, naming its replacement
// ============================================================================

describe("each prop §2 removes is refused at build, naming the form that replaces it (SC3)", () => {
    const fn = East.function([StringType], NullType, (_$, _k) => null);
    const cases: readonly (readonly [string, unknown, RegExp])[] = [
        ["item", (r: unknown) => r, /^Error: Schematic: rows and their mappers are gone — an app's rows are its records, each kind's fields mapped to its roles: items=\{\{ racks: Schematic\.items/],
        ["zone", (r: unknown) => r, /rows and their mappers are gone — .* zones=\{\{ halls: Schematic\.zones/],
        ["link", (r: unknown) => r, /rows and their mappers are gone — .* links=\{\{ fibre: Schematic\.links/],
        ["net", (r: unknown) => r, /rows and their mappers are gone — .* nets=\{\{ feeds: Schematic\.nets/],
        ["onMoveItem", fn, /^Error: Schematic: `onMoveItem` is gone — every gesture is a transaction of the Schematic's editing session, and Save writes each record through its patch door/],
        ["onCreateLink", fn, /`onCreateLink` is gone — every gesture is a transaction of the Schematic's editing session/],
        ["onEditLink", fn, /`onEditLink` is gone — every gesture is a transaction/],
        ["onDeleteLink", fn, /`onDeleteLink` is gone — every gesture is a transaction/],
        ["onEditNet", fn, /`onEditNet` is gone — every gesture is a transaction/],
        ["linkMode", "connect", /`linkMode` is gone — the Connect tool always records a link, of the link kind its menu picks/],
        ["readOnlyLinks", true, /`readOnlyLinks` is gone — a kind is read only when it is bound read only — Data\.bind\(record\), or Data\.bindPaged\(record\) read through its source/],
        ["readOnlyItems", true, /`readOnlyItems` is gone — a kind is read only when it is bound read only/],
        ["itemHover", fn, /`itemHover` is gone — the inspector, on by default, shows what is selected — give a kind its own Details with its `inspector`/],
        ["zoneHover", fn, /`zoneHover` is gone — the inspector, on by default/],
        ["linkHover", fn, /`linkHover` is gone — the inspector, on by default/],
        ["affordances", ["search"], /`affordances` is gone — it moved into `slice`: slice=\{\{ slice: Slice\.bindRecords\(key, \{ … \}\), affordances \}\}/],
        ["sliceHidden", true, /`sliceHidden` is gone — how a narrowed-out row draws is `narrowed` — narrowed="dim"/],
        ["sliceOpacity", 0.3, /`sliceOpacity` is gone — how a narrowed-out row draws is `narrowed`/],
        ["sliceDesaturate", true, /`sliceDesaturate` is gone — how a narrowed-out row draws is `narrowed`/],
        ["sliceDot", true, /`sliceDot` is gone — how a narrowed-out row draws is `narrowed`/],
        ["sliceEmphasis", "halo", /`sliceEmphasis` is gone — how a narrowed-out row draws is `narrowed`/],
        ["sliceFrame", true, /`sliceFrame` is gone — how a narrowed-out row draws is `narrowed`/],
        ["sliceFrameFit", true, /`sliceFrameFit` is gone — how a narrowed-out row draws is `narrowed`/],
        ["sliceSelectField", "id", /`sliceSelectField` is gone — the selection drives the inspector, and the rail is the only narrowing/],
        ["selectionMode", "multiple", /`selectionMode` is gone — selection is built in: a tap selects, Shift extends it, and the Marquee tool boxes/],
        ["navigator", true, /`navigator` is gone — the library's Index tab lists the zones and the items inside them: library=\{\[Schematic\.library\.index\(\)\]\}/],
        ["height", "440px", /`height` is gone — the Schematic fills the box it is given — give it a box of its own height: <Box height="640px"><Schematic … \/><\/Box>/],
        ["maxHeight", "75vh", /`maxHeight` is gone — the Schematic fills the box it is given/],
        ["onSelect", fn, /`onSelect` is gone — onSelectionChange hears each change of the selection, each item named by its kind and key \(Schematic\.Types\.Ref\)/],
        ["onSelectZone", fn, /`onSelectZone` is gone — onZoneSelectionChange hears each change of the selected zones/],
    ];
    for (const [prop, value, refusal] of cases) {
        hostTest(`\`${prop}\` is refused, naming its replacement`, () => {
            assert.throws(() => built(($) => floor($, { [prop]: value })), refusal);
        });
    }

    hostTest("rows as a sort's kinds are refused: rows and their mappers are gone", () => {
        assert.throws(() => built(($) => floor($, { zones: [{ id: "z" }] })), /rows and their mappers are gone — .* zones=\{\{ halls: Schematic\.zones/);
        assert.throws(() => built(($) => PublicSchematic({ extent: { width: 1, height: 1 }, items: [{ id: "A" }] } as never)), /rows and their mappers are gone — .* items=/);
    });

    hostTest("each sort takes its own kinds by slot: one under another sort, a kind not by slot, and a slot holding two kinds are refused", () => {
        assert.throws(() => built(($) => {
            const frames = $.let(framesData());
            return floor($, { links: { frames: Schematic.items(frames, { name: "Frame", icon: "server", x: "x", y: "y", label: "name" }) } });
        }), /Schematic: `links\.frames` is a link kind, Schematic\.links\(record, \{ name, icon, from, to \}\) — and this is an item kind: give it under `items`/);
        assert.throws(() => built(($) => {
            const racks = $.let(racksRecord());
            return PublicSchematic({ extent: { width: 1, height: 1 }, items: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", label: "name" }) as never });
        }), /Schematic: `items` takes kinds by slot — items=\{\{ <slot>: Schematic\.items/);
        assert.throws(() => built(($) => {
            const areas = $.let(areasData());
            return floor($, { zones: { racks: Schematic.zones(areas, { name: "Area", icon: "vector-square", x: "x", y: "y", width: "w", height: "h", label: "name" }) } });
        }), /Schematic: the slot "racks" holds two kinds — an item kind and a zone kind: each slot names one kind, and the source of the slice that narrows it/);
    });

    hostTest("a link's end and a net's side hold keys of an item slot", () => {
        assert.throws(() => built(($) => {
            const fibre = $.let(fibreRecord());
            return floor($, { links: { fibre: Schematic.links(fibre, {
                name: "Fibre run", icon: "bolt", from: { field: "from", of: { rack: "racks", frame: "network" } }, to: { field: "to", of: { rack: "racks", frame: "network" } },
            }) } });
        }), /Schematic: the link kind "fibre"'s `from` holds keys of "network", which holds no item kind — its item slots are "racks"/);
        assert.throws(() => built(($) => {
            const feeds = $.let(feedsRecord());
            return floor($, { nets: { feeds: Schematic.nets(feeds, { name: "Feed", icon: "plug", sources: { field: "supply", of: "pdus" }, destinations: { field: "racks", of: "racks" } }) } });
        }), /Schematic: the net kind "feeds"'s `sources` holds keys of "pdus", which holds no item kind/);
    });

    hostTest("the drawing needs its extent and an item kind; a prop it doesn't take is refused, naming the props it does", () => {
        assert.throws(() => built(($) => floor($, { extent: { width: 0, height: 4 } })), /`extent` is the drawing's world bounds, \{ width, height \}, each a positive number of world units/);
        assert.throws(() => built((_$) => PublicSchematic({ extent: { width: 1, height: 1 }, items: {} })), /Schematic: needs its items — items=\{\{ <slot>: Schematic\.items/);
        assert.throws(() => built(($) => floor($, { colour: "red" })), /Schematic: `colour` is not a prop of <Schematic> — it takes extent, scaleUnit, items/);
    });

    hostTest("the narrowing is one Slice.bindRecords, `{ slice }`; the brush is refused", () => {
        assert.throws(() => built(($) => {
            const local = $.let(Slice.bind("t.local", [{ id: "a" }], { fields: { id: { label: "ID" } } }));
            return floor($, { slice: local });
        }), /Schematic: `slice` takes \{ slice \} — slice=\{\{ slice: Slice\.bindRecords\(key, \{ … \}\), affordances\?, persist\? \}\}/);
        assert.throws(() => built(($) => {
            const slice = $.let(Slice.bindRecords("t.brush", {
                racks: { source: Data.bindPaged(ex.schematicFloorRacks, { indexes: [floorRacksByModel] }), fields: { model: { label: "Model", hints: ["42U · 8 kW", "48U · 12 kW"] } } },
            }));
            return floor($, { slice: { slice, affordances: ["brush"] } });
        }), /a 2D canvas has no continuous axis to brush along/);
    });

    hostTest("a source no kind, templates list or tab names is refused", () => {
        assert.throws(() => built(($) => {
            const slice = $.let(Slice.bindRecords("t.stray", {
                cages: { source: Data.bindPaged(ex.schematicFloorRacks, { indexes: [floorRacksByModel] }), fields: { model: { label: "Model", hints: ["42U · 8 kW", "48U · 12 kW"] } } },
            }));
            return floor($, { slice: { slice } });
        }), /Schematic: `slice` narrows its kinds, each by its slot, and the templates lists and tabs that name a source — its source 'cages' is none of them; name the sources `racks`/);
    });

    hostTest("templates naming no source of the slice are refused, naming the change", () => {
        assert.throws(() => built(($) => {
            const racks = $.let(Record.bind(ex.schematicRacks, [ex.schematicRacksPatch]));
            const templates = $.let(Data.bind(ex.schematicRackTemplates));
            return PublicSchematic({
                extent: { width: 20, height: 10 },
                items: { racks: Schematic.items(racks, {
                    name: "Rack", icon: "server", x: "x", y: "y", label: "name",
                    templates: Schematic.templates(templates.read(), { name: (t) => t.name, values: (t) => t.values, source: "rackTemplates" }),
                }) },
            });
        }), /Schematic: templates are records now — bind them in Slice\.bindRecords and name the source, Schematic\.templates\(rows, \{ …, source \}\) \(it has no slice — 'rackTemplates' is not one of them\)/);
    });

    hostTest("`narrowed`, `layers` and `inspector` take their forms, and nothing else", () => {
        assert.throws(() => built(($) => floor($, { narrowed: "ghost" })), /Schematic: `narrowed` is "hide" \(the default\), "dim", or \{ show: "hide" \| "dim", opacity\?: 0–1/);
        assert.throws(() => built(($) => floor($, { narrowed: { show: "dim", opacity: 2 } })), /`narrowed` is "hide" \(the default\)/);
        assert.throws(() => built(($) => floor($, { layers: [{ key: "power", label: "Power" }, { key: "power", label: "Mains" }] })), /`layers` lists the layer "power" twice — each layer's key is its own/);
        assert.throws(() => built(($) => floor($, { layers: [{ key: "power" }] })), /`layers` lists the layers, each \{ key, label, tone\?, visible\?, locked\?, opacity\? \}/);
        assert.throws(() => built(($) => floor($, { inspector: { cages: East.function([Rack, FunctionType([Rack], NullType)], UIComponentType, (_$2, r) => Text.Root(r.name)) } })),
            /`inspector` gives "cages" its own Details, and no kind is in that slot — its kinds' slots are "racks"/);
        assert.throws(() => built(($) => floor($, { inspector: "yes" })), /`inspector` is on by default — inspector=\{false\} removes the pane/);
        assert.throws(() => built(($) => {
            const racks = $.let(racksRecord());
            const own = East.function([Rack, FunctionType([Rack], NullType)], UIComponentType, (_$2, r) => Text.Root(r.name));
            return PublicSchematic({
                extent: { width: 20, height: 10 },
                items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", label: "name", inspector: own }) },
                inspector: { racks: own },
            });
        }), /`inspector\.racks` gives the item kind "racks" its own Details, and so does the kind's own `inspector` — give them in one place/);
        assert.throws(() => built(($) => floor($, { inspector: { racks: East.function([StringType], UIComponentType, (_$2, s) => Text.Root(s)) } })),
            /`inspector` is the kind's own Details — an East\.function over the row and its writer/);
    });
});

// ============================================================================
// The kinds' closed functions over decoded bytes (SC2, SC35)
// ============================================================================

describe("an item kind's closed functions, over decoded bytes (SC2, SC35)", () => {
    const racks = kindOf(Schematic.Types.ItemKind, ($) => {
        const record = $.let(racksRecord());
        return Schematic.items(record, {
            name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", footprint: "outline", label: "name", layer: "system",
            sublabel: (r) => r.model, meter: (r) => ({ value: r.w, max: r.h }),
            status: { field: "alarm", cases: {
                ok: { label: "OK", tone: variant("success", null), ring: false },
                hot: { label: "Hot", tone: variant("danger", null), ring: true },
            } },
        }).build("racks");
    });

    hostTest("its rows: each stored rack's roles beside its own row, by key", () => {
        const rows = racks.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        assert.deepEqual([...rows.value.keys()], ["A01", "A02"]);
        const a01 = rows.value.get("A01")!;
        assert.ok(rackEqual(rackOf(a01.row), A01), "the row crosses whole, its own fields among it");
        assert.ok(equalFor(OptionType(Schematic.Types.Point))(a01.roles.position, some({ x: 2.4, y: 2.9 })));
        assert.equal(a01.roles.label, "A01");
        assert.ok(equalFor(OptionType(StringType))(a01.roles.sublabel, some("42U")));
        assert.ok(equalFor(OptionType(StringType))(a01.roles.layer, some("power")));
        assert.ok(equalFor(OptionType(StringType))(a01.roles.icon, some("server")));
        assert.ok(equalFor(OptionType(Schematic.Types.Meter))(a01.roles.meter, some({ value: 3.2, max: 1.2 })));
        assert.ok(equalFor(OptionType(Schematic.Types.Status))(rows.value.get("A02")!.roles.status, some({ label: "Hot", tone: variant("danger", null), ring: true })));
        assert.ok(equalFor(OptionType(Schematic.Types.Geometry))(a01.roles.footprint, A01.outline), "the footprint crosses as the row holds it: offsets from the centre");
    });

    hostTest("a move writes the centre alone: every other field of the rack reads back as it was (SC2)", () => {
        const moved = racks.write(rackBytes(A01), some({ x: 10.0, y: 4.0 }));
        if (moved.type !== "some") assert.fail("a rack with a centre is placed");
        assert.ok(rackEqual(rackOf(moved.value), { ...A01, x: 10.0, y: 4.0 }));
        // The footprint, offsets from the centre, moves with it (SC35): the read places it about the new centre.
        const roles = racks.read(moved.value, "A01");
        assert.ok(equalFor(OptionType(Schematic.Types.Point))(roles.position, some({ x: 10.0, y: 4.0 })));
        assert.ok(equalFor(OptionType(Schematic.Types.Geometry))(roles.footprint, A01.outline));
    });

    hostTest("a kind with no backlog takes no unplacing: a write of no centre writes nothing", () => {
        assert.equal(racks.write(rackBytes(A01), none).type, "none");
        assert.equal(racks.backlog, false);
    });

    hostTest("a new rack at a drop point: the centre written, every other field its type's default", () => {
        const created = racks.create(some({ x: 1.0, y: 2.0 }), none);
        if (created.type !== "some") assert.fail("a rack is created at a drop point");
        const row = rackOf(created.value);
        assert.equal(row.x, 1.0);
        assert.equal(row.y, 2.0);
        assert.equal(row.name, "");
        assert.equal(row.notes.type, "none");
    });

    hostTest("a drafted row's roles are those its rows give the stored one", () => {
        const rows = racks.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        const read = racks.read(rackBytes(A02), "A02");
        assert.ok(equalFor(Schematic.Types.Item)(read, rows.value.get("A02")!.roles));
    });

    hostTest("the kind on the wire: its slot, its name and icon, its status table, editable with its session and history, its form over the fields no role writes", () => {
        assert.equal(racks.key, "racks");
        assert.equal(racks.name, "Rack");
        assert.equal(racks.icon, "server");
        assert.deepEqual(racks.status.map((s) => s.case), ["hot", "ok"], "each case of the status variant, as East orders them");
        assert.equal(racks.editable, true);
        assert.equal(racks.editing.type, "some");
        assert.equal(racks.history.type, "some");
        assert.equal(racks.entries.type, "none", "a record read whole is read by key from its snapshot");
        assert.deepEqual(racks.fields.map((f) => f.path), [["model"], ["hall"], ["owner"], ["notes"]]);
        assert.ok(isTypeEqual(fromEastTypeValue(racks.rowType), Rack), "its row type, which the renderer decodes a row at");
    });

    hostTest("a kind bound with Data.bind is read only: no session, no history", () => {
        const frames = kindOf(Schematic.Types.ItemKind, ($) => {
            const record = $.let(framesData());
            return Schematic.items(record, { name: "Frame", icon: (f) => f.name, x: "x", y: "y", label: "name" }).build("network");
        });
        assert.equal(frames.editable, false);
        assert.equal(frames.editing.type, "none");
        assert.equal(frames.history.type, "none");
        assert.equal(frames.icon, "", "an accessor's icons are each card's");
        const rows = frames.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        assert.ok(equalFor(OptionType(StringType))(rows.value.get("ODF-1")!.roles.icon, some("ODF-1")));
    });

    hostTest("an item kind whose centre is a pair of Options has a backlog: Unplace writes none, a drop places it, and the unplaced row has no position", () => {
        const slotBytes = encodeBeast2For(Slot);
        const slotOf = decodeBeast2For(Slot);
        const slots = kindOf(Schematic.Types.ItemKind, ($) => {
            const record = $.let(slotsRecord());
            return Schematic.items(record, { name: "Slot", icon: "server", x: "x", y: "y", label: "name" }).build("slots");
        });
        assert.equal(slots.backlog, true);
        const s1 = SLOTS.get("S1")!;
        const unplaced = slots.write(slotBytes(s1), none);
        if (unplaced.type !== "some") assert.fail("a backlog kind's row is unplaced");
        assert.ok(equalFor(Slot)(slotOf(unplaced.value), { ...s1, x: none, y: none }));
        const placed = slots.write(slotBytes(SLOTS.get("S2")!), some({ x: 3.0, y: 4.0 }));
        if (placed.type !== "some") assert.fail("a drop places an unplaced row");
        assert.ok(equalFor(Slot)(slotOf(placed.value), { ...SLOTS.get("S2")!, x: some(3.0), y: some(4.0) }));
        const rows = slots.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        assert.equal(rows.value.get("S2")!.roles.position.type, "none");
    });
});

describe("a link kind's, a net kind's, a zone kind's and a details record's closed functions, over decoded bytes", () => {
    const FibreType = Fibre;
    const fibreBytes = encodeBeast2For(FibreType);
    const fibreOf = decodeBeast2For(FibreType);
    const links = kindOf(Schematic.Types.LinkKind, ($) => {
        const record = $.let(fibreRecord());
        return Schematic.links(record, {
            name: "Fibre run", icon: "bolt", via: "path",
            from: { field: "from", of: { rack: "racks", frame: "network" } }, to: { field: "to", of: { rack: "racks", frame: "network" } },
            metric: (f) => some(f.speed),
        }).build("fibre");
    });

    hostTest("a link's ends are references to items, by their slot and key; its style and route default to solid and orthogonal", () => {
        const rows = links.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        const u1 = rows.value.get("u1")!.roles;
        assert.ok(equalFor(Schematic.Types.Ref)(u1.from, refOf("racks", "A01")));
        assert.ok(equalFor(Schematic.Types.Ref)(u1.to, refOf("network", "ODF-1")));
        assert.equal(u1.style.type, "solid");
        assert.equal(u1.route.type, "orthogonal");
        assert.deepEqual(u1.via, [{ x: 4.0, y: 6.0 }]);
        assert.ok(equalFor(OptionType(StringType))(u1.metric, some("100G")));
        assert.deepEqual(links.ends, { from: ["racks", "network"], to: ["racks", "network"] });
    });

    hostTest("Connect and Retarget write the ends alone, each to its case; an end of a slot the field holds no keys of writes nothing", () => {
        const u1 = FIBRE.get("u1")!;
        const retargeted = links.write(fibreBytes(u1), { from: refOf("network", "ODF-1"), to: refOf("racks", "A02") });
        if (retargeted.type !== "some") assert.fail("both ends are of the slots the fields hold");
        assert.ok(equalFor(FibreType)(fibreOf(retargeted.value), { ...u1, from: variant("frame", "ODF-1"), to: variant("rack", "A02") }));
        assert.equal(links.write(fibreBytes(u1), { from: refOf("cooling", "CRAH-1"), to: refOf("racks", "A02") }).type, "none");
        const created = links.create({ from: refOf("racks", "A01"), to: refOf("racks", "A02") }, none);
        if (created.type !== "some") assert.fail("Connect records a link");
        const row = fibreOf(created.value);
        assert.ok(equalFor(End)(row.from, variant("rack", "A01")));
        assert.equal(row.speed, "", "every other field its type's default");
    });

    hostTest("a net's sides are references to items; its writes write the sides alone, Set or Array as the field holds them", () => {
        const FeedBytes = encodeBeast2For(Feed);
        const feedOf = decodeBeast2For(Feed);
        const nets = kindOf(Schematic.Types.NetKind, ($) => {
            const record = $.let(feedsRecord());
            return Schematic.nets(record, { name: "Feed", icon: "plug", sources: { field: "supply", of: "racks" }, destinations: { field: "racks", of: "racks" } }).build("feeds");
        });
        const rows = nets.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        assert.ok(equalFor(ArrayType(Schematic.Types.Ref))(rows.value.get("f1")!.roles.sources, [refOf("racks", "A01")]));
        assert.ok(equalFor(ArrayType(Schematic.Types.Ref))(rows.value.get("f1")!.roles.destinations, [refOf("racks", "A02")]));
        const f1 = FEEDS.get("f1")!;
        const extended = nets.write(FeedBytes(f1), { sources: [refOf("racks", "A01")], destinations: [refOf("racks", "A02"), refOf("racks", "A03")] });
        if (extended.type !== "some") assert.fail("a net extended");
        assert.ok(equalFor(Feed)(feedOf(extended.value), { ...f1, racks: ["A02", "A03"] }));
        assert.equal(nets.write(FeedBytes(f1), { sources: [refOf("network", "ODF-1")], destinations: [] }).type, "none", "a member of another slot");
        assert.deepEqual(nets.sides, { sources: "racks", destinations: "racks" });
    });

    hostTest("a zone's pattern defaults to an outline; its shape crosses about its box's centre", () => {
        const zones = kindOf(Schematic.Types.ZoneKind, ($) => {
            const record = $.let(areasData());
            return Schematic.zones(record, { name: "Area", icon: "vector-square", x: "x", y: "y", width: "w", height: "h", label: "name", geometry: "shape" }).build("areas");
        });
        const rows = zones.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        const hall = rows.value.get("hall-1")!.roles;
        assert.equal(hall.pattern.type, "outline");
        assert.ok(equalFor(OptionType(Schematic.Types.Geometry))(hall.geometry, some(variant("circle", { radius: 4.0 }))));
        assert.equal(hall.width, 20.0);
    });

    hostTest("a kind's details give its cards' status, bar and figure, read whole beside a kind read whole", () => {
        const racks = kindOf(Schematic.Types.ItemKind, ($) => {
            const record = $.let(racksRecord());
            const loads = $.let(loadsData());
            return Schematic.items(record, {
                name: "Rack", icon: "server", x: "x", y: "y", label: "name",
                details: Schematic.details(loads, {
                    meter: (l) => ({ value: l.kw, max: l.cap }),
                    metric: (l) => some(East.str`${East.Float.printFixed(l.kw, 1n)} kW`),
                    status: { field: "alarm", cases: { ok: { label: "OK", tone: variant("success", null), ring: false }, hot: { label: "Hot", tone: variant("danger", null), ring: false } } },
                }),
            }).build("racks");
        });
        if (racks.details.type !== "some") assert.fail("the kind carries its details");
        const details = racks.details.value;
        if (details.rows.type !== "some") assert.fail("details read whole beside a kind read whole");
        const read = details.rows.value();
        if (read.type !== "some") assert.fail("a record read whole holds its rows");
        const a01 = read.value.get("A01")!.roles;
        assert.ok(equalFor(OptionType(Schematic.Types.Meter))(a01.meter, some({ value: 5.0, max: 8.0 })));
        assert.ok(equalFor(OptionType(StringType))(a01.metric, some("5.0 kW")));
        assert.ok(equalFor(OptionType(Schematic.Types.Status))(a01.status, some({ label: "Hot", tone: variant("danger", null), ring: false })));
        assert.equal(read.value.has("A02"), false, "a rack with no details row shows none");
        assert.equal(details.editable, false);
    });
});

// ============================================================================
// The payload and the carrier
// ============================================================================

describe("<Schematic>'s payload, through its carrier", () => {
    hostTest("<Schematic> returns its payload through the `Schematic` carrier: its kinds by slot, in order, and its defaults", () => {
        const payload = carried(($) => {
            const racks = $.let(racksRecord());
            const frames = $.let(framesData());
            return PublicSchematic({
                extent: { width: 28, height: 12 }, scaleUnit: "m",
                items: {
                    racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", label: "name" }),
                    network: Schematic.items(frames, { name: "Frame", icon: "network-wired", x: "x", y: "y", label: "name" }),
                },
            });
        });
        assert.deepEqual(payload.items.map((kind) => kind.key), ["racks", "network"]);
        assert.deepEqual(payload.extent, { width: 28, height: 12 });
        assert.ok(equalFor(OptionType(StringType))(payload.scaleUnit, some("m")));
        assert.deepEqual([payload.zones.length, payload.links.length, payload.nets.length, payload.layers.length, payload.library.length], [0, 0, 0, 0, 0]);
        assert.equal(payload.inspector, true, "the inspector is on by default");
        assert.equal(payload.readOnly, false);
        assert.equal(payload.slice.type, "none");
        assert.equal(payload.shown.size, 0);
        assert.equal(payload.narrowed.show.type, "hide", "a narrowed-out row is hidden by default");
        assert.equal(payload.narrowed.opacity, 0.35);
        assert.equal(payload.narrowed.desaturate, true);
        assert.equal(payload.name.type, "none");
        for (const callback of [payload.canConnect, payload.onSelectionChange, payload.onZoneSelectionChange, payload.onSelectLink, payload.onViewportChange, payload.onItemOpen]) {
            assert.equal(callback.type, "none");
        }
    });

    hostTest("`narrowed`, `inspector`, `readOnly`, `name`, layers and the host's callbacks cross as given", () => {
        const payload = carried(($) => floor($, {
            narrowed: { show: "dim", opacity: 0.2, dot: true, emphasis: "pulse", frame: true, fit: true },
            inspector: false, readOnly: true, name: "hall-1",
            layers: [{ key: "power", label: "Power", tone: "warning", locked: true }],
            onItemOpen: East.function([Schematic.Types.Ref], NullType, (_$, _ref) => null),
            canConnect: East.function([Schematic.Types.Ref, Schematic.Types.Ref], BooleanType, (_$, from, to) => East.notEqual(from.kind, to.kind)),
        }));
        assert.equal(payload.narrowed.show.type, "dim");
        assert.equal(payload.narrowed.opacity, 0.2);
        assert.equal(payload.narrowed.dot, true);
        assert.ok(equalFor(OptionType(Schematic.Types.Emphasis))(payload.narrowed.emphasis, some(variant("pulse", null))));
        assert.equal(payload.inspector, false);
        assert.equal(payload.readOnly, true);
        assert.ok(equalFor(OptionType(StringType))(payload.name, some("hall-1")));
        assert.ok(equalFor(ArrayType(Schematic.Types.Layer))(payload.layers, [{ key: "power", label: "Power", visible: none, locked: some(true), opacity: none, tone: some(variant("warning", null)) }]));
        assert.equal(payload.onItemOpen.type, "some");
        if (payload.canConnect.type !== "some") assert.fail("the veto crosses");
        assert.equal(payload.canConnect.value(refOf("racks", "A01"), refOf("racks", "A02")), false);
        assert.equal(payload.canConnect.value(refOf("racks", "A01"), refOf("network", "ODF-1")), true);
    });

    hostTest("`inspector={{ <slot>: Details }}` gives that kind its own Details, over bytes", () => {
        const payload = carried(($) => floor($, {
            inspector: { racks: East.function([Rack, FunctionType([Rack], NullType)], UIComponentType, (_$2, r) => Text.Root(r.name)) },
        }));
        assert.equal(payload.inspector, true);
        assert.equal(payload.items[0]!.inspector.type, "some");
    });

    hostTest("the keys a Schematic keeps its viewer's state under, by its name", () => {
        assert.deepEqual(schematicKeys(undefined), {
            frame: "schematic.frame", library: "schematic.library", layers: "schematic.layers", tools: "schematic.tools", surface: "schematic.surface",
        });
        assert.deepEqual(schematicKeys("hall-1"), {
            frame: "schematic.hall-1.frame", library: "schematic.library.hall-1", layers: "schematic.hall-1.layers", tools: "schematic.hall-1.tools", surface: "schematic.hall-1.surface",
        });
    });

    hostTest("the public namespace carries the value types, the helpers and the kinds", () => {
        assert.equal(PublicSchematic.Types.Geometry, Schematic.Types.Geometry);
        assert.ok(isTypeEqual(PublicSchematic.Types.Ref, StructType({ kind: StringType, key: StringType })));
        assert.ok(isTypeEqual(PublicSchematic.Types.Box, StructType({ minX: FloatType, minY: FloatType, maxX: FloatType, maxY: FloatType })));
        assert.ok(isTypeEqual(PublicSchematic.Types.Patch(Rack).fields.name, OptionType(StringType)));
        assert.equal(typeof PublicSchematic.items, "function");
        assert.equal(typeof PublicSchematic.library.index, "function");
        assert.equal((PublicSchematic as unknown as Record<string, unknown>)["Payload"], undefined, "the payload is the internal namespace's");
    });
});

// ============================================================================
// The library's tabs on the wire
// ============================================================================

describe("the library's tabs on the wire (§8)", () => {
    type Tabs = ValueTypeOf<ArrayType<typeof Schematic.Types.LibraryTab>>;
    const kinds = [
        { slot: "racks", sort: "items" as const, rowType: Rack, templates: true, backlog: false },
        { slot: "slots", sort: "items" as const, rowType: Slot, templates: false, backlog: true },
        { slot: "areas", sort: "zones" as const, rowType: Area, templates: false, backlog: false },
        { slot: "fibre", sort: "links" as const, rowType: Fibre, templates: false, backlog: false },
    ];
    const wire = (tabs: unknown, layers = 1, list = kinds) =>
        East.compile(East.function([], ArrayType(Schematic.Types.LibraryTab), (_$) => buildSchematicLibrary(tabs, { kinds: list, layers, sources: [] })), [])() as Tabs;

    hostTest("each tab in the order `library` lists it", () => {
        const tabs = wire([Schematic.library.templates("racks"), Schematic.library.unplaced("slots"), Schematic.library.index(), Schematic.library.layers()]);
        assert.deepEqual(tabs.map((tab) => tab.type), ["templates", "unplaced", "index", "layers"]);
        assert.deepEqual(tabs[0], variant("templates", "racks"));
        assert.deepEqual(tabs[1], variant("unplaced", "slots"));
        assert.deepEqual(wire(undefined), []);
    });

    hostTest("each tab's refusals, naming the tab and the change", () => {
        assert.throws(() => wire([Schematic.library.index(), Schematic.library.index()]), /Schematic: the library lists Schematic\.library\.index\(\) twice — each tab once/);
        assert.throws(() => wire([Schematic.library.templates("cages")]), /the library lists Schematic\.library\.templates\("cages"\), and no kind is in the slot "cages" — its kinds' slots are "racks", "slots", "areas", "fibre"/);
        assert.throws(() => wire([Schematic.library.templates("areas")]), /"areas" is a zone kind — zones take no templates/);
        assert.throws(() => wire([Schematic.library.templates("fibre")]), /the link kind "fibre" has no templates — give it templates: Schematic\.templates/);
        assert.throws(() => wire([Schematic.library.unplaced("fibre")]), /"fibre" is a link kind — the Unplaced tab lists an item kind's rows with no position/);
        assert.throws(() => wire([Schematic.library.unplaced("racks")]), /the item kind "racks" places every row — its `x` and `y` are Float fields: make them Options of Float to give it rows with no position/);
        assert.throws(() => wire([Schematic.library.index()], 1, kinds.filter((k) => k.sort !== "zones")), /this Schematic has no zone kinds — the Index tab lists the zones \(Schematic\.zones\)/);
        assert.throws(() => wire([Schematic.library.layers()], 0), /this Schematic declares no layers — declare them: layers=\{\[\{ key, label \}\]\}/);
        assert.throws(() => wire(["index"]), /Schematic: `library` lists the library pane's tabs, in order, each a Schematic\.library\.\* call/);
    });

    hostTest("an author's card drops a Schematic.patch over one kind's row type, which names the kind it lands on", () => {
        const Owner = StructType({ name: StringType });
        const owners = new Map([["harbour", { name: "Harbour Labs" }]]);
        const tabs = East.compile(East.function([], ArrayType(Schematic.Types.LibraryTab), (_$) => buildSchematicLibrary([
            Schematic.library.tab(East.value(owners, DictType(StringType, Owner)), {
                name: "Owners", icon: "building", label: (o) => o.name, drop: (o) => Schematic.patch(Rack, { owner: o.name }),
            }),
        ], { kinds, layers: 0, sources: [] })), [])() as Tabs;
        const tab = tabs[0]!;
        if (tab.type !== "tab") assert.fail("the author's tab");
        assert.ok(equalFor(OptionType(StringType))(tab.value.drop, some("racks")));
        assert.deepEqual(tab.value.cards.map((card) => [card.key, card.label, card.sets.map((s) => s.path)]), [["harbour", "Harbour Labs", [["owner"]]]]);
        assert.throws(() => buildSchematicLibrary([Schematic.library.tab(East.value(owners, DictType(StringType, Owner)), {
            name: "Owners", label: (o) => o.name, drop: (o) => Schematic.patch(Owner, { name: o.name }),
        })], { kinds, layers: 0, sources: [] }), /Schematic: the "Owners" tab's `drop` returns a patch over no kind's row type — build it with Schematic\.patch\(RowType, \{ … \}\) over the row type of the kind its cards land on \(racks, slots, areas, fibre\)/);
    });
});
