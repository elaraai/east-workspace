/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's DOM test harness (#935, #936): the shared fixture's
 * orders and customers bound on a page — the orders paged, the customers
 * whole — and a saved queries record in memory whose patch door applies each
 * patch with East's own checks; the builder mounted through its carrier, as a
 * surface mounts it, with a host's one-shot call — and, for a run's plan
 * (#941), its split call and its explain (#1132), the data sources' statuses
 * and the plan's options;
 * and the query library (#1063) mounted the same way, alone or beside a
 * builder sharing its id.
 *
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StrictMode } from "react";
import { act, fireEvent, render, screen, within, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    BooleanType, East, NullType, OptionType, PatchType, SortedMap, StringType, applyFor, checkJq, compareFor, decodeBeast2, decodeBeast2For,
    encodeBeast2For, fromEastTypeValue, none, toEastTypeValue, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import {
    DragLayerProvider, EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system,
} from "@elaraai/east-ui-components";
import {
    Query, RecordBindHandleType, bindPagedPinnedPlatformFn, bindPlatformFn, queryKeys, recordBindPlatformFn,
} from "@elaraai/e3-ui/internal";
import { TreePathType, type ExecuteResult, type OneShotRequest, type SplitCallRequest } from "@elaraai/e3-types";
import {
    E3Provider, ReactiveDatasetCache, createInMemoryRecordApi, datasetCacheKey, initializeReactiveDatasetCache, initializeRecordApi,
    type DatasetApi, type E3Config, type RecordApi,
} from "../platform/index.js";
import {
    QueryCallProvider, QueryPlanOptionsProvider, QuerySourceStatusProvider, QuerySplitCallProvider,
    type QueryCall, type QuerySourceStatus, type QuerySplitCall, type QuerySplitCallOptions, type QuerySplitExplain,
} from "./hooks.js";
import { createInMemoryQueryCall, createInMemorySourceStatus, createInMemorySplitCall, type InMemoryDataset } from "./in-memory-call.js";
import { queryRoot, type QueryRoot } from "./one-shot.js";
import { QueryOpenType, type QueryOpen } from "./open-query.js";
import type { SavedQuery } from "./session.js";
// The builder and the query library are extensions: their renderers register as they load.
import "./builder.js";
import "./library.js";

// jsdom lacks the ResizeObserver the panes and the menus' positioners reach for, and the CSS.escape a menu finds its items with.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^\w-]/g, "\\$&");
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});

/** The saved queries record. */
export type Saved = ValueTypeOf<typeof Query.Types.Saved>;
type TreePath = ValueTypeOf<typeof TreePathType>;

export const WORKSPACE = "query-builder-test";
export const RECORD = "queries";
export const ORDERS: TreePath = [variant("field", "inputs"), variant("field", "orders")];
export const CUSTOMERS: TreePath = [variant("field", "inputs"), variant("field", "customers")];

/** The shared fixture's types: the orders and the customers. */
const fixture = decodeBeast2(readFileSync(join(import.meta.dirname, "../../../../../east/test/fixtures/query-fixture.beast2")));
const FIXTURE = fromEastTypeValue(fixture.type);
if (FIXTURE.type !== "Struct") throw new Error("the fixture's root is a struct");
export const OrdersType = FIXTURE.fields["orders"] as EastType;
export const CustomersType = FIXTURE.fields["customers"] as EastType;
/** The shared fixture's root type, and its value: every dataset, by name. */
export const FixtureType: EastType = FIXTURE;
export const FIXTURE_VALUE: unknown = fixture.value;

/** The root a page binding orders and customers gives. */
export const ROOT: QueryRoot = queryRoot([
    { name: "orders", path: ORDERS, type: toEastTypeValue(OrdersType) },
    { name: "customers", path: CUSTOMERS, type: toEastTypeValue(CustomersType) },
]);

/** A saved query over the root, checked as a save checks it. */
export function savedQuery(name: string, program: string, description = none as ValueTypeOf<OptionType<typeof StringType>>): SavedQuery {
    const checked = checkJq(program, ROOT.type, { root: true });
    if (checked.program === null) throw new Error(`${program}: ${checked.diagnostics.map(d => d.message).join("; ")}`);
    return {
        name, description, program: checked.program, saved_at: new Date(Date.UTC(2026, 8, 30, 9, 0)),
        root: ROOT.entries.filter(e => checked.reads.includes(e.name)).map(e => ({ name: e.name, path: e.path })),
    };
}

