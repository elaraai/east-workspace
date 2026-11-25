/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/east-ui */

/**
 * A click on a Record's row (east-workspace#1727): the app hears it through
 * `onRowClick`, an East function over `Record.Types.RowClick(K)` — the row's key
 * at the record's own key type, and the column clicked — and keeps what it
 * needs in the page's state for a line over the Record to read: over it, never
 * beside it, where the Record's width would follow the line's words. Once over
 * a record keyed by text, and once over one keyed by Integer, whose key arrives
 * as an Integer.
 */

import { DictType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, example, none, some } from "@elaraai/east";
import { Box, Reactive, State, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// Example 1 — the clicked row's key, kept for a line over the Record
// ============================================================================

/** A press: its name, the hall it stands in and the hours booked on it this week. */
export const RowClickPress = StructType({ name: StringType, hall: StringType, booked: FloatType });

/** The presses, keyed by their code. */
export const recordRowClickPresses = e3.record("record_row_click_presses", DictType(StringType, RowClickPress), {
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

export const recordRowClick = example({
    keywords: ["Record", "onRowClick", "row click", "click", "Record.Types.RowClick", "RowClick", "key", "column", "State", "State.bind", "picked", "panel", "detail"],
    description: "A Record whose row clicks the page hears: each click on a press — on any of its cells, on a row already selected too, on its name, which opens its Details too — writes the press's code and the column clicked into the page's state, which a line over the Record reads. A click that ticks the row's box, a drag across the cells and a key never does",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presses = $.let(Record.bind(recordRowClickPresses));
            const picked = $.let(State.bind([OptionType(StringType)], "record_row_click_picked", none));
            const shown = $.let(picked.read());
            // The press clicked, by its key as the record holds it, and the column the click landed in.
            const onRowClick = $.const(East.function([Record.Types.RowClick(StringType)], NullType, ($2, click) => {
                const column = $2.let(click.column.match({ some: (_$3, key) => key, none: (_$3) => "the row" }));
                $2(picked.write(some(East.str`${click.key} · ${column}`)));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Text>{shown.match({ some: (_$2, said) => East.str`Clicked ${said}`, none: (_$2) => "Click a press" })}</Text>
                    <Box height="420px">
                        <Record
                            record={presses}
                            title="Presses"
                            noun={{ singular: "press", plural: "presses" }}
                            onRowClick={onRowClick}
                            inspector
                            columns={{
                                name:   Record.column.title(RowClickPress, { header: "Press", width: "200px" }),
                                hall:   Record.column.text(RowClickPress, { header: "Hall", width: "120px" }),
                                booked: Record.column.quantity(RowClickPress, { header: "Booked", unit: "h", width: "112px" }),
                            }}
                            name="recordRowClick"
                        />
                    </Box>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 2 — a record keyed by Integer: the key arrives as an Integer
// ============================================================================

/** A bench: what stands on it. */
export const RowClickBench = StructType({ name: StringType, holds: StringType });

/** The benches, keyed by their number. */
export const recordRowClickBenches = e3.record("record_row_click_benches", DictType(IntegerType, RowClickBench), {
    initial: new Map([
        [1n, { name: "Assembly bench 1", holds: "Door frames" }],
        [2n, { name: "Assembly bench 2", holds: "Drawer boxes" }],
        [7n, { name: "Finishing bench", holds: "Beech tops" }],
    ]),
    mutations: (mutation) => ({
        // The benches' patch door — every Save commits through it.
        patch: mutation.patch(),
    }),
});

export const recordRowClickInteger = example({
    keywords: ["Record", "onRowClick", "row click", "Record.Types.RowClick", "IntegerType", "typed key", "key type", "DictType", "State", "State.bind", "picked"],
    description: "recordRowClick over a record keyed by Integer: `onRowClick` takes `Record.Types.RowClick(IntegerType)`, so the clicked bench's key arrives as the Integer the record keys it by, and the panel looks the bench up in the record by it",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const benches = $.let(Record.bind(recordRowClickBenches));
            const rows = $.let(benches.read());
            const picked = $.let(State.bind([OptionType(IntegerType)], "record_row_click_bench", none));
            const shown = $.let(picked.read());
            // The bench clicked, by its number: an Integer, as the record keys it.
            const onRowClick = $.const(East.function([Record.Types.RowClick(IntegerType)], NullType, ($2, click) => {
                $2(picked.write(some(click.key)));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Text>{shown.match({
                        some: (_$2, key) => rows.has(key).ifElse((_$3) => East.str`Bench ${key} holds ${rows.get(key).holds}`, (_$3) => East.str`Bench ${key}, not saved yet`),
                        none: (_$2) => "Click a bench",
                    })}</Text>
                    <Box height="420px">
                        <Record
                            record={benches}
                            title="Benches"
                            noun={{ singular: "bench", plural: "benches" }}
                            onRowClick={onRowClick}
                            columns={{
                                name:  Record.column.title(RowClickBench, { header: "Bench", width: "200px" }),
                                holds: Record.column.text(RowClickBench, { header: "Holds", width: "160px" }),
                            }}
                            name="recordRowClickInteger"
                        />
                    </Box>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
