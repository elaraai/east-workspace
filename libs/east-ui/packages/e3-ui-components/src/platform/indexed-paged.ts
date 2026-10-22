/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Named field-index reads, adapted through the existing pinned paged runtime. */
import {
    East, ArrayType, BooleanType, DictType, IntegerType, NullType, OptionType,
    StringType, StructType, fromEastTypeValue, toEastTypeValue, printType,
    none, some, variant, type EastType, type EastTypeValue, type option, type ValueTypeOf,
} from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import { IndexedEntryType } from "@elaraai/east-ui/internal";
import { bindIndexedPagedPlatformFn, DataIndexedPrimitives } from "@elaraai/e3-ui/internal";
import { TreePathType, indexWindowType, type TreePath } from "@elaraai/e3-types";
import type { RecordSliceBatches } from "@elaraai/east-ui-components/platform";
import { datasetPathToString } from "./dataset-store.js";
import type { PagedRuntime } from "./paged-runtime.js";
import { toFindQuery } from "./find-query.js";

type Metadata = Record<string, Record<string, unknown>>;
type Query = ValueTypeOf<typeof SeekQueryType>;
type Range = ValueTypeOf<typeof SeekRangeType>;
type Entry = { ik: unknown; key: unknown; value: unknown; row: option<unknown> };
interface Handle {
    id: string;
    page(offset: bigint, limit: bigint): option<unknown>;
    total(): option<bigint>;
    seek: option<(query: Query) => option<Range>>;
    revision(): option<string>;
    refresh(hash: option<string>): null;
}
interface Schema {
    args: [EastType, EastType, EastType, EastType, EastType];
    row: StructType;
    keys: Record<string, EastType>;
    collection: EastType;
    window: EastType;
}

/** What a binding this runtime built reads: its record, its indexes and its join. */
interface Binding {
    readonly schema: Schema;
    readonly path: TreePath;
    readonly metadata: Metadata;
    readonly joined: boolean;
}

/**
 * The batched reads of each handle an indexed runtime built, by the handle
 * itself (#1351): a record Slice bound over the handle finds the runtime that
 * built it, whichever runtime that is — the page's, or a spec's own.
 */
const batchesOfHandles = new WeakMap<object, RecordSliceBatches>();

/**
 * The reads a paged runtime batches for a binding an indexed runtime built
 * (#1351): several searches of one of its sources in one request, and the
 * entries of several runs of one in one — what a record Slice bound over it
 * reads a plan's searches and its windows through.
 *
 * @param binding - The binding: the handle `Data.bindPaged` over a record's indexes returned
 * @returns Its batched reads, or `undefined` for a handle no indexed runtime built here — one decoded from
 *   elsewhere, whose Slice then reads its searches and runs one at a time
 */
export function recordSliceBatchesOf(binding: object): RecordSliceBatches | undefined {
    return batchesOfHandles.get(binding);
}

/**
 * Serializable indexed handles backed by PagedRuntime's existing snapshots,
 * caches, error/retry handling and tracked reads. No second fetch cache lives here.
 */
export class IndexedPagedRuntime {
    private readonly handles = new Map<string, Record<string, unknown>>();
    // Preserve window identity without retaining pages the paged cache evicts.
    private windows = new WeakMap<object, Map<string, unknown[]>>();
    // Each schema's sources, built once: a window over an interval index is
    // some fifty-five searches, and each read built its source's window type
    // again and looked its handle up by that type's structure.
    private sources = new WeakMap<Schema, Map<string, Handle>>();

    constructor(private readonly paged: Pick<PagedRuntime, "buildHandle" | "sourceOf" | "seekAll" | "runsAll">) {}

    clear(): void { this.handles.clear(); this.windows = new WeakMap(); this.sources = new WeakMap(); }

    private schema(types: EastTypeValue[]): Schema {
        const args = types.map(fromEastTypeValue) as Schema["args"];
        const [key, row, projection, , keys] = args;
        if (row.type !== "Struct" || keys.type !== "Variant") throw new Error("Invalid indexed record schema");
        return { args, row, keys: keys.cases, collection: DictType(key, row), window: ArrayType(IndexedEntryType(key, row, projection, keys)) };
    }

