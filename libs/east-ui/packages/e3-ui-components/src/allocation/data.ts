/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useCallback } from "react";
import { SortedMap, equalFor, variant, type option } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { TreePathType } from "@elaraai/e3-types";
import { pagedSourceOf } from "../platform/index.js";
import { readKeyedEntry } from "../shared/schedule/keyed-read.js";
import { compareDate, dayKey, type AllocationDomain, type AllocationValue, type Day, type Days } from "./model.js";

/** What the board holds of the plans: the days it read, the whole plans when read whole, and whether the active day is still in flight. */
export interface AllocationData {
    days: SortedMap<Date, Day>;
    /** The plans read whole — an editing session's snapshot; `undefined` when read a day at a time. */
    snapshot: Days | undefined;
    /** The active day is still in flight: never drawn as empty (A80). */
    loading: boolean;
    error: string | undefined;
}

/** A paged day: the plans' page decoded at the bin values, its day taken. */
export function readWindowDay(window: Extract<AllocationValue["window"], { type: "some" }>["value"], domain: AllocationDomain, date: Date): option<option<Day>> {
    return readKeyedEntry(window, dayKey(date), page => domain.decodeDays(page).get(date), "Allocation history");
}

/**
 * Reads the active day, and the picker's open month (A2) — a day at a time
 * through `window`, or the plans whole.
 */
export function useAllocationData(value: AllocationValue, domain: AllocationDomain, day: Date, pickerDays: readonly Date[]): AllocationData {
    const read = useCallback(() => {
        if (value.window.type === "none") {
            const days = domain.decodeDays(value.read());
            return { days, snapshot: days, loading: false };
        }
        const window = value.window.value;
        const source = pagedSourceOf(window.id);
        if (source === undefined || source.selector.index !== null || !equalFor(TreePathType)(source.path, [variant("field", "records"), variant("field", value.sourceId)])) {
            throw new Error("Allocation.window must page the same plans record, without an index.");
        }
        const days = new SortedMap<Date, Day>([], compareDate);
        let loading = false;
        for (const date of [day, ...pickerDays]) {
            const got = readWindowDay(window, domain, date);
            if (got.type !== "some") { if (compareDate(date, day) === 0) loading = true; continue; }
            if (got.value.type === "some") days.set(date, got.value.value);
        }
        return { days, snapshot: undefined, loading };
    }, [value, domain, day, pickerDays]);
    const { result } = useTrackedEvaluation(read);
    return result.ok ? { ...result.value, error: undefined }
        : { days: new SortedMap<Date, Day>([], compareDate), snapshot: undefined, loading: true, error: String(result.error) };
}
