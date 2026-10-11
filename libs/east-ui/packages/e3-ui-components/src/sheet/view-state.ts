/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Saved views share transitions, while local and indexed narrowing retain their own wire types. */
import { equalFor, none } from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import { RecordSliceStateType, Slice } from "@elaraai/east-ui/internal";
import type { SheetRecordViewValue, SheetSavedView, SheetViewValue } from "./values.js";

type Narrowing = SheetSavedView["narrowing"];
const localEqual = equalFor(Slice.Types.State);
const recordEqual = equalFor(RecordSliceStateType);
const localViewEqual = equalFor(Sheet.Types.View);
const recordViewEqual = equalFor(Sheet.Types.RecordView);

/** Record state has field choices; it is never projected into local Slice state. */
export function isRecordNarrowing(state: Narrowing): state is SheetRecordViewValue["narrowing"] {
    return "where" in state;
}

/** Compare using the appropriate East type, including typed filter literals. */
export function narrowingEqual(a: Narrowing, b: Narrowing): boolean {
    if (isRecordNarrowing(a)) return isRecordNarrowing(b) && recordEqual(a, b);
    return !isRecordNarrowing(b) && localEqual(a, b);
}

/** Value equality keeps optimistic tab changes when the host decodes a fresh payload. */
export function sheetViewsEqual(a: readonly SheetSavedView[], b: readonly SheetSavedView[]): boolean {
    return a.length === b.length && a.every((v, i) => {
        const other = b[i]!;
        if (isRecordNarrowing(v.narrowing)) return isRecordNarrowing(other.narrowing)
            && recordViewEqual({ ...v, narrowing: v.narrowing }, { ...other, narrowing: other.narrowing });
        return !isRecordNarrowing(other.narrowing)
            && localViewEqual({ ...v, narrowing: v.narrowing }, { ...other, narrowing: other.narrowing });
    });
}

/** The All tab clears narrowing but retains presentation resolution. */
export function clearNarrowing(state: Narrowing): Narrowing {
    return isRecordNarrowing(state) ? { ...state, where: new Map(), preset: none }
        : { ...state, range: none, filters: [], activeCohorts: new Set<string>(), search: none };
}

/** Search text for a new tab's default name. Exact typed choices are not search text. */
export function narrowingQuery(state: Narrowing): string {
    if (!isRecordNarrowing(state)) return state.search.type === "some" ? state.search.value : "";
    return [...state.where.values()].filter(choice => choice.type === "prefix").map(choice => choice.value).join(" ");
}

/** Escape clears searches without changing other selected fields or presentation. */
export function clearSearch(state: Narrowing): Narrowing {
    return isRecordNarrowing(state)
        ? { ...state, where: new Map([...state.where].filter(([, choice]) => choice.type !== "prefix")), preset: none }
        : { ...state, search: none };
}

/** A view's scope as the existing tab description names it. */
export function narrowingScope(state: Narrowing): "query" | "range" | "filter" | "none" {
    if (narrowingQuery(state).trim() !== "") return "query";
    if (isRecordNarrowing(state)) return [...state.where.values()].some(choice => choice.type === "range") ? "range" : state.where.size > 0 ? "filter" : "none";
    return state.range.type === "some" ? "range" : state.filters.length > 0 || state.activeCohorts.size > 0 ? "filter" : "none";
}

/** Write a saved view list through its correctly typed binding. */
export function writeSheetViews(views: readonly SheetSavedView[], local: ((views: SheetViewValue[]) => unknown) | undefined,
    record: ((views: SheetRecordViewValue[]) => unknown) | undefined): void {
    if (record !== undefined) {
        record(views.map(view => {
            if (!isRecordNarrowing(view.narrowing)) throw new Error("A record Sheet cannot save local narrowing");
            return { ...view, narrowing: view.narrowing };
        }));
    } else if (local !== undefined) {
        local(views.map(view => {
            if (isRecordNarrowing(view.narrowing)) throw new Error("A local Sheet cannot save record narrowing");
            return { ...view, narrowing: view.narrowing };
        }));
    }
}
