/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic over records keyed by any key type (#1549): a bakehouse — its ovens and its floor's areas keyed by
 * number, its mixers by name, each duct naming two ovens by their numbers, each hose an oven or a mixer at each end,
 * each feed some ovens to others — and a loading dock, its bays keyed by when each opens, its pallet spots by their row
 * and column, and its racks by a variant: on a wall by number, on the floor by name.
 *
 * - Each kind says its record's key type on the wire, and every key travels as its text: a String key as itself, any
 *   other as East prints it.
 * - A link's end and a net's side hold the keys of the item slot they name: a reference prints them, and a write reads
 *   its text back at the field's type, refusing a text no key prints as. An end's `of` decides its shape: a slot per
 *   case reads each case at its own slot's key type, and a slot's name reads the field whole, a variant among them.
 * - An accessor, a card and the details hear a key at its own type, the details keyed as their kind is.
 * - Each role is a field of a type a Dict may be keyed by, checked when the code compiles; the Schematic checks each
 *   against its slot's key type, refusing a mismatch by the role, the field, both kinds and both types.
 * - The rail's sources may be over records keyed by any type: a kind read through its source, its cards and a tab.
 * - A kind's `key` builds a new row's key from its row, held to the record's key type. A link's key and a net's are never
 *   typed, so an editable link or net kind keyed by neither String nor Integer needs it; an item's is typed in the
 *   inspector, so an item kind needs none.
 *
 * e3-ui's specs read and write no e3: each record a kind reads is a handle as `Data.bind` gives one.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SetType, SortedMap, StringType, StructType,
    VariantType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, isTypeEqual, none, printFor, printType, some, variant,
    type BlockBuilder, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Slice, UIComponentType } from "@elaraai/east-ui";
import { DatasetStatusType } from "@elaraai/e3-types";
import e3 from "@elaraai/e3";
import { Data, DataBindHandleType, Record, Schematic as PublicSchematic } from "@elaraai/e3-ui";
import { Schematic, SchematicPayloadType } from "@elaraai/e3-ui/internal";

// ============================================================================
// The bakehouse's records, and the loading dock's
// ============================================================================

/** An oven on the floor: what its card calls it, its centre and its box. */
const Oven = StructType({ name: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType });
/** A mixer, by its name. */
const Mixer = StructType({ name: StringType, x: FloatType, y: FloatType });
/** An area of the floor: its name and its box. */
const Area = StructType({ name: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType });
/** A duct between two ovens, by their numbers. */
const Duct = StructType({ from: IntegerType, to: IntegerType, note: StringType });
/** A duct's key, where the ducts are keyed by the two ovens each joins. */
const DuctKey = StructType({ from: IntegerType, to: IntegerType });
/** A hose's fitting: an oven by its number, or a mixer by its name. */
const Fitting = VariantType({ oven: IntegerType, mixer: StringType });
/** A hose between two fittings. */
const Hose = StructType({ from: Fitting, to: Fitting, bore: FloatType });
/** A feed from some ovens to others, by their numbers: a Set of them, and an Array. */
const Feed = StructType({ supply: SetType(IntegerType), fed: ArrayType(IntegerType), name: StringType });
/** What each oven baked: keyed as the ovens are. */
const Output = StructType({ loaves: IntegerType });
/** An oven's card: its name, and the fields a card dropped on the floor gives the oven. */
const OvenCard = StructType({ name: StringType, values: StructType({ name: StringType, w: FloatType, h: FloatType }) });
/** A crate: a list of slots is no key, an optional one no end, and a list of lists no side. */
const Crate = StructType({ first: IntegerType, spare: OptionType(IntegerType), slots: ArrayType(IntegerType), stacks: ArrayType(ArrayType(IntegerType)) });
/** A delivery bay, keyed by when it opens. */
const Bay = StructType({ name: StringType, x: FloatType, y: FloatType });
/** A pallet spot's key: its row and its column. */
const SpotKey = StructType({ row: IntegerType, col: IntegerType });
const Spot = StructType({ name: StringType, x: FloatType, y: FloatType });
/** A rope between two spots, by their keys. */
const Rope = StructType({ from: SpotKey, to: SpotKey });
/** A rack's key: on a wall by its number, or on the floor by its name. */
const RackKey = VariantType({ wall: IntegerType, floor: StringType });
const Rack = StructType({ name: StringType, x: FloatType, y: FloatType });
/** A strap between two racks, each end the rack's key whole. */
const Strap = StructType({ from: RackKey, to: RackKey });

const Ovens = DictType(IntegerType, Oven);
const Mixers = DictType(StringType, Mixer);
const Areas = DictType(IntegerType, Area);
const Ducts = DictType(IntegerType, Duct);
const Hoses = DictType(IntegerType, Hose);
const Feeds = DictType(IntegerType, Feed);
const Outputs = DictType(IntegerType, Output);
const Bays = DictType(DateTimeType, Bay);
const Spots = DictType(SpotKey, Spot);
const Ropes = DictType(IntegerType, Rope);
const Racks = DictType(RackKey, Rack);
const Straps = DictType(IntegerType, Strap);
const JoinedDucts = DictType(DuctKey, Duct);

