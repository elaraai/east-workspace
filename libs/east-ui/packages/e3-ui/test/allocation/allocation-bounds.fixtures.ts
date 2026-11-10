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
 * rules', as the smallest board's is.
 *
 * @packageDocumentation
 */

import { DictType, East, FloatType, SortedMap, StringType, StructType, compareFor, equalFor, type ValueTypeOf } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Allocation } from "@elaraai/e3-ui";
import { MinimalBin, yardMinimalBinRows } from "./kiln-yard.js";

const byString = compareFor(StringType);
const sameKey = equalFor(StringType);

/** A bin of the smallest board's, and the moisture its load measured on arrival, in percent. */
export const MoistureBin = StructType({ ...MinimalBin.fields, moisture: FloatType });

/** The bins, each one's moisture beside the board's roles, through their patch door. */
export const moistureBins = e3.record("kiln_moisture_bins", DictType(StringType, MoistureBin), {
    initial: new SortedMap<string, ValueTypeOf<typeof MoistureBin>>(
        [...yardMinimalBinRows].map(([id, row]) => [id, { ...row, moisture: sameKey(id, "3113") ? 21.0 : 12.0 }] as const), byString),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** Their fit: the built-in rules over the bins. */
export const moistureFit = e3.function("yard_moisture_fit", East.function([Allocation.Types.FitRequest(MoistureBin)], Allocation.Types.FitResult, ($, req) => {
    const answer = $.const(Allocation.answer(MoistureBin));
    const rule = $.const(Allocation.fit);
    return answer(req, rule, "ranked by load, kind and spare days");
}));
