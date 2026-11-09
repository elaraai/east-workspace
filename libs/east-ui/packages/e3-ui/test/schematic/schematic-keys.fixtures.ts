/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A bakehouse's floor keyed by number and by text (#1549): its ovens, each
 * keyed by its number, and its mixers, each by its name — the fixture the
 * Schematic's DOM tests over keys of another type than String read, on no page
 * of the showcase. The ovens' order is their numbers', never their texts',
 * which would put 10 before 2.
 *
 * - **Ovens** 2, 9 and 10 stand past the floor's east edge, so each is an
 *   issue; 11 stands on the floor; 3, 20 and 100 have no position, so the
 *   Backlog holds them.
 * - **Mixers** `M1`, `M2` and `10B` stand on the floor: a key typed as `10`
 *   is oven 10, and the start of mixer `10B`'s key.
 *
 * And the floor's other records, each kind's new keys made as its key type
 * makes them — each record takes its patch door, so a test edits it as an app
 * does:
 *
 * - **Hoses and feeds keyed by number** (`keyedHoses`, `keyedFeeds`): hoses 2
 *   and 10, each an oven to a mixer, and feeds 2 and 10, each some ovens to
 *   some mixers — a new one is 11, one past the largest.
 * - **The floor's one card** (`floorCards`): Spare, which an oven, a bay or a
 *   crate made from it takes its name from.
 * - **Spots keyed by their row and their column** (`placedSpots`) — the key a
 *   kind's `key` builds from the row: 1-1, 1-2 and 2-1, and the rope along row
 *   1 between the first two (`keyedRopes`); and their cards (`spotCards`), one
 *   making a spot at 1-1 again, which 1-1 holds, and one at 2-2.
 * - **Pipes keyed by their ends** (`joinedPipes`) — the key a link kind's `key`
 *   builds from its ends: M2 to M1, which a pipe between them again would take.
 * - **Bays keyed by when each opens** (`timedBays`) — DateTime keys, which the
 *   viewer types for a new bay: the Early bay at 06:00, the chute from it to M2
 *   numbered 5 (`timedChutes`).
 * - **Crates keyed by their tags' bytes** (`taggedCrates`) — Blob keys, which
 *   no form types, so no crate is added: Crate 7.
 * - **Pegs keyed by a row and a column the viewer types** (`typedPegs`) — a key
 *   of two parts their kind builds none of: 2-0 and 0-2, each holding what one
 *   part typed alone, the other at its default, would be (#1581).
 * - **Tiles keyed by the cell their centre stands in** (`cellTiles`) — the key
 *   the tiles' `key` builds from where each stands, a cell 4 m wide: West in
 *   cell 2 and East in cell 3, side by side, so a drag of both one cell along
 *   moves West under East's key as East leaves it (#1581).
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, DateTimeType, DictType, FloatType, IntegerType, OptionType, SetType, SortedMap, SortedSet, StringType, StructType, VariantType,
    compareFor, none, some, variant,
} from "@elaraai/east";
import e3 from "@elaraai/e3";

const compareNumber = compareFor(IntegerType);

/** The floor, in metres. */
export const KEYED_FLOOR = { width: 28, height: 14 };

/** An oven: its name, and where its centre stands — none, in the Backlog. */
export const KeyedOven = StructType({ name: StringType, x: OptionType(FloatType), y: OptionType(FloatType) });

/** A mixer: its name, and where its centre stands. */
export const KeyedMixer = StructType({ name: StringType, x: FloatType, y: FloatType });