export const keys = compareFor(StringType);
export const HandleType = RecordBindHandleType(Query.Types.Saved, { patch: [PatchType(Query.Types.Saved)] });

/** The record in memory, and the dataset cache it writes through. */
export interface RecordHarness {
    /** The record's runtime: its patch door, and its history. */
    readonly memory: RecordApi;
    /** The dataset cache it writes through. */
    readonly cache: ReactiveDatasetCache;
}

/**
 * A fresh UI store, and a saved queries record in memory holding `initial`.
 *
 * @param initial - The saved queries it starts with
 * @returns The record's runtime and its cache
 */
export function recordHarness(initial: Saved): RecordHarness {
    StateRuntime.initializeStore(new UIStore());
    const store = new Map<string, Uint8Array>();
    const api: DatasetApi = {
        async get(ws, path) {
            const bytes = store.get(datasetCacheKey(ws, path));
            if (!bytes) throw new Error(`no dataset ${datasetCacheKey(ws, path)}`);
            return { data: bytes, hash: null };
        },
        async set(ws, path, value) { store.set(datasetCacheKey(ws, path), value); },
        async launchDataflow() { /* in memory — nothing to launch */ },
        async listRoot() { return []; },
        async listAt() { return []; },
        async workspaceStatus() { return { datasets: [] }; },
    };
    const cache = new ReactiveDatasetCache({ workspace: WORKSPACE }, api);
    cache.setScheduler((notify) => queueMicrotask(notify));
    initializeReactiveDatasetCache(cache);
    const applyPatch = applyFor(Query.Types.Saved);
    const memory = createInMemoryRecordApi(cache, WORKSPACE, [{
        name: RECORD, stateType: Query.Types.Saved, initial,
        mutations: [{ name: "patch", argTypes: [PatchType(Query.Types.Saved)], reduce: (state, patch) => applyPatch(state as never, patch as never) }],
    }]);
    initializeRecordApi(memory, cache, WORKSPACE);
    return { memory, cache };
}

