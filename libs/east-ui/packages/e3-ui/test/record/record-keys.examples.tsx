/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/east-ui */

/**
 * The Record over rows keyed by the key their row builds (east-workspace#1709),
 * paged and narrowed through their record's indexes by the rail
 * (east-workspace#1696): the same stock locations twice, under the same rail,
 * keyed once by a text their aisle and their bin build, and once by a struct of
 * the two — a key of any type a Dict takes pages, narrows, moves and saves as a
 * text does.
 */

import {
    DictType, East, IntegerType, SortedMap, StringType, StructType, compareFor, example, type ValueTypeOf,
} from "@elaraai/east";
import { Box, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

/** A stock location: what it holds, the aisle and the bin its key is built from, and the zone its aisle is in. */
export const StockSlot = StructType({ item: StringType, aisle: StringType, bin: IntegerType, zone: StringType });

/** A location's key as a struct: its aisle and its bin. */
export const StockSlotKey = StructType({ aisle: StringType, bin: IntegerType });

/** What the bins of an aisle hold, bin by bin. */
const HELD = ["Pallet wrap", "Strapping", "Corner boards", "Labels", "Tape", "Void fill", "Cartons", "Dividers"] as const;

/** The aisles, each with the zone it is in. */
const AISLES = [["A", "Dry"], ["B", "Dry"], ["C", "Chilled"], ["D", "Chilled"]] as const;

/** Four aisles of eight bins: aisles A and B in the dry zone, C and D in the chilled one. */
function stockSlots(): ValueTypeOf<typeof StockSlot>[] {
    return AISLES.flatMap(([aisle, zone]) => HELD.map((item, at) => ({ item: `${item} ${aisle}${at + 1}`, aisle, bin: BigInt(at + 1), zone })));
}

// ============================================================================
// Example 1 — a text key the row builds, under the rail
// ============================================================================

/** The locations keyed by a text: `A-1`. */
export const recordSlotsByText = e3.record("record_slots_by_text", DictType(StringType, StockSlot), {
    initial: new Map(stockSlots().map((slot) => [`${slot.aisle}-${slot.bin}`, slot] as const)),
    indexes: (index) => ({
        // What the rail filters and searches by.
        record_slots_by_text_zone: index.on(["zone"]),
        record_slots_by_text_aisle: index.on(["aisle"]),
        record_slots_by_text_item: index.on(["item"]),
    }),
    mutations: (mutation) => ({
        // The locations' patch door — every Save commits through it.
        patch: mutation.patch(),
    }),
});

export const recordBuiltKeysSliced = example({
    keywords: ["Record", "key", "built key", "key from the row", "row key", "natural key", "East.str", "Slice", "Slice.bindRecords", "rows", "Data.bindPaged", "indexes",
        "index.on", "filter", "search", "narrowing", "paging", "newRow", "key taken", "refused"],
    description: "A record whose rows' keys the app builds from the row, paged and narrowed by the rail: stock locations keyed by a text their aisle and their bin build, read a page at a time through the indexes the rail filters by zone and by aisle and searches by what they hold. A bin typed over moves its location under the key it then builds, and a Save writes it there — its row leaving the narrowing where its new aisle is one the rail filters out, which the footer says; a bin another location has is refused, in the danger tone, the row marked where it stands",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const locations = $.let(Record.bind(recordSlotsByText));
            // The rail's `rows` source: the locations, a page at a time, through the indexes it filters and searches by.
            const slice = $.let(Slice.bindRecords("record.slots.text", {
                rows: {
                    source: Data.bindPaged(recordSlotsByText, { indexes: ["record_slots_by_text_zone", "record_slots_by_text_aisle", "record_slots_by_text_item"] }),
                    label: "Locations",
                    fields: { zone: { label: "Zone", hints: ["Dry", "Chilled"] }, aisle: { label: "Aisle", hints: ["A", "B", "C", "D"] }, item: { label: "Holds" } },
                    search: ["item"],
                },
            }));
            // A new location as it is added: in aisle A's zone, its aisle, its bin and what it holds left to type.
            const newRow = $.const(East.function([Record.Types.NewRow], Record.Types.Patch(StockSlot), (_$) => Record.patch(StockSlot, { zone: "Dry" })));
            return (
                <Box height="520px">
                    <Record
                        slice={{ slice }}
                        record={locations}
                        // A location's key, built from its row: its aisle and its bin, as one text.
                        key={(location) => East.str`${location.aisle}-${location.bin}`}
                        title="Stock locations"
                        noun={{ singular: "location", plural: "locations" }}
                        columns={{
                            item:  Record.column.title(StockSlot, { header: "Holds", width: "200px" }),
                            aisle: Record.column.text(StockSlot, { header: "Aisle", width: "96px" }),
                            bin:   Record.column.integer(StockSlot, { header: "Bin", width: "96px" }),
                            zone:  Record.column.text(StockSlot, { header: "Zone", width: "120px" }),
                        }}
                        newRow={newRow}
                        name="recordBuiltKeysSliced"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 2 — a struct key the row builds, under the same rail
// ============================================================================

/** The same locations keyed by a struct: their aisle and their bin. A Dict over struct keys is a SortedMap, in East's order. */
export const recordSlotsByStruct = e3.record("record_slots_by_struct", DictType(StockSlotKey, StockSlot), {
    initial: new SortedMap<ValueTypeOf<typeof StockSlotKey>, ValueTypeOf<typeof StockSlot>>(
        stockSlots().map((slot) => [{ aisle: slot.aisle, bin: slot.bin }, slot] as const), compareFor(StockSlotKey)),
    indexes: (index) => ({
        // What the rail filters and searches by.
        record_slots_by_struct_zone: index.on(["zone"]),
        record_slots_by_struct_aisle: index.on(["aisle"]),
        record_slots_by_struct_item: index.on(["item"]),
    }),
    mutations: (mutation) => ({
        // The locations' patch door — every Save commits through it, each location by its struct key.
        patch: mutation.patch(),
    }),
});

export const recordStructKeysSliced = example({
    keywords: ["Record", "key", "built key", "key from the row", "struct key", "composite key", "keyType", "typed key", "StructType", "Slice", "Slice.bindRecords", "rows",
        "Data.bindPaged", "indexes", "index.on", "filter", "search", "narrowing", "paging", "newRow", "key taken", "refused", "#1696"],
    description: "recordBuiltKeysSliced over a key that is no text: the same stock locations, under the same rail, keyed by a struct of their aisle and their bin, which `key` builds from the row as a struct. A record keyed by any type a Dict takes is a source of the rail: it pages through its indexes, filters by zone and by aisle and searches by what its rows hold as a text-keyed one does; a bin typed over moves its location under the struct it then builds, a Save writes it there, and a bin another location has is refused. The grid holds a key as East prints it, and reads it back at its own type",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const locations = $.let(Record.bind(recordSlotsByStruct));
            // The rail's `rows` source, as the text-keyed locations': the indexes are of the rows' fields, whatever keys them.
            const slice = $.let(Slice.bindRecords("record.slots.struct", {
                rows: {
                    source: Data.bindPaged(recordSlotsByStruct, { indexes: ["record_slots_by_struct_zone", "record_slots_by_struct_aisle", "record_slots_by_struct_item"] }),
                    label: "Locations",
                    fields: { zone: { label: "Zone", hints: ["Dry", "Chilled"] }, aisle: { label: "Aisle", hints: ["A", "B", "C", "D"] }, item: { label: "Holds" } },
                    search: ["item"],
                },
            }));
            const newRow = $.const(East.function([Record.Types.NewRow], Record.Types.Patch(StockSlot), (_$) => Record.patch(StockSlot, { zone: "Dry" })));
            return (
                <Box height="520px">
                    <Record
                        slice={{ slice }}
                        record={locations}
                        // A location's key, built from its row at the record's key type: a struct of its aisle and its bin.
                        key={(location) => ({ aisle: location.aisle, bin: location.bin })}
                        title="Stock locations"
                        noun={{ singular: "location", plural: "locations" }}
                        columns={{
                            item:  Record.column.title(StockSlot, { header: "Holds", width: "200px" }),
                            aisle: Record.column.text(StockSlot, { header: "Aisle", width: "96px" }),
                            bin:   Record.column.integer(StockSlot, { header: "Bin", width: "96px" }),
                            zone:  Record.column.text(StockSlot, { header: "Zone", width: "120px" }),
                        }}
                        newRow={newRow}
                        name="recordStructKeysSliced"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
