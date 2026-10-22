/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Serializable record Slice handles over the shared UI store. */
import {
    East, StringType, IntegerType, FunctionType, OptionType, RefType, StructType, fromEastTypeValue,
    encodeBeast2For, decodeBeast2For, printFor, printType, ref, some, none, variant,
    type EastType, type EastTypeValue, type ExprType, type ValueTypeOf, type option, type ref as Ref,
} from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import {
    RecordSliceController, RecordSliceBindType, RecordSliceConfigType, RecordSliceStateType,
    RecordSliceWhereType, RecordSlicePrimitives, recordSliceBindPlatform, LiveSourceType,
    recordSliceReadPlatform, type RecordSliceBinding, type RecordSliceReader, type RecordSliceEntry,
} from "@elaraai/east-ui/internal";
import { SeekQueryType } from "@elaraai/east-ui";
import { enableSlicePersistence, scheduleSlicePersist, type SlicePersistMode } from "./index.js";
import { getStore, trackKey } from "../state-runtime.js";
import type { UIStoreInterface } from "../state-store.js";
import { getRegisteredPlatformImplementations, registerPlatformImplementation } from "../registry.js";
import { PagedScan } from "../../collections/paged-scan.js";
import { readResource } from "../../reactive/read-scope.js";

type Config = ValueTypeOf<RecordSliceConfigType>;
type State = ValueTypeOf<RecordSliceStateType>;
type Where = ValueTypeOf<RecordSliceWhereType>;
type Query = ValueTypeOf<typeof SeekQueryType>;
type Descriptor = [string, RecordSliceBinding, Config, State];
const encodeState = encodeBeast2For(RecordSliceStateType);
const decodeState = decodeBeast2For(RecordSliceStateType);
const printConfig = printFor(RecordSliceConfigType);
const printWhere = printFor(RecordSliceWhereType);
const printState = printFor(RecordSliceStateType);
const typeNames = new WeakMap<object, string>();
const configNames = new WeakMap<Config, string>();
const initialNames = new WeakMap<State, string>();
function name<T extends object>(cache: WeakMap<T, string>, value: T, print: (value: T) => string): string {
    let result = cache.get(value);
    if (result === undefined) { result = print(value); cache.set(value, result); }
    return result;
}

interface BindingEntry {
    controller: RecordSliceController;
    descriptor: Descriptor;
    /** The descriptor every method of the binding captures: one Ref, so a payload writes it once and back-references it from each (#1352). */
    shared: Ref<{ key: string; source: RecordSliceBinding; config: Config; initial: State }>;
    /** The binding's one handle, whatever its narrowing (#1354). */
    handle?: Record<string, unknown>;
    factories: Map<string, (...args: never[]) => unknown>;
}
// Store lifetime scopes the cache; visiting many tasks cannot retain unbounded
// compiled handles or source caches. Serialization carries a complete descriptor
// so a decoded handle also works without re-running its original bind.
const bindings = new WeakMap<UIStoreInterface, Map<string, BindingEntry>>();
/**
 * What each store's record Slices were seeded with, by key: the bytes their first binding wrote from the slice's
 * `initial`. The store keeps the bytes it holds until other bytes are written, so a source still holding these holds
 * the author's start, which nothing has written over: not the reader, a host, a link or storage.
 */
const seeds = new WeakMap<UIStoreInterface, Map<string, Uint8Array>>();

/** The descriptor's East type over a source of type `source`: what one binding's methods share, in a Ref. */
function descriptorType(source: EastType) {
    return StructType({ key: StringType, source, config: RecordSliceConfigType, initial: RecordSliceStateType });
}
// Gestures read the same query outside a tracked evaluation. They may reuse
// an active reader's scan, but these weak references never keep its rows alive
// after that reader changes query or unmounts. Even the lookup keys are bounded.
const scans = new WeakMap<UIStoreInterface, Map<string, WeakRef<PagedScan<unknown, unknown[]>>>>();
function activeScan(key: string): PagedScan<unknown, unknown[]> {
    const store = getStore();
    let held = scans.get(store);
    if (held === undefined) { held = new Map(); scans.set(store, held); }
    let scan = held.get(key)?.deref();
    if (scan === undefined) scan = new PagedScan<unknown, unknown[]>(() => [], (rows, next) => { rows.push(...next); });
    held.delete(key); held.set(key, new WeakRef(scan));
    if (held.size > 64) held.delete(held.keys().next().value!);
    return scan;
}