/** Let the record's reads, the session, the writes and the renders settle. */
export async function settle() {
    await act(async () => {
        for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/**
 * The record as it stands — what its patch door last wrote.
 *
 * @param harness - The record in memory
 * @returns The saved queries
 */
export function readRecord(harness: RecordHarness): Saved {
    const bytes = harness.cache.read(WORKSPACE, [variant("field", "records"), variant("field", RECORD)]);
    if (bytes === undefined) throw new Error("the record has not loaded");
    return decodeBeast2For(Query.Types.Saved)(bytes);
}

/**
 * The mutations the record committed, newest first.
 *
 * @param harness - The record in memory
 * @returns Their names
 */
export async function commits(harness: RecordHarness): Promise<string[]> {
    return (await harness.memory.history(WORKSPACE, RECORD, undefined)).commits.map((c) => c.mutation);
}

/**
 * Opens a query, as the query library does.
 *
 * @param open - The query to open
 */
export async function openQuery(open: QueryOpen) {
    await act(async () => { StateRuntime.getStore().write(queryKeys(undefined).query, encodeBeast2For(QueryOpenType)(open)); });
    await settle();
}

/**
 * Presses a button by its name, as a pointer does.
 *
 * @param name - Its accessible name
 * @param container - Where to find it; the document by default
 */
export async function press(name: string, container?: HTMLElement) {
    const button = (container === undefined ? screen : within(container)).getByRole("button", { name });
    await act(async () => {
        fireEvent.mouseDown(button, { button: 0 });
        fireEvent.click(button);
    });
    await settle();
}

/**
 * Whether a button, by its name, is on.
 *
 * @param name - Its accessible name
 * @returns Whether it can be pressed
 */
export const enabled = (name: string) => !(screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

/** A one-shot call that never reaches a server: it records each request, and fails. */
export function offlineCall(): { call: QueryCall; requests: Parameters<QueryCall>[0][] } {
    const requests: Parameters<QueryCall>[0][] = [];
    return {
        requests,
        call: async (request) => {
            requests.push(request);
            throw new Error("offline");
        },
    };
}

/** What a builder is mounted with besides its one-shot call: an e3 server, and what a run's plan reaches (#941). */
export interface MountOptions {
    /** The server's config, for an `E3Provider` around the builder, whose dataset statuses the Datasets tab reads (#939). */
    readonly e3?: E3Config;
    /** How a split call is made: a `QuerySplitCallProvider` around the builder. */
    readonly split?: QuerySplitCall;
    /** How a split call's pieces are counted when its run answered before it reported them (#1132): the provider's `explain`. */
    readonly explain?: QuerySplitExplain;
    /** How a data source's status is read: a `QuerySourceStatusProvider` around the builder. */
    readonly status?: QuerySourceStatus;
    /** The most a dataset may weigh and still be read by one call: a `QueryPlanOptionsProvider` around the builder. */
    readonly pieceBytes?: number;
    /** The saved query the builder opens first, by name — its payload's `query`, which it runs as it mounts. */
    readonly query?: string;
    /** Mounts it under React's `StrictMode`, as the showcase's dev server does: mounted, unmounted and mounted again. */
    readonly strict?: boolean;
}

/**
 * Mounts the builder as a surface mounts it: the record and two data sources
 * bound, with a host's one-shot call — under an e3 server's config when one is
 * given, whose dataset statuses the Datasets tab reads (#939); with a split
 * call, a data source's status and the plan's options, when given (#941); open
 * on a saved query, and under `StrictMode`, when asked.
 *
 * @param call - How a one-shot call is made
 * @param options - The server's config, what a run's plan reaches, the query it opens and `StrictMode` ({@link MountOptions})
 * @returns The rendered builder
 */
export async function mountBuilder(call?: QueryCall, options: MountOptions = {}): Promise<RenderResult> {
    const opening = options.query === undefined ? {} : { query: options.query };
    const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const orders = $.let(bindPagedPinnedPlatformFn([OrdersType], ORDERS, East.value(none, OptionType(StringType)), East.value(false, BooleanType)));
        const customers = $.let(bindPlatformFn([CustomersType], CUSTOMERS, none, variant("direct", null)));
        const record = $.let(recordBindPlatformFn([HandleType], RECORD));
        return Query.Builder({ queries: record as never, datasets: { orders: orders as never, customers: customers as never }, ...opening });
    }))), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
    let tree = <EastChakraComponent value={program()} storageKey="query-builder" />;
    if (call !== undefined) tree = <QueryCallProvider call={call}>{tree}</QueryCallProvider>;
    if (options.split !== undefined) {
        const explain = options.explain === undefined ? {} : { explain: options.explain };
        tree = <QuerySplitCallProvider call={options.split} {...explain}>{tree}</QuerySplitCallProvider>;
    }
    if (options.status !== undefined) tree = <QuerySourceStatusProvider status={options.status}>{tree}</QuerySourceStatusProvider>;
    if (options.pieceBytes !== undefined) tree = <QueryPlanOptionsProvider pieceBytes={options.pieceBytes}>{tree}</QueryPlanOptionsProvider>;
    const app = (
        <ChakraProvider value={system}>
            {options.e3 === undefined ? tree : <E3Provider config={options.e3}>{tree}</E3Provider>}
        </ChakraProvider>
    );
    const utils = render(options.strict === true ? <StrictMode>{app}</StrictMode> : app);
    await settle();
    return utils;
}

/** The State a query library's `onOpen` writes the name it opened to, in the surface {@link mountLibrary} mounts. */
export const TOLD = "query-library-test.told";

/**
 * Mounts the query library as a surface mounts it — the record and the same
 * two data sources bound — under a line saying what it last told the host it
 * opened ("told Big orders"); with the builder beside it, sharing its id and
 * with a host's one-shot call, when one is given; under a drag layer when
 * asked.
 *
 * @param options - `id`: the name the library and the builder share; `builder`: the builder's one-shot call, which mounts the builder too; `drag`: a `DragLayerProvider` around them
 * @returns The rendered surface
 */
