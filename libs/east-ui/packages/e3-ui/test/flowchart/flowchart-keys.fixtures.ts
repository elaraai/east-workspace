/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A bakery's line keyed by number (#1549): its stations, its steps standing at
 * them and the moves between the steps, each record keyed by number — the
 * fixture the Flowchart's DOM tests over keys of another type than String
 * read, on no page of the showcase. Their order is their numbers', never their
 * texts', which would put 10 before 2. Each record takes its patch door, so a
 * test edits it as an app does.
 *
 * - **The stations** 2, 9 and 10 — Bench, Oven and Cooling — carry no order of
 *   their own.
 * - **The steps** Weigh, Proof and Mix — 2, 9 and 10 — stand at the bench,
 *   with no order of their own either; Bake, 11, stands at the oven.
 * - **The moves** 2, 9 and 10 each leave one of the bench's steps for a step
 *   no step is numbered — 77, 78 and 79 — so each is an issue.
 *
 * And the line keyed otherwise, each kind's new keys made as its key type
 * makes them:
 *
 * - **Moves keyed by their ends** (`joinedMoves`) — the key the transitions'
 *   `key` builds from the row: Mix to Proof, which a move between them again
 *   would take.
 * - **Steps keyed by their station and their name** (`placedSteps`) — the key
 *   the states' `key` builds: Weigh and Mix at the bench.
 * - **Shifts and batches keyed by when each starts** (`timedShifts`,
 *   `timedBatches`) — DateTime keys, which the viewer types for a new row: the
 *   Early shift at 06:00, and its Rye batch at 06:30.
 * - **Racks and trays keyed by their tags' bytes** (`taggedRacks`,
 *   `taggedTrays`) — Blob keys, which no form types, so neither kind adds a
 *   row: Rack A, and its Tray 7; and the trays' one card (`trayCards`).
 *
 * @packageDocumentation
 */

import { BlobType, DateTimeType, DictType, IntegerType, SortedMap, StringType, StructType, compareFor } from "@elaraai/east";
import e3 from "@elaraai/e3";

const compareNumber = compareFor(IntegerType);

/** A step: what its card calls it, and its station, by the station's number. */
export const KeyedStep = StructType({ name: StringType, station: IntegerType });

/** A station, the line's column: its header. */
export const KeyedStation = StructType({ label: StringType });

/** A move between two steps, by their numbers. */
export const KeyedMove = StructType({ from: IntegerType, to: IntegerType });

/** The line's steps, by number, and the index the rail reads them through, by station. */
export const keyedSteps = e3.record("flowchart_keyed_steps", DictType(IntegerType, KeyedStep), {
    initial: new SortedMap([
        [2n, { name: "Weigh", station: 2n }],
        [9n, { name: "Proof", station: 2n }],
        [10n, { name: "Mix", station: 2n }],
        [11n, { name: "Bake", station: 9n }],
    ], compareNumber),
    indexes: (index) => ({ flowchart_keyed_steps_by_station: index.on(["station"]) }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The line's stations, by number. */
export const keyedStations = e3.record("flowchart_keyed_stations", DictType(IntegerType, KeyedStation), {
    initial: new SortedMap([
        [2n, { label: "Bench" }],
        [9n, { label: "Oven" }],
        [10n, { label: "Cooling" }],
    ], compareNumber),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The line's moves, by number: each to a step no step is numbered. */
export const keyedMoves = e3.record("flowchart_keyed_moves", DictType(IntegerType, KeyedMove), {
    initial: new SortedMap([
        [2n, { from: 2n, to: 77n }],
        [9n, { from: 9n, to: 78n }],
        [10n, { from: 10n, to: 79n }],
    ], compareNumber),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A move's key: the steps it leaves and enters, by their numbers. */
export const MoveEnds = StructType({ from: IntegerType, to: IntegerType });

/** The line's moves keyed by their ends: Mix to Proof. */
export const joinedMoves = e3.record("flowchart_joined_moves", DictType(MoveEnds, KeyedMove), {
    initial: new SortedMap([[{ from: 10n, to: 9n }, { from: 10n, to: 9n }]], compareFor(MoveEnds)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A step's key: its station, by number, and its name. */
export const StepPlace = StructType({ station: IntegerType, name: StringType });

/** The line's steps keyed by their station and their name: Weigh and Mix at the bench. */
export const placedSteps = e3.record("flowchart_placed_steps", DictType(StepPlace, KeyedStep), {
    initial: new SortedMap([
        [{ station: 2n, name: "Weigh" }, { name: "Weigh", station: 2n }],
        [{ station: 2n, name: "Mix" }, { name: "Mix", station: 2n }],
    ], compareFor(StepPlace)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** When the Early shift starts: its key. */
export const EARLY = new Date("2026-11-07T06:00:00.000Z");

/** A batch: what its card calls it, and its shift, by when the shift starts. */
export const TimedBatch = StructType({ name: StringType, shift: DateTimeType });

/** The bakery's shifts, by when each starts: the Early shift. */
export const timedShifts = e3.record("flowchart_timed_shifts", DictType(DateTimeType, KeyedStation), {
    initial: new SortedMap([[EARLY, { label: "Early" }]], compareFor(DateTimeType)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The bakery's batches, by when each starts: Rye, in the Early shift. */
export const timedBatches = e3.record("flowchart_timed_batches", DictType(DateTimeType, TimedBatch), {
    initial: new SortedMap([[new Date("2026-11-07T06:30:00.000Z"), { name: "Rye", shift: EARLY }]], compareFor(DateTimeType)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A tray: what its card calls it, and its rack, by the rack's tag. */
export const TaggedTray = StructType({ name: StringType, rack: BlobType });

/** Rack A's tag. */
export const RACK_A = new Uint8Array([1]);

/** The racks, by their tags' bytes: Rack A. */
export const taggedRacks = e3.record("flowchart_tagged_racks", DictType(BlobType, KeyedStation), {
    initial: new SortedMap([[RACK_A, { label: "Rack A" }]], compareFor(BlobType)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The trays, by their tags' bytes: Tray 7, on Rack A. */
export const taggedTrays = e3.record("flowchart_tagged_trays", DictType(BlobType, TaggedTray), {
    initial: new SortedMap([[new Uint8Array([7]), { name: "Tray 7", rack: RACK_A }]], compareFor(BlobType)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A tray's card: its name, its group, and the values a tray made from it takes — every field but its rack. */
export const TrayCard = StructType({ name: StringType, group: StringType, values: StructType({ name: StringType }) });

/** The trays' cards, and the index the rail reads them through, by group: Sesame. */
export const trayCards = e3.record("flowchart_tray_cards", DictType(StringType, TrayCard), {
    initial: new SortedMap([["sesame", { name: "Sesame tray", group: "Seeded", values: { name: "Sesame" } }]], compareFor(StringType)),
    indexes: (index) => ({ flowchart_tray_cards_by_group: index.on(["group"]) }),
});
