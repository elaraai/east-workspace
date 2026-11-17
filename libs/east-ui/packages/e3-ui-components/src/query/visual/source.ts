/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A listed source as the visual printer reads it (#1670): the root field its
 * programs read, its rows as e3-ui's own check of a surface's sources reads
 * them (`sourceRowsOf`), and its range field.
 *
 * It reads e3-ui as it runs, which reaches east-ui, so the query's calls entry
 * (`@elaraai/e3-ui-components/query`), which loads in Node with neither, does
 * not carry it: a host there makes a {@link PrintSource} from e3-ui's
 * `sourceRowsOf` itself.
 *
 * @packageDocumentation
 */

import { fromEastTypeValue, type ValueTypeOf } from "@elaraai/east";
import { sourceRowsOf, type StudioSourceType } from "@elaraai/e3-ui/internal";
import type { PrintSource } from "./print.js";

/** A listed source, decoded. */
type Source = ValueTypeOf<typeof StudioSourceType>;

/**
 * A listed source as the printer reads it.
 *
 * @param source - The source, as a Studio surface lists it
 * @returns What the printer reads of it; `undefined` when its rows are not an Array or a Dict of Structs
 */
export function printSourceOf(source: Source): PrintSource | undefined {
    const rows = sourceRowsOf(fromEastTypeValue(source.binding.type));
    if (rows === undefined) return undefined;
    return { key: source.key, row: rows.row, keyed: rows.keyed, range: source.range.type === "some" ? source.range.value : undefined };
}
