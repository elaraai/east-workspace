/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/east-ui */

/**
 * The rows a Record's select column ticks (east-workspace#1737): the app hears
 * them through `onTick`, an East function over a Set of the record's keys,
 * called after each change of the ticks, and keeps them in the page's state
 * for a line over the Record to read. Add and Delete are off here — the
 * presses are the plant's — and the tick boxes show because `onTick` is given.
 */

import { DictType, East, FloatType, IntegerType, NullType, SetType, StringType, StructType, example } from "@elaraai/east";
import { Box, Reactive, State, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

/** A press: its name, the hall it stands in and the hours booked on it this week. */
export const TickedPress = StructType({ name: StringType, hall: StringType, booked: FloatType });

/** The presses, keyed by their code. */
export const recordTicksPresses = e3.record("record_ticks_presses", DictType(StringType, TickedPress), {
    initial: new Map([
        ["P-01", { name: "Offset press 1", hall: "Hall A", booked: 31.5 }],
        ["P-02", { name: "Offset press 2", hall: "Hall A", booked: 38.0 }],
        ["P-03", { name: "Digital press", hall: "Hall B", booked: 12.5 }],
        ["P-04", { name: "Flexo line", hall: "Hall B", booked: 40.0 }],
    ]),
    mutations: (mutation) => ({
        // The presses' patch door — every Save commits through it.
        patch: mutation.patch(),
    }),
});

export const recordTicks = example({
    keywords: ["Record", "onTick", "tick", "ticked", "select column", "tick boxes", "selected rows", "SetType", "bulk", "edits", "insertRows", "removeRows", "State", "State.bind", "panel"],
    description: "A Record whose ticked rows the page hears: Add and Delete are off (`edits`), and `onTick` — an East function over a Set of the record's keys, called after each change of the ticks — keeps the ticked presses in the page's state, which a line over the Record counts and lists. The tick boxes show because `onTick` is given; with Delete off and no `onTick` there would be none",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presses = $.let(Record.bind(recordTicksPresses));
            const ticked = $.let(State.bind([SetType(StringType)], "record_ticks_ticked", new Set<string>()));
            const shown = $.let(ticked.read());
            const count = $.let(shown.size());
            const codes = $.let(shown.toArray(($2, key) => key).stringJoin(", "));
            // Every ticked press, by its key as the record holds it, after each change of the ticks.
            const onTick = $.const(East.function([SetType(StringType)], NullType, ($2, keys) => {
                $2(ticked.write(keys));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Text>{count.equal(0n).ifElse(
                        (_$2) => "No press ticked",
                        (_$2) => count.equal(1n).ifElse((_$3) => East.str`1 press ticked: ${codes}`, (_$3) => East.str`${count} presses ticked: ${codes}`),
                    )}</Text>
                    <Box height="420px">
                        <Record
                            record={presses}
                            title="Presses"
                            noun={{ singular: "press", plural: "presses" }}
                            edits={{ insertRows: false, removeRows: false }}
                            onTick={onTick}
                            columns={{
                                name:   Record.column.title(TickedPress, { header: "Press", width: "200px" }),
                                hall:   Record.column.text(TickedPress, { header: "Hall", width: "120px" }),
                                booked: Record.column.quantity(TickedPress, { header: "Booked", unit: "h", width: "112px" }),
                            }}
                            name="recordTicks"
                        />
                    </Box>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// The records the renderer's tick tests read
// ============================================================================

/** A press of the renderer's tick tests: its name and its hall. */
export const TicksPress = StructType({ name: StringType, hall: StringType });

/**
 * The presses the renderer's tick tests tick, searched by name on the rail. No example reads this record, nor the two
 * after it: e3-ui-components declares no e3 SDK, and its tests mount this module for them.
 */
export const ticksPresses = e3.record("ticks_presses", DictType(StringType, TicksPress), {
    initial: new Map([
        ["P-01", { name: "Offset press 1", hall: "Hall A" }],
        ["P-02", { name: "Offset press 2", hall: "Hall A" }],
        ["P-03", { name: "Digital press", hall: "Hall B" }],
    ]),
    // What the rail searches by.
    indexes: (index) => ({ ticks_presses_by_name: index.on(["name"]) }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A bench of the renderer's tick tests: its name. */
export const TicksBench = StructType({ name: StringType });

/** The benches the renderer's tick tests tick, keyed by their numbers: the record's key an Integer. */
export const ticksBenches = e3.record("ticks_benches", DictType(IntegerType, TicksBench), {
    initial: new Map([[1n, { name: "Assembly 1" }], [7n, { name: "Finishing" }]]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A rack of the renderer's tick tests: the code a person types, and its bay. */
export const TicksRack = StructType({ code: StringType, bay: StringType });

/** The racks the renderer's tick tests tick, each keyed by the code a person types: its key built from its row. */
export const ticksRacks = e3.record("ticks_racks", DictType(StringType, TicksRack), {
    initial: new Map([["R-1", { code: "R-1", bay: "North" }], ["R-2", { code: "R-2", bay: "South" }]]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
