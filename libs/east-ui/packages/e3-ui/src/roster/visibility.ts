/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** Project indexed staff windows to their original identities, never a row predicate. */
import { ArrayType, SetType, StringType, isTypeEqual, type ExprType, type StructType } from "@elaraai/east";
import { buildRowSource, resolveRowSource } from "@elaraai/east-ui/internal";

/**
 * Preserve inline key sets and adapt Slice.rows(recordSlice) through shared paging.
 * Full staff remains a separate input for coverage, costs and validation.
 * @param input - Original staff keys, or indexed staff windows.
 * @returns The existing inline set or a source of original keys.
 */
export function rosterVisibility(input: unknown) {
    const resolved = resolveRowSource(input, "Roster.visiblePeople");
    if (resolved.kind === "inline" && isTypeEqual(resolved.collectionType, SetType(StringType))) {
        return { inline: resolved.rows as ExprType<SetType<StringType>> };
    }
    if (resolved.kind !== "ordered" || !resolved.pinned || !isTypeEqual(resolved.keyType, StringType)) {
        throw new Error("Roster.visiblePeople requires a Set of staff keys or Slice.rows of a record Slice with String primary keys");
    }
    const source = buildRowSource(resolved, ArrayType(StringType), rows =>
        (rows as ExprType<ArrayType<StructType>>).map((_$, entry) => entry.key as ExprType<StringType>));
    return { source };
}
