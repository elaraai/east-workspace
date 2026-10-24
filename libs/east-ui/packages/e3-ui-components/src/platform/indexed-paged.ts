/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Named field-index reads, adapted through the existing pinned paged runtime. */
import {
    East, ArrayType, BooleanType, DictType, IntegerType, NullType, OptionType,
    StringType, StructType, fromEastTypeValue, toEastTypeValue, printType, isTypeEqual, parseFor, printFor,
    none, some, variant, type EastType, type EastTypeValue, type option, type ValueTypeOf,
} from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import { AREA_FIELD, IndexedEntryType, TILE_FIELD, readTileMarker } from "@elaraai/east-ui/internal";
import { bindIndexedPagedPlatformFn, DataIndexedPrimitives } from "@elaraai/e3-ui/internal";
import { RecordSummaryTotalsType, TreePathType, indexWindowType, type TreePath } from "@elaraai/e3-types";
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

    // Each index's printer of an entry key, `(ik=…, k=…)`, from its key's text and the row's key (#1349).
    private entryPrinters = new WeakMap<Schema, Map<string, (ik: string, key: unknown) => string>>();

    constructor(private readonly paged: Pick<PagedRuntime, "buildHandle" | "sourceOf" | "seekAll" | "runsAll" | "placeAll" | "withinAll" | "rowsAll" | "joinAll">) {}

    clear(): void { this.handles.clear(); this.windows = new WeakMap(); this.sources = new WeakMap(); this.entryPrinters = new WeakMap(); }

    /**
     * An index's entry key, `(ik=…, k=…)`, as a membership read names it (#1349):
     * the index key's `.east` text, as the binding's maintained keys print it,
     * read back as the index key's type, beside the row's key.
     *
     * @param schema - The binding's types
     * @param name - The index
     * @returns The printer
     */
    private entryPrinter(schema: Schema, name: string): (ik: string, key: unknown) => string {
        let printers = this.entryPrinters.get(schema);
        if (printers === undefined) { printers = new Map(); this.entryPrinters.set(schema, printers); }
        let print = printers.get(name);
        if (print === undefined) {
            const ikType = schema.keys[name];
            if (ikType === undefined) throw new Error(`Index '${name}' was not declared on this binding`);
            const parse = parseFor(ikType);
            const printEntry = printFor(StructType({ ik: ikType, k: schema.args[0] }));
            print = (ik, key) => {
                const parsed = parse(ik);
                if (!parsed.success) throw new Error(`The index '${name}' has no key ${ik}: ${parsed.error}`);
                return printEntry({ ik: parsed.value, k: key });
            };
            printers.set(name, print);
        }
        return print;
    }

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
            // One entry a row: no Set field, and no interval's start, which files an event up to three times; an area
            // index's `__area` files each row once.
            return fields?.type === "Struct" && Object.entries(fields.fields as Record<string, EastType>).every(([field, marker]) =>
                marker.type === "Array" || (marker.type === "Null" && schema.row.fields[field]?.type !== "Set")
                || (marker.type === "Struct" && field === AREA_FIELD));
        });
        if (index === undefined) throw new Error("A covering-only binding needs an index with one entry per record row");
        return index;
    }

    /** The marker the binding gives an index's field, in its metadata's type: a struct for a generated field. */
    private marker(schema: Schema, name: string, field: string): EastType | undefined {
        const types = schema.args[3];
        const fields = types.type === "Struct" ? types.fields[name] : undefined;
        return fields?.type === "Struct" ? (fields.fields as Record<string, EastType>)[field] : undefined;
    }

    /** Whether an index is a summary index (#1039): its `__tile` marked as a summary's, its entries totals naming no row. */
    private isSummary(schema: Schema, name: string): boolean {
        const tile = this.marker(schema, name, TILE_FIELD);
        return tile?.type === "Struct" && readTileMarker(Object.keys(tile.fields))?.summary === true;
    }

    /**
     * Whether an index carries its rows (D29): an area index, whose `__area`
     * the binding marks, or a series index (#1039), whose `__tile` it marks,
     * whose entries hold the whole row as their projection, so it is read
     * without a join.
     */
    private carriesRow(schema: Schema, name: string): boolean {
        const tile = this.marker(schema, name, TILE_FIELD);
        return this.marker(schema, name, AREA_FIELD)?.type === "Struct"
            || (tile?.type === "Struct" && readTileMarker(Object.keys(tile.fields))?.summary === false);
    }

    private source(schema: Schema, path: TreePath, metadata: Metadata, joined: boolean, name: string): Handle {
        if (name !== "primary" && !Object.hasOwn(metadata, name)) throw new Error(`Index '${name}' was not declared on this binding`);
        let built = this.sources.get(schema);
        if (built === undefined) { built = new Map(); this.sources.set(schema, built); }
        // An index that carries its rows is read without a join, whatever the binding's (D29), and a summary
        // index's entries name no row to join (#1039).
        const rows = name !== "primary" && this.carriesRow(schema, name);
        const summary = name !== "primary" && this.isSummary(schema, name);
        const join = name !== "primary" && joined && !rows && !summary;
        const sourceKey = `${datasetPathToString(path)}\u0000${name}\u0000${join ? "+join" : ""}`;
        const cached = built.get(sourceKey);
        if (cached !== undefined) return cached;
        const [key, row, projection] = schema.args;
        const type = name === "primary" ? schema.collection
            : summary ? indexWindowType(NullType, schema.keys[name]!, RecordSummaryTotalsType, row)
                : indexWindowType(key, schema.keys[name]!, rows ? row : projection, row);
        const handle = this.paged.buildHandle(toEastTypeValue(type), path,
            { index: name === "primary" ? null : name, join }, "pinned") as unknown as Handle;
        built.set(sourceKey, handle);
        return handle;
    }

    /** A window of a source as a binding's entries, each tagged with the
     *  source that orders it: mapped once per window, so a window read again
     *  keeps its identity. An index that carries its rows gives each entry's
     *  projection as its row, and the binding's projection as its value: the
     *  row itself, or Null beside indexes that carry nothing (D29). A summary
     *  index's entry gives its totals as its value, and names no row (#1039). */
    private entriesOf(schema: Schema, name: string, window: unknown): unknown[] {
        let mapped = this.windows.get(window as object);
        if (mapped === undefined) { mapped = new Map(); this.windows.set(window as object, mapped); }
        let rows = mapped.get(name);
        if (rows === undefined) {
            if (name === "primary") {
                rows = [...window as Map<unknown, unknown>].map(([key, row]) => ({ ik: variant("primary", key), key, value: none, row: some(row) }));
            } else if (this.isSummary(schema, name)) {
                rows = (window as Entry[]).map(entry => ({ ik: variant(name, entry.ik), key: entry.key, value: some(entry.value), row: none }));
            } else if (this.carriesRow(schema, name)) {
                const whole = isTypeEqual(schema.args[2], schema.row);
                rows = (window as Entry[]).map(entry => ({ ik: variant(name, entry.ik), key: entry.key, value: some(whole ? entry.value : null), row: some(entry.value) }));
            } else {
                rows = (window as Entry[]).map(entry => ({ ik: variant(name, entry.ik), key: entry.key, value: some(entry.value), row: entry.row }));
            }
            mapped.set(name, rows);
        }
        return rows;
    }

    /**
     * The reads the paged runtime batches for a binding this runtime built
     * (#1351): several searches of one of its sources in one request, the
     * entries of several runs of one in one, the rows of several of the
     * record's own keys in one (#1039), and another Dict's rows under the keys
     * some runs of one of its indexes name in one (#1393), each through the
     * source's own handle, so its channels are the ones the binding's single
     * reads use.
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
                return read.type === "none" ? none : some(this.entriesOf(schema, name, read.value) as never);
            },
            // Where a narrowing's runs of an index sit in the record, and which entries they hold (#1349).
            placeAll: (name, runs) => {
                if (name === "primary") throw new Error("A placement places runs of one of the record's indexes, never of its own rows");
                if (this.isSummary(schema, name)) throw new Error(`A placement places a narrowing's rows, and '${name}' is a summary index, whose entries name none`);
                const placement = this.paged.placeAll(sourceOf(name), runs.map(run => [Number(run.row), Number(run.count)] as const));
                if (placement.type === "none") return none;
                const { segments, placed, entries, total, complete } = placement.value;
                return some({
                    segments: segments.map(segment => ({ offset: BigInt(segment.offset), count: BigInt(segment.count), rows: BigInt(segment.rows) })),
                    placed: BigInt(placed), total: BigInt(entries), records: BigInt(total), complete,
                });
            },
            withinAll: (name, runs, entries) => {
                if (name === "primary") throw new Error("A membership read asks of runs of one of the record's indexes, never of its own rows");
                if (this.isSummary(schema, name)) throw new Error(`A membership read asks of a narrowing's rows, and '${name}' is a summary index, whose entries name none`);
                const print = this.entryPrinter(schema, name);
                const within = this.paged.withinAll(sourceOf(name), runs.map(run => [Number(run.row), Number(run.count)] as const),
                    entries.map(entry => print(entry.ik, entry.key)));
                return within.type === "none" ? none : some([...within.value]);
            },
            // The rows of several of the record's own keys in one request (#1039): its own Dict's rows by key.
            rowsAll: (keys) => {
                if (!joined) throw new Error("A covering-only binding cannot read primary rows");
                const read = this.paged.rowsAll(sourceOf("primary"), keys);
                return read.type === "none" ? none : some(read.value.map(entry => entry.row));
            },
            // Another Dict's rows under the keys the entries of some runs of one of the record's indexes name, the server
            // reading the keys from the index (#1393): a Schematic's details, for its area index's cells.
            joinAll: (name, runs, dict) => {
                if (name === "primary") throw new Error("A read of rows by runs reads the keys one of the record's indexes names, never runs of its own rows");
                if (this.isSummary(schema, name)) throw new Error(`A read of rows by runs reads the keys its entries name, and '${name}' is a summary index, whose entries name none`);
                const rows = this.paged.sourceOf(dict);
                if (rows === undefined) throw new Error(`Data.bindPaged: the Dict read '${dict}' is bound on no page this runtime serves`);
                const read = this.paged.joinAll(rows, sourceOf(name), runs.map(run => [Number(run.row), Number(run.count)] as const));
                return read.type === "none" ? none : some([...read.value]);
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
                    // A page's entries are the binding's, each naming its row; a summary's are totals naming none (#1039).
                    if (name !== "primary" && this.isSummary(schema, name)) {
                        throw new Error(`Data.bindPaged: '${name}' is a summary index, whose entries name no row: a reader reads its cells (recordSliceCellEntries)`);
                    }
                    const result = this.source(schema, path, metadata, joined, name).page(offset, limit);
                    if (result.type === "none") return none;
                    return some(this.entriesOf(schema, name, result.value));
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