export async function mountLibrary(options: { id?: string; builder?: QueryCall; drag?: boolean } = {}): Promise<RenderResult> {
    const named = options.id === undefined ? {} : { id: options.id };
    const withBuilder = options.builder !== undefined;
    const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const orders = $.let(bindPagedPinnedPlatformFn([OrdersType], ORDERS, East.value(none, OptionType(StringType)), East.value(false, BooleanType)));
        const customers = $.let(bindPlatformFn([CustomersType], CUSTOMERS, none, variant("direct", null)));
        const record = $.let(recordBindPlatformFn([HandleType], RECORD));
        const told = $.let(State.bind([StringType], TOLD, "nothing"));
        const onOpen = $.const(East.function([StringType], NullType, ($2, name) => { $2(told.write(name)); }));
        const datasets = { orders: orders as never, customers: customers as never };
        const library = Query.Library({ queries: record as never, datasets, onOpen, ...named });
        const builder = Query.Builder({ queries: record as never, datasets, ...named });
        return Stack.VStack(withBuilder ? [Text.Root(East.str`told ${told.read()}`), library, builder] : [Text.Root(East.str`told ${told.read()}`), library]);
    }))), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
    const surface = <EastChakraComponent value={program()} storageKey="query-library" />;
    const called = options.builder === undefined ? surface : <QueryCallProvider call={options.builder}>{surface}</QueryCallProvider>;
    const utils = render(
        <ChakraProvider value={system}>
            {options.drag === true ? <DragLayerProvider>{called}</DragLayerProvider> : called}
        </ChakraProvider>,
    );
    await settle();
    return utils;
}

/** The saved queries record, keyed by name. */
export function savedRecord(queries: readonly SavedQuery[]): Saved {
    return new SortedMap(queries.map((q): [string, SavedQuery] => [q.name, q]), keys);
}

/** The hash e3 pins each of the page's datasets at. */
export const HASHES: ReadonlyMap<string, string> = new Map([["orders", "4f2a1c8d".repeat(8)], ["customers", "9b07e3a4".repeat(8)]]);

/** A one-shot call answered here, and what it was asked. */
export interface FixtureCall {
    /** The call. */
    readonly call: QueryCall;
    /** Each request, in order. */
    readonly requests: OneShotRequest[];
    /** Each answer, in the order the requests were made. */
    readonly answers: ExecuteResult[];
    /** Answers the calls held so far, when the call holds its answers: in the order they were made, or the newest first, as a slow call answers last. */
    readonly release: (options?: { newestFirst?: boolean }) => Promise<void>;
}

/**
 * A one-shot call answered here, as e3 answers it: the in-memory call
 * (`createInMemoryQueryCall`) over the fixture's orders and customers, each
 * pinned at its hash in {@link HASHES}, recording what it was asked and what
 * it answered.
 *
 * @param options - `hold`: answer only on `release()`, so a test sees a run going
 * @returns the call, its requests and its answers, and `release`
 */
export function fixtureCall(options: { hold?: boolean } = {}): FixtureCall {
    const requests: OneShotRequest[] = [];
    const answers: ExecuteResult[] = [];
    const held: (() => void)[] = [];
    const memory = createInMemoryQueryCall(fixtureDatasets());
    return {
        requests,
        answers,
        call: async (request) => {
            requests.push(request);
            const index = requests.length - 1;
            if (options.hold === true) await new Promise<void>(resolve => { held.push(resolve); });
            answers[index] = await memory(request);
            return answers[index];
        },
        release: async ({ newestFirst = false } = {}) => {
            const answers = held.splice(0);
            if (newestFirst) answers.reverse();
            // Each answer settles before the next, so a later one never lands in the same render.
            for (const resolve of answers) {
                await act(async () => { resolve(); });
                await settle();
            }
        },
    };
}

/** What the fixture's datasets weigh, by name, when a test weighs them as more than their bytes. */
export interface FixtureWeights {
    /** What the orders weigh, in bytes. */
    readonly orders?: number;
    /** What the customers weigh, in bytes. */
    readonly customers?: number;
}

/**
 * The fixture's orders and customers as datasets in memory, each pinned at
 * its hash in {@link HASHES}, and weighed as given: its beast2 bytes' length
 * otherwise.
 *
 * @param weights - What each weighs, by name
 * @returns The datasets
 */
export function fixtureDatasets(weights: FixtureWeights = {}): InMemoryDataset[] {
    const fixture = FIXTURE_VALUE as Readonly<Record<string, unknown>>;
    return [
        { path: ORDERS, type: OrdersType, value: fixture["orders"], hash: HASHES.get("orders")!, ...(weights.orders === undefined ? {} : { bytes: weights.orders }) },
        { path: CUSTOMERS, type: CustomersType, value: fixture["customers"], hash: HASHES.get("customers")!, ...(weights.customers === undefined ? {} : { bytes: weights.customers }) },
    ];
}

