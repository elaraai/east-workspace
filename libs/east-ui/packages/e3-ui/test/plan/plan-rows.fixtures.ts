/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the Plan's specs read a canvas by (test use): a row's id, the rows of
 * an inline canvas in their order, what each holds, and the comparisons of
 * them — written once, for every spec that draws a Plan and reads its rows.
 *
 * @packageDocumentation
 */

import { ArrayType, DateTimeType, OptionType, SortedMap, StringType, compareFor, equalFor, variant, type option, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";

/** A row's id, decoded. */
export type RowId = ValueTypeOf<typeof Plan.Types.RowId>;
/** A Plan's root, decoded. */
export type Root = ValueTypeOf<typeof Plan.Types.Root>;
/** One row of a canvas, decoded. */
export type Row = ValueTypeOf<typeof Plan.Types.Row>;

/** The id of an entry's row: its series' key, and the entry's path. */
export const entry = (series: string, ...path: string[]): RowId => variant("entry", { series, path });

/** Whether two lists of row ids are the same. */
export const sameIds: (a: RowId[], b: RowId[]) => boolean = equalFor(ArrayType(Plan.Types.RowId));
/** Whether two lists of rows' parents are the same. */
export const sameParents: (a: option<RowId>[], b: option<RowId>[]) => boolean = equalFor(ArrayType(OptionType(Plan.Types.RowId)));
/** Whether two lists of labels are the same. */
export const sameLabels: (a: string[], b: string[]) => boolean = equalFor(ArrayType(StringType));

/** One block of a canvas's rows, decoded. */
export type Block = ValueTypeOf<typeof Plan.Types.Block>;

/**
 * The canvas's blocks, in order.
 *
 * @param root - The Plan's root
 * @returns Its blocks
 * @throws {Error} When the canvas is not inline
 */
export function blocksOf(root: Root): Block[] {
    if (root.rows.type !== "inline") throw new Error("expected an inline canvas");
    return root.rows.value;
}
/** The canvas's rows, every block's in order. */
export const rowsOf = (root: Root): Row[] => blocksOf(root).flatMap((block) => block.rows);
/** Each row's id, in order. */
export const ids = (root: Root): RowId[] => rowsOf(root).map((r) => r.id);
/** Each row's parent, in order. */
export const parents = (root: Root): option<RowId>[] => rowsOf(root).map((r) => r.parent);
/** Each row's gutter label, in order. */
export const labels = (root: Root): string[] => rowsOf(root).map((r) => r.gutter.label);

/** Readings at their instants: a Dict keyed by DateTime, which East keeps in its order. */
export const readings = (...values: [Date, number][]): SortedMap<Date, number> => new SortedMap(values, compareFor(DateTimeType));
