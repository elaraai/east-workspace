/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A paged Library tab's own search (#1340, ruling 11): what a tab that pages
 * a big record finds, for the tab alone. The tab lists what its builder's rail
 * narrows the record to; its search box finds within that, so it reads the
 * record through its source's part — `pageWhere` and `countWhere` — under one
 * narrowing of its own: the rail's choices, and the text a prefix of a field
 * the source lists in `search`, answered by one of the record's indexes. It
 * never writes the rail, and the rail's counts never see it.
 *
 * A field the search may read is a String field the source lists in `search`
 * that is not a Set's (a Set's index takes exact values only). The search
 * reads the first that combines with the rail's choices: one the rail already
 * narrows, whose choice the text narrows further — a longer prefix, or the
 * chosen values that start with the text — or one whose prefix follows the
 * rail's choices on one index. When none does, the rail's choices block the
 * search, and the tab says which.
 *
 * @packageDocumentation
 */

import { StringType, SortedMap, compareFor, equalFor, isValueOf, variant, type ValueTypeOf } from "@elaraai/east";
import {
    recordPlanIndex, type RecordSliceChoiceType, type RecordSliceConfigType, type RecordSliceFieldType, type RecordSliceWhereType,
} from "@elaraai/east-ui/internal";
import { readRecordChoice } from "../../slice/record/value.js";

type Where = ValueTypeOf<RecordSliceWhereType>;
type Choice = ValueTypeOf<RecordSliceChoiceType>;
type Field = ValueTypeOf<RecordSliceFieldType>;
type Config = ValueTypeOf<RecordSliceConfigType>;

const compareName = compareFor(StringType);
const nameEqual = equalFor(StringType);

/** The field a tab's search reads now, or the rail's choices that block every one. */
export type PagedSearchTarget =
    | { readonly field: Field; readonly blocking?: undefined }
    | { readonly field?: undefined; readonly blocking: readonly Field[] };

/**
 * The fields a tab's search may read: the String fields its source lists in
 * `search`, in that order, but a Set's.
 *
 * @param config - The source's record Slice config
 * @returns The fields
 */
export function pagedSearchFields(config: Config): Field[] {
    return config.search.flatMap((id) => {
        const field = config.fields.find((candidate) => nameEqual(candidate.fieldId, id));
        return field !== undefined && field.kind === "string" && !field.set ? [field] : [];
    });
}

/** A narrowing with one field's choice set, the rest as they are, in East's order. */
function withChoice(where: Where, field: string, choice: Choice): Where {
    const next = new SortedMap<string, Choice>([...where], compareName);
    next.set(field, choice);
    return next;
}

/**
 * The field a tab's search reads under the rail's choices (see the module
 * docs): the first field the source's `search` lists that the rail narrows
 * already, or whose prefix follows the rail's choices on one index.
 *
 * @param config - The source's record Slice config
 * @param where - The rail's choices on the source
 * @returns The field; or, when none combines, the rail's choices that block the search; `undefined` with no field to search
 */
export function pagedSearchTarget(config: Config, where: Where): PagedSearchTarget | undefined {
    const fields = pagedSearchFields(config);
    if (fields.length === 0) return undefined;
    for (const field of fields) {
        if (where.has(field.fieldId)) return { field };
        if (recordPlanIndex(config.indexes, withChoice(where, field.fieldId, variant("prefix", ""))) !== undefined) return { field };
    }
    return { blocking: config.fields.filter((field) => where.has(field.fieldId)) };
}

/**
 * The narrowing a tab's search reads: the rail's choices, the text a prefix of
 * `field` — over a field the rail narrows already, its choice narrowed by the
 * text: the longer of two prefixes, or the chosen values that start with it.
 *
 * @param field - The field the search reads ({@link pagedSearchTarget})
 * @param where - The rail's choices on the source
 * @param text - The search's text, not empty
 * @returns The narrowing, or `null` when no row the rail shows can start with the text
 */
export function pagedSearchWhere(field: Field, where: Where, text: string): Where | null {
    const held = where.get(field.fieldId);
    if (held === undefined) return withChoice(where, field.fieldId, variant("prefix", text));
    if (held.type === "prefix") {
        if (text.startsWith(held.value)) return withChoice(where, field.fieldId, variant("prefix", text));
        // The rail's prefix is the longer: the text finds nothing it does not already show.
        return held.value.startsWith(text) ? where : null;
    }
    if (held.type === "values") {
        const kept = held.value.filter((literal) => {
            // An Unset choice reads as nothing, which starts with no text.
            const value = readRecordChoice(field, literal);
            return isValueOf(value, StringType) && (value as string).startsWith(text);
        });
        return kept.length === 0 ? null : withChoice(where, field.fieldId, variant("values", kept));
    }
    // A String field takes no range: nothing the rail shows can start with the text.
    return null;
}