/**
 * The reads a host's runtime batches for a record Slice's binding (#1351):
 * several searches of one source in one request, and the entries of several
 * runs in one.
 */
export type RecordSliceBatches = Required<Pick<RecordSliceReader<RecordSliceEntry>, "seekAll" | "runsAll">>;

/** How the host's runtime batches a binding's reads, when it does. */
let batchesOf: ((binding: RecordSliceBinding) => RecordSliceBatches | undefined) | undefined;

/**
 * Register how a record Slice's bindings have their reads batched: the host's
 * paged runtime gives a binding it serves its batched searches and runs
 * (#1351), which the Slice reads a plan's searches and its windows through. A
 * binding it gives none reads them one at a time. The binding's East handle is
 * unchanged: the batches are the runtime's.
 *
 * @param resolve - The batches of a binding, by the binding; `undefined` for
 *   one the runtime does not serve
 */
export function registerRecordSliceBatches(resolve: (binding: RecordSliceBinding) => RecordSliceBatches | undefined): void {
    batchesOf = resolve;
}

/** A binding with the reads its runtime batches beside its own. */
function batched(source: RecordSliceBinding): RecordSliceBinding {
    const batches = batchesOf?.(source);
    return batches === undefined ? source : { ...source, seekAll: batches.seekAll, runsAll: batches.runsAll };
}

function bind(types: EastType[], descriptor: Descriptor): BindingEntry {
    const [key, source, config, initial] = descriptor;
    const store = getStore();
    let entries = bindings.get(store);
    if (entries === undefined) { entries = new Map(); bindings.set(store, entries); }
    const identity = `${key}:${source.id}:${name(typeNames, types[0]!, value => printType(value as EastType))}:${name(configNames, config, printConfig)}:${name(initialNames, initial, printState)}`;
    let entry = entries.get(identity);
    if (entry !== undefined) return entry;
    const collection = types[1]!;
    if (collection.type !== "Array" || collection.value.type !== "Struct" || collection.value.fields.row?.type !== "Variant" || collection.value.fields.row.cases.some?.type !== "Struct") {
        throw new Error("Record Slice needs a window of joined record entries");
    }
    const row = collection.value.fields.row.cases.some;
    let lastBytes: Uint8Array | undefined;
    let lastState = initial;
    const read = (): State => {
        trackKey(key);
        const bytes = getStore().read(key);
        if (bytes !== lastBytes) {
            lastBytes = bytes;
            lastState = bytes === undefined ? initial : decodeState(bytes);
        }
        return lastState;
    };
    const write = (state: State) => { getStore().write(key, encodeState(state)); scheduleSlicePersist(key); };
    const metadata = types[0]?.type === "Struct" ? types[0].fields.indexes : undefined;
    const controller = new RecordSliceController(batched(source), config, row, read, write, collection.value.fields.key!,
        metadata?.type === "Struct" ? metadata : undefined);
    if (!store.has(key)) {
        controller.write(initial);
        let seeded = seeds.get(store);
        if (seeded === undefined) { seeded = new Map(); seeds.set(store, seeded); }
        seeded.set(key, store.read(key)!);
    }
    entry = { controller, descriptor, shared: ref({ key, source, config, initial }), factories: new Map() };
    entries.set(identity, entry);
    if (entries.size > 64) entries.delete(entries.keys().next().value!);
    return entry;
}

