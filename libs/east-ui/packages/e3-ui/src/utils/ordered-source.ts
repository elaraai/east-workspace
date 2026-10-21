/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Shared primary-identity adapter for builders over secondary index windows. */
import { ArrayType, DictType, East, FunctionType, IntegerType, OptionType, StringType, StructType,
    type EastType, type ExprType, none, some } from "@elaraai/east";
import { buildPagedWindow, LiveSourceType, PinnedSourceType, PagedSourceType, type IndexedEntryType, type PagedSource, type ResolvedRowSource } from "@elaraai/east-ui/internal";

/** A window with primary identities in a separately declared index order. */
export type OrderedRowSource<K extends EastType, R extends EastType, P extends EastType, IK extends EastType> =
    PagedSource<ArrayType<ReturnType<typeof IndexedEntryType<K, R, P, IK>>>>;

/**
 * Retain the ordered window for display, and expose a bounded primary-key map
 * to the builders' existing projection and editing code. Neither reads beyond
 * the requested window or evaluates row predicates.
 * @param source - Resolved index entries.
 * @param component - The builder's name for author errors.
 * @returns Ordered identities and the keyed source over the same pages.
 */
export function orderedRowSource(source: Extract<ResolvedRowSource, { kind: "ordered" }>, component: string) {
    const entry = source.elementType;
    if (entry.type !== "Struct" || entry.fields.row?.type !== "Variant" || entry.fields.row.cases.some === undefined) {
        throw new Error(`${component}: indexed entries must carry joined record rows`);
    }
    const row = entry.fields.row.cases.some;
    const key = source.keyType;
    const collection = DictType(key, row);
    const entries = source.collectionType as ArrayType<StructType>;
    const idOf = East.function([key], StringType, (_$, value) => key.type === "String" ? value as ExprType<StringType> : East.print(value));
    const valueOf = East.function([entry], row, (_$, value) => (value.row as ExprType<OptionType<EastType>>).match({
        some: (_$2, data) => data,
        none: () => East.error(`${component} needs joined rows; use Data.bindPaged with join: true`),
    }));
    const rows = East.function([entries], collection, (_$, values) => values.toDict((_$2, value) => value.key!, (_$2, value) => valueOf(value)));
    const keys = East.function([entries], ArrayType(StringType), (_$, values) => values.map((_$2, value) => idOf(value.key!)));
    const window = buildPagedWindow(source) as ExprType<FunctionType<[IntegerType, IntegerType], OptionType<typeof entries>>>;
    const handle = source.source as unknown as ExprType<ReturnType<typeof LiveSourceType<EastType>>>;
    const page = East.function([IntegerType, IntegerType], OptionType(collection), ($, offset, limit) => {
        const read = $.const(window);
        const project = $.const(rows);
        return read(offset, limit).match({ some: (_$2, values) => East.value(some(project(values)), OptionType(collection)), none: () => East.value(none, OptionType(collection)) });
    });
    // The keyed source names what the ordered one names: its snapshot when pinned, and its narrowing too when live
    // — a rail's narrowed source (#1354).
    const keyed = East.value({ id: handle.id, page, total: handle.total, seek: handle.seek,
        ...(source.pinned ? { revision: handle.revision, refresh: handle.refresh } : {}),
        ...(source.query ? { query: handle.query } : {}),
    }, source.query ? LiveSourceType(collection) : source.pinned ? PinnedSourceType(collection) : PagedSourceType(collection));
    const resolved: ResolvedRowSource = {
        kind: "paged", source: keyed as unknown as ExprType<StructType>, collectionType: collection, elementType: row, keyType: key, pinned: source.pinned, query: source.query,
    };
    return { resolved, entries, window, rows, keys, idOf, valueOf };
}
