/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A row's key — the canonical text of its typed id (#822). Every map, DOM
 * attribute and piece of view state on the canvas keys by it, and a drag names
 * its row with it; a callback always receives the typed id itself.
 *
 * Split out of `model.ts` so the modules `model.ts` re-exports (the body items,
 * the link graph) can key by it without a circular import.
 *
 * @packageDocumentation
 */

import { parseFor, printFor, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import type { RowKey } from "./plan-state.js";

/** A row's typed identity — its series and the path of entry keys to it (#822). */
export type PlanRowId = ValueTypeOf<typeof Plan.Types.RowId>;

/**
 * The canonical text of a row id — the canvas row's key, East's own `.east`
 * printing of the id (`printFor`), so it is the same text a host builds with
 * `East.print(Plan.ref(…))` and parses back with `row.parse(Plan.Types.RowId)`.
 */
export const rowKeyOf: (id: PlanRowId) => RowKey = printFor(Plan.Types.RowId);

const parseRowId = parseFor(Plan.Types.RowId);

/**
 * The typed id a row's key is the text of — the inverse of {@link rowKeyOf},
 * for the places that hold only the key: a DOM element's row attribute, the
 * UI state's selected row.
 *
 * @remarks
 * A row repeating an earlier row's id keys as that text with `#n` appended
 * (`toCanvasRows`) and names the same id, so the suffix is dropped before the
 * text is parsed. No printed id ends in `#` and digits: it ends with the
 * variant payload's closing parenthesis.
 *
 * @param key - A canvas row key
 * @returns The id, or `undefined` when the text is not one
 */
export function rowIdOfKey(key: RowKey): PlanRowId | undefined {
    const parsed = parseRowId(key.replace(/#\d+$/, ""));
    return parsed.success ? (parsed.value as PlanRowId) : undefined;
}

/**
 * A row's key in words, for when the row itself is not at hand to name it by
 * its label (a paged row that has not landed): the last segment of its id's
 * path — the entry's own key — or, for a section header, its series.
 *
 * @param key - A canvas row key
 * @returns Words a reader can follow; the key itself when it names no id
 */
export function rowKeyWords(key: RowKey): string {
    const id = rowIdOfKey(key);
    if (id === undefined) return key;
    const path = id.value.path;
    return path.length > 0 ? path[path.length - 1]! : id.value.series;
}