type Operation = (controller: RecordSliceController, ...args: unknown[]) => unknown;
const operations: Record<keyof typeof RecordSlicePrimitives, Operation> = {
    read: c => c.readState(),
    write: (c, state) => c.write(state as State),
    choose: (c, field, values) => c.choose(field as string, (values as string[]).length === 0 ? undefined : variant("values", values as string[])),
    range: (c, field, from, to) => c.choose(field as string, variant("range", { from: from as string, to: to as string })),
    prefix: (c, field, text) => c.choose(field as string, variant("prefix", text as string)),
    clear: (c, field) => c.choose(field as string, undefined),
    clearAll: c => c.clearAll(),
    count: c => c.count(),
    countWhere: (c, where) => c.count(where as Where),
    total: c => c.source.total("primary"),
    domain: (c, field) => c.domain(field as string),
    values: (c, field) => c.values(field as string),
    suggest: (c, field, text) => c.suggest(field as string, text as string),
    replaces: (c, field) => c.replaces(field as string),
    togglePreset: (c, id) => c.togglePreset(id as string),
    setResolution: (c, resolution) => c.write({ ...c.readState(), resolution: resolution as State["resolution"] }),
    pageWhere: (c, where, offset, limit) => c.windows.page(c.plan(where as Where), offset as bigint, limit as bigint),
    // The narrowed data's reads read the narrowing as it stands, tracked in the evaluation that reads them (#1354).
    dataPage: (c, offset, limit) => c.windows.page(c.plan(c.readState().where), offset as bigint, limit as bigint),
    dataSeek: (c, query) => c.windows.seek(c.plan(c.readState().where), query as Query),
    dataQuery: c => printWhere(c.readState().where),
    revision: c => c.source.revision(),
    refresh: (c, hash) => c.source.refresh(hash as option<string>),
    retry: c => c.source.refresh(none),
    readEntry: (c, id) => c.readEntry(id as string),
    contains: (c, where, id) => c.contains(where as Where, id as string),
    containsRow: (c, where, id, row) => c.containsRow(where as Where, id as string, row as Uint8Array),
};

const primitives: PlatformFunction[] = Object.entries(RecordSlicePrimitives).map(([name, primitive]) => primitive.implement(
    (...values: EastTypeValue[]) => {
        const types = values.map(fromEastTypeValue);
        return (...args: unknown[]) => operations[name as keyof typeof RecordSlicePrimitives](
            bind(types, args.slice(0, 4) as Descriptor).controller, ...args.slice(4));
    },
));

/**
 * Build record Slice operations for a host's platform set.
 * @param platforms - The same implementations used to compile and decode its UI.
 * @returns Serializable bind and operation implementations.
 */