/** The records the build-time checks bind, as an app declares them: each refusal is made where the surface is built. */
const lineOvens = e3.record("schematic_keys_spec_ovens", Ovens, {
    initial: new Map(),
    indexes: (index) => ({ schematic_keys_spec_ovens_by_name: index.on(["name"]) }),
});
const namedOvens = e3.record("schematic_keys_spec_named_ovens", DictType(StringType, Oven), { initial: new Map() });
const lineMixers = e3.record("schematic_keys_spec_mixers", Mixers, { initial: new Map() });
const lineDucts = e3.record("schematic_keys_spec_ducts", Ducts, { initial: new Map() });
const lineHoses = e3.record("schematic_keys_spec_hoses", Hoses, { initial: new Map() });
const lineFeeds = e3.record("schematic_keys_spec_feeds", Feeds, { initial: new Map() });
const lineOutputs = e3.record("schematic_keys_spec_outputs", Outputs, { initial: new Map() });
const namedOutputs = e3.record("schematic_keys_spec_named_outputs", DictType(StringType, Output), { initial: new Map() });
const lineCrates = e3.record("schematic_keys_spec_crates", DictType(IntegerType, Crate), { initial: new Map() });
const lineCards = e3.record("schematic_keys_spec_cards", DictType(IntegerType, OvenCard), {
    initial: new Map(),
    indexes: (index) => ({ schematic_keys_spec_cards_by_name: index.on(["name"]) }),
});
const joinedDucts = e3.record("schematic_keys_spec_joined_ducts", JoinedDucts, {
    initial: new SortedMap([], compareFor(DuctKey)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
const datedFeeds = e3.record("schematic_keys_spec_dated_feeds", DictType(DateTimeType, Feed), {
    initial: new SortedMap([], compareFor(DateTimeType)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
const placedSpots = e3.record("schematic_keys_spec_placed_spots", Spots, {
    initial: new SortedMap([], compareFor(SpotKey)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

const ovenBytes = encodeBeast2For(Oven);
const ovenOf = decodeBeast2For(Oven);
const ovenEqual = equalFor(Oven);
const ductBytes = encodeBeast2For(Duct);
const ductOf = decodeBeast2For(Duct);
const ductEqual = equalFor(Duct);
const hoseBytes = encodeBeast2For(Hose);
const hoseOf = decodeBeast2For(Hose);
const hoseEqual = equalFor(Hose);
const feedBytes = encodeBeast2For(Feed);
const feedOf = decodeBeast2For(Feed);
const feedEqual = equalFor(Feed);
const ropeBytes = encodeBeast2For(Rope);
const ropeOf = decodeBeast2For(Rope);
const ropeEqual = equalFor(Rope);
const strapBytes = encodeBeast2For(Strap);
const strapOf = decodeBeast2For(Strap);
const strapEqual = equalFor(Strap);
/** The ovens a reader read by area or by key, as their kind's `rowsOf` takes them: each its key's text and its row. */
const ovenReads = encodeBeast2For(ArrayType(StructType({ key: StringType, row: Oven })));
const textsEqual = equalFor(ArrayType(StringType));
const optionText = equalFor(OptionType(StringType));
const refEqual = equalFor(Schematic.Types.Ref);
const refsEqual = equalFor(ArrayType(Schematic.Types.Ref));
const timeText = printFor(DateTimeType);
const spotText = printFor(SpotKey);
const rackText = printFor(RackKey);
const ductKeyText = printFor(DuctKey);

/** When the dock's two bays open. */
const EARLY = new Date("2026-11-07T06:00:00.000Z");
const LATE = new Date("2026-11-07T14:00:00.000Z");

/** Whether `build` throws an Error whose message is `message`, exactly. */
function refused(build: () => void, message: string): void {
    assert.throws(build, (error: unknown) => {
        assert.ok(error instanceof Error, "an Error");
        assert.equal(error.message, message);
        return true;
    });
}

// ============================================================================
// The bakehouse, through its carrier
// ============================================================================

describe("the bakehouse: each kind keyed by its own type, every key as its text (#1549)", () => {
    /** The bakehouse's Schematic, built over handles as `Data.bind` gives them, and read back from its carrier's bytes. */
    const bakehouse = (() => {
        const ui = East.compile(East.function([], UIComponentType, ($) => {
            const ovenRows = $.const(new SortedMap([
                [2n, { name: "Deck", x: 2, y: 2, w: 3, h: 2 }],
                [9n, { name: "Rack", x: 8, y: 2, w: 3, h: 2 }],
                [10n, { name: "Tunnel", x: 14, y: 2, w: 6, h: 2 }],
            ], compareFor(IntegerType)), Ovens);
            const ovens = $.let({
                read: East.function([], Ovens, (_$2) => ovenRows),
                write: East.function([Ovens], NullType, (_$2) => null),
                writeAndStart: East.function([Ovens], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Ovens, (_$2) => ovenRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "ovens")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Ovens));
            const outputRows = $.const(new SortedMap([[2n, { loaves: 40n }], [10n, { loaves: 36n }]], compareFor(IntegerType)), Outputs);
            const outputs = $.let({
                read: East.function([], Outputs, (_$2) => outputRows),
                write: East.function([Outputs], NullType, (_$2) => null),
                writeAndStart: East.function([Outputs], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Outputs, (_$2) => outputRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "outputs")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Outputs));
            const mixerRows = $.const(new Map([["M1", { name: "Spiral", x: 2, y: 8 }], ["M2", { name: "Planetary", x: 6, y: 8 }]]), Mixers);
            const mixers = $.let({
                read: East.function([], Mixers, (_$2) => mixerRows),
                write: East.function([Mixers], NullType, (_$2) => null),
                writeAndStart: East.function([Mixers], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Mixers, (_$2) => mixerRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "mixers")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Mixers));
            const areaRows = $.const(new SortedMap([
                [1n, { name: "Stores", x: 0, y: 0, w: 10, h: 12 }],
                [2n, { name: "Bakery", x: 10, y: 0, w: 14, h: 12 }],
            ], compareFor(IntegerType)), Areas);
            const areas = $.let({
                read: East.function([], Areas, (_$2) => areaRows),
                write: East.function([Areas], NullType, (_$2) => null),
                writeAndStart: East.function([Areas], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Areas, (_$2) => areaRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "areas")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Areas));
            const ductRows = $.const(new SortedMap([[1n, { from: 2n, to: 10n, note: "Main" }]], compareFor(IntegerType)), Ducts);
            const ducts = $.let({
                read: East.function([], Ducts, (_$2) => ductRows),
                write: East.function([Ducts], NullType, (_$2) => null),
                writeAndStart: East.function([Ducts], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Ducts, (_$2) => ductRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "ducts")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Ducts));
            const hoseRows = $.const(new SortedMap([[1n, { from: variant("oven", 9n), to: variant("mixer", "M1"), bore: 2.5 }]], compareFor(IntegerType)), Hoses);
            const hoses = $.let({
                read: East.function([], Hoses, (_$2) => hoseRows),
                write: East.function([Hoses], NullType, (_$2) => null),
                writeAndStart: East.function([Hoses], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Hoses, (_$2) => hoseRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "hoses")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Hoses));
            const feedRows = $.const(new SortedMap([[1n, { supply: new Set([2n]), fed: [9n, 10n], name: "Steam" }]], compareFor(IntegerType)), Feeds);
            const feeds = $.let({
                read: East.function([], Feeds, (_$2) => feedRows),
                write: East.function([Feeds], NullType, (_$2) => null),
                writeAndStart: East.function([Feeds], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Feeds, (_$2) => feedRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "feeds")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Feeds));
            return PublicSchematic({
                extent: { width: 24, height: 12 },
                items: {
                    ovens: Schematic.items(ovens, {
                        name: "Oven", icon: "fire-burner", x: "x", y: "y", width: "w", height: "h", label: "name",
                        // The oven's own number: an accessor hears its key at the record's key type.
                        sublabel: (_oven, key) => East.str`No. ${key.add(100n)}`,
                        details: Schematic.details(outputs, { metric: (output, key) => some(East.str`${output.loaves} loaves from oven ${key}`) }),
                    }),
                    mixers: Schematic.items(mixers, { name: "Mixer", icon: "blender", x: "x", y: "y", label: "name" }),
                },
                zones: {
                    areas: Schematic.zones(areas, { name: "Area", icon: "vector-square", x: "x", y: "y", width: "w", height: "h", label: (area, key) => East.str`${area.name} ${key}` }),
                },
                links: {
                    ducts: Schematic.links(ducts, {
                        name: "Duct", icon: "wind", from: { field: "from", of: "ovens" }, to: { field: "to", of: "ovens" },
                        // A duct drawn on the canvas: its note names the oven it was drawn from, by its number's text.
                        values: (ends) => ({ note: East.str`From oven ${ends.from.key}` }),
                    }),
                    hoses: Schematic.links(hoses, {
                        name: "Hose", icon: "faucet", from: { field: "from", of: { oven: "ovens", mixer: "mixers" } }, to: { field: "to", of: { oven: "ovens", mixer: "mixers" } },
                    }),
                },
                nets: { feeds: Schematic.nets(feeds, { name: "Feed", icon: "plug", sources: { field: "supply", of: "ovens" }, destinations: { field: "fed", of: "ovens" } }) },
            });
        }), [])();
        if (ui.type !== "Extension") assert.fail(`expected the Schematic extension, got the ${ui.type} arm`);
        return decodeBeast2For(SchematicPayloadType)(ui.value.payload);
    })();
    const ovens = bakehouse.items[0]!;
    const mixers = bakehouse.items[1]!;
    const areas = bakehouse.zones[0]!;
    const ducts = bakehouse.links[0]!;
    const hoses = bakehouse.links[1]!;
    const feeds = bakehouse.nets[0]!;

    test("each kind says its record's key type on the wire", () => {
        assert.ok(isTypeEqual(fromEastTypeValue(ovens.keyType), IntegerType));
        assert.ok(isTypeEqual(fromEastTypeValue(mixers.keyType), StringType));
        assert.ok(isTypeEqual(fromEastTypeValue(areas.keyType), IntegerType));
        assert.ok(isTypeEqual(fromEastTypeValue(ducts.keyType), IntegerType));
        assert.ok(isTypeEqual(fromEastTypeValue(hoses.keyType), IntegerType));
        assert.ok(isTypeEqual(fromEastTypeValue(feeds.keyType), IntegerType));
        // And the payload is one type whatever the keys: it crosses beast2 and back.
        const again = decodeBeast2For(SchematicPayloadType)(encodeBeast2For(SchematicPayloadType)(bakehouse));
        assert.ok(isTypeEqual(fromEastTypeValue(again.items[0]!.keyType), IntegerType));
    });

    test("the ovens: each by its number's text, its accessor hearing its own number", () => {
        const rows = ovens.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        // Text order on the wire: the renderer orders them by their type.
        assert.ok(textsEqual([...rows.value.keys()], ["10", "2", "9"]));
        const rack = rows.value.get("9")!;
        assert.equal(rack.roles.label, "Rack");
        assert.ok(optionText(rack.roles.sublabel, some("No. 109")));
        assert.ok(ovenEqual(ovenOf(rack.row), { name: "Rack", x: 8, y: 2, w: 3, h: 2 }), "the row crosses whole");
        // A drafted oven's roles, from its key's text.
        assert.ok(optionText(ovens.read(ovenBytes({ name: "Proofer", x: 1, y: 1, w: 1, h: 1 }), "41").sublabel, some("No. 141")));
    });

    test("the rows a reader read by area or by key: each by its key's text, read back at the record's key type for its roles", () => {
        const made = ovens.rowsOf(ovenReads([{ key: "10", row: { name: "Tunnel", x: 14, y: 2, w: 6, h: 2 } }]));
        assert.ok(textsEqual([...made.keys()], ["10"]));
        assert.ok(optionText(made.get("10")!.roles.sublabel, some("No. 110")));
    });

    test("the mixers, keyed by String, as before: each by its name", () => {
        const rows = mixers.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        assert.ok(textsEqual([...rows.value.keys()], ["M1", "M2"]));
    });

    test("the areas: zones keyed by number, each by its number's text, the label's accessor hearing its number", () => {
        const rows = areas.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        assert.ok(textsEqual([...rows.value.keys()], ["1", "2"]));
        assert.equal(rows.value.get("2")!.roles.label, "Bakery 2");
    });

    test("the ducts: each end its oven's number as its text", () => {
        const rows = ducts.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        const main = rows.value.get("1")!.roles;
        assert.ok(refEqual(main.from, { kind: "ovens", key: "2" }));
        assert.ok(refEqual(main.to, { kind: "ovens", key: "10" }));
    });

    test("Connect and Retarget read each end's text back at its type; a text no oven's number prints as, or an end of another slot, writes nothing", () => {
        const main = { from: 2n, to: 10n, note: "Main" };
        const retargeted = ducts.write(ductBytes(main), { from: { kind: "ovens", key: "9" }, to: { kind: "ovens", key: "2" } });
        if (retargeted.type !== "some") assert.fail("both ends are ovens");
        assert.ok(ductEqual(ductOf(retargeted.value), { from: 9n, to: 2n, note: "Main" }));
        assert.equal(ducts.write(ductBytes(main), { from: { kind: "ovens", key: "Deck" }, to: { kind: "ovens", key: "2" } }).type, "none", "\"Deck\" is no oven's number");
        assert.equal(ducts.write(ductBytes(main), { from: { kind: "mixers", key: "M1" }, to: { kind: "ovens", key: "2" } }).type, "none", "a mixer is no oven");
        const connected = ducts.create({ from: { kind: "ovens", key: "10" }, to: { kind: "ovens", key: "9" } }, none);
        if (connected.type !== "some") assert.fail("Connect makes a duct");
        assert.ok(ductEqual(ductOf(connected.value), { from: 10n, to: 9n, note: "From oven 10" }), "its own fields from the kind's values of its ends");
    });

    test("the hoses: an end whose cases hold two slots' keys of two types — an oven by its number, a mixer by its name", () => {
        const rows = hoses.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        const hose = rows.value.get("1")!.roles;
        assert.ok(refEqual(hose.from, { kind: "ovens", key: "9" }));
        assert.ok(refEqual(hose.to, { kind: "mixers", key: "M1" }));
        const given = { from: variant("oven", 9n), to: variant("mixer", "M1"), bore: 2.5 };
        const swapped = hoses.write(hoseBytes(given), { from: { kind: "mixers", key: "M2" }, to: { kind: "ovens", key: "10" } });
        if (swapped.type !== "some") assert.fail("each end takes its case's slot");
        assert.ok(hoseEqual(hoseOf(swapped.value), { from: variant("mixer", "M2"), to: variant("oven", 10n), bore: 2.5 }));
        assert.equal(hoses.write(hoseBytes(given), { from: { kind: "ovens", key: "nine" }, to: { kind: "mixers", key: "M1" } }).type, "none",
            "\"nine\" is no oven's number");
    });

    test("the feeds: each side's ovens by their numbers' text; a write reads them back, Set or Array as the field holds them", () => {
        const rows = feeds.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        const steam = rows.value.get("1")!.roles;
        assert.ok(refsEqual(steam.sources, [{ kind: "ovens", key: "2" }]));
        assert.ok(refsEqual(steam.destinations, [{ kind: "ovens", key: "9" }, { kind: "ovens", key: "10" }]));
        const given = { supply: new Set([2n]), fed: [9n, 10n], name: "Steam" };
        const moved = feeds.write(feedBytes(given), { sources: [{ kind: "ovens", key: "10" }], destinations: [{ kind: "ovens", key: "2" }, { kind: "ovens", key: "9" }] });
        if (moved.type !== "some") assert.fail("every member an oven");
        assert.ok(feedEqual(feedOf(moved.value), { supply: new Set([10n]), fed: [2n, 9n], name: "Steam" }));
        assert.equal(feeds.write(feedBytes(given), { sources: [{ kind: "ovens", key: "the deck" }], destinations: [] }).type, "none", "\"the deck\" is no oven's number");
        assert.equal(feeds.write(feedBytes(given), { sources: [{ kind: "mixers", key: "M1" }], destinations: [] }).type, "none", "a mixer is no oven");
    });

    test("a kind given no `key` gives none: the renderer counts a new oven's or a new duct's number on from the largest", () => {
        assert.equal(ovens.rowKey.type, "none");
        assert.equal(ducts.rowKey.type, "none");
        assert.equal(feeds.rowKey.type, "none");
    });

    test("the ovens' details: keyed as the ovens are, read whole by their numbers' text, the accessor hearing the number", () => {
        if (ovens.details.type !== "some") assert.fail("the ovens' details cross");
        const details = ovens.details.value;
        if (details.rows.type !== "some") assert.fail("read whole, beside the ovens read whole");
        const rows = details.rows.value();
        if (rows.type !== "some") assert.fail("the details' rows, by key");
        assert.ok(textsEqual([...rows.value.keys()], ["10", "2"]));
        assert.ok(optionText(rows.value.get("2")!.roles.metric, some("40 loaves from oven 2")));
    });
});

describe("an oven's cards: a record keyed by number, each card by its number's text (#1549)", () => {
    test("each card's key its number's text, its name hearing the number at its type", () => {
        const kind = East.compile(East.function([], Schematic.Types.ItemKind, ($) => {
            const ovenRows = $.const(new SortedMap([[2n, { name: "Deck", x: 2, y: 2, w: 3, h: 2 }]], compareFor(IntegerType)), Ovens);
            const ovens = $.let({
                read: East.function([], Ovens, (_$2) => ovenRows),
                write: East.function([Ovens], NullType, (_$2) => null),
                writeAndStart: East.function([Ovens], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Ovens, (_$2) => ovenRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "ovens")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Ovens));
            const cards = $.const(new SortedMap([
                [1n, { name: "Deck", values: { name: "Deck", w: 3, h: 2 } }],
            ], compareFor(IntegerType)), DictType(IntegerType, OvenCard));
            return Schematic.items(ovens, {
                name: "Oven", icon: "fire-burner", x: "x", y: "y", width: "w", height: "h", label: "name",
                templates: Schematic.templates(cards, { name: (card, key) => East.str`${card.name} (card ${key.add(100n)})`, values: (card) => card.values, source: "ovenCards" }),
            }).build("ovens");
        }), [])();
        assert.equal(kind.templates.length, 1);
        const card = kind.templates[0]!;
        assert.equal(card.key, "1");
        assert.equal(card.name, "Deck (card 101)");
        const dropped = kind.create(some({ x: 5, y: 6 }), some(card.values));
        if (dropped.type !== "some") assert.fail("a card makes an oven");
        assert.ok(ovenEqual(ovenOf(dropped.value), { name: "Deck", x: 5, y: 6, w: 3, h: 2 }));
    });
});

// ============================================================================
// The loading dock, through its carrier
// ============================================================================

describe("the loading dock: bays keyed by when each opens, spots by their row and column, racks by a variant (#1549)", () => {
    /** The dock's Schematic, built over handles as `Data.bind` gives them, and read back from its carrier's bytes. */
    const dock = (() => {
        const ui = East.compile(East.function([], UIComponentType, ($) => {
            const bayRows = $.const(new SortedMap([
                [EARLY, { name: "Early bay", x: 1, y: 1 }],
                [LATE, { name: "Late bay", x: 4, y: 1 }],
            ], compareFor(DateTimeType)), Bays);
            const bays = $.let({
                read: East.function([], Bays, (_$2) => bayRows),
                write: East.function([Bays], NullType, (_$2) => null),
                writeAndStart: East.function([Bays], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Bays, (_$2) => bayRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "bays")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Bays));
            const spotRows = $.const(new SortedMap([
                [{ row: 1n, col: 2n }, { name: "1-2", x: 2, y: 6 }],
                [{ row: 2n, col: 1n }, { name: "2-1", x: 4, y: 6 }],
                [{ row: 2n, col: 2n }, { name: "2-2", x: 6, y: 6 }],
            ], compareFor(SpotKey)), Spots);
            const spots = $.let({
                read: East.function([], Spots, (_$2) => spotRows),
                write: East.function([Spots], NullType, (_$2) => null),
                writeAndStart: East.function([Spots], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Spots, (_$2) => spotRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "spots")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Spots));
            const ropeRows = $.const(new SortedMap([[1n, { from: { row: 1n, col: 2n }, to: { row: 2n, col: 1n } }]], compareFor(IntegerType)), Ropes);
            const ropes = $.let({
                read: East.function([], Ropes, (_$2) => ropeRows),
                write: East.function([Ropes], NullType, (_$2) => null),
                writeAndStart: East.function([Ropes], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Ropes, (_$2) => ropeRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "ropes")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Ropes));
            const rackRows = $.const(new SortedMap<ValueTypeOf<typeof RackKey>, ValueTypeOf<typeof Rack>>([
                [variant("wall", 3n), { name: "Wall 3", x: 10, y: 2 }],
                [variant("floor", "F1"), { name: "Floor F1", x: 12, y: 6 }],
            ], compareFor(RackKey)), Racks);
            const racks = $.let({
                read: East.function([], Racks, (_$2) => rackRows),
                write: East.function([Racks], NullType, (_$2) => null),
                writeAndStart: East.function([Racks], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Racks, (_$2) => rackRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "racks")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Racks));
            const strapRows = $.const(new SortedMap([[1n, { from: variant("wall", 3n), to: variant("floor", "F1") }]], compareFor(IntegerType)), Straps);
            const straps = $.let({
                read: East.function([], Straps, (_$2) => strapRows),
                write: East.function([Straps], NullType, (_$2) => null),
                writeAndStart: East.function([Straps], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], Straps, (_$2) => strapRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "straps")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(Straps));
            return PublicSchematic({
                extent: { width: 16, height: 10 },
                items: {
                    bays: Schematic.items(bays, { name: "Bay", icon: "truck", x: "x", y: "y", label: "name" }),
                    spots: Schematic.items(spots, { name: "Spot", icon: "pallet", x: "x", y: "y", label: "name" }),
                    racks: Schematic.items(racks, { name: "Rack", icon: "warehouse", x: "x", y: "y", label: "name" }),
                },
                links: {
                    ropes: Schematic.links(ropes, { name: "Rope", icon: "link", from: { field: "from", of: "spots" }, to: { field: "to", of: "spots" } }),
                    // A variant field naming one slot holds that slot's keys whole: the end's `of` decides its shape.
                    straps: Schematic.links(straps, { name: "Strap", icon: "link", from: { field: "from", of: "racks" }, to: { field: "to", of: "racks" } }),
                },
            });
        }), [])();
        if (ui.type !== "Extension") assert.fail(`expected the Schematic extension, got the ${ui.type} arm`);
        return decodeBeast2For(SchematicPayloadType)(ui.value.payload);
    })();
    const bays = dock.items[0]!;
    const spots = dock.items[1]!;
    const racks = dock.items[2]!;
    const ropes = dock.links[0]!;
    const straps = dock.links[1]!;

    test("each bay by when it opens, as East prints it", () => {
        assert.ok(isTypeEqual(fromEastTypeValue(bays.keyType), DateTimeType));
        const rows = bays.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        assert.ok(textsEqual([...rows.value.keys()], [timeText(EARLY), timeText(LATE)]));
    });

    test("a rope's ends: each spot by its row and column as East prints them, read back at the key's type", () => {
        assert.ok(isTypeEqual(fromEastTypeValue(spots.keyType), SpotKey));
        assert.equal(spotText({ row: 1n, col: 2n }), "(row=1, col=2)");
        const rows = ropes.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        const rope = rows.value.get("1")!.roles;
        assert.ok(refEqual(rope.from, { kind: "spots", key: spotText({ row: 1n, col: 2n }) }));
        assert.ok(refEqual(rope.to, { kind: "spots", key: spotText({ row: 2n, col: 1n }) }));
        const given = { from: { row: 1n, col: 2n }, to: { row: 2n, col: 1n } };
        const moved = ropes.write(ropeBytes(given), { from: { kind: "spots", key: spotText({ row: 2n, col: 2n }) }, to: { kind: "spots", key: spotText({ row: 2n, col: 1n }) } });
        if (moved.type !== "some") assert.fail("both ends are spots");
        assert.ok(ropeEqual(ropeOf(moved.value), { from: { row: 2n, col: 2n }, to: { row: 2n, col: 1n } }));
        assert.equal(ropes.write(ropeBytes(given), { from: { kind: "spots", key: "row 2" }, to: { kind: "spots", key: spotText({ row: 2n, col: 1n }) } }).type, "none",
            "\"row 2\" is no spot's key");
    });

    test("a strap's ends name one slot keyed by a variant: each end holds the rack's key whole, as East prints it", () => {
        assert.ok(isTypeEqual(fromEastTypeValue(racks.keyType), RackKey));
        const rows = racks.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        assert.ok(textsEqual([...rows.value.keys()], [rackText(variant("floor", "F1")), rackText(variant("wall", 3n))]));
        const strapped = straps.rows();
        if (strapped.type !== "some") assert.fail("a record read whole holds its rows");
        const strap = strapped.value.get("1")!.roles;
        assert.ok(refEqual(strap.from, { kind: "racks", key: rackText(variant("wall", 3n)) }));
        assert.ok(refEqual(strap.to, { kind: "racks", key: rackText(variant("floor", "F1")) }));
        const given = { from: variant("wall", 3n), to: variant("floor", "F1") };
        const swapped = straps.write(strapBytes(given), { from: { kind: "racks", key: rackText(variant("floor", "F1")) }, to: { kind: "racks", key: rackText(variant("wall", 3n)) } });
        if (swapped.type !== "some") assert.fail("both ends are racks");
        assert.ok(strapEqual(strapOf(swapped.value), { from: variant("floor", "F1"), to: variant("wall", 3n) }));
        assert.equal(straps.write(strapBytes(given), { from: { kind: "racks", key: "wall 3" }, to: { kind: "racks", key: rackText(variant("wall", 3n)) } }).type, "none",
            "\"wall 3\" is no rack's key");
    });
});

// ============================================================================
// Each role's key, checked
// ============================================================================

/** The roles' type checks at any key type: never called — `tsc` checks what each line says. */
function typeChecks($: BlockBuilder<UIComponentType>): void {
    const ovens = $.let(Data.bind(lineOvens));
    const ducts = $.let(Data.bind(lineDucts));
    const hoses = $.let(Data.bind(lineHoses));
    const feeds = $.let(Data.bind(lineFeeds));
    const crates = $.let(Data.bind(lineCrates));
    // What fits: an end of a type a Dict may be keyed by, a variant naming a slot per case or one slot whole, a side a
    // Set or an Array of keys; and each accessor hears its row's key at the record's key type.
    PublicSchematic.items(ovens, { name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name", sublabel: (_oven, key) => East.str`No. ${key.add(100n)}` });
    PublicSchematic.links(ducts, { name: "Duct", icon: "wind", from: { field: "from", of: "ovens" }, to: { field: "to", of: "ovens" } });
    PublicSchematic.links(hoses, { name: "Hose", icon: "faucet", from: { field: "from", of: { oven: "ovens", mixer: "mixers" } }, to: { field: "to", of: "fittings" } });
    PublicSchematic.nets(feeds, { name: "Feed", icon: "plug", sources: { field: "supply", of: "ovens" }, destinations: { field: "fed", of: "ovens" } });
    // A new duct's key, built from its row at the ducts' key type.
    const joined = $.let(Data.bind(joinedDucts));
    PublicSchematic.links(joined, { name: "Duct", icon: "wind", from: { field: "from", of: "ovens" }, to: { field: "to", of: "ovens" }, key: (duct) => ({ from: duct.from, to: duct.to }) });
    // @ts-expect-error — the ducts are keyed by the two ovens they join: a note is no duct's key
    PublicSchematic.links(joined, { name: "Duct", icon: "wind", from: { field: "from", of: "ovens" }, to: { field: "to", of: "ovens" }, key: (duct) => duct.note });
    // @ts-expect-error — `spare` is an Option: a link has both its ends
    PublicSchematic.links(crates, { name: "Crate", icon: "box", from: { field: "spare", of: "ovens" }, to: { field: "first", of: "ovens" } });
    // @ts-expect-error — `slots` is an Array: a link's end holds an item's key, of a type a Dict may be keyed by
    PublicSchematic.links(crates, { name: "Crate", icon: "box", from: { field: "slots", of: "ovens" }, to: { field: "first", of: "ovens" } });
    // @ts-expect-error — `stacks` is an Array of Arrays: a net's side is a Set or an Array of items' keys
    PublicSchematic.nets(crates, { name: "Crate", icon: "box", sources: { field: "stacks", of: "ovens" }, destinations: { field: "slots", of: "ovens" } });
}

describe("a link's end and a net's side hold the keys of the item slot they name (#1549)", () => {
    test("each role is a field of a type a Dict may be keyed by, checked when the code compiles", () => {
        assert.equal(typeof typeChecks, "function");
    });

    test("where the Schematic is built, a mismatch is refused, naming the role, the field, both kinds and both types", () => {
        refused(() => East.function([], UIComponentType, ($) => {
            const ovens = $.let(Data.bind(lineOvens));
            const mixers = $.let(Data.bind(lineMixers));
            const ducts = $.let(Data.bind(lineDucts));
            return PublicSchematic({
                extent: { width: 24, height: 12 },
                items: {
                    ovens: Schematic.items(ovens, { name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name" }),
                    mixers: Schematic.items(mixers, { name: "Mixer", icon: "blender", x: "x", y: "y", label: "name" }),
                },
                links: { ducts: Schematic.links(ducts, { name: "Duct", icon: "wind", from: { field: "from", of: "mixers" }, to: { field: "to", of: "ovens" } }) },
            });
        }), "Schematic: the link kind \"ducts\"'s `from`, \"from\", holds .Integer — and the item kind \"mixers\" is keyed by .String: key \"mixers\" by .Integer, " +
            "or name a field holding .String");
        // A slot per case, each case checked against its own slot's key type.
        refused(() => East.function([], UIComponentType, ($) => {
            const ovens = $.let(Data.bind(namedOvens));
            const mixers = $.let(Data.bind(lineMixers));
            const hoses = $.let(Data.bind(lineHoses));
            return PublicSchematic({
                extent: { width: 24, height: 12 },
                items: {
                    ovens: Schematic.items(ovens, { name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name" }),
                    mixers: Schematic.items(mixers, { name: "Mixer", icon: "blender", x: "x", y: "y", label: "name" }),
                },
                links: {
                    hoses: Schematic.links(hoses, {
                        name: "Hose", icon: "faucet", from: { field: "from", of: { oven: "ovens", mixer: "mixers" } }, to: { field: "to", of: { oven: "ovens", mixer: "mixers" } },
                    }),
                },
            });
        }), "Schematic: the link kind \"hoses\"'s `from`, \"from\", holds .Integer in its case \"oven\" — and the item kind \"ovens\" is keyed by .String: " +
            "key \"ovens\" by .Integer, or give the case .String");
        refused(() => East.function([], UIComponentType, ($) => {
            const ovens = $.let(Data.bind(namedOvens));
            const feeds = $.let(Data.bind(lineFeeds));
            return PublicSchematic({
                extent: { width: 24, height: 12 },
                items: { ovens: Schematic.items(ovens, { name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name" }) },
                nets: { feeds: Schematic.nets(feeds, { name: "Feed", icon: "plug", sources: { field: "supply", of: "ovens" }, destinations: { field: "fed", of: "ovens" } }) },
            });
        }), "Schematic: the net kind \"feeds\"'s `sources`, \"supply\", holds the \"ovens\" keys as .Integer — and the item kind \"ovens\" is keyed by .String: " +
            "key \"ovens\" by .Integer, or name a Set or an Array field of .String");
    });

    test("within one declaration: an end of a type no Dict is keyed by, an end that is an Option, and a side holding no keys", () => {
        refused(() => East.function([], UIComponentType, ($) => {
            const ovens = $.let(Data.bind(lineOvens));
            const crates = $.let(Data.bind(lineCrates));
            return PublicSchematic({
                extent: { width: 24, height: 12 },
                items: { ovens: Schematic.items(ovens, { name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name" }) },
                links: { crates: Schematic.links(crates, { name: "Crate", icon: "box", from: { field: "slots", of: "ovens" }, to: { field: "first", of: "ovens" } } as never) },
            });
        }), "Schematic.links: \"Crate\": `from.field` names a field holding an item's key — of a type a Dict may be keyed by, a variant holding one per case, " +
            `or an Option of either — and "slots" holds ${printType(ArrayType(IntegerType))}`);
        refused(() => East.function([], UIComponentType, ($) => {
            const ovens = $.let(Data.bind(lineOvens));
            const crates = $.let(Data.bind(lineCrates));
            return PublicSchematic({
                extent: { width: 24, height: 12 },
                items: { ovens: Schematic.items(ovens, { name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name" }) },
                links: { crates: Schematic.links(crates, { name: "Crate", icon: "box", from: { field: "spare", of: "ovens" }, to: { field: "first", of: "ovens" } } as never) },
            });
        }), "Schematic.links: \"Crate\": a link has both its ends — `from.field` names a field holding an item's key, or a variant holding one per case, " +
            "never an Option — and \"spare\" holds an Option of .Integer");
        refused(() => East.function([], UIComponentType, ($) => {
            const ovens = $.let(Data.bind(lineOvens));
            const crates = $.let(Data.bind(lineCrates));
            return PublicSchematic({
                extent: { width: 24, height: 12 },
                items: { ovens: Schematic.items(ovens, { name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name" }) },
                nets: { crates: Schematic.nets(crates, { name: "Crate", icon: "box", sources: { field: "stacks", of: "ovens" }, destinations: { field: "slots", of: "ovens" } } as never) },
            });
        }), "Schematic.nets: \"Crate\": `sources.field` names a Set or an Array field of its items' keys, of a type a Dict may be keyed by — " +
            `"stacks" holds ${printType(ArrayType(ArrayType(IntegerType)))}`);
    });

    test("a kind's details are keyed as the kind is: details keyed by another type are refused, naming both", () => {
        refused(() => East.function([], UIComponentType, ($) => {
            const ovens = $.let(Data.bind(lineOvens));
            const outputs = $.let(Data.bind(namedOutputs));
            return PublicSchematic({
                extent: { width: 24, height: 12 },
                items: { ovens: Schematic.items(ovens, {
                    name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name", details: Schematic.details(outputs, { metric: (output) => some(East.str`${output.loaves}`) }),
                }) },
            });
        }), "Schematic.items: \"Oven\": the details' record is keyed by .String, and the kind's by .Integer — key the details as the kind is");
        // Keyed as the ovens are, they build.
        East.function([], UIComponentType, ($) => {
            const ovens = $.let(Data.bind(lineOvens));
            const outputs = $.let(Data.bind(lineOutputs));
            return PublicSchematic({
                extent: { width: 24, height: 12 },
                items: { ovens: Schematic.items(ovens, {
                    name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name", details: Schematic.details(outputs, { metric: (output) => some(East.str`${output.loaves}`) }),
                }) },
            });
        });
    });
});

// ============================================================================
// A new row's key
// ============================================================================

describe("a new row's key: a kind's `key` builds it from its row (#1549)", () => {
    test("a duct's `key` builds a new duct's key from its row, as East prints the two ovens it joins", () => {
        const kind = East.compile(East.function([], Schematic.Types.LinkKind, ($) => {
            const ductRows = $.const(new SortedMap([[{ from: 2n, to: 10n }, { from: 2n, to: 10n, note: "Main" }]], compareFor(DuctKey)), JoinedDucts);
            const ducts = $.let({
                read: East.function([], JoinedDucts, (_$2) => ductRows),
                write: East.function([JoinedDucts], NullType, (_$2) => null),
                writeAndStart: East.function([JoinedDucts], NullType, (_$2) => null),
                start: East.function([], NullType, (_$2) => null),
                source: East.function([], JoinedDucts, (_$2) => ductRows),
                pending: East.function([], BooleanType, (_$2) => false),
                commit: East.function([], NullType, (_$2) => null),
                discard: East.function([], NullType, (_$2) => null),
                has: East.function([], BooleanType, (_$2) => true),
                status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
                binding: { source: [variant("field", "inputs"), variant("field", "ducts")], patch: none, mode: variant("staged", null) },
            }, DataBindHandleType(JoinedDucts));
            return Schematic.links(ducts, {
                name: "Duct", icon: "wind", from: { field: "from", of: "ovens" }, to: { field: "to", of: "ovens" }, key: (duct) => ({ from: duct.from, to: duct.to }),
            }).build("ducts");
        }), [])();
        if (kind.rowKey.type !== "some") assert.fail("the ducts give `key`");
        assert.equal(kind.rowKey.value(ductBytes({ from: 10n, to: 2n, note: "Return" })), ductKeyText({ from: 10n, to: 2n }));
        const rows = kind.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        assert.ok(textsEqual([...rows.value.keys()], [ductKeyText({ from: 2n, to: 10n })]), "a stored duct by its key's text, as before");
    });

    test("a `key` building another type than the record's key is refused, naming both", () => {
        refused(() => East.function([], UIComponentType, ($) => PublicSchematic({
            extent: { width: 24, height: 12 },
            items: { ovens: Schematic.items($.let(Data.bind(lineOvens)), { name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name", key: ((oven: ExprType<typeof Oven>) => oven.name) as never }) },
        })), "Schematic.items: \"Oven\": `key` builds an item's key, of the record's key type .Integer — and this one builds .String");
    });

    test("editable links and nets keyed by neither String nor Integer need `key`: nothing else keys what Connect makes", () => {
        refused(() => East.function([], UIComponentType, ($) => PublicSchematic({
            extent: { width: 24, height: 12 },
            items: { ovens: Schematic.items($.let(Data.bind(lineOvens)), { name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name" }) },
            links: { ducts: Schematic.links($.let(Record.bind(joinedDucts)), { name: "Duct", icon: "wind", from: { field: "from", of: "ovens" }, to: { field: "to", of: "ovens" } }) },
        })), `Schematic.links: "Duct": the links are keyed by ${printType(DuctKey)}, and Connect makes one with no key typed — give \`key\`, ` +
            "building one's key from its row, or key them by String or Integer");
        refused(() => East.function([], UIComponentType, ($) => PublicSchematic({
            extent: { width: 24, height: 12 },
            items: { ovens: Schematic.items($.let(Data.bind(lineOvens)), { name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name" }) },
            nets: { feeds: Schematic.nets($.let(Record.bind(datedFeeds)), { name: "Feed", icon: "plug", sources: { field: "supply", of: "ovens" }, destinations: { field: "fed", of: "ovens" } }) },
        })), `Schematic.nets: "Feed": the nets are keyed by ${printType(DateTimeType)}, and Connect's Shift session makes one with no key typed — ` +
            "give `key`, building one's key from its row, or key them by String or Integer");
        // Given `key`, they build; read only, they need none.
        East.function([], UIComponentType, ($) => PublicSchematic({
            extent: { width: 24, height: 12 },
            items: { ovens: Schematic.items($.let(Data.bind(lineOvens)), { name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name" }) },
            links: { ducts: Schematic.links($.let(Record.bind(joinedDucts)), {
                name: "Duct", icon: "wind", from: { field: "from", of: "ovens" }, to: { field: "to", of: "ovens" }, key: (duct) => ({ from: duct.from, to: duct.to }),
            }) },
        }));
        East.function([], UIComponentType, ($) => PublicSchematic({
            extent: { width: 24, height: 12 },
            items: { ovens: Schematic.items($.let(Data.bind(lineOvens)), { name: "Oven", icon: "fire-burner", x: "x", y: "y", label: "name" }) },
            links: { ducts: Schematic.links($.let(Data.bind(joinedDucts)), { name: "Duct", icon: "wind", from: { field: "from", of: "ovens" }, to: { field: "to", of: "ovens" } }) },
        }));
    });

    test("editable items keyed by any type need no `key`: a new item's is typed in the inspector", () => {
        East.function([], UIComponentType, ($) => PublicSchematic({
            extent: { width: 16, height: 10 },
            items: { spots: Schematic.items($.let(Record.bind(placedSpots)), { name: "Spot", icon: "pallet", x: "x", y: "y", label: "name" }) },
        }));
    });
});

// ============================================================================
// The rail, over records keyed by any type
// ============================================================================

describe("the rail's sources may be over records keyed by any type, their shown keys their text (#1549)", () => {
    test("the ovens read through their source, their cards and a tab following theirs, each over a record keyed by number", () => {
        East.function([], UIComponentType, ($) => {
            const slice = $.let(Slice.bindRecords("schematic.keys.spec.rail", {
                ovens: { source: Data.bindPaged(lineOvens, { indexes: ["schematic_keys_spec_ovens_by_name"] }) },
                ovenCards: { source: Data.bindPaged(lineCards, { indexes: ["schematic_keys_spec_cards_by_name"] }), fields: { name: { label: "Name" } } },
            }));
            const ovens = $.let(Data.bindPaged(lineOvens));
            const cards = $.let(Data.bind(lineCards));
            return PublicSchematic({
                extent: { width: 24, height: 12 },
                slice: { slice },
                items: { ovens: Schematic.items(ovens, {
                    name: "Oven", icon: "fire-burner", x: "x", y: "y", width: "w", height: "h", label: "name",
                    templates: Schematic.templates(cards.read(), { name: (card) => card.name, values: (card) => card.values, source: "ovenCards" }),
                }) },
                library: [
                    PublicSchematic.library.templates(),
                    PublicSchematic.library.tab(cards.read(), { name: "Cards", label: (card, key) => East.str`${card.name} ${key}`, source: "ovenCards" }),
                ],
            });
        });
    });
});
