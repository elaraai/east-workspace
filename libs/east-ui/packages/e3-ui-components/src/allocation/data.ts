/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useCallback } from "react";
import { SortedMap, equalFor, none, some, variant, type option } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { TreePathType } from "@elaraai/e3-types";
import { pagedSourceOf } from "../platform/index.js";
import { readKeyedEntry, readKeyedRange } from "../shared/schedule/keyed-read.js";
import { DAY, compareDate, dayKey, type AllocationDomain, type AllocationValue, type Day, type Days } from "./model.js";

/** What the board holds of the plans: the days it read, the whole plans when read whole, and whether the active day is still in flight. */
export interface AllocationData {
    days: SortedMap<Date, Day>;
    /** The plans read whole — an editing session's snapshot; `undefined` when read a day at a time. */
    snapshot: Days | undefined;
    /** The active day is still in flight: never drawn as empty (A80). */
    loading: boolean;
    error: string | undefined;
}

type PlansWindow = Extract<AllocationValue["window"], { type: "some" }>["value"];

/** A paged day: the plans' page decoded at the bin values, its day taken. */
export function readWindowDay(window: PlansWindow, domain: AllocationDomain, date: Date): option<option<Day>> {
    return readKeyedEntry(window, dayKey(date), page => domain.decodeDays(page).get(date), "Allocation history");
}

/**
 * The paged days of a span, `[from, to)`, as one page decoded at the bin
 * values — the picker's weeks, which a read a day would take more windows of
 * than the paging runtime keeps.
 *
 * @param window - The plans, read a page at a time
 * @param domain - The plans' codecs
 * @param from - The span's first day
 * @param to - The day after it
 * @returns `none` while the read is in flight; else the days the plans hold in the span
 */
export function readWindowDays(window: PlansWindow, domain: AllocationDomain, from: Date, to: Date): option<Days> {
    const got = readKeyedRange(window, dayKey(from), dayKey(to), page => domain.decodeDays(page), "Allocation history");
    if (got.type !== "some") return none;
    return some(got.value.type === "some" ? got.value.value : new SortedMap<Date, Day>([], compareDate));
}

/**
 * Reads the active day, and the picker's open month (A2) — through `window`,
 * the day by its key and the month as one run of keys; or the plans whole.
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
        // The active day: while it is in flight the board is covered (A80), never drawn as empty.
        const active = readWindowDay(window, domain, day);
        if (active.type === "some" && active.value.type === "some") days.set(day, active.value.value);
        // The picker's weeks, its first day to the day after its last.
        const first = pickerDays[0], last = pickerDays[pickerDays.length - 1];
        if (first !== undefined && last !== undefined) {
            const month = readWindowDays(window, domain, first, new Date(last.getTime() + DAY));
            if (month.type === "some") for (const [date, plan] of month.value) if (!days.has(date)) days.set(date, plan);
        }
        return { days, snapshot: undefined, loading: active.type !== "some" };
    }, [value, domain, day, pickerDays]);
    const { result } = useTrackedEvaluation(read);
    return result.ok ? { ...result.value, error: undefined }
        : { days: new SortedMap<Date, Day>([], compareDate), snapshot: undefined, loading: true, error: String(result.error) };
}
