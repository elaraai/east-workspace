/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** The Sheet's identity of a paged source snapshot — its id and revision — for its key search and its driver (#851: the Sheet is its only user). @packageDocumentation */
import { OptionType, StringType, StructType, equalFor, none, printFor, some, type ValueTypeOf } from "@elaraai/east";

/** An absent source and a source discovering its revision remain distinct. */
export const PagedSnapshotType = StructType({ source: OptionType(StringType), revision: OptionType(StringType) });
export type PagedSnapshot = ValueTypeOf<typeof PagedSnapshotType>;
export const pagedSourceEqual: (a: PagedSnapshot["source"], b: PagedSnapshot["source"]) => boolean = equalFor(PagedSnapshotType.fields.source);
export const pagedSnapshotEqual: (a: PagedSnapshot, b: PagedSnapshot) => boolean = equalFor(PagedSnapshotType);
/** React requires a scalar key; East's canonical printer preserves the typed identity. */
export const pagedSnapshotKey: (snapshot: PagedSnapshot) => string = printFor(PagedSnapshotType);

/** Construct the identity using East Option values, including the discovery state. */
export function pagedSnapshot(source: string | undefined, revision: string | undefined): PagedSnapshot {
    return { source: source === undefined ? none : some(source), revision: revision === undefined ? none : some(revision) };
}