    private defaultIndex(schema: Schema, metadata: Metadata, joined: boolean): string {
        if (joined) return "primary";
        const types = schema.args[3];
        const index = Object.keys(metadata).find(name => {
            const fields = types.type === "Struct" ? types.fields[name] : undefined;
            return fields?.type === "Struct" && Object.entries(fields.fields as Record<string, EastType>).every(([field, marker]) =>
                marker.type === "Array" || marker.type === "Null" && schema.row.fields[field]?.type !== "Set");
        });
        if (index === undefined) throw new Error("A covering-only binding needs an index with one entry per record row");
        return index;
    }

    private source(schema: Schema, path: TreePath, metadata: Metadata, joined: boolean, name: string): Handle {
        if (name !== "primary" && !Object.hasOwn(metadata, name)) throw new Error(`Index '${name}' was not declared on this binding`);
        let built = this.sources.get(schema);
        if (built === undefined) { built = new Map(); this.sources.set(schema, built); }
        const sourceKey = `${datasetPathToString(path)}\u0000${name}\u0000${joined ? "+join" : ""}`;
        const cached = built.get(sourceKey);
        if (cached !== undefined) return cached;
        const [key, row, projection] = schema.args;
        const type = name === "primary" ? schema.collection : indexWindowType(key, schema.keys[name]!, projection, row);
        const handle = this.paged.buildHandle(toEastTypeValue(type), path,
            { index: name === "primary" ? null : name, join: name !== "primary" && joined }, "pinned") as unknown as Handle;
        built.set(sourceKey, handle);
        return handle;
    }

    /** A window of a source as a binding's entries, each tagged with the
     *  source that orders it: mapped once per window, so a window read again
     *  keeps its identity. */
    private entriesOf(name: string, window: unknown): unknown[] {
        let mapped = this.windows.get(window as object);
        if (mapped === undefined) { mapped = new Map(); this.windows.set(window as object, mapped); }
        let rows = mapped.get(name);
        if (rows === undefined) {
            rows = name === "primary"
                ? [...window as Map<unknown, unknown>].map(([key, row]) => ({ ik: variant("primary", key), key, value: none, row: some(row) }))
                : (window as Entry[]).map(entry => ({ ik: variant(name, entry.ik), key: entry.key, value: some(entry.value), row: entry.row }));
            mapped.set(name, rows);
        }
        return rows;
    }

    /**
     * The reads the paged runtime batches for a binding this runtime built
     * (#1351): several searches of one of its sources in one request, and the
     * entries of several runs of one in one, each through the source's own
     * handle, so its channels are the ones the binding's single reads use.
     *
     * @param binding - What the binding reads
     * @returns Its batched reads
     */
    private batches({ schema, path, metadata, joined }: Binding): RecordSliceBatches {
        const sourceOf = (name: string) => {
            const handle = this.source(schema, path, metadata, joined, name);
            const source = this.paged.sourceOf(handle.id);
            if (source === undefined) throw new Error(`Data.bindPaged: the source '${name}' of ${handle.id} is no source this runtime serves`);
            return source;
        };
        return {
            seekAll: (name, queries) => {
                const source = sourceOf(name);
                const found = this.paged.seekAll(source, queries.map(query => toFindQuery(query, source.selector)));
                return found.type === "none" ? none
                    : some(found.value.map(range => ({ found: range.found, row: BigInt(range.row), count: BigInt(range.count) })));
            },
            runsAll: (name, runs) => {
                if (name === "primary" && !joined) throw new Error("A covering-only binding cannot read primary rows");
                const read = this.paged.runsAll(sourceOf(name), runs.map(run => [Number(run.row), Number(run.count)] as const));
                return read.type === "none" ? none : some(this.entriesOf(name, read.value) as never);
            },
        };
    }