/** The bakehouse's ovens, by number, and the index the rail reads them through, by name. */
export const keyedOvens = e3.record("schematic_keyed_ovens", DictType(IntegerType, KeyedOven), {
    initial: new SortedMap([
        [2n, { name: "Deck 2", x: some(31.0), y: some(2.0) }],
        [3n, { name: "Deck 3", x: none, y: none }],
        [9n, { name: "Deck 9", x: some(32.0), y: some(4.0) }],
        [10n, { name: "Deck 10", x: some(33.0), y: some(6.0) }],
        [11n, { name: "Deck 11", x: some(4.0), y: some(4.0) }],
        [20n, { name: "Deck 20", x: none, y: none }],
        [100n, { name: "Deck 100", x: none, y: none }],
    ], compareNumber),
    indexes: (index) => ({ schematic_keyed_ovens_by_name: index.on(["name"]) }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The bakehouse's mixers, by name. */
export const keyedMixers = e3.record("schematic_keyed_mixers", DictType(StringType, KeyedMixer), {
    initial: new SortedMap([
        ["10B", { name: "10B", x: 8.0, y: 10.0 }],
        ["M1", { name: "M1", x: 10.0, y: 3.0 }],
        ["M2", { name: "M2", x: 12.0, y: 3.0 }],
    ], compareFor(StringType)),
});

/** A hose's fitting: an oven by its number, or a mixer by its name. */
export const KeyedFitting = VariantType({ oven: IntegerType, mixer: StringType });

/** A hose between two fittings, and its bore. */
export const KeyedHose = StructType({ from: KeyedFitting, to: KeyedFitting, bore: FloatType });

/** The bakehouse's hoses, by number: 2, oven 11 to mixer M2; 10, oven 2 to mixer M1. */
export const keyedHoses = e3.record("schematic_keyed_hoses", DictType(IntegerType, KeyedHose), {
    initial: new SortedMap([
        [2n, { from: variant("oven", 11n), to: variant("mixer", "M2"), bore: 2.5 }],
        [10n, { from: variant("oven", 2n), to: variant("mixer", "M1"), bore: 2.5 }],
    ], compareNumber),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A feed from some ovens, by their numbers, to some mixers, by their names. */
export const KeyedFeed = StructType({ supply: SetType(IntegerType), fed: ArrayType(StringType), name: StringType });

/** The bakehouse's feeds, by number: 2, Steam, oven 11 to mixer M2; 10, Water, oven 9 to mixer 10B. */
export const keyedFeeds = e3.record("schematic_keyed_feeds", DictType(IntegerType, KeyedFeed), {
    initial: new SortedMap([
        [2n, { supply: new SortedSet([11n], compareNumber), fed: ["M2"], name: "Steam" }],
        [10n, { supply: new SortedSet([9n], compareNumber), fed: ["10B"], name: "Water" }],
    ], compareNumber),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A card dropped on the floor: its name, and the fields what is made from it takes — every field but where it stands. */
export const FloorCard = StructType({ name: StringType, values: StructType({ name: StringType }) });

/** The floor's cards, and the index the rail reads them through, by name: Spare. */
export const floorCards = e3.record("schematic_floor_cards", DictType(StringType, FloorCard), {
    initial: new SortedMap([["spare", { name: "Spare", values: { name: "Spare" } }]], compareFor(StringType)),
    indexes: (index) => ({ schematic_floor_cards_by_name: index.on(["name"]) }),
});

/** A pallet spot's key: its row and its column. */
export const SpotKey = StructType({ row: IntegerType, col: IntegerType });

/** A pallet spot: its name, its row and its column — its key — and where its centre stands. */
export const KeyedSpot = StructType({ name: StringType, row: IntegerType, col: IntegerType, x: FloatType, y: FloatType });

/** The floor's pallet spots, by their row and their column: 1-1 and 1-2 along row 1, and 2-1 below 1-1. */
export const placedSpots = e3.record("schematic_placed_spots", DictType(SpotKey, KeyedSpot), {
    initial: new SortedMap([
        [{ row: 1n, col: 1n }, { name: "1-1", row: 1n, col: 1n, x: 18.0, y: 3.0 }],
        [{ row: 1n, col: 2n }, { name: "1-2", row: 1n, col: 2n, x: 22.0, y: 3.0 }],
        [{ row: 2n, col: 1n }, { name: "2-1", row: 2n, col: 1n, x: 18.0, y: 10.0 }],
    ], compareFor(SpotKey)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A rope between two spots, by their keys. */
export const KeyedRope = StructType({ from: SpotKey, to: SpotKey, note: StringType });

/** The floor's ropes, by number, and the index the rail reads them through, by note: 1, along row 1 from 1-1 to 1-2. */
export const keyedRopes = e3.record("schematic_keyed_ropes", DictType(IntegerType, KeyedRope), {
    initial: new SortedMap([[1n, { from: { row: 1n, col: 1n }, to: { row: 1n, col: 2n }, note: "Along row 1" }]], compareNumber),
    indexes: (index) => ({ schematic_keyed_ropes_by_note: index.on(["note"]) }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A spot's card: its name, and the fields a spot made from it takes — its name, its row and its column. */
export const SpotCard = StructType({ name: StringType, values: StructType({ name: StringType, row: IntegerType, col: IntegerType }) });

/** The spots' cards, and the index the rail reads them through, by name: one at 1-1 again, which 1-1 holds, and one at 2-2. */
export const spotCards = e3.record("schematic_spot_cards", DictType(StringType, SpotCard), {
    initial: new SortedMap([
        ["again", { name: "Row 1, column 1", values: { name: "1-1 again", row: 1n, col: 1n } }],
        ["corner", { name: "Row 2, column 2", values: { name: "2-2", row: 2n, col: 2n } }],
    ], compareFor(StringType)),
    indexes: (index) => ({ schematic_spot_cards_by_name: index.on(["name"]) }),
});

/** A pipe's key: the mixers it runs from and to, by their names. */
export const PipeEnds = StructType({ from: StringType, to: StringType });

/** A pipe between two mixers, by their names. */
export const KeyedPipe = StructType({ from: StringType, to: StringType, note: StringType });

/** The mixers' pipes, keyed by their ends: M2 to M1. */
export const joinedPipes = e3.record("schematic_joined_pipes", DictType(PipeEnds, KeyedPipe), {
    initial: new SortedMap([[{ from: "M2", to: "M1" }, { from: "M2", to: "M1", note: "Return" }]], compareFor(PipeEnds)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** When the Early bay opens: its key. */
export const EARLY = new Date("2026-11-07T06:00:00.000Z");

/** A delivery bay: its name, and where its centre stands. */
export const KeyedBay = StructType({ name: StringType, x: FloatType, y: FloatType });

/** The floor's delivery bays, by when each opens, and the index the rail reads them through, by name: the Early bay. */
export const timedBays = e3.record("schematic_timed_bays", DictType(DateTimeType, KeyedBay), {
    initial: new SortedMap([[EARLY, { name: "Early bay", x: 22.0, y: 10.0 }]], compareFor(DateTimeType)),
    indexes: (index) => ({ schematic_timed_bays_by_name: index.on(["name"]) }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A chute from a bay, by when it opens, to a mixer, by its name. */
export const KeyedChute = StructType({ from: DateTimeType, to: StringType, note: StringType });

/** The bays' chutes, by number: 5, Flour, from the Early bay to mixer M2. */
export const timedChutes = e3.record("schematic_timed_chutes", DictType(IntegerType, KeyedChute), {
    initial: new SortedMap([[5n, { from: EARLY, to: "M2", note: "Flour" }]], compareNumber),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** Crate 7's tag. */
export const CRATE_7 = new Uint8Array([7]);

/** A crate: its name, and where its centre stands. */
export const KeyedCrate = StructType({ name: StringType, x: FloatType, y: FloatType });

/** The floor's crates, by their tags' bytes: Crate 7. */
export const taggedCrates = e3.record("schematic_tagged_crates", DictType(BlobType, KeyedCrate), {
    initial: new SortedMap([[CRATE_7, { name: "Crate 7", x: 24.0, y: 3.0 }]], compareFor(BlobType)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A peg: its name, and where its centre stands. */
export const TypedPeg = StructType({ name: StringType, x: FloatType, y: FloatType });

/** The floor's pegs, by a row and a column the viewer types: 2-0 and 0-2. */
export const typedPegs = e3.record("schematic_typed_pegs", DictType(SpotKey, TypedPeg), {
    initial: new SortedMap([
        [{ row: 2n, col: 0n }, { name: "2-0", x: 6.0, y: 12.0 }],
        [{ row: 0n, col: 2n }, { name: "0-2", x: 10.0, y: 12.0 }],
    ], compareFor(SpotKey)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A floor tile: its name, and where its centre stands, whose cell is its key. */
export const CellTile = StructType({ name: StringType, x: FloatType, y: FloatType });

/** The floor's tiles, by the cell their centre stands in, 4 m wide: West in cell 2 and East in cell 3. */
export const cellTiles = e3.record("schematic_cell_tiles", DictType(IntegerType, CellTile), {
    initial: new SortedMap([[2n, { name: "West", x: 10.0, y: 3.0 }], [3n, { name: "East", x: 14.0, y: 3.0 }]], compareNumber),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
