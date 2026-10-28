/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's kinds, payload and tag (#1386, #1401, `Schematic Builder
 * Spec.md` §1, §2, §4, §5): each role's check (SC1); a gesture's write of only
 * its roles' fields (SC2); each prop §2 removes refused, naming its
 * replacement (SC3); each binding a kind's read doesn't take refused, naming
 * the form to use (SC33); geometry built by an accessor from the row's own
 * fields and carried about its anchor, and a footprint without its box refused
 * (SC35); the layers read from the app's rows (SC37); the library's tabs over
 * every kind (SC38); and the kinds' closed functions over decoded bytes — each
 * kind built over a record handle as the record runtime gives one, run, and
 * its rows, roles and writes read back at the record's own row type.
 */

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import {
    ArrayType, BlobType, BooleanType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, PatchType, SetType, StringType, StructType, VariantType,
    decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, isTypeEqual, none, some, variant, type BlockBuilder, type EastType, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Slice, UIComponentType } from "@elaraai/east-ui";
import { Text } from "@elaraai/east-ui/internal";
import { DatasetStatusType, RecordCommitInfoType } from "@elaraai/e3-types";
import {
    Data, DataBindHandleType, Record, RecordBindHandleType, RecordErrorType, RecordMutateStatusType, RecordOutcomeType, Schematic as PublicSchematic,
} from "@elaraai/e3-ui";
import { Schematic, SchematicBoxFieldsType, SchematicPayloadType, buildSchematicLibrary, schematicKeys } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import * as ex from "./schematic.examples.js";

/** An index over the floor's racks' model: what the binding matrix's source reads them through, built and never run. */
const floorRacksByModel = e3.recordIndex("schematic_floor_racks_by_model", ex.schematicFloorRacks, { on: ["model"] });

describeEast("Schematic", (test) => {
    Assert.examples(test, {
        schematicFloor: ex.schematicFloor,
        schematicHandover: ex.schematicHandover,
        schematicShapes: ex.schematicShapes,
        schematicDataCentre: ex.schematicDataCentre,
    });
}, { platformFns: TestImpl });

// ============================================================================
// Fixtures: records of the app's, and handles as their runtimes give them
// ============================================================================

const Alarm = VariantType({ ok: NullType, hot: NullType });
/** A corner of a rack's outline, about its centre: the app's own point. */
const Corner = StructType({ x: FloatType, y: FloatType });
/**
 * A rack with fields of its own beside its roles' — `hall`, `owner` and `notes` — which no gesture writes, and its own
 * outline's corners, which its footprint's accessor draws (D35).
 */
const Rack = StructType({
    name: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType, model: StringType, alarm: Alarm,
    corners: ArrayType(Corner), system: StringType, hall: StringType, owner: StringType, notes: OptionType(StringType),
});
const Racks = DictType(StringType, Rack);
type RackRow = ValueTypeOf<typeof Rack>;
const A01: RackRow = {
    name: "A01", x: 2.4, y: 2.9, w: 3.2, h: 1.2, model: "42U", alarm: variant("ok", null),
    corners: [{ x: -1.6, y: -0.6 }, { x: 1.6, y: -0.6 }, { x: 1.6, y: 0.6 }],
    system: "power", hall: "Hall 1", owner: "Harbour Labs", notes: some("cold aisle side"),
};
const A02: RackRow = {
    name: "A02", x: 6.0, y: 2.9, w: 3.2, h: 1.2, model: "48U", alarm: variant("hot", null), corners: [],
    system: "power", hall: "Hall 1", owner: "Northwind Media", notes: none,
};
/** A01's footprint as its accessor builds it from its corners: a polygon about its centre, each corner a bulge of 0. */
const A01_FOOTPRINT = some(variant("polygon", { vertices: [{ x: -1.6, y: -0.6, bulge: 0.0 }, { x: 1.6, y: -0.6, bulge: 0.0 }, { x: 1.6, y: 0.6, bulge: 0.0 }] }));
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
/** A fibre run between two ends, with fields of its own beside its roles'; its path the app's own points. */
const Fibre = StructType({ from: End, to: End, path: ArrayType(Corner), speed: StringType, colour: StringType });
const FIBRE = new Map([["u1", { from: variant("rack", "A01"), to: variant("frame", "ODF-1"), path: [{ x: 4.0, y: 6.0 }], speed: "100G", colour: "aqua" }]]);

/** A power feed, its supply a Set and its racks an Array. */
const Feed = StructType({ supply: SetType(StringType), racks: ArrayType(StringType), name: StringType });
const FEEDS = new Map([["f1", { supply: new Set(["A01"]), racks: ["A02"], name: "Feed 1" }]]);

/** A round hall: its box, and its own radius, which its shape's accessor draws (D35). */
const Area = StructType({ name: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType, radius: FloatType });
const AREAS = new Map([["hall-1", { name: "Hall 1", x: 0.0, y: 0.0, w: 20.0, h: 10.0, radius: 4.0 }]]);

/** A system the app's entities belong to: a layer, from the app's own record (D36). */
const System = StructType({ label: StringType, colour: StringType, order: IntegerType, fixed: BooleanType });
const SYSTEMS = new Map([
    ["power", { label: "Power", colour: "status.warn", order: 2n, fixed: false }],
    ["structure", { label: "Structure", colour: "fg.muted", order: 1n, fixed: true }],
]);

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
const blobEqual = equalFor(BlobType);
const boxEqual = equalFor(SchematicBoxFieldsType);
/** The rows a reader read of a record by area or by key, as a kind's `rowsOf` takes them: an Array of `{ key, row }`, as bytes. */
const readOf = <R extends StructType>(row: R, read: { key: string; row: ValueTypeOf<R> }[]) => encodeBeast2For(ArrayType(StructType({ key: StringType, row })))(read as never);

// ============================================================================
// SC1, SC35: each role checked at build
// ============================================================================

describe("each role is a field of the app's row, named and checked (SC1)", () => {
    const items = (config: object) => built(($) => {
        const racks = $.let(racksRecord());
        return PublicSchematic({ extent: { width: 20, height: 10 }, items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", label: "name", ...config } as never) } });
    });

    hostTest("a role naming a field the row lacks is refused, naming the role, the field and the row's fields", () => {
        assert.throws(() => items({ x: "left" }), /^Error: Schematic\.items: "Rack": `x` names "left", a field the row does not have \(name, x, y, w, h, model, alarm, corners, system, hall, owner, notes\)$/);
        assert.throws(() => items({ layer: "tier" }), /`layer` names "tier", a field the row does not have/);
    });

    hostTest("a role naming a field of another type is refused, naming the role, the field and its type", () => {
        assert.throws(() => items({ label: "w" }), /Schematic\.items: "Rack": `label` names a String field — "w" holds \.Float/);
        assert.throws(() => items({ width: "name", height: "h" }), /`width` names a Float field — "name" holds \.String/);
        assert.throws(() => items({ layer: "w" }), /`layer` names a String field — "w" holds \.Float/);
        assert.throws(() => items({ x: "name" }), /`x` names a Float field, or an Option of one — "name" holds \.String/);
    });

    hostTest("a footprint is an accessor over the row's own fields: one naming a field is refused, naming the accessor to write (D35)", () => {
        assert.throws(() => items({ width: "w", height: "h", footprint: "corners" }),
            /^Error: Schematic\.items: "Rack": `footprint` is an accessor over the row's own fields, built with Schematic\.circle, polygon, polyline or rect — footprint: \(unit\) => some\(Schematic\.circle\(unit\.radius\)\): a role naming "corners", a field that holds Schematic\.Types\.Geometry, is gone/);
        assert.throws(() => items({ width: "w", height: "h", footprint: (r: ExprType<typeof Rack>) => r.name }),
            /`footprint` returns an Option of a Schematic\.Types\.Geometry, built with Schematic\.circle, polygon, polyline or rect \(footprint: \(unit\) => some\(Schematic\.circle\(unit\.radius\)\)\) — and this one returns \.String/);
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
        const footprint = (r: ExprType<typeof Rack>) => some(Schematic.polygon(r.corners));
        assert.throws(() => items({ footprint }), /`footprint` is drawn about the item's centre, inside its box — give `width` and `height` with it, the box's Float fields/);
        assert.throws(() => items({ footprint, width: "w" }), /give `width` and `height` with it/);
        assert.doesNotThrow(() => items({ footprint, width: "w", height: "h" }));
    });

    hostTest("a status is a variant field every row holds, a Status per case", () => {
        assert.throws(() => items({ status: { field: "name", cases: {} } }), /`status\.field` names a variant field every row holds, a Status per case — "name" holds \.String/);
        assert.throws(() => items({ status: { field: "notes", cases: {} } }), /`status\.field` names a variant field every row holds, a Status per case — "notes" holds an Option of \.String/);
    });

    hostTest("a zone's box is four Float fields; its pattern an accessor of a ZonePattern; its shape an accessor of an Option of a Geometry", () => {
        const zones = (config: object) => built(($) => {
            const racks = $.let(racksRecord());
            const areas = $.let(areasData());
            return PublicSchematic({
                extent: { width: 20, height: 10 },
                items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", label: "name" }) },
                zones: { areas: Schematic.zones(areas, { name: "Area", icon: "vector-square", x: "x", y: "y", width: "w", height: "h", label: "name", ...config } as never) },
            });
        });
        assert.doesNotThrow(() => zones({ geometry: (a: ExprType<typeof Area>) => some(Schematic.circle(a.radius)) }));
        assert.throws(() => zones({ width: "name" }), /Schematic\.zones: "Area": `width` names a Float field — "name" holds \.String/);
        assert.throws(() => zones({ pattern: (a: ExprType<typeof Area>) => a.name }), /`pattern` returns a Schematic\.Types\.ZonePattern — and this one returns \.String/);
        assert.throws(() => zones({ geometry: "radius" }),
            /Schematic\.zones: "Area": `geometry` is an accessor over the row's own fields, built with Schematic\.circle, polygon, polyline or rect — geometry: \(area\) => some\(Schematic\.polygon\(area\.corners\)\): a role naming "radius", a field that holds Schematic\.Types\.Geometry, is gone/);
        assert.throws(() => zones({ geometry: (a: ExprType<typeof Area>) => a.name }), /`geometry` returns an Option of a Schematic\.Types\.Geometry, built with .* — and this one returns \.String/);
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
        ["itemHover", fn, /`itemHover` is gone — the inspector shows what is selected — give `inspector` for the pane, and a kind its own Details with its `inspector`/],
        ["zoneHover", fn, /`zoneHover` is gone — the inspector shows what is selected/],
        ["linkHover", fn, /`linkHover` is gone — the inspector shows what is selected/],
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
        ["onSelectZone", fn, /`onSelectZone` is gone — `onSelect` hears the whole selection after each change, items, zones, links and nets alike, each by its kind and key/],
        ["onSelectionChange", fn, /`onSelectionChange` is gone — `onSelect` hears the whole selection after each change, items, zones, links and nets alike, each by its kind and key: onSelect=\{East\.function\(\[ArrayType\(Schematic\.Types\.Ref\)\], NullType/],
        ["onZoneSelectionChange", fn, /`onZoneSelectionChange` is gone — `onSelect` hears the whole selection/],
        ["onSelectLink", fn, /`onSelectLink` is gone — `onSelect` hears the whole selection/],
        ["onViewportChange", fn, /`onViewportChange` is gone — the canvas reads its own window, and nothing hears where the camera settled — leave it out/],
        ["onItemOpen", fn, /`onItemOpen` is gone — Enter or a double-click opens the selection in the inspector's Details — give `inspector`, and a kind its own Details with its `inspector`/],
        ["selectZoomFocus", true, /`selectZoomFocus` is gone — a tap selects in place, and Find, the Index tab and the arrow keys fly to what they pick — leave it out/],
        ["name", "hall-1", /`name` is gone — `id` names the Schematic, as the Plan's, the Roster's and the Calendar's do: <Schematic id="floor" … \/>/],
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

    hostTest("`narrowed`, `layers`, `inspector` and `id` take their forms, and nothing else", () => {
        assert.throws(() => built(($) => floor($, { narrowed: "ghost" })), /Schematic: `narrowed` is "hide" \(the default\), "dim", or \{ show: "hide" \| "dim", opacity\?: 0–1/);
        assert.throws(() => built(($) => floor($, { narrowed: { show: "dim", opacity: 2 } })), /`narrowed` is "hide" \(the default\)/);
        assert.throws(() => built(($) => floor($, { layers: [{ key: "power", label: "Power" }] })),
            /^Error: Schematic: `layers` reads the app's own rows, as the Roster's lists do — layers=\{Schematic\.layers\(systems\.read\(\), \{ label: \(s\) => s\.label, order\?, tone\?, color\?, visible\?, locked\?, opacity\? \}\)\}: a list written in the code is gone/);
        assert.throws(() => built(($) => floor($, { layers: "power" })), /^Error: Schematic: `layers` is layers=\{Schematic\.layers\(systems\.read\(\)/);
        const own = East.function([Rack, FunctionType([Rack], NullType)], UIComponentType, (_$2, r) => Text.Root(r.name));
        assert.throws(() => built(($) => floor($, { inspector: { racks: own } })),
            /^Error: Schematic: `inspector` is true or false — a kind's own Details is its kind's `inspector`: Schematic\.items\(record, \{ …, inspector: East\.function/);
        assert.throws(() => built(($) => floor($, { inspector: "yes" })), /`inspector` is true or false/);
        assert.throws(() => built(($) => {
            const racks = $.let(racksRecord());
            return PublicSchematic({
                extent: { width: 20, height: 10 },
                items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", label: "name", inspector: East.function([StringType], UIComponentType, (_$2, t) => Text.Root(t)) as never }) },
            });
        }), /`inspector` is the kind's own Details — an East\.function over the row and its writer/);
        assert.throws(() => built(($) => floor($, { id: 7 })), /Schematic: `id` keeps the Schematic's state apart — a string, needed only when one surface holds two/);
    });
});

// ============================================================================
// The kinds' closed functions over decoded bytes (SC2, SC35)
// ============================================================================

describe("an item kind's closed functions, over decoded bytes (SC2, SC35)", () => {
    const racks = kindOf(Schematic.Types.ItemKind, ($) => {
        const record = $.let(racksRecord());
        return Schematic.items(record, {
            name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system",
            // Its footprint from its own corners, or none without them (D35).
            footprint: (r) => r.corners.size().greater(0n).ifElse((_$2) => some(Schematic.polygon(r.corners)), (_$2) => none),
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
        assert.ok(equalFor(OptionType(Schematic.Types.Geometry))(a01.roles.footprint, A01_FOOTPRINT), "the footprint its accessor builds from the row's own corners: offsets from the centre");
        assert.equal(rows.value.get("A02")!.roles.footprint.type, "none", "a rack with no corners has none");
    });

    hostTest("a move writes the centre alone: every other field of the rack reads back as it was (SC2)", () => {
        const moved = racks.write(rackBytes(A01), some({ x: 10.0, y: 4.0 }));
        if (moved.type !== "some") assert.fail("a rack with a centre is placed");
        assert.ok(rackEqual(rackOf(moved.value), { ...A01, x: 10.0, y: 4.0 }));
        // The footprint, offsets from the centre, moves with it (SC35): the read places it about the new centre.
        const roles = racks.read(moved.value, "A01");
        assert.ok(equalFor(OptionType(Schematic.Types.Point))(roles.position, some({ x: 10.0, y: 4.0 })));
        assert.ok(equalFor(OptionType(Schematic.Types.Geometry))(roles.footprint, A01_FOOTPRINT));
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

    hostTest("an author's card sets its fields: each write at its path, in order, every other field as it was; a write naming no field writes nothing (#1390)", () => {
        const written = racks.set(rackBytes(A01), [
            { path: ["owner"], value: encodeBeast2For(StringType)("Elmway College") },
            { path: ["notes"], value: encodeBeast2For(OptionType(StringType))(none) },
        ]);
        if (written.type !== "some") assert.fail("both fields are the rack's");
        assert.ok(rackEqual(rackOf(written.value), { ...A01, owner: "Elmway College", notes: none }));
        // A role's field is a field of the row too: a card that sets it moves the rack.
        const moved = racks.set(rackBytes(A01), [{ path: ["x"], value: encodeBeast2For(FloatType)(9.0) }]);
        if (moved.type !== "some") assert.fail("x is the rack's");
        assert.ok(rackEqual(rackOf(moved.value), { ...A01, x: 9.0 }));
        // Two writes of one field: the later one stands.
        const twice = racks.set(rackBytes(A01), [
            { path: ["hall"], value: encodeBeast2For(StringType)("Hall 2") }, { path: ["hall"], value: encodeBeast2For(StringType)("Hall 3") },
        ]);
        if (twice.type !== "some") assert.fail("hall is the rack's");
        assert.equal(rackOf(twice.value).hall, "Hall 3");
        assert.equal(racks.set(rackBytes(A01), [{ path: ["tenant"], value: encodeBeast2For(StringType)("Elmway College") }]).type, "none", "a field the row lacks");
        assert.equal(racks.set(rackBytes(A01), [
            { path: ["owner"], value: encodeBeast2For(StringType)("Elmway College") }, { path: ["owner", "name"], value: encodeBeast2For(StringType)("x") },
        ]).type, "none", "a path into a field that is no struct names no field");
    });

    hostTest("a card's write reaches a field inside a struct of the row by its path, the struct's other fields as they were", () => {
        const Spec = StructType({ units: IntegerType, kw: FloatType });
        const Shelf = StructType({ name: StringType, x: FloatType, y: FloatType, spec: Spec });
        const S1 = { name: "S1", x: 1.0, y: 2.0, spec: { units: 42n, kw: 8.0 } };
        const shelves = kindOf(Schematic.Types.ItemKind, ($) => {
            const record = $.let(recordHandle(DictType(StringType, Shelf), new Map([["S1", S1]]), "shelves")());
            return Schematic.items(record, { name: "Shelf", icon: "server", x: "x", y: "y", label: "name" }).build("shelves");
        });
        const written = shelves.set(encodeBeast2For(Shelf)(S1), [{ path: ["spec", "kw"], value: encodeBeast2For(FloatType)(12.0) }]);
        if (written.type !== "some") assert.fail("spec.kw is the shelf's");
        assert.ok(equalFor(Shelf)(decodeBeast2For(Shelf)(written.value), { ...S1, spec: { units: 42n, kw: 12.0 } }));
        // The struct whole is a field too.
        const whole = shelves.set(encodeBeast2For(Shelf)(S1), [{ path: ["spec"], value: encodeBeast2For(Spec)({ units: 48n, kw: 12.0 }) }]);
        if (whole.type !== "some") assert.fail("spec is the shelf's");
        assert.ok(equalFor(Shelf)(decodeBeast2For(Shelf)(whole.value), { ...S1, spec: { units: 48n, kw: 12.0 } }));
    });

    hostTest("a drafted row's roles are those its rows give the stored one", () => {
        const rows = racks.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        const read = racks.read(rackBytes(A02), "A02");
        assert.ok(equalFor(Schematic.Types.Item)(read, rows.value.get("A02")!.roles));
    });

    hostTest("the rows a reader read by area or by key are made its stored items: each one's roles beside its bytes, as its rows give them (#1393)", () => {
        const rows = racks.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        const made = racks.rowsOf(readOf(Rack, [{ key: "A02", row: A02 }, { key: "A01", row: A01 }]));
        assert.deepEqual([...made.keys()], ["A01", "A02"], "by key, whatever order the reader read them in");
        for (const key of ["A01", "A02"]) {
            assert.ok(equalFor(Schematic.Types.Item)(made.get(key)!.roles, rows.value.get(key)!.roles), `${key}'s roles`);
            assert.ok(blobEqual(made.get(key)!.row, rows.value.get(key)!.row), `${key}'s row, as bytes at the record's row type`);
        }
        assert.equal(racks.rowsOf(readOf(Rack, [])).size, 0, "nothing read, nothing made");
    });

    hostTest("its box is the fields its roles place it by, at its centre: what an area index it is read by names (#1393, §11.4)", () => {
        assert.ok(boxEqual(racks.box, { x: "x", y: "y", width: some("w"), height: some("h") }));
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
        assert.equal(racks.paged.type, "none", "and through no paged read: a far end of a kind read whole is in its rows (#1393)");
        assert.deepEqual(racks.fields.map((f) => f.path), [["model"], ["corners"], ["hall"], ["owner"], ["notes"]], "the row's own corners among them: no role writes them");
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
        assert.ok(boxEqual(frames.box, { x: "x", y: "y", width: none, height: none }), "a kind with no box places points");
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

    hostTest("a zone's pattern defaults to an outline; its shape, built from the row's own radius, crosses about its box's centre", () => {
        const zones = kindOf(Schematic.Types.ZoneKind, ($) => {
            const record = $.let(areasData());
            return Schematic.zones(record, {
                name: "Area", icon: "vector-square", x: "x", y: "y", width: "w", height: "h", label: "name", geometry: (a) => some(Schematic.circle(a.radius)),
            }).build("areas");
        });
        const rows = zones.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        const hall = rows.value.get("hall-1")!.roles;
        assert.equal(hall.pattern.type, "outline");
        assert.ok(equalFor(OptionType(Schematic.Types.Geometry))(hall.geometry, some(variant("circle", { radius: 4.0 }))));
        assert.equal(hall.width, 20.0);
        // Read by area, its rows are made its stored zones as its rows give them; its box is placed by its corner (#1393).
        const made = zones.rowsOf(readOf(Area, [{ key: "hall-1", row: AREAS.get("hall-1")! }]));
        assert.ok(equalFor(Schematic.Types.Zone)(made.get("hall-1")!.roles, hall));
        assert.ok(boxEqual(zones.box, { x: "x", y: "y", width: some("w"), height: some("h") }));
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
        // Rows a reader read by key are made the details' stored rows as their rows give them; read whole, they name no paged read (#1393).
        const made = details.rowsOf(readOf(Load, [{ key: "A01", row: LOADS.get("A01")! }]));
        assert.ok(equalFor(Schematic.Types.DetailsRoles)(made.get("A01")!.roles, a01));
        assert.ok(blobEqual(made.get("A01")!.row, read.value.get("A01")!.row));
        assert.equal(details.paged.type, "none", "details read whole are read by no paged read");
        // A details row's fields are set as a kind's are.
        const set = details.set(encodeBeast2For(Load)(LOADS.get("A01")!), [{ path: ["kw"], value: encodeBeast2For(FloatType)(6.5) }]);
        if (set.type !== "some") assert.fail("kw is the load's");
        assert.ok(equalFor(Load)(decodeBeast2For(Load)(set.value), { kw: 6.5, cap: 8.0, alarm: variant("hot", null) }));
    });

    hostTest("a link's and a net's fields are set as an item's are: a fibre run's speed, a feed's name", () => {
        const u1 = FIBRE.get("u1")!;
        const fibre = links.set(fibreBytes(u1), [{ path: ["speed"], value: encodeBeast2For(StringType)("400G") }]);
        if (fibre.type !== "some") assert.fail("speed is the run's");
        assert.ok(equalFor(FibreType)(fibreOf(fibre.value), { ...u1, speed: "400G" }));
        const nets = kindOf(Schematic.Types.NetKind, ($) => {
            const record = $.let(feedsRecord());
            return Schematic.nets(record, { name: "Feed", icon: "plug", sources: { field: "supply", of: "racks" }, destinations: { field: "racks", of: "racks" } }).build("feeds");
        });
        const f1 = FEEDS.get("f1")!;
        const feed = nets.set(encodeBeast2For(Feed)(f1), [{ path: ["name"], value: encodeBeast2For(StringType)("Feed A") }]);
        if (feed.type !== "some") assert.fail("name is the feed's");
        assert.ok(equalFor(Feed)(decodeBeast2For(Feed)(feed.value), { ...f1, name: "Feed A" }));
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
        assert.equal(payload.inspector, false, "the inspector is opted into, as the Plan's, the Roster's and the Calendar's");
        assert.equal(payload.readOnly, false);
        assert.equal(payload.slice.type, "none");
        assert.equal(payload.shown.size, 0);
        assert.equal(payload.narrowed.show.type, "hide", "a narrowed-out row is hidden by default");
        assert.equal(payload.narrowed.opacity, 0.35);
        assert.equal(payload.narrowed.desaturate, true);
        assert.equal(payload.id.type, "none");
        for (const callback of [payload.canConnect, payload.onSelect]) {
            assert.equal(callback.type, "none");
        }
    });

    hostTest("`narrowed`, `inspector`, `readOnly`, `id`, the layers and the host's callbacks cross as given", () => {
        const payload = carried(($) => {
            const systems = $.const(SYSTEMS, DictType(StringType, System));
            return floor($, {
                narrowed: { show: "dim", opacity: 0.2, dot: true, emphasis: "pulse", frame: true, fit: true },
                inspector: true, readOnly: true, id: "hall-1",
                layers: Schematic.layers(systems, { label: (s) => s.label, color: (s) => some(s.colour), order: (s) => s.order, locked: (s) => s.fixed }),
                onSelect: East.function([ArrayType(Schematic.Types.Ref)], NullType, (_$, _selected) => null),
                canConnect: East.function([Schematic.Types.Candidate], OptionType(StringType), (_$, c) =>
                    East.equal(c.from.kind, c.to.kind).ifElse((_$2) => some("A rack joins a frame"), (_$2) => none)),
            });
        });
        assert.equal(payload.narrowed.show.type, "dim");
        assert.equal(payload.narrowed.opacity, 0.2);
        assert.equal(payload.narrowed.dot, true);
        assert.ok(equalFor(OptionType(Schematic.Types.Emphasis))(payload.narrowed.emphasis, some(variant("pulse", null))));
        assert.equal(payload.inspector, true);
        assert.equal(payload.readOnly, true);
        assert.ok(equalFor(OptionType(StringType))(payload.id, some("hall-1")));
        assert.ok(equalFor(ArrayType(Schematic.Types.Layer))(payload.layers, [
            { key: "structure", label: "Structure", visible: none, locked: some(true), opacity: none, tone: none, color: some("fg.muted") },
            { key: "power", label: "Power", visible: none, locked: some(false), opacity: none, tone: none, color: some("status.warn") },
        ]), "the layers in their order, each keyed by its row's key (SC37)");
        assert.equal(payload.onSelect.type, "some");
        if (payload.canConnect.type !== "some") assert.fail("the veto crosses");
        const words = equalFor(OptionType(StringType));
        assert.ok(words(payload.canConnect.value({ kind: "fibre", from: refOf("racks", "A01"), to: refOf("racks", "A02") }), some("A rack joins a frame")));
        assert.ok(words(payload.canConnect.value({ kind: "fibre", from: refOf("racks", "A01"), to: refOf("network", "ODF-1") }), none));
    });

    hostTest("a kind's own `inspector` gives it Details, over bytes, beside the pane `inspector` opts into", () => {
        const payload = carried(($) => {
            const racks = $.let(racksRecord());
            return PublicSchematic({
                extent: { width: 20, height: 10 }, inspector: true,
                items: { racks: Schematic.items(racks, {
                    name: "Rack", icon: "server", x: "x", y: "y", label: "name",
                    inspector: East.function([Rack, FunctionType([Rack], NullType)], UIComponentType, (_$2, r) => Text.Root(r.name)),
                }) },
            });
        });
        assert.equal(payload.inspector, true);
        assert.equal(payload.items[0]!.inspector.type, "some");
    });

    hostTest("the keys a Schematic keeps its viewer's state under, by its id", () => {
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
        assert.ok(isTypeEqual(PublicSchematic.Types.Candidate, StructType({ kind: StringType, from: PublicSchematic.Types.Ref, to: PublicSchematic.Types.Ref })));
        assert.equal(typeof PublicSchematic.items, "function");
        assert.equal(typeof PublicSchematic.layers, "function");
        assert.equal(typeof PublicSchematic.library.index, "function");
        assert.equal(typeof PublicSchematic.library.backlog, "function");
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
    const wire = (tabs: unknown, layers = true, list = kinds) =>
        East.compile(East.function([], ArrayType(Schematic.Types.LibraryTab), (_$) => buildSchematicLibrary(tabs, { kinds: list, layers, sources: [] })), [])() as Tabs;

    hostTest("each tab in the order `library` lists it, the Templates and the Backlog tabs over every kind (SC38)", () => {
        const tabs = wire([Schematic.library.templates(), Schematic.library.backlog(), Schematic.library.index(), Schematic.library.layers()]);
        assert.deepEqual(tabs.map((tab) => tab.type), ["templates", "backlog", "index", "layers"]);
        assert.deepEqual(tabs[0], variant("templates", null));
        assert.deepEqual(tabs[1], variant("backlog", null));
        assert.deepEqual(wire(undefined), []);
    });

    hostTest("each tab's refusals, naming the tab and the change (SC38)", () => {
        assert.throws(() => wire([Schematic.library.index(), Schematic.library.index()]), /Schematic: the library lists Schematic\.library\.index\(\) twice — each tab once/);
        assert.throws(() => wire([Schematic.library.templates()], true, kinds.map((k) => ({ ...k, templates: false }))),
            /the library lists Schematic\.library\.templates\(\), and none of its kinds has templates — give an item, link or net kind templates: Schematic\.templates/);
        assert.throws(() => wire([Schematic.library.backlog()], true, kinds.filter((k) => k.slot !== "slots")),
            /the library lists Schematic\.library\.backlog\(\), and every item kind places every row — "racks" take Float `x` and `y` fields: make an item kind's Options of Float/);
        assert.throws(() => wire([Schematic.library.index()], true, kinds.filter((k) => k.sort !== "zones")), /this Schematic has no zone kinds — the Index tab lists the zones \(Schematic\.zones\)/);
        assert.throws(() => wire([Schematic.library.layers()], false),
            /this Schematic declares no layers — read them from the app's record: layers=\{Schematic\.layers\(systems\.read\(\), \{ label \}\)\}/);
        assert.throws(() => wire(["index"]), /Schematic: `library` lists the library pane's tabs, in order, each a Schematic\.library\.\* call — templates\(\), backlog\(\), index\(\), layers\(\) or tab/);
    });

    hostTest("a slot given to the tabs over every kind is refused, and so is the Unplaced tab, each naming the form to use (D33)", () => {
        const slotted = (factory: unknown) => (factory as (slot: string) => unknown)("racks");
        assert.throws(() => slotted(Schematic.library.templates),
            /^Error: Schematic\.library\.templates\(\) lists every kind's templates, each kind's under its name, as the Calendar's does — leave the slot out$/);
        assert.throws(() => slotted(Schematic.library.backlog),
            /^Error: Schematic\.library\.backlog\(\) lists every item kind's rows with no position, each kind's under its name, as the Calendar's does — leave the slot out$/);
        assert.throws(() => slotted(Schematic.library.unplaced),
            /^Error: Schematic\.library\.unplaced\(slot\) is gone — Schematic\.library\.backlog\(\) lists every item kind's rows with no position, each kind's under its name$/);
    });

    hostTest("an author's card drops a Schematic.patch over one kind's row type, which names the kind it lands on", () => {
        const Owner = StructType({ name: StringType });
        const owners = new Map([["harbour", { name: "Harbour Labs" }]]);
        const tabs = East.compile(East.function([], ArrayType(Schematic.Types.LibraryTab), (_$) => buildSchematicLibrary([
            Schematic.library.tab(East.value(owners, DictType(StringType, Owner)), {
                name: "Owners", icon: "building", label: (o) => o.name, drop: (o) => Schematic.patch(Rack, { owner: o.name }),
            }),
        ], { kinds, layers: false, sources: [] })), [])() as Tabs;
        const tab = tabs[0]!;
        if (tab.type !== "tab") assert.fail("the author's tab");
        assert.ok(equalFor(OptionType(StringType))(tab.value.drop, some("racks")));
        assert.deepEqual(tab.value.cards.map((card) => [card.key, card.label, card.sets.map((s) => s.path)]), [["harbour", "Harbour Labs", [["owner"]]]]);
        assert.throws(() => buildSchematicLibrary([Schematic.library.tab(East.value(owners, DictType(StringType, Owner)), {
            name: "Owners", label: (o) => o.name, drop: (o) => Schematic.patch(Owner, { name: o.name }),
        })], { kinds, layers: false, sources: [] }), /Schematic: the "Owners" tab's `drop` returns a patch over no kind's row type — build it with Schematic\.patch\(RowType, \{ … \}\) over the row type of the kind its cards land on \(racks, slots, areas, fibre\)/);
    });
});

// ============================================================================
// Schematic.layers: the layers from the app's rows (SC37)
// ============================================================================

describe("Schematic.layers reads the app's rows as the Roster's lists do (SC37, D36)", () => {
    type Layers = ValueTypeOf<ArrayType<typeof Schematic.Types.Layer>>;
    const layersOf = (config: object, rows: unknown = SYSTEMS) => East.compile(East.function([], ArrayType(Schematic.Types.Layer), ($) => {
        const systems = $.const(rows as never, DictType(StringType, System));
        return Schematic.layers(systems, config as never).rows;
    }), [])() as Layers;

    hostTest("each layer keyed by its row's key, in its `order` then key order; with no `order`, in key order", () => {
        assert.deepEqual(layersOf({ label: (s: ExprType<typeof System>) => s.label, order: (s: ExprType<typeof System>) => s.order }).map((l) => l.key), ["structure", "power"]);
        assert.deepEqual(layersOf({ label: (s: ExprType<typeof System>) => s.label }).map((l) => l.key), ["power", "structure"]);
    });

    hostTest("its accessors give each layer's swatch and the author's defaults; left out, each is none", () => {
        const [power] = layersOf({
            label: (s: ExprType<typeof System>) => s.label, tone: (_s: ExprType<typeof System>) => some(variant("warning", null)),
            visible: (_s: ExprType<typeof System>) => false, opacity: (_s: ExprType<typeof System>) => 0.5,
        });
        assert.ok(equalFor(Schematic.Types.Layer)(power!, {
            key: "power", label: "Power", visible: some(false), locked: none, opacity: some(0.5), tone: some(variant("warning", null)), color: none,
        }));
    });

    hostTest("rows that aren't a Dict keyed by String, no `label`, and an accessor of another type are refused, naming them", () => {
        assert.throws(() => built(($) => {
            const listed = $.const([1n, 2n], ArrayType(IntegerType));
            return floor($, { layers: Schematic.layers(listed as never, { label: () => "Power" } as never) });
        }), /^Error: Schematic\.layers: layers are a Dict keyed by String — a record's read\(\) — and these are/);
        assert.throws(() => layersOf({}), /^Error: Schematic\.layers: `label` is an accessor giving each layer's name — Schematic\.layers\(rows, \{ label, order\?, tone\?, color\?, visible\?, locked\?, opacity\? \}\)$/);
        assert.throws(() => layersOf({ label: (s: ExprType<typeof System>) => s.label, order: (s: ExprType<typeof System>) => s.label }),
            /^Error: Schematic\.layers: `order` returns an Integer, where a layer shows — and this one returns \.String$/);
        assert.throws(() => layersOf({ label: (s: ExprType<typeof System>) => s.label, color: "status.warn" }),
            /^Error: Schematic\.layers: `color` is an accessor, \(row, key\) => an Option of a String, a theme colour token$/);
    });
});