export function createRecordSliceImplementation(platforms: () => PlatformFunction[] = getRegisteredPlatformImplementations): PlatformFunction[] {
    return [
    recordSliceBindPlatform.implement((...values: EastTypeValue[]) => {
        const types = values.map(fromEastTypeValue);
        return (...args: unknown[]) => {
            const entry = bind(types, args as Descriptor);
            // One handle per binding, whatever its narrowing (#1354): the bind reads no state, so the builder that binds
            // it is not built again when a choice changes. Its narrowed data reads the narrowing when its reads run.
            if (entry.handle !== undefined) return entry.handle;
            const [key, source, config] = entry.descriptor;
            const compile = (name: keyof typeof RecordSlicePrimitives, inputs: EastType[], output: EastType) => {
                let factory = entry.factories.get(name);
                if (factory === undefined) {
                    // Capture a decoded source as a function argument. East.value
                    // interprets functions as authoring callbacks; it cannot lift
                    // a compiled handle. The returned closure serializes its real
                    // source, so decoding in another host uses that host's runtime.
                    // Every method captures the binding's one descriptor Ref (#1352):
                    // a payload writes it once and back-references it from the
                    // others, and a decode makes one descriptor they all read.
                    const primitive = RecordSlicePrimitives[name] as unknown as (...args: unknown[]) => ExprType<EastType>;
                    factory = East.compile(East.function([RefType(descriptorType(types[0]!))], FunctionType(inputs, output), (_$, shared) =>
                        East.function(inputs, output, ($, ...params) => {
                            const descriptor = $.let((shared as unknown as { get(): ExprType<EastType> }).get()) as unknown as
                                { key: unknown; source: unknown; config: unknown; initial: unknown };
                            return primitive(types, descriptor.key, descriptor.source, descriptor.config, descriptor.initial, ...params);
                        })), platforms()) as (...args: never[]) => unknown;
                    entry.factories.set(name, factory);
                }
                return factory(entry.shared as never);
            };
            const methods: Record<string, unknown> = { key, config, sourceId: source.recordId };
            for (const [name, type] of Object.entries(RecordSliceBindType.fields)) {
                if (type.type === "Function") methods[name] = compile(name as keyof typeof RecordSlicePrimitives, type.inputs, type.output);
            }
            const dataType = LiveSourceType(types[1]!);
            const handle = { ...methods,
                pageWhere: compile("pageWhere", [RecordSliceWhereType, IntegerType, IntegerType], dataType.fields.page.output),
                data: {
                    // The source, never its narrowing: its reads read the narrowing as it stands, and `query` names it,
                    // so a reader keys its windows by it as by the revision. Revision remains the record's real state
                    // hash, so optimistic editing and a confirmed Save still agree.
                    id: `${source.id}@slice:${key}`,
                    page: compile("dataPage", [IntegerType, IntegerType], dataType.fields.page.output),
                    total: methods["count"],
                    seek: some(compile("dataSeek", [SeekQueryType], dataType.fields.seek.cases.some.output)),
                    revision: compile("revision", [], dataType.fields.revision.output),
                    refresh: compile("refresh", [OptionType(StringType)], dataType.fields.refresh.output),
                    query: compile("dataQuery", [], dataType.fields.query.output),
                } };
            entry.handle = handle;
            return handle;
        };
    }),
    ...primitives,
    recordSliceReadPlatform.implement((collection: EastTypeValue) => {
        if (collection.type !== "Array") throw new Error("A record scan requires an array of index entries");
        const typeKey = printType(fromEastTypeValue(collection));
        return (...args: unknown[]) => {
            const [id, revision, total, page, where] = args as [string, () => option<string>,
                (where: Where) => option<bigint>, (where: Where, offset: bigint, limit: bigint) => option<unknown[]>, Where];
            const key = `record-scan:${id}:${typeKey}:${printWhere(where)}`;
            const scan = readResource(key, () => activeScan(key));
            return scan.read(revision, () => total(where), (offset, limit) => page(where, offset, limit));
        };
    }),
    ];
}

/** Record arm registered for the standard browser host. */
export const RecordSliceImpl = createRecordSliceImplementation();

registerPlatformImplementation(RecordSliceImpl);

/**
 * Whether a record Slice still holds what its binding seeded it with: its `initial`, which nothing has written over
 * since — not the reader, a host, nor a narrowing a link or storage restored. A builder whose own view a reload keeps
 * reads its window from such a source as the author's start, which the view it restores replaces.
 *
 * @param slice - The record Slice
 * @returns Whether its state is still its seed
 */
export function recordSliceSeeded(slice: Pick<ValueTypeOf<RecordSliceBindType>, "key">): boolean {
    const store = getStore();
    const seed = seeds.get(store)?.get(slice.key);
    return seed !== undefined && store.read(slice.key) === seed;
}

/** Persist through the same store-key mechanism as local Slice, validating
 * the record's complete narrowing before replacing its seed. */
export function enableRecordSlicePersistence(slice: ValueTypeOf<RecordSliceBindType>, mode: SlicePersistMode): void {
    enableSlicePersistence(slice.key, mode, bytes => { slice.write(decodeState(bytes)); });
}