    private primitives(): PlatformFunction[] {
        const { page, seek, total, revision, refresh } = DataIndexedPrimitives;
        return [
            page.implement((...types: EastTypeValue[]) => {
                const schema = this.schema(types);
                return (...values: unknown[]) => {
                    const [path, metadata, joined, name, offset, limit] = values as [TreePath, Metadata, boolean, string, bigint, bigint];
                    if (name === "primary" && !joined) throw new Error("A covering-only binding cannot read primary rows");
                    const result = this.source(schema, path, metadata, joined, name).page(offset, limit);
                    if (result.type === "none") return none;
                    return some(this.entriesOf(name, result.value));
                };
            }),
            seek.implement((...types: EastTypeValue[]) => {
                const schema = this.schema(types);
                return (...values: unknown[]) => {
                    const [path, metadata, joined, name, query] = values as [TreePath, Metadata, boolean, string, Query];
                    const source = this.source(schema, path, metadata, joined, name);
                    if (source.seek.type !== "some") throw new Error("The selected record source cannot be searched");
                    return source.seek.value(query);
                };
            }),
            total.implement((...types: EastTypeValue[]) => {
                const schema = this.schema(types);
                return (...values: unknown[]) => {
                    const [path, metadata, joined, name] = values as [TreePath, Metadata, boolean, string];
                    // A non-fan-out index counts exactly the primary rows. Use
                    // it in covering-only mode without opening primary segments.
                    const source = this.source(schema, path, metadata, joined,
                        name === "primary" && !joined ? this.defaultIndex(schema, metadata, joined) : name);
                    const count = source.total();
                    if (count.type === "some") return count;
                    // The existing page response supplies the exact total.
                    // One bounded entry initiates it; never scan to count.
                    source.page(0n, 1n);
                    return source.total();
                };
            }),
            revision.implement((...types: EastTypeValue[]) => {
                const schema = this.schema(types);
                return (...values: unknown[]) => {
                    const [path, metadata, joined] = values as [TreePath, Metadata, boolean];
                    return this.source(schema, path, metadata, joined, "primary").revision();
                };
            }),
            refresh.implement((...types: EastTypeValue[]) => {
                const schema = this.schema(types);
                return (...values: unknown[]) => {
                    const [path, metadata, joined, hash] = values as [TreePath, Metadata, boolean, option<string>];
                    return this.source(schema, path, metadata, joined, "primary").refresh(hash);
                };
            }),
        ];
    }

    /** Indexed bind and its serializable primitives, optionally manifest-scoped. */
    platform(allowed: ReadonlySet<string> | null): PlatformFunction[] {
        const primitives = this.primitives();
        return [bindIndexedPagedPlatformFn.implement((...types: EastTypeValue[]) => {
            const schema = this.schema(types);
            return (...values: unknown[]) => {
                const [path, metadata, joined, entryKeys, recordId] = values as [TreePath, Metadata, boolean, (index: string, key: unknown, row: unknown) => string[], string];
                const pathKey = datasetPathToString(path);
                if (allowed !== null && !allowed.has(pathKey)) throw new Error(`Data.bindPaged: source path '${pathKey}' not declared in manifest`);
                const typeKey = printType(StructType(Object.fromEntries(schema.args.map((type, i) => [`T${i}`, type]))));
                const id = `${pathKey}@indexes:${Object.keys(metadata).join(",")}${joined ? "+join" : ""}`;
                const cacheKey = `${typeKey}:${id}`;
                const cached = this.handles.get(cacheKey);
                if (cached !== undefined) return cached;
                const args = schema.args;
                const descriptor = [East.value(path, TreePathType), East.value(metadata as never, args[3]), East.value(joined, BooleanType)] as const;
                const { page, seek, total, revision, refresh } = DataIndexedPrimitives;
                const handle = {
                    id, recordId, indexes: metadata, joined, defaultIndex: this.defaultIndex(schema, metadata, joined), entryKeys,
                    page: East.compile(East.function([StringType, IntegerType, IntegerType], OptionType(schema.window), ($, name, offset, limit) =>
                        $.return(page(args, ...descriptor, name, offset, limit))), primitives),
                    seek: East.compile(East.function([StringType, SeekQueryType], OptionType(SeekRangeType), ($, name, query) =>
                        $.return(seek(args, ...descriptor, name, query))), primitives),
                    total: East.compile(East.function([StringType], OptionType(IntegerType), ($, name) =>
                        $.return(total(args, ...descriptor, name))), primitives),
                    revision: East.compile(East.function([], OptionType(StringType), $ =>
                        $.return(revision(args, ...descriptor))), primitives),
                    refresh: East.compile(East.function([OptionType(StringType)], NullType, ($, hash) =>
                        $.return(refresh(args, ...descriptor, hash))), primitives),
                };
                this.handles.set(cacheKey, handle);
                // A record Slice bound over the handle reads its searches and runs in batches (#1351).
                batchesOfHandles.set(handle, this.batches({ schema, path, metadata, joined }));
                return handle;
            };
        }), ...primitives];
    }
}
