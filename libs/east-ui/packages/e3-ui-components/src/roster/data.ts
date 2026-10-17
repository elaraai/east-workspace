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
import { DAY, compareDate, weekKey, type RosterValue, type Week } from "./model.js";

/** A keyed page distinguishes loading from a confirmed absent week (the shared keyed read). */
export function readWindowWeek(window: Extract<RosterValue["window"], { type: "some" }>["value"], date: Date): option<option<Week>> {
    return readKeyedEntry(window, weekKey(date), page => page.get(date), "Roster history");
}
export interface RosterData {
    weeks: Map<Date, Week>; snapshot: Map<Date, Week> | undefined; loading: boolean; error: string | undefined;
}
/** Reads only the active week, the copy source and an explicitly opened picker month. */
export function useRosterData(value: RosterValue, start: Date, pickerDates: readonly Date[]): RosterData {
    const read = useCallback(() => {
        if (value.window.type === "none") {
            const weeks = value.read();
            return { weeks, snapshot: weeks, loading: false };
        }
        const source = pagedSourceOf(value.window.value.id);
        if (source === undefined || source.selector.index !== null || !equalFor(TreePathType)(source.path, [variant("field", "records"), variant("field", value.sourceId)])) {
            throw new Error("Roster.window must page the same weeks record, without an index.");
        }
        const weeks = new SortedMap<Date, Week>([], compareDate);
        let loading = false;
        for (const date of [start, new Date(start.getTime() - 7 * DAY), ...pickerDates]) {
            const got = readWindowWeek(value.window.value, date);
            if (got.type !== "some") { if (compareDate(date, start) === 0) loading = true; continue; }
            if (got.value.type === "some") weeks.set(date, got.value.value);
        }
        return { weeks, snapshot: undefined, loading };
    }, [value, start, pickerDates]);
    const { result } = useTrackedEvaluation(read);
    return result.ok ? { ...result.value, error: undefined }
        : { weeks: new SortedMap<Date, Week>([], compareDate), snapshot: undefined, loading: true, error: String(result.error) };
}
