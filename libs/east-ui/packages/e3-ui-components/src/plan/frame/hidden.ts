/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What a viewer hides in the library's Series tab (#1195, `Plan Builder
 * Spec.md` PB29), as the canvas reads it. The ids are the tab's
 * (`planHideId`): the event kinds, the resource kinds and their measures leave
 * the event kinds' rows through the `blocks` seam, and the Plan's own `rows`
 * leave the canvas here — a hand-built row and the rows under it by its key,
 * the one step of its id's path, and a `Plan.over` series' rows, its nested
 * series' with them, by the keys they carry. `data`'s series hide through
 * their pick, in the Reactive that lays them out.
 *
 * @packageDocumentation
 */

import type { ValueTypeOf } from "@elaraai/east";
import type { PlanLibrarySeriesType } from "@elaraai/e3-ui/internal";
import type { PlanRowId } from "../model.js";

/** The Series tab on the wire, decoded. */
export type PlanSeriesTabValue = ValueTypeOf<typeof PlanLibrarySeriesType>;

/** What hiding the Plan's own rows hides on its canvas. */
export interface PlanRowsHidden {
    /** The hand-built rows hidden, by key: each with the rows under it. */
    readonly rows: ReadonlySet<string>;
    /** The series whose rows are hidden, by key. */
    readonly series: ReadonlySet<string>;
}

/** No id hidden. */
export const NONE_HIDDEN: readonly string[] = [];

/**
 * The ids a viewer hides, as storage holds them: a list of ids, or anything
 * else a store held by mistake, which hides none.
 *
 * @param stored - What storage holds
 * @returns The ids hidden
 */
export function hiddenOf(stored: unknown): readonly string[] {
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : NONE_HIDDEN;
}

/**
 * What a viewer's hidden ids hide of the Plan's own rows.
 *
 * @param tab - The Series tab, which says what hiding each of the rows hides
 * @param hidden - The ids the viewer hides
 * @returns The rows hidden; `undefined` when the ids hide none of them
 */
export function rowsHiddenOf(tab: PlanSeriesTabValue, hidden: readonly string[]): PlanRowsHidden | undefined {
    const off = new Set(hidden);
    const rows = new Set<string>();
    const series = new Set<string>();
    for (const line of tab.rows) {
        if (!off.has(line.item.id)) continue;
        if (line.hides.type === "rows") rows.add(line.hides.value);
        else for (const key of line.hides.value) series.add(key);
    }
    return rows.size === 0 && series.size === 0 ? undefined : { rows, series };
}

/**
 * Whether a viewer hides a row of the canvas: a hand-built row's — its id's
 * series empty — by its key, else by its series' key.
 *
 * @param hidden - What the viewer hides of the Plan's own rows
 * @param id - The row's id
 * @returns Whether it is hidden
 */
export function hidesRow(hidden: PlanRowsHidden, id: PlanRowId): boolean {
    const at = id.value;
    if (at.series.length === 0) return at.path.length > 0 && hidden.rows.has(at.path[0]!);
    return hidden.series.has(at.series);
}
