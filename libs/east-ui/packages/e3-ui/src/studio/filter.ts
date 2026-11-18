/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A page's filters (#1673) — what a reader narrows a page's visuals by.
 *
 * A filter is a jq condition on one listed source's rows: every visual of
 * that source on the page reads through it, and no other. A page holds a list
 * of them. They are the reader's — kept with the page's view in the UI store,
 * not saved with the page — and a click that filters, or opens a page, adds to
 * them.
 *
 * A filter on its source's range field is the page's range on that source: a
 * value over the previous period, or a year ago, moves it.
 *
 * Beside them, the reader's selections of the page: the groups clicked on
 * each placement whose click selects, which a visual that follows the
 * placement narrows to. They are kept as the filters are — under the page's
 * key, with its view — and are the Studio's own: no host reads them.
 *
 * @packageDocumentation
 */

import { ArrayType, DictType, JqType, OptionType, StringType, StructType, printFor, type ValueTypeOf } from "@elaraai/east";
import { TimeResolutionType } from "@elaraai/east-ui";
import { StudioKeyType } from "./pages.js";

/**
 * One filter of a page: a condition every visual of one source reads through.
 *
 * @property source - The key of a listed source
 * @property where - A jq condition over one of its rows
 */
export const StudioFilterType = StructType({
    source: StringType,
    where: JqType,
});

/** Type representing one filter of a page. */
export type StudioFilterType = typeof StudioFilterType;

/** A page's filters, in the order the reader added them. */
export const StudioFiltersType = ArrayType(StudioFilterType);

/** Type representing a page's filters. */
export type StudioFiltersType = typeof StudioFiltersType;

const printKey = printFor(StudioKeyType);

/**
 * The UI-store key a reader's filters of a page are kept under — the page's,
 * whichever surface draws it: its builder's canvas, the preview beside it, or
 * the published page. It holds a {@link StudioFiltersType}.
 *
 * @param page - The page's key
 * @returns The key
 */
export function studioFiltersKey(page: ValueTypeOf<typeof StudioKeyType>): string {
    return `studio.filters.${printKey(page)}`;
}

/**
 * One field of a group a reader clicked.
 *
 * @property field - The field the visual groups by
 * @property bucket - For a date, the unit it is bucketed by; `none` groups by the value itself
 * @property key - The group's key, as a jq literal: the field's value, or — for a date bucketed — the period number its program grouped by
 */
export const StudioPickType = StructType({
    field: StringType,
    bucket: OptionType(TimeResolutionType),
    key: JqType,
});

/** Type representing one field of a group a reader clicked. */
export type StudioPickType = typeof StudioPickType;

/** A group a reader clicked: each field it was made on — a column's category, and its split's. */
export const StudioClickedType = ArrayType(StudioPickType);

/** Type representing a group a reader clicked. */
export type StudioClickedType = typeof StudioClickedType;

/** A page's selections: the groups clicked on each placement whose click selects, by the placement's key. */
export const StudioSelectionsType = DictType(StringType, ArrayType(StudioClickedType));

/** Type representing a page's selections. */
export type StudioSelectionsType = typeof StudioSelectionsType;

/**
 * The UI-store key a reader's selections of a page are kept under, beside
 * its filters' ({@link studioFiltersKey}). It holds a
 * {@link StudioSelectionsType}.
 *
 * @param page - The page's key
 * @returns The key
 */
export function studioSelectionsKey(page: ValueTypeOf<typeof StudioKeyType>): string {
    return `studio.selections.${printKey(page)}`;
}
