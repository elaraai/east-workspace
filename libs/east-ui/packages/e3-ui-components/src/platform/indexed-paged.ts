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
import { IndexedEntryType, type RecordSliceEntryKey } from "@elaraai/east-ui/internal";
import { bindIndexedPagedPlatformFn, DataIndexedPrimitives, NestedPartType } from "@elaraai/e3-ui/internal";
import { RecordSummaryTotalsType, TreePathType, indexWindowType, type TreePath } from "@elaraai/e3-types";
import type { RecordSliceBatches } from "@elaraai/east-ui-components/platform";
import { datasetPathToString } from "./dataset-store.js";
import type { PagedRuntime } from "./paged-runtime.js";
import { toFindQuery } from "./find-query.js";

type Metadata = Record<string, Record<string, unknown>>;
/** A binding's nested part (#1435): the nested series index it lists, its name the one field of its `index`, or none. */
type Nested = ValueTypeOf<ReturnType<typeof NestedPartType<StructType, StructType, StructType, StructType>>>;
type Query = ValueTypeOf<typeof SeekQueryType>;
type Range = ValueTypeOf<typeof SeekRangeType>;
type Entry = { ik: unknown; key: unknown; value: unknown; row: option<unknown> };
/**
 * An index's maintenance for one row (#1437): e3's, the function the record's commit runs — given a row's key, the
 * row before and after, and the patch an update sent, the changes the row makes to the index, by entry, each an op of
 * the index's own patch or a summary's add.
 */
export type IndexMaintenance = (key: unknown, held: option<unknown>, next: option<unknown>, patch: option<unknown>) => ReadonlyMap<unknown, unknown>;
/** Each listed nested series and summary index's maintenance for one row, by its name; none where the binding lists neither. */
export type IndexMaintenances = option<Readonly<Record<string, IndexMaintenance>>>;
/**
 * The listed nested series index's fill of a page (#1438): its lean rows, by key, filled with the entries read of it —
 * a beast2 Array of the index's `{ ik, value }` entries. None where the binding lists none.
 */
export type NestedFill = option<(rows: ReadonlyMap<unknown, unknown>, items: Uint8Array) => ReadonlyMap<unknown, unknown>>;
interface Handle {
    id: string;
    page(offset: bigint, limit: bigint): option<unknown>;
    total(): option<bigint>;
    seek: option<(query: Query) => option<Range>>;
    revision(): option<string>;
    refresh(hash: option<string>): null;
}
interface Schema {
    /** The binding's types: the key, the row, the projection, the indexes' metadata, the index keys, the nested part and what the nested index's entries carry. */
    args: [EastType, EastType, EastType, EastType, EastType, EastType, EastType];
    row: StructType;
    keys: Record<string, EastType>;
    collection: EastType;
    window: EastType;
}

/** What a binding this runtime built reads: its record, its indexes, its nested series index and its join. */
interface Binding {
    readonly schema: Schema;
    readonly path: TreePath;
    readonly metadata: Metadata;
    readonly nested: Nested;
    readonly joined: boolean;
}

/** Whether an index is the nested series index a binding lists (#1435): its entries items, totals and subtotals, read a cell at a time. */
function isNested(nested: Nested, name: string): boolean {
    return nested.type === "some" && Object.hasOwn(nested.value.index, name);
}