/**
 * The fixture's data sources' statuses, answered in memory: each one's rows,
 * hash and weight (#941).
 *
 * @param weights - What each weighs, by name, when not its bytes
 * @returns The status
 */
export function fixtureStatus(weights: FixtureWeights = {}): QuerySourceStatus {
    return createInMemorySourceStatus(fixtureDatasets(weights));
}

/** A split call answered here, and what it was asked. */
export interface FixtureSplit {
    /** The call. */
    readonly split: QuerySplitCall;
    /** Each request, in order. */
    readonly requests: SplitCallRequest[];
    /** Each request's signal, in order: an abandoned run's is aborted. */
    readonly signals: AbortSignal[];
    /** Each answer's result, in the order the requests were made. */
    readonly answers: ExecuteResult[];
    /** Each answer's assembled output's hash, in the order the requests were made. */
    readonly outputs: (string | null)[];
    /** Answers the calls held so far, in the order they were made. */
    readonly release: () => Promise<void>;
    /** Its explain (#1132): the in-memory call's, which counts the pieces it cuts. */
    readonly explain: QuerySplitExplain;
    /** Each request explained, in order. */
    readonly explained: SplitCallRequest[];
    /** Each explain's signal, in order: an abandoned run's is aborted. */
    readonly explainSignals: AbortSignal[];
    /** Answers the explains held so far, in the order they were made. */
    readonly releaseExplains: () => Promise<void>;
}

/** Answers held promises, in the order they were made, each settling before the next. */
async function releaseAll(held: (() => void)[]): Promise<void> {
    for (const resolve of held.splice(0)) {
        await act(async () => { resolve(); });
        await settle();
    }
}

/**
 * A split call answered here, as e3 answers it (#941): the in-memory split
 * call (`createInMemorySplitCall`) over the fixture's orders and customers,
 * the partitioned one cut into `pieces`, recording each request, its signal
 * and its answer — a re-keyed join's two calls among them (#942), the second
 * reading the first's output by its hash — and its explain, recording each
 * request it explains and its signal (#1132).
 *
 * @param options - `pieces`: how many pieces; `hold`: each call reports half
 *   its pieces done and waits for `release()`, so a test sees it going;
 *   `quiet`: each call reports no progress, as a job that ended between two
 *   polls, or that e3's cache served whole; `holdExplain`: each explain waits
 *   for `releaseExplains()`
 * @returns the call, its requests, signals and answers, and `release`; its
 *   explain, what it explained and its signals, and `releaseExplains`
 */
export function fixtureSplit(options: { pieces: number; hold?: boolean; quiet?: boolean; holdExplain?: boolean }): FixtureSplit {
    const requests: SplitCallRequest[] = [];
    const signals: AbortSignal[] = [];
    const answers: ExecuteResult[] = [];
    const outputs: (string | null)[] = [];
    const held: (() => void)[] = [];
    const explained: SplitCallRequest[] = [];
    const explainSignals: AbortSignal[] = [];
    const heldExplains: (() => void)[] = [];
    const memory = createInMemorySplitCall(fixtureDatasets(), { pieces: options.pieces });
    return {
        requests,
        signals,
        answers,
        outputs,
        split: async (request: SplitCallRequest, callOptions: QuerySplitCallOptions) => {
            requests.push(request);
            signals.push(callOptions.signal);
            const index = requests.length - 1;
            const told = options.quiet === true ? { ...callOptions, onProgress: () => {} } : callOptions;
            if (options.hold === true) {
                told.onProgress({ phase: variant("partition", null), done: BigInt(Math.floor(options.pieces / 2)), units: BigInt(options.pieces) });
                await new Promise<void>(resolve => { held.push(resolve); });
            }
            const answer = await memory(request, told);
            answers[index] = answer.result;
            outputs[index] = answer.output;
            return answer;
        },
        release: () => releaseAll(held),
        explain: async (request, explainOptions) => {
            explained.push(request);
            explainSignals.push(explainOptions.signal);
            if (options.holdExplain === true) await new Promise<void>(resolve => { heldExplains.push(resolve); });
            return memory.explain(request, explainOptions);
        },
        explained,
        explainSignals,
        releaseExplains: () => releaseAll(heldExplains),
    };
}
