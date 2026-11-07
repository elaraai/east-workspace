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
 * @packageDocumentation
 */

import { DictType, FloatType, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, none, some } from "@elaraai/east";
import e3 from "@elaraai/e3";

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
    ], compareFor(IntegerType)),
    indexes: (index) => ({ schematic_keyed_ovens_by_name: index.on(["name"]) }),
});

/** The bakehouse's mixers, by name. */
export const keyedMixers = e3.record("schematic_keyed_mixers", DictType(StringType, KeyedMixer), {
    initial: new SortedMap([
        ["10B", { name: "10B", x: 8.0, y: 10.0 }],
        ["M1", { name: "M1", x: 10.0, y: 3.0 }],
        ["M2", { name: "M2", x: 12.0, y: 3.0 }],
    ], compareFor(StringType)),
});
