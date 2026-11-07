/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A bakery's line keyed by number (#1549): its stations, its steps standing at
 * them and the moves between the steps, each record keyed by number — the
 * fixture the Flowchart's DOM tests over keys of another type than String
 * read, on no page of the showcase. Their order is their numbers', never their
 * texts', which would put 10 before 2.
 *
 * - **The stations** 2, 9 and 10 — Bench, Oven and Cooling — carry no order of
 *   their own.
 * - **The steps** Weigh, Proof and Mix — 2, 9 and 10 — stand at the bench,
 *   with no order of their own either; Bake, 11, stands at the oven.
 * - **The moves** 2, 9 and 10 each leave one of the bench's steps for a step
 *   no step is numbered — 77, 78 and 79 — so each is an issue.
 *
 * @packageDocumentation
 */

import { DictType, IntegerType, SortedMap, StringType, StructType, compareFor } from "@elaraai/east";
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
});

/** The line's stations, by number. */
export const keyedStations = e3.record("flowchart_keyed_stations", DictType(IntegerType, KeyedStation), {
    initial: new SortedMap([
        [2n, { label: "Bench" }],
        [9n, { label: "Oven" }],
        [10n, { label: "Cooling" }],
    ], compareNumber),
});

/** The line's moves, by number: each to a step no step is numbered. */
export const keyedMoves = e3.record("flowchart_keyed_moves", DictType(IntegerType, KeyedMove), {
    initial: new SortedMap([
        [2n, { from: 2n, to: 77n }],
        [9n, { from: 9n, to: 78n }],
        [10n, { from: 10n, to: 79n }],
    ], compareNumber),
});
