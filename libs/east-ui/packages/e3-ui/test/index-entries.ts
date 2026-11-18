/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The entries an index of a record holds for some rows, as e3 stores them:
 * what a spec hands a body that takes `e3.index(record.indexes.<name>)` as an
 * input — an optimiser's (east-workspace#1622) — and what a page's searches of
 * the index are answered from (e3#1618). Each is filed by the index's own build
 * program, and a summary's summed by its own merge, so a spec reads the index
 * as e3 would have built it.
 *
 * @packageDocumentation
 */

import { NullType, SortedMap, StructType, compareFor, type EastType } from "@elaraai/east";
import { builtIndex, indexBuildProgram, summaryMergeProgram, type RecordDef, type RecordIndexDef } from "@elaraai/e3";
import type { RecordSummaryTotals } from "@elaraai/e3-types";

/** An index's entries, by `{ ik, k }` in the index's own order, and the type of that key. */
export interface IndexEntries {
    /** The entry's key type, `{ ik, k }`: `k` Null for a summary, whose entry stands for every row of its key. */
    readonly entryKey: StructType;
    /** The entries, each what the index carries for its row. */
    readonly entries: SortedMap<unknown, unknown>;
}

/**
 * Builds the entries an index of a record holds for some rows.
 *
 * @param record - The record
 * @param index - One of its indexes, as it carries it (`record.indexes.<name>`)
 * @param rows - The record's rows, as its state holds them
 * @returns The entries, in the index's order, and their key's type
 */
export function indexEntries(record: RecordDef, index: RecordIndexDef, rows: unknown): IndexEntries {
    const def = builtIndex(record, index);
    const summary = def.summary !== undefined || def.span !== undefined;
    const entryKey = StructType({ ik: def.keyType, k: summary ? NullType : (record.type as EastType & { key: EastType }).key });
    const entries = new SortedMap<unknown, unknown>(undefined, compareFor(entryKey) as never);
    const merge = summary
        ? summaryMergeProgram(def).compile([]) as (entry: unknown, a: RecordSummaryTotals, b: RecordSummaryTotals) => RecordSummaryTotals
        : undefined;
    const build = indexBuildProgram(record.type, def).compile([]) as (piece: unknown, emit: (entry: unknown, value: unknown) => null) => unknown;
    build(rows, (entry, value) => {
        const before = entries.get(entry);
        entries.set(entry, before === undefined || merge === undefined ? value : merge(entry, before as RecordSummaryTotals, value as RecordSummaryTotals));
        return null;
    });
    return { entryKey, entries };
}
