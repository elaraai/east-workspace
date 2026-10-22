/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which of a builder's rows show: a Set of the rows' original String keys, or
 * `Slice.rows(recordSlice)` over an indexed record, projected to those keys —
 * never a row predicate. `recordSources` reads each source of a builder's
 * `Slice.bindRecords` through it (#1340); the complete rows stay a separate
 * input, for the calculations a narrowing never changes.
 *
 * @packageDocumentation
 */
import { ArrayType, SetType, StringType, isTypeEqual, type ExprType, type StructType } from "@elaraai/east";
import { buildRowSource, resolveRowSource } from "@elaraai/east-ui/internal";

/**
 * Keeps an inline key Set, and adapts `Slice.rows(recordSlice)` to a source of
 * original keys through the shared paging.
 *
 * @param input - Original row keys, or indexed record windows
 * @param prop - What it was given as, for the refusal (`Roster.slice's people`)
 * @returns The inline Set, or a source of original keys
 * @throws {Error} Naming `prop`, when it is neither a Set of String keys nor `Slice.rows` of a record Slice with String keys
 */
export function keyVisibility(input: unknown, prop: string) {
    const resolved = resolveRowSource(input, prop);
    if (resolved.kind === "inline" && isTypeEqual(resolved.collectionType, SetType(StringType))) {
        return { inline: resolved.rows as ExprType<SetType<StringType>> };
    }
    if (resolved.kind !== "ordered" || !resolved.pinned || !isTypeEqual(resolved.keyType, StringType)) {
        throw new Error(`${prop} requires a Set of String keys or Slice.rows of a record Slice with String primary keys`);
    }
    const source = buildRowSource(resolved, ArrayType(StringType), rows =>
        (rows as ExprType<ArrayType<StructType>>).map((_$, entry) => entry.key as ExprType<StringType>));
    return { source };
}
