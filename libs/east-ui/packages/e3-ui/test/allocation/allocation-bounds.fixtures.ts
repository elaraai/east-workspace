/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The smallest board's bins with a number of the yard's own beside the
 * board's roles (#1585): the moisture each load measured on arrival, in
 * percent, which no role maps, so the bin kind's form draws it and a hint can
 * hold it to bounds — the fixture the Allocation's DOM test of a bin's bounds
 * reads, on no page of the showcase. Every bin measured 12 but bin 3113
 * (LD-2210), which an app's write left at 21. Their fit is the built-in
 * rules', as the smallest board's is, over these bins read through their own
 * index.
 *
 * @packageDocumentation
 */

import { DictType, FloatType, SortedMap, StringType, StructType, compareFor, equalFor, none, type ValueTypeOf } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Allocation, Schedule } from "@elaraai/e3-ui";
import { arrivals, kilns, minimalAnswer } from "./allocation.examples.js";
import { MinimalBin, yardMinimalBinRows } from "./kiln-yard.js";

const byString = compareFor(StringType);
const sameKey = equalFor(StringType);

/** A bin of the smallest board's, and the moisture its load measured on arrival, in percent. */
export const MoistureBin = StructType({ ...MinimalBin.fields, moisture: FloatType });

/** The bins, each one's moisture beside the board's roles, through their patch door; by their time, which their fit reads a day of them through. */
export const moistureBins = e3.record("kiln_moisture_bins", DictType(StringType, MoistureBin), {
    initial: new SortedMap<string, ValueTypeOf<typeof MoistureBin>>(
        [...yardMinimalBinRows].map(([id, row]) => [id, { ...row, moisture: sameKey(id, "3113") ? 21.0 : 12.0 }] as const), byString),
    indexes: (index) => ({
        kiln_moisture_bins_by_time: index.interval({ from: "at", to: "at" }),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** Their fit (#1624): the smallest board's rules over these bins, read through their own index, the board's unsaved bins among them. */
export const moistureFit = e3.function("yard_moisture_fit", {
    inputs: [e3.index(moistureBins.indexes.kiln_moisture_bins_by_time), moistureBins, kilns, arrivals],
    drafts: [moistureBins],
    args: [Allocation.Types.FitRequest()],
    output: Allocation.Types.FitResult(),
}, ($, binsByTime, bins, kilnRows, loadRows, request) => {
    const day = $.let(new Map(), DictType(StringType, Schedule.Types.AllocationRoles));
    binsByTime.overlapping({ from: request.day, to: request.day.addDays(1n) }).each($, ($2, _carried, key) => {
        const bin = $2.const(bins.get(key));
        $2(day.insert(key, { at: bin.at, lane: bin.bay, arrival: bin.load, quantity: bin.m3, parts: bin.kilns, hold: bin.dryFor, kind: none }));
    });
    const answer = $.const(minimalAnswer);
    return answer(day, kilnRows, loadRows, request);
});
