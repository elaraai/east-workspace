/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The saved views' narrowing (#1345): every source's narrowing of the sheet's
 * one `Slice.bindRecords`, by the source's name — read off the rail, written
 * back to it as a view opens, compared, cleared and described through East's
 * own types.
 *
 * @packageDocumentation
 */

import { ArrayType, DictType, SortedMap, StringType, compareFor, equalFor, none, type ValueTypeOf } from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import { RecordSliceStateType, type RecordSlicesChromeType } from "@elaraai/east-ui/internal";
import type { SheetNarrowing, SheetSavedView } from "./values.js";

/** One source's narrowing. */
type SourceState = ValueTypeOf<typeof RecordSliceStateType>;
/** The rail's chrome, as the root carries it. */
type Chrome = ValueTypeOf<typeof RecordSlicesChromeType>;

const compareString = compareFor(StringType);
const narrowingsEqual = equalFor(DictType(StringType, RecordSliceStateType));
const viewsEqual = equalFor(ArrayType(Sheet.Types.RecordView));

/** A source's narrowing with nothing chosen: its presentation (its resolution) kept. */
function cleared(state: SourceState): SourceState {
    return { ...state, where: new Map(), preset: none };
}

/**
 * The rail's narrowing now: each source's state, by its name.
 *
 * @param chrome - The sheet's rail
 * @returns Every source's narrowing
 */
export function narrowingOf(chrome: Chrome): SheetNarrowing {
    return new SortedMap(chrome.slice.parts.map((part) => [part.source, part.slice.read()] as const), compareString);
}

/**
 * Writes a narrowing back to the rail, source by source: a source the
 * narrowing does not hold opens with nothing chosen, as a preset clears a
 * source it does not name.
 *
 * @param chrome - The sheet's rail
 * @param narrowing - The narrowing to write — a view's, or the whole sheet's
 */
export function writeNarrowing(chrome: Chrome, narrowing: SheetNarrowing): void {
    for (const part of chrome.slice.parts) {
        part.slice.write(narrowing.get(part.source) ?? cleared(part.slice.read()));
    }
}

/** Whether two narrowings hold the same choices, through East's equality, by source. */
export function narrowingEqual(a: SheetNarrowing, b: SheetNarrowing): boolean {
    return narrowingsEqual(a, b);
}

/** Value equality keeps optimistic tab changes when the host decodes a fresh payload. */
export function sheetViewsEqual(a: readonly SheetSavedView[], b: readonly SheetSavedView[]): boolean {
    return viewsEqual([...a], [...b]);
}

/** The All tab clears every source's choices but keeps their presentation. */
export function clearNarrowing(state: SheetNarrowing): SheetNarrowing {
    return new SortedMap([...state].map(([source, s]) => [source, cleared(s)] as const), compareString);
}

/** Search text for a new tab's default name: each source's prefix searches. Exact typed choices are not search text. */
export function narrowingQuery(state: SheetNarrowing): string {
    return [...state.values()].flatMap((s) => [...s.where.values()].filter((choice) => choice.type === "prefix").map((choice) => choice.value)).join(" ");
}

/** Escape clears every search, each source keeping its other choices and its presentation. */
export function clearSearch(state: SheetNarrowing): SheetNarrowing {
    return new SortedMap([...state].map(([source, s]) => [source, s.where.size === 0 ? s
        : { ...s, where: new Map([...s.where].filter(([, choice]) => choice.type !== "prefix")), preset: none }] as const), compareString);
}

/** A view's scope as the existing tab description names it. */
export function narrowingScope(state: SheetNarrowing): "query" | "range" | "filter" | "none" {
    if (narrowingQuery(state).trim() !== "") return "query";
    const choices = [...state.values()].flatMap((s) => [...s.where.values()]);
    return choices.some((choice) => choice.type === "range") ? "range" : choices.length > 0 ? "filter" : "none";
}

/**
 * Writes the saved views back to the host's bind handle.
 *
 * @param views - The views, as the sheet holds them now
 * @param write - The views' write-back, if the host keeps them
 */
export function writeSheetViews(views: readonly SheetSavedView[], write: ((views: SheetSavedView[]) => unknown) | undefined): void {
    write?.([...views]);
}