/** The refusal of a page or a count of a nested series index (#1435): its entries are no window of rows. */
function nestedWindow(name: string): Error {
    return new Error(`Data.bindPaged: '${name}' is a nested series index, whose entries are items, totals and subtotals: a reader reads its cells`);
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
 * A binding an indexed runtime built, as a reader of its nested series index
 * finds it by its id (#1438): a Plan's root names the binding its rows are
 * read through by id alone, its type the Plan's own.
 */
export interface IndexedBindingRead {
    /** The handle. */
    readonly handle: { revision(): option<string> };
    /** Its batched reads. */
    readonly batches: RecordSliceBatches;
    /** The record's key type. */
    readonly key: EastType;
    /** The listed nested series index: its name, and its entries' type, `{ ik, value }`; none where the binding lists none. */
    readonly nested: { readonly index: string; readonly entry: StructType<{ ik: EastType; value: EastType }> } | undefined;
}

/** The bindings the runtimes here built, by their ids: the latest built under an id, which every one built under it reads alike. */
const bindingsById = new Map<string, IndexedBindingRead>();

/**
 * A binding an indexed runtime built, by its id (#1438).
 *
 * @param id - The binding's id, as its handle carries it
 * @returns The binding read; `undefined` for an id no runtime here built
 */
export function indexedBindingOf(id: string): IndexedBindingRead | undefined {
    return bindingsById.get(id);
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
    // Each membership read's entry keys, printed, by the entries asked and the index (#1349): made once.
    private printedEntries = new WeakMap<readonly RecordSliceEntryKey[], Map<string, readonly string[]>>();

    constructor(private readonly paged: Pick<PagedRuntime, "buildHandle" | "sourceOf" | "seekAll" | "runsAll" | "placeAll" | "withinAll" | "rowsAll" | "joinAll">) {}

    clear(): void {
        this.handles.clear(); this.windows = new WeakMap(); this.sources = new WeakMap(); this.entryPrinters = new WeakMap(); this.printedEntries = new WeakMap();
    }

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

    /**
     * Some entries' keys, `(ik=…, k=…)`, as a membership read names them (#1349): made once for the entries asked —
     * the same array whenever a reader asks of them again, every evaluation that reads them while their answer is in
     * flight among them — so no entry is read and printed again.
     *
     * @param schema - The binding's types
     * @param name - The index
     * @param entries - The entries asked of
     * @returns Each entry's key, in order
     */
    private entryTexts(schema: Schema, name: string, entries: readonly RecordSliceEntryKey[]): readonly string[] {
        let byIndex = this.printedEntries.get(entries);
        if (byIndex === undefined) { byIndex = new Map(); this.printedEntries.set(entries, byIndex); }
        let texts = byIndex.get(name);
        if (texts === undefined) {
            const print = this.entryPrinter(schema, name);
            texts = entries.map(entry => print(entry.ik, entry.key));
            byIndex.set(name, texts);
        }
        return texts;
    }

    private schema(types: EastTypeValue[]): Schema {
        const args = types.map(fromEastTypeValue) as Schema["args"];
        const [key, row, projection, , keys] = args;
        if (row.type !== "Struct" || keys.type !== "Variant") throw new Error("Invalid indexed record schema");
        return { args, row, keys: keys.cases, collection: DictType(key, row), window: ArrayType(IndexedEntryType(key, row, projection, keys)) };
    }

    private defaultIndex(schema: Schema, metadata: Metadata, joined: boolean): string {
        if (joined) return "primary";
        const index = Object.keys(metadata).find(name => {
            // One entry a row: a plain or an area index, which files each row once — never an interval index, which
            // files an event up to three times, nor a series or a summary index, nor a nested series index, which is
            // no index of the metadata — led by no Set field.
            const kind = this.kind(schema, name);
            const fields = this.fields(schema, name);
            return (kind === "plain" || kind === "area") && fields !== undefined && Object.entries(fields).every(([field, marker]) =>
                marker.type === "Array" || (marker.type === "Null" && schema.row.fields[field]?.type !== "Set"));
        });
        if (index === undefined) throw new Error("A covering-only binding needs an index with one entry per record row");
        return index;
    }

    /** An index's metadata in the binding's type (#1432): its row fields' markers and its kind, `{ fields, kind }`. */
    private metadataOf(schema: Schema, name: string): Record<string, EastType> | undefined {
        const types = schema.args[3];
        const index = types.type === "Struct" ? types.fields[name] : undefined;
        return index?.type === "Struct" ? index.fields as Record<string, EastType> : undefined;
    }

    /** The row fields an index is led by, each its marker. */
    private fields(schema: Schema, name: string): Record<string, EastType> | undefined {
        const fields = this.metadataOf(schema, name)?.fields;
        return fields?.type === "Struct" ? fields.fields as Record<string, EastType> : undefined;
    }

    /** An index's kind, its metadata's one case (#1432): `plain`, `interval`, `area`, `series` or `summary`. */
    private kind(schema: Schema, name: string): string | undefined {
        const kind = this.metadataOf(schema, name)?.kind;
        return kind?.type === "Variant" ? Object.keys(kind.cases)[0] : undefined;
    }

    /** Whether an index is a summary index (#1039): its entries totals, naming no row. */
    private isSummary(schema: Schema, name: string): boolean {
        return this.kind(schema, name) === "summary";
    }

    /**
     * Whether an index carries its rows (D29): an area index, or a series
     * index (#1039), whose entries hold the whole row as their projection, so
     * it is read without a join; and beside a nested series index, every index
     * but a summary, whose entries hold the lean row (#1435) — the binding
     * lists none with a value of its own there.
     */
    private carriesRow(schema: Schema, nested: Nested, name: string): boolean {
        const kind = this.kind(schema, name);
        return kind === "area" || kind === "series" || (nested.type === "some" && kind !== undefined && kind !== "summary");
    }

    private source(schema: Schema, path: TreePath, metadata: Metadata, nested: Nested, joined: boolean, name: string): Handle {
        const inNested = isNested(nested, name);
        if (name !== "primary" && !inNested && !Object.hasOwn(metadata, name)) throw new Error(`Index '${name}' was not declared on this binding`);
        let built = this.sources.get(schema);
        if (built === undefined) { built = new Map(); this.sources.set(schema, built); }
        // An index that carries its rows is read without a join, whatever the binding's (D29); a summary index's
        // entries name no row to join (#1039), and a nested series index's are its rows' items (#1435).
        const rows = name !== "primary" && this.carriesRow(schema, nested, name);
        const summary = name !== "primary" && this.isSummary(schema, name);
        const join = name !== "primary" && joined && !rows && !summary && !inNested;
        const sourceKey = `${datasetPathToString(path)}\u0000${name}\u0000${join ? "+join" : ""}`;
        const cached = built.get(sourceKey);
        if (cached !== undefined) return cached;
        const [key, row, projection, , , , nestedValue] = schema.args;
        const type = name === "primary" ? schema.collection
            : summary ? indexWindowType(NullType, schema.keys[name]!, RecordSummaryTotalsType, row)
                : inNested ? indexWindowType(key, schema.keys[name]!, nestedValue, row)
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
     *  index's entry gives its totals as its value, and names no row (#1039);
     *  a nested series index's its item, totals or subtotal (#1435). */
    private entriesOf(schema: Schema, nested: Nested, name: string, window: unknown): unknown[] {
        let mapped = this.windows.get(window as object);
        if (mapped === undefined) { mapped = new Map(); this.windows.set(window as object, mapped); }
        let rows = mapped.get(name);
        if (rows === undefined) {
            if (name === "primary") {
                rows = [...window as Map<unknown, unknown>].map(([key, row]) => ({ ik: variant("primary", key), key, value: none, row: some(row) }));
            } else if (this.isSummary(schema, name) || isNested(nested, name)) {
                rows = (window as Entry[]).map(entry => ({ ik: variant(name, entry.ik), key: entry.key, value: some(entry.value), row: none }));
            } else if (this.carriesRow(schema, nested, name)) {
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
    private batches({ schema, path, metadata, nested, joined }: Binding): RecordSliceBatches {
        const sourceOf = (name: string) => {
            const handle = this.source(schema, path, metadata, nested, joined, name);
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
                return read.type === "none" ? none : some(this.entriesOf(schema, nested, name, read.value) as never);
            },
            // Where a narrowing's runs of an index sit in the record, and which entries they hold (#1349).
            placeAll: (name, runs) => {
                if (name === "primary") throw new Error("A placement places runs of one of the record's indexes, never of its own rows");
                if (this.isSummary(schema, name)) throw new Error(`A placement places a narrowing's rows, and '${name}' is a summary index, whose entries name none`);
                if (isNested(nested, name)) throw nestedWindow(name);
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
                if (isNested(nested, name)) throw nestedWindow(name);
                const within = this.paged.withinAll(sourceOf(name), runs.map(run => [Number(run.row), Number(run.count)] as const),
                    this.entryTexts(schema, name, entries));
                return within.type === "none" ? none : some([...within.value]);
            },
            // The rows of several of the record's own keys in one request (#1039): its own Dict's rows by key — beside a
            // nested series index too, which pages lean rows: a row whole is read by its key (#1435).
            rowsAll: (keys) => {
                if (!joined && nested.type === "none") throw new Error("A covering-only binding cannot read primary rows");
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
                    const [path, metadata, nested, joined, name, offset, limit] = values as [TreePath, Metadata, Nested, boolean, string, bigint, bigint];
                    if (name === "primary" && !joined) throw new Error("A covering-only binding cannot read primary rows");
                    // A page's entries are the binding's, each naming its row; a summary's are totals naming none (#1039), and a
                    // nested series index's its rows' items (#1435).
                    if (name !== "primary" && this.isSummary(schema, name)) {
                        throw new Error(`Data.bindPaged: '${name}' is a summary index, whose entries name no row: a reader reads its cells (recordSliceCellEntries)`);
                    }
                    if (isNested(nested, name)) throw nestedWindow(name);
                    const result = this.source(schema, path, metadata, nested, joined, name).page(offset, limit);
                    if (result.type === "none") return none;
                    return some(this.entriesOf(schema, nested, name, result.value));
                };
            }),
            seek.implement((...types: EastTypeValue[]) => {
                const schema = this.schema(types);
                return (...values: unknown[]) => {
                    const [path, metadata, nested, joined, name, query] = values as [TreePath, Metadata, Nested, boolean, string, Query];
                    const source = this.source(schema, path, metadata, nested, joined, name);
                    if (source.seek.type !== "some") throw new Error("The selected record source cannot be searched");
                    return source.seek.value(query);
                };
            }),
            total.implement((...types: EastTypeValue[]) => {
                const schema = this.schema(types);
                return (...values: unknown[]) => {
                    const [path, metadata, nested, joined, name] = values as [TreePath, Metadata, Nested, boolean, string];
                    if (isNested(nested, name)) throw nestedWindow(name);
                    // A non-fan-out index counts exactly the primary rows. Use
                    // it in covering-only mode without opening primary segments.
                    const source = this.source(schema, path, metadata, nested, joined,
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
                    const [path, metadata, nested, joined] = values as [TreePath, Metadata, Nested, boolean];
                    return this.source(schema, path, metadata, nested, joined, "primary").revision();
                };
            }),
            refresh.implement((...types: EastTypeValue[]) => {
                const schema = this.schema(types);
                return (...values: unknown[]) => {
                    const [path, metadata, nested, joined, hash] = values as [TreePath, Metadata, Nested, boolean, option<string>];
                    return this.source(schema, path, metadata, nested, joined, "primary").refresh(hash);
                };
            }),
        ];
    }

    /** Indexed bind and its serializable primitives, optionally manifest-scoped. */
    platform(allowed: ReadonlySet<string> | null): PlatformFunction[] {
        const primitives = this.primitives();
        return [bindIndexedPagedPlatformFn.implement((...types: EastTypeValue[]) => {
            // The binding's types, as its reads take them; its maintenance part's last, which the handle carries (#1437).
            const schema = this.schema(types.slice(0, -1));
            return (...values: unknown[]) => {
                const [path, metadata, nested, joined, entryKeys, recordId, maintenance, fill] =
                    values as [TreePath, Metadata, Nested, boolean, (index: string, key: unknown, row: unknown) => string[], string, IndexMaintenances, NestedFill];
                const pathKey = datasetPathToString(path);
                if (allowed !== null && !allowed.has(pathKey)) throw new Error(`Data.bindPaged: source path '${pathKey}' not declared in manifest`);
                const typeKey = printType(StructType(Object.fromEntries(schema.args.map((type, i) => [`T${i}`, type]))));
                const listed = [...Object.keys(metadata), ...(nested.type === "some" ? Object.keys(nested.value.index) : [])];
                const id = `${pathKey}@indexes:${listed.join(",")}${joined ? "+join" : ""}`;
                const cacheKey = `${typeKey}:${id}`;
                const cached = this.handles.get(cacheKey);
                if (cached !== undefined) return cached;
                const args = schema.args;
                const descriptor = [East.value(path, TreePathType), East.value(metadata as never, args[3]), East.value(nested as never, args[5]),
                    East.value(joined, BooleanType)] as const;
                const { page, seek, total, revision, refresh } = DataIndexedPrimitives;
                const handle = {
                    id, recordId, indexes: metadata, nested, joined, defaultIndex: this.defaultIndex(schema, metadata, joined), entryKeys, maintenance, fill,
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
                const batches = this.batches({ schema, path, metadata, nested, joined });
                batchesOfHandles.set(handle, batches);
                // And a reader of its nested series index finds it by its id (#1438).
                const nestedName = nested.type === "some" ? Object.keys(nested.value.index)[0] : undefined;
                const ik = nestedName === undefined ? undefined : schema.keys[nestedName];
                bindingsById.set(id, {
                    handle, batches, key: args[0],
                    nested: nestedName === undefined || ik === undefined ? undefined : { index: nestedName, entry: StructType({ ik, value: args[6] }) },
                });
                return handle;
            };
        }), ...primitives];
    }
}
